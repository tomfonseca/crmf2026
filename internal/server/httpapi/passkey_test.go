package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLegacyTOTPRoutesAreRemoved(t *testing.T) {
	backend := &fakeAuth{}
	router := authTestRouter(t, backend)
	for _, path := range []string{"/v1/auth/mfa", "/v1/hq/auth/mfa", "/v1/me/mfa", "/v1/hq/me/mfa"} {
		request := httptest.NewRequest("POST", "https://api.test"+path, strings.NewReader("{\"code\":\"000000\"}"))
		request.Header.Set("Origin", "http://localhost:5174")
		request.Header.Set("X-CRMF-Request", "1")
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != 404 || backend.calls != 0 {
			t.Fatal("legacy TOTP route remains reachable")
		}
	}
}
