package httpapi

import (
	"errors"
	"github.com/crmf/crmf/internal/server/app"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/google/uuid"
	"net/http"
)

func profileInput(p appcontract.NetworkProfileInput) app.NetworkProfile {
	return app.NetworkProfile{DisplayName: p.DisplayName, RegisteredName: p.RegisteredName, City: p.City, UF: p.Uf, ContactName: p.ContactName, ContactEmail: p.ContactEmail, DefaultTimezone: p.DefaultTimezone, BillingCustomerID: p.BillingCustomerId}
}
func profileResponse(p app.ProfileVersion) appcontract.NetworkProfile {
	v := p.Data
	return appcontract.NetworkProfile{Version: p.Version, Data: appcontract.NetworkProfileInput{DisplayName: v.DisplayName, RegisteredName: v.RegisteredName, City: v.City, Uf: v.UF, ContactName: v.ContactName, ContactEmail: v.ContactEmail, DefaultTimezone: v.DefaultTimezone, BillingCustomerId: v.BillingCustomerID}}
}
func (h *handler) UpdateNetworkProfile(w http.ResponseWriter, r *http.Request, id uuid.UUID, _ appcontract.UpdateNetworkProfileParams) {
	ctx, ok := h.networkContext(w, r, true)
	if !ok {
		return
	}
	if r.URL.RawQuery != "" {
		problem(w, 400, "invalid_network", "Parâmetro inválido")
		return
	}
	var input appcontract.NetworkProfile
	if !decodeNetworkJSON(w, r, &input, []string{"version", "data"}, false) {
		return
	}
	saved, e := h.auth.Networks.UpdateProfile(ctx, id, input.Version, profileInput(input.Data))
	if e != nil {
		h.networkError(w, e)
		return
	}
	writeJSON(w, 200, profileResponse(saved))
}
func (h *handler) LookupCompany(w http.ResponseWriter, r *http.Request, cnpj string) {
	if h.auth == nil {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return
	}
	ctx, ok := h.platformContext(w, r, true)
	if !ok {
		return
	}
	if r.URL.RawQuery != "" {
		problem(w, 400, "invalid_network", "Parâmetro inválido")
		return
	}
	if h.auth.Companies == nil {
		problem(w, 503, "company_unavailable", "Consulta indisponível. Preencha manualmente.")
		return
	}
	p, e := h.auth.Companies.Lookup(ctx, cnpj)
	if e != nil {
		switch {
		case errors.Is(e, app.ErrNetworkInvalid):
			problem(w, 400, "invalid_cnpj", "Revise o CNPJ informado")
		case errors.Is(e, app.ErrCompanyNotFound):
			problem(w, 404, "company_not_found", "CNPJ não encontrado. Confira ou preencha manualmente.")
		case errors.Is(e, app.ErrCompanyLimited):
			problem(w, 429, "company_limited", "Limite de consultas atingido. Preencha manualmente ou consulte mais tarde.")
		default:
			problem(w, 503, "company_unavailable", "Consulta indisponível. Preencha manualmente.")
		}
		return
	}
	writeJSON(w, 200, profileResponse(app.ProfileVersion{Data: p}).Data)
}
