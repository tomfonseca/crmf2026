// Package migrate owns database migration entry points.
package migrate

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

func Up(ctx context.Context, databaseURL, scope string) error {
	// Tenant provisioning must supply a schema-bound connection in M1.
	if scope != "control" && scope != "platform" {
		return fmt.Errorf("unsupported migration scope %q; tenant provisioning is not implemented in M0", scope)
	}
	if strings.TrimSpace(databaseURL) == "" {
		return fmt.Errorf("migration database URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open migration connection: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return fmt.Errorf("initialize migration lock: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, mustSub(scope), goose.WithSessionLocker(locker))
	if err != nil {
		return fmt.Errorf("initialize migrations: %w", err)
	}
	if _, err = provider.Up(ctx); err != nil {
		return fmt.Errorf("apply %s migrations: %w", scope, err)
	}
	return nil
}
