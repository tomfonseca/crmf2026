package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOptionalCatalogCodeDoesNotRelaxRequiredJSON(t *testing.T) {
	for _, tc := range []struct {
		body  string
		valid bool
	}{
		{`{"active":true}`, true}, {`{"active":false,"code":"p01"}`, true},
		{`{"active":true,"code":null}`, false}, {`{"active":true,"code":5}`, false},
		{`{"active":true,"code":"p01","code":"p02"}`, false},
		{`{"active":true,"unknown":"p01"}`, false},
		{`{"active":null}`, false}, {`{"code":"p01"}`, false},
		{`{"active":true,"code":"p01","unknown":true}`, false},
	} {
		var out struct {
			Active bool    `json:"active"`
			Code   *string `json:"code"`
		}
		req := httptest.NewRequest("POST", "/v1/hq/plans", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		if got := decodeRequiredJSON(httptest.NewRecorder(), req, &out, []string{"active"}, "invalid_plan", "Invalid", "code"); got != tc.valid {
			t.Fatal("optional code weakened JSON contract", tc.body, got)
		}
	}
}
