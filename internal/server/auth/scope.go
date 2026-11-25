package auth

import (
	"context"
	"errors"
	"slices"

	"github.com/google/uuid"
)

type Realm string

const (
	Tenant   Realm = "tenant"
	Platform Realm = "platform"
)

var (
	ErrForbidden     = errors.New("access denied")
	ErrMFARequired   = errors.New("MFA required")
	ErrSuspended     = errors.New("tenant unavailable")
	ErrStoreNotFound = errors.New("store not found")
	ErrUnavailable   = errors.New("authentication temporarily unavailable")
)

// Grant is a read-only copy of persisted authorization, never request input.
type Grant struct {
	Role         string
	TenantID     uuid.UUID
	StoreID      uuid.UUID
	SellerCode   string
	TenantStatus string
	RequireMFA   bool
}
type Scope struct {
	userID   uuid.UUID
	realm    Realm
	tenantID uuid.UUID
	grants   []Grant
	stores   []uuid.UUID
}

func (s Scope) UserID() uuid.UUID     { return s.userID }
func (s Scope) Realm() Realm          { return s.realm }
func (s Scope) TenantID() uuid.UUID   { return s.tenantID }
func (s Scope) Grants() []Grant       { return slices.Clone(s.grants) }
func (s Scope) StoreIDs() []uuid.UUID { return slices.Clone(s.stores) }
func (s Scope) RequireStore(store uuid.UUID) error {
	if !slices.Contains(s.stores, store) {
		return ErrStoreNotFound
	}
	return nil
}

type principalKey struct{}

func Principal(ctx context.Context) (Scope, bool) {
	scope, ok := ctx.Value(principalKey{}).(Scope)
	scope.grants = slices.Clone(scope.grants)
	scope.stores = slices.Clone(scope.stores)
	return scope, ok
}

func buildScope(userID uuid.UUID, realm Realm, grants []Grant, activeStores []uuid.UUID, mfaVerified, mfaEnrolled bool) (Scope, error) {
	if (realm != Tenant && realm != Platform) || len(grants) == 0 || userID == uuid.Nil {
		return Scope{}, ErrForbidden
	}
	scope := Scope{userID: userID, realm: realm, grants: slices.Clone(grants)}
	requireMFA := mfaEnrolled || realm == Platform
	networkAdmin := false
	for _, g := range grants {
		switch g.Role {
		case "platform_admin", "platform_support":
			if realm != Platform || g.TenantID != uuid.Nil || g.StoreID != uuid.Nil || g.SellerCode != "" {
				return Scope{}, ErrForbidden
			}
		case "network_admin", "store_manager", "employee":
			if realm != Tenant || g.TenantID == uuid.Nil {
				return Scope{}, ErrForbidden
			}
			if scope.tenantID != uuid.Nil && scope.tenantID != g.TenantID {
				return Scope{}, ErrForbidden
			}
			scope.tenantID = g.TenantID
			if g.TenantStatus != "active" && g.TenantStatus != "trial" {
				return Scope{}, ErrSuspended
			}
			if g.Role == "network_admin" {
				if g.StoreID != uuid.Nil || g.SellerCode != "" {
					return Scope{}, ErrForbidden
				}
				networkAdmin = true
			} else if g.StoreID == uuid.Nil || (g.Role == "employee" && g.SellerCode == "") || (g.Role == "store_manager" && g.SellerCode != "") {
				return Scope{}, ErrForbidden
			}
			requireMFA = requireMFA || g.RequireMFA
		default:
			return Scope{}, ErrForbidden
		}
	}
	if requireMFA && (!mfaVerified || !mfaEnrolled) {
		return Scope{}, ErrMFARequired
	}
	for _, store := range activeStores {
		if store == uuid.Nil || slices.Contains(scope.stores, store) {
			continue
		}
		allowed := networkAdmin
		for _, g := range grants {
			allowed = allowed || g.StoreID == store
		}
		if realm == Tenant && allowed {
			scope.stores = append(scope.stores, store)
		}
	}
	if realm == Tenant && !networkAdmin && len(scope.stores) == 0 {
		return Scope{}, ErrForbidden
	}
	return scope, nil
}
