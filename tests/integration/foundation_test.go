//go:build integration

package integration

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/migrate"
	_ "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresMigrations(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, tc := range []struct{ scope, database string }{{"control", "crmf_control"}, {"platform", "crmf_analytics"}} {
		dsn := "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/" + tc.database + "?sslmode=disable"
		for range 2 {
			if err := migrate.Up(ctx, dsn, tc.scope); err != nil {
				t.Fatal(err)
			}
		}
		pool, err := pgxpool.New(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		if err = pool.Ping(ctx); err != nil {
			t.Fatal(err)
		}
		pool.Close()
	}
}

func TestSyntheticERPReadOnly(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := sql.Open("mysql", "crmf_reader:crmf_local_reader_only@tcp(localhost:53306)/gerente?timeout=5s")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var description string
	if err := db.QueryRowContext(ctx, "SELECT description FROM fixture_metadata WHERE id=1").Scan(&description); err != nil {
		t.Fatal(err)
	}
	if description != "CRMF synthetic development fixture" {
		t.Fatal("unexpected fixture")
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO fixture_metadata VALUES (2, 'must fail')"); err == nil {
		t.Fatal("ERP reader unexpectedly has write permission")
	}
}
