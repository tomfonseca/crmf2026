package auth

import (
	"context"
	"errors"
	"time"

	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the only application entry point to persisted identity.
// Engine owns session issuance after password/MFA validation.
type Service struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func Open(ctx context.Context, connectionString string) (*Service, error) {
	cfg, err := pgxpool.ParseConfig(connectionString)
	if err != nil {
		return nil, errors.New("invalid authentication database configuration")
	}
	cfg.MaxConns = 4
	cfg.MaxConnIdleTime = 10 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, ErrUnavailable
	}
	var allowed bool
	err = pool.QueryRow(ctx, "SELECT current_user='crmf_auth' AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit) FROM pg_roles WHERE rolname=current_user").Scan(&allowed)
	if err != nil || !allowed {
		pool.Close()
		return nil, errors.New("authentication requires the isolated auth database role")
	}
	return &Service{pool: pool, now: time.Now}, nil
}
func (s *Service) Close() { s.pool.Close() }

func (s *Service) Authenticate(ctx context.Context, token string, realm Realm) (context.Context, error) {
	scope, err := s.Resolve(ctx, token, realm)
	if err != nil {
		return nil, err
	}
	return context.WithValue(ctx, principalKey{}, scope), nil
}

func (s *Service) Resolve(ctx context.Context, token string, realm Realm) (Scope, error) {
	hash, err := tokenHash(token)
	if err != nil || (realm != Tenant && realm != Platform) {
		return Scope{}, ErrUnauthenticated
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Scope{}, storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	owner, err := q.SessionOwner(ctx, authdb.SessionOwnerParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return Scope{}, ErrUnauthenticated
	}
	if err != nil {
		return Scope{}, storageError(ctx)
	}
	// Always lock user before session. Grant/security updates use the same order.
	user, err := q.LockIdentity(ctx, authdb.LockIdentityParams{ID: owner, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return Scope{}, ErrUnauthenticated
	}
	if err != nil {
		return Scope{}, storageError(ctx)
	}
	if user.Status != "active" {
		return Scope{}, ErrForbidden
	}
	session, err := q.LockSession(ctx, authdb.LockSessionParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return Scope{}, ErrUnauthenticated
	}
	if err != nil {
		return Scope{}, storageError(ctx)
	}
	now := s.now().UTC()
	if session.UserID != owner || session.RevokedAt.Valid || !session.IdleExpiresAt.Valid || !session.ExpiresAt.Valid || !now.Before(session.IdleExpiresAt.Time) || !now.Before(session.ExpiresAt.Time) {
		return Scope{}, ErrUnauthenticated
	}
	scope, err := readScope(ctx, q, owner, realm, session.MfaVerified, user.PasskeyEnrolled)
	if err != nil {
		return Scope{}, err
	}
	idle := 12 * time.Hour
	if realm == Platform {
		idle = 30 * time.Minute
	}
	err = q.TouchSession(ctx, authdb.TouchSessionParams{ID: session.ID, LastSeenAt: timestamp(now), IdleExpiresAt: timestamp(now.Add(idle))})
	if err != nil {
		return Scope{}, storageError(ctx)
	}
	if err := tx.Commit(ctx); err != nil {
		return Scope{}, storageError(ctx)
	}
	return scope, nil
}

// Revoke is idempotent and scoped to the realm as well as token possession.
func (s *Service) Revoke(ctx context.Context, token string, realm Realm) error {
	hash, err := tokenHash(token)
	if err != nil || (realm != Tenant && realm != Platform) {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	user, err := q.RevokeSession(ctx, authdb.RevokeSessionParams{TokenHash: hash, Realm: string(realm), RevokedAt: timestamp(s.now().UTC())})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return storageError(ctx)
	}
	if err := auditAuth(ctx, q, user, user, realm, "auth.logout", s.now().UTC()); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return storageError(ctx)
	}
	return nil
}
func timestamp(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
func storageError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return ErrUnavailable
}
