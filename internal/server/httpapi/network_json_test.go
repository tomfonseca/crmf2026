package httpapi

import (
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNetworkProfileStrictJSON(t *testing.T) {
	data := `{"display_name":"","registered_name":"","city":"","uf":"","contact_name":"","contact_email":"","default_timezone":"","billing_customer_id":""}`
	valid := `{"version":0,"data":` + data + `}`
	for _, tc := range []struct {
		s  string
		ok bool
	}{{valid, true}, {strings.Replace(valid, `"city":""`, `"city":null`, 1), false}, {strings.Replace(valid, `"city":""`, `"city":"","city":"other"`, 1), false}, {strings.Replace(valid, `"city":""`, `"unknown":""`, 1), false}, {`{"data":` + data + `}`, false}, {`{"version":0,"data":{}}`, false}, {strings.Replace(valid, `"version":0`, `"version":0,"version":1`, 1), false}} {
		r := httptest.NewRequest("PUT", "/", strings.NewReader(tc.s))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		var p appcontract.NetworkProfile
		if got := decodeNetworkJSON(w, r, &p, []string{"version", "data"}, false); got != tc.ok {
			t.Fatalf("strict JSON: %v", got)
		}
	}
}
