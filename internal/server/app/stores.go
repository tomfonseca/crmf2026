package app

import (
	"context"
	"errors"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/db/control"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrStoreInvalid            = errors.New("invalid store")
	ErrStoreNotFound           = errors.New("store not found")
	ErrStoreConflict           = errors.New("store code or revision conflict")
	ErrStoreUnavailable        = errors.New("store unavailable")
	ErrStoreNetworkUnavailable = errors.New("store network unavailable")
	ErrPlanLimit               = errors.New("plan limit")
	ErrStoreIdentityInUse      = errors.New("store ERP identity in use")
)

type StoreFields struct{ Code, Name, City, UF, Timezone, ERP, Status string }
type Store struct {
	ID, TenantID             uuid.UUID
	Fields                   StoreFields
	NetworkName, NetworkSlug string
	Version                  int32
}
type StorePage struct {
	Items      []Store
	NextCursor uuid.UUID
}
type StoreCatalog struct{ pool *pgxpool.Pool }

func NewStoreCatalog(ctx context.Context, pool *pgxpool.Pool) (*StoreCatalog, error) {
	if pool == nil {
		return nil, ErrStoreUnavailable
	}
	var ok bool
	if pool.QueryRow(ctx, "SELECT current_user='crmf_core' AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls) FROM pg_roles WHERE rolname=current_user").Scan(&ok) != nil || !ok {
		return nil, ErrStoreUnavailable
	}
	return &StoreCatalog{pool: pool}, nil
}
func validStoreFields(f StoreFields) bool {
	for _, s := range []string{f.Code, f.Name, f.City} {
		if !utf8.ValidString(s) || utf8.RuneCountInString(s) > 200 || strings.TrimSpace(s) != s || strings.ContainsFunc(s, unicode.IsControl) {
			return false
		}
	}
	return f.Code != "" && utf8.RuneCountInString(f.Code) <= 64 && f.Name != "" && f.ERP == "linx_big" && (f.Status == "active" || f.Status == "inactive") && f.Timezone != "" && validProfile(NetworkProfile{City: f.City, UF: f.UF, DefaultTimezone: f.Timezone})
}
func storeRow(r control.HQStoreRow) Store {
	return Store{ID: uuid.UUID(r.ID.Bytes), TenantID: uuid.UUID(r.TenantID.Bytes), Fields: StoreFields{Code: r.Code, Name: r.Name, City: r.City, UF: r.Uf, Timezone: r.Timezone, ERP: r.Erp, Status: r.Status}, Version: r.Version, NetworkName: r.NetworkName, NetworkSlug: r.NetworkSlug}
}
func (s *StoreCatalog) List(ctx context.Context, after, tenantID uuid.UUID) (StorePage, error) {
	if e := RequirePlatform(ctx, false); e != nil {
		return StorePage{}, e
	}
	filter := pgtype.UUID{Bytes: tenantID, Valid: tenantID != uuid.Nil}
	rows, e := control.New(s.pool).ListHQStores(ctx, control.ListHQStoresParams{AfterID: planUUID(after), TenantID: filter})
	if e != nil {
		return StorePage{}, ErrStoreUnavailable
	}
	page := StorePage{Items: make([]Store, 0, min(100, len(rows)))}
	for _, r := range rows[:min(100, len(rows))] {
		page.Items = append(page.Items, storeRow(control.HQStoreRow(r)))
	}
	if len(rows) > 100 {
		page.NextCursor = page.Items[len(page.Items)-1].ID
	}
	return page, nil
}
func (s *StoreCatalog) Get(ctx context.Context, id uuid.UUID) (Store, error) {
	if e := RequirePlatform(ctx, false); e != nil {
		return Store{}, e
	}
	if id == uuid.Nil {
		return Store{}, ErrStoreInvalid
	}
	r, e := control.New(s.pool).HQStore(ctx, planUUID(id))
	if errors.Is(e, pgx.ErrNoRows) {
		return Store{}, ErrStoreNotFound
	}
	if e != nil {
		return Store{}, ErrStoreUnavailable
	}
	return storeRow(r), nil
}

// Order: tenant row -> subscription/plan shared locks -> store.
// Provision readiness is observed read-only; runtime never gains its UPDATE privilege.
// This serializes quota reservations and freezes the policy until commit.
func lockStorePolicy(ctx context.Context, tx pgx.Tx, id uuid.UUID) (Limits, error) {
	q := control.New(tx)
	r, e := q.LockStoreNetworkPolicy(ctx, planUUID(id))
	if errors.Is(e, pgx.ErrNoRows) {
		return Limits{}, ErrStoreNetworkUnavailable
	}
	if e != nil {
		return Limits{}, ErrStoreUnavailable
	}
	if (r.Status != "trial" && r.Status != "active") || r.ProvisionState != "ready" || r.SchemaVersion < 1 {
		return Limits{}, ErrStoreNetworkUnavailable
	}
	policy, e := q.TenantPlan(ctx, planUUID(id))
	if e != nil {
		return Limits{}, ErrStoreUnavailable
	}
	if policy.SubscriptionStatus != "trialing" && policy.SubscriptionStatus != "active" && policy.SubscriptionStatus != "past_due" {
		return Limits{}, ErrStoreNetworkUnavailable
	}
	limits, e := calculateLimits(policy)
	if e != nil {
		return Limits{}, ErrStoreUnavailable
	}
	return limits, nil
}
func (s *StoreCatalog) Create(ctx context.Context, tenantID uuid.UUID, f StoreFields) (Store, error) {
	if e := RequirePlatform(ctx, true); e != nil {
		return Store{}, e
	}
	if tenantID == uuid.Nil || !validStoreFields(f) {
		return Store{}, ErrStoreInvalid
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return Store{}, ErrStoreUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	limits, e := lockStorePolicy(ctx, tx, tenantID)
	if e != nil {
		return Store{}, e
	}
	q := control.New(tx)
	count, e := q.CountNetworkStores(ctx, planUUID(tenantID))
	if e != nil {
		return Store{}, ErrStoreUnavailable
	}
	if maximum, bounded := limits.MaxStores(); bounded && count >= int64(maximum) {
		return Store{}, ErrPlanLimit
	}
	id, e := uuid.NewV7()
	if e != nil {
		return Store{}, ErrStoreUnavailable
	}
	e = q.InsertHQStore(ctx, control.InsertHQStoreParams{ID: planUUID(id), TenantID: planUUID(tenantID), Code: f.Code, Name: f.Name, City: pgtype.Text{String: f.City, Valid: true}, Uf: pgtype.Text{String: f.UF, Valid: f.UF != ""}, Timezone: f.Timezone, Erp: f.ERP, Status: f.Status})
	if e != nil {
		return Store{}, storeError(e)
	}
	return finishStore(ctx, tx, q, id, "hq.store_created")
}
func (s *StoreCatalog) Update(ctx context.Context, id uuid.UUID, version int32, f StoreFields) (Store, error) {
	if e := RequirePlatform(ctx, true); e != nil {
		return Store{}, e
	}
	if id == uuid.Nil || version < 1 || version == math.MaxInt32 || !validStoreFields(f) {
		return Store{}, ErrStoreInvalid
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return Store{}, ErrStoreUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	original, e := q.HQStore(ctx, planUUID(id))
	if errors.Is(e, pgx.ErrNoRows) {
		return Store{}, ErrStoreNotFound
	}
	if e != nil {
		return Store{}, ErrStoreUnavailable
	}
	if _, e = lockStorePolicy(ctx, tx, uuid.UUID(original.TenantID.Bytes)); e != nil {
		return Store{}, e
	}
	original, e = q.HQStore(ctx, planUUID(id))
	if e != nil {
		return Store{}, ErrStoreUnavailable
	}
	if original.Version != version {
		return Store{}, ErrStoreConflict
	}
	if original.Code != f.Code {
		paired, err := q.StoreHasDevice(ctx, planUUID(id))
		if err != nil {
			return Store{}, ErrStoreUnavailable
		}
		if paired {
			return Store{}, ErrStoreIdentityInUse
		}
	}
	affected, e := q.UpdateHQStore(ctx, control.UpdateHQStoreParams{ID: planUUID(id), Code: f.Code, Name: f.Name, City: pgtype.Text{String: f.City, Valid: true}, Uf: pgtype.Text{String: f.UF, Valid: f.UF != ""}, Timezone: f.Timezone, Erp: f.ERP, Status: f.Status, Version: version})
	if e != nil {
		return Store{}, storeError(e)
	}
	if affected != 1 {
		return Store{}, ErrStoreConflict
	}
	return finishStore(ctx, tx, q, id, "hq.store_updated")
}
func finishStore(ctx context.Context, tx pgx.Tx, q *control.Queries, id uuid.UUID, action string) (Store, error) {
	row, e := q.HQStore(ctx, planUUID(id))
	if e != nil {
		return Store{}, ErrStoreUnavailable
	}
	principal, _ := auth.Principal(ctx)
	if q.AuditHQStore(ctx, control.AuditHQStoreParams{ActorUserID: planUUID(principal.UserID()), TenantID: row.TenantID, Action: action, Target: pgtype.Text{String: id.String(), Valid: true}, Version: row.Version}) != nil {
		return Store{}, ErrStoreUnavailable
	}
	if tx.Commit(ctx) != nil {
		return Store{}, ErrStoreUnavailable
	}
	return storeRow(row), nil
}
func storeError(e error) error {
	var pg *pgconn.PgError
	if errors.As(e, &pg) && pg.Code == "23505" {
		return ErrStoreConflict
	}
	return ErrStoreUnavailable
}
