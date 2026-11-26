//go:build integration

package auth

import (
	"bytes"
	"context"
	"errors"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/crmf/crmf/internal/testpasskey"
	"github.com/google/uuid"
)

const resetFixturePassword = "A different synthetic recovery passphrase! 2026"

func resetNotice(t *testing.T, f *sessionFixture, e *Engine, realm Realm) MailNotice {
	t.Helper()
	n, err := e.issuePasswordReset(context.Background(), f.user, realm)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPasswordResetKernelHashTTLReplacementAndConsumption(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	session := loginFixture(t, f, e, ip)
	// A legacy/synthetic opposite-realm session must also be revoked, even
	// though live grants could never authorize it as a new login.
	_, otherHash, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.admin.Exec(ctx, `INSERT INTO auth.user_sessions(id,user_id,token_hash,realm,last_seen_at,idle_expires_at,expires_at,created_at)
		VALUES($1,$2,$3,'platform',statement_timestamp(),statement_timestamp()+interval '30 minutes',statement_timestamp()+interval '12 hours',statement_timestamp())`,
		uuid.Must(uuid.NewV7()), f.user, otherHash); err != nil {
		t.Fatal(err)
	}
	first := resetNotice(t, f, e, Tenant)
	second := resetNotice(t, f, e, Tenant)
	firstHash, _ := tokenHash(first.Token)
	secondHash, _ := tokenHash(second.Token)
	var stored []byte
	var ttl float64
	var used bool
	if err := f.admin.QueryRow(ctx, "SELECT token_hash,extract(epoch FROM (expires_at-created_at))::float8 FROM auth.user_tokens WHERE token_hash=$1", secondHash).Scan(&stored, &ttl); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stored, secondHash) || bytes.Equal(stored, []byte(second.Token)) || ttl != 1800 {
		t.Fatal("hash-only/30-minute contract")
	}
	if err := f.admin.QueryRow(ctx, "SELECT used_at IS NOT NULL FROM auth.user_tokens WHERE token_hash=$1", firstHash).Scan(&used); err != nil || !used {
		t.Fatal("old link not invalidated")
	}
	for _, try := range []struct {
		token string
		realm Realm
	}{
		{first.Token, Tenant}, {second.Token, Platform}, {"malformed", Tenant},
	} {
		if err := e.ResetPassword(ctx, try.token, resetFixturePassword, try.realm, ip); !errors.Is(err, ErrResetToken) {
			t.Fatal("invalid proof accepted", err)
		}
	}
	if err := e.ResetPassword(ctx, second.Token, "weak", Tenant, ip); !errors.Is(err, ErrPasswordPolicy) {
		t.Fatal("password policy")
	}
	if _, err := f.service.Resolve(ctx, session.SessionToken, Tenant); err != nil {
		t.Fatal("failed reset changed existing session")
	}
	if err := e.ResetPassword(ctx, second.Token, resetFixturePassword, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	var live int
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.user_sessions WHERE user_id=$1 AND revoked_at IS NULL", f.user).Scan(&live); err != nil || live != 0 {
		t.Fatal("reset did not revoke every realm's sessions")
	}
	if err := e.ResetPassword(ctx, second.Token, fixturePassword, Tenant, ip); !errors.Is(err, ErrResetToken) {
		t.Fatal("replay accepted")
	}
	if _, err := f.service.Resolve(ctx, session.SessionToken, Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("session survived reset")
	}
	if _, err := e.Login(ctx, f.user.String()+"@example.invalid", fixturePassword, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("old password accepted")
	}
	result, err := e.Login(ctx, f.user.String()+"@example.invalid", resetFixturePassword, Tenant, ip)
	if err != nil || result.SessionToken == "" {
		t.Fatal("new password did not work", err)
	}
	var count int
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM core.audit_log WHERE target=$1 AND action='auth.password_reset'", f.user.String()).Scan(&count); err != nil || count != 1 {
		t.Fatal("reset audit not exactly once")
	}
	// Audit is projected to action/target/realm only: no proof/password/email.
	var leaked bool
	if err := f.admin.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM core.audit_log WHERE target=$1 AND (detail::text LIKE '%'||$2::text||'%' OR detail::text LIKE '%'||$3::text||'%'))", f.user.String(), second.Token, resetFixturePassword).Scan(&leaked); err != nil || leaked {
		t.Fatal("audit leaked a secret")
	}
}

func TestPasswordResetKernelExpiresAndIdentityChangesInvalidate(t *testing.T) {
	for _, change := range []string{
		"UPDATE auth.users SET password_changed_at=clock_timestamp() WHERE id=$1",
		"UPDATE auth.users SET status='disabled' WHERE id=$1",
		"UPDATE auth.users SET email=id::text||'.changed@example.invalid' WHERE id=$1",
		"UPDATE auth.user_grants SET seller_code='changed' WHERE user_id=$1",
		"DELETE FROM auth.user_grants WHERE user_id=$1",
	} {
		f, e, ip := newLoginFixture(t)
		n := resetNotice(t, f, e, Tenant)
		if _, err := f.admin.Exec(context.Background(), change, f.user); err != nil {
			t.Fatal(err)
		}
		if err := e.ResetPassword(context.Background(), n.Token, resetFixturePassword, Tenant, ip); !errors.Is(err, ErrResetToken) {
			t.Fatal("identity change did not invalidate proof", err)
		}
	}
	f, e, ip := newLoginFixture(t)
	raw, hash, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.admin.Exec(context.Background(), `INSERT INTO auth.user_tokens(token_hash,user_id,kind,realm,password_epoch,created_at,expires_at)
		SELECT $1,id,'password_reset','tenant',password_changed_at,statement_timestamp()-interval '31 minutes',statement_timestamp()-interval '1 minute' FROM auth.users WHERE id=$2`, hash, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ResetPassword(context.Background(), raw, resetFixturePassword, Tenant, ip); !errors.Is(err, ErrResetToken) {
		t.Fatal("expired proof accepted", err)
	}
	if _, err = f.admin.Exec(context.Background(), "UPDATE auth.user_tokens SET expires_at=clock_timestamp()+interval '10 minutes' WHERE token_hash=$1", hash); err == nil {
		t.Fatal("token lifetime was mutable")
	}
	if _, err = f.admin.Exec(context.Background(), "UPDATE auth.user_tokens SET realm='platform' WHERE token_hash=$1", hash); err == nil {
		t.Fatal("token realm was mutable")
	}
}

func TestPasswordResetKernelEligibilityAndCurrentScope(t *testing.T) {
	for _, change := range []string{
		"UPDATE auth.users SET status='invited' WHERE id=$1",
		"UPDATE auth.users SET status='disabled' WHERE id=$1",
		"UPDATE auth.users SET password_hash=NULL WHERE id=$1",
		"DELETE FROM auth.user_grants WHERE user_id=$1",
	} {
		f, e, _ := newLoginFixture(t)
		if _, err := f.admin.Exec(context.Background(), change, f.user); err != nil {
			t.Fatal(err)
		}
		if _, err := e.issuePasswordReset(context.Background(), f.user, Tenant); !errors.Is(err, ErrResetToken) {
			t.Fatal("ineligible identity issued proof", err)
		}
	}
	f, e, ip := newLoginFixture(t)
	n := resetNotice(t, f, e, Tenant)
	if _, err := e.issuePasswordReset(context.Background(), f.user, Platform); !errors.Is(err, ErrResetToken) {
		t.Fatal("cross-realm issuance")
	}
	if _, err := f.admin.Exec(context.Background(), "UPDATE core.tenants SET status='suspended' WHERE id=$1", f.tenant); err != nil {
		t.Fatal(err)
	}
	if err := e.ResetPassword(context.Background(), n.Token, resetFixturePassword, Tenant, ip); !errors.Is(err, ErrResetToken) {
		t.Fatal("current tenant policy bypassed", err)
	}
	if _, err := e.issuePasswordReset(context.Background(), f.user, Tenant); !errors.Is(err, ErrResetToken) {
		t.Fatal("suspended tenant issued proof")
	}
}

func TestPasswordResetKernelConcurrentUseAndPersistentIPLimit(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	n := resetNotice(t, f, e, Tenant)
	var wg sync.WaitGroup
	results := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- e.ResetPassword(context.Background(), n.Token, resetFixturePassword, Tenant, ip)
		}()
	}
	wg.Wait()
	close(results)
	ok, denied := 0, 0
	for err := range results {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrResetToken):
			denied++
		default:
			t.Fatal(err)
		}
	}
	if ok != 1 || denied != 3 {
		t.Fatal("concurrent proof consumption not exactly once")
	}
	other := netip.AddrFrom16([16]byte(uuid.Must(uuid.NewV7())))
	if !other.IsValid() {
		t.Fatal("IP fixture")
	}
	t.Cleanup(func() { _, _ = f.admin.Exec(context.Background(), "DELETE FROM auth.ip_attempts WHERE ip=$1", other) })
	for range 20 {
		if err := e.ResetPassword(context.Background(), "bad", resetFixturePassword, Tenant, other); !errors.Is(err, ErrResetToken) {
			t.Fatal(err)
		}
	}
	if err := e.ResetPassword(context.Background(), "bad", resetFixturePassword, Tenant, other); !errors.Is(err, ErrRateLimited) {
		t.Fatal("IP attempts not persistent")
	}
}

func TestPasswordResetKernelPreservesPasskeyAndRecovery(t *testing.T) {
	for _, realm := range []Realm{Tenant, Platform} {
		f, e, ip := newLoginFixture(t)
		ctx := context.Background()
		origin := "http://localhost:5174"
		if realm == Platform {
			if _, err := f.admin.Exec(ctx, "DELETE FROM auth.user_grants WHERE user_id=$1", f.user); err != nil {
				t.Fatal(err)
			}
			if _, err := f.admin.Exec(ctx, "INSERT INTO auth.user_grants(id,user_id,role) VALUES($1,$2,'platform_admin')", uuid.Must(uuid.NewV7()), f.user); err != nil {
				t.Fatal(err)
			}
			origin = "http://localhost:5173"
		} else if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
			t.Fatal(err)
		}
		login, err := e.Login(ctx, f.user.String()+"@example.invalid", fixturePassword, realm, ip)
		if err != nil || !login.Enrollment {
			t.Fatal("initial enrollment", err)
		}
		device := testpasskey.New(t)
		registration := device.Register(t, login.PasskeyOptions, origin)
		complete, err := e.CompletePasskey(ctx, login.ChallengeToken, registration, realm, ip)
		if err != nil || len(complete.RecoveryCodes) != 10 {
			t.Fatal("disposable enrollment", err)
		}
		pending, err := e.Login(ctx, f.user.String()+"@example.invalid", fixturePassword, realm, ip)
		if err != nil {
			t.Fatal(err)
		}
		staleProof := device.Authenticate(t, pending.PasskeyOptions, origin)
		var beforeCodes, afterCodes []string
		if err = f.admin.QueryRow(ctx, "SELECT array_agg(code_hash ORDER BY code_hash) FROM auth.mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL", f.user).Scan(&beforeCodes); err != nil {
			t.Fatal("snapshot disposable recovery records")
		}
		var before, after []byte
		if err = f.admin.QueryRow(ctx, "SELECT credential_enc FROM auth.passkey_credentials WHERE user_id=$1", f.user).Scan(&before); err != nil {
			t.Fatal(err)
		}
		n := resetNotice(t, f, e, realm)
		// Seed only this disposable identity's lock; email proof may clear a
		// password lock but must never clear MFA/recovery or reset IP accounting.
		if _, err = f.admin.Exec(ctx, "UPDATE auth.users SET failed_logins=5,locked_until=clock_timestamp()+interval '1 minute' WHERE id=$1", f.user); err != nil {
			t.Fatal(err)
		}
		if err = e.ResetPassword(ctx, n.Token, resetFixturePassword, realm, ip); err != nil {
			t.Fatal(err)
		}
		if _, err = f.service.Resolve(ctx, complete.SessionToken, realm); !errors.Is(err, ErrUnauthenticated) {
			t.Fatal("MFA session survived")
		}
		if _, err = e.CompletePasskey(ctx, pending.ChallengeToken, staleProof, realm, ip); !errors.Is(err, ErrUnauthenticated) {
			t.Fatal("stale password proof survived")
		}
		if err = f.admin.QueryRow(ctx, "SELECT credential_enc FROM auth.passkey_credentials WHERE user_id=$1", f.user).Scan(&after); err != nil || !bytes.Equal(before, after) {
			t.Fatal("passkey changed")
		}
		if err = f.admin.QueryRow(ctx, "SELECT array_agg(code_hash ORDER BY code_hash) FROM auth.mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL", f.user).Scan(&afterCodes); err != nil || !slices.Equal(beforeCodes, afterCodes) {
			t.Fatal("recovery credential records changed")
		}
		var codes int
		if err = f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL", f.user).Scan(&codes); err != nil || codes != 10 {
			t.Fatal("recovery codes changed")
		}
		next, err := e.Login(ctx, f.user.String()+"@example.invalid", resetFixturePassword, realm, ip)
		if err != nil || next.SessionToken != "" || next.Enrollment || next.ChallengeToken == "" {
			t.Fatal("MFA was bypassed", err)
		}
		proof := device.Authenticate(t, next.PasskeyOptions, origin)
		if _, err = e.CompletePasskey(ctx, next.ChallengeToken, proof, realm, ip); err != nil {
			t.Fatal("same authenticator not retained", err)
		}
	}
}

func TestPasswordResetKernelWrongKindAndEpoch(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	for _, kind := range []string{"invite", "password_reset"} {
		raw, hash, err := newToken()
		if err != nil {
			t.Fatal(err)
		}
		_, err = f.admin.Exec(ctx, `INSERT INTO auth.user_tokens(token_hash,user_id,kind,realm,password_epoch,created_at,expires_at)
			SELECT $1,id,$3,'tenant',coalesce(password_changed_at,statement_timestamp())-interval '1 day',
			statement_timestamp(),statement_timestamp()+interval '30 minutes' FROM auth.users WHERE id=$2`, hash, f.user, kind)
		if err != nil {
			t.Fatal(err)
		}
		if err = e.ResetPassword(ctx, raw, resetFixturePassword, Tenant, ip); !errors.Is(err, ErrResetToken) {
			t.Fatal("wrong purpose/epoch accepted", err)
		}
	}
}

func TestPasswordResetKernelTerminalProofCannotReopen(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	n := resetNotice(t, f, e, Tenant)
	hash, _ := tokenHash(n.Token)
	if err := e.ResetPassword(context.Background(), n.Token, resetFixturePassword, Tenant, ip); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.Exec(context.Background(), "UPDATE auth.user_tokens SET used_at=NULL WHERE token_hash=$1", hash); err == nil {
		t.Fatal("used proof reopened")
	}
	// The core service receives no auth-table access.
	var denied bool
	if err := f.admin.QueryRow(context.Background(), "SELECT NOT has_table_privilege('crmf_core','auth.user_tokens','SELECT')").Scan(&denied); err != nil || !denied {
		t.Fatal("core gained credential access")
	}
	if strings.Contains(n.String(), n.Token) {
		t.Fatal("raw link formatted")
	}
}
