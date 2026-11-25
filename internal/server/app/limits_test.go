package app

import (
	"context"
	"errors"
	"testing"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/db/control"
	"github.com/jackc/pgx/v5/pgtype"
)

func basePlan() control.TenantPlanRow {
	return control.TenantPlanRow{SyncIntervalSeconds: 180, HistoryMonths: 12,
		MaxStores: pgtype.Int4{Int32: 3, Valid: true}, MaxUsers: pgtype.Int4{Int32: 20, Valid: true},
		Modules: []string{"core", "realtime"}, Overrides: []byte("{}")}
}

func TestEffectiveLimitsRequiresPrincipalBeforeDatabase(t *testing.T) {
	if _, err := EffectiveLimits(context.Background(), nil); !errors.Is(err, auth.ErrForbidden) {
		t.Fatalf("unauthenticated policy lookup: %v", err)
	}
}

func TestCalculateLimits(t *testing.T) {
	for _, tc := range []struct {
		name, overrides string
		stores          int
		finite          bool
		sync, history   int
		modules         []string
	}{
		{"base", "{}", 3, true, 180, 12, []string{"core", "realtime"}},
		{"replace", `{"sync_interval_seconds":3600,"history_months":24,"max_stores":8,"max_users":50,"modules":["pulse","core","pulse"]}`, 8, true, 3600, 24, []string{"core", "pulse"}},
		{"unlimited", `{"max_stores":null,"max_users":null}`, 0, false, 180, 12, []string{"core", "realtime"}},
		{"empty_modules", `{"modules":[]}`, 3, true, 180, 12, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := basePlan()
			row.Overrides = []byte(tc.overrides)
			limits, err := calculateLimits(row)
			if err != nil {
				t.Fatal(err)
			}
			stores, finite := limits.MaxStores()
			if stores != tc.stores || finite != tc.finite || limits.SyncIntervalSeconds() != tc.sync || limits.HistoryMonths() != tc.history {
				t.Fatalf("unexpected scalar limits: %+v", limits)
			}
			got := limits.Modules()
			if len(got) != len(tc.modules) {
				t.Fatalf("modules: %v", got)
			}
			for i, module := range tc.modules {
				if got[i] != module {
					t.Fatalf("modules: %v", got)
				}
			}
			if len(got) > 0 {
				got[0] = "untrusted"
				if limits.Modules()[0] == "untrusted" {
					t.Fatal("mutable module snapshot")
				}
			}
			if len(row.Modules) > 0 && row.Modules[0] != "core" {
				t.Fatal("mutated plan input")
			}
		})
	}
}

func TestLimitsRejectInvalidOverrides(t *testing.T) {
	for _, raw := range []string{
		"null", "[]", "false", `{"unknown":1}`, `{"max_user":4}`,
		`{"max_users":0}`, `{"max_stores":-1}`, `{"max_stores":1.5}`, `{"max_users":"4"}`,
		`{"max_users":2147483648}`, `{"history_months":null}`, `{"sync_interval_seconds":0}`,
		`{"modules":null}`, `{"modules":"core"}`, `{"modules":["admin"]}`, `{"modules":[null]}`,
	} {
		t.Run(raw, func(t *testing.T) {
			row := basePlan()
			row.Overrides = []byte(raw)
			if _, err := calculateLimits(row); !errors.Is(err, ErrInvalidPlan) {
				t.Fatalf("expected invalid plan, got %v", err)
			}
		})
	}
	row := basePlan()
	row.SyncIntervalSeconds = 0
	if _, err := calculateLimits(row); !errors.Is(err, ErrInvalidPlan) {
		t.Fatal("accepted invalid base")
	}
	row = basePlan()
	row.MaxUsers = pgtype.Int4{Int32: -1, Valid: true}
	if _, err := calculateLimits(row); !errors.Is(err, ErrInvalidPlan) {
		t.Fatal("accepted invalid base quota")
	}
	row = basePlan()
	row.Overrides = make([]byte, 8193)
	if _, err := calculateLimits(row); !errors.Is(err, ErrInvalidPlan) {
		t.Fatal("accepted oversized override")
	}
}

func TestRequireModuleFailsClosed(t *testing.T) {
	limits, err := calculateLimits(basePlan())
	if err != nil {
		t.Fatal(err)
	}
	if err := limits.RequireModule("realtime"); err != nil {
		t.Fatal(err)
	}
	for _, module := range []string{"export", "pulse", "admin", ""} {
		if !errors.Is(limits.RequireModule(module), ErrModuleNotInPlan) {
			t.Fatalf("allowed %q", module)
		}
	}
	var zero Limits
	if !errors.Is(zero.RequireModule("core"), ErrModuleNotInPlan) {
		t.Fatal("zero limits granted access")
	}
}
