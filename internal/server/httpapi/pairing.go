package httpapi

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/app"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/google/uuid"
	"io"
	"net/http"
)

type PairingBackend interface {
	Pairing(context.Context, uuid.UUID) (*app.Pairing, error)
	IssuePairing(context.Context, uuid.UUID, int32, uuid.UUID) (app.IssuedPairing, error)
	RevokePairing(context.Context, uuid.UUID, uuid.UUID) error
}

func (h *handler) pairingContext(w http.ResponseWriter, r *http.Request, write bool) (context.Context, PairingBackend, bool) {
	ctx, ok := h.storeContext(w, r, write)
	if !ok {
		return nil, nil, false
	}
	backend, ok := h.auth.Stores.(PairingBackend)
	if !ok {
		problem(w, 404, "not_found", "Recurso não encontrado")
		return nil, nil, false
	}
	if r.URL.RawQuery != "" {
		problem(w, 400, "invalid_store", "Parâmetro inválido")
		return nil, nil, false
	}
	return ctx, backend, true
}
func pairingResponse(p app.Pairing) appcontract.PairingMetadata {
	return appcontract.PairingMetadata{Id: p.ID, StoreId: p.StoreID, ExpiresAt: p.ExpiresAt, Status: appcontract.PairingMetadataStatus(p.Status)}
}
func (h *handler) GetHQPairing(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	ctx, b, ok := h.pairingContext(w, r, false)
	if !ok {
		return
	}
	p, e := b.Pairing(ctx, id)
	if e != nil {
		h.pairingError(w, e)
		return
	}
	result := struct {
		Current *appcontract.PairingMetadata `json:"current,omitempty"`
	}{}
	if p != nil {
		m := pairingResponse(*p)
		result.Current = &m
	}
	writeJSON(w, 200, result)
}
func (h *handler) IssueHQPairing(w http.ResponseWriter, r *http.Request, id uuid.UUID, _ appcontract.IssueHQPairingParams) {
	ctx, b, ok := h.pairingContext(w, r, true)
	if !ok {
		return
	}
	var input appcontract.IssueHQPairingJSONRequestBody
	if !decodeRequiredJSON(w, r, &input, []string{"store_version", "previous_id"}, "invalid_store", "Revise a revisão da loja e o código anterior") {
		return
	}
	var previous uuid.UUID
	if input.PreviousId != "" {
		var e error
		previous, e = uuid.Parse(input.PreviousId)
		if e != nil || previous == uuid.Nil || previous.String() != input.PreviousId {
			problem(w, 400, "invalid_store", "Identificador de código inválido")
			return
		}
	}
	p, e := b.IssuePairing(ctx, id, input.StoreVersion, previous)
	if e != nil {
		h.pairingError(w, e)
		return
	}
	writeJSON(w, 201, struct {
		Current appcontract.PairingMetadata `json:"current"`
		Code    string                      `json:"code"`
	}{pairingResponse(p.Current), p.Code})
}
func (h *handler) RevokeHQPairing(w http.ResponseWriter, r *http.Request, id, pairingID uuid.UUID, _ appcontract.RevokeHQPairingParams) {
	ctx, b, ok := h.pairingContext(w, r, true)
	if !ok {
		return
	}
	if r.Header.Get("Content-Encoding") != "" {
		problem(w, 400, "invalid_store", "Corpo não permitido")
		return
	}
	if r.Body != nil {
		var v [1]byte
		n, e := r.Body.Read(v[:])
		if n != 0 || e != io.EOF {
			problem(w, 400, "invalid_store", "Corpo não permitido")
			return
		}
	}
	if e := b.RevokePairing(ctx, id, pairingID); e != nil {
		h.pairingError(w, e)
		return
	}
	w.WriteHeader(204)
}
func (h *handler) pairingError(w http.ResponseWriter, e error) {
	switch {
	case errors.Is(e, app.ErrPairingConflict):
		problem(w, 409, "pairing_conflict", "A loja ou o código mudou. Atualize antes de continuar.")
	case errors.Is(e, app.ErrPairingRate):
		w.Header().Set("Retry-After", "60")
		problem(w, 429, "pairing_rate", "Aguarde um minuto antes de emitir outro código.")
	default:
		h.storeError(w, e)
	}
}
