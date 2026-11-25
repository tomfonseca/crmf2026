//go:build integration

package auth

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const fixturePassword = "A unique synthetic passphrase! 2026"

func newLoginFixture(t *testing.T) (*sessionFixture, *Engine, netip.Addr) {
	t.Helper()
	f := newSessionFixture(t)
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal("generate test key")
	}
	e, err := NewEngine(context.Background(), f.service, key)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := e.passwords.Hash(context.Background(), fixturePassword)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.pool.Exec(context.Background(), "UPDATE auth.users SET password_hash=$2 WHERE id=$1", f.user, hash); err != nil {
		t.Fatal(err)
	}
	raw := [16]byte(f.user)
	raw[0] = 0xfd
	ip := netip.AddrFrom16(raw)
	t.Cleanup(func() {
		if _, err := f.admin.Exec(context.Background(), "DELETE FROM auth.ip_attempts WHERE ip=$1", ip); err != nil {
			t.Error("clean synthetic rate bucket")
		}
	})
	return f, e, ip
}
func loginFixture(t *testing.T, f *sessionFixture, e *Engine, ip netip.Addr) LoginResult {
	t.Helper()
	result, err := e.Login(context.Background(), strings.ToUpper(f.user.String()+"@example.invalid"), fixturePassword, Tenant, ip)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func enrollmentCode(t *testing.T, result LoginResult, now time.Time) string {
	t.Helper()
	key, err := otp.NewKeyFromURL(result.EnrollmentURL)
	if err != nil {
		t.Fatal("invalid enrollment URI")
	}
	code, err := totp.GenerateCode(key.Secret(), now)
	if err != nil {
		t.Fatal("generate synthetic TOTP")
	}
	return code
}

func TestLoginWithoutMFA(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	result := loginFixture(t, f, e, ip)
	if result.SessionToken == "" || result.ChallengeToken != "" {
		t.Fatal("wrong login outcome")
	}
	if _, err := f.service.Resolve(context.Background(), result.SessionToken, Tenant); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(fmt.Sprintf("%+v", result), result.SessionToken) || strings.Contains(fmt.Sprintf("%#v", result), result.SessionToken) {
		t.Fatal("result formatting leaks tokens")
	}
	encoded, err := json.Marshal(result)
	if err != nil || string(encoded) != "{}" {
		t.Fatal("implicit JSON exposes secret result fields")
	}
}
func TestRequiredMFAEnrollmentRecoveryAndReplay(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
		t.Fatal(err)
	}
	pending := loginFixture(t, f, e, ip)
	if pending.SessionToken != "" || pending.ChallengeToken == "" || pending.EnrollmentURL == "" {
		t.Fatal("MFA bypass or missing enrollment")
	}
	if _, err := f.service.Resolve(ctx, pending.ChallengeToken, Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("challenge is a usable session")
	}
	if _, err := e.CompleteMFA(ctx, pending.ChallengeToken, "000000", Platform, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("challenge crossed realm")
	}
	code := enrollmentCode(t, pending, f.now)
	complete, err := e.CompleteMFA(ctx, pending.ChallengeToken, code, Tenant, ip)
	if err != nil || complete.SessionToken == "" || len(complete.RecoveryCodes) != 10 {
		t.Fatal("MFA enrollment failed")
	}
	if _, err := f.service.Resolve(ctx, complete.SessionToken, Tenant); err != nil {
		t.Fatal(err)
	}
	if _, err := e.CompleteMFA(ctx, pending.ChallengeToken, code, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("challenge reused")
	}
	challenge := loginFixture(t, f, e, ip)
	if challenge.EnrollmentURL != "" || challenge.SessionToken != "" {
		t.Fatal("enabled MFA was not challenged")
	}
	if _, err := e.CompleteMFA(ctx, challenge.ChallengeToken, code, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("TOTP replay accepted")
	}
	recovery, err := e.CompleteMFA(ctx, challenge.ChallengeToken, complete.RecoveryCodes[0], Tenant, ip)
	if err != nil || recovery.SessionToken == "" || len(recovery.RecoveryCodes) != 0 {
		t.Fatal("single-use recovery failed")
	}
	challenge = loginFixture(t, f, e, ip)
	if _, err := e.CompleteMFA(ctx, challenge.ChallengeToken, complete.RecoveryCodes[0], Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("recovery reused")
	}
	f.now = f.now.Add(time.Minute)
	code = enrollmentCode(t, pending, f.now)
	if result, err := e.CompleteMFA(ctx, challenge.ChallengeToken, code, Tenant, ip); err != nil || result.SessionToken == "" {
		t.Fatal("new TOTP rejected")
	}
	var secret []byte
	var codes int
	if err := f.admin.QueryRow(ctx, "SELECT mfa_secret_enc FROM auth.users WHERE id=$1", f.user).Scan(&secret); err != nil {
		t.Fatal(err)
	}
	key, _ := otp.NewKeyFromURL(pending.EnrollmentURL)
	if strings.Contains(string(secret), key.Secret()) {
		t.Fatal("MFA secret stored in clear")
	}
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL", f.user).Scan(&codes); err != nil || codes != 9 {
		t.Fatal("recovery consumption was not persisted")
	}
}

func TestPlatformFirstLoginRequiresMFA(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	if _, err := f.service.pool.Exec(ctx, "DELETE FROM auth.user_grants WHERE user_id=$1", f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.pool.Exec(ctx, "INSERT INTO auth.user_grants(id,user_id,role) VALUES ($1,$2,'platform_admin')", uuid.Must(uuid.NewV7()), f.user); err != nil {
		t.Fatal(err)
	}
	pending, err := e.Login(ctx, f.user.String()+"@example.invalid", fixturePassword, Platform, ip)
	if err != nil || pending.SessionToken != "" || pending.ChallengeToken == "" {
		t.Fatal("platform first-login bypass")
	}
	result, err := e.CompleteMFA(ctx, pending.ChallengeToken, enrollmentCode(t, pending, f.now), Platform, ip)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Resolve(ctx, result.SessionToken, Platform); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Resolve(ctx, result.SessionToken, Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("platform session crossed realm")
	}
	var idle, total time.Duration
	var idleSeconds, totalSeconds float64
	if err := f.admin.QueryRow(ctx, "SELECT extract(epoch FROM idle_expires_at-created_at),extract(epoch FROM expires_at-created_at) FROM auth.user_sessions WHERE user_id=$1 AND realm='platform'", f.user).Scan(&idleSeconds, &totalSeconds); err != nil {
		t.Fatal(err)
	}
	idle = time.Duration(idleSeconds) * time.Second
	total = time.Duration(totalSeconds) * time.Second
	if idle != 30*time.Minute || total != 12*time.Hour {
		t.Fatal("wrong platform TTL")
	}
}

func TestProgressiveAccountLocks(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	for round, duration := range []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour} {
		for range 5 {
			if _, err := e.Login(ctx, f.user.String()+"@example.invalid", "incorrect synthetic password", Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
				t.Fatal("failure exposed account details")
			}
		}
		var failures int
		var until time.Time
		if err := f.admin.QueryRow(ctx, "SELECT failed_logins,locked_until FROM auth.users WHERE id=$1", f.user).Scan(&failures, &until); err != nil {
			t.Fatal(err)
		}
		if failures != (round+1)*5 || !until.Equal(f.now.Add(duration)) {
			t.Fatal("incorrect progressive lock")
		}
		if _, err := e.Login(ctx, f.user.String()+"@example.invalid", fixturePassword, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
			t.Fatal("locked account logged in")
		}
		f.now = until
	}
	result := loginFixture(t, f, e, ip)
	if result.SessionToken == "" {
		t.Fatal("successful login not restored after lock")
	}
	var failures int
	if err := f.admin.QueryRow(ctx, "SELECT failed_logins FROM auth.users WHERE id=$1", f.user).Scan(&failures); err != nil || failures != 0 {
		t.Fatal("successful login did not reset failures")
	}
}
func TestSharedSlidingIPLimit(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	independent, err := Open(context.Background(), testAuthURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(independent.Close)
	independent.now = f.service.now
	other := *e
	other.sessions = independent
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := range 30 {
		engine := e
		if i%2 == 0 {
			engine = &other
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := engine.reserveAttempt(context.Background(), ip)
			if err == nil {
				accepted.Add(1)
			} else if !errors.Is(err, ErrRateLimited) {
				t.Error("rate reservation failed")
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 20 {
		t.Fatal("non-atomic shared rate limiter")
	}
	f.now = f.now.Add(time.Minute)
	if err := e.reserveAttempt(context.Background(), ip); err != nil {
		t.Fatal("sliding rate window failed to expire")
	}
}

func TestChallengesExpireAndInvalidateOnSecurityChanges(t *testing.T) {
	for _, mutate := range []string{"expiry", "UPDATE auth.user_grants SET seller_code='changed' WHERE user_id=$1", "UPDATE auth.users SET password_hash='changed' WHERE id=$1", "UPDATE auth.users SET password_changed_at=CURRENT_TIMESTAMP WHERE id=$1"} {
		t.Run(mutate[:6], func(t *testing.T) {
			f, e, ip := newLoginFixture(t)
			ctx := context.Background()
			if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
				t.Fatal(err)
			}
			pending := loginFixture(t, f, e, ip)
			code := enrollmentCode(t, pending, f.now)
			if mutate == "expiry" {
				f.now = f.now.Add(5 * time.Minute)
			} else if _, err := f.service.pool.Exec(ctx, mutate, f.user); err != nil {
				t.Fatal(err)
			}
			if _, err := e.CompleteMFA(ctx, pending.ChallengeToken, code, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
				t.Fatal("stale challenge accepted")
			}
		})
	}
}
