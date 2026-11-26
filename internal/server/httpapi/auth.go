package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"time"

	"github.com/crmf/crmf/internal/server/app"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/config"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/google/uuid"
)

type AuthBackend interface {
	Authenticate(context.Context, string, auth.Realm) (context.Context, error)
	Login(context.Context, string, string, auth.Realm, netip.Addr) (auth.LoginResult, error)
	CompletePasskey(context.Context, string, string, auth.Realm, netip.Addr) (auth.LoginResult, error)
	StartEnrollment(context.Context, string, string, auth.Realm, netip.Addr) (auth.LoginResult, error)
	Resolve(context.Context, string, auth.Realm) (auth.Scope, error)
	Revoke(context.Context, string, auth.Realm) error
	CancelChallenge(context.Context, string, auth.Realm) error
}
type AuthOptions struct {
	Backend   AuthBackend
	Plans     PlanBackend
	Networks  NetworkBackend
	Companies interface {
		Lookup(context.Context, string) (app.NetworkProfile, error)
	}
	TenantOrigin, PlatformOrigin string
	Development                  bool
	TrustedProxies               []netip.Prefix
}

func NewAuthenticated(probes []Probe, logger *slog.Logger, options AuthOptions) (http.Handler, error) {
	if options.Backend == nil || !config.ValidOrigin(options.TenantOrigin, options.Development) || !config.ValidOrigin(options.PlatformOrigin, options.Development) || options.TenantOrigin == options.PlatformOrigin {
		return nil, errors.New("invalid HTTP authentication options")
	}
	for _, prefix := range options.TrustedProxies {
		if !prefix.IsValid() || prefix.Bits() == 0 {
			return nil, errors.New("invalid trusted proxy prefix")
		}
	}
	options.TrustedProxies = append([]netip.Prefix(nil), options.TrustedProxies...)
	return newRouter(probes, logger, &options), nil
}
func authRoute(path string) (auth.Realm, string, bool) {
	if strings.HasPrefix(path, "/v1/hq/companies/") {
		return auth.Platform, "GET", true
	}
	if strings.HasPrefix(path, "/v1/hq/tenants/") && strings.HasSuffix(path, "/profile") {
		return auth.Platform, "PUT", true
	}
	if path == "/v1/hq/tenants" {
		return auth.Platform, "GET, POST", true
	}
	if strings.HasPrefix(path, "/v1/hq/tenants/") {
		return auth.Platform, "POST", true
	}
	if path == "/v1/hq/plans" {
		return auth.Platform, "GET, POST", true
	}
	if strings.HasPrefix(path, "/v1/hq/plans/") && !strings.Contains(strings.TrimPrefix(path, "/v1/hq/plans/"), "/") {
		return auth.Platform, "PUT, DELETE", true
	}
	switch path {
	case "/v1/auth/login", "/v1/auth/passkey", "/v1/auth/logout", "/v1/me/passkey":
		return auth.Tenant, http.MethodPost, true
	case "/v1/hq/auth/login", "/v1/hq/auth/passkey", "/v1/hq/auth/logout", "/v1/hq/me/passkey":
		return auth.Platform, http.MethodPost, true
	case "/v1/me":
		return auth.Tenant, http.MethodGet, true
	case "/v1/hq/me":
		return auth.Platform, http.MethodGet, true
	}
	return "", "", false
}
func (h *handler) authSecurity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		realm, method, ok := authRoute(r.URL.Path)
		if !ok || h.auth == nil {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Add("Vary", "Origin")
		origin := h.auth.TenantOrigin
		if realm == auth.Platform {
			origin = h.auth.PlatformOrigin
		}
		supplied := r.Header.Get("Origin")
		if len(r.Header.Values("Origin")) > 1 || (supplied != "" && supplied != origin) {
			problem(w, 403, "origin_denied", "Origem não permitida")
			return
		}
		if supplied == origin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == http.MethodOptions {
			w.Header().Add("Vary", "Access-Control-Request-Method")
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			if supplied != origin || !slices.Contains(strings.Split(method, ", "), r.Header.Get("Access-Control-Request-Method")) {
				problem(w, 403, "preflight_denied", "Requisição não permitida")
				return
			}
			for _, name := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
				name = strings.ToLower(strings.TrimSpace(name))
				if name != "" && name != "content-type" && name != "x-crmf-request" {
					problem(w, 403, "preflight_denied", "Cabeçalho não permitido")
					return
				}
			}
			w.Header().Set("Access-Control-Allow-Methods", method)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CRMF-Request")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && (supplied != origin || len(r.Header.Values("X-CRMF-Request")) != 1 || r.Header.Get("X-CRMF-Request") != "1") {
			problem(w, 403, "csrf_denied", "Requisição não permitida")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
func cookieName(realm auth.Realm, challenge bool) string {
	name := "__Host-crmf_" + string(realm)
	if challenge {
		name += "_challenge"
	}
	return name
}
func readCookie(r *http.Request, realm auth.Realm, challenge bool) (string, error) {
	var token string
	found := false
	for _, c := range r.Cookies() {
		if c.Name == cookieName(realm, challenge) {
			if found || len(c.Value) != 43 {
				return "", auth.ErrUnauthenticated
			}
			found = true
			token = c.Value
		}
	}
	return token, nil
}
func setAuthCookie(w http.ResponseWriter, realm auth.Realm, challenge bool, token string) {
	maxAge := 7 * 24 * 60 * 60
	if realm == auth.Platform {
		maxAge = 12 * 60 * 60
	}
	if challenge {
		maxAge = 300
	}
	if token == "" {
		maxAge = -1
	}
	cookie := &http.Cookie{Name: cookieName(realm, challenge), Value: token, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: maxAge}
	if maxAge < 0 {
		cookie.Expires = time.Unix(1, 0)
	}
	http.SetCookie(w, cookie)
}
func decodeAuthJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || kind != "application/json" || r.Header.Get("Content-Encoding") != "" {
		problem(w, 415, "unsupported_media_type", "Envie JSON sem compressão")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		problem(w, 400, "invalid_request", "JSON inválido")
		return false
	}
	var extra any
	if err := d.Decode(&extra); !errors.Is(err, io.EOF) {
		problem(w, 400, "invalid_request", "JSON inválido")
		return false
	}
	return true
}
func (h *handler) serveAuth(w http.ResponseWriter, r *http.Request, realm auth.Realm, action string) {
	if h.auth == nil {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return
	}
	// Bearer transport is reserved for Pulse phase 2. Never silently choose one
	// credential when both Cookie and Authorization have been supplied.
	if r.Header.Get("Authorization") != "" {
		problem(w, 400, "unsupported_credentials", "Use a sessão do navegador")
		return
	}
	session, err := readCookie(r, realm, false)
	if err != nil {
		h.authError(w, err)
		return
	}
	challenge, err := readCookie(r, realm, true)
	if err != nil {
		h.authError(w, err)
		return
	}
	if action == "me" {
		scope, err := h.auth.Backend.Resolve(r.Context(), session, realm)
		if err != nil {
			h.authError(w, err)
			return
		}
		grants := make([]appcontract.IdentityGrant, 0)
		for _, g := range scope.Grants() {
			grant := appcontract.IdentityGrant{Role: g.Role}
			if g.StoreID != uuid.Nil {
				id := g.StoreID
				grant.StoreId = &id
			}
			if g.SellerCode != "" {
				code := g.SellerCode
				grant.SellerCode = &code
			}
			grants = append(grants, grant)
		}
		stores := scope.StoreIDs()
		if stores == nil {
			stores = []uuid.UUID{}
		}
		identity := appcontract.Identity{UserId: scope.UserID(), Realm: appcontract.IdentityRealm(scope.Realm()), StoreIds: stores, Grants: grants}
		if scope.TenantID() != uuid.Nil {
			id := scope.TenantID()
			identity.TenantId = &id
		}
		writeJSON(w, 200, identity)
		return
	}
	if action == "logout" {
		if err := h.auth.Backend.Revoke(r.Context(), session, realm); err != nil {
			h.authError(w, err)
			return
		}
		if err := h.auth.Backend.CancelChallenge(r.Context(), challenge, realm); err != nil {
			h.authError(w, err)
			return
		}
		setAuthCookie(w, realm, false, "")
		setAuthCookie(w, realm, true, "")
		w.WriteHeader(204)
		return
	}
	ip, err := sourceIP(r, h.auth.TrustedProxies)
	if err != nil {
		problem(w, 400, "invalid_peer", "Origem da conexão inválida")
		return
	}
	var result auth.LoginResult
	switch action {
	case "login":
		var input appcontract.LoginInput
		if !decodeAuthJSON(w, r, &input) {
			return
		}
		if len(input.Email) == 0 || len(input.Email) > 320 || len(input.Password) == 0 || len(input.Password) > 1024 {
			problem(w, 400, "invalid_request", "Credenciais inválidas")
			return
		}
		result, err = h.auth.Backend.Login(r.Context(), input.Email, input.Password, realm, ip)
	case "passkey":
		var input appcontract.PasskeyInput
		if !decodeAuthJSON(w, r, &input) {
			return
		}
		if len(input.Response) == 0 || len(input.Response) > 8192 {
			problem(w, 400, "invalid_request", "Resposta da passkey inválida")
			return
		}
		result, err = h.auth.Backend.CompletePasskey(r.Context(), challenge, input.Response, realm, ip)
	case "enroll":
		var input appcontract.EnrollmentInput
		if !decodeAuthJSON(w, r, &input) {
			return
		}
		if len(input.Password) == 0 || len(input.Password) > 1024 {
			problem(w, 400, "invalid_request", "Senha inválida")
			return
		}
		result, err = h.auth.Backend.StartEnrollment(r.Context(), session, input.Password, realm, ip)
	}
	if err != nil {
		h.authError(w, err)
		return
	}
	// End any previous browser authentication when switching accounts. Opt-in
	// enrollment keeps its current session until MFA confirmation.
	if action != "enroll" {
		if err := h.auth.Backend.Revoke(r.Context(), session, realm); err != nil {
			h.authError(w, err)
			return
		}
		if err := h.auth.Backend.CancelChallenge(r.Context(), challenge, realm); err != nil {
			h.authError(w, err)
			return
		}
	}
	outcome := appcontract.AuthOutcome{Status: appcontract.Authenticated}
	if result.SessionToken != "" {
		setAuthCookie(w, realm, false, result.SessionToken)
		setAuthCookie(w, realm, true, "")
		if len(result.RecoveryCodes) > 0 {
			outcome.RecoveryCodes = &result.RecoveryCodes
		}
	} else if result.ChallengeToken != "" {
		if action != "enroll" {
			setAuthCookie(w, realm, false, "")
		}
		setAuthCookie(w, realm, true, result.ChallengeToken)
		outcome.Status = appcontract.PasskeyRequired
		options := string(result.PasskeyOptions)
		outcome.PublicKey = &options
		if result.Enrollment {
			outcome.Status = appcontract.EnrollmentRequired
		}
	} else {
		h.authError(w, auth.ErrUnavailable)
		return
	}
	writeJSON(w, 200, outcome)
}
func (h *handler) authError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthenticated):
		problem(w, 401, "authentication_failed", "Autenticação inválida")
	case errors.Is(err, auth.ErrMFARequired), errors.Is(err, auth.ErrForbidden), errors.Is(err, auth.ErrSuspended):
		problem(w, 403, "access_denied", "Acesso não permitido")
	case errors.Is(err, auth.ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		problem(w, 429, "rate_limited", "Aguarde antes de tentar novamente")
	default:
		problem(w, 503, "auth_unavailable", "Autenticação temporariamente indisponível")
	}
}
func (h *handler) LoginTenant(w http.ResponseWriter, r *http.Request, _ appcontract.LoginTenantParams) {
	h.serveAuth(w, r, auth.Tenant, "login")
}
func (h *handler) LoginPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.LoginPlatformParams) {
	h.serveAuth(w, r, auth.Platform, "login")
}
func (h *handler) PasskeyTenant(w http.ResponseWriter, r *http.Request, _ appcontract.PasskeyTenantParams) {
	h.serveAuth(w, r, auth.Tenant, "passkey")
}
func (h *handler) PasskeyPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.PasskeyPlatformParams) {
	h.serveAuth(w, r, auth.Platform, "passkey")
}
func (h *handler) LogoutTenant(w http.ResponseWriter, r *http.Request, _ appcontract.LogoutTenantParams) {
	h.serveAuth(w, r, auth.Tenant, "logout")
}
func (h *handler) LogoutPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.LogoutPlatformParams) {
	h.serveAuth(w, r, auth.Platform, "logout")
}
func (h *handler) MeTenant(w http.ResponseWriter, r *http.Request) {
	h.serveAuth(w, r, auth.Tenant, "me")
}
func (h *handler) MePlatform(w http.ResponseWriter, r *http.Request) {
	h.serveAuth(w, r, auth.Platform, "me")
}
func (h *handler) EnrollTenant(w http.ResponseWriter, r *http.Request, _ appcontract.EnrollTenantParams) {
	h.serveAuth(w, r, auth.Tenant, "enroll")
}
func (h *handler) EnrollPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.EnrollPlatformParams) {
	h.serveAuth(w, r, auth.Platform, "enroll")
}
