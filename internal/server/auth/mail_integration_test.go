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

	"github.com/google/uuid"
)

// Uses only unique synthetic recipients, never an operator identity/token. The
// cleanup search is scoped to that exact recipient; never clear the mailbox.
func TestAuthMailCapture(t *testing.T) {
	endpoint := os.Getenv("MAILPIT_TEST_URL")
	if endpoint == "" {
		t.Skip("MAILPIT_TEST_URL not configured")
	}
	m, notice := mailFixture(t, endpoint)
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	t.Cleanup(client.CloseIdleConnections)
	for _, realm := range []Realm{Tenant, Platform} {
		for _, kind := range []MailKind{InviteMail, PasswordResetMail} {
			n := notice
			n.Realm = realm
			n.Kind = kind
			n.To = "auth-mail-" + uuid.NewString() + "@example.invalid"
			search := endpoint + "/api/v1/search?query=" + url.QueryEscape("to:"+n.To)
			t.Cleanup(func() {
				req, _ := http.NewRequest(http.MethodDelete, search, nil)
				r, err := client.Do(req)
				if err != nil {
					t.Error("synthetic message cleanup failed")
					return
				}
				r.Body.Close()
				if r.StatusCode != http.StatusOK {
					t.Error("synthetic message cleanup rejected")
				}
			})
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err := m.Send(ctx, n)
			cancel()
			if err != nil {
				t.Fatal(err)
			}
			resp, err := client.Get(search)
			if err != nil {
				t.Fatal("capture lookup failed")
			}
			var found struct{ Messages []struct{ ID string } }
			err = json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(&found)
			resp.Body.Close()
			if err != nil || resp.StatusCode != 200 || len(found.Messages) != 1 {
				t.Fatal("capture not found exactly once")
			}
			r, err := client.Get(endpoint + "/api/v1/message/" + url.PathEscape(found.Messages[0].ID))
			if err != nil {
				t.Fatal("capture read failed")
			}
			var message struct{ Subject, Text, HTML string }
			err = json.NewDecoder(io.LimitReader(r.Body, 32<<10)).Decode(&message)
			r.Body.Close()
			if err != nil || r.StatusCode != 200 {
				t.Fatal("capture decode failed")
			}
			data, text, html, err := renderMail(n, m.tenantOrigin, m.platformOrigin)
			if err != nil || message.Subject != data.Subject || strings.ReplaceAll(message.Text, "\r\n", "\n") != text ||
				strings.ReplaceAll(message.HTML, "\r\n", "\n") != html {
				t.Fatal("captured MIME parts differ from templates")
			}
		}
	}
}
