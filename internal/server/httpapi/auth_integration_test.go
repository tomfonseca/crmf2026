//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/crmf/crmf/internal/server/migrate"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

type httpFixture struct {
	admin               *pgx.Conn
	server              *httptest.Server
	client              *http.Client
	user, tenant, store uuid.UUID
	ip                  netip.Addr
}

func newHTTPFixture(t *testing.T, required bool) *httpFixture {
	t.Helper()
	ctx := context.Background()
	adminURL := "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_control?sslmode=disable"
	if err := migrate.Up(ctx, adminURL, "control"); err != nil {
		t.Fatal(err)
	}
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatal("connect synthetic admin")
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	f := &httpFixture{admin: admin, user: uuid.Must(uuid.NewV7()), tenant: uuid.Must(uuid.NewV7()), store: uuid.Must(uuid.NewV7())}
	raw := [16]byte(f.user)
	raw[0] = 0xfd
	f.ip = netip.AddrFrom16(raw)
	t.Cleanup(func() {
		for _, query := range []string{"DELETE FROM auth.users WHERE id=$1", "DELETE FROM core.stores WHERE id=$1", "DELETE FROM core.tenants WHERE id=$1"} {
			id := f.user
			if strings.Contains(query, "core.stores") {
				id = f.store
			}
			if strings.Contains(query, "core.tenants") {
				id = f.tenant
			}
			if _, err := admin.Exec(context.Background(), query, id); err != nil {
				t.Error("clean synthetic HTTP identity")
			}
		}
		if _, err := admin.Exec(context.Background(), "DELETE FROM auth.ip_attempts WHERE ip=$1", f.ip); err != nil {
			t.Error("clean synthetic HTTP attempts")
		}
	})
	slug := "fixture_" + strings.ReplaceAll(f.tenant.String(), "-", "")
	if _, err := admin.Exec(ctx, "INSERT INTO core.tenants(id,slug,legal_name,cnpj,status,schema_name,db_role,require_mfa) VALUES($1,$2,'Synthetic HTTP tenant',$3,'active',$4,$5,$6)", f.tenant, slug, "synthetic-"+f.tenant.String(), "t_"+slug, "r_"+slug, required); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "INSERT INTO core.stores(id,tenant_id,code,name,status) VALUES($1,$2,'fixture','Synthetic HTTP store','active')", f.store, f.tenant); err != nil {
		t.Fatal(err)
	}
	passwords, err := auth.NewPasswords()
	if err != nil {
		t.Fatal(err)
	}
	hash, err := passwords.Hash(ctx, "A unique synthetic HTTP passphrase! 2026")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "INSERT INTO auth.users(id,email,name,status,password_hash) VALUES($1,$2,'Synthetic HTTP user','active',$3)", f.user, f.user.String()+"@example.invalid", hash); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "INSERT INTO auth.user_grants(id,user_id,role,tenant_id,store_id,seller_code) VALUES($1,$2,'employee',$3,$4,'fixture')", uuid.Must(uuid.NewV7()), f.user, f.tenant, f.store); err != nil {
		t.Fatal(err)
	}
	sessions, err := auth.Open(ctx, "postgres://crmf_auth:crmf_local_auth_only@localhost:55432/crmf_control?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sessions.Close)
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal("generate test-only key")
	}
	engine, err := auth.NewEngine(ctx, sessions, key)
	clear(key)
	if err != nil {
		t.Fatal(err)
	}
	router, err := NewAuthenticated(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), AuthOptions{Backend: engine, Development: true, TenantOrigin: "http://localhost:5174", PlatformOrigin: "http://localhost:5173", TrustedProxies: []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}})
	if err != nil {
		t.Fatal(err)
	}
	f.server = httptest.NewTLSServer(router)
	t.Cleanup(f.server.Close)
	f.client = f.server.Client()
	f.client.Jar, err = cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func (f *httpFixture) request(t *testing.T, method, path string, body any, csrf bool) (*http.Response, []byte) {
	t.Helper()
	var buffer bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buffer).Encode(body); err != nil {
			t.Fatal("encode synthetic HTTP body")
		}
	}
	request, err := http.NewRequest(method, f.server.URL+path, &buffer)
	if err != nil {
		t.Fatal(err)
	}
	origin := "http://localhost:5174"
	if strings.HasPrefix(path, "/v1/hq") {
		origin = "http://localhost:5173"
	}
	request.Header.Set("Origin", origin)
	request.Header.Set("X-Forwarded-For", f.ip.String())
	if csrf {
		request.Header.Set("X-CRMF-Request", "1")
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := f.client.Do(request)
	if err != nil {
		t.Fatal("synthetic HTTPS request failed")
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal("read synthetic response")
	}
	return response, data
}
func (f *httpFixture) login(t *testing.T) appcontract.AuthOutcome {
	t.Helper()
	response, data := f.request(t, "POST", "/v1/auth/login", map[string]string{"email": f.user.String() + "@example.invalid", "password": "A unique synthetic HTTP passphrase! 2026"}, true)
	if response.StatusCode != 200 {
		t.Fatal("HTTP login failed")
	}
	var outcome appcontract.AuthOutcome
	if err := json.Unmarshal(data, &outcome); err != nil {
		t.Fatal("decode outcome")
	}
	if bytes.Contains(data, []byte("token")) {
		t.Fatal("opaque token exposed in JSON")
	}
	return outcome
}
func TestHTTPSLoginIdentityAndLogout(t *testing.T) {
	f := newHTTPFixture(t, false)
	if response, _ := f.request(t, "GET", "/v1/me", nil, false); response.StatusCode != 401 {
		t.Fatal("anonymous identity exposed")
	}
	if outcome := f.login(t); outcome.Status != appcontract.Authenticated {
		t.Fatal("unexpected challenge")
	}
	response, data := f.request(t, "GET", "/v1/me", nil, false)
	var identity appcontract.Identity
	if err := json.Unmarshal(data, &identity); err != nil || response.StatusCode != 200 || identity.UserId != f.user || identity.TenantId == nil || *identity.TenantId != f.tenant || len(identity.StoreIds) != 1 || identity.StoreIds[0] != f.store {
		t.Fatal("wrong authenticated identity")
	}
	if response, _ := f.request(t, "GET", "/v1/hq/me", nil, false); response.StatusCode != 401 {
		t.Fatal("tenant session crossed realm")
	}
	if response, _ := f.request(t, "POST", "/v1/auth/logout", nil, false); response.StatusCode != 403 {
		t.Fatal("logout bypassed CSRF")
	}
	if response, _ := f.request(t, "POST", "/v1/auth/logout", nil, true); response.StatusCode != 204 {
		t.Fatal("logout failed")
	}
	if response, _ := f.request(t, "GET", "/v1/me", nil, false); response.StatusCode != 401 {
		t.Fatal("logout did not revoke")
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), "SELECT count(*) FROM core.audit_log WHERE actor_user_id=$1 AND action='auth.logout'", f.user).Scan(&count); err != nil || count != 1 {
		t.Fatal("logout not audited exactly once")
	}
}
func TestHTTPSRequiredMFA(t *testing.T) {
	f := newHTTPFixture(t, true)
	pending := f.login(t)
	if pending.Status != appcontract.EnrollmentRequired || pending.EnrollmentUri == nil {
		t.Fatal("required MFA did not enroll")
	}
	if response, _ := f.request(t, "GET", "/v1/me", nil, false); response.StatusCode != 401 {
		t.Fatal("MFA challenge granted identity")
	}
	key, err := otp.NewKeyFromURL(*pending.EnrollmentUri)
	if err != nil {
		t.Fatal("invalid synthetic MFA URI")
	}
	code, err := totp.GenerateCode(key.Secret(), time.Now())
	if err != nil {
		t.Fatal("generate synthetic code")
	}
	response, data := f.request(t, "POST", "/v1/auth/mfa", map[string]string{"code": code}, true)
	var completed appcontract.AuthOutcome
	if err := json.Unmarshal(data, &completed); err != nil || response.StatusCode != 200 || completed.Status != appcontract.Authenticated || completed.RecoveryCodes == nil || len(*completed.RecoveryCodes) != 10 {
		t.Fatal("HTTP MFA did not finish")
	}
	if response, _ := f.request(t, "GET", "/v1/me", nil, false); response.StatusCode != 200 {
		t.Fatal("MFA session missing")
	}
	if response, _ := f.request(t, "POST", "/v1/auth/mfa", map[string]string{"code": code}, true); response.StatusCode != 401 {
		t.Fatal("MFA replay accepted")
	}
}
