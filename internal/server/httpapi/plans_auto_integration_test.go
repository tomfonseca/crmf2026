//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"strings"
	"sync"
	"testing"
)

func TestHQAutomaticPlanCodesAreUniqueAuditedAndImmutable(t *testing.T) {
	f := newHTTPFixture(t, false)
	device := catalogPlatform(t, f, "platform_admin", nil)
	ctx := context.Background()
	var created []appcontract.Plan
	t.Cleanup(func() {
		for _, plan := range created {
			_, _ = f.admin.Exec(context.Background(), "DELETE FROM core.plans WHERE id=$1 AND code=$2", plan.Id, plan.Code)
		}
	})
	body := planPayload("")
	delete(body, "code")
	for _, invalid := range []any{nil, "", "P01", 123} {
		bad := planPayload("")
		bad["code"] = invalid
		if response, _ := f.request(t, "POST", "/v1/hq/plans", bad, true); response.StatusCode != 400 {
			t.Fatal("invalid optional code accepted", response.StatusCode)
		}
	}
	type result struct {
		status int
		data   []byte
	}
	results := make(chan result, 4)
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			response, data := f.request(t, "POST", "/v1/hq/plans", body, true)
			results <- result{response.StatusCode, data}
		}()
	}
	wg.Wait()
	close(results)
	seen := map[string]bool{}
	for result := range results {
		var plan appcontract.Plan
		if err := json.Unmarshal(result.data, &plan); err != nil || result.status != 201 {
			t.Errorf("automatic creation failed: status=%d", result.status)
			continue
		}
		created = append(created, plan)
		if plan.Code != "p_"+strings.ReplaceAll(plan.Id.String(), "-", "") || seen[plan.Code] {
			t.Error("invalid or duplicate automatic code")
		}
		seen[plan.Code] = true
		var count int
		if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM core.audit_log WHERE actor_user_id=$1 AND target=$2 AND action='hq.plan_created'", f.user, plan.Id.String()).Scan(&count); err != nil || count != 1 {
			t.Error("automatic code not atomically audited", err)
		}
	}
	if len(created) != 4 || t.Failed() {
		return
	}
	plan := created[0]
	update := planPayload("illegal_change")
	update["version"] = 1
	if response, _ := f.request(t, "PUT", "/v1/hq/plans/"+plan.Id.String(), update, true); response.StatusCode != 400 {
		t.Fatal("code mutable through update")
	}
	delete(update, "code")
	response, data := f.request(t, "PUT", "/v1/hq/plans/"+plan.Id.String(), update, true)
	var updated appcontract.Plan
	if err := json.Unmarshal(data, &updated); err != nil || response.StatusCode != 200 || updated.Code != plan.Code {
		t.Fatal("automatic code changed after update")
	}
	catalogPlatform(t, f, "platform_support", device)
	if response, _ := f.request(t, "POST", "/v1/hq/plans", body, true); response.StatusCode != 403 {
		t.Fatal("automatic generation bypassed write authorization")
	}
}
