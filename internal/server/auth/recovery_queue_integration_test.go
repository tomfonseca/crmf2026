//go:build integration

package auth

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func recoveryFixture(t *testing.T, handler http.HandlerFunc) (*sessionFixture, *Engine, *LocalRecovery) {
	t.Helper()
	f, e, _ := newLoginFixture(t)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	mailer, err := NewLocalMailer(LocalMailOptions{Development: true, Endpoint: server.URL, TenantOrigin: "http://localhost:5174", PlatformOrigin: "http://localhost:5173"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mailer.Close)
	s, err := NewLocalRecovery(e, mailer)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		// Every test has its own random custody key, hence its own bucket namespace.
		keys := [][]byte{e.recoveryIndex("global", ""), e.recoveryIndex("ip", fixtureIP(f).Unmap().String()),
			e.recoveryIndex("recipient", f.user.String()+"@example.invalid")}
		for _, key := range keys {
			_, _ = f.admin.Exec(ctx, "DELETE FROM auth.recovery_limits WHERE key=$1", key)
		}
		_, _ = f.admin.Exec(ctx, "DELETE FROM auth.recovery_requests WHERE custody_id=$1", e.recoveryIndex("custody", ""))
		for _, realm := range []Realm{Tenant, Platform} {
			_, _ = f.admin.Exec(ctx, "DELETE FROM auth.recovery_requests WHERE recipient_key=$1", e.recoveryIndex("coalesce:"+string(realm), f.user.String()+"@example.invalid"))
		}
	})
	return f, e, s
}
func fixtureIP(f *sessionFixture) (ip netip.Addr) {
	raw := [16]byte(f.user)
	raw[0] = 0xfd
	return netip.AddrFrom16(raw)
}
func TestRecoveryQueueConcurrentClaimAndUncertainDelivery(t *testing.T) {
	var calls atomic.Int32
	f, e, s := recoveryFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		// A transport may accept the message and return an unexpected receipt.
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{"))
	})
	ctx := context.Background()
	email := f.user.String() + "@example.invalid"
	ip := fixtureIP(f)
	for range 3 {
		if err := s.Request(ctx, strings.ToUpper(email), Tenant, ip); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var enc []byte
	key := e.recoveryIndex("coalesce:"+string(Tenant), email)
	if err := f.admin.QueryRow(ctx, "SELECT count(*),min(encode(recipient_enc,'hex')) FROM auth.recovery_requests WHERE recipient_key=$1", key).Scan(&count, new(string)); err != nil || count != 1 {
		t.Fatal("requests not coalesced", err)
	}
	if err := f.admin.QueryRow(ctx, "SELECT recipient_enc FROM auth.recovery_requests WHERE recipient_key=$1", key).Scan(&enc); err != nil || strings.Contains(string(enc), email) {
		t.Fatal("recipient not sealed")
	}
	// Another request is silently limited, not an account/rate oracle.
	if err := s.Request(ctx, email, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var claimed, uncertain atomic.Int32
	for range 4 {
		wg.Go(func() {
			did, err := s.ProcessOne(ctx)
			if did {
				claimed.Add(1)
			}
			if errors.Is(err, ErrMailDelivery) {
				uncertain.Add(1)
			} else if err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if claimed.Load() != 1 || calls.Load() != 1 || uncertain.Load() != 1 {
		t.Fatal("claim or uncertain mail retried")
	}
	if did, err := s.ProcessOne(ctx); did || err != nil {
		t.Fatal("terminal claim was rescued")
	}
	var state string
	var cleared bool
	if err := f.admin.QueryRow(ctx, "SELECT state,recipient_enc IS NULL FROM auth.recovery_requests WHERE recipient_key=$1", key).Scan(&state, &cleared); err != nil || state != "finished" || !cleared {
		t.Fatal("sensitive queue payload retained", err)
	}
	var issued int
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.user_tokens WHERE user_id=$1 AND kind='password_reset'", f.user).Scan(&issued); err != nil || issued != 1 {
		t.Fatal("not exactly one issued proof")
	}
}
func TestRecoveryQueueUnknownWrongRealmAndCustody(t *testing.T) {
	var calls atomic.Int32
	f, e, s := recoveryFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"ID\":\"synthetic\"}"))
	})
	ctx := context.Background()
	ip := fixtureIP(f)
	email := f.user.String() + "@example.invalid"
	// Existing account has only tenant grants. Neither intake nor receipt reveals it.
	if err := s.Request(ctx, email, Platform, ip); err != nil {
		t.Fatal(err)
	}
	if did, err := s.ProcessOne(ctx); !did || err != nil {
		t.Fatal("wrong-realm job not uniformly finished", err)
	}
	if calls.Load() != 0 {
		t.Fatal("wrong realm mailed")
	}
	unknown := uuid.New().String() + "@example.invalid"
	defer func() {
		_, _ = f.admin.Exec(ctx, "DELETE FROM auth.recovery_limits WHERE key=$1", e.recoveryIndex("recipient", unknown))
	}()
	if err := s.Request(ctx, unknown, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	if did, err := s.ProcessOne(ctx); !did || err != nil {
		t.Fatal("unknown identity not uniformly completed", err)
	}
	if calls.Load() != 0 {
		t.Fatal("unknown identity mailed")
	}
	// A real-looking, non-disposable destination is never looked up or mailed by capture.
	real := "operator-" + f.user.String() + "@example.com"
	defer func() {
		_, _ = f.admin.Exec(ctx, "DELETE FROM auth.recovery_requests WHERE recipient_key=$1", e.recoveryIndex("coalesce:"+string(Tenant), real))
		_, _ = f.admin.Exec(ctx, "DELETE FROM auth.recovery_limits WHERE key=$1", e.recoveryIndex("recipient", real))
	}()
	if err := s.Request(ctx, real, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	if did, err := s.ProcessOne(ctx); !did || err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("capture accepted a real destination")
	}
	// Wrong key/AAD cannot decrypt an accepted recipient.
	if err := s.Request(ctx, email, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	key := e.recoveryIndex("coalesce:"+string(Tenant), email)
	var id uuid.UUID
	var enc []byte
	if err := f.admin.QueryRow(ctx, "SELECT id,recipient_enc FROM auth.recovery_requests WHERE recipient_key=$1", key).Scan(&id, &enc); err != nil {
		t.Fatal(err)
	}
	if _, err := openSecret(e.secrets, id, recoveryPurpose(Platform), enc); err == nil {
		t.Fatal("realm AAD not bound")
	}
	if _, err := openSecret(e.secrets, uuid.New(), recoveryPurpose(Tenant), enc); err == nil {
		t.Fatal("request AAD not bound")
	}
	other, err := NewEngine(ctx, f.service, bytes.Repeat([]byte{7}, 32), "http://localhost:5174", "http://localhost:5173")
	if err != nil {
		t.Fatal(err)
	}
	alien, err := NewLocalRecovery(other, s.mailer)
	if err != nil {
		t.Fatal(err)
	}
	if did, err := alien.ProcessOne(ctx); did || err != nil {
		t.Fatal("different custody claimed this queue")
	}
	// Claim then simulate a crash. Maintenance never returns it to pending.
	if _, err := authdb.New(e.sessions.pool).ClaimRecoveryRequest(ctx, e.recoveryIndex("custody", "")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.Exec(ctx, "UPDATE auth.recovery_requests SET claimed_at=clock_timestamp()-interval '3 minutes' WHERE id=$1", id); err == nil {
		t.Fatal("claim timestamp mutable")
	}
	// Keep real transition guards enabled. An admin-owned fixture inserts an
	// already claimed row with a past clock; it never changes an applied claim.
	if err := authdb.New(e.sessions.pool).FinishRecoveryRequest(ctx, pgtype.UUID{Bytes: id, Valid: true}); err != nil {
		t.Fatal(err)
	}
	staleID := uuid.New()
	staleEnc, err := sealSecret(e.secrets, staleID, recoveryPurpose(Tenant), email)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.admin.Exec(ctx, `INSERT INTO auth.recovery_requests(id,recipient_key,custody_id,realm,recipient_enc,state,created_at,expires_at,claimed_at)
 VALUES($1,$2,$3,'tenant',$4,'claimed',statement_timestamp()-interval '3 minutes',statement_timestamp()+interval '12 minutes',statement_timestamp()-interval '3 minutes')`, staleID, key, e.recoveryIndex("custody", ""), staleEnc)
	if err != nil {
		t.Fatal("stale synthetic claim setup", err)
	}
	if err := e.pruneRecoveryQueue(ctx); err != nil {
		t.Fatal(err)
	}
	if did, err := s.ProcessOne(ctx); did || err != nil {
		t.Fatal("crashed claim retried")
	}
	if calls.Load() != 0 {
		t.Fatal("crashed claim mailed")
	}
}
