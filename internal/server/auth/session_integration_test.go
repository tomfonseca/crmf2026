//go:build integration

package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/migrate"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const testAdminURL = "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_control?sslmode=disable"
const testAuthURL = "postgres://crmf_auth:crmf_local_auth_only@localhost:55432/crmf_control?sslmode=disable"

type sessionFixture struct {
	service                      *Service
	admin                        *pgx.Conn
	user, tenant, store, session uuid.UUID
	token                        string
	now                          time.Time
}

func newSessionFixture(t *testing.T) *sessionFixture {
	t.Helper()
	ctx := context.Background()
	if err := migrate.Up(ctx, testAdminURL, "control"); err != nil {
		t.Fatal(err)
	}
	admin, err := pgx.Connect(ctx, testAdminURL)
	if err != nil {
		t.Fatal("connect synthetic identity fixture")
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	f := &sessionFixture{admin: admin, user: uuid.Must(uuid.NewV7()), tenant: uuid.Must(uuid.NewV7()), store: uuid.Must(uuid.NewV7()), session: uuid.Must(uuid.NewV7()), now: time.Now().UTC().Truncate(time.Second)}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(ctx, "DELETE FROM auth.users WHERE id=$1", f.user); err != nil {
			t.Error("clean synthetic user")
		}
		if _, err := admin.Exec(ctx, "DELETE FROM core.stores WHERE id=$1", f.store); err != nil {
			t.Error("clean synthetic store")
		}
		if _, err := admin.Exec(ctx, "DELETE FROM core.tenants WHERE id=$1", f.tenant); err != nil {
			t.Error("clean synthetic tenant")
		}
	})
	slug := "fixture_" + strings.ReplaceAll(f.tenant.String(), "-", "")
	_, err = admin.Exec(ctx, "INSERT INTO core.tenants (id,slug,legal_name,cnpj,status,schema_name,db_role) VALUES ($1,$2,'Synthetic tenant',$3,'active',$4,$5)", f.tenant, slug, "synthetic-"+f.tenant.String(), "t_"+slug, "r_"+slug)
	if err != nil {
		t.Fatal("seed tenant: ", err)
	}
	_, err = admin.Exec(ctx, "INSERT INTO core.stores (id,tenant_id,code,name,status) VALUES ($1,$2,'fixture','Synthetic store','active')", f.store, f.tenant)
	if err != nil {
		t.Fatal("seed store: ", err)
	}
	_, err = admin.Exec(ctx, "INSERT INTO auth.users (id,email,name,status) VALUES ($1,$2,'Synthetic user','active')", f.user, f.user.String()+"@example.invalid")
	if err != nil {
		t.Fatal("seed identity: ", err)
	}
	_, err = admin.Exec(ctx, "INSERT INTO auth.user_grants (id,user_id,role,tenant_id,store_id,seller_code) VALUES ($1,$2,'employee',$3,$4,'fixture')", uuid.Must(uuid.NewV7()), f.user, f.tenant, f.store)
	if err != nil {
		t.Fatal("seed grant: ", err)
	}
	token, hash, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	f.token = token
	_, err = admin.Exec(ctx, "INSERT INTO auth.user_sessions (id,user_id,token_hash,realm,last_seen_at,idle_expires_at,expires_at,created_at) VALUES ($1,$2,$3,'tenant',$4,$5,$6,$4)", f.session, f.user, hash, f.now, f.now.Add(time.Hour), f.now.Add(7*24*time.Hour))
	if err != nil {
		t.Fatal("seed session: ", err)
	}
	f.service, err = Open(ctx, testAuthURL)
	if err != nil {
		t.Fatal(err)
	}
	f.service.now = func() time.Time { return f.now }
	t.Cleanup(f.service.Close)
	return f
}

func TestSessionLifecycle(t *testing.T) {
	f := newSessionFixture(t)
	ctx := context.Background()
	authenticated, err := f.service.Authenticate(ctx, f.token, Tenant)
	if err != nil {
		t.Fatal(err)
	}
	scope, ok := Principal(authenticated)
	if !ok || scope.UserID() != f.user || scope.TenantID() != f.tenant || scope.RequireStore(f.store) != nil {
		t.Fatal("incorrect principal")
	}
	if _, err := f.service.Resolve(ctx, f.token, Platform); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("realm crossing accepted")
	}
	var idle, expiry time.Time
	if err := f.admin.QueryRow(ctx, "SELECT idle_expires_at,expires_at FROM auth.user_sessions WHERE id=$1", f.session).Scan(&idle, &expiry); err != nil {
		t.Fatal(err)
	}
	if !idle.Equal(f.now.Add(12*time.Hour)) || !expiry.Equal(f.now.Add(7*24*time.Hour)) {
		t.Fatal("sliding expiry changed absolute expiry")
	}
	// Refresh near absolute expiry must not extend it.
	_, err = f.admin.Exec(ctx, "UPDATE auth.user_sessions SET last_seen_at=$2,idle_expires_at=expires_at WHERE id=$1", f.session, expiry.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	f.now = expiry.Add(-time.Minute)
	if _, err := f.service.Resolve(ctx, f.token, Tenant); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(ctx, "SELECT idle_expires_at FROM auth.user_sessions WHERE id=$1", f.session).Scan(&idle); err != nil || !idle.Equal(expiry) {
		t.Fatal("absolute expiry extended")
	}
	if err := f.service.Revoke(ctx, f.token, Platform); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Resolve(ctx, f.token, Tenant); err != nil {
		t.Fatal("logout crossed realm")
	}
	if err := f.service.Revoke(ctx, f.token, Tenant); err != nil {
		t.Fatal(err)
	}
	if err := f.service.Revoke(ctx, f.token, Tenant); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Resolve(ctx, f.token, Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("revoked session accepted")
	}
}

func TestSessionRevocationOnIdentityChanges(t *testing.T) {
	for _, change := range []string{
		"UPDATE auth.users SET password_hash='synthetic-change' WHERE id=$1",
		"UPDATE auth.users SET status='disabled' WHERE id=$1",
		"UPDATE auth.user_grants SET seller_code='changed' WHERE user_id=$1",
		"DELETE FROM auth.user_grants WHERE user_id=$1",
	} {
		t.Run(change[:6], func(t *testing.T) {
			f := newSessionFixture(t)
			ctx := context.Background()
			if _, err := f.service.pool.Exec(ctx, change, f.user); err != nil {
				t.Fatal(err)
			}
			var revoked bool
			if err := f.admin.QueryRow(ctx, "SELECT revoked_at IS NOT NULL FROM auth.user_sessions WHERE id=$1", f.session).Scan(&revoked); err != nil || !revoked {
				t.Fatal("security change did not revoke session")
			}
			expected := ErrUnauthenticated
			if strings.Contains(change, "status=") {
				expected = ErrForbidden
			}
			if _, err := f.service.Resolve(ctx, f.token, Tenant); !errors.Is(err, expected) {
				t.Fatal("invalidated session accepted")
			}
		})
	}
}

func TestSessionEnforcesCurrentPolicy(t *testing.T) {
	for _, tc := range []struct {
		sql      string
		expected error
	}{
		{"UPDATE core.tenants SET require_mfa=true WHERE id=$1", ErrMFARequired},
		{"UPDATE core.tenants SET status='suspended' WHERE id=$1", ErrSuspended},
		{"UPDATE core.stores SET status='inactive' WHERE tenant_id=$1", ErrForbidden},
	} {
		f := newSessionFixture(t)
		ctx := context.Background()
		if _, err := f.admin.Exec(ctx, tc.sql, f.tenant); err != nil {
			t.Fatal(err)
		}
		if _, err := f.service.Resolve(ctx, f.token, Tenant); !errors.Is(err, tc.expected) {
			t.Fatal("current authorization policy ignored")
		}
	}
	if service, err := Open(context.Background(), testAdminURL); err == nil {
		service.Close()
		t.Fatal("migrator accepted as auth role")
	}
}
