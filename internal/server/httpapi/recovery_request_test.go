package httpapi

import (
	"context"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/crmf/crmf/internal/server/auth"
)

type fakeRecovery struct {
	calls int
	realm auth.Realm
	ip    netip.Addr
	err   error
}

func (f *fakeRecovery) Request(_ context.Context, _ string, realm auth.Realm, ip netip.Addr) error {
	f.calls++
	f.realm = realm
	f.ip = ip
	return f.err
}
func TestRecoveryRequestHTTPUniformAndGuards(t *testing.T) {
	for _, tc := range []struct {
		path, origin, body string
		csrf               bool
		err                error
		want               int
	}{
		{"/v1/auth/password/forgot", "http://localhost:5174", `{"email":"unknown@example.invalid"}`, true, nil, 202},
		{"/v1/hq/auth/password/forgot", "http://localhost:5173", `{"email":"someone@example.invalid"}`, true, nil, 202},
		{"/v1/auth/password/forgot", "http://localhost:5173", `{"email":"someone@example.invalid"}`, true, nil, 403},
		{"/v1/auth/password/forgot", "http://localhost:5174", `{"email":"someone@example.invalid"}`, false, nil, 403},
		{"/v1/auth/password/forgot?email=never-in-url", "http://localhost:5174", `{"email":"x"}`, true, nil, 400},
		{"/v1/auth/password/forgot", "http://localhost:5174", `{"email":"x","email":"y"}`, true, nil, 400},
		{"/v1/auth/password/forgot", "http://localhost:5174", `{"email":null}`, true, nil, 400},
		{"/v1/auth/password/forgot", "http://localhost:5174", `{"email":"x","tenant_id":"foreign"}`, true, nil, 400},
		{"/v1/auth/password/forgot", "http://localhost:5174", `{"email":"x"}{}`, true, nil, 400},
		{"/v1/auth/password/forgot", "http://localhost:5174", `{"email":"x"}`, true, auth.ErrUnavailable, 503},
	} {
		b := &fakeRecovery{err: tc.err}
		router, err := NewAuthenticated(nil, nil, AuthOptions{Backend: &fakeAuth{}, Recovery: b, Development: true, TenantOrigin: "http://localhost:5174", PlatformOrigin: "http://localhost:5173"})
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("POST", "https://api.test"+tc.path, strings.NewReader(tc.body))
		r.RemoteAddr = "192.0.2.9:123"
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Forwarded-For", "198.51.100.55")
		if tc.csrf {
			r.Header.Set("X-CRMF-Request", "1")
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("intake status %d want %d", w.Code, tc.want)
		}
		if w.Header().Get("Cache-Control") != "no-store" || len(w.Result().Cookies()) != 0 {
			t.Fatal("intake cached or issued cookie")
		}
		if tc.want == 202 {
			if w.Body.Len() != 0 || b.calls != 1 || b.ip.String() != "192.0.2.9" {
				t.Fatal("receipt leaks account/rate or trusts forwarded IP")
			}
			expected := auth.Tenant
			if strings.Contains(tc.path, "/hq/") {
				expected = auth.Platform
			}
			if b.realm != expected {
				t.Fatal("realm mismatch")
			}
		} else if tc.err == nil && b.calls != 0 {
			t.Fatal("rejected input reached intake")
		}
	}
}
