package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/crmf/crmf/internal/server/config"
)

// ErrMailDelivery is deliberately redacted. Delivery may have happened even on
// failure/cancellation: callers must not automatically retry or claim rollback.
var ErrMailDelivery = errors.New("authentication email delivery could not be confirmed")

type LocalMailOptions struct {
	Development                            bool
	Endpoint, TenantOrigin, PlatformOrigin string
}

// LocalMailer only captures mail. It never issues tokens, changes identities,
// resets passwords, or supplies an Azure/production delivery fallback.
type LocalMailer struct {
	endpoint, tenantOrigin, platformOrigin string
	client                                 *http.Client
	slots                                  chan struct{}
}

func NewLocalMailer(o LocalMailOptions) (*LocalMailer, error) {
	bad := errors.New("invalid development-only mail configuration")
	u, err := url.Parse(o.Endpoint)
	if !o.Development || err != nil || u.Scheme != "http" || u.User != nil ||
		u.Host != strings.ToLower(u.Host) || u.Path != "" || u.RawQuery != "" ||
		u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(o.Endpoint, "?#\\\r\n") ||
		u.Port() == "" || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "mailpit") {
		return nil, bad
	}
	port, err := strconv.ParseUint(u.Port(), 10, 16)
	if err != nil || port == 0 {
		return nil, bad
	}
	// Auth origins remain localhost (not IP-literal WebAuthn RP IDs).
	for _, origin := range []string{o.TenantOrigin, o.PlatformOrigin} {
		parsed, err := url.Parse(origin)
		if err != nil || !config.ValidOrigin(origin, true) || parsed.Hostname() != "localhost" {
			return nil, bad
		}
	}
	if o.TenantOrigin == o.PlatformOrigin {
		return nil, bad
	}
	transport := &http.Transport{
		Proxy:              nil, // Never forward auth links through HTTP_PROXY.
		DialContext:        (&net.Dialer{Timeout: 2 * time.Second}).DialContext,
		DisableCompression: true,
		MaxConnsPerHost:    4, MaxIdleConns: 4, MaxIdleConnsPerHost: 4,
		IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 3 * time.Second,
	}
	return &LocalMailer{
		endpoint:     o.Endpoint + "/api/v1/send",
		tenantOrigin: o.TenantOrigin, platformOrigin: o.PlatformOrigin,
		client: &http.Client{Transport: transport, Timeout: 5 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		slots: make(chan struct{}, 4),
	}, nil
}

func (m *LocalMailer) Close() { m.client.CloseIdleConnections() }

type mailAddress struct{ Email, Name string }
type localMailPayload struct {
	From                mailAddress
	To                  []mailAddress
	Subject, Text, HTML string
}

func (m *LocalMailer) Send(ctx context.Context, notice MailNotice) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	data, text, html, err := renderMail(notice, m.tenantOrigin, m.platformOrigin)
	if err != nil {
		return err
	}
	select {
	case m.slots <- struct{}{}:
		defer func() { <-m.slots }()
	case <-ctx.Done():
		return ErrMailDelivery
	}
	body, err := json.Marshal(localMailPayload{
		From:    mailAddress{Email: "no-reply@crmf.invalid", Name: "CRMF local"},
		To:      []mailAddress{{Email: notice.To}},
		Subject: data.Subject, Text: text, HTML: html,
	})
	if err != nil {
		return ErrMailDelivery
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint, bytes.NewReader(body))
	if err != nil {
		return ErrMailDelivery
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		return ErrMailDelivery
	}
	defer resp.Body.Close()
	media, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if resp.StatusCode != http.StatusOK || err != nil || media != "application/json" {
		return ErrMailDelivery
	}
	var result struct{ ID string }
	payload, err := io.ReadAll(io.LimitReader(resp.Body, (8<<10)+1))
	if err != nil || len(payload) > 8<<10 {
		return ErrMailDelivery
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil || result.ID == "" || len(result.ID) > 128 ||
		strings.Trim(result.ID, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != "" {
		return ErrMailDelivery
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return ErrMailDelivery
	}
	return nil
}
