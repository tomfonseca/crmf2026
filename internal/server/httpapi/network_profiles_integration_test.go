//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/google/uuid"
	"strings"
	"testing"
)

func TestHQNetworkProfilePersistenceRevisionAndAuthorization(t *testing.T) {
	f := newHTTPFixture(t, false)
	ctx := context.Background()
	slug := "np_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	var id, plan uuid.UUID
	t.Cleanup(func() {
		if id != uuid.Nil {
			for _, q := range []string{"DELETE FROM jobs.river_job WHERE id IN(SELECT job_id FROM core.network_requests WHERE tenant_id=$1)", "DELETE FROM core.network_requests WHERE tenant_id=$1", "DELETE FROM core.tenant_provisioning WHERE tenant_id=$1", "DELETE FROM core.subscriptions WHERE tenant_id=$1", "DELETE FROM core.tenants WHERE id=$1"} {
				if _, e := f.admin.Exec(ctx, q, id); e != nil {
					t.Error("cleanup", e)
				}
			}
		}
		if plan != uuid.Nil {
			_, e := f.admin.Exec(ctx, "DELETE FROM core.plans WHERE id=$1", plan)
			if e != nil {
				t.Error(e)
			}
		}
	})
	device := catalogPlatform(t, f, "platform_admin", nil)
	res, raw := f.request(t, "POST", "/v1/hq/plans", planPayload(slug), true)
	if res.StatusCode != 201 {
		t.Fatal("plan")
	}
	var p appcontract.Plan
	if json.Unmarshal(raw, &p) != nil {
		t.Fatal("plan JSON")
	}
	plan = p.Id
	profile := appcontract.NetworkProfileInput{DisplayName: "Rede sintética", RegisteredName: "Razão social sintética", City: "Cidade sintética", Uf: "SP", ContactName: "Contato sintético", ContactEmail: "contact@example.invalid", DefaultTimezone: "America/Sao_Paulo", BillingCustomerId: "reference-only"}
	body := map[string]any{"slug": slug, "legal_name": "Nome original", "cnpj": strings.ToUpper(slug[3:15]) + "00", "plan_id": plan, "profile": profile}
	res, raw = f.request(t, "POST", "/v1/hq/tenants", body, true)
	if res.StatusCode != 202 {
		t.Fatalf("create profile %d %s", res.StatusCode, raw)
	}
	var n appcontract.Network
	if json.Unmarshal(raw, &n) != nil {
		t.Fatal("network JSON")
	}
	id = n.Id
	if n.Profile == nil || n.Profile.Version != 1 || n.Profile.Data != profile {
		t.Fatal("profile not atomic")
	}
	res, raw = f.request(t, "POST", "/v1/hq/tenants", body, true)
	var duplicate appcontract.Network
	_ = json.Unmarshal(raw, &duplicate)
	if res.StatusCode != 202 || duplicate.Id != id || duplicate.Generation != 1 {
		t.Fatal("duplicate reservation")
	}
	var requests int
	if f.admin.QueryRow(ctx, "SELECT count(*) FROM core.network_requests WHERE tenant_id=$1", id).Scan(&requests) != nil || requests != 1 {
		t.Fatal("duplicate job")
	}
	path := "/v1/hq/tenants/" + id.String() + "/profile"
	profile.DisplayName = "Nome de apresentação atualizado"
	profile.City = "Outra cidade sintética"
	update := appcontract.NetworkProfile{Data: profile, Version: 1}
	if res, _ = f.request(t, "PUT", path, update, false); res.StatusCode != 403 {
		t.Fatal("CSRF bypass")
	}
	res, raw = f.request(t, "PUT", path, update, true)
	if res.StatusCode != 200 {
		t.Fatalf("update %d %s", res.StatusCode, raw)
	}
	var saved appcontract.NetworkProfile
	if json.Unmarshal(raw, &saved) != nil || saved.Version != 2 || saved.Data != profile {
		t.Fatal("profile not saved")
	}
	if res, _ = f.request(t, "PUT", path, update, true); res.StatusCode != 409 {
		t.Fatal("lost update accepted")
	}
	var original string
	if f.admin.QueryRow(ctx, "SELECT legal_name FROM core.tenants WHERE id=$1", id).Scan(&original) != nil || original != "Nome original" {
		t.Fatal("provisioning identity changed")
	}
	var matched int
	if f.admin.QueryRow(ctx, `SELECT count(*) FROM core.network_requests r JOIN core.tenants t ON t.id=r.tenant_id WHERE r.tenant_id=$1 AND t.slug=r.slug AND t.legal_name=r.legal_name AND t.cnpj=r.cnpj`, id).Scan(&matched) != nil || matched != 1 {
		t.Fatal("work identity invalidated")
	}
	res, raw = f.request(t, "GET", "/v1/hq/tenants?after="+slug[:len(slug)-1], nil, false)
	if res.StatusCode != 200 {
		t.Fatal("list")
	}
	var page struct {
		Items []appcontract.Network `json:"items"`
	}
	if json.Unmarshal(raw, &page) != nil {
		t.Fatal("list JSON")
	}
	found := false
	for _, item := range page.Items {
		if item.Id == id {
			found = true
			if item.Profile == nil || item.Profile.Data != profile || item.Profile.Version != 2 {
				t.Fatal("list dropped profile")
			}
		}
	}
	if !found {
		t.Fatal("profile not listed")
	}
	var audit int
	if f.admin.QueryRow(ctx, `SELECT count(*) FROM core.audit_log WHERE tenant_id=$1 AND actor_user_id=$2 AND action='hq.tenant_profile_saved' AND NOT(detail::text LIKE '%example.invalid%')`, id, f.user).Scan(&audit) != nil || audit != 2 {
		t.Fatal("atomic actor audit")
	}
	catalogPlatform(t, f, "platform_support", device)
	if res, _ = f.request(t, "PUT", path, saved, true); res.StatusCode != 403 {
		t.Fatal("support profile write")
	}
	if res, _ = f.request(t, "GET", "/v1/hq/companies/00000000000191", nil, false); res.StatusCode != 403 {
		t.Fatal("support upstream lookup")
	}
	if _, e := f.admin.Exec(ctx, "DELETE FROM auth.user_grants WHERE user_id=$1", f.user); e != nil {
		t.Fatal(e)
	}
	if res, _ = f.request(t, "PUT", path, saved, true); res.StatusCode != 401 {
		t.Fatal("revoked identity accepted")
	}
}
