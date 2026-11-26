package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/google/uuid"
)

var ErrCompanyNotFound = errors.New("company not found")
var ErrCompanyLimited = errors.New("company lookup limited")
var cnpjLookupPattern = regexp.MustCompile(`^[A-Z0-9]{12}[0-9]{2}$`)

type lookupWindow struct {
	start time.Time
	count int
}
type CompanyLookup struct {
	client  *http.Client
	mu      sync.Mutex
	windows map[uuid.UUID]lookupWindow
	gate    chan struct{}
}

func NewCompanyLookup() *CompanyLookup {
	return &CompanyLookup{client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}, windows: map[uuid.UUID]lookupWindow{}, gate: make(chan struct{}, 4)}
}
func (l *CompanyLookup) Lookup(ctx context.Context, cnpj string) (NetworkProfile, error) {
	if e := RequirePlatform(ctx, true); e != nil {
		return NetworkProfile{}, e
	}
	if !cnpjLookupPattern.MatchString(cnpj) {
		return NetworkProfile{}, ErrNetworkInvalid
	}
	principal, _ := auth.Principal(ctx)
	if !l.admit(principal.UserID(), time.Now()) {
		return NetworkProfile{}, ErrCompanyLimited
	}
	select {
	case l.gate <- struct{}{}:
		defer func() { <-l.gate }()
	default:
		return NetworkProfile{}, ErrCompanyLimited
	}
	return l.fetch(ctx, cnpj)
}
func (l *CompanyLookup) admit(id uuid.UUID, now time.Time) bool {
	l.mu.Lock()
	for id, w := range l.windows {
		if now.Sub(w.start) >= time.Minute {
			delete(l.windows, id)
		}
	}
	w := l.windows[id]
	if w.count >= 6 || (w.count == 0 && len(l.windows) >= 1024) {
		l.mu.Unlock()
		return false
	}
	if w.count == 0 {
		w.start = now
	}
	w.count++
	l.windows[id] = w
	l.mu.Unlock()
	return true
}
func (l *CompanyLookup) fetch(ctx context.Context, cnpj string) (NetworkProfile, error) {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, "https://brasilapi.com.br/api/cnpj/v1/"+cnpj, nil)
	if e != nil {
		return NetworkProfile{}, ErrNetworkUnavailable
	}
	req.Header.Set("Accept", "application/json")
	// No user cookies/auth, configurable URLs, redirects, upstream logs or raw response forwarding.
	res, e := l.client.Do(req)
	if e != nil {
		return NetworkProfile{}, ErrNetworkUnavailable
	}
	defer func() { _ = res.Body.Close() }()
	switch res.StatusCode {
	case 400:
		return NetworkProfile{}, ErrNetworkInvalid
	case 404:
		return NetworkProfile{}, ErrCompanyNotFound
	case 429:
		return NetworkProfile{}, ErrCompanyLimited
	case 200:
	default:
		return NetworkProfile{}, ErrNetworkUnavailable
	}
	var data struct {
		CNPJ           string `json:"cnpj"`
		RegisteredName string `json:"razao_social"`
		TradeName      string `json:"nome_fantasia"`
		City           string `json:"municipio"`
		UF             string `json:"uf"`
	}
	body := io.LimitReader(res.Body, 256*1024+1)
	decoder := json.NewDecoder(body)
	if decoder.Decode(&data) != nil {
		return NetworkProfile{}, ErrNetworkUnavailable
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return NetworkProfile{}, ErrNetworkUnavailable
	}
	normalized := strings.NewReplacer(".", "", "/", "", "-", "").Replace(data.CNPJ)
	if normalized != cnpj || strings.TrimSpace(data.RegisteredName) == "" {
		return NetworkProfile{}, ErrNetworkUnavailable
	}
	p := NetworkProfile{RegisteredName: strings.TrimSpace(data.RegisteredName), DisplayName: strings.TrimSpace(data.TradeName), City: strings.TrimSpace(data.City), UF: data.UF}
	if p.DisplayName == "" {
		p.DisplayName = p.RegisteredName
	}
	if !validProfile(p) {
		return NetworkProfile{}, ErrNetworkUnavailable
	}
	return p, nil
}
