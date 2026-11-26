package auth

import (
	"context"
	"errors"
	"net/netip"
	"strings"

	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Invalid, stale, consumed, wrong-realm and unauthorized identity proofs are
// deliberately indistinguishable. A token never proves MFA or creates a session.
var ErrResetToken = errors.New("password reset link is invalid or unavailable")

func resetRealm(realm Realm) pgtype.Text {
	return pgtype.Text{String: string(realm), Valid: true}
}

func resetIdentityAllowed(ctx context.Context, q *authdb.Queries, user authdb.LockResetIdentityRow, realm Realm) error {
	if user.Status != "active" || !user.PasswordHash.Valid || user.PasswordHash.String == "" {
		return ErrResetToken
	}
	// Eligibility only: these booleans do NOT represent successful MFA. No
	// principal/session is returned. Actual login still requires its real factors.
	if _, err := readScope(ctx, q, user.ID, realm, true, true); err != nil {
		if errors.Is(err, ErrUnavailable) {
			return err
		}
		return ErrResetToken
	}
	return nil
}

// issuePasswordReset is intentionally PRIVATE. Only the future authorized,
// anti-enumerating request/delivery lifecycle may call it. There is no HTTP or
// operator endpoint exposing a raw link or accepting a user ID for issuance.
// The notice is returned only after commit; delivery uncertainty never retries.
func (e *Engine) issuePasswordReset(ctx context.Context, id uuid.UUID, realm Realm) (MailNotice, error) {
	if id == uuid.Nil || (realm != Tenant && realm != Platform) {
		return MailNotice{}, ErrResetToken
	}
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return MailNotice{}, storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	user, err := q.LockResetIdentity(ctx, pgtype.UUID{Bytes: id, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return MailNotice{}, ErrResetToken
	}
	if err != nil {
		return MailNotice{}, storageError(ctx)
	}
	if err = resetIdentityAllowed(ctx, q, user, realm); err != nil {
		return MailNotice{}, err
	}
	// Refuse malformed stored identities rather than mailing another recipient.
	if err = ValidateUserIdentity(user.Email, "Reset identity"); err != nil || strings.TrimSpace(user.Email) != user.Email {
		return MailNotice{}, ErrResetToken
	}
	raw, hash, err := newToken()
	if err != nil {
		return MailNotice{}, ErrUnavailable
	}
	now, err := q.AuthDatabaseTime(ctx)
	if err != nil {
		return MailNotice{}, storageError(ctx)
	}
	if err = q.InvalidateResetTokens(ctx, authdb.InvalidateResetTokensParams{UserID: user.ID, Realm: resetRealm(realm)}); err != nil {
		return MailNotice{}, storageError(ctx)
	}
	if err = q.InsertResetToken(ctx, authdb.InsertResetTokenParams{
		TokenHash: hash, UserID: user.ID, Realm: resetRealm(realm),
		PasswordEpoch: user.PasswordChangedAt, CreatedAt: now,
	}); err != nil {
		return MailNotice{}, storageError(ctx)
	}
	if err = auditAuth(ctx, q, pgtype.UUID{}, user.ID, realm, "auth.password_reset_issued", now.Time); err != nil {
		return MailNotice{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MailNotice{}, storageError(ctx)
	}
	return MailNotice{To: user.Email, Kind: PasswordResetMail, Realm: realm, Token: raw}, nil
}

// ResetPassword consumes an email bearer proof and changes only the password.
// Caller must supply a trusted resolved IP, exact realm, bounded context/body,
// CSRF/origin checks and no-store response. It is not yet wired to HTTP.
func (e *Engine) ResetPassword(ctx context.Context, token, next string, realm Realm, ip netip.Addr) error {
	if err := e.reserveAttempt(ctx, ip); err != nil {
		return err
	}
	hash, err := tokenHash(token)
	if err != nil || (realm != Tenant && realm != Platform) {
		return ErrResetToken
	}
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	id, err := q.ResetTokenOwner(ctx, authdb.ResetTokenOwnerParams{TokenHash: hash, Realm: resetRealm(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrResetToken
	}
	if err != nil {
		return storageError(ctx)
	}
	user, err := q.LockResetIdentity(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrResetToken
	}
	if err != nil {
		return storageError(ctx)
	}
	proof, err := q.LockResetToken(ctx, authdb.LockResetTokenParams{TokenHash: hash, Realm: resetRealm(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrResetToken
	}
	if err != nil {
		return storageError(ctx)
	}
	now, err := q.AuthDatabaseTime(ctx)
	if err != nil {
		return storageError(ctx)
	}
	if proof.UserID != id || proof.UsedAt.Valid || !proof.ExpiresAt.Valid ||
		!now.Time.Before(proof.ExpiresAt.Time) ||
		proof.PasswordEpoch.Valid != user.PasswordChangedAt.Valid ||
		(proof.PasswordEpoch.Valid && (!proof.PasswordEpoch.Time.Equal(user.PasswordChangedAt.Time) ||
			proof.PasswordEpoch.InfinityModifier != user.PasswordChangedAt.InfinityModifier)) {
		return ErrResetToken
	}
	if err = resetIdentityAllowed(ctx, q, user, realm); err != nil {
		return err
	}
	// Only a valid proof reaches bounded Argon2 work. Policy failure rolls back
	// without consuming the token, changing counters or extending its expiry.
	encoded, err := e.passwords.Hash(ctx, next)
	if err != nil {
		return err
	}
	changed, err := q.ConsumeResetToken(ctx, authdb.ConsumeResetTokenParams{TokenHash: hash, Realm: resetRealm(realm)})
	if err != nil {
		return storageError(ctx)
	}
	if changed != 1 {
		return ErrResetToken
	} // expiry rechecked AFTER expensive hashing
	now, err = q.AuthDatabaseTime(ctx)
	if err != nil {
		return storageError(ctx)
	}
	if err = q.ChangeOwnPassword(ctx, authdb.ChangeOwnPasswordParams{
		ID: id, PasswordHash: pgtype.Text{String: encoded, Valid: true}, PasswordChangedAt: now,
	}); err != nil {
		return storageError(ctx)
	}
	// Existing triggers end all sessions/challenges, but preserve passkey blobs
	// and recovery codes. New triggers also invalidate every other user token.
	if err = auditAuth(ctx, q, pgtype.UUID{}, id, realm, "auth.password_reset", now.Time); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return storageError(ctx)
	}
	return nil
}
