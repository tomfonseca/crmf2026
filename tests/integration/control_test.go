//go:build integration

package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/migrate"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestControlRoleIsolation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	migrationURL := "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_control?sslmode=disable"
	for range 2 {
		if err := migrate.Up(ctx, migrationURL, "control"); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		role, password  string
		allowed, denied []string
	}{
		{"crmf_core", "crmf_local_core_only", []string{
			"SELECT id FROM core.tenants LIMIT 0",
			"SELECT id FROM core.plans LIMIT 0",
			"INSERT INTO core.audit_log (action) VALUES ('integration.permission_probe')",
		}, []string{
			"SELECT id FROM auth.users LIMIT 0",
			"SELECT token_hash FROM auth.user_sessions LIMIT 0",
			"SELECT id FROM core.audit_log LIMIT 0",
			"UPDATE core.audit_log SET action = 'forbidden' WHERE false",
			"DELETE FROM core.audit_log WHERE false",
			"TRUNCATE core.audit_log",
			"CREATE TABLE core.forbidden_probe (id int)",
			"SET ROLE crmf_auth",
			"SET ROLE crmf_migrator",
		}},
		{"crmf_auth", "crmf_local_auth_only", []string{
			"SELECT id, password_hash FROM auth.users LIMIT 0",
			"SELECT token_hash FROM auth.user_sessions LIMIT 0",
			"SELECT id FROM auth.user_grants LIMIT 0",
			"SELECT id FROM core.tenants LIMIT 0",
			"SELECT id FROM core.stores LIMIT 0",
			"INSERT INTO core.audit_log (action) VALUES ('integration.permission_probe')",
		}, []string{
			"SELECT id FROM core.plans LIMIT 0",
			"UPDATE core.tenants SET legal_name = 'forbidden' WHERE false",
			"UPDATE core.audit_log SET action = 'forbidden' WHERE false",
			"DELETE FROM core.audit_log WHERE false",
			"CREATE TABLE auth.forbidden_probe (id int)",
			"SET ROLE crmf_core",
			"SET ROLE crmf_migrator",
		}},
	} {
		t.Run(tc.role, func(t *testing.T) {
			// Credentials are exclusively the disposable crmf-dev fixture.
			conn, err := pgx.Connect(ctx, "postgres://"+tc.role+":"+tc.password+"@localhost:55432/crmf_control?sslmode=disable")
			if err != nil {
				t.Fatal("connect isolated application role: ", err)
			}
			defer conn.Close(ctx)
			var privileged bool
			if err := conn.QueryRow(ctx, "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit FROM pg_roles WHERE rolname=current_user").Scan(&privileged); err != nil || privileged {
				t.Fatalf("application role must not be privileged: elevated=%v error=%v", privileged, err)
			}
			for _, sql := range tc.allowed {
				tx, err := conn.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				_, err = tx.Exec(ctx, sql)
				_ = tx.Rollback(ctx)
				if err != nil {
					t.Fatalf("allowed operation failed: %s: %v", sql, err)
				}
			}
			for _, sql := range tc.denied {
				tx, err := conn.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				_, err = tx.Exec(ctx, sql)
				_ = tx.Rollback(ctx)
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
					t.Fatalf("expected insufficient_privilege, not missing objects or success: %s: %v", sql, err)
				}
			}
		})
	}
}
