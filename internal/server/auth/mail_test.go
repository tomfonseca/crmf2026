package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func mailFixture(t *testing.T, endpoint string) (*LocalMailer, MailNotice) {
	t.Helper()
	m, err := NewLocalMailer(LocalMailOptions{
		Development: true, Endpoint: endpoint,
		TenantOrigin: "http://localhost:5174", PlatformOrigin: "http://localhost:5173",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	token, _, err := newToken()
	if err != nil {
		t.Fatal("token fixture")
	}
	return m, MailNotice{To: "fixture@example.invalid", Kind: InviteMail, Realm: Tenant, Token: token}
}

func TestAuthMailTemplatesRealmsAndTokenFragment(t *testing.T) {
	_, notice := mailFixture(t, "http://localhost:18025")
	for _, realm := range []Realm{Tenant, Platform} {
		for _, kind := range []MailKind{InviteMail, PasswordResetMail} {
			notice.Realm, notice.Kind = realm, kind
			data, text, html, err := renderMail(notice, "http://localhost:5174", "http://localhost:5173")
			if err != nil {
				t.Fatal(err)
			}
			link, err := url.Parse(data.Link)
			if err != nil {
				t.Fatal("link parse")
			}
			host, prefix := "localhost:5174", "/login"
			if realm == Platform {
				host, prefix = "localhost:5173", ""
			}
			path, lifetime := "/convite", "72 horas"
			if kind == PasswordResetMail {
				path, lifetime = "/nova-senha", "30 minutos"
			}
			values, _ := url.ParseQuery(link.Fragment)
			if link.Host != host || link.Path != prefix+path || link.RawQuery != "" || values.Get("token") != notice.Token {
				t.Fatal("realm/path/fragment isolation failed")
			}
			if !strings.Contains(text, lifetime) || !strings.Contains(text, data.Link) ||
				!strings.Contains(html, lifetime) || !strings.Contains(html, "<html lang=\"pt-BR\">") ||
				!strings.Contains(html, data.Link) || strings.Contains(html, "<script") ||
				strings.Contains(html, "<img") || !strings.Contains(text, "nem remove suas passkeys") {
				t.Fatal("template contract")
			}
		}
	}
}

func TestAuthMailRejectsInvalidNoticesBeforeTransport(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	m, valid := mailFixture(t, server.URL)
	for _, change := range []func(*MailNotice){
		func(n *MailNotice) { n.To = "Person <person@example.invalid>" },
		func(n *MailNotice) { n.To = "x@example.invalid\r\nBcc: attacker@example.invalid" },
		func(n *MailNotice) { n.To = "" }, func(n *MailNotice) { n.To = strings.Repeat("x", 255) },
		func(n *MailNotice) { n.To = string([]byte{0xff}) },
		func(n *MailNotice) { n.Token = "" }, func(n *MailNotice) { n.Token += "=" },
		func(n *MailNotice) { n.Token = "<script>alert(1)</script>" },
		func(n *MailNotice) { n.Token = strings.Repeat("A", 42) + "B" },
		func(n *MailNotice) { n.Realm = "other" }, func(n *MailNotice) { n.Kind = "other" },
	} {
		n := valid
		change(&n)
		if !errors.Is(m.Send(context.Background(), n), ErrInvalidMail) {
			t.Fatal("invalid notice accepted")
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid notice reached transport")
	}
}

func TestAuthMailLocalConfiguration(t *testing.T) {
	valid := LocalMailOptions{Development: true, Endpoint: "http://localhost:18025", TenantOrigin: "http://localhost:5174", PlatformOrigin: "http://localhost:5173"}
	for _, endpoint := range []string{
		"https://localhost:18025", "http://example.com:8025", "http://169.254.169.254:80",
		"http://user:pass@localhost:8025", "http://localhost:0", "http://localhost:65536",
		"http://localhost:8025/path", "http://localhost:8025?secret", "http://localhost:8025#secret",
		"http://LOCALHOST:8025", "http://localhost", "file:///tmp/mail",
	} {
		o := valid
		o.Endpoint = endpoint
		if _, err := NewLocalMailer(o); err == nil {
			t.Fatal("invalid endpoint accepted")
		}
	}
	for _, change := range []func(*LocalMailOptions){
		func(o *LocalMailOptions) { o.Development = false },
		func(o *LocalMailOptions) { o.TenantOrigin = o.PlatformOrigin },
		func(o *LocalMailOptions) { o.TenantOrigin = "https://public.example" },
		func(o *LocalMailOptions) { o.PlatformOrigin = "http://127.0.0.1:5173" },
	} {
		o := valid
		change(&o)
		if _, err := NewLocalMailer(o); err == nil {
			t.Fatal("invalid local configuration accepted")
		}
	}
	o := valid
	o.Endpoint = "http://mailpit:8025"
	m, err := NewLocalMailer(o)
	if err != nil {
		t.Fatal(err)
	}
	m.Close()
}

func TestAuthMailDeliveryReceiptAndUnknownWrites(t *testing.T) {
	for _, response := range []struct {
		status      int
		media, body string
		ok          bool
	}{
		{200, "application/json", `{"ID":"abc-123"}`, true},
		{200, "application/json", `{"ID":""}`, false},
		{200, "application/json", `{"ID":"abc","extra":"secret"}`, false},
		{200, "application/json", `{"ID":"abc"}{}`, false},
		{200, "application/json", `{"ID":"abc"}` + strings.Repeat(" ", 8<<10), false},
		{200, "text/html", "sensitive provider body", false},
		{503, "application/json", `{"error":"sensitive provider body"}`, false},
	} {
		var calls atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			var payload localMailPayload
			if r.Method != "POST" || r.URL.Path != "/api/v1/send" || r.Header.Get("Content-Type") != "application/json" ||
				json.NewDecoder(r.Body).Decode(&payload) != nil || len(payload.To) != 1 || payload.To[0].Email != "fixture@example.invalid" ||
				payload.From.Email != "no-reply@crmf.invalid" || payload.Text == "" || payload.HTML == "" {
				t.Error("send contract")
			}
			w.Header().Set("Content-Type", response.media)
			w.WriteHeader(response.status)
			_, _ = io.WriteString(w, response.body)
		}))
		m, n := mailFixture(t, server.URL)
		err := m.Send(context.Background(), n)
		server.Close()
		if (err == nil) != response.ok {
			t.Fatal("receipt validation failed")
		}
		if !response.ok && !errors.Is(err, ErrMailDelivery) {
			t.Fatal("non-redacted delivery error")
		}
		if calls.Load() != 1 {
			t.Fatal("automatic retry occurred")
		}
	}
}

func TestAuthMailNoRedirectOrCanceledDelivery(t *testing.T) {
	var leaked atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked.Add(1) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	m, n := mailFixture(t, server.URL)
	if !errors.Is(m.Send(context.Background(), n), ErrMailDelivery) {
		t.Fatal("redirect accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(m.Send(ctx, n), ErrMailDelivery) {
		t.Fatal("cancellation ignored")
	}
	if leaked.Load() != 0 {
		t.Fatal("redirect leaked email")
	}
}

func TestAuthMailBoundedConcurrentDelivery(t *testing.T) {
	var active atomic.Int32
	var once sync.Once
	barrier := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := active.Add(1)
		defer active.Add(-1)
		if count > 4 {
			t.Error("mail concurrency exceeded")
		}
		if count == 4 {
			once.Do(func() { close(barrier) })
		}
		select {
		case <-barrier:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ID":"captured"}`)
	}))
	defer server.Close()
	defer once.Do(func() { close(barrier) })
	m, n := mailFixture(t, server.URL)
	results := make(chan error, 20)
	for range 20 {
		go func() { results <- m.Send(context.Background(), n) }()
	}
	for range 20 {
		if err := <-results; err != nil {
			t.Error(err)
		}
	}
}

func TestAuthMailNoticeRedaction(t *testing.T) {
	_, n := mailFixture(t, "http://localhost:18025")
	encoded, err := json.Marshal(n)
	if err != nil {
		t.Fatal(err)
	}
	var log bytes.Buffer
	slog.New(slog.NewJSONHandler(&log, nil)).Info("notice", "mail", n)
	for _, out := range []string{fmt.Sprint(n), fmt.Sprintf("%+v", n), fmt.Sprintf("%#v", n), string(encoded), log.String()} {
		if strings.Contains(out, n.To) || strings.Contains(out, n.Token) || !strings.Contains(out, "redacted") {
			t.Fatal("notice secret leaked")
		}
	}
}
