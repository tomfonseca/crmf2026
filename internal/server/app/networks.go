package app

import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/db/control"
	"github.com/crmf/crmf/internal/server/provisionqueue"
	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

var (
	ErrNetworkUnavailable = errors.New("network operation unavailable")
	ErrNetworkInvalid     = errors.New("invalid network")
	ErrNetworkConflict    = errors.New("network exists or attempt changed")
	ErrNetworkNotFound    = errors.New("network not found")
)

type Network struct {
	ID                                                       uuid.UUID
	Slug, LegalName, CNPJ, Status, ProvisionStatus, PlanName string
	PlanID                                                   uuid.UUID
	SchemaVersion                                            int64
	Generation                                               int32
	Profile                                                  *ProfileVersion
}
type NetworkPage struct {
	Items      []Network
	NextCursor string
}
type Networks struct {
	queueName string
	pool      *pgxpool.Pool
	queue     *river.Client[pgx.Tx]
}

// queueName is trusted server configuration, never a request parameter.
func NewNetworks(ctx context.Context, pool *pgxpool.Pool, queueName string) (*Networks, error) {
	if pool == nil || queueName == "" {
		return nil, ErrNetworkUnavailable
	}
	var allowed bool
	if pool.QueryRow(ctx, "SELECT current_user='crmf_core' AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls) FROM pg_roles WHERE rolname=current_user").Scan(&allowed) != nil || !allowed {
		return nil, ErrNetworkUnavailable
	}
	queue, err := provisionqueue.NewInserter(pool)
	if err != nil {
		return nil, ErrNetworkUnavailable
	}
	return &Networks{pool: pool, queue: queue, queueName: queueName}, nil
}
func networkRow(row control.NetworkBySlugRow) Network {
	return Network{ID: uuid.UUID(row.ID.Bytes), Slug: row.Slug, LegalName: row.LegalName, CNPJ: row.Cnpj, Status: row.Status, PlanName: row.PlanName, PlanID: uuid.UUID(row.PlanID.Bytes), SchemaVersion: row.SchemaVersion, Generation: row.Generation}
}
func networkState(ready bool, state string) string {
	if ready {
		return "ready"
	}
	switch state {
	case "available", "pending", "scheduled", "retryable":
		return "queued"
	case "running":
		return "preparing"
	default:
		return "failed"
	}
}
func (n *Networks) state(ctx context.Context, tx pgx.Tx, row control.NetworkBySlugRow) (Network, error) {
	result := networkRow(row)
	profile, e := loadProfile(ctx, tx, result.ID)
	if e != nil {
		return Network{}, e
	}
	if profile.Version > 0 {
		result.Profile = &profile
	}
	if row.ProvisionState == "ready" && row.SchemaVersion > 0 {
		result.ProvisionStatus = "ready"
		return result, nil
	}
	if row.JobID == 0 {
		result.ProvisionStatus = "failed"
		return result, nil
	}
	job, err := n.queue.JobGetTx(ctx, tx, row.JobID)
	if errors.Is(err, river.ErrNotFound) {
		result.ProvisionStatus = "failed"
		return result, nil
	}
	if err != nil {
		return Network{}, ErrNetworkUnavailable
	}
	result.ProvisionStatus = networkState(false, string(job.State))
	return result, nil
}
func (n *Networks) List(ctx context.Context, after string) (NetworkPage, error) {
	if err := RequirePlatform(ctx, false); err != nil {
		return NetworkPage{}, err
	}
	if after != "" && !tenancy.ValidSlug(after) {
		return NetworkPage{}, ErrNetworkInvalid
	}
	rows, err := control.New(n.pool).ListNetworks(ctx, after)
	if err != nil {
		return NetworkPage{}, ErrNetworkUnavailable
	}
	page := NetworkPage{Items: make([]Network, 0, min(100, len(rows)))}
	// River owns its schema and SQL. Read all referenced job states in one bounded query.
	ids := make([]int64, 0, len(rows))
	for _, row := range rows[:min(100, len(rows))] {
		if row.JobID > 0 {
			ids = append(ids, row.JobID)
		}
	}
	states := map[int64]string{}
	if len(ids) > 0 {
		jobs, err := n.queue.JobList(ctx, river.NewJobListParams().IDs(ids...).First(100))
		if err != nil {
			return NetworkPage{}, ErrNetworkUnavailable
		}
		for _, job := range jobs.Jobs {
			states[job.ID] = string(job.State)
		}
	}
	for _, row := range rows[:min(100, len(rows))] {
		result := networkRow(control.NetworkBySlugRow(row))
		result.ProvisionStatus = networkState(row.ProvisionState == "ready" && row.SchemaVersion > 0, states[row.JobID])
		page.Items = append(page.Items, result)
	}
	if len(rows) > 100 {
		page.NextCursor = page.Items[len(page.Items)-1].Slug
	}
	if err := n.loadProfiles(ctx, page.Items); err != nil {
		return NetworkPage{}, err
	}
	return page, nil
}
func (n *Networks) Create(ctx context.Context, in tenancy.ProvisionInput) (Network, error) {
	return n.CreateWithProfile(ctx, in, NetworkProfile{})
}
func (n *Networks) CreateWithProfile(ctx context.Context, in tenancy.ProvisionInput, profile NetworkProfile) (Network, error) {
	if err := RequirePlatform(ctx, true); err != nil {
		return Network{}, err
	}
	if !tenancy.ValidateProvisionInput(in) || !validProfile(profile) {
		return Network{}, ErrNetworkInvalid
	}
	tx, err := n.pool.Begin(ctx)
	if err != nil {
		return Network{}, ErrNetworkUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	if q.LockNetworkSlug(ctx, in.Slug) != nil {
		return Network{}, ErrNetworkUnavailable
	}
	existing, err := q.NetworkBySlug(ctx, in.Slug)
	if err == nil {
		if existing.LegalName != in.LegalName || existing.Cnpj != in.CNPJ || uuid.UUID(existing.PlanID.Bytes) != in.PlanID || existing.Generation < 1 {
			return Network{}, ErrNetworkConflict
		}
		saved, e := loadProfile(ctx, tx, uuid.UUID(existing.ID.Bytes))
		if e != nil {
			return Network{}, e
		}
		if saved.Data != profile {
			return Network{}, ErrNetworkConflict
		}
		result, e := n.state(ctx, tx, existing)
		result.Profile = &saved
		return result, e // Exact retries never enqueue duplicate work.
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Network{}, ErrNetworkUnavailable
	}
	plan, err := q.ActiveProvisionPlan(ctx, planUUID(in.PlanID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Network{}, ErrNetworkInvalid
	}
	if err != nil {
		return Network{}, ErrNetworkUnavailable
	}
	id, err := uuid.NewV7()
	if err != nil {
		return Network{}, ErrNetworkUnavailable
	}
	subscription, err := uuid.NewV7()
	if err != nil {
		return Network{}, ErrNetworkUnavailable
	}
	if err := q.ReserveTenant(ctx, control.ReserveTenantParams{ID: planUUID(id), Slug: in.Slug, LegalName: in.LegalName, Cnpj: in.CNPJ, SchemaName: "t_" + in.Slug, DbRole: "r_" + in.Slug}); err != nil {
		return Network{}, networkError(err)
	}
	if q.ReserveTenantSubscription(ctx, control.ReserveTenantSubscriptionParams{ID: planUUID(subscription), TenantID: planUUID(id), PlanID: planUUID(in.PlanID)}) != nil || q.ReserveTenantProvisioning(ctx, planUUID(id)) != nil {
		return Network{}, ErrNetworkUnavailable
	}
	raw, e := json.Marshal(profile)
	if e != nil {
		return Network{}, ErrNetworkInvalid
	}
	if _, e = tx.Exec(ctx, "INSERT INTO core.network_profiles(tenant_id,data) VALUES($1,$2)", id, raw); e != nil {
		return Network{}, ErrNetworkUnavailable
	}
	if e = auditProfile(ctx, tx, id, 1); e != nil {
		return Network{}, e
	}
	if err := n.enqueue(ctx, tx, id, 1, in); err != nil {
		return Network{}, err
	}
	if tx.Commit(ctx) != nil {
		return Network{}, ErrNetworkUnavailable
	}
	return Network{ID: id, Slug: in.Slug, LegalName: in.LegalName, CNPJ: in.CNPJ, Status: "trial", PlanName: plan.Name, PlanID: in.PlanID, ProvisionStatus: "queued", Generation: 1, Profile: &ProfileVersion{Data: profile, Version: 1}}, nil
}
func (n *Networks) Retry(ctx context.Context, id uuid.UUID, generation int32) (Network, error) {
	if err := RequirePlatform(ctx, true); err != nil {
		return Network{}, err
	}
	if id == uuid.Nil || generation < 1 || generation == math.MaxInt32 {
		return Network{}, ErrNetworkInvalid
	}
	tx, err := n.pool.Begin(ctx)
	if err != nil {
		return Network{}, ErrNetworkUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	slug, err := q.NetworkSlug(ctx, planUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Network{}, ErrNetworkNotFound
	}
	if err != nil {
		return Network{}, ErrNetworkUnavailable
	}
	if q.LockNetworkSlug(ctx, slug) != nil {
		return Network{}, ErrNetworkUnavailable
	}
	row, err := q.NetworkBySlug(ctx, slug)
	if err != nil {
		return Network{}, ErrNetworkUnavailable
	}
	if row.Generation != generation || row.Status != "trial" && row.Status != "active" {
		return Network{}, ErrNetworkConflict
	}
	current, err := n.state(ctx, tx, row)
	if err != nil {
		return Network{}, err
	}
	if current.ProvisionStatus != "failed" {
		return Network{}, ErrNetworkConflict
	}
	previous, err := q.NetworkWork(ctx, control.NetworkWorkParams{TenantID: row.ID, Generation: generation, JobID: row.JobID})
	if err != nil {
		return Network{}, ErrNetworkConflict
	}
	in := tenancy.ProvisionInput{Slug: previous.Slug, LegalName: previous.LegalName, CNPJ: previous.Cnpj, PlanID: uuid.UUID(previous.PlanID.Bytes)}
	if err := n.enqueue(ctx, tx, id, generation+1, in); err != nil {
		return Network{}, err
	}
	if tx.Commit(ctx) != nil {
		return Network{}, ErrNetworkUnavailable
	}
	current.Generation++
	current.ProvisionStatus = "queued"
	return current, nil
}
func (n *Networks) enqueue(ctx context.Context, tx pgx.Tx, id uuid.UUID, generation int32, in tenancy.ProvisionInput) error {
	principal, _ := auth.Principal(ctx)
	job, err := n.queue.InsertTx(ctx, tx, provisionqueue.Args{TenantID: id, Generation: generation}, &river.InsertOpts{Queue: n.queueName, MaxAttempts: 1})
	if err != nil {
		return ErrNetworkUnavailable
	}
	q := control.New(tx)
	if q.InsertNetworkRequest(ctx, control.InsertNetworkRequestParams{TenantID: planUUID(id), Generation: generation, JobID: job.Job.ID, ActorUserID: planUUID(principal.UserID()), Slug: in.Slug, LegalName: in.LegalName, Cnpj: in.CNPJ, PlanID: planUUID(in.PlanID)}) != nil {
		return ErrNetworkUnavailable
	}
	action := "hq.tenant_created"
	if generation > 1 {
		action = "hq.tenant_retry"
	}
	if q.AuditNetworkRequest(ctx, control.AuditNetworkRequestParams{TenantID: planUUID(id), ActorUserID: planUUID(principal.UserID()), Action: action, Target: pgtype.Text{String: id.String(), Valid: true}, Generation: generation}) != nil {
		return ErrNetworkUnavailable
	}
	return nil
}
func networkError(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		return ErrNetworkConflict
	}
	return ErrNetworkUnavailable
}
