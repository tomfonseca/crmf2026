package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/netip"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
)

type RecoveryRequestBackend interface {
	Request(context.Context, string, auth.Realm, netip.Addr) error
}

func (h *handler) requestRecovery(w http.ResponseWriter, r *http.Request, realm auth.Realm) {
	if h.auth == nil {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return
	}
	if h.auth.Recovery == nil {
		problem(w, 503, "recovery_unavailable", "Recuperação indisponível")
		return
	}
	if r.Header.Get("Authorization") != "" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		problem(w, 400, "invalid_request", "Use somente o formulário de recuperação")
		return
	}
	var input appcontract.RecoveryRequestInput
	if !decodeRequiredJSON(w, r, &input, []string{"email"}, "invalid_request", "Revise o endereço informado") {
		return
	}
	ip, err := sourceIP(r, h.auth.TrustedProxies)
	if err != nil {
		problem(w, 400, "invalid_peer", "Origem inválida")
		return
	}
	if err = h.auth.Recovery.Request(r.Context(), input.Email, realm, ip); err != nil {
		if errors.Is(err, auth.ErrInvalidMail) {
			problem(w, 400, "invalid_request", "Revise o endereço informado")
		} else {
			problem(w, 503, "recovery_unavailable", "Não foi possível registrar a solicitação")
		}
		return
	}
	// No owner lookup, delivery outcome, rate hint, cookies or recipient reflected.
	w.WriteHeader(http.StatusAccepted)
}
func (h *handler) RequestRecoveryTenant(w http.ResponseWriter, r *http.Request, _ appcontract.RequestRecoveryTenantParams) {
	h.requestRecovery(w, r, auth.Tenant)
}
func (h *handler) RequestRecoveryPlatform(w http.ResponseWriter, r *http.Request, _ appcontract.RequestRecoveryPlatformParams) {
	h.requestRecovery(w, r, auth.Platform)
}
