package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/crmf/crmf/internal/server/auth"
)

type fakeAuth struct {
	calls  int
	err    error
	result auth.LoginResult
}

func (f *fakeAuth) Authenticate(context.Context, string, auth.Realm) (context.Context, error) {
	return nil, auth.ErrUnauthenticated
}
func (f *fakeAuth) Login(context.Context, string, string, auth.Realm, netip.Addr) (auth.LoginResult, error) {
	f.calls++
	return f.result, f.err
}
func (f *fakeAuth) CompletePasskey(context.Context, string, string, auth.Realm, netip.Addr) (auth.LoginResult, error) {
	f.calls++
	return f.result, f.err
}
func (f *fakeAuth) StartEnrollment(context.Context, string, string, auth.Realm, netip.Addr) (auth.LoginResult, error) {
	f.calls++
	return f.result, f.err
}
func (f *fakeAuth) Resolve(context.Context, string, auth.Realm) (auth.Scope, error) {
	return auth.Scope{}, auth.ErrUnauthenticated
}
func (f *fakeAuth) Revoke(context.Context, string, auth.Realm) error          { return nil }
func (f *fakeAuth) CancelChallenge(context.Context, string, auth.Realm) error { return nil }
func authTestRouter(t *testing.T, backend AuthBackend) http.Handler {
	t.Helper()
	router, err := NewAuthenticated(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), AuthOptions{Backend: backend, Development: true, TenantOrigin: "http://localhost:5174", PlatformOrigin: "http://localhost:5173"})
	if err != nil {
		t.Fatal(err)
	}
	return router
}
func TestHTTPAuthGuards(t *testing.T) {
	for _, tc := range []struct {
		origin, header, body, content string
		status                        int
	}{
		{"", "1", `{"email":"test","password":"test"}`, "application/json", 403},
		{"http://localhost:5173", "1", `{"email":"test","password":"test"}`, "application/json", 403},
		{"http://localhost:5174", "", `{"email":"test","password":"test"}`, "application/json", 403},
		{"http://localhost:5174", "1", `{"email":"test","password":"test"}`, "text/plain", 415},
		{"http://localhost:5174", "1", `{"email":"test","password":"test","tenant_id":"evil"}`, "application/json", 400},
		{"http://localhost:5174", "1", "null", "application/json", 400},
		{"http://localhost:5174", "1", strings.Repeat(" ", 8193) + "{}", "application/json", 400},
	} {
		backend := &fakeAuth{}
		r := httptest.NewRequest("POST", "https://api.test/v1/auth/login", strings.NewReader(tc.body))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-CRMF-Request", tc.header)
		r.Header.Set("Content-Type", tc.content)
		w := httptest.NewRecorder()
		authTestRouter(t, backend).ServeHTTP(w, r)
		if w.Code != tc.status || backend.calls != 0 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("HTTP guard failed")
		}
	}
}
func TestAuthCookieTransport(t *testing.T) {
	token := strings.Repeat("A", 43)
	backend := &fakeAuth{result: auth.LoginResult{SessionToken: token}}
	r := httptest.NewRequest("POST", "https://api.test/v1/auth/login", strings.NewReader(`{"email":"test","password":"test"}`))
	r.Header.Set("Origin", "http://localhost:5174")
	r.Header.Set("X-CRMF-Request", "1")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	authTestRouter(t, backend).ServeHTTP(w, r)
	if w.Code != 200 || strings.Contains(w.Body.String(), token) {
		t.Fatal("token leaked or login failed")
	}
	found := false
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == "__Host-crmf_tenant" && cookie.Value == token {
			found = true
			if !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" || cookie.Domain != "" {
				t.Fatal("insecure cookie")
			}
		}
	}
	if !found {
		t.Fatal("session cookie missing")
	}
}
func TestAuthErrorAndPreflight(t *testing.T) {
	backend := &fakeAuth{err: errors.New("private-dsn-password")}
	r := httptest.NewRequest("OPTIONS", "https://api.test/v1/auth/login", nil)
	r.Header.Set("Origin", "http://localhost:5174")
	r.Header.Set("Access-Control-Request-Method", "POST")
	r.Header.Set("Access-Control-Request-Headers", "content-type,x-crmf-request")
	w := httptest.NewRecorder()
	authTestRouter(t, backend).ServeHTTP(w, r)
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5174" {
		t.Fatal("preflight failed")
	}
	r = httptest.NewRequest("POST", "https://api.test/v1/auth/login", strings.NewReader(`{"email":"test","password":"test"}`))
	r.Header.Set("Origin", "http://localhost:5174")
	r.Header.Set("X-CRMF-Request", "1")
	r.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	authTestRouter(t, backend).ServeHTTP(w, r)
	if w.Code != 503 || strings.Contains(w.Body.String(), "private-dsn-password") {
		t.Fatal("internal error leaked")
	}
}
func TestTrustedProxySelection(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/24")}
	for _, tc := range []struct {
		peer, xff, want string
		fail            bool
	}{
		{"192.0.2.9:123", "1.1.1.1", "192.0.2.9", false},
		{"10.0.0.2:123", "1.1.1.1, 192.0.2.9, 10.0.0.3", "192.0.2.9", false},
		{"10.0.0.2:123", "192.0.2.9:567", "192.0.2.9", false},
		{"10.0.0.2:123", "", "", true},
		{"10.0.0.2:123", "garbage", "", true},
	} {
		r := httptest.NewRequest("POST", "/", nil)
		r.RemoteAddr = tc.peer
		if tc.xff != "" {
			r.Header.Set("X-Forwarded-For", tc.xff)
		}
		got, err := sourceIP(r, trusted)
		if (err != nil) != tc.fail || (!tc.fail && got.String() != tc.want) {
			t.Fatal("untrusted source address selected")
		}
	}
}
