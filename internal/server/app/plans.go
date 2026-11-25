package app

import (
	"context"
	"errors"
	"regexp"
	"slices"
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
	ErrCatalogUnavailable = errors.New("plan catalog unavailable")
	ErrPlanConflict       = errors.New("plan changed or code already exists")
	ErrPlanNotFound       = errors.New("plan not found")
	ErrPlanInUse          = errors.New("plan has subscriptions")
)

type PlanDetails struct {
	Name                               string
	PriceCents                         int32
	Active                             bool
	SyncIntervalSeconds, HistoryMonths int32
	MaxStores, MaxUsers                *int32
	Modules                            []string
}
type Plan struct {
	ID      uuid.UUID
	Code    string
	Version int32
	PlanDetails
}
type PlanPage struct {
	Items      []Plan
	NextCursor string
}

// PlanCatalog uses the existing restricted control pool, never identity SQL or
// migration credentials. Every method requires a server-authenticated principal.
type PlanCatalog struct{ pool *pgxpool.Pool }

func NewPlanCatalog(ctx context.Context, pool *pgxpool.Pool) (*PlanCatalog, error) {
	if pool == nil {
		return nil, ErrCatalogUnavailable
	}
	var allowed bool
	err := pool.QueryRow(ctx, "SELECT current_user='crmf_core' AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit) FROM pg_roles WHERE rolname=current_user").Scan(&allowed)
	if err != nil || !allowed {
		return nil, ErrCatalogUnavailable
	}
	return &PlanCatalog{pool: pool}, nil
}
func RequirePlatform(ctx context.Context, write bool) error {
	principal, ok := auth.Principal(ctx)
	if !ok || principal.Realm() != auth.Platform || principal.UserID() == uuid.Nil {
		return auth.ErrForbidden
	}
	for _, grant := range principal.Grants() {
		if grant.Role == "platform_admin" || (!write && grant.Role == "platform_support") {
			return nil
		}
	}
	return auth.ErrForbidden
}
func validPlanCode(code string) bool {
	return regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`).MatchString(code)
}
func validatePlanDetails(d PlanDetails) error {
	if !utf8.ValidString(d.Name) || strings.TrimSpace(d.Name) != d.Name || utf8.RuneCountInString(d.Name) < 1 || utf8.RuneCountInString(d.Name) > 120 ||
		strings.ContainsFunc(d.Name, unicode.IsControl) || d.PriceCents < 0 || d.SyncIntervalSeconds < 1 || d.HistoryMonths < 1 ||
		(d.MaxStores != nil && *d.MaxStores < 1) || (d.MaxUsers != nil && *d.MaxUsers < 1) || d.Modules == nil || len(d.Modules) > 4 {
		return ErrInvalidPlan
	}
	seen := map[string]bool{}
	for _, module := range d.Modules {
		if !knownModule(module) || seen[module] {
			return ErrInvalidPlan
		}
		seen[module] = true
	}
	return nil
}
func (c *PlanCatalog) List(ctx context.Context, after string) (PlanPage, error) {
	if err := RequirePlatform(ctx, false); err != nil {
		return PlanPage{}, err
	}
	if after != "" && !validPlanCode(after) {
		return PlanPage{}, ErrInvalidPlan
	}
	rows, err := control.New(c.pool).CatalogPlans(ctx, after)
	if err != nil {
		return PlanPage{}, catalogError(ctx, err)
	}
	result := PlanPage{Items: make([]Plan, 0, min(len(rows), 100))}
	for _, row := range rows[:min(len(rows), 100)] {
		result.Items = append(result.Items, catalogPlan(row))
	}
	if len(rows) > 100 {
		result.NextCursor = result.Items[len(result.Items)-1].Code
	}
	return result, nil
}
func (c *PlanCatalog) Create(ctx context.Context, code string, details PlanDetails) (Plan, error) {
	if err := RequirePlatform(ctx, true); err != nil {
		return Plan{}, err
	}
	if !validPlanCode(code) {
		return Plan{}, ErrInvalidPlan
	}
	if err := validatePlanDetails(details); err != nil {
		return Plan{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return Plan{}, ErrCatalogUnavailable
	}
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return Plan{}, catalogError(ctx, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	row, err := q.InsertCatalogPlan(ctx, control.InsertCatalogPlanParams{ID: planUUID(id), Code: code, Name: details.Name, PriceCents: details.PriceCents, Active: details.Active, SyncIntervalSeconds: details.SyncIntervalSeconds, HistoryMonths: details.HistoryMonths, MaxStores: planQuota(details.MaxStores), MaxUsers: planQuota(details.MaxUsers), Modules: slices.Clone(details.Modules)})
	if err != nil {
		return Plan{}, catalogError(ctx, err)
	}
	if err := catalogAudit(ctx, q, row, "hq.plan_created"); err != nil {
		return Plan{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Plan{}, catalogError(ctx, err)
	}
	return catalogPlan(row), nil
}
func (c *PlanCatalog) Update(ctx context.Context, id uuid.UUID, version int32, details PlanDetails) (Plan, error) {
	if err := RequirePlatform(ctx, true); err != nil {
		return Plan{}, err
	}
	if version < 1 || id == uuid.Nil {
		return Plan{}, ErrInvalidPlan
	}
	if err := validatePlanDetails(details); err != nil {
		return Plan{}, err
	}
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return Plan{}, catalogError(ctx, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	existing, err := q.LockCatalogPlan(ctx, planUUID(id))
	if err != nil {
		return Plan{}, catalogError(ctx, err)
	}
	if existing.Version != version {
		return Plan{}, ErrPlanConflict
	}
	row, err := q.UpdateCatalogPlan(ctx, control.UpdateCatalogPlanParams{ID: planUUID(id), Version: version, Name: details.Name, PriceCents: details.PriceCents, Active: details.Active, SyncIntervalSeconds: details.SyncIntervalSeconds, HistoryMonths: details.HistoryMonths, MaxStores: planQuota(details.MaxStores), MaxUsers: planQuota(details.MaxUsers), Modules: slices.Clone(details.Modules)})
	if err != nil {
		return Plan{}, catalogError(ctx, err)
	}
	if err := catalogAudit(ctx, q, row, "hq.plan_updated"); err != nil {
		return Plan{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Plan{}, catalogError(ctx, err)
	}
	return catalogPlan(row), nil
}
func (c *PlanCatalog) Delete(ctx context.Context, id uuid.UUID, version int32, confirmation string) error {
	if err := RequirePlatform(ctx, true); err != nil {
		return err
	}
	if version < 1 || id == uuid.Nil {
		return ErrInvalidPlan
	}
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return catalogError(ctx, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	row, err := q.LockCatalogPlan(ctx, planUUID(id))
	if err != nil {
		return catalogError(ctx, err)
	}
	if row.Version != version {
		return ErrPlanConflict
	}
	if confirmation != row.Code {
		return ErrInvalidPlan
	}
	if err := q.DeleteCatalogPlan(ctx, row.ID); err != nil {
		return catalogError(ctx, err)
	}
	if err := catalogAudit(ctx, q, row, "hq.plan_deleted"); err != nil {
		return err
	}
	return catalogError(ctx, tx.Commit(ctx))
}
func catalogAudit(ctx context.Context, q *control.Queries, row control.CorePlan, action string) error {
	principal, _ := auth.Principal(ctx)
	return catalogError(ctx, q.AuditCatalogPlan(ctx, control.AuditCatalogPlanParams{ActorUserID: planUUID(principal.UserID()), Action: action, Target: pgtype.Text{String: uuid.UUID(row.ID.Bytes).String(), Valid: true}, Version: row.Version}))
}
func catalogPlan(row control.CorePlan) Plan {
	modules := slices.Clone(row.Modules)
	if modules == nil {
		modules = []string{}
	}
	slices.Sort(modules)
	return Plan{ID: uuid.UUID(row.ID.Bytes), Code: row.Code, Version: row.Version, PlanDetails: PlanDetails{Name: row.Name, PriceCents: row.PriceCents, Active: row.Active, SyncIntervalSeconds: row.SyncIntervalSeconds, HistoryMonths: row.HistoryMonths, MaxStores: quotaPointer(row.MaxStores), MaxUsers: quotaPointer(row.MaxUsers), Modules: modules}}
}
func planUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
func planQuota(value *int32) pgtype.Int4 {
	if value == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *value, Valid: true}
}
func quotaPointer(value pgtype.Int4) *int32 {
	if !value.Valid {
		return nil
	}
	copy := value.Int32
	return &copy
}
func catalogError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPlanNotFound
	}
	var database *pgconn.PgError
	if errors.As(err, &database) {
		switch database.Code {
		case "23505":
			return ErrPlanConflict
		case "23503":
			return ErrPlanInUse
		}
	}
	return ErrCatalogUnavailable
}
