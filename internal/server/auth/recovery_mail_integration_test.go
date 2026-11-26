//go:build integration

package auth

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

	"github.com/crmf/crmf/internal/testpasskey"
)

func TestRecoveryQueueMailpitRoundTrip(t *testing.T) {
	endpoint := os.Getenv("MAILPIT_TEST_URL")
	if endpoint == "" {
		t.Skip("local capture not requested")
	}
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
		t.Fatal(err)
	}
	first := loginFixture(t, f, e, ip)
	device := testpasskey.New(t)
	registered, err := e.CompletePasskey(ctx, first.ChallengeToken, device.Register(t, first.PasskeyOptions, "http://localhost:5174"), Tenant, ip)
	if err != nil || len(registered.RecoveryCodes) != 10 {
		t.Fatal("fixture enrollment")
	}
	mailer, _ := mailFixture(t, endpoint)
	s, err := NewLocalRecovery(e, mailer)
	if err != nil {
		t.Fatal(err)
	}
	email := f.user.String() + "@example.invalid"
	t.Cleanup(func() {
		for _, key := range [][]byte{e.recoveryIndex("global", ""), e.recoveryIndex("ip", ip.Unmap().String()), e.recoveryIndex("recipient", email)} {
			_, _ = f.admin.Exec(context.Background(), "DELETE FROM auth.recovery_limits WHERE key=$1", key)
		}
		_, _ = f.admin.Exec(context.Background(), "DELETE FROM auth.recovery_requests WHERE custody_id=$1", e.recoveryIndex("custody", ""))
	})
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}}
	t.Cleanup(client.CloseIdleConnections)
	search := endpoint + "/api/v1/search?query=" + url.QueryEscape("to:"+email)
	t.Cleanup(func() {
		req, _ := http.NewRequest("DELETE", search, nil)
		r, err := client.Do(req)
		if err != nil {
			t.Error("fixture mail cleanup")
			return
		}
		r.Body.Close()
		if r.StatusCode != 200 {
			t.Error("fixture mail cleanup status")
		}
	})
	// Anonymous request cannot mint a proof synchronously.
	if err := s.Request(ctx, email, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.user_tokens WHERE user_id=$1", f.user).Scan(&count); err != nil || count != 0 {
		t.Fatal("request issued synchronously")
	}
	if did, err := s.ProcessOne(ctx); !did || err != nil {
		t.Fatal("claim/delivery", err)
	}
	r, err := client.Get(search)
	if err != nil {
		t.Fatal("capture search")
	}
	var found struct{ Messages []struct{ ID string } }
	err = json.NewDecoder(io.LimitReader(r.Body, 32<<10)).Decode(&found)
	r.Body.Close()
	if err != nil || r.StatusCode != 200 || len(found.Messages) != 1 {
		t.Fatal("capture not exactly once")
	}
	r, err = client.Get(endpoint + "/api/v1/message/" + url.PathEscape(found.Messages[0].ID))
	if err != nil {
		t.Fatal("capture message")
	}
	var message struct{ Text string }
	err = json.NewDecoder(io.LimitReader(r.Body, 32<<10)).Decode(&message)
	r.Body.Close()
	if err != nil || r.StatusCode != 200 {
		t.Fatal("capture message decode")
	}
	var proof string
	for _, line := range strings.Split(message.Text, "\n") {
		if strings.HasPrefix(line, "http://localhost:5174/login/nova-senha#") {
			link, err := url.Parse(strings.TrimSpace(line))
			if err != nil || link.RawQuery != "" {
				t.Fatal("capture link query")
			}
			values, err := url.ParseQuery(link.Fragment)
			if err != nil {
				t.Fatal("capture fragment")
			}
			proof = values.Get("token")
		}
	}
	if proof == "" {
		t.Fatal("capture had no proof")
	}
	if err := e.ResetPassword(ctx, proof, resetFixturePassword, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Resolve(ctx, registered.SessionToken, Tenant); err == nil {
		t.Fatal("old session survived")
	}
	next, err := e.Login(ctx, email, resetFixturePassword, Tenant, ip)
	if err != nil || next.SessionToken != "" || next.Enrollment || next.ChallengeToken == "" {
		t.Fatal("MFA bypass or replacement")
	}
	if _, err := e.CompletePasskey(ctx, next.ChallengeToken, device.Authenticate(t, next.PasskeyOptions, "http://localhost:5174"), Tenant, ip); err != nil {
		t.Fatal("same passkey failed", err)
	}
	if did, err := s.ProcessOne(ctx); did || err != nil {
		t.Fatal("mail repeated")
	}
}
