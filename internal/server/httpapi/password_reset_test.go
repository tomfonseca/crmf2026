package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/crmf/crmf/internal/server/auth"
)

type resetBackend struct {
	fakeAuth
	realm auth.Realm
	ip    netip.Addr
}

func (b *resetBackend) ResetPassword(_ context.Context, _, _ string, realm auth.Realm, ip netip.Addr) error {
	b.calls++
	b.realm = realm
	b.ip = ip
	return b.err
}
func TestPasswordResetHTTPGuards(t *testing.T) {
	body := `{"token":"` + strings.Repeat("A", 43) + `","new_password":"Disposable reset passphrase! 2026"}`
	for _, tc := range []struct {
		path, body, origin, content, encoding, authorization string
		csrf                                                 bool
		want                                                 int
	}{
		{"/v1/auth/password/reset", body, "http://localhost:5174", "application/json", "", "", true, 204},
		{"/v1/hq/auth/password/reset", body, "http://localhost:5173", "application/json", "", "", true, 204},
		{"/v1/auth/password/reset", body, "http://localhost:5173", "application/json", "", "", true, 403},
		{"/v1/auth/password/reset", body, "", "application/json", "", "", true, 403},
		{"/v1/auth/password/reset", body, "http://localhost:5174", "application/json", "", "", false, 403},
		{"/v1/auth/password/reset", body, "http://localhost:5174", "text/plain", "", "", true, 415},
		{"/v1/auth/password/reset", body, "http://localhost:5174", "application/json", "gzip", "", true, 415},
		{"/v1/auth/password/reset", body, "http://localhost:5174", "application/json", "", "Bearer invalid", true, 400},
		{"/v1/auth/password/reset?token=never-in-url", body, "http://localhost:5174", "application/json", "", "", true, 400},
		{"/v1/auth/password/reset?", body, "http://localhost:5174", "application/json", "", "", true, 400},
		{"/v1/auth/password/reset", `{"token":null,"new_password":"x"}`, "http://localhost:5174", "application/json", "", "", true, 400},
		{"/v1/auth/password/reset", `{"token":"x","token":"y","new_password":"x"}`, "http://localhost:5174", "application/json", "", "", true, 400},
		{"/v1/auth/password/reset", strings.Replace(body, "}", " ,\"user_id\":\"foreign\"}", 1), "http://localhost:5174", "application/json", "", "", true, 400},
		{"/v1/auth/password/reset", body + "{}", "http://localhost:5174", "application/json", "", "", true, 400},
		{"/v1/auth/password/reset", "null", "http://localhost:5174", "application/json", "", "", true, 400},
		{"/v1/auth/password/reset", strings.Repeat(" ", 8193) + body, "http://localhost:5174", "application/json", "", "", true, 400},
	} {
		b := &resetBackend{}
		req := httptest.NewRequest("POST", "https://api.test"+tc.path, strings.NewReader(tc.body))
		req.RemoteAddr = "192.0.2.51:1234"
		req.Header.Set("X-Forwarded-For", "198.51.100.99") // untrusted; never the rate-limit key
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Content-Type", tc.content)
		if tc.csrf {
			req.Header.Set("X-CRMF-Request", "1")
		}
		req.Header.Set("Content-Encoding", tc.encoding)
		req.Header.Set("Authorization", tc.authorization)
		w := httptest.NewRecorder()
		authTestRouter(t, b).ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Fatalf("reset guard: status %d want %d", w.Code, tc.want)
		}
		if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatal("proof response cache/referrer")
		}
		if tc.want == 204 {
			if b.calls != 1 || b.ip.String() != "192.0.2.51" || len(w.Result().Cookies()) != 2 || w.Body.Len() != 0 {
				t.Fatal("wrong reset dispatch")
			}
			if strings.Contains(tc.path, "/hq/") && b.realm != auth.Platform {
				t.Fatal("wrong realm")
			}
			for _, c := range w.Result().Cookies() {
				if c.Value != "" || c.MaxAge != -1 || !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
					t.Fatal("reset created a cookie/session")
				}
			}
		} else if b.calls != 0 || len(w.Result().Cookies()) != 0 {
			t.Fatal("rejected input reached proof or altered cookies")
		}
	}
}
func TestPasswordResetHTTPErrors(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		kind   string
	}{
		{auth.ErrResetToken, 400, "reset_token_invalid"}, {auth.ErrPasswordPolicy, 400, "password_policy"},
		{auth.ErrRateLimited, 429, "rate_limited"}, {auth.ErrUnavailable, 503, "auth_unavailable"},
	} {
		b := &resetBackend{fakeAuth: fakeAuth{err: tc.err}}
		req := httptest.NewRequest("POST", "https://api.test/v1/auth/password/reset", strings.NewReader(`{"token":"`+strings.Repeat("A", 43)+`","new_password":"Disposable reset passphrase! 2026"}`))
		req.Header.Set("Origin", "http://localhost:5174")
		req.Header.Set("X-CRMF-Request", "1")
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		authTestRouter(t, b).ServeHTTP(w, req)
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.kind) || len(w.Result().Cookies()) != 0 {
			t.Fatal("reset errors leak or modify session")
		}
		if tc.status == 429 && w.Header().Get("Retry-After") != "60" {
			t.Fatal("rate limit hint absent")
		}
	}
	for _, backend := range []AuthBackend{nil, &fakeAuth{}} {
		var router http.Handler
		if backend == nil {
			router = New(nil, nil)
		} else {
			router = authTestRouter(t, backend)
		}
		req := httptest.NewRequest("POST", "https://api.test/v1/auth/password/reset", nil)
		req.Header.Set("Origin", "http://localhost:5174")
		req.Header.Set("X-CRMF-Request", "1")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 404 {
			t.Fatal("optional reset backend enabled")
		}
	}
}
