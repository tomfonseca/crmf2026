package app

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/google/uuid"
	"strings"
	"testing"
)

func TestCatalogRejectsWithoutPrincipalBeforeDatabase(t *testing.T) {
	catalog := &PlanCatalog{}
	ctx := context.Background()
	if _, err := catalog.List(ctx, ""); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal(err)
	}
	if _, err := catalog.Create(ctx, "test", PlanDetails{}); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal(err)
	}
	if _, err := catalog.Update(ctx, uuid.New(), 1, PlanDetails{}); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal(err)
	}
	if err := catalog.Delete(ctx, uuid.New(), 1, "test"); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal(err)
	}
}
func TestPlanValidation(t *testing.T) {
	valid := func() PlanDetails {
		return PlanDetails{Name: "Plano sintético", PriceCents: 1000, Active: true, SyncIntervalSeconds: 180, HistoryMonths: 12, Modules: []string{"core"}}
	}
	if err := validatePlanDetails(valid()); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*PlanDetails){
		func(d *PlanDetails) { d.Name = "" }, func(d *PlanDetails) { d.Name = " nome" }, func(d *PlanDetails) { d.Name = "nome\n" },
		func(d *PlanDetails) { d.Name = strings.Repeat("界", 121) }, func(d *PlanDetails) { d.PriceCents = -1 },
		func(d *PlanDetails) { d.SyncIntervalSeconds = 0 }, func(d *PlanDetails) { d.HistoryMonths = 0 },
		func(d *PlanDetails) { v := int32(0); d.MaxUsers = &v }, func(d *PlanDetails) { v := int32(-1); d.MaxStores = &v },
		func(d *PlanDetails) { d.Modules = nil }, func(d *PlanDetails) { d.Modules = []string{"unknown"} },
		func(d *PlanDetails) { d.Modules = []string{"core", "core"} },
	} {
		d := valid()
		change(&d)
		if !errors.Is(validatePlanDetails(d), ErrInvalidPlan) {
			t.Fatal("invalid policy accepted")
		}
	}
	d := valid()
	d.Modules = []string{}
	d.PriceCents = 0
	if err := validatePlanDetails(d); err != nil {
		t.Fatal("explicit zero-price/empty modules rejected")
	}
	for _, code := range []string{"", "UPPER", " x", "x/y", strings.Repeat("x", 65)} {
		if validPlanCode(code) {
			t.Fatal("invalid code accepted")
		}
	}
}
