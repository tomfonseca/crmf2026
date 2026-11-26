package app

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/google/uuid"
	"regexp"
	"testing"
)

func TestPairingEntropyShapeAndDeniedBeforeSQL(t *testing.T) {
	seen := map[string]bool{}
	for range 1000 {
		code, e := newPairingCode()
		if e != nil || !regexp.MustCompile("^[A-HJ-NP-Z2-9]{8}$").MatchString(code) || seen[code] {
			t.Fatal("invalid or duplicate random code")
		}
		seen[code] = true
	}
	s := &StoreCatalog{}
	ctx := context.Background()
	id := uuid.New()
	if _, e := s.Pairing(ctx, id); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal(e)
	}
	if _, e := s.IssuePairing(ctx, id, 1, uuid.Nil); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal(e)
	}
	if e := s.RevokePairing(ctx, id, uuid.New()); !errors.Is(e, auth.ErrForbidden) {
		t.Fatal(e)
	}
}
