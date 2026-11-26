//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http/cookiejar"
	"strings"
	"testing"

	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/crmf/crmf/internal/testpasskey"
	"github.com/google/uuid"
)

// Only a disposable fixture receives a synthetically minted proof. Production
// issuance remains private: this does not add an operator/HTTP issuer.
func resetHTTPFixtureProof(t *testing.T, f *httpFixture, realm string) string {
	t.Helper()
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal("fixture entropy")
	}
	hash := sha256.Sum256(raw)
	if _, err := f.admin.Exec(context.Background(), `INSERT INTO auth.user_tokens(token_hash,user_id,kind,realm,password_epoch,created_at,expires_at)
	SELECT $1,id,'password_reset',$3,password_changed_at,statement_timestamp(),statement_timestamp()+interval '30 minutes'
	FROM auth.users WHERE id=$2`, hash[:], f.user, realm); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}
func TestHTTPSPasswordResetBothRealmsKeepsMFA(t *testing.T) {
	for _, realm := range []string{"tenant", "platform"} {
		t.Run(realm, func(t *testing.T) {
			f := newHTTPFixture(t, true)
			ctx := context.Background()
			base, origin := "/v1", "http://localhost:5174"
			if realm == "platform" {
				if _, err := f.admin.Exec(ctx, "DELETE FROM auth.user_grants WHERE user_id=$1", f.user); err != nil {
					t.Fatal(err)
				}
				if _, err := f.admin.Exec(ctx, "INSERT INTO auth.user_grants(id,user_id,role) VALUES($1,$2,'platform_support')", uuid.Must(uuid.NewV7()), f.user); err != nil {
					t.Fatal(err)
				}
				base, origin = "/v1/hq", "http://localhost:5173"
			}
			login := func(password string) appcontract.AuthOutcome {
				r, b := f.request(t, "POST", base+"/auth/login", map[string]string{"email": f.user.String() + "@example.invalid", "password": password}, true)
				if r.StatusCode != 200 {
					t.Fatal("fixture login")
				}
				var out appcontract.AuthOutcome
				if json.Unmarshal(b, &out) != nil {
					t.Fatal("fixture decode")
				}
				return out
			}
			pending := login(oldAccountPassword)
			device := testpasskey.New(t)
			if r, _ := f.request(t, "POST", base+"/auth/passkey", map[string]string{"response": device.Register(t, []byte(*pending.PublicKey), origin)}, true); r.StatusCode != 200 {
				t.Fatal("fixture enrollment")
			}
			mainJar := f.client.Jar
			f.client.Jar, _ = cookiejar.New(nil)
			challenge := login(oldAccountPassword)
			challengeJar := f.client.Jar
			stale := device.Authenticate(t, []byte(*challenge.PublicKey), origin)
			f.client.Jar = mainJar
			var before, after []byte
			if err := f.admin.QueryRow(ctx, "SELECT credential_enc FROM auth.passkey_credentials WHERE user_id=$1", f.user).Scan(&before); err != nil {
				t.Fatal(err)
			}
			proof := resetHTTPFixtureProof(t, f, realm)
			body := map[string]string{"token": proof, "new_password": newAccountPassword}
			wrongBase := "/v1/hq"
			if realm == "platform" {
				wrongBase = "/v1"
			}
			if r, _ := f.request(t, "POST", wrongBase+"/auth/password/reset", body, true); r.StatusCode != 400 {
				t.Fatal("cross-realm proof accepted")
			}
			if r, _ := f.request(t, "POST", base+"/auth/password/reset", map[string]string{"token": proof, "new_password": "short"}, true); r.StatusCode != 400 {
				t.Fatal("policy bypass")
			}
			if r, _ := f.request(t, "GET", base+"/me", nil, false); r.StatusCode != 200 {
				t.Fatal("failed proof/policy revoked valid session")
			}
			r, data := f.request(t, "POST", base+"/auth/password/reset", body, true)
			if r.StatusCode != 204 || len(data) != 0 || len(r.Cookies()) != 2 {
				t.Fatal("reset did not complete without session")
			}
			if r, _ := f.request(t, "GET", base+"/me", nil, false); r.StatusCode != 401 {
				t.Fatal("reset authenticated automatically")
			}
			if r, _ := f.request(t, "POST", base+"/auth/password/reset", body, true); r.StatusCode != 400 {
				t.Fatal("replay")
			}
			if err := f.admin.QueryRow(ctx, "SELECT credential_enc FROM auth.passkey_credentials WHERE user_id=$1", f.user).Scan(&after); err != nil || !bytes.Equal(before, after) {
				t.Fatal("credential overwritten")
			}
			f.client.Jar = challengeJar
			if r, _ := f.request(t, "POST", base+"/auth/passkey", map[string]string{"response": stale}, true); r.StatusCode != 401 {
				t.Fatal("old challenge alive")
			}
			next := login(newAccountPassword)
			if next.Status != appcontract.PasskeyRequired {
				t.Fatal("reset bypassed MFA")
			}
			if r, _ := f.request(t, "POST", base+"/auth/passkey", map[string]string{"response": device.Authenticate(t, []byte(*next.PublicKey), origin)}, true); r.StatusCode != 200 {
				t.Fatal("existing authenticator rejected")
			}
			var audited int
			if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM core.audit_log WHERE target=$1 AND action='auth.password_reset'", f.user.String()).Scan(&audited); err != nil || audited != 1 {
				t.Fatal("reset audit not exactly once")
			}
			if strings.Contains(string(data), proof) {
				t.Fatal("proof returned")
			}
		})
	}
}
