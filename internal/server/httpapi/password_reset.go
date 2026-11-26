package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/netip"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
)

type PasswordResetBackend interface {
	ResetPassword(context.Context, string, string, auth.Realm, netip.Addr) error
}

func (h *handler) resetPassword(w http.ResponseWriter, r *http.Request, realm auth.Realm) {
	if h.auth == nil {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return
	}
	backend, ok := h.auth.Backend.(PasswordResetBackend)
	if !ok {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return
	}
	if r.Header.Get("Authorization") != "" {
		problem(w, 400, "unsupported_credentials", "Use somente a prova de recuperação")
		return
	}
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		problem(w, 400, "invalid_request", "Parâmetros na URL não são permitidos")
		return
	}
	var input appcontract.PasswordResetInput
	if !decodeRequiredJSON(w, r, &input, []string{"token", "new_password"}, "invalid_request", "Revise os dados da redefinição") {
		return
	}
	if len(input.Token) != 43 {
		problem(w, 400, "reset_token_invalid", "Link inválido ou expirado")
		return
	}
	if len(input.NewPassword) > 1024 {
		h.accountError(w, auth.ErrPasswordPolicy)
		return
	}
	ip, err := sourceIP(r, h.auth.TrustedProxies)
	if err != nil {
		problem(w, 400, "invalid_peer", "Origem inválida")
		return
	}
	if err = backend.ResetPassword(r.Context(), input.Token, input.NewPassword, realm, ip); err != nil {
		if errors.Is(err, auth.ErrResetToken) {
			problem(w, 400, "reset_token_invalid", "Link inválido ou expirado")
		} else {
			h.accountError(w, err)
		}
		return
	}
	// The proof, never a supplied browser session, determines the identity.
	// Clear only this browser realm, with no new session or credential in JSON.
	setAuthCookie(w, realm, false, "")
	setAuthCookie(w, realm, true, "")
	w.WriteHeader(http.StatusNoContent)
}
func (h *handler) ResetPasswordTenant(w http.ResponseWriter, r *http.Request, _ appcontract.ResetPasswordTenantParams) {
	h.resetPassword(w, r, auth.Tenant)
}
func (h *handler) ResetPasswordPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.ResetPasswordPlatformParams) {
	h.resetPassword(w, r, auth.Platform)
}
