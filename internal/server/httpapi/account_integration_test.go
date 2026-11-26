//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/crmf/crmf/internal/testpasskey"
	"github.com/google/uuid"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"
)

const oldAccountPassword = "A unique synthetic HTTP passphrase! 2026"
const newAccountPassword = "Changed disposable account passphrase! 2026"

func accountPage(t *testing.T, f *httpFixture) appcontract.SessionPage {
	t.Helper()
	r, b := f.request(t, "GET", "/v1/me/sessions", nil, false)
	if r.StatusCode != 200 {
		t.Fatalf("sessions status %d: %s", r.StatusCode, b)
	}
	var page appcontract.SessionPage
	if e := json.Unmarshal(b, &page); e != nil {
		t.Fatal(e)
	}
	for _, secret := range []string{"token", "password", "ip", "user_agent", "credential"} {
		if bytes.Contains(b, []byte(secret)) {
			t.Fatal("private data in sessions projection")
		}
	}
	return page
}
func TestAccountSessionsIsolationAndPassword(t *testing.T) {
	f := newHTTPFixture(t, false)
	f.login(t)
	first := accountPage(t, f)
	if len(first.Items) != 1 || !first.Items[0].Current {
		t.Fatal("wrong current session")
	}
	originalJar := f.client.Jar
	f.client.Jar, _ = cookiejar.New(nil)
	f.login(t)
	secondJar := f.client.Jar
	second := accountPage(t, f)
	if len(second.Items) != 2 {
		t.Fatal("second session missing")
	}
	other := newHTTPFixture(t, false)
	other.login(t)
	foreign := accountPage(t, other).Items[0].Id
	for _, path := range []string{"/v1/me/sessions?after=", "/v1/me/sessions?after=bad", "/v1/me/sessions?extra=1", "/v1/me/sessions?after=" + foreign.String() + "&after=" + foreign.String()} {
		if r, _ := f.request(t, "GET", path, nil, false); r.StatusCode != 400 {
			t.Fatal("invalid query accepted")
		}
	}
	if r, _ := f.request(t, "DELETE", "/v1/me/sessions", map[string]string{"session_id": foreign.String()}, true); r.StatusCode != 404 {
		t.Fatal("foreign session termination exposed")
	}
	if r, _ := f.request(t, "DELETE", "/v1/me/sessions", map[string]string{"session_id": first.Items[0].Id.String()}, false); r.StatusCode != 403 {
		t.Fatal("CSRF bypass")
	}
	if r, _ := f.request(t, "GET", "/v1/hq/me/sessions", nil, false); r.StatusCode != 401 {
		t.Fatal("realm boundary bypass")
	}
	for i := 0; i < 2; i++ {
		if r, b := f.request(t, "DELETE", "/v1/me/sessions", map[string]string{"session_id": first.Items[0].Id.String()}, true); r.StatusCode != 204 {
			t.Fatalf("revoke not idempotent %d: %s", r.StatusCode, b)
		}
	}
	f.client.Jar = originalJar
	if r, _ := f.request(t, "GET", "/v1/me", nil, false); r.StatusCode != 401 {
		t.Fatal("revoked session still valid")
	}
	f.client.Jar = secondJar
	current := accountPage(t, f).Items[0].Id
	for _, body := range []any{
		map[string]any{"current_password": oldAccountPassword, "new_password": nil},
		map[string]string{"current_password": oldAccountPassword, "new_password": newAccountPassword, "user_id": foreign.String()},
		map[string]string{"current_password": oldAccountPassword, "new_password": oldAccountPassword},
		map[string]string{"current_password": oldAccountPassword, "new_password": "short"},
		map[string]string{"current_password": "wrong disposable password", "new_password": newAccountPassword},
	} {
		if r, _ := f.request(t, "POST", "/v1/me/password", body, true); r.StatusCode != 400 {
			t.Fatalf("invalid password body accepted: %d", r.StatusCode)
		}
	}
	if r, _ := f.request(t, "GET", "/v1/me", nil, false); r.StatusCode != 200 {
		t.Fatal("wrong proof killed valid session")
	}
	if r, b := f.request(t, "POST", "/v1/me/password", map[string]string{"current_password": oldAccountPassword, "new_password": newAccountPassword}, true); r.StatusCode != 204 {
		t.Fatalf("change failed %d %s", r.StatusCode, b)
	}
	if r, _ := f.request(t, "GET", "/v1/me", nil, false); r.StatusCode != 401 {
		t.Fatal("password change kept current session")
	}
	var live int
	if e := f.admin.QueryRow(context.Background(), "SELECT count(*) FROM auth.user_sessions WHERE user_id=$1 AND revoked_at IS NULL", f.user).Scan(&live); e != nil || live != 0 {
		t.Fatal("password change left sessions")
	}
	if r, _ := other.request(t, "GET", "/v1/me", nil, false); r.StatusCode != 200 {
		t.Fatal("another account affected")
	}
	for _, p := range []struct {
		password string
		want     int
	}{{oldAccountPassword, 401}, {newAccountPassword, 200}} {
		if r, _ := f.request(t, "POST", "/v1/auth/login", map[string]string{"email": f.user.String() + "@example.invalid", "password": p.password}, true); r.StatusCode != p.want {
			t.Fatal("password proof not updated")
		}
	}
	page := accountPage(t, f)
	if len(page.Items) != 1 || page.Items[0].Id == current {
		t.Fatal("old session survived")
	}
	if r, _ := f.request(t, "DELETE", "/v1/me/sessions", map[string]string{"session_id": page.Items[0].Id.String()}, true); r.StatusCode != 204 {
		t.Fatal("own current revoke failed")
	}
	if r, _ := f.request(t, "GET", "/v1/me", nil, false); r.StatusCode != 401 {
		t.Fatal("self revoke not effective")
	}
	var changed, ended int
	if e := f.admin.QueryRow(context.Background(), "SELECT count(*) FILTER(WHERE action='auth.password_changed'),count(*) FILTER(WHERE action='auth.session_ended') FROM core.audit_log WHERE actor_user_id=$1", f.user).Scan(&changed, &ended); e != nil || changed != 1 || ended != 2 {
		t.Fatal("audit not atomic/idempotent")
	}
}
func TestPasswordChangePreservesPasskeyAndKillsChallenges(t *testing.T) {
	f := newHTTPFixture(t, true)
	pending := f.login(t)
	device := testpasskey.New(t)
	if r, _ := f.request(t, "POST", "/v1/auth/passkey", map[string]string{"response": device.Register(t, []byte(*pending.PublicKey), "http://localhost:5174")}, true); r.StatusCode != 200 {
		t.Fatal("disposable enrollment")
	}
	var before []byte
	var recovery int
	if e := f.admin.QueryRow(context.Background(), "SELECT credential_enc FROM auth.passkey_credentials WHERE user_id=$1", f.user).Scan(&before); e != nil {
		t.Fatal(e)
	}
	if e := f.admin.QueryRow(context.Background(), "SELECT count(*) FROM auth.mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL", f.user).Scan(&recovery); e != nil || recovery != 10 {
		t.Fatal("recovery fixture")
	}
	// Separate browser starts a real password-proven assertion while the first remains authenticated.
	mainJar := f.client.Jar
	f.client.Jar, _ = cookiejar.New(nil)
	challenge := f.login(t)
	challengeJar := f.client.Jar
	stale := device.Authenticate(t, []byte(*challenge.PublicKey), "http://localhost:5174")
	f.client.Jar = mainJar
	if r, b := f.request(t, "POST", "/v1/me/password", map[string]string{"current_password": oldAccountPassword, "new_password": newAccountPassword}, true); r.StatusCode != 204 {
		t.Fatalf("change: %d %s", r.StatusCode, b)
	}
	var after []byte
	var remaining int
	if e := f.admin.QueryRow(context.Background(), "SELECT credential_enc FROM auth.passkey_credentials WHERE user_id=$1", f.user).Scan(&after); e != nil || !bytes.Equal(before, after) {
		t.Fatal("existing credential rewritten")
	}
	if e := f.admin.QueryRow(context.Background(), "SELECT count(*) FROM auth.mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL", f.user).Scan(&remaining); e != nil || remaining != recovery {
		t.Fatal("recovery codes lost")
	}
	f.client.Jar = challengeJar
	if r, _ := f.request(t, "POST", "/v1/auth/passkey", map[string]string{"response": stale}, true); r.StatusCode != 401 {
		t.Fatal("stale challenge survived password change")
	}
	r, b := f.request(t, "POST", "/v1/auth/login", map[string]string{"email": f.user.String() + "@example.invalid", "password": newAccountPassword}, true)
	var outcome appcontract.AuthOutcome
	if json.Unmarshal(b, &outcome) != nil || r.StatusCode != 200 || outcome.Status != appcontract.PasskeyRequired {
		t.Fatal("password change bypassed existing MFA")
	}
	if r, b := f.request(t, "POST", "/v1/auth/passkey", map[string]string{"response": device.Authenticate(t, []byte(*outcome.PublicKey), "http://localhost:5174")}, true); r.StatusCode != 200 {
		t.Fatalf("original passkey unusable %d %s", r.StatusCode, b)
	}
}
func TestAccountConcurrentPasswordChanges(t *testing.T) {
	f := newHTTPFixture(t, false)
	f.login(t)
	u, _ := url.Parse(f.server.URL)
	token := ""
	for _, c := range f.client.Jar.Cookies(u) {
		if c.Name == cookieName(auth.Tenant, false) {
			token = c.Value
		}
	}
	if token == "" {
		t.Fatal("missing disposable session")
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			results <- f.engine.ChangePassword(context.Background(), token, oldAccountPassword, newAccountPassword, auth.Tenant, f.ip)
		}()
	}
	close(start)
	accepted, rejected := 0, 0
	for i := 0; i < 2; i++ {
		e := <-results
		if e == nil {
			accepted++
		} else if errors.Is(e, auth.ErrUnauthenticated) {
			rejected++
		} else {
			t.Fatal("unexpected concurrent change failure")
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatal("concurrent password overwrite admitted")
	}
	var count int
	if e := f.admin.QueryRow(context.Background(), "SELECT count(*) FROM core.audit_log WHERE actor_user_id=$1 AND action='auth.password_changed'", f.user).Scan(&count); e != nil || count != 1 {
		t.Fatal("concurrent change audit not singular")
	}
}
func TestAccountPlatformSupportOwnSecurity(t *testing.T) {
	f := newHTTPFixture(t, false)
	catalogPlatform(t, f, "platform_support", nil)
	r, b := f.request(t, "GET", "/v1/hq/me/sessions", nil, false)
	var page appcontract.SessionPage
	if r.StatusCode != 200 || json.Unmarshal(b, &page) != nil || len(page.Items) != 1 || !page.Items[0].Current || !page.Items[0].MfaVerified {
		t.Fatal("support cannot inspect own MFA session")
	}
	if r, _ := f.request(t, "GET", "/v1/me/sessions", nil, false); r.StatusCode != 401 {
		t.Fatal("platform cookie crossed tenant boundary")
	}
	if r, b := f.request(t, "POST", "/v1/hq/me/password", map[string]string{"current_password": oldAccountPassword, "new_password": newAccountPassword}, true); r.StatusCode != 204 {
		t.Fatalf("support own password: %d %s", r.StatusCode, b)
	}
}
func TestOwnSessionsBoundedPagination(t *testing.T) {
	f := newHTTPFixture(t, false)
	f.login(t)
	for i := 0; i < 102; i++ {
		id := uuid.Must(uuid.NewV7())
		hash := make([]byte, 32)
		copy(hash, id[:])
		hash[31] = byte(i)
		if _, e := f.admin.Exec(context.Background(), `INSERT INTO auth.user_sessions(id,user_id,token_hash,realm,mfa_verified,last_seen_at,idle_expires_at,expires_at)
 VALUES($1,$2,$3,'tenant',false,now(),now()+interval '1 hour',now()+interval '2 hours')`, id, f.user, hash); e != nil {
			t.Fatal(e)
		}
	}
	first := accountPage(t, f)
	if len(first.Items) != 100 || first.NextCursor == nil || *first.NextCursor != first.Items[99].Id {
		t.Fatal("unbounded/incomplete pagination")
	}
	r, b := f.request(t, "GET", "/v1/me/sessions?after="+first.NextCursor.String(), nil, false)
	var next appcontract.SessionPage
	if r.StatusCode != 200 || json.Unmarshal(b, &next) != nil || len(next.Items) != 3 || next.NextCursor != nil {
		t.Fatal("next page not bounded")
	}
	seen := map[uuid.UUID]bool{}
	current := 0
	for _, s := range append(first.Items, next.Items...) {
		if seen[s.Id] {
			t.Fatal("duplicate cursor row")
		}
		seen[s.Id] = true
		if s.Current {
			current++
		}
	}
	if current != 1 {
		t.Fatal("current session not identified across pages")
	}
}
func TestPasswordChangeLockoutAndStrictJSON(t *testing.T) {
	f := newHTTPFixture(t, false)
	f.login(t)
	for _, raw := range []string{
		`{"current_password":"x","current_password":"y","new_password":"z"}`,
		`{"session_id":null}`,
	} {
		path := "/v1/me/password"
		method := "POST"
		if strings.Contains(raw, "session_id") {
			path = "/v1/me/sessions"
			method = "DELETE"
		}
		req, _ := http.NewRequest(method, f.server.URL+path, strings.NewReader(raw))
		req.Header.Set("Origin", "http://localhost:5174")
		req.Header.Set("X-CRMF-Request", "1")
		req.Header.Set("Content-Type", "application/json")
		r, e := f.client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		_ = r.Body.Close()
		if r.StatusCode != 400 {
			t.Fatal("malformed/duplicate accepted")
		}
	}
	for i := 0; i < 5; i++ {
		r, _ := f.request(t, "POST", "/v1/me/password", map[string]string{"current_password": fmt.Sprintf("invalid-%d", i), "new_password": newAccountPassword}, true)
		if r.StatusCode != 400 {
			t.Fatalf("proof failure %d=%d", i, r.StatusCode)
		}
	}
	var until string
	if e := f.admin.QueryRow(context.Background(), "SELECT locked_until::text FROM auth.users WHERE id=$1", f.user).Scan(&until); e != nil || until == "" {
		t.Fatal("no persistent lock")
	}
	if r, _ := f.request(t, "POST", "/v1/me/password", map[string]string{"current_password": oldAccountPassword, "new_password": newAccountPassword}, true); r.StatusCode != 429 {
		t.Fatal("locked change allowed")
	}
	var unchanged string
	_ = f.admin.QueryRow(context.Background(), "SELECT locked_until::text FROM auth.users WHERE id=$1", f.user).Scan(&unchanged)
	if unchanged != until {
		t.Fatal("blocked attempt extended lock")
	}
	accountPage(t, f) // Lockout must not prevent terminating an already-valid session.
	// Wrong Origin preflights are denied; right realm admits only declared methods.
	for _, method := range []string{"GET", "DELETE", "PUT"} {
		req, _ := http.NewRequest("OPTIONS", f.server.URL+"/v1/me/sessions", nil)
		req.Header.Set("Origin", "http://localhost:5174")
		req.Header.Set("Access-Control-Request-Method", method)
		r, e := f.client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		_ = r.Body.Close()
		want := 204
		if method == "PUT" {
			want = 403
		}
		if r.StatusCode != want {
			t.Fatal("CORS method regression")
		}
	}
}
