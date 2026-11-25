package httpapi

import (
	"net/http/httptest"
	"testing"
)

func TestNoPublicAdministratorBootstrap(t *testing.T) {
	backend := &fakeAuth{}
	router := authTestRouter(t, backend)
	for _, path := range []string{"/v1/auth/create-admin", "/v1/hq/auth/create-admin", "/v1/auth/register", "/v1/hq/auth/register"} {
		r := httptest.NewRequest("POST", path, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != 404 || backend.calls != 0 {
			t.Fatal("public administrator bootstrap exposed")
		}
	}
}
