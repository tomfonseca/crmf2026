package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCatalogPreflightUsesExactPlatformOriginAndMethod(t *testing.T) {
	for _, tc := range []struct {
		path, origin, method string
		status               int
	}{
		{"/v1/hq/tenants", "http://localhost:5173", "GET", 204},
		{"/v1/hq/tenants", "http://localhost:5173", "POST", 204},
		{"/v1/hq/tenants", "http://localhost:5174", "POST", 403},
		{"/v1/hq/tenants", "http://localhost:5173", "PUT", 403},
		{"/v1/hq/tenants/00000000-0000-7000-8000-000000000001/retry", "http://localhost:5173", "POST", 204},
		{"/v1/hq/plans", "http://localhost:5173", "POST", 204},
		{"/v1/hq/stores/00000000-0000-7000-8000-000000000001/pairing", "http://localhost:5173", "POST", 204},
		{"/v1/hq/stores/00000000-0000-7000-8000-000000000001/pairing", "http://localhost:5173", "PUT", 403},
		{"/v1/hq/stores/00000000-0000-7000-8000-000000000001/pairing/00000000-0000-7000-8000-000000000002", "http://localhost:5173", "DELETE", 204},
		{"/v1/hq/stores/00000000-0000-7000-8000-000000000001/pairing/00000000-0000-7000-8000-000000000002", "http://localhost:5173", "GET", 403},
		{"/v1/hq/stores/00000000-0000-7000-8000-000000000001/pairing", "http://localhost:5174", "POST", 403},
		{"/v1/hq/plans", "http://localhost:5174", "POST", 403},
		{"/v1/hq/plans/00000000-0000-7000-8000-000000000001", "http://localhost:5173", "PUT", 204},
		{"/v1/hq/plans/00000000-0000-7000-8000-000000000001", "http://localhost:5173", "DELETE", 204},
		{"/v1/hq/plans", "http://localhost:5173", "DELETE", 403},
	} {
		request := httptest.NewRequest("OPTIONS", "https://api.test"+tc.path, nil)
		request.Header.Set("Origin", tc.origin)
		request.Header.Set("Access-Control-Request-Method", tc.method)
		request.Header.Set("Access-Control-Request-Headers", "Content-Type, X-CRMF-Request")
		recorder := httptest.NewRecorder()
		authTestRouter(t, &fakeAuth{}).ServeHTTP(recorder, request)
		if recorder.Code != tc.status {
			t.Fatal("catalog CORS guard", tc, recorder.Code)
		}
	}
}
func TestCatalogBindingErrorsAreRedactedProblems(t *testing.T) {
	request := httptest.NewRequest("PUT", "https://api.test/v1/hq/plans/private-do-not-echo", strings.NewReader("{}"))
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("X-CRMF-Request", "1")
	recorder := httptest.NewRecorder()
	authTestRouter(t, &fakeAuth{}).ServeHTTP(recorder, request)
	if recorder.Code != 400 || recorder.Header().Get("Content-Type") != "application/problem+json" || strings.Contains(recorder.Body.String(), "private-do-not-echo") {
		t.Fatal("parameter binding leaked details")
	}
}
func TestCatalogJSONRequiresCompleteUnambiguousPolicy(t *testing.T) {
	for _, raw := range []string{
		"null", `{"active":null}`, `{"active":true,"active":false}`, `{"Active":true}`, `{"active":true,"tenant_id":"other"}`,
	} {
		request := httptest.NewRequest("POST", "https://api.test/v1/hq/plans", strings.NewReader(raw))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		var out struct{ Active bool }
		if decodeCatalogJSON(recorder, request, &out, []string{"active"}) || recorder.Code != 400 {
			t.Fatal("ambiguous JSON accepted")
		}
	}
}
