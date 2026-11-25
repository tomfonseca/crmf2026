package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"

	"github.com/crmf/crmf/internal/server/app"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/google/uuid"
)

type PlanBackend interface {
	List(context.Context, string) (app.PlanPage, error)
	Create(context.Context, string, app.PlanDetails) (app.Plan, error)
	Update(context.Context, uuid.UUID, int32, app.PlanDetails) (app.Plan, error)
	Delete(context.Context, uuid.UUID, int32, string) error
}

func (h *handler) catalogContext(w http.ResponseWriter, r *http.Request, write bool) (context.Context, bool) {
	if h.auth == nil || h.auth.Plans == nil {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return nil, false
	}
	return h.platformContext(w, r, write)
}
func (h *handler) platformContext(w http.ResponseWriter, r *http.Request, write bool) (context.Context, bool) {
	if r.Header.Get("Authorization") != "" {
		problem(w, 400, "unsupported_credentials", "Use a sessão do navegador")
		return nil, false
	}
	token, err := readCookie(r, auth.Platform, false)
	if err != nil {
		h.authError(w, err)
		return nil, false
	}
	ctx, err := h.auth.Backend.Authenticate(r.Context(), token, auth.Platform)
	if err != nil {
		h.authError(w, err)
		return nil, false
	}
	if err := app.RequirePlatform(ctx, write); err != nil {
		h.authError(w, err)
		return nil, false
	}
	return ctx, true
}
func (h *handler) ListPlans(w http.ResponseWriter, r *http.Request, params appcontract.ListPlansParams) {
	ctx, ok := h.catalogContext(w, r, false)
	if !ok {
		return
	}
	// Reject unknown/duplicate filters rather than silently selecting global data.
	query, parseErr := url.ParseQuery(r.URL.RawQuery)
	if parseErr != nil || len(query) > 1 || len(query["after"]) > 1 || (len(query) == 1 && !query.Has("after")) {
		problem(w, 400, "invalid_plan", "Filtro inválido")
		return
	}
	after := ""
	if params.After != nil {
		after = *params.After
	}
	page, err := h.auth.Plans.List(ctx, after)
	if err != nil {
		h.catalogError(w, err)
		return
	}
	response := struct {
		Items []appcontract.Plan `json:"items"`
		Next  *string            `json:"next_cursor,omitempty"`
	}{Items: make([]appcontract.Plan, 0, len(page.Items))}
	for _, plan := range page.Items {
		response.Items = append(response.Items, planResponse(plan))
	}
	if page.NextCursor != "" {
		response.Next = &page.NextCursor
	}
	writeJSON(w, 200, response)
}
func (h *handler) CreatePlan(w http.ResponseWriter, r *http.Request, _ appcontract.CreatePlanParams) {
	ctx, ok := h.catalogContext(w, r, true)
	if !ok {
		return
	}
	var input appcontract.PlanInput
	if !decodeCatalogJSON(w, r, &input, append(planFields(), "code")) {
		return
	}
	plan, err := h.auth.Plans.Create(ctx, input.Code, app.PlanDetails{Name: input.Name, PriceCents: input.PriceCents, Active: input.Active, SyncIntervalSeconds: input.SyncIntervalSeconds, HistoryMonths: input.HistoryMonths, MaxStores: input.MaxStores, MaxUsers: input.MaxUsers, Modules: planModules(input.Modules)})
	if err != nil {
		h.catalogError(w, err)
		return
	}
	writeJSON(w, 201, planResponse(plan))
}
func (h *handler) UpdatePlan(w http.ResponseWriter, r *http.Request, id uuid.UUID, _ appcontract.UpdatePlanParams) {
	ctx, ok := h.catalogContext(w, r, true)
	if !ok {
		return
	}
	var input appcontract.PlanUpdate
	if !decodeCatalogJSON(w, r, &input, append(planFields(), "version")) {
		return
	}
	plan, err := h.auth.Plans.Update(ctx, id, input.Version, app.PlanDetails{Name: input.Name, PriceCents: input.PriceCents, Active: input.Active, SyncIntervalSeconds: input.SyncIntervalSeconds, HistoryMonths: input.HistoryMonths, MaxStores: input.MaxStores, MaxUsers: input.MaxUsers, Modules: planModules(input.Modules)})
	if err != nil {
		h.catalogError(w, err)
		return
	}
	writeJSON(w, 200, planResponse(plan))
}
func (h *handler) DeletePlan(w http.ResponseWriter, r *http.Request, id uuid.UUID, _ appcontract.DeletePlanParams) {
	ctx, ok := h.catalogContext(w, r, true)
	if !ok {
		return
	}
	var input appcontract.DeletePlanJSONBody
	if !decodeCatalogJSON(w, r, &input, []string{"version", "confirmation"}) {
		return
	}
	if err := h.auth.Plans.Delete(ctx, id, input.Version, input.Confirmation); err != nil {
		h.catalogError(w, err)
		return
	}
	w.WriteHeader(204)
}
func planFields() []string {
	return []string{"name", "price_cents", "active", "sync_interval_seconds", "history_months", "max_stores", "max_users", "modules"}
}

// Presence/null/duplicate/unknown checks supplement the generated DTOs; Go's
// zero values must never silently turn omitted policy fields into valid input.
func decodeCatalogJSON(w http.ResponseWriter, r *http.Request, out any, keys []string) bool {
	return decodeRequiredJSON(w, r, out, keys, "invalid_plan", "Preencha todos os campos do plano com valores válidos")
}
func decodeRequiredJSON(w http.ResponseWriter, r *http.Request, out any, keys []string, kind, title string) bool {
	var raw json.RawMessage
	if !decodeAuthJSON(w, r, &raw) {
		return false
	}
	valid := func() bool {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		first, err := decoder.Token()
		if err != nil || first != json.Delim('{') {
			return false
		}
		fields := map[string]json.RawMessage{}
		for decoder.More() {
			token, err := decoder.Token()
			if err != nil {
				return false
			}
			key, ok := token.(string)
			if !ok {
				return false
			}
			if _, exists := fields[key]; exists {
				return false
			}
			var value json.RawMessage
			if decoder.Decode(&value) != nil {
				return false
			}
			fields[key] = value
		}
		if len(fields) != len(keys) {
			return false
		}
		for _, key := range keys {
			value, ok := fields[key]
			if !ok || (bytes.Equal(bytes.TrimSpace(value), []byte("null")) && key != "max_stores" && key != "max_users") {
				return false
			}
		}
		return json.Unmarshal(raw, out) == nil
	}
	if !valid() {
		problem(w, 400, kind, title)
		return false
	}
	return true
}
func planModules[T ~string](items []T) []string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = string(item)
	}
	return out
}
func planResponse(plan app.Plan) appcontract.Plan {
	modules := make([]appcontract.PlanModules, len(plan.Modules))
	for i, m := range plan.Modules {
		modules[i] = appcontract.PlanModules(m)
	}
	return appcontract.Plan{Id: plan.ID, Code: plan.Code, Name: plan.Name, Version: plan.Version, PriceCents: plan.PriceCents, Active: plan.Active, SyncIntervalSeconds: plan.SyncIntervalSeconds, HistoryMonths: plan.HistoryMonths, MaxStores: plan.MaxStores, MaxUsers: plan.MaxUsers, Modules: modules}
}
func (h *handler) catalogError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrForbidden):
		h.authError(w, err)
	case errors.Is(err, app.ErrInvalidPlan):
		problem(w, 400, "invalid_plan", "Dados do plano inválidos")
	case errors.Is(err, app.ErrPlanNotFound):
		problem(w, 404, "plan_not_found", "Plano não encontrado")
	case errors.Is(err, app.ErrPlanConflict):
		problem(w, 409, "plan_conflict", "Código já cadastrado ou plano alterado. Atualize a lista antes de tentar novamente")
	case errors.Is(err, app.ErrPlanInUse):
		problem(w, 409, "plan_in_use", "Plano com assinatura não pode ser excluído. Desative-o")
	default:
		problem(w, 503, "catalog_unavailable", "Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente")
	}
}
