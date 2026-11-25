// Package provisionqueue adapts River without exposing provisioning powers to the API.
package provisionqueue

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

type Args struct {
	TenantID   uuid.UUID `json:"tenant_id"`
	Generation int32     `json:"generation"`
}

func (Args) Kind() string { return "provision_tenant" }
func NewInserter(pool *pgxpool.Pool) (*river.Client[pgx.Tx], error) {
	return river.NewClient(riverpgxv5.New(pool), &river.Config{Schema: "jobs"})
}
func Migrate(ctx context.Context, url string) error {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return tenancy.ErrUnavailable
	}
	defer pool.Close()
	var allowed bool
	if pool.QueryRow(ctx, "SELECT current_user='crmf_migrator' AND current_database()='crmf_control'").Scan(&allowed) != nil || !allowed {
		return tenancy.ErrUnavailable
	}
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), &rivermigrate.Config{Schema: "jobs"})
	if err != nil {
		return tenancy.ErrUnavailable
	}
	if _, err = migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return tenancy.ErrUnavailable
	}
	// Insert-only runtime cannot claim/finish/delete jobs or run schema migrations.
	_, err = pool.Exec(ctx, `REVOKE ALL ON ALL TABLES IN SCHEMA jobs FROM PUBLIC; GRANT SELECT,INSERT ON jobs.river_job TO crmf_core;
-- River's INSERT ... ON CONFLICT performs a no-op update of kind.
-- No lifecycle columns (state, attempts, errors, finalized_at) are writable.
GRANT UPDATE(kind) ON jobs.river_job TO crmf_core; GRANT USAGE,SELECT ON SEQUENCE jobs.river_job_id_seq TO crmf_core`)
	if err != nil {
		return tenancy.ErrUnavailable
	}
	return nil
}

type worker struct {
	river.WorkerDefaults[Args]
	controlURL, analyticsURL string
	credentials              tenancy.Credentials
}

func (w *worker) Work(ctx context.Context, job *river.Job[Args]) error {
	p, err := tenancy.OpenProvisioner(ctx, w.controlURL, w.analyticsURL, w.credentials)
	if err != nil {
		return tenancy.ErrUnavailable
	}
	defer p.Close()
	return p.ProvisionQueued(ctx, job.Args.TenantID, job.Args.Generation, job.ID)
}
func Run(ctx context.Context, controlURL, analyticsURL string, credentials tenancy.Credentials, logger *slog.Logger, queueName string) error {
	// Validate migration connections before accepting queue work.
	probe, err := tenancy.OpenProvisioner(ctx, controlURL, analyticsURL, credentials)
	if err != nil {
		return tenancy.ErrUnavailable
	}
	probe.Close()
	pool, err := pgxpool.New(ctx, controlURL)
	if err != nil {
		return tenancy.ErrUnavailable
	}
	defer pool.Close()
	workers := river.NewWorkers()
	river.AddWorker(workers, &worker{controlURL: controlURL, analyticsURL: analyticsURL, credentials: credentials})
	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{Schema: "jobs", Workers: workers, Queues: map[string]river.QueueConfig{queueName: {MaxWorkers: 1}}, JobTimeout: 2 * time.Minute, RescueStuckJobsAfter: 3 * time.Minute, Logger: logger})
	if err != nil {
		return tenancy.ErrUnavailable
	}
	if err = client.Start(ctx); err != nil {
		return tenancy.ErrUnavailable
	}
	<-ctx.Done()
	stop, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = client.Stop(stop); err != nil && !errors.Is(err, context.Canceled) {
		return tenancy.ErrUnavailable
	}
	return nil
}
