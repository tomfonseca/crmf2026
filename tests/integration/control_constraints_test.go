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

func TestControlConstraints(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	dsn := "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_control?sslmode=disable"
	if err := migrate.Up(ctx, dsn, "control"); err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `
INSERT INTO core.tenants (id,slug,legal_name,cnpj,status,schema_name,db_role) VALUES
('00000000-0000-7000-8000-000000000001','test_a','Synthetic A','synthetic-a','active','t_test_a','r_test_a'),
('00000000-0000-7000-8000-000000000002','test_b','Synthetic B','synthetic-b','active','t_test_b','r_test_b');
INSERT INTO core.stores (id,tenant_id,code,name,status) VALUES
('00000000-0000-7000-8000-000000000003','00000000-0000-7000-8000-000000000001','fixture','Synthetic store','active');
INSERT INTO auth.users (id,email,name,status) VALUES
('00000000-0000-7000-8000-000000000004','fixture@example.invalid','Synthetic user','invited'),
('00000000-0000-7000-8000-000000000007','fixture2@example.invalid','Synthetic user 2','invited');
INSERT INTO auth.user_grants (id,user_id,role,tenant_id,store_id,seller_code) VALUES
('00000000-0000-7000-8000-000000000005','00000000-0000-7000-8000-000000000004','employee',
 '00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000003','fixture');`)
	if err != nil {
		t.Fatal("seed disposable fixture: ", err)
	}
	for _, tc := range []struct{ name, sql, code string }{
		{"immutable_slug", "UPDATE core.tenants SET slug='changed',schema_name='t_changed',db_role='r_changed' WHERE slug='test_a'", "23514"},
		{"email_case_insensitive", "INSERT INTO auth.users (id,email,name,status) VALUES ('00000000-0000-7000-8000-000000000006','FIXTURE@example.invalid','Synthetic user','invited')", "23505"},
		{"session_token_must_be_hash", "INSERT INTO auth.user_sessions (id,user_id,token_hash,realm,last_seen_at,idle_expires_at,expires_at) VALUES ('00000000-0000-7000-8000-000000000006','00000000-0000-7000-8000-000000000004',decode('aa','hex'),'tenant',now(),now()+interval '1 hour',now()+interval '2 hours')", "23514"},
		{"grant_store_must_belong_to_tenant", "INSERT INTO auth.user_grants (id,user_id,role,tenant_id,store_id,seller_code) VALUES ('00000000-0000-7000-8000-000000000006','00000000-0000-7000-8000-000000000007','employee','00000000-0000-7000-8000-000000000002','00000000-0000-7000-8000-000000000003','fixture')", "23503"},
		{"employee_requires_store", "INSERT INTO auth.user_grants (id,user_id,role,tenant_id,seller_code) VALUES ('00000000-0000-7000-8000-000000000006','00000000-0000-7000-8000-000000000004','employee','00000000-0000-7000-8000-000000000001','fixture')", "23514"},
		{"platform_cannot_have_tenant", "INSERT INTO auth.user_grants (id,user_id,role,tenant_id) VALUES ('00000000-0000-7000-8000-000000000006','00000000-0000-7000-8000-000000000004','platform_admin','00000000-0000-7000-8000-000000000001')", "23514"},
		{"single_tenant_per_user", "INSERT INTO auth.user_grants (id,user_id,role,tenant_id) VALUES ('00000000-0000-7000-8000-000000000006','00000000-0000-7000-8000-000000000004','network_admin','00000000-0000-7000-8000-000000000002')", "23514"},
		{"no_platform_and_tenant_grants", "INSERT INTO auth.user_grants (id,user_id,role) VALUES ('00000000-0000-7000-8000-000000000006','00000000-0000-7000-8000-000000000004','platform_admin')", "23514"},
		{"duplicate_store_grant", "INSERT INTO auth.user_grants (id,user_id,role,tenant_id,store_id,seller_code) VALUES ('00000000-0000-7000-8000-000000000006','00000000-0000-7000-8000-000000000004','employee','00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000003','fixture')", "23505"},
		{"device_store_must_belong_to_tenant", "INSERT INTO core.devices (id,tenant_id,store_id,public_key,status,paired_at) VALUES ('00000000-0000-7000-8000-000000000006','00000000-0000-7000-8000-000000000002','00000000-0000-7000-8000-000000000003',decode(repeat('aa',32),'hex'),'active',now())", "23503"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tx.Exec(ctx, "SAVEPOINT constraint_probe"); err != nil {
				t.Fatal(err)
			}
			_, queryErr := tx.Exec(ctx, tc.sql)
			if _, err := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT constraint_probe"); err != nil {
				t.Fatal(err)
			}
			var pgErr *pgconn.PgError
			if !errors.As(queryErr, &pgErr) || pgErr.Code != tc.code {
				t.Fatalf("expected SQLSTATE %s, got %v", tc.code, queryErr)
			}
		})
	}
}
