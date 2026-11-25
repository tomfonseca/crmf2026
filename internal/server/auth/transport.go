package auth

import (
	"context"
	"errors"
	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/jackc/pgx/v5"
)

func (e *Engine) Resolve(ctx context.Context, token string, realm Realm) (Scope, error) {
	return e.sessions.Resolve(ctx, token, realm)
}
func (e *Engine) Revoke(ctx context.Context, token string, realm Realm) error {
	return e.sessions.Revoke(ctx, token, realm)
}
func (e *Engine) Ping(ctx context.Context) error {
	if err := e.sessions.pool.Ping(ctx); err != nil {
		return storageError(ctx)
	}
	return nil
}
func (e *Engine) CancelChallenge(ctx context.Context, token string, realm Realm) error {
	hash, err := tokenHash(token)
	if err != nil || (realm != Tenant && realm != Platform) {
		return nil
	}
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	user, err := q.CancelPasskeyChallenge(ctx, authdb.CancelPasskeyChallengeParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return storageError(ctx)
	}
	if err := auditAuth(ctx, q, user, user, realm, "auth.passkey_cancelled", e.sessions.now().UTC()); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return storageError(ctx)
	}
	return nil
}
