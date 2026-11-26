package httpapi

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/app"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/google/uuid"
	"net/http"
	"net/url"
)

type StoreBackend interface {
	List(context.Context, uuid.UUID, uuid.UUID) (app.StorePage, error)
	Get(context.Context, uuid.UUID) (app.Store, error)
	Create(context.Context, uuid.UUID, app.StoreFields) (app.Store, error)
	Update(context.Context, uuid.UUID, int32, app.StoreFields) (app.Store, error)
}

func (h *handler) storeContext(w http.ResponseWriter, r *http.Request, write bool) (context.Context, bool) {
	if h.auth == nil || h.auth.Stores == nil {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return nil, false
	}
	return h.platformContext(w, r, write)
}
func (h *handler) ListHQStores(w http.ResponseWriter, r *http.Request, p appcontract.ListHQStoresParams) {
	ctx, ok := h.storeContext(w, r, false)
	if !ok {
		return
	}
	query, e := url.ParseQuery(r.URL.RawQuery)
	if e != nil {
		problem(w, 400, "invalid_store", "Filtro inválido")
		return
	}
	for key, values := range query {
		if (key != "after" && key != "tenant_id") || len(values) != 1 {
			problem(w, 400, "invalid_store", "Filtro inválido")
			return
		}
	}
	var after, tenant uuid.UUID
	if p.After != nil {
		after = *p.After
	}
	if p.TenantId != nil {
		tenant = *p.TenantId
		if tenant == uuid.Nil {
			problem(w, 400, "invalid_store", "Rede inválida")
			return
		}
	}
	page, e := h.auth.Stores.List(ctx, after, tenant)
	if e != nil {
		h.storeError(w, e)
		return
	}
	result := struct {
		Items []appcontract.HQStore `json:"items"`
		Next  *uuid.UUID            `json:"next_cursor,omitempty"`
	}{Items: make([]appcontract.HQStore, 0, len(page.Items))}
	for _, s := range page.Items {
		result.Items = append(result.Items, storeResponse(s))
	}
	if page.NextCursor != uuid.Nil {
		result.Next = &page.NextCursor
	}
	writeJSON(w, 200, result)
}
func (h *handler) GetHQStore(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	ctx, ok := h.storeContext(w, r, false)
	if !ok {
		return
	}
	if r.URL.RawQuery != "" {
		problem(w, 400, "invalid_store", "Filtro inválido")
		return
	}
	s, e := h.auth.Stores.Get(ctx, id)
	if e != nil {
		h.storeError(w, e)
		return
	}
	writeJSON(w, 200, storeResponse(s))
}

var storeKeys = []string{"code", "name", "city", "uf", "timezone", "erp", "status"}

func (h *handler) CreateHQStore(w http.ResponseWriter, r *http.Request, _ appcontract.CreateHQStoreParams) {
	ctx, ok := h.storeContext(w, r, true)
	if !ok {
		return
	}
	if r.URL.RawQuery != "" {
		problem(w, 400, "invalid_store", "Parâmetro inválido")
		return
	}
	var p appcontract.HQStoreInput
	if !decodeRequiredJSON(w, r, &p, append(append([]string{}, storeKeys...), "tenant_id"), "invalid_store", "Revise os dados da loja") {
		return
	}
	s, e := h.auth.Stores.Create(ctx, p.TenantId, app.StoreFields{Code: p.Code, Name: p.Name, City: p.City, UF: p.Uf, Timezone: p.Timezone, ERP: string(p.Erp), Status: string(p.Status)})
	if e != nil {
		h.storeError(w, e)
		return
	}
	writeJSON(w, 201, storeResponse(s))
}
func (h *handler) UpdateHQStore(w http.ResponseWriter, r *http.Request, id uuid.UUID, _ appcontract.UpdateHQStoreParams) {
	ctx, ok := h.storeContext(w, r, true)
	if !ok {
		return
	}
	if r.URL.RawQuery != "" {
		problem(w, 400, "invalid_store", "Parâmetro inválido")
		return
	}
	var p appcontract.HQStoreUpdate
	if !decodeRequiredJSON(w, r, &p, append(append([]string{}, storeKeys...), "version"), "invalid_store", "Revise os dados da loja") {
		return
	}
	s, e := h.auth.Stores.Update(ctx, id, p.Version, app.StoreFields{Code: p.Code, Name: p.Name, City: p.City, UF: p.Uf, Timezone: p.Timezone, ERP: string(p.Erp), Status: string(p.Status)})
	if e != nil {
		h.storeError(w, e)
		return
	}
	writeJSON(w, 200, storeResponse(s))
}
func storeResponse(s app.Store) appcontract.HQStore {
	f := s.Fields
	return appcontract.HQStore{Id: s.ID, TenantId: s.TenantID, Code: f.Code, Name: f.Name, City: f.City, Uf: f.UF, Timezone: f.Timezone, Erp: appcontract.HQStoreErp(f.ERP), Status: appcontract.HQStoreStatus(f.Status), Version: s.Version, NetworkName: s.NetworkName, NetworkSlug: s.NetworkSlug}
}
func (h *handler) storeError(w http.ResponseWriter, e error) {
	switch {
	case errors.Is(e, app.ErrStoreInvalid):
		problem(w, 400, "invalid_store", "Revise os dados da loja")
	case errors.Is(e, app.ErrStoreNotFound):
		problem(w, 404, "store_not_found", "Loja não encontrada")
	case errors.Is(e, app.ErrPlanLimit):
		problem(w, 409, "plan_limit", "O limite de lojas do plano foi atingido. Consulte a assinatura da rede.")
	case errors.Is(e, app.ErrStoreNetworkUnavailable):
		problem(w, 409, "store_network_unavailable", "A rede precisa estar ativa/em avaliação, preparada e com assinatura disponível.")
	case errors.Is(e, app.ErrStoreIdentityInUse):
		problem(w, 409, "store_identity_in_use", "O código do ERP não pode mudar após o pareamento de um dispositivo.")
	case errors.Is(e, app.ErrStoreConflict):
		problem(w, 409, "store_conflict", "Código já usado nesta rede ou cadastro alterado. Atualize antes de tentar novamente.")
	default:
		problem(w, 503, "store_unavailable", "Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente.")
	}
}
