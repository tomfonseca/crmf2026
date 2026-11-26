//go:build integration

package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestHQStoresRealProvisioningQuotaRevisionAndIsolation(t *testing.T) {
	f := newHTTPFixture(t, false)
	ctx := context.Background()
	var plan, deviceID uuid.UUID
	var tenants []appcontract.Network
	var stores []uuid.UUID
	t.Cleanup(func() {
		a, e := pgx.Connect(ctx, networkAnalytics)
		if e != nil {
			t.Error(e)
			return
		}
		defer func() { _ = a.Close(ctx) }()
		if deviceID != uuid.Nil {
			if _, e = f.admin.Exec(ctx, "DELETE FROM core.devices WHERE id=$1", deviceID); e != nil {
				t.Error(e)
			}
		}
		for _, id := range stores {
			if _, e = f.admin.Exec(ctx, "DELETE FROM core.stores WHERE id=$1", id); e != nil {
				t.Error("store cleanup", e)
			}
		}
		for _, n := range tenants {
			if _, e = a.Exec(ctx, "DROP SCHEMA IF EXISTS "+pgx.Identifier{"t_" + n.Slug}.Sanitize()+" CASCADE"); e != nil {
				t.Error(e)
			}
			_, _ = a.Exec(ctx, "REVOKE ALL ON DATABASE crmf_analytics FROM "+pgx.Identifier{"r_" + n.Slug}.Sanitize())
			if _, e = a.Exec(ctx, "DROP ROLE IF EXISTS "+pgx.Identifier{"r_" + n.Slug}.Sanitize()); e != nil {
				t.Error(e)
			}
			for _, q := range []string{"DELETE FROM jobs.river_job WHERE id IN(SELECT job_id FROM core.network_requests WHERE tenant_id=$1)", "DELETE FROM core.network_requests WHERE tenant_id=$1", "DELETE FROM core.tenant_provisioning WHERE tenant_id=$1", "DELETE FROM core.subscriptions WHERE tenant_id=$1", "DELETE FROM core.tenants WHERE id=$1"} {
				if _, e = f.admin.Exec(ctx, q, n.Id); e != nil {
					t.Error(e)
				}
			}
		}
		if plan != uuid.Nil {
			if _, e = f.admin.Exec(ctx, "DELETE FROM core.plans WHERE id=$1", plan); e != nil {
				t.Error(e)
			}
		}
	})
	if res, _ := f.request(t, "GET", "/v1/hq/stores", nil, false); res.StatusCode != 401 {
		t.Fatal("anonymous store list")
	}
	device := catalogPlatform(t, f, "platform_admin", nil)
	planBody := planPayload("sc_" + strings.ReplaceAll(uuid.NewString(), "-", ""))
	planBody["max_stores"] = 1
	res, raw := f.request(t, "POST", "/v1/hq/plans", planBody, true)
	if res.StatusCode != 201 {
		t.Fatal("plan")
	}
	var pl appcontract.Plan
	if json.Unmarshal(raw, &pl) != nil {
		t.Fatal("plan response")
	}
	plan = pl.Id
	credentials, e := tenancy.NewDevelopmentFiles(filepath.Join(t.TempDir(), "private-credentials"), true)
	if e != nil {
		t.Fatal(e)
	}
	provisioner, e := tenancy.OpenProvisioner(ctx, networkControl, networkAnalytics, credentials)
	if e != nil {
		t.Fatal(e)
	}
	defer provisioner.Close()
	createNetwork := func() appcontract.Network {
		t.Helper()
		slug := "sc_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		response, bytes := f.request(t, "POST", "/v1/hq/tenants", map[string]any{"slug": slug, "legal_name": "Synthetic store network", "cnpj": strings.ToUpper(slug[3:15]) + "00", "plan_id": plan}, true)
		if response.StatusCode != 202 {
			t.Fatalf("network %d %s", response.StatusCode, bytes)
		}
		var n appcontract.Network
		if json.Unmarshal(bytes, &n) != nil {
			t.Fatal("network response")
		}
		tenants = append(tenants, n)
		return n
	}
	body := func(tenant uuid.UUID, code string) map[string]any {
		return map[string]any{"tenant_id": tenant, "code": code, "name": "Loja sintética", "city": "Cidade sintética", "uf": "SP", "timezone": "America/Sao_Paulo", "erp": "linx_big", "status": "active"}
	}
	n := createNetwork()
	if res, _ = f.request(t, "POST", "/v1/hq/stores", body(n.Id, "A"), true); res.StatusCode != 409 {
		t.Fatal("unprepared network store")
	}
	prepare := func(n appcontract.Network) {
		t.Helper()
		var job int64
		if f.admin.QueryRow(ctx, "SELECT job_id FROM core.network_requests WHERE tenant_id=$1 AND generation=1", n.Id).Scan(&job) != nil {
			t.Fatal("job lookup")
		}
		if e := provisioner.ProvisionQueued(ctx, n.Id, 1, job); e != nil {
			t.Fatal("real provisioning", e)
		}
	}
	prepare(n)
	if res, _ = f.request(t, "POST", "/v1/hq/stores", body(n.Id, "A"), false); res.StatusCode != 403 {
		t.Fatal("CSRF bypass")
	}
	bad := body(n.Id, "A")
	bad["actor_user_id"] = uuid.New()
	if res, _ = f.request(t, "POST", "/v1/hq/stores", bad, true); res.StatusCode != 400 {
		t.Fatal("actor injection")
	}
	type result struct {
		status int
		raw    []byte
	}
	results := make(chan result, 4)
	var wg sync.WaitGroup
	for _, code := range []string{"A", "B", "C", "D"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, b := f.request(t, "POST", "/v1/hq/stores", body(n.Id, code), true)
			results <- result{r.StatusCode, b}
		}()
	}
	wg.Wait()
	close(results)
	var first appcontract.HQStore
	created, limited := 0, 0
	for r := range results {
		switch r.status {
		case 201:
			var s appcontract.HQStore
			if json.Unmarshal(r.raw, &s) != nil {
				t.Error("store JSON")
				continue
			}
			stores = append(stores, s.Id)
			first = s
			created++
		case 409:
			var p appcontract.Problem
			if json.Unmarshal(r.raw, &p) != nil || p.Type != "plan_limit" {
				t.Errorf("wrong 409 %s", r.raw)
			}
			limited++
		default:
			t.Errorf("unexpected create %d %s", r.status, r.raw)
		}
	}
	if created != 1 || limited != 3 || t.Failed() {
		t.Errorf("quota winners=%d limited=%d", created, limited)
		return
	}
	path := "/v1/hq/stores/" + first.Id.String()
	res, raw = f.request(t, "GET", path, nil, false)
	if res.StatusCode != 200 {
		t.Fatal("get")
	}
	var loaded appcontract.HQStore
	if json.Unmarshal(raw, &loaded) != nil || loaded != first || loaded.Version != 1 {
		t.Fatal("round trip")
	}
	update := map[string]any{"code": first.Code, "name": "Loja sintética editada", "city": "Cidade editada", "uf": "RJ", "timezone": "America/Manaus", "erp": "linx_big", "status": "inactive", "version": 1}
	res, raw = f.request(t, "PUT", path, update, true)
	if res.StatusCode != 200 {
		t.Fatalf("update %d %s", res.StatusCode, raw)
	}
	var updated appcontract.HQStore
	if json.Unmarshal(raw, &updated) != nil || updated.Version != 2 || string(updated.Status) != "inactive" || updated.Timezone != "America/Manaus" {
		t.Fatal("update round trip")
	}
	if res, _ = f.request(t, "PUT", path, update, true); res.StatusCode != 409 {
		t.Fatal("lost revision accepted")
	}
	update["version"] = 2
	update["tenant_id"] = uuid.New()
	if res, _ = f.request(t, "PUT", path, update, true); res.StatusCode != 400 {
		t.Fatal("network move accepted")
	}
	delete(update, "tenant_id")
	if res, _ = f.request(t, "POST", "/v1/hq/stores", body(n.Id, "E"), true); res.StatusCode != 409 {
		t.Fatal("inactive store bypassed quota")
	}
	if _, e = f.admin.Exec(ctx, `UPDATE core.subscriptions SET overrides='{"max_stores":2}' WHERE tenant_id=$1`, n.Id); e != nil {
		t.Fatal(e)
	}
	if res, _ = f.request(t, "POST", "/v1/hq/stores", body(n.Id, first.Code), true); res.StatusCode != 409 {
		t.Fatal("duplicate code accepted")
	}
	res, raw = f.request(t, "POST", "/v1/hq/stores", body(n.Id, "E"), true)
	if res.StatusCode != 201 {
		t.Fatalf("override quota %d %s", res.StatusCode, raw)
	}
	var second appcontract.HQStore
	if json.Unmarshal(raw, &second) != nil {
		t.Fatal("second JSON")
	}
	stores = append(stores, second.Id)
	other := createNetwork()
	prepare(other)
	res, raw = f.request(t, "POST", "/v1/hq/stores", body(other.Id, first.Code), true)
	if res.StatusCode != 201 {
		t.Fatal("cross-network code incorrectly conflicts")
	}
	var cross appcontract.HQStore
	if json.Unmarshal(raw, &cross) != nil {
		t.Fatal("cross JSON")
	}
	stores = append(stores, cross.Id)
	res, raw = f.request(t, "GET", "/v1/hq/stores?tenant_id="+n.Id.String(), nil, false)
	if res.StatusCode != 200 {
		t.Fatal("filtered list")
	}
	var page struct {
		Items []appcontract.HQStore `json:"items"`
	}
	if json.Unmarshal(raw, &page) != nil || len(page.Items) != 2 {
		t.Fatal("filtered count")
	}
	for _, s := range page.Items {
		if s.TenantId != n.Id {
			t.Fatal("filter leaked another network")
		}
	}
	for _, query := range []string{"?tenant_id=" + n.Id.String() + "&tenant_id=" + other.Id.String(), "?schema=t_example", "?after=invalid"} {
		if res, _ = f.request(t, "GET", "/v1/hq/stores"+query, nil, false); res.StatusCode != 400 {
			t.Fatal("bad filter accepted")
		}
	}
	// A historical (revoked) device freezes the ERP code too; no actual pairing is simulated.
	public, _, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	deviceID = uuid.New()
	if _, e = f.admin.Exec(ctx, "INSERT INTO core.devices(id,tenant_id,store_id,public_key,status,paired_at,revoked_at) VALUES($1,$2,$3,$4,'revoked',now(),now())", deviceID, n.Id, first.Id, []byte(public)); e != nil {
		t.Fatal(e)
	}
	update["code"] = "CHANGED"
	res, raw = f.request(t, "PUT", path, update, true)
	if res.StatusCode != 409 || !strings.Contains(string(raw), "store_identity_in_use") {
		t.Fatal("paired ERP identity changed")
	}
	update["code"] = first.Code
	var audit int
	if f.admin.QueryRow(ctx, `SELECT count(*) FROM core.audit_log WHERE tenant_id=$1 AND actor_user_id=$2 AND action IN('hq.store_created','hq.store_updated')`, n.Id, f.user).Scan(&audit) != nil || audit != 3 {
		t.Fatal("atomic store audit")
	}
	catalogPlatform(t, f, "platform_support", device)
	if res, _ = f.request(t, "GET", path, nil, false); res.StatusCode != 200 {
		t.Fatal("support cannot read")
	}
	if res, _ = f.request(t, "POST", "/v1/hq/stores", body(n.Id, "F"), true); res.StatusCode != 403 {
		t.Fatal("support create")
	}
	if res, _ = f.request(t, "PUT", path, update, true); res.StatusCode != 403 {
		t.Fatal("support update")
	}
}
