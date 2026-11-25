//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/crmf/crmf/internal/server/provisionqueue"
	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const networkControl = "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_control?sslmode=disable"
const networkAnalytics = "postgres://crmf_migrator:crmf_local_migrator_only@localhost:55432/crmf_analytics?sslmode=disable"

type networkFlakyStore struct {
	tenancy.Credentials
	fail atomic.Bool
}

func (s *networkFlakyStore) Get(ctx context.Context, id uuid.UUID, slug, version string) (tenancy.Credential, error) {
	if s.fail.Load() {
		return tenancy.Credential{}, tenancy.ErrUnavailable
	}
	return s.Credentials.Get(ctx, id, slug, version)
}
func TestHQNetworkQueueProvisionRetryAndAuthorization(t *testing.T) {
	f := newHTTPFixture(t, false)
	ctx := context.Background()
	if err := provisionqueue.Migrate(ctx, networkControl); err != nil {
		t.Fatal("queue migration", err)
	}
	slug := "nw_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	planCode := "nw_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	var id, plan uuid.UUID
	t.Cleanup(func() {
		c, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		if id != uuid.Nil {
			a, err := pgx.Connect(c, networkAnalytics)
			if err != nil {
				t.Error(err)
			} else {
				defer func() { _ = a.Close(c) }()
				if _, err := a.Exec(c, "DROP SCHEMA IF EXISTS "+pgx.Identifier{"t_" + slug}.Sanitize()+" CASCADE"); err != nil {
					t.Error(err)
				}
				var exists bool
				_ = a.QueryRow(c, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)", "r_"+slug).Scan(&exists)
				if exists {
					if _, err := a.Exec(c, "REVOKE ALL ON DATABASE crmf_analytics FROM "+pgx.Identifier{"r_" + slug}.Sanitize()); err != nil {
						t.Error(err)
					}
					if _, err := a.Exec(c, "DROP ROLE "+pgx.Identifier{"r_" + slug}.Sanitize()); err != nil {
						t.Error(err)
					}
				}
			}
			for _, query := range []string{
				"DELETE FROM jobs.river_job WHERE id IN(SELECT job_id FROM core.network_requests WHERE tenant_id=$1)",
				"DELETE FROM core.network_requests WHERE tenant_id=$1", "DELETE FROM core.tenant_provisioning WHERE tenant_id=$1",
				"DELETE FROM core.subscriptions WHERE tenant_id=$1", "DELETE FROM core.tenants WHERE id=$1",
			} {
				if _, err := f.admin.Exec(c, query, id); err != nil {
					t.Error("cleanup network fixture", err)
				}
			}
		}
		if plan != uuid.Nil {
			if _, err := f.admin.Exec(c, "DELETE FROM core.plans WHERE id=$1", plan); err != nil {
				t.Error(err)
			}
		}
	})
	if response, _ := f.request(t, "GET", "/v1/hq/tenants", nil, false); response.StatusCode != 401 {
		t.Fatal("anonymous network access")
	}
	if result := f.login(t); result.Status != appcontract.Authenticated {
		t.Fatal("tenant login")
	}
	if response, _ := f.request(t, "GET", "/v1/hq/tenants", nil, false); response.StatusCode != 401 {
		t.Fatal("tenant cookie used in QG")
	}
	device := catalogPlatform(t, f, "platform_admin", nil)
	response, raw := f.request(t, "POST", "/v1/hq/plans", planPayload(planCode), true)
	if response.StatusCode != 201 {
		t.Fatal("create fixture plan")
	}
	var createdPlan appcontract.Plan
	if json.Unmarshal(raw, &createdPlan) != nil {
		t.Fatal("decode plan")
	}
	plan = createdPlan.Id
	body := map[string]any{"slug": slug, "legal_name": "Synthetic QG network", "cnpj": strings.ToUpper(slug[3:15]) + "00", "plan_id": plan.String()}
	if response, _ := f.request(t, "POST", "/v1/hq/tenants", body, false); response.StatusCode != 403 {
		t.Fatal("missing CSRF accepted")
	}
	body["actor_user_id"] = uuid.NewString()
	if response, _ := f.request(t, "POST", "/v1/hq/tenants", body, true); response.StatusCode != 400 {
		t.Fatal("client actor accepted")
	}
	delete(body, "actor_user_id")
	response, raw = f.request(t, "POST", "/v1/hq/tenants", body, true)
	if response.StatusCode != 202 {
		t.Fatalf("create network: %d %s", response.StatusCode, raw)
	}
	var network appcontract.Network
	if json.Unmarshal(raw, &network) != nil {
		t.Fatal("decode network")
	}
	id = network.Id
	if network.ProvisionStatus != appcontract.Queued || network.SchemaVersion != 0 {
		t.Fatal("reported ready before worker")
	}
	response, raw = f.request(t, "POST", "/v1/hq/tenants", body, true)
	var same appcontract.Network
	_ = json.Unmarshal(raw, &same)
	if response.StatusCode != 202 || same.Id != id || same.Generation != 1 {
		t.Fatal("duplicated creation")
	}
	var group sync.WaitGroup
	for range 4 {
		group.Go(func() {
			response, _ := f.request(t, "POST", "/v1/hq/tenants", body, true)
			if response.StatusCode != 202 {
				t.Error("concurrent exact retry failed", response.StatusCode)
			}
		})
	}
	group.Wait()
	body["legal_name"] = "Another identity"
	if response, _ := f.request(t, "POST", "/v1/hq/tenants", body, true); response.StatusCode != 409 {
		t.Fatal("slug identity changed")
	}
	body["legal_name"] = "Synthetic QG network"
	var count int
	if f.admin.QueryRow(ctx, "SELECT count(*) FROM core.network_requests WHERE tenant_id=$1", id).Scan(&count) != nil || count != 1 {
		t.Fatal("duplicate jobs")
	}
	// Real restricted role cannot forge readiness or mutate immutable intent.
	core, err := pgx.Connect(ctx, "postgres://crmf_core:crmf_local_core_only@localhost:55432/crmf_control?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = core.Close(ctx) }()
	if _, err := core.Exec(ctx, "UPDATE core.tenant_provisioning SET state='ready',secret_version='fake' WHERE tenant_id=$1", id); err == nil {
		t.Fatal("runtime forged readiness")
	}
	if _, err := core.Exec(ctx, "UPDATE core.network_requests SET actor_user_id=$2 WHERE tenant_id=$1", id, uuid.New()); err == nil {
		t.Fatal("runtime altered actor")
	}
	if _, err := core.Exec(ctx, "UPDATE jobs.river_job SET state='completed' WHERE id IN(SELECT job_id FROM core.network_requests WHERE tenant_id=$1)", id); err == nil {
		t.Fatal("runtime finished queue job")
	}
	store, err := tenancy.NewDevelopmentFiles(filepath.Join(t.TempDir(), "credentials"), true)
	if err != nil {
		t.Fatal(err)
	}
	flaky := &networkFlakyStore{Credentials: store}
	flaky.fail.Store(true)
	workerCtx, stopWorker := context.WithCancel(ctx)
	workerDone := make(chan error, 1)
	go func() {
		workerDone <- provisionqueue.Run(workerCtx, networkControl, networkAnalytics, flaky, slog.New(slog.NewTextHandler(io.Discard, nil)), "http_"+strings.ReplaceAll(f.user.String(), "-", ""))
	}()
	t.Cleanup(func() {
		stopWorker()
		select {
		case err := <-workerDone:
			if err != nil && !errors.Is(err, context.Canceled) {
				t.Error(err)
			}
		case <-time.After(15 * time.Second):
			t.Error("worker did not stop")
		}
	})
	find := func() appcontract.Network {
		t.Helper()
		response, raw := f.request(t, "GET", "/v1/hq/tenants", nil, false)
		if response.StatusCode != 200 {
			t.Fatalf("network list %d %s", response.StatusCode, raw)
		}
		var page struct {
			Items []appcontract.Network `json:"items"`
		}
		if json.Unmarshal(raw, &page) != nil {
			t.Fatal("decode page")
		}
		for _, row := range page.Items {
			if row.Id == id {
				return row
			}
		}
		t.Fatal("network disappeared")
		return appcontract.Network{}
	}
	wait := func(state appcontract.NetworkProvisionStatus) appcontract.Network {
		t.Helper()
		end := time.Now().Add(25 * time.Second)
		for time.Now().Before(end) {
			row := find()
			if row.ProvisionStatus == state {
				return row
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("provision state timeout", state)
		return appcontract.Network{}
	}
	failed := wait(appcontract.Failed)
	if failed.SchemaVersion != 0 {
		t.Fatal("failed network has ready version")
	}
	flaky.fail.Store(false)
	response, raw = f.request(t, "POST", "/v1/hq/tenants/"+id.String()+"/retry", map[string]int32{"generation": 1}, true)
	if response.StatusCode != 202 {
		t.Fatalf("retry %d %s", response.StatusCode, raw)
	}
	if response, _ := f.request(t, "POST", "/v1/hq/tenants/"+id.String()+"/retry", map[string]int32{"generation": 1}, true); response.StatusCode != 409 {
		t.Fatal("stale retry accepted")
	}
	ready := wait(appcontract.Ready)
	if ready.Id != id || ready.Generation != 2 || ready.SchemaVersion != 1 {
		t.Fatal("retry created a different network")
	}
	var actor uuid.UUID
	if err := f.admin.QueryRow(ctx, "SELECT actor_user_id FROM core.audit_log WHERE tenant_id=$1 AND action='tenant.provision_ready' ORDER BY id DESC LIMIT 1", id).Scan(&actor); err != nil || actor != f.user {
		t.Fatal("worker lost original actor", err)
	}
	catalogPlatform(t, f, "platform_support", device)
	if response, _ := f.request(t, "GET", "/v1/hq/tenants", nil, false); response.StatusCode != 200 {
		t.Fatal("support cannot read")
	}
	if response, _ := f.request(t, "POST", "/v1/hq/tenants", body, true); response.StatusCode != 403 {
		t.Fatal("support created network")
	}
	if response, _ := f.request(t, "POST", "/v1/hq/tenants/"+id.String()+"/retry", map[string]int32{"generation": 2}, true); response.StatusCode != 403 {
		t.Fatal("support retried network")
	}
}
