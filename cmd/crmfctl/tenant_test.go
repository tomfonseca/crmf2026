package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
)

func TestTenantCLIInputAndRedaction(t *testing.T) {
	id, plan := uuid.New(), uuid.New()
	args := []string{"tenant", "provision", "--slug", "synthetic_network", "--legal-name", "Synthetic fixture", "--cnpj", "SYNTHETIC00000", "--plan-id", plan.String()}
	var out bytes.Buffer
	called := false
	c := cli{out: &out, lookup: func(string) string { return "do-not-print-connection" },
		provision: func(ctx context.Context, _ func(string) string, in tenancy.ProvisionInput) (tenancy.ProvisionResult, error) {
			called = true
			if _, ok := ctx.Deadline(); !ok || in.PlanID != plan || in.Slug != "synthetic_network" {
				t.Error("incorrect isolated invocation")
			}
			return tenancy.ProvisionResult{ID: id, SchemaVersion: 1}, nil
		}}
	if err := c.run(context.Background(), args); err != nil || !called || !strings.Contains(out.String(), id.String()) || strings.Contains(out.String(), "do-not-print") {
		t.Fatal("unsafe command")
	}
	for _, cause := range []error{tenancy.ErrBusy, tenancy.ErrInvalid, tenancy.ErrConflict, tenancy.ErrCredentialMissing, errors.New("do-not-print-connection")} {
		c.provision = func(context.Context, func(string) string, tenancy.ProvisionInput) (tenancy.ProvisionResult, error) {
			return tenancy.ProvisionResult{}, cause
		}
		if err := c.run(context.Background(), args); err == nil || strings.Contains(err.Error(), "do-not-print") {
			t.Fatal("unsafe error")
		}
	}
	called = false
	c.provision = func(context.Context, func(string) string, tenancy.ProvisionInput) (tenancy.ProvisionResult, error) {
		called = true
		return tenancy.ProvisionResult{}, nil
	}
	bad := append(append([]string{}, args...), "--password=do-not-print")
	if err := c.run(context.Background(), bad); err == nil || called || strings.Contains(err.Error(), "do-not-print") {
		t.Fatal("secret flag accepted or echoed")
	}
}
func TestTenantCLIRequiresExplicitCustody(t *testing.T) {
	for _, values := range []map[string]string{
		{}, {"TENANT_CREDENTIALS_DIR": t.TempDir(), "APP_ENV": "production"},
		{"TENANT_CREDENTIALS_DIR": t.TempDir(), "TENANT_KEYVAULT_URL": "https://example.vault.azure.net"},
	} {
		if _, err := provisionTenant(context.Background(), func(k string) string { return values[k] }, tenancy.ProvisionInput{}); err == nil {
			t.Fatal("ambiguous or production-file custody accepted")
		}
	}
}
