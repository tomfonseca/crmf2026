//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/crmf/crmf/internal/testpasskey"
	"github.com/google/uuid"
)

func catalogPlatform(t *testing.T, f *httpFixture, role string, device *testpasskey.Authenticator) *testpasskey.Authenticator {
	t.Helper()
	ctx := context.Background()
	if _, err := f.admin.Exec(ctx, "DELETE FROM auth.user_grants WHERE user_id=$1", f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.Exec(ctx, "INSERT INTO auth.user_grants(id,user_id,role) VALUES($1,$2,$3)", uuid.Must(uuid.NewV7()), f.user, role); err != nil {
		t.Fatal(err)
	}
	pending, err := f.engine.Login(ctx, f.user.String()+"@example.invalid", "A unique synthetic HTTP passphrase! 2026", auth.Platform, f.ip)
	if err != nil {
		t.Fatal(err)
	}
	var proof string
	if pending.Enrollment {
		device = testpasskey.New(t)
		proof = device.Register(t, pending.PasskeyOptions, "http://localhost:5173")
	} else {
		proof = device.Authenticate(t, pending.PasskeyOptions, "http://localhost:5173")
	}
	complete, err := f.engine.CompletePasskey(ctx, pending.ChallengeToken, proof, auth.Platform, f.ip)
	if err != nil {
		t.Fatal(err)
	}
	target, _ := url.Parse(f.server.URL)
	f.client.Jar.SetCookies(target, []*http.Cookie{{Name: cookieName(auth.Platform, false), Value: complete.SessionToken, Path: "/", Secure: true, HttpOnly: true}})
	return device
}
func planPayload(code string) map[string]any {
	return map[string]any{"code": code, "name": "Plano sintético", "active": true, "price_cents": 1000, "sync_interval_seconds": 180, "history_months": 12, "max_stores": nil, "max_users": 10, "modules": []string{"core", "realtime"}}
}
func TestHQPlanCatalogPersistenceGuardsAndAudit(t *testing.T) {
	f := newHTTPFixture(t, false)
	ctx := context.Background()
	code := "test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	t.Cleanup(func() {
		_, _ = f.admin.Exec(ctx, "DELETE FROM core.subscriptions WHERE tenant_id=$1", f.tenant)
		_, _ = f.admin.Exec(ctx, "DELETE FROM core.plans WHERE code=$1", code)
	})
	if response, _ := f.request(t, "GET", "/v1/hq/plans", nil, false); response.StatusCode != 401 {
		t.Fatal("anonymous catalog access")
	}
	if result := f.login(t); result.Status != appcontract.Authenticated {
		t.Fatal("tenant fixture login")
	}
	if response, _ := f.request(t, "GET", "/v1/hq/plans", nil, false); response.StatusCode != 401 {
		t.Fatal("tenant cookie used in QG")
	}
	device := catalogPlatform(t, f, "platform_admin", nil)
	body := planPayload(code)
	if response, _ := f.request(t, "POST", "/v1/hq/plans", body, false); response.StatusCode != 403 {
		t.Fatal("catalog bypassed CSRF")
	}
	if response, _ := f.request(t, "POST", "/v1/hq/plans", map[string]any{"code": code}, true); response.StatusCode != 400 {
		t.Fatal("omitted fields accepted")
	}
	body["tenant_id"] = f.tenant
	if response, _ := f.request(t, "POST", "/v1/hq/plans", body, true); response.StatusCode != 400 {
		t.Fatal("unknown tenant selector accepted")
	}
	delete(body, "tenant_id")
	for _, field := range []string{"name", "active", "modules", "price_cents"} {
		saved := body[field]
		body[field] = nil
		if response, _ := f.request(t, "POST", "/v1/hq/plans", body, true); response.StatusCode != 400 {
			t.Fatal("null required field accepted", field)
		}
		body[field] = saved
	}
	response, data := f.request(t, "POST", "/v1/hq/plans", body, true)
	var plan appcontract.Plan
	if err := json.Unmarshal(data, &plan); err != nil || response.StatusCode != 201 || plan.Code != code || plan.Version != 1 || plan.MaxStores != nil {
		t.Fatal("create failed", response.StatusCode)
	}
	if response, _ := f.request(t, "POST", "/v1/hq/plans", body, true); response.StatusCode != 409 {
		t.Fatal("duplicate accepted")
	}
	if response, _ := f.request(t, "GET", "/v1/hq/plans?tenant_id="+f.tenant.String(), nil, false); response.StatusCode != 400 {
		t.Fatal("unknown filter accepted")
	}
	path := "/v1/hq/plans/" + plan.Id.String()
	delete(body, "code")
	body["version"] = 1
	body["name"] = "Plano revisado"
	body["active"] = false
	if response, _ := f.request(t, "PUT", path, body, false); response.StatusCode != 403 {
		t.Fatal("PUT bypassed CSRF")
	}
	response, data = f.request(t, "PUT", path, body, true)
	if err := json.Unmarshal(data, &plan); err != nil || response.StatusCode != 200 || plan.Version != 2 || plan.Active {
		t.Fatal("update failed")
	}
	if response, _ := f.request(t, "PUT", path, body, true); response.StatusCode != 409 {
		t.Fatal("stale update accepted")
	}
	if _, err := f.admin.Exec(ctx, "INSERT INTO core.subscriptions(id,tenant_id,plan_id,status) VALUES($1,$2,$3,'active')", uuid.Must(uuid.NewV7()), f.tenant, plan.Id); err != nil {
		t.Fatal(err)
	}
	if response, _ := f.request(t, "DELETE", path, map[string]any{"version": 2, "confirmation": code}, true); response.StatusCode != 409 {
		t.Fatal("subscribed plan deleted")
	}
	if _, err := f.admin.Exec(ctx, "DELETE FROM core.subscriptions WHERE tenant_id=$1", f.tenant); err != nil {
		t.Fatal(err)
	}
	device = catalogPlatform(t, f, "platform_support", device)
	if response, _ := f.request(t, "GET", "/v1/hq/plans", nil, false); response.StatusCode != 200 {
		t.Fatal("support cannot read")
	}
	if response, _ := f.request(t, "POST", "/v1/hq/plans", planPayload("other"), true); response.StatusCode != 403 {
		t.Fatal("support created plan")
	}
	if response, _ := f.request(t, "PUT", path, body, true); response.StatusCode != 403 {
		t.Fatal("support updated plan")
	}
	if response, _ := f.request(t, "DELETE", path, map[string]any{"version": 2, "confirmation": code}, true); response.StatusCode != 403 {
		t.Fatal("support deleted plan")
	}
	catalogPlatform(t, f, "platform_admin", device)
	if response, _ := f.request(t, "DELETE", path, map[string]any{"version": 2, "confirmation": code}, false); response.StatusCode != 403 {
		t.Fatal("DELETE bypassed CSRF")
	}
	if response, _ := f.request(t, "DELETE", path, map[string]any{"version": 2, "confirmation": "wrong"}, true); response.StatusCode != 400 {
		t.Fatal("confirmation ignored")
	}
	if response, _ := f.request(t, "DELETE", path, map[string]any{"version": 2, "confirmation": code}, true); response.StatusCode != 204 {
		t.Fatal("delete failed")
	}
	var count int
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM core.audit_log WHERE actor_user_id=$1 AND target=$2 AND action LIKE 'hq.plan_%'", f.user, plan.Id.String()).Scan(&count); err != nil || count != 3 {
		t.Fatal("mutation audit not atomic", count, err)
	}
	if response, _ := f.request(t, "DELETE", path, map[string]any{"version": 2, "confirmation": code}, true); response.StatusCode != 404 {
		t.Fatal("deleted plan still available")
	}
	if _, err := f.admin.Exec(ctx, "DELETE FROM auth.user_grants WHERE user_id=$1", f.user); err != nil {
		t.Fatal(err)
	}
	if response, _ := f.request(t, "GET", "/v1/hq/plans", nil, false); response.StatusCode != 401 {
		t.Fatal("revoked grant retained catalog access")
	}
}
func TestCatalogPaginationIsBoundedAndStable(t *testing.T) {
	f := newHTTPFixture(t, false)
	catalogPlatform(t, f, "platform_admin", nil)
	ctx := context.Background()
	prefix := "zz_fixture_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	t.Cleanup(func() {
		_, _ = f.admin.Exec(context.Background(), "DELETE FROM core.plans WHERE code LIKE $1", prefix+"%")
	})
	for i := range 101 {
		if _, err := f.admin.Exec(ctx, "INSERT INTO core.plans(id,code,name,price_cents,sync_interval_seconds,history_months) VALUES($1,$2,'Synthetic page plan',0,180,12)", uuid.Must(uuid.NewV7()), fmt.Sprintf("%s_%03d", prefix, i)); err != nil {
			t.Fatal(err)
		}
	}
	response, data := f.request(t, "GET", "/v1/hq/plans?after="+prefix, nil, false)
	var page struct {
		Items []appcontract.Plan `json:"items"`
		Next  string             `json:"next_cursor"`
	}
	if err := json.Unmarshal(data, &page); err != nil || response.StatusCode != 200 || len(page.Items) != 100 || page.Next != prefix+"_099" {
		t.Fatal("unbounded or unstable page")
	}
	response, data = f.request(t, "GET", "/v1/hq/plans?after="+page.Next, nil, false)
	if err := json.Unmarshal(data, &page); err != nil || response.StatusCode != 200 || len(page.Items) < 1 || page.Items[0].Code != prefix+"_100" {
		t.Fatal("cursor skipped a plan")
	}
}
func TestConcurrentCatalogEditsRejectLostUpdate(t *testing.T) {
	f := newHTTPFixture(t, false)
	catalogPlatform(t, f, "platform_admin", nil)
	code := "test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	t.Cleanup(func() { _, _ = f.admin.Exec(context.Background(), "DELETE FROM core.plans WHERE code=$1", code) })
	response, data := f.request(t, "POST", "/v1/hq/plans", planPayload(code), true)
	var plan appcontract.Plan
	if err := json.Unmarshal(data, &plan); err != nil || response.StatusCode != 201 {
		t.Fatal("create")
	}
	body := planPayload(code)
	delete(body, "code")
	body["version"] = 1
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			response, _ := f.request(t, "PUT", "/v1/hq/plans/"+plan.Id.String(), body, true)
			statuses <- response.StatusCode
		}()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal("lost update", counts)
	}
}
