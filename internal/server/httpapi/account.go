package httpapi

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/google/uuid"
	"io"
	"net/http"
	"net/netip"
	"net/url"
)

type AccountBackend interface {
	OwnSessions(context.Context, string, auth.Realm, uuid.UUID) (auth.SessionPage, error)
	EndOwnSession(context.Context, string, auth.Realm, uuid.UUID) (bool, error)
	ChangePassword(context.Context, string, string, string, auth.Realm, netip.Addr) error
}

func (h *handler) accountBackend(w http.ResponseWriter, r *http.Request, realm auth.Realm) (AccountBackend, string, bool) {
	if h.auth == nil {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return nil, "", false
	}
	b, ok := h.auth.Backend.(AccountBackend)
	if !ok {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return nil, "", false
	}
	if r.Header.Get("Authorization") != "" {
		problem(w, 400, "unsupported_credentials", "Use a sessão do navegador")
		return nil, "", false
	}
	token, err := readCookie(r, realm, false)
	if err != nil {
		h.authError(w, err)
		return nil, "", false
	}
	return b, token, true
}
func (h *handler) accountError(w http.ResponseWriter, e error) {
	switch {
	case errors.Is(e, auth.ErrCurrentPassword):
		problem(w, 400, "current_password_invalid", "Não foi possível confirmar a senha atual.")
	case errors.Is(e, auth.ErrPasswordPolicy):
		problem(w, 400, "password_policy", "Use uma senha diferente, com pelo menos 12 caracteres, até 1024 bytes e fora da lista de senhas comuns.")
	case errors.Is(e, auth.ErrSessionMissing):
		problem(w, 404, "session_not_found", "Sessão não encontrada")
	default:
		h.authError(w, e)
	}
}
func (h *handler) listOwnSessions(w http.ResponseWriter, r *http.Request, realm auth.Realm) {
	b, token, ok := h.accountBackend(w, r, realm)
	if !ok {
		return
	}
	query, e := url.ParseQuery(r.URL.RawQuery)
	if e != nil {
		problem(w, 400, "invalid_request", "Parâmetro inválido")
		return
	}
	for key, v := range query {
		if key != "after" || len(v) != 1 {
			problem(w, 400, "invalid_request", "Parâmetro inválido")
			return
		}
	}
	var after uuid.UUID
	if v, ok := query["after"]; ok {
		after, e = uuid.Parse(v[0])
		if e != nil || after == uuid.Nil || after.String() != v[0] {
			problem(w, 400, "invalid_request", "Referência inválida")
			return
		}
	}
	if r.Header.Get("Content-Encoding") != "" {
		problem(w, 400, "invalid_request", "Corpo não permitido")
		return
	}
	if r.Body != nil {
		var b [1]byte
		n, e := r.Body.Read(b[:])
		if n != 0 || e != io.EOF {
			problem(w, 400, "invalid_request", "Corpo não permitido")
			return
		}
	}
	page, e := b.OwnSessions(r.Context(), token, realm, after)
	if e != nil {
		h.accountError(w, e)
		return
	}
	out := appcontract.SessionPage{Items: make([]appcontract.OwnSession, 0, len(page.Items))}
	for _, s := range page.Items {
		out.Items = append(out.Items, appcontract.OwnSession{Id: s.ID, CreatedAt: s.CreatedAt, LastSeenAt: s.LastSeenAt, IdleExpiresAt: s.IdleExpiresAt, ExpiresAt: s.ExpiresAt, Current: s.Current, MfaVerified: s.MFAVerified})
	}
	if page.Next != uuid.Nil {
		out.NextCursor = &page.Next
	}
	writeJSON(w, 200, out)
}
func (h *handler) changeOwnPassword(w http.ResponseWriter, r *http.Request, realm auth.Realm) {
	b, token, ok := h.accountBackend(w, r, realm)
	if !ok {
		return
	}
	if r.URL.RawQuery != "" {
		problem(w, 400, "invalid_request", "Parâmetro inválido")
		return
	}
	var in appcontract.PasswordChangeInput
	if !decodeRequiredJSON(w, r, &in, []string{"current_password", "new_password"}, "invalid_request", "Revise os campos da senha") {
		return
	}
	if len(in.CurrentPassword) == 0 || len(in.CurrentPassword) > 1024 || len(in.NewPassword) > 1024 {
		problem(w, 400, "password_policy", "Revise os campos da senha")
		return
	}
	ip, e := sourceIP(r, h.auth.TrustedProxies)
	if e != nil {
		problem(w, 400, "invalid_peer", "Origem inválida")
		return
	}
	if e = b.ChangePassword(r.Context(), token, in.CurrentPassword, in.NewPassword, realm, ip); e != nil {
		h.accountError(w, e)
		return
	}
	setAuthCookie(w, realm, false, "")
	setAuthCookie(w, realm, true, "")
	w.WriteHeader(204)
}
func (h *handler) endOwnSession(w http.ResponseWriter, r *http.Request, realm auth.Realm) {
	b, token, ok := h.accountBackend(w, r, realm)
	if !ok {
		return
	}
	if r.URL.RawQuery != "" {
		problem(w, 400, "invalid_request", "Parâmetro inválido")
		return
	}
	var in appcontract.EndSessionInput
	if !decodeRequiredJSON(w, r, &in, []string{"session_id"}, "invalid_request", "Referência de sessão inválida") {
		return
	}
	current, e := b.EndOwnSession(r.Context(), token, realm, in.SessionId)
	if e != nil {
		h.accountError(w, e)
		return
	}
	if current {
		setAuthCookie(w, realm, false, "")
		setAuthCookie(w, realm, true, "")
	}
	w.WriteHeader(204)
}
func (h *handler) ListSessionsTenant(w http.ResponseWriter, r *http.Request, _ appcontract.ListSessionsTenantParams) {
	h.listOwnSessions(w, r, auth.Tenant)
}
func (h *handler) ListSessionsPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.ListSessionsPlatformParams) {
	h.listOwnSessions(w, r, auth.Platform)
}
func (h *handler) EndSessionTenant(w http.ResponseWriter, r *http.Request, _ appcontract.EndSessionTenantParams) {
	h.endOwnSession(w, r, auth.Tenant)
}
func (h *handler) EndSessionPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.EndSessionPlatformParams) {
	h.endOwnSession(w, r, auth.Platform)
}
func (h *handler) ChangePasswordTenant(w http.ResponseWriter, r *http.Request, _ appcontract.ChangePasswordTenantParams) {
	h.changeOwnPassword(w, r, auth.Tenant)
}
func (h *handler) ChangePasswordPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.ChangePasswordPlatformParams) {
	h.changeOwnPassword(w, r, auth.Platform)
}
