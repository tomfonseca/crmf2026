package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"

	"github.com/crmf/crmf/internal/server/app"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
)

type NetworkBackend interface {
	List(context.Context, string) (app.NetworkPage, error)
	Create(context.Context, tenancy.ProvisionInput) (app.Network, error)
	Retry(context.Context, uuid.UUID, int32) (app.Network, error)
}

func (h *handler) networkContext(w http.ResponseWriter, r *http.Request, write bool) (context.Context, bool) {
	if h.auth == nil || h.auth.Networks == nil {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return nil, false
	}
	return h.platformContext(w, r, write)
}
func (h *handler) ListNetworks(w http.ResponseWriter, r *http.Request, params appcontract.ListNetworksParams) {
	ctx, ok := h.networkContext(w, r, false)
	if !ok {
		return
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) > 1 || len(query["after"]) > 1 || len(query) == 1 && !query.Has("after") {
		problem(w, 400, "invalid_network", "Filtro inválido")
		return
	}
	after := ""
	if params.After != nil {
		after = *params.After
	}
	page, err := h.auth.Networks.List(ctx, after)
	if err != nil {
		h.networkError(w, err)
		return
	}
	result := struct {
		Items []appcontract.Network `json:"items"`
		Next  *string               `json:"next_cursor,omitempty"`
	}{Items: make([]appcontract.Network, 0, len(page.Items))}
	for _, row := range page.Items {
		result.Items = append(result.Items, networkResponse(row))
	}
	if page.NextCursor != "" {
		result.Next = &page.NextCursor
	}
	writeJSON(w, 200, result)
}
func (h *handler) CreateNetwork(w http.ResponseWriter, r *http.Request, _ appcontract.CreateNetworkParams) {
	ctx, ok := h.networkContext(w, r, true)
	if !ok {
		return
	}
	var input appcontract.NetworkInput
	if !decodeRequiredJSON(w, r, &input, []string{"slug", "legal_name", "cnpj", "plan_id"}, "invalid_network", "Revise os dados da rede") {
		return
	}
	network, err := h.auth.Networks.Create(ctx, tenancy.ProvisionInput{Slug: input.Slug, LegalName: input.LegalName, CNPJ: input.Cnpj, PlanID: input.PlanId})
	if err != nil {
		h.networkError(w, err)
		return
	}
	writeJSON(w, 202, networkResponse(network))
}
func (h *handler) RetryNetwork(w http.ResponseWriter, r *http.Request, id uuid.UUID, _ appcontract.RetryNetworkParams) {
	ctx, ok := h.networkContext(w, r, true)
	if !ok {
		return
	}
	var input appcontract.RetryNetworkJSONBody
	if !decodeRequiredJSON(w, r, &input, []string{"generation"}, "invalid_network", "Atualize a rede antes de tentar novamente") {
		return
	}
	network, err := h.auth.Networks.Retry(ctx, id, input.Generation)
	if err != nil {
		h.networkError(w, err)
		return
	}
	writeJSON(w, 202, networkResponse(network))
}
func networkResponse(n app.Network) appcontract.Network {
	return appcontract.Network{Id: n.ID, Slug: n.Slug, LegalName: n.LegalName, Cnpj: n.CNPJ, PlanId: n.PlanID, PlanName: n.PlanName, Status: appcontract.NetworkStatus(n.Status), ProvisionStatus: appcontract.NetworkProvisionStatus(n.ProvisionStatus), SchemaVersion: n.SchemaVersion, Generation: n.Generation}
}
func (h *handler) networkError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, app.ErrNetworkInvalid):
		problem(w, 400, "invalid_network", "Revise os dados da rede e selecione um plano ativo")
	case errors.Is(err, app.ErrNetworkConflict):
		problem(w, 409, "network_conflict", "Rede já cadastrada ou tentativa alterada. Atualize a lista antes de tentar novamente")
	case errors.Is(err, app.ErrNetworkNotFound):
		problem(w, 404, "network_not_found", "Rede não encontrada")
	default:
		problem(w, 503, "network_unavailable", "Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente")
	}
}
