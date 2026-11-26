package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/db/control"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"time"
)

var ErrPairingConflict = errors.New("pairing changed")
var ErrPairingRate = errors.New("pairing issuance limited")

type Pairing struct {
	ID, StoreID uuid.UUID
	ExpiresAt   time.Time
	Status      string
}
type IssuedPairing struct {
	Current Pairing
	Code    string
}

func pairingRow(r control.LatestHQPairingRow) Pairing {
	return Pairing{uuid.UUID(r.ID.Bytes), uuid.UUID(r.StoreID.Bytes), r.ExpiresAt.Time, r.Status}
}

// 8 uniform independent base32 symbols, 40 bits. No modulo bias (256 divisible by 32).
// Future unauthenticated redemption MUST add distributed online attempt limits.
func newPairingCode() (string, error) {
	var b [8]byte
	if _, e := rand.Read(b[:]); e != nil {
		return "", e
	}
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for i := range b {
		b[i] = alphabet[b[i]&31]
	}
	return string(b[:]), nil
}
func (s *StoreCatalog) Pairing(ctx context.Context, id uuid.UUID) (*Pairing, error) {
	if e := RequirePlatform(ctx, false); e != nil {
		return nil, e
	}
	if _, e := s.Get(ctx, id); e != nil {
		return nil, e
	}
	r, e := control.New(s.pool).LatestHQPairing(ctx, planUUID(id))
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, ErrStoreUnavailable
	}
	p := pairingRow(r)
	return &p, nil
}
func (s *StoreCatalog) IssuePairing(ctx context.Context, id uuid.UUID, version int32, previous uuid.UUID) (IssuedPairing, error) {
	if e := RequirePlatform(ctx, true); e != nil {
		return IssuedPairing{}, e
	}
	if id == uuid.Nil || version < 1 {
		return IssuedPairing{}, ErrStoreInvalid
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	actor, _ := auth.Principal(ctx)
	if _, e = q.ReservePairingIssuer(ctx, planUUID(actor.UserID())); errors.Is(e, pgx.ErrNoRows) {
		return IssuedPairing{}, ErrPairingRate
	} else if e != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	original, e := q.HQStore(ctx, planUUID(id))
	if errors.Is(e, pgx.ErrNoRows) {
		return IssuedPairing{}, ErrStoreNotFound
	}
	if e != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	if _, e = lockStorePolicy(ctx, tx, uuid.UUID(original.TenantID.Bytes)); e != nil {
		return IssuedPairing{}, e
	}
	original, e = q.HQStore(ctx, planUUID(id))
	if e != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	if original.Version != version {
		return IssuedPairing{}, ErrPairingConflict
	}
	if original.Status != "active" {
		return IssuedPairing{}, ErrStoreNetworkUnavailable
	}
	latest, e := q.LatestHQPairing(ctx, planUUID(id))
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	if (errors.Is(e, pgx.ErrNoRows) && previous != uuid.Nil) || (e == nil && uuid.UUID(latest.ID.Bytes) != previous) {
		return IssuedPairing{}, ErrPairingConflict
	}
	recent, e := q.RecentStorePairing(ctx, planUUID(id))
	if e != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	if recent {
		return IssuedPairing{}, ErrPairingRate
	}
	code, e := newPairingCode()
	if e != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	digest := sha256.Sum256([]byte(code))
	key, e := uuid.NewV7()
	if e != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	if q.RevokeStorePairings(ctx, planUUID(id)) != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	if q.InsertHQPairing(ctx, control.InsertHQPairingParams{ID: planUUID(key), CodeHash: digest[:], StoreID: planUUID(id), StoreVersion: pgtype.Int4{Int32: version, Valid: true}}) != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	p, e := q.LatestHQPairing(ctx, planUUID(id))
	if e != nil || uuid.UUID(p.ID.Bytes) != key {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	if e = auditPairing(ctx, q, uuid.UUID(original.TenantID.Bytes), id, key, "hq.pairing_issued"); e != nil {
		return IssuedPairing{}, e
	}
	if tx.Commit(ctx) != nil {
		return IssuedPairing{}, ErrStoreUnavailable
	}
	return IssuedPairing{pairingRow(p), code}, nil
}
func auditPairing(ctx context.Context, q *control.Queries, tenant, store, key uuid.UUID, action string) error {
	actor, _ := auth.Principal(ctx)
	if q.AuditHQPairing(ctx, control.AuditHQPairingParams{ActorUserID: planUUID(actor.UserID()), TenantID: planUUID(tenant), Action: action, Target: pgtype.Text{String: store.String(), Valid: true}, PairingID: planUUID(key)}) != nil {
		return ErrStoreUnavailable
	}
	return nil
}
func (s *StoreCatalog) RevokePairing(ctx context.Context, store, id uuid.UUID) error {
	if e := RequirePlatform(ctx, true); e != nil {
		return e
	}
	if store == uuid.Nil || id == uuid.Nil {
		return ErrStoreInvalid
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return ErrStoreUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	original, e := q.HQStore(ctx, planUUID(store))
	if errors.Is(e, pgx.ErrNoRows) {
		return ErrStoreNotFound
	}
	if e != nil {
		return ErrStoreUnavailable
	}
	if _, e = q.LockPairingTenant(ctx, original.TenantID); e != nil {
		return ErrStoreUnavailable
	}
	rows, e := q.RevokeHQPairing(ctx, control.RevokeHQPairingParams{StoreID: planUUID(store), ID: planUUID(id)})
	if e != nil {
		return ErrStoreUnavailable
	}
	if rows != 1 {
		return ErrPairingConflict
	}
	if e = auditPairing(ctx, q, uuid.UUID(original.TenantID.Bytes), store, id, "hq.pairing_revoked"); e != nil {
		return e
	}
	if tx.Commit(ctx) != nil {
		return ErrStoreUnavailable
	}
	return nil
}
