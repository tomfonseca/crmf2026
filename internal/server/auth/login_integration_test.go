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

	"github.com/crmf/crmf/internal/testpasskey"
	"github.com/google/uuid"
)

const fixturePassword = "A unique synthetic passphrase! 2026"

func newLoginFixture(t *testing.T) (*sessionFixture, *Engine, netip.Addr) {
	t.Helper()
	f := newSessionFixture(t)
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	e, err := NewEngine(context.Background(), f.service, key, "http://localhost:5174", "http://localhost:5173")
	clear(key)
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
			t.Error("clean synthetic bucket")
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
func enrollmentCode(t *testing.T, result LoginResult, _ time.Time) string {
	t.Helper()
	return testpasskey.New(t).Register(t, result.PasskeyOptions, "http://localhost:5174")
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
		t.Fatal("secret formatted")
	}
	encoded, err := json.Marshal(result)
	if err != nil || string(encoded) != "{}" {
		t.Fatal("implicit JSON exposes result")
	}
}
func TestRequiredPasskeyEnrollmentRecoveryAndReplay(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
		t.Fatal(err)
	}
	pending := loginFixture(t, f, e, ip)
	if pending.SessionToken != "" || pending.ChallengeToken == "" || !pending.Enrollment {
		t.Fatal("enrollment bypass")
	}
	if _, err := f.service.Resolve(ctx, pending.ChallengeToken, Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("challenge used as session")
	}
	if _, err := e.CompletePasskey(ctx, pending.ChallengeToken, "000000", Platform, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("realm crossing")
	}
	device := testpasskey.New(t)
	response := device.Register(t, pending.PasskeyOptions, "http://localhost:5174")
	complete, err := e.CompletePasskey(ctx, pending.ChallengeToken, response, Tenant, ip)
	if err != nil || complete.SessionToken == "" || len(complete.RecoveryCodes) != 10 {
		t.Fatal("enrollment failed", err)
	}
	if _, err := f.service.Resolve(ctx, complete.SessionToken, Tenant); err != nil {
		t.Fatal(err)
	}
	if _, err := e.CompletePasskey(ctx, pending.ChallengeToken, response, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("registration replay")
	}
	next := loginFixture(t, f, e, ip)
	if next.Enrollment || next.SessionToken != "" {
		t.Fatal("assertion missing")
	}
	signed := device.Authenticate(t, next.PasskeyOptions, "http://localhost:5174")
	if _, err := e.CompletePasskey(ctx, next.ChallengeToken, signed, Tenant, ip); err != nil {
		t.Fatal("signed assertion rejected", err)
	}
	next = loginFixture(t, f, e, ip)
	if _, err := e.CompletePasskey(ctx, next.ChallengeToken, signed, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("assertion replay")
	}
	recovered, err := e.CompletePasskey(ctx, next.ChallengeToken, complete.RecoveryCodes[0], Tenant, ip)
	if err != nil || recovered.SessionToken == "" || len(recovered.RecoveryCodes) != 0 {
		t.Fatal("recovery failed", err)
	}
	next = loginFixture(t, f, e, ip)
	if _, err := e.CompletePasskey(ctx, next.ChallengeToken, complete.RecoveryCodes[0], Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("recovery replay")
	}
	var remaining int
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL", f.user).Scan(&remaining); err != nil || remaining != 9 {
		t.Fatal("recovery not consumed")
	}
	var encrypted []byte
	if err := f.admin.QueryRow(ctx, "SELECT credential_enc FROM auth.passkey_credentials WHERE user_id=$1", f.user).Scan(&encrypted); err != nil || json.Valid(encrypted) {
		t.Fatal("credential not encrypted")
	}
	if _, err := e.CompletePasskey(ctx, next.ChallengeToken, "000000", Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("TOTP accepted")
	}
}
func TestPlatformFirstLoginRequiresPasskey(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	if _, err := f.service.pool.Exec(ctx, "DELETE FROM auth.user_grants WHERE user_id=$1", f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.pool.Exec(ctx, "INSERT INTO auth.user_grants(id,user_id,role) VALUES($1,$2,'platform_admin')", uuid.Must(uuid.NewV7()), f.user); err != nil {
		t.Fatal(err)
	}
	pending, err := e.Login(ctx, f.user.String()+"@example.invalid", fixturePassword, Platform, ip)
	if err != nil || pending.SessionToken != "" || !pending.Enrollment {
		t.Fatal("platform bypass")
	}
	response := testpasskey.New(t).Register(t, pending.PasskeyOptions, "http://localhost:5173")
	result, err := e.CompletePasskey(ctx, pending.ChallengeToken, response, Platform, ip)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Resolve(ctx, result.SessionToken, Platform); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Resolve(ctx, result.SessionToken, Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("realm crossing")
	}
	var idle, total float64
	if err := f.admin.QueryRow(ctx, "SELECT extract(epoch FROM idle_expires_at-created_at),extract(epoch FROM expires_at-created_at) FROM auth.user_sessions WHERE user_id=$1 AND realm='platform'", f.user).Scan(&idle, &total); err != nil || idle != 1800 || total != 43200 {
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

func TestPasskeyChallengesExpireAndInvalidateOnSecurityChanges(t *testing.T) {
	for _, mutate := range []string{"expiry", "UPDATE auth.user_grants SET seller_code='changed' WHERE user_id=$1", "UPDATE auth.users SET password_hash='changed' WHERE id=$1", "UPDATE auth.users SET password_changed_at=CURRENT_TIMESTAMP WHERE id=$1"} {
		t.Run(mutate[:6], func(t *testing.T) {
			f, e, ip := newLoginFixture(t)
			ctx := context.Background()
			if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
				t.Fatal(err)
			}
			pending := loginFixture(t, f, e, ip)
			response := enrollmentCode(t, pending, f.now)
			if mutate == "expiry" {
				f.now = f.now.Add(5 * time.Minute)
			} else if _, err := f.service.pool.Exec(ctx, mutate, f.user); err != nil {
				t.Fatal(err)
			}
			if _, err := e.CompletePasskey(ctx, pending.ChallengeToken, response, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
				t.Fatal("stale challenge accepted")
			}
		})
	}
}
func TestPasskeyRejectsUnboundProof(t *testing.T) {
	for _, variant := range []string{"origin", "UP", "UV", "RPID", "counter", "credential", "handle", "challenge", "signature"} {
		t.Run(variant, func(t *testing.T) {
			f, e, ip := newLoginFixture(t)
			ctx := context.Background()
			if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
				t.Fatal(err)
			}
			first := loginFixture(t, f, e, ip)
			device := testpasskey.New(t)
			response := device.Register(t, first.PasskeyOptions, "http://localhost:5174")
			if _, err := e.CompletePasskey(ctx, first.ChallengeToken, response, Tenant, ip); err != nil {
				t.Fatal(err)
			}
			first = loginFixture(t, f, e, ip)
			if _, err := e.CompletePasskey(ctx, first.ChallengeToken, device.Authenticate(t, first.PasskeyOptions, "http://localhost:5174"), Tenant, ip); err != nil {
				t.Fatal(err)
			}
			next := loginFixture(t, f, e, ip)
			origin := "http://localhost:5174"
			switch variant {
			case "origin":
				origin = "http://localhost:5173"
			case "UP":
				device.Flags = 4
			case "UV":
				device.Flags = 1
			case "RPID":
				device.RPID = "other.invalid"
			case "counter":
				device.Counter = 0
			case "credential":
				device.ID[0] ^= 1
			case "handle":
				device.Handle = "AAAA"
			case "challenge":
				var opts map[string]any
				if err := json.Unmarshal(next.PasskeyOptions, &opts); err != nil {
					t.Fatal(err)
				}
				opts["challenge"] = strings.Repeat("a", 43)
				next.PasskeyOptions, _ = json.Marshal(opts)
			}
			response = device.Authenticate(t, next.PasskeyOptions, origin)
			if variant == "signature" {
				var object map[string]any
				if err := json.Unmarshal([]byte(response), &object); err != nil {
					t.Fatal(err)
				}
				object["response"].(map[string]any)["signature"] = "AAAA"
				data, _ := json.Marshal(object)
				response = string(data)
			}
			if _, err := e.CompletePasskey(ctx, next.ChallengeToken, response, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
				t.Fatal("unbound proof accepted", err)
			}
		})
	}
}
