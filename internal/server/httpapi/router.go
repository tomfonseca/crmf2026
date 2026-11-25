// Package httpapi exposes contract-driven HTTP handlers.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Probe func(context.Context) error

type handler struct {
	probes []Probe
	logger *slog.Logger
	auth   *AuthOptions
}

func New(probes []Probe, logger *slog.Logger) http.Handler {
	return newRouter(probes, logger, nil)
}

func newRouter(probes []Probe, logger *slog.Logger, options *AuthOptions) http.Handler {
	h := &handler{probes: append([]Probe(nil), probes...), logger: logger, auth: options}
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		problem(w, http.StatusNotFound, "not_found", "Recurso não encontrado")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		problem(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido")
	})
	return h.authSecurity(appcontract.HandlerWithOptions(h, appcontract.ChiServerOptions{BaseRouter: r, ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
		problem(w, 400, "invalid_request", "Parâmetro de requisição inválido")
	}}))
}

func (h *handler) Healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, appcontract.Health{Status: appcontract.Ok})
}

func (h *handler) Readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	for _, probe := range h.probes {
		if err := probe(ctx); err != nil {
			h.logger.WarnContext(ctx, "readiness dependency unavailable")
			problem(w, http.StatusServiceUnavailable, "not_ready", "Serviço temporariamente indisponível")
			return
		}
	}
	h.Healthz(w, r)
}

func problem(w http.ResponseWriter, status int, kind, title string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(appcontract.Problem{Type: kind, Title: title, Status: status})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
