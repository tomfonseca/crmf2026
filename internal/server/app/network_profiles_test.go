package app

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/google/uuid"
	"strings"
	"testing"
)

func TestNetworkProfileValidation(t *testing.T) {
	if !validProfile(NetworkProfile{}) {
		t.Fatal("legacy unknown profile rejected")
	}
	good := NetworkProfile{DisplayName: "Rede sintética", RegisteredName: "Empresa sintética", City: "Cidade sintética", UF: "SP", ContactName: "Contato sintético", ContactEmail: "contact@example.invalid", DefaultTimezone: "America/Sao_Paulo", BillingCustomerID: "customer-reference"}
	if !validProfile(good) {
		t.Fatal("valid profile rejected")
	}
	for _, change := range []func(*NetworkProfile){func(p *NetworkProfile) { p.UF = "AC|AL" }, func(p *NetworkProfile) { p.UF = "XX" }, func(p *NetworkProfile) { p.ContactEmail = "Name <contact@example.invalid>" }, func(p *NetworkProfile) { p.ContactEmail = "invalid" }, func(p *NetworkProfile) { p.ContactName = "\nName" }, func(p *NetworkProfile) { p.DisplayName = strings.Repeat("x", 201) }, func(p *NetworkProfile) { p.DefaultTimezone = "America/Unknown" }, func(p *NetworkProfile) { p.BillingCustomerID = " value" }} {
		p := good
		change(&p)
		if validProfile(p) {
			t.Fatal("invalid metadata accepted")
		}
	}
	n := &Networks{}
	if _, e := n.UpdateProfile(context.Background(), uuid.New(), 0, good); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal("access before database", e)
	}
	lookup := NewCompanyLookup()
	if _, e := lookup.Lookup(context.Background(), "00000000000191"); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal("anonymous lookup", e)
	}
}
