// Package app implements authenticated application policy, not identity SQL.
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"slices"
	"sort"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/db/control"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrInvalidPlan     = errors.New("invalid plan configuration")
	ErrModuleNotInPlan = errors.New("module not in plan")
	ErrPlanUnavailable = errors.New("plan temporarily unavailable")
)

// Limits is a detached snapshot; a false quota flag means unlimited, never zero.
// Reload within each request. It is not a reservation for concurrent creation.
type Limits struct {
	syncInterval, historyMonths int
	maxStores, maxUsers         pgtype.Int4
	modules                     []string
}

func (l Limits) SyncIntervalSeconds() int { return l.syncInterval }
func (l Limits) HistoryMonths() int       { return l.historyMonths }
func (l Limits) MaxStores() (int, bool)   { return int(l.maxStores.Int32), l.maxStores.Valid }
func (l Limits) MaxUsers() (int, bool)    { return int(l.maxUsers.Int32), l.maxUsers.Valid }
func (l Limits) Modules() []string        { return slices.Clone(l.modules) }
func (l Limits) RequireModule(module string) error {
	if !knownModule(module) || !slices.Contains(l.modules, module) {
		return ErrModuleNotInPlan
	}
	return nil
}

// EffectiveLimits resolves only the tenant from auth.Principal(ctx). It accepts
// neither tenant IDs nor schema names from HTTP. The caller supplies its existing
// restricted control connection; the function never opens a privileged pool.
func EffectiveLimits(ctx context.Context, db control.DBTX) (Limits, error) {
	scope, ok := auth.Principal(ctx)
	if !ok || scope.Realm() != auth.Tenant || scope.TenantID() == uuid.Nil {
		return Limits{}, auth.ErrForbidden
	}
	if err := ctx.Err(); err != nil {
		return Limits{}, err
	}
	if db == nil {
		return Limits{}, ErrPlanUnavailable
	}
	row, err := control.New(db).TenantPlan(ctx, pgtype.UUID{Bytes: scope.TenantID(), Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return Limits{}, auth.ErrSuspended
	}
	if err != nil {
		if err := ctx.Err(); err != nil {
			return Limits{}, err
		}
		return Limits{}, ErrPlanUnavailable
	}
	if row.TenantStatus != "active" && row.TenantStatus != "trial" {
		return Limits{}, auth.ErrSuspended
	}
	switch row.SubscriptionStatus {
	case "active", "trialing", "past_due":
	default:
		return Limits{}, auth.ErrSuspended
	}
	return calculateLimits(row)
}

func calculateLimits(row control.TenantPlanRow) (Limits, error) {
	limits := Limits{syncInterval: int(row.SyncIntervalSeconds), historyMonths: int(row.HistoryMonths),
		maxStores: row.MaxStores, maxUsers: row.MaxUsers, modules: slices.Clone(row.Modules)}
	if len(row.Overrides) > 8192 {
		return Limits{}, ErrInvalidPlan
	}
	var overrides map[string]json.RawMessage
	if err := json.Unmarshal(row.Overrides, &overrides); err != nil || overrides == nil {
		return Limits{}, ErrInvalidPlan
	}
	for key, value := range overrides {
		switch key {
		case "sync_interval_seconds":
			if err := positiveInteger(value, &limits.syncInterval); err != nil {
				return Limits{}, err
			}
		case "history_months":
			if err := positiveInteger(value, &limits.historyMonths); err != nil {
				return Limits{}, err
			}
		case "max_stores", "max_users":
			quota := pgtype.Int4{}
			if !bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				var number int
				if err := positiveInteger(value, &number); err != nil {
					return Limits{}, err
				}
				quota = pgtype.Int4{Int32: int32(number), Valid: true}
			}
			if key == "max_stores" {
				limits.maxStores = quota
			} else {
				limits.maxUsers = quota
			}
		case "modules":
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return Limits{}, ErrInvalidPlan
			}
			var modules []string
			if err := json.Unmarshal(value, &modules); err != nil {
				return Limits{}, ErrInvalidPlan
			}
			limits.modules = modules
		default:
			// Reject typos/unknown policy instead of silently granting base limits.
			return Limits{}, ErrInvalidPlan
		}
	}
	if limits.syncInterval <= 0 || limits.historyMonths <= 0 ||
		(limits.maxStores.Valid && limits.maxStores.Int32 <= 0) ||
		(limits.maxUsers.Valid && limits.maxUsers.Int32 <= 0) {
		return Limits{}, ErrInvalidPlan
	}
	for _, module := range limits.modules {
		if !knownModule(module) {
			return Limits{}, ErrInvalidPlan
		}
	}
	sort.Strings(limits.modules)
	limits.modules = slices.Compact(limits.modules)
	return limits, nil
}

func positiveInteger(raw []byte, out *int) error {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return ErrInvalidPlan
	}
	if err := json.Unmarshal(raw, out); err != nil || *out <= 0 || *out > math.MaxInt32 {
		return ErrInvalidPlan
	}
	return nil
}

func knownModule(module string) bool {
	switch module {
	case "core", "realtime", "export", "pulse":
		return true
	}
	return false
}
