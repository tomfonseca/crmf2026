package auth

import (
	"context"
	"errors"
	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"net/netip"
	"time"
)

var ErrCurrentPassword = errors.New("current password not confirmed")
var ErrSessionMissing = errors.New("own session not found")

type SessionInfo struct {
	ID                                              uuid.UUID
	CreatedAt, LastSeenAt, IdleExpiresAt, ExpiresAt time.Time
	Current, MFAVerified                            bool
}
type SessionPage struct {
	Items []SessionInfo
	Next  uuid.UUID
}
type accountLock struct {
	tx      pgx.Tx
	q       *authdb.Queries
	user    authdb.LockLoginUserRow
	session authdb.LockSessionRow
}

func (e *Engine) lockAccount(ctx context.Context, token string, realm Realm) (result *accountLock, err error) {
	hash, err := tokenHash(token)
	if err != nil || (realm != Platform && realm != Tenant) {
		return nil, ErrUnauthenticated
	}
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return nil, storageError(ctx)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	q := authdb.New(tx)
	owner, err := q.SessionOwner(ctx, authdb.SessionOwnerParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnauthenticated
	}
	if err != nil {
		return nil, storageError(ctx)
	}
	user, err := q.LockLoginUser(ctx, owner)
	if err != nil {
		return nil, storageError(ctx)
	}
	if user.Status != "active" {
		return nil, ErrForbidden
	}
	current, err := q.LockSession(ctx, authdb.LockSessionParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnauthenticated
	}
	if err != nil {
		return nil, storageError(ctx)
	}
	now := e.sessions.now().UTC()
	if current.UserID != owner || current.RevokedAt.Valid || !current.ExpiresAt.Valid || !current.IdleExpiresAt.Valid || !now.Before(current.ExpiresAt.Time) || !now.Before(current.IdleExpiresAt.Time) {
		return nil, ErrUnauthenticated
	}
	enrolled, err := q.AccountHasPasskey(ctx, authdb.AccountHasPasskeyParams{UserID: owner, Realm: string(realm)})
	if err != nil {
		return nil, storageError(ctx)
	}
	if _, err = readScope(ctx, q, owner, realm, current.MfaVerified, enrolled); err != nil {
		return nil, err
	}
	idle := 12 * time.Hour
	if realm == Platform {
		idle = 30 * time.Minute
	}
	if err = q.TouchSession(ctx, authdb.TouchSessionParams{ID: current.ID, LastSeenAt: timestamp(now), IdleExpiresAt: timestamp(now.Add(idle))}); err != nil {
		return nil, storageError(ctx)
	}
	return &accountLock{tx, q, user, current}, nil
}
func (e *Engine) OwnSessions(ctx context.Context, token string, realm Realm, after uuid.UUID) (SessionPage, error) {
	a, err := e.lockAccount(ctx, token, realm)
	if err != nil {
		return SessionPage{}, err
	}
	defer func() { _ = a.tx.Rollback(ctx) }()
	rows, err := a.q.ListOwnSessions(ctx, authdb.ListOwnSessionsParams{UserID: a.user.ID, Realm: string(realm), At: timestamp(e.sessions.now().UTC()), AfterID: pgtype.UUID{Bytes: after, Valid: after != uuid.Nil}})
	if err != nil {
		return SessionPage{}, storageError(ctx)
	}
	page := SessionPage{Items: make([]SessionInfo, 0, min(100, len(rows)))}
	for _, r := range rows[:min(100, len(rows))] {
		page.Items = append(page.Items, SessionInfo{ID: uuid.UUID(r.ID.Bytes), CreatedAt: r.CreatedAt.Time, LastSeenAt: r.LastSeenAt.Time, IdleExpiresAt: r.IdleExpiresAt.Time, ExpiresAt: r.ExpiresAt.Time, Current: r.ID == a.session.ID, MFAVerified: r.MfaVerified})
	}
	if len(rows) > 100 {
		page.Next = page.Items[len(page.Items)-1].ID
	}
	if err = a.tx.Commit(ctx); err != nil {
		return SessionPage{}, storageError(ctx)
	}
	return page, nil
}
func (e *Engine) EndOwnSession(ctx context.Context, token string, realm Realm, id uuid.UUID) (bool, error) {
	if id == uuid.Nil {
		return false, ErrSessionMissing
	}
	a, err := e.lockAccount(ctx, token, realm)
	if err != nil {
		return false, err
	}
	defer func() { _ = a.tx.Rollback(ctx) }()
	target := pgtype.UUID{Bytes: id, Valid: true}
	exists, err := a.q.OwnSessionExists(ctx, authdb.OwnSessionExistsParams{ID: target, UserID: a.user.ID, Realm: string(realm)})
	if err != nil {
		return false, storageError(ctx)
	}
	if !exists {
		return false, ErrSessionMissing
	}
	n, err := a.q.RevokeOwnSession(ctx, authdb.RevokeOwnSessionParams{ID: target, UserID: a.user.ID, Realm: string(realm), RevokedAt: timestamp(e.sessions.now().UTC())})
	if err != nil {
		return false, storageError(ctx)
	}
	if n > 0 {
		if err = auditAuth(ctx, a.q, a.user.ID, target, realm, "auth.session_ended", e.sessions.now().UTC()); err != nil {
			return false, err
		}
	}
	if err = a.tx.Commit(ctx); err != nil {
		return false, storageError(ctx)
	}
	return target == a.session.ID, nil
}
func (e *Engine) ChangePassword(ctx context.Context, token, current, next string, realm Realm, ip netip.Addr) error {
	if err := e.reserveAttempt(ctx, ip); err != nil {
		return err
	}
	a, err := e.lockAccount(ctx, token, realm)
	if err != nil {
		return err
	}
	defer func() { _ = a.tx.Rollback(ctx) }()
	now := e.sessions.now().UTC()
	if a.user.LockedUntil.Valid && now.Before(a.user.LockedUntil.Time) {
		return ErrRateLimited
	}
	match, err := e.passwords.Verify(ctx, current, a.user.PasswordHash.String)
	if err != nil && !errors.Is(err, ErrInvalidHash) {
		return storageError(ctx)
	}
	if err != nil || !a.user.PasswordHash.Valid || !match.Valid {
		_, err = e.reject(ctx, a.tx, a.q, &a.user, realm, "auth.password_change_failed")
		if errors.Is(err, ErrUnauthenticated) {
			return ErrCurrentPassword
		}
		return err
	}
	if current == next {
		return ErrPasswordPolicy
	}
	hash, err := e.passwords.Hash(ctx, next)
	if err != nil {
		return err
	}
	// Existing identity-security triggers atomically revoke ALL sessions and both
	// legacy/passkey challenges. No passkey/recovery credential is reset or rewrapped.
	if err = a.q.ChangeOwnPassword(ctx, authdb.ChangeOwnPasswordParams{ID: a.user.ID, PasswordHash: pgtype.Text{String: hash, Valid: true}, PasswordChangedAt: timestamp(now)}); err != nil {
		return storageError(ctx)
	}
	if err = auditAuth(ctx, a.q, a.user.ID, a.user.ID, realm, "auth.password_changed", now); err != nil {
		return err
	}
	if err = a.tx.Commit(ctx); err != nil {
		return storageError(ctx)
	}
	return nil
}
