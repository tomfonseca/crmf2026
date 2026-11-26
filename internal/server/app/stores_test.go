package app

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/google/uuid"
	"strings"
	"testing"
)

func TestStoreValidationAndDeniedBeforeDatabase(t *testing.T) {
	good := StoreFields{Code: "S001", Name: "Loja sintética", City: "Cidade sintética", UF: "SP", Timezone: "America/Sao_Paulo", ERP: "linx_big", Status: "active"}
	if !validStoreFields(good) {
		t.Fatal("valid store rejected")
	}
	for _, change := range []func(*StoreFields){func(f *StoreFields) { f.Code = "" }, func(f *StoreFields) { f.Code = strings.Repeat("x", 65) }, func(f *StoreFields) { f.Name = " nome" }, func(f *StoreFields) { f.City = "city\n" }, func(f *StoreFields) { f.UF = "XX" }, func(f *StoreFields) { f.Timezone = "" }, func(f *StoreFields) { f.Timezone = "America/Unknown" }, func(f *StoreFields) { f.ERP = "unknown" }, func(f *StoreFields) { f.Status = "ready" }} {
		f := good
		change(&f)
		if validStoreFields(f) {
			t.Fatal("invalid configuration accepted")
		}
	}
	s := &StoreCatalog{}
	ctx := context.Background()
	id := uuid.New()
	if _, e := s.List(ctx, uuid.Nil, uuid.Nil); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal(e)
	}
	if _, e := s.Get(ctx, id); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal(e)
	}
	if _, e := s.Create(ctx, id, good); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal(e)
	}
	if _, e := s.Update(ctx, id, 1, good); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal(e)
	}
}
