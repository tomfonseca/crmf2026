//go:build integration

package integration

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/migrate"
	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const tenancyControl = "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_control?sslmode=disable"
const tenancyAnalytics = "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_analytics?sslmode=disable"
const tenancyCore = "postgres://crmf_core:crmf_local_core_only@localhost:55432/crmf_control?sslmode=disable"
const tenancyReader = "postgres://crmf_platform_reader:crmf_local_platform_reader_only@localhost:55432/crmf_analytics?sslmode=disable"

type failingTenantStore struct {
	tenancy.Credentials
	fail bool
}

func (s *failingTenantStore) Create(ctx context.Context, id uuid.UUID, slug string) (tenancy.Credential, error) {
	if s.fail {
		return tenancy.Credential{}, tenancy.ErrUnavailable
	}
	return s.Credentials.Create(ctx, id, slug)
}

func TestTenantProvisioningAndDatabaseIsolation(t *testing.T) {
	ctx, stop := context.WithTimeout(context.Background(), 90*time.Second)
	defer stop()
	if err := migrate.Up(ctx, tenancyControl, "control"); err != nil {
		t.Fatal(err)
	}
	if err := migrate.Up(ctx, tenancyAnalytics, "platform"); err != nil {
		t.Fatal(err)
	}
	admin, err := pgx.Connect(ctx, tenancyControl)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = admin.Close(context.Background()) }()
	analytics, err := pgx.Connect(ctx, tenancyAnalytics)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = analytics.Close(context.Background()) }()
	core, err := pgxpool.New(ctx, tenancyCore)
	if err != nil {
		t.Fatal(err)
	}
	defer core.Close()
	files, err := tenancy.NewDevelopmentFiles(filepath.Join(t.TempDir(), "private-credentials"), true)
	if err != nil {
		t.Fatal(err)
	}
	store := &failingTenantStore{Credentials: files}
	p, err := tenancy.OpenProvisioner(ctx, tenancyControl, tenancyAnalytics, store)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if bad, err := tenancy.OpenProvisioner(ctx, tenancyCore, tenancyAnalytics, files); err == nil {
		bad.Close()
		t.Fatal("runtime role accepted as provisioner")
	}
	sessions, err := auth.Open(ctx, "postgres://crmf_auth:crmf_local_auth_only@localhost:55432/crmf_control?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer sessions.Close()
	manager, err := tenancy.NewManager(ctx, core, tenancyReader, files)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	if _, err := manager.Pool(ctx); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal("anonymous tenant selector accepted")
	}

	plan := uuid.New()
	var inputs []tenancy.ProvisionInput
	var users []uuid.UUID
	// Cleanup targets only UUID-namespaced synthetic fixtures, never real tenants.
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		for _, user := range users {
			_, _ = admin.Exec(c, "DELETE FROM auth.users WHERE id=$1", user)
		}
		for _, in := range inputs {
			schema, role := "t_"+in.Slug, "r_"+in.Slug
			_, _ = analytics.Exec(c, "DROP SCHEMA IF EXISTS "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
			if _, err := analytics.Exec(c, "REVOKE ALL ON DATABASE crmf_analytics FROM "+pgx.Identifier{role}.Sanitize()); err != nil {
				t.Error("fixture cleanup failed", err)
			}
			if _, err := analytics.Exec(c, "DROP ROLE IF EXISTS "+pgx.Identifier{role}.Sanitize()); err != nil {
				t.Error("fixture role remained", err)
			}
			_, _ = admin.Exec(c, "DELETE FROM core.tenant_provisioning WHERE tenant_id IN(SELECT id FROM core.tenants WHERE slug=$1)", in.Slug)
			_, _ = admin.Exec(c, "DELETE FROM core.subscriptions WHERE tenant_id IN(SELECT id FROM core.tenants WHERE slug=$1)", in.Slug)
			_, _ = admin.Exec(c, "DELETE FROM core.tenants WHERE slug=$1", in.Slug)
		}
		_, _ = admin.Exec(c, "DELETE FROM core.plans WHERE id=$1", plan)
	}()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := admin.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO core.plans(id,code,name,price_cents,sync_interval_seconds,history_months,modules) VALUES($1,$2,'Synthetic tenancy test',0,180,12,ARRAY['core'])", plan, "tn-"+plan.String())
	input := func() tenancy.ProvisionInput {
		slug := "tn_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		in := tenancy.ProvisionInput{Slug: slug, LegalName: "Synthetic tenancy fixture", CNPJ: strings.ToUpper(slug[3:15]) + "00", PlanID: plan}
		inputs = append(inputs, in)
		return in
	}
	principal := func(tenant uuid.UUID, platform bool) context.Context {
		t.Helper()
		user := uuid.New()
		users = append(users, user)
		exec("INSERT INTO auth.users(id,email,name,status)VALUES($1,$2,'Synthetic tenancy user','active')", user, user.String()+"@example.invalid")
		realm := auth.Tenant
		if platform {
			realm = auth.Platform
			exec("INSERT INTO auth.user_grants(id,user_id,role)VALUES($1,$2,'platform_support')", uuid.New(), user)
			exec("INSERT INTO auth.passkey_credentials(credential_id,user_id,realm,credential_enc,created_at,updated_at)VALUES($1,$2,'platform',decode(repeat('11',64),'hex'),now(),now())", []byte(user.String()), user)
		} else {
			exec("INSERT INTO auth.user_grants(id,user_id,role,tenant_id)VALUES($1,$2,'network_admin',$3)", uuid.New(), user, tenant)
		}
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(raw)
		now := time.Now().UTC()
		exec("INSERT INTO auth.user_sessions(id,user_id,token_hash,realm,mfa_verified,last_seen_at,idle_expires_at,expires_at,created_at)VALUES($1,$2,$3,$4,true,$5,$6,$7,$5)", uuid.New(), user, digest[:], string(realm), now, now.Add(15*time.Minute), now.Add(time.Hour))
		authenticated, err := sessions.Authenticate(ctx, base64.RawURLEncoding.EncodeToString(raw), realm)
		if err != nil {
			t.Fatal(err)
		}
		return authenticated
	}
	if _, err := manager.Pool(principal(uuid.Nil, true)); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal("platform entered tenant pool")
	}
	aIn, bIn := input(), input()
	a, err := p.Provision(ctx, aIn)
	if err != nil {
		t.Fatal("provision A", err)
	}
	b, err := p.Provision(ctx, bIn)
	if err != nil {
		t.Fatal("provision B", err)
	}
	if a.ID == b.ID || a.SchemaVersion != 1 || b.SchemaVersion != 1 {
		t.Fatal("incorrect provisioned identity/version")
	}
	secret, err := files.Get(ctx, a.ID, aIn.Slug, "")
	if err != nil {
		t.Fatal(err)
	}
	again, err := p.Provision(ctx, aIn)
	if err != nil || again != a {
		t.Fatal("not idempotent", err)
	}
	second, err := files.Get(ctx, a.ID, aIn.Slug, secret.Version)
	if err != nil || second.Password != secret.Password {
		t.Fatal("rerun rotated credential")
	}
	var audits int
	execCount := func(query string, args ...any) int {
		t.Helper()
		var n int
		if err := admin.QueryRow(ctx, query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	audits = execCount("SELECT count(*) FROM core.audit_log WHERE tenant_id=$1", a.ID)
	if audits != 2 {
		t.Fatal("duplicate/missing audit", audits)
	}
	changed := aIn
	changed.LegalName = "Different fixture"
	if _, err := p.Provision(ctx, changed); !errors.Is(err, tenancy.ErrConflict) {
		t.Fatal("identity silently overwritten")
	}
	changed = aIn
	changed.Slug = "bad;DROP SCHEMA public"
	if _, err := p.Provision(ctx, changed); !errors.Is(err, tenancy.ErrInvalid) {
		t.Fatal("unsafe slug accepted")
	}

	aCtx, bCtx := principal(a.ID, false), principal(b.ID, false)
	pa, err := manager.Pool(aCtx)
	if err != nil {
		t.Fatal("pool A", err)
	}
	pb, err := manager.Pool(bCtx)
	if err != nil {
		t.Fatal("pool B", err)
	}
	if pa == pb || pa.Config().MaxConns != 4 {
		t.Fatal("shared or unbounded tenant pool")
	}
	for _, in := range []tenancy.ProvisionInput{aIn, bIn} {
		query := "CREATE TABLE " + pgx.Identifier{"t_" + in.Slug, "isolation_fixture"}.Sanitize() + "(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,value text)"
		if _, err := analytics.Exec(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pa.Exec(aCtx, "INSERT INTO isolation_fixture(value)VALUES('synthetic-A')"); err != nil {
		t.Fatal("own DML/default grants", err)
	}
	if _, err := pb.Exec(bCtx, "INSERT INTO isolation_fixture(value)VALUES('synthetic-B')"); err != nil {
		t.Fatal("own DML", err)
	}
	var value string
	if err := pa.QueryRow(aCtx, "SELECT value FROM isolation_fixture").Scan(&value); err != nil || value != "synthetic-A" {
		t.Fatal("wrong tenant data")
	}
	denied := func(pool *pgxpool.Pool, query string) {
		t.Helper()
		_, err := pool.Exec(ctx, query)
		var pg *pgconn.PgError
		if !errors.As(err, &pg) || pg.Code != "42501" {
			t.Fatalf("expected 42501 for %s; got %v", query, err)
		}
	}
	denied(pa, "SELECT * FROM "+pgx.Identifier{"t_" + bIn.Slug, "isolation_fixture"}.Sanitize())
	denied(pb, "INSERT INTO "+pgx.Identifier{"t_" + aIn.Slug, "isolation_fixture"}.Sanitize()+"(value)VALUES('forbidden')")
	denied(pa, "SET ROLE crmf_migrator")
	denied(pa, "SET ROLE crmf_platform_reader")
	denied(pa, "SET ROLE "+pgx.Identifier{"r_" + bIn.Slug}.Sanitize())
	denied(pa, "CREATE TABLE forbidden(id int)")
	denied(pa, "CREATE TEMP TABLE forbidden(id int)")
	denied(pa, "DELETE FROM goose_db_version")
	denied(pa, "SELECT * FROM platform.goose_db_version")
	denied(core, "UPDATE core.tenant_provisioning SET state='pending' WHERE tenant_id='"+a.ID.String()+"'")
	// A tenant password cannot connect to the control database.
	cfg, _ := pgx.ParseConfig(tenancyControl)
	cfg.User = "r_" + aIn.Slug
	cfg.Password = secret.Password
	if conn, err := pgx.ConnectConfig(ctx, cfg); err == nil {
		_ = conn.Close(ctx)
		t.Fatal("tenant entered control database")
	}
	exec("UPDATE core.subscriptions SET status='suspended' WHERE tenant_id=$1", a.ID)
	if _, err := manager.Pool(aCtx); !errors.Is(err, auth.ErrSuspended) {
		t.Fatal("cached pool bypassed suspension")
	}
	exec("UPDATE core.subscriptions SET status='active' WHERE tenant_id=$1", a.ID)
	if cached, err := manager.Pool(aCtx); err != nil || cached != pa {
		t.Fatal("pool cache broken")
	}
	// Synthetic recovery checkpoint: data/role already committed, core not ready.
	exec("UPDATE core.tenant_provisioning SET state='pending' WHERE tenant_id=$1", a.ID)
	exec("UPDATE core.tenants SET schema_version=0 WHERE id=$1", a.ID)
	if _, err := manager.Pool(aCtx); !errors.Is(err, auth.ErrSuspended) {
		t.Fatal("pending tenant obtained pool")
	}
	if _, err := p.Provision(ctx, aIn); err != nil {
		t.Fatal("resume after analytics commit", err)
	}
	if err := pa.QueryRow(aCtx, "SELECT value FROM isolation_fixture").Scan(&value); err != nil || value != "synthetic-A" {
		t.Fatal("resume destroyed data")
	}

	pending := input()
	store.fail = true
	if _, err := p.Provision(ctx, pending); !errors.Is(err, tenancy.ErrUnavailable) {
		t.Fatal("credential failure ignored")
	}
	if execCount("SELECT count(*) FROM core.tenants WHERE slug=$1 AND schema_version=0", pending.Slug) != 1 {
		t.Fatal("failed attempt not reserved")
	}
	store.fail = false
	if _, err := p.Provision(ctx, pending); err != nil {
		t.Fatal("retry failed credential custody", err)
	}
	// Concurrent callers share a single context-bound pool, never another tenant.
	var concurrent sync.WaitGroup
	for range 20 {
		concurrent.Go(func() {
			pool, err := manager.Pool(aCtx)
			if err != nil || pool != pa {
				t.Error("concurrent pool lookup diverged", err)
			}
		})
	}
	concurrent.Wait()
	// A ready schema that disappears must not be silently recreated empty.
	lostInput := input()
	lost, err := p.Provision(ctx, lostInput)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := analytics.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{"t_" + lostInput.Slug}.Sanitize()+" CASCADE"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Provision(ctx, lostInput); !errors.Is(err, tenancy.ErrConflict) {
		t.Fatal("missing ready schema recreated", lost.ID, err)
	}
	// Refuse a pre-existing role, even if an operator owns it.
	foreign := input()
	if _, err := analytics.Exec(ctx, "CREATE ROLE "+pgx.Identifier{"r_" + foreign.Slug}.Sanitize()+" NOLOGIN"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Provision(ctx, foreign); !errors.Is(err, tenancy.ErrConflict) {
		t.Fatal("foreign role adopted", err)
	}
	// The session advisory lock serializes independent privileged connections.
	gatedInput := input()
	gated := &gatedTenantStore{Credentials: files, entered: make(chan struct{}), release: make(chan struct{})}
	otherProvisioner, err := tenancy.OpenProvisioner(ctx, tenancyControl, tenancyAnalytics, gated)
	if err != nil {
		t.Fatal(err)
	}
	defer otherProvisioner.Close()
	result := make(chan error, 1)
	go func() { _, err := otherProvisioner.Provision(ctx, gatedInput); result <- err }()
	select {
	case <-gated.entered:
	case <-ctx.Done():
		t.Fatal("provisioning did not reach credential custody")
	}
	_, busyErr := p.Provision(ctx, gatedInput)
	close(gated.release)
	if err := <-result; err != nil {
		t.Fatal("serialized provision failed", err)
	}
	if !errors.Is(busyErr, tenancy.ErrBusy) {
		t.Fatal("concurrent provisioner was not rejected", busyErr)
	}
	// Missing original credential is never replaced, even if metadata is ready.
	missing := &failingTenantStore{Credentials: missingTenantStore{}}
	recoverer, err := tenancy.OpenProvisioner(ctx, tenancyControl, tenancyAnalytics, missing)
	if err != nil {
		t.Fatal(err)
	}
	defer recoverer.Close()
	if _, err := recoverer.Provision(ctx, bIn); !errors.Is(err, tenancy.ErrCredentialMissing) {
		t.Fatal("lost credential reset or ignored")
	}
}

type gatedTenantStore struct {
	tenancy.Credentials
	entered, release chan struct{}
}

func (s *gatedTenantStore) Get(ctx context.Context, id uuid.UUID, slug, version string) (tenancy.Credential, error) {
	close(s.entered)
	select {
	case <-s.release:
		return s.Credentials.Get(ctx, id, slug, version)
	case <-ctx.Done():
		return tenancy.Credential{}, ctx.Err()
	}
}

type missingTenantStore struct{}

func (missingTenantStore) Get(context.Context, uuid.UUID, string, string) (tenancy.Credential, error) {
	return tenancy.Credential{}, tenancy.ErrCredentialMissing
}
func (missingTenantStore) Create(context.Context, uuid.UUID, string) (tenancy.Credential, error) {
	panic("must not recreate original credential")
}
