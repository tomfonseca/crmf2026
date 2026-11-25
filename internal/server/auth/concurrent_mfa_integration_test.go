//go:build integration

package auth

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func TestConcurrentMFAChallengeSingleUse(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
		t.Fatal(err)
	}
	pending := loginFixture(t, f, e, ip)
	code := enrollmentCode(t, pending, f.now)
	var successes atomic.Int32
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := e.CompleteMFA(ctx, pending.ChallengeToken, code, Tenant, ip)
			if err == nil && result.SessionToken != "" {
				successes.Add(1)
			} else if !errors.Is(err, ErrUnauthenticated) {
				t.Error("unexpected MFA race error")
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatal("challenge did not commit exactly once")
	}
	var count int
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.user_sessions WHERE user_id=$1 AND revoked_at IS NULL", f.user).Scan(&count); err != nil || count != 1 {
		t.Fatal("multiple sessions issued for one challenge")
	}
}
