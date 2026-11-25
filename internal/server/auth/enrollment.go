package auth

import (
	"context"
	"errors"
	"net/netip"

	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/jackc/pgx/v5"
)

// StartEnrollment is opt-in MFA for an already authenticated user. Required
// first-login enrollment uses Login instead and never issues a bypass session.
func (e *Engine) StartEnrollment(ctx context.Context, sessionToken, password string, realm Realm, ip netip.Addr) (LoginResult, error) {
	if err := e.reserveAttempt(ctx, ip); err != nil {
		return LoginResult{}, err
	}
	scope, err := e.sessions.Resolve(ctx, sessionToken, realm)
	if err != nil {
		return LoginResult{}, err
	}
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	hash, err := tokenHash(sessionToken)
	if err != nil {
		return LoginResult{}, ErrUnauthenticated
	}
	owner, err := q.SessionOwner(ctx, authdb.SessionOwnerParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return e.reject(ctx, tx, q, nil, realm, "auth.mfa_failed")
	}
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	if owner.Bytes != [16]byte(scope.UserID()) {
		return LoginResult{}, ErrUnauthenticated
	}
	user, err := q.LockLoginUser(ctx, owner)
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	// Recheck session under the identity lock; Resolve alone would leave a
	// revocation race between authorization and the enrollment transaction.
	session, err := q.LockSession(ctx, authdb.LockSessionParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return e.reject(ctx, tx, q, nil, realm, "auth.mfa_failed")
	}
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	now := e.sessions.now().UTC()
	if session.RevokedAt.Valid || !now.Before(session.ExpiresAt.Time) || !now.Before(session.IdleExpiresAt.Time) || user.Status != "active" || (user.LockedUntil.Valid && now.Before(user.LockedUntil.Time)) {
		return e.reject(ctx, tx, q, nil, realm, "auth.mfa_failed")
	}
	if user.MfaEnabledAt.Valid {
		return LoginResult{}, ErrForbidden
	}
	match, err := e.passwords.Verify(ctx, password, user.PasswordHash.String)
	if err != nil && !errors.Is(err, ErrInvalidHash) {
		return LoginResult{}, storageError(ctx)
	}
	if err != nil || !match.Valid {
		return e.reject(ctx, tx, q, &user, realm, "auth.mfa_failed")
	}
	if _, err := readScope(ctx, q, owner, realm, true, true); err != nil {
		return LoginResult{}, err
	}
	result, err := e.challenge(ctx, q, user, realm)
	if err != nil {
		return LoginResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return LoginResult{}, storageError(ctx)
	}
	return result, nil
}
