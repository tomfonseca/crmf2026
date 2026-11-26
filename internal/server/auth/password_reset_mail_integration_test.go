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
)

// This full internal path uses only a fresh fixture identity: mint -> real
// Mailpit MIME -> extract received fragment -> consume -> login with new password.
func TestPasswordResetKernelMailpitRoundTrip(t *testing.T) {
	endpoint := os.Getenv("MAILPIT_TEST_URL")
	if endpoint == "" {
		t.Skip("MAILPIT_TEST_URL not configured")
	}
	f, e, ip := newLoginFixture(t)
	n := resetNotice(t, f, e, Tenant)
	m, _ := mailFixture(t, endpoint)
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}}
	t.Cleanup(client.CloseIdleConnections)
	search := endpoint + "/api/v1/search?query=" + url.QueryEscape("to:"+n.To)
	t.Cleanup(func() {
		req, _ := http.NewRequest(http.MethodDelete, search, nil)
		r, err := client.Do(req)
		if err != nil {
			t.Error("synthetic recovery message cleanup failed")
			return
		}
		r.Body.Close()
		if r.StatusCode != http.StatusOK {
			t.Error("synthetic recovery cleanup rejected")
		}
	})
	ctx := context.Background()
	if err := m.Send(ctx, n); err != nil {
		t.Fatal(err)
	}
	resp, err := client.Get(search)
	if err != nil {
		t.Fatal("captured recovery lookup")
	}
	var found struct{ Messages []struct{ ID string } }
	err = json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(&found)
	resp.Body.Close()
	if err != nil || resp.StatusCode != http.StatusOK || len(found.Messages) != 1 {
		t.Fatal("recovery not captured exactly once")
	}
	resp, err = client.Get(endpoint + "/api/v1/message/" + url.PathEscape(found.Messages[0].ID))
	if err != nil {
		t.Fatal("captured recovery read")
	}
	var message struct{ Text string }
	err = json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(&message)
	resp.Body.Close()
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatal("captured recovery decode")
	}
	var received string
	for _, line := range strings.Split(message.Text, "\n") {
		if strings.HasPrefix(line, "http://localhost:5174/login/nova-senha#") {
			link, err := url.Parse(strings.TrimSpace(line))
			if err != nil || link.RawQuery != "" {
				t.Fatal("token leaked into query")
			}
			fragment, err := url.ParseQuery(link.Fragment)
			if err != nil {
				t.Fatal("fragment parse")
			}
			received = fragment.Get("token")
		}
	}
	if received == "" || received != n.Token {
		t.Fatal("received recovery link mismatch")
	}
	if err = e.ResetPassword(ctx, received, resetFixturePassword, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	result, err := e.Login(ctx, n.To, resetFixturePassword, Tenant, ip)
	if err != nil || result.SessionToken == "" {
		t.Fatal("captured proof did not change fixture password", err)
	}
}
