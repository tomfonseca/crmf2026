package app

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type companyTransport func(*http.Request) (*http.Response, error)

func (f companyTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestCompanyLookupBounds(t *testing.T) {
	l := NewCompanyLookup()
	id := uuid.New()
	now := time.Now()
	for i := 0; i < 6; i++ {
		if !l.admit(id, now) {
			t.Fatal("early rate limit")
		}
	}
	if l.admit(id, now) {
		t.Fatal("rate limit missing")
	}
	if !l.admit(id, now.Add(time.Minute)) {
		t.Fatal("window did not expire")
	}
	l = NewCompanyLookup()
	for i := 0; i < 1024; i++ {
		if !l.admit(uuid.New(), now) {
			t.Fatal("capacity")
		}
	}
	if l.admit(uuid.New(), now) || len(l.windows) != 1024 {
		t.Fatal("unbounded limiter")
	}
	if l.client.Timeout != 5*time.Second || cap(l.gate) != 4 || l.client.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
		t.Fatal("transport bounds")
	}
}
func TestCompanyLookupProjectionAndFailures(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		want       error
	}{
		{"projection", `{"cnpj":"00000000000191","razao_social":"Empresa sintética","nome_fantasia":"Rede sintética","municipio":"Cidade sintética","uf":"SP","email":"do-not-import@example.invalid","qsa":[{"nome_socio":"DO NOT FORWARD"}]}`, 200, nil},
		{"missing", `{}`, 404, ErrCompanyNotFound}, {"limited", `{}`, 429, ErrCompanyLimited}, {"upstream", `{}`, 503, ErrNetworkUnavailable}, {"redirect", `{}`, 302, ErrNetworkUnavailable},
		{"wrong identity", `{"cnpj":"00000000000272","razao_social":"Empresa"}`, 200, ErrNetworkUnavailable}, {"malformed", `<html>`, 200, ErrNetworkUnavailable}, {"trailing", `{} {}`, 200, ErrNetworkUnavailable}, {"oversize", `{"unused":"` + strings.Repeat("x", 256*1024) + `"}`, 200, ErrNetworkUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			l := NewCompanyLookup()
			l.client.Transport = companyTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.String() != "https://brasilapi.com.br/api/cnpj/v1/00000000000191" || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
					t.Fatal("unsafe upstream request")
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			p, e := l.fetch(context.Background(), "00000000000191")
			if !errors.Is(e, tc.want) {
				t.Fatal(e)
			}
			if e == nil && (p.ContactEmail != "" || p.ContactName != "" || p.DefaultTimezone != "" || p.BillingCustomerID != "" || p.RegisteredName != "Empresa sintética" || p.DisplayName != "Rede sintética" || p.City != "Cidade sintética" || p.UF != "SP") {
				t.Fatal("incorrect/unsafe projection")
			}
		})
	}
	l := NewCompanyLookup()
	l.client.Transport = companyTransport(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := l.fetch(ctx, "00000000000191"); !errors.Is(e, ErrNetworkUnavailable) {
		t.Fatal("cancellation")
	}
}
