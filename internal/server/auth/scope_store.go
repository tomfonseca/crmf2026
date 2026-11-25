package auth

import (
	"context"
	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func readScope(ctx context.Context, q *authdb.Queries, user pgtype.UUID, realm Realm, mfaVerified, mfaEnrolled bool) (Scope, error) {
	raw, err := q.SessionGrants(ctx, user)
	if err != nil {
		return Scope{}, storageError(ctx)
	}
	grants := make([]Grant, 0, len(raw))
	var tenant uuid.UUID
	for _, g := range raw {
		grants = append(grants, Grant{Role: g.Role, TenantID: uuid.UUID(g.TenantID.Bytes), StoreID: uuid.UUID(g.StoreID.Bytes), SellerCode: g.SellerCode, TenantStatus: g.TenantStatus, RequireMFA: g.RequireMfa})
		if g.TenantID.Valid {
			tenant = uuid.UUID(g.TenantID.Bytes)
		}
	}
	var stores []uuid.UUID
	if tenant != uuid.Nil {
		ids, err := q.ActiveStores(ctx, pgtype.UUID{Bytes: tenant, Valid: true})
		if err != nil {
			return Scope{}, storageError(ctx)
		}
		for _, id := range ids {
			stores = append(stores, uuid.UUID(id.Bytes))
		}
	}
	return buildScope(uuid.UUID(user.Bytes), realm, grants, stores, mfaVerified, mfaEnrolled)
}
