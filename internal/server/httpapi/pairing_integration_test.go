//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"github.com/crmf/crmf/internal/server/httpapi/appcontract"
	"github.com/google/uuid"
	"strings"
	"sync"
	"testing"
)

func exercisePairing(t *testing.T, f *httpFixture, s appcontract.HQStore) {
	t.Helper()
	ctx := context.Background()
	actor := f.user
	t.Cleanup(func() {
		if _, e := f.admin.Exec(ctx, "DELETE FROM core.pairing_issuers WHERE actor_id=$1", actor); e != nil {
			t.Error(e)
		}
	})
	path := "/v1/hq/stores/" + s.Id.String() + "/pairing"
	body := map[string]any{"store_version": s.Version, "previous_id": ""}
	for _, bad := range []any{map[string]any{"store_version": 1}, map[string]any{"store_version": 1, "previous_id": nil}, map[string]any{"store_version": 1, "previous_id": "", "tenant_id": s.TenantId}, map[string]any{"store_version": 1, "previous_id": "invalid"}} {
		if r, _ := f.request(t, "POST", path, bad, true); r.StatusCode != 400 {
			t.Fatal("ambiguous input accepted")
		}
	}
	if r, _ := f.request(t, "POST", path, body, false); r.StatusCode != 403 {
		t.Fatal("pairing CSRF")
	}
	if r, _ := f.request(t, "GET", path+"?code=x", nil, false); r.StatusCode != 400 {
		t.Fatal("secret query accepted")
	}
	if r, b := f.request(t, "GET", path, nil, false); r.StatusCode != 200 || strings.TrimSpace(string(b)) != "{}" {
		t.Fatal("empty metadata")
	}
	type issue struct {
		Current appcontract.PairingMetadata
		Code    string
	}
	type result struct {
		status int
		raw    []byte
	}
	ch := make(chan result, 4)
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() { defer wg.Done(); r, b := f.request(t, "POST", path, body, true); ch <- result{r.StatusCode, b} }()
	}
	wg.Wait()
	close(ch)
	var issued issue
	winners, conflicts := 0, 0
	for r := range ch {
		switch r.status {
		case 201:
			winners++
			if json.Unmarshal(r.raw, &issued) != nil {
				t.Fatal("issued JSON")
			}
		case 409:
			conflicts++
		default:
			t.Errorf("unexpected issue status %d", r.status)
		}
	}
	if winners != 1 || conflicts != 3 || t.Failed() {
		t.Fatalf("issuance CAS %d/%d", winners, conflicts)
	}
	if len(issued.Code) != 8 || issued.Current.StoreId != s.Id || issued.Current.Status != "pending" {
		t.Fatal("bad issue projection")
	}
	digest := sha256.Sum256([]byte(issued.Code))
	var hash []byte
	var valid bool
	if e := f.admin.QueryRow(ctx, "SELECT code_hash,store_version=$2 AND expires_at-created_at=interval '72 hours' FROM core.pairing_codes WHERE id=$1", issued.Current.Id, s.Version).Scan(&hash, &valid); e != nil || !valid || !bytes.Equal(hash, digest[:]) {
		t.Fatal("code hash or TTL")
	}
	for range 2 {
		r, b := f.request(t, "GET", path, nil, false)
		if r.StatusCode != 200 || strings.Contains(string(b), issued.Code) || strings.Contains(string(b), "code_hash") || strings.Contains(string(b), "\"code\"") {
			t.Fatal("code recoverable")
		}
	}
	var audit string
	if f.admin.QueryRow(ctx, "SELECT detail::text FROM core.audit_log WHERE tenant_id=$1 AND actor_user_id=$2 AND target=$3 AND action='hq.pairing_issued' ORDER BY id DESC LIMIT 1", s.TenantId, actor, s.Id.String()).Scan(&audit) != nil || strings.Contains(audit, issued.Code) || !strings.Contains(audit, issued.Current.Id.String()) {
		t.Fatal("audit projection")
	}
	body["previous_id"] = issued.Current.Id.String()
	if r, _ := f.request(t, "POST", path, body, true); r.StatusCode != 429 {
		t.Fatal("store cooldown bypassed")
	}
	wrong := "/v1/hq/stores/" + uuid.NewString() + "/pairing/" + issued.Current.Id.String()
	if r, _ := f.request(t, "DELETE", wrong, nil, true); r.StatusCode != 404 {
		t.Fatal("wrong store revoke")
	}
	if r, _ := f.request(t, "DELETE", path+"/"+issued.Current.Id.String(), nil, true); r.StatusCode != 204 {
		t.Fatal("revoke")
	}
	r, b := f.request(t, "GET", path, nil, false)
	if r.StatusCode != 200 || !strings.Contains(string(b), "revoked") {
		t.Fatal("revoked metadata")
	}
	if _, e := f.admin.Exec(ctx, "UPDATE core.pairing_codes SET revoked_at=NULL WHERE id=$1", issued.Current.Id); e == nil {
		t.Fatal("terminal state mutable")
	}
	// Only this fixture's rows are replaced to exercise clocks without sleeps or changing immutable history.
	if _, e := f.admin.Exec(ctx, "DELETE FROM core.pairing_codes WHERE store_id=$1", s.Id); e != nil {
		t.Fatal(e)
	}
	key := uuid.New()
	if _, e := f.admin.Exec(ctx, "INSERT INTO core.pairing_codes(id,code_hash,store_id,store_version,created_at,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()-interval '73 hours',clock_timestamp()-interval '1 hour')", key, digest[:], s.Id, s.Version); e != nil {
		t.Fatal(e)
	}
	if r, b = f.request(t, "GET", path, nil, false); r.StatusCode != 200 || !strings.Contains(string(b), "expired") {
		t.Fatal("expiry metadata")
	}
	body["previous_id"] = key.String()
	body["store_version"] = s.Version + 1
	if r, _ = f.request(t, "POST", path, body, true); r.StatusCode != 409 {
		t.Fatal("stale store revision")
	}
	body["store_version"] = s.Version
	r, b = f.request(t, "POST", path, body, true)
	if r.StatusCode != 201 {
		t.Fatalf("replace expired %d", r.StatusCode)
	}
	if json.Unmarshal(b, &issued) != nil {
		t.Fatal("replace JSON")
	}
	if _, e := f.admin.Exec(ctx, "UPDATE core.stores SET name=name WHERE id=$1", s.Id); e != nil {
		t.Fatal(e)
	}
	if r, b = f.request(t, "GET", path, nil, false); r.StatusCode != 200 || !strings.Contains(string(b), "invalidated") {
		t.Fatal("configuration edit did not invalidate")
	}
	body["previous_id"] = issued.Current.Id.String()
	body["store_version"] = s.Version + 1
	if _, e := f.admin.Exec(ctx, "UPDATE core.pairing_issuers SET issued=5 WHERE actor_id=$1", actor); e != nil {
		t.Fatal(e)
	}
	if r, _ = f.request(t, "POST", path, body, true); r.StatusCode != 429 {
		t.Fatal("actor limit bypassed")
	}
	// Issuing/revoking never fabricates a device.
	var count int
	if f.admin.QueryRow(ctx, "SELECT count(*) FROM core.devices WHERE store_id=$1", s.Id).Scan(&count) != nil || count != 0 {
		t.Fatal("device fabricated")
	}
}
