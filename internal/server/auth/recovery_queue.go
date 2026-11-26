package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"net/netip"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// LocalRecovery is explicit development-only delivery. It deliberately accepts
// only UUID@example.invalid recipients, never the existing operator. Production
// needs a separately accepted provider; LocalMailer cannot be its fallback.
type LocalRecovery struct {
	engine *Engine
	mailer *LocalMailer
}

func NewLocalRecovery(e *Engine, m *LocalMailer) (*LocalRecovery, error) {
	if e == nil || e.sessions == nil || e.secrets == nil || m == nil || m.client == nil {
		return nil, ErrUnavailable
	}
	return &LocalRecovery{engine: e, mailer: m}, nil
}
func (*LocalRecovery) String() string { return "[local authentication recovery]" }

func recoveryMAC(key []byte, purpose, value string) [32]byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(purpose))
	mac.Write([]byte{0})
	mac.Write([]byte(value))
	var out [32]byte
	copy(out[:], mac.Sum(nil))
	return out
}
func (e *Engine) recoveryIndex(purpose, value string) []byte {
	sum := recoveryMAC(e.recoveryKey[:], purpose, value)
	return sum[:]
}
func recoveryPurpose(realm Realm) string { return "password-request-v1:" + string(realm) }

func disposableRecoveryRecipient(email string) bool {
	local, ok := strings.CutSuffix(email, "@example.invalid")
	if !ok {
		return false
	}
	id, err := uuid.Parse(local)
	return err == nil && id != uuid.Nil && id.String() == local
}

// Request never looks up users, issues tokens or sends mail. Nonexistent,
// ineligible, wrong-realm, repeated and quota-limited inputs have the same
// successful return. Errors are global storage/configuration failures, not
// account eligibility. Caller must use exact Origin/CSRF and trusted IP.
func (s *LocalRecovery) Request(ctx context.Context, email string, realm Realm, ip netip.Addr) error {
	if (realm != Tenant && realm != Platform) || !ip.IsValid() || ip.Zone() != "" ||
		len(email) > 254 || !utf8.ValidString(email) || strings.ContainsFunc(email, unicode.IsControl) {
		return ErrInvalidMail
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return ErrInvalidMail
	}
	e := s.engine
	id, err := uuid.NewV7()
	if err != nil {
		return ErrUnavailable
	}
	encrypted, err := sealSecret(e.secrets, id, recoveryPurpose(realm), email)
	if err != nil {
		return ErrUnavailable
	}
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	// Constant lock order, independent of account existence. Global bound is
	// intentionally small for homologation and shared across realms/processes.
	now, err := q.AuthDatabaseTime(ctx)
	if err != nil {
		return storageError(ctx)
	}
	limits := []struct {
		key  []byte
		max  int
		span time.Duration
	}{
		{e.recoveryIndex("global", ""), 120, time.Minute},
		{e.recoveryIndex("ip", ip.Unmap().String()), 10, time.Minute},
		{e.recoveryIndex("recipient", email), 3, time.Hour},
	}
	allowed := true
	for _, limit := range limits {
		if err = q.EnsureRecoveryLimit(ctx, limit.key); err != nil {
			return storageError(ctx)
		}
		attempts, readErr := q.LockRecoveryLimit(ctx, limit.key)
		if readErr != nil {
			return storageError(ctx)
		}
		kept := make([]pgtype.Timestamptz, 0, limit.max)
		for _, at := range attempts {
			if at.Valid && at.Time.After(now.Time.Add(-limit.span)) {
				kept = append(kept, at)
			}
		}
		if len(kept) >= limit.max {
			allowed = false
			break
		}
		kept = append(kept, now)
		if err = q.UpdateRecoveryLimit(ctx, authdb.UpdateRecoveryLimitParams{Key: limit.key, Attempts: kept}); err != nil {
			return storageError(ctx)
		}
	}
	if allowed {
		count, readErr := q.CountLiveRecoveryRequests(ctx, e.recoveryIndex("custody", ""))
		if readErr != nil {
			return storageError(ctx)
		}
		if count < 1024 {
			err = q.InsertRecoveryRequest(ctx, authdb.InsertRecoveryRequestParams{ID: pgtype.UUID{Bytes: id, Valid: true},
				RecipientKey: e.recoveryIndex("coalesce:"+string(realm), email), Realm: string(realm), CustodyID: e.recoveryIndex("custody", ""), RecipientEnc: encrypted})
			if err != nil {
				return storageError(ctx)
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return storageError(ctx)
	}
	return nil
}

// ProcessOne commits a one-way claim BEFORE any issuance or external write.
// No retries/rescue: crash, cancellation or unknown send is terminal. An expired
// claim is scrubbed by maintenance, never returned to pending.
func (s *LocalRecovery) ProcessOne(ctx context.Context) (bool, error) {
	e := s.engine
	q := authdb.New(e.sessions.pool)
	job, err := q.ClaimRecoveryRequest(ctx, e.recoveryIndex("custody", ""))
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, storageError(ctx)
	}
	// Finishing is bounded separately: cancellation may have followed a send.
	// Failure to scrub immediately leaves a claimed (never retried) row.
	defer func() {
		clean, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		_ = q.FinishRecoveryRequest(clean, job.ID)
	}()
	realm := Realm(job.Realm)
	email, err := openSecret(e.secrets, uuid.UUID(job.ID.Bytes), recoveryPurpose(realm), job.RecipientEnc)
	if err != nil {
		return true, ErrUnavailable
	}
	if !disposableRecoveryRecipient(email) {
		return true, nil
	}
	owner, err := q.LoginOwner(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return true, storageError(ctx)
	}
	notice, err := e.issuePasswordReset(ctx, uuid.UUID(owner.Bytes), realm, resetExpectation{Email: email, RequestedAt: job.CreatedAt.Time})
	if errors.Is(err, ErrResetToken) {
		return true, nil
	}
	if err != nil {
		return true, err
	}
	// Refuse a concurrently changed recipient rather than mailing someone other
	// than the requesting owner. Issued but unsent proof simply expires.
	if !strings.EqualFold(notice.To, email) || !disposableRecoveryRecipient(notice.To) {
		return true, nil
	}
	if err = s.mailer.Send(ctx, notice); err != nil {
		return true, ErrMailDelivery
	}
	return true, nil
}
func (s *LocalRecovery) Ping(ctx context.Context) error {
	_, err := authdb.New(s.engine.sessions.pool).CountLiveRecoveryRequests(ctx, s.engine.recoveryIndex("custody", ""))
	if err != nil {
		return storageError(ctx)
	}
	return nil
}

func (e *Engine) pruneRecoveryQueue(ctx context.Context) error {
	q := authdb.New(e.sessions.pool)
	if err := q.ExpireRecoveryRequests(ctx); err != nil {
		return storageError(ctx)
	}
	if err := q.PruneRecoveryRequests(ctx); err != nil {
		return storageError(ctx)
	}
	if err := q.PruneRecoveryLimits(ctx); err != nil {
		return storageError(ctx)
	}
	return nil
}
