package auth

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestScopeIsolation(t *testing.T) {
	user, tenant, store, other := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	grant := Grant{Role: "employee", TenantID: tenant, StoreID: store, SellerCode: "fixture", TenantStatus: "active"}
	scope, err := buildScope(user, Tenant, []Grant{grant}, []uuid.UUID{store, other}, false, false)
	if err != nil || scope.RequireStore(store) != nil || !errors.Is(scope.RequireStore(other), ErrStoreNotFound) {
		t.Fatal("store isolation failed")
	}
	copied := scope.StoreIDs()
	copied[0] = other
	if scope.RequireStore(other) == nil {
		t.Fatal("caller mutated authoritative scope")
	}
	if _, err := buildScope(user, Platform, []Grant{grant}, nil, true, true); !errors.Is(err, ErrForbidden) {
		t.Fatal("realm crossing accepted")
	}
	second := grant
	second.TenantID = uuid.New()
	if _, err := buildScope(user, Tenant, []Grant{grant, second}, []uuid.UUID{store}, false, false); !errors.Is(err, ErrForbidden) {
		t.Fatal("cross-tenant grants accepted")
	}
	grant.RequireMFA = true
	if _, err := buildScope(user, Tenant, []Grant{grant}, []uuid.UUID{store}, false, true); !errors.Is(err, ErrMFARequired) {
		t.Fatal("MFA bypass")
	}
	grant.TenantStatus = "suspended"
	if _, err := buildScope(user, Tenant, []Grant{grant}, []uuid.UUID{store}, true, true); !errors.Is(err, ErrSuspended) {
		t.Fatal("suspended tenant accepted")
	}
	admin := Grant{Role: "platform_admin"}
	if _, err := buildScope(user, Platform, []Grant{admin}, nil, false, false); !errors.Is(err, ErrMFARequired) {
		t.Fatal("platform MFA bypass")
	}
	if _, err := buildScope(user, Platform, []Grant{admin}, nil, true, true); err != nil {
		t.Fatal(err)
	}
}
