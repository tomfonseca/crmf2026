package auth

import (
	"context"
	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/jackc/pgx/v5/pgtype"
	"net/netip"
	"time"
)

// reserveAttempt commits separately, so failed/rolled-back logins still count.
// A sliding minute is shared by all realms, MFA steps and API processes.
func (e *Engine) reserveAttempt(ctx context.Context, ip netip.Addr) error {
	if !ip.IsValid() || ip.Zone() != "" {
		return ErrUnauthenticated
	}
	ip = ip.Unmap()
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	now := e.sessions.now().UTC()
	if err := q.EnsureIP(ctx, authdb.EnsureIPParams{Ip: ip, LastAttemptAt: timestamp(now)}); err != nil {
		return storageError(ctx)
	}
	stored, err := q.LockIP(ctx, ip)
	if err != nil {
		return storageError(ctx)
	}
	attempts := make([]pgtype.Timestamptz, 0, 20)
	for _, at := range stored {
		if at.Valid && at.Time.After(now.Add(-time.Minute)) {
			attempts = append(attempts, at)
		}
	}
	if len(attempts) >= 20 {
		return ErrRateLimited
	}
	attempts = append(attempts, timestamp(now))
	if err := q.UpdateIP(ctx, authdb.UpdateIPParams{Ip: ip, Attempts: attempts, LastAttemptAt: timestamp(now)}); err != nil {
		return storageError(ctx)
	}
	if err := tx.Commit(ctx); err != nil {
		return storageError(ctx)
	}
	return nil
}

// PruneExpiredState removes stale IP buckets and expired proofs; schedule
// it before deployment. No bucket in the sliding window can be removed.
func (e *Engine) PruneExpiredState(ctx context.Context) error {
	if err := e.pruneRecoveryQueue(ctx); err != nil {
		return err
	}
	if err := authdb.New(e.sessions.pool).PruneUserTokens(ctx, timestamp(e.sessions.now().UTC().Add(-24*time.Hour))); err != nil {
		return storageError(ctx)
	}
	if err := authdb.New(e.sessions.pool).PrunePasskeyChallenges(ctx, timestamp(e.sessions.now().UTC().Add(-10*time.Minute))); err != nil {
		return storageError(ctx)
	}
	if err := authdb.New(e.sessions.pool).PruneIPAttempts(ctx, timestamp(e.sessions.now().UTC().Add(-10*time.Minute))); err != nil {
		return storageError(ctx)
	}
	return nil
}
