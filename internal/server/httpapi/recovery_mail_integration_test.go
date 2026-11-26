//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/crmf/crmf/internal/testpasskey"
	"github.com/google/uuid"
)

func TestHTTPSRecoveryRequestMailpitAndSamePasskey(t *testing.T) {
	endpoint := os.Getenv("MAILPIT_TEST_URL")
	if endpoint == "" {
		t.Skip("local capture not requested")
	}
	for _, realm := range []string{"tenant", "platform"} {
		t.Run(realm, func(t *testing.T) {
			f := newHTTPFixture(t, true, endpoint)
			ctx := context.Background()
			base, origin := "/v1", "http://localhost:5174"
			if realm == "platform" {
				if _, err := f.admin.Exec(ctx, "DELETE FROM auth.user_grants WHERE user_id=$1", f.user); err != nil {
					t.Fatal(err)
				}
				if _, err := f.admin.Exec(ctx, "INSERT INTO auth.user_grants(id,user_id,role) VALUES($1,$2,'platform_support')", uuid.New(), f.user); err != nil {
					t.Fatal(err)
				}
				base, origin = "/v1/hq", "http://localhost:5173"
			}
			email := f.user.String() + "@example.invalid"
			login := func(password string) appcontract.AuthOutcome {
				r, b := f.request(t, "POST", base+"/auth/login", map[string]string{"email": email, "password": password}, true)
				if r.StatusCode != 200 {
					t.Fatal("fixture login")
				}
				var out appcontract.AuthOutcome
				if json.Unmarshal(b, &out) != nil {
					t.Fatal("login decode")
				}
				return out
			}
			pending := login(oldAccountPassword)
			device := testpasskey.New(t)
			if r, _ := f.request(t, "POST", base+"/auth/passkey", map[string]string{"response": device.Register(t, []byte(*pending.PublicKey), origin)}, true); r.StatusCode != 200 {
				t.Fatal("fixture enrollment")
			}
			// Configure a separate delivery object exactly as the standalone process does.
			mailer, err := auth.NewLocalMailer(auth.LocalMailOptions{Development: true, Endpoint: endpoint, TenantOrigin: "http://localhost:5174", PlatformOrigin: "http://localhost:5173"})
			if err != nil {
				t.Fatal(err)
			}
			defer mailer.Close()
			worker, err := auth.NewLocalRecovery(f.engine, mailer)
			if err != nil {
				t.Fatal(err)
			}
			r, b := f.request(t, "POST", base+"/auth/password/forgot", map[string]string{"email": email}, true)
			if r.StatusCode != 202 || len(b) != 0 || len(r.Cookies()) != 0 {
				t.Fatal("intake not uniform")
			}
			var issued int
			if err = f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.user_tokens WHERE user_id=$1", f.user).Scan(&issued); err != nil || issued != 0 {
				t.Fatal("synchronous issuance")
			}
			if did, err := worker.ProcessOne(ctx); !did || err != nil {
				t.Fatal("queued delivery", err)
			}
			client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}}
			defer client.CloseIdleConnections()
			search := endpoint + "/api/v1/search?query=" + url.QueryEscape("to:"+email)
			defer func() {
				req, _ := http.NewRequest("DELETE", search, nil)
				resp, err := client.Do(req)
				if err != nil {
					t.Error("mail cleanup")
					return
				}
				resp.Body.Close()
				if resp.StatusCode != 200 {
					t.Error("mail cleanup status")
				}
			}()
			resp, err := client.Get(search)
			if err != nil {
				t.Fatal("capture search")
			}
			var found struct{ Messages []struct{ ID string } }
			err = json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(&found)
			resp.Body.Close()
			if err != nil || resp.StatusCode != 200 || len(found.Messages) != 1 {
				t.Fatal("capture count")
			}
			resp, err = client.Get(endpoint + "/api/v1/message/" + url.PathEscape(found.Messages[0].ID))
			if err != nil {
				t.Fatal("capture read")
			}
			var message struct{ Text string }
			err = json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(&message)
			resp.Body.Close()
			if err != nil || resp.StatusCode != 200 {
				t.Fatal("capture decode")
			}
			prefix := origin + "/nova-senha#"
			if realm == "tenant" {
				prefix = origin + "/login/nova-senha#"
			}
			var token string
			for _, line := range strings.Split(message.Text, "\n") {
				if strings.HasPrefix(line, prefix) {
					link, err := url.Parse(strings.TrimSpace(line))
					if err != nil || link.RawQuery != "" {
						t.Fatal("link query")
					}
					frag, err := url.ParseQuery(link.Fragment)
					if err != nil {
						t.Fatal("link fragment")
					}
					token = frag.Get("token")
				}
			}
			if token == "" {
				t.Fatal("no captured proof")
			}
			if r, _ := f.request(t, "POST", base+"/auth/password/reset", map[string]string{"token": token, "new_password": newAccountPassword}, true); r.StatusCode != 204 {
				t.Fatal("HTTP consumption")
			}
			next := login(newAccountPassword)
			if next.Status != appcontract.PasskeyRequired || next.PublicKey == nil {
				t.Fatal("password reset bypassed MFA")
			}
			if r, _ := f.request(t, "POST", base+"/auth/passkey", map[string]string{"response": device.Authenticate(t, []byte(*next.PublicKey), origin)}, true); r.StatusCode != 200 {
				t.Fatal("same passkey rejected")
			}
		})
	}
}
