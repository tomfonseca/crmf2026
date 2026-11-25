//go:build integration

package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"net/netip"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const bootstrapPassword = "A unique synthetic bootstrap passphrase! 2026"

// Never reset a real bootstrap to make tests pass. Fresh CI databases exercise
// success paths; initialized developer databases keep the durable marker.
func requireFreshBootstrap(t *testing.T, f *sessionFixture) {
	t.Helper()
	var initialized bool
	err := f.admin.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM auth.platform_bootstrap) OR EXISTS(SELECT 1 FROM auth.user_grants WHERE role='platform_admin')").Scan(&initialized)
	if err != nil {
		t.Fatal("inspect synthetic bootstrap prerequisite")
	}
	if initialized {
		t.Skip("bootstrap success tests require an uninitialized disposable database; refusing to reset existing administration")
	}
}
func cleanupBootstrap(t *testing.T, f *sessionFixture, ids *[]uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		for _, id := range *ids {
			if _, err := f.admin.Exec(context.Background(), "DELETE FROM auth.platform_bootstrap WHERE admin_user_id=$1", id); err != nil {
				t.Error("clean synthetic bootstrap marker")
			}
			if _, err := f.admin.Exec(context.Background(), "DELETE FROM auth.users WHERE id=$1", id); err != nil {
				t.Error("clean synthetic bootstrap identity")
			}
		}
	})
}
func TestBootstrapFirstAdminAndMandatoryMFA(t *testing.T) {
	f := newSessionFixture(t)
	requireFreshBootstrap(t, f)
	ctx := context.Background()
	var ids []uuid.UUID
	cleanupBootstrap(t, f, &ids)
	email := uuid.NewString() + "@example.invalid"
	id, err := f.service.BootstrapFirstAdmin(ctx, email, "Synthetic bootstrap admin", bootstrapPassword)
	if err != nil {
		t.Fatal(err)
	}
	ids = append(ids, id)
	var storedHash string
	var enrolled bool
	var sessionCount, grantCount, auditCount int
	if err := f.admin.QueryRow(ctx, "SELECT password_hash,mfa_enabled_at IS NOT NULL FROM auth.users WHERE id=$1", id).Scan(&storedHash, &enrolled); err != nil || enrolled {
		t.Fatal("bootstrap unexpectedly enrolled MFA")
	}
	passwords, err := NewPasswords()
	if err != nil {
		t.Fatal(err)
	}
	match, err := passwords.Verify(ctx, bootstrapPassword, storedHash)
	if err != nil || !match.Valid || match.NeedsRehash {
		t.Fatal("bootstrap password not hashed with current policy")
	}
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.user_grants WHERE user_id=$1 AND role='platform_admin' AND tenant_id IS NULL AND store_id IS NULL", id).Scan(&grantCount); err != nil || grantCount != 1 {
		t.Fatal("invalid initial grant")
	}
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM auth.user_sessions WHERE user_id=$1", id).Scan(&sessionCount); err != nil || sessionCount != 0 {
		t.Fatal("bootstrap minted a bypass session")
	}
	if err := f.admin.QueryRow(ctx, "SELECT count(*) FROM core.audit_log WHERE action='auth.admin_bootstrapped' AND target=$1 AND actor_user_id IS NULL", id.String()).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatal("bootstrap not audited")
	}
	for _, sql := range []string{"DELETE FROM auth.platform_bootstrap", "UPDATE auth.platform_bootstrap SET singleton=true", "TRUNCATE auth.platform_bootstrap"} {
		_, err := f.service.pool.Exec(ctx, sql)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Fatal("runtime role could reopen bootstrap")
		}
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal("generate test key")
	}
	engine, err := NewEngine(ctx, f.service, key)
	clear(key)
	if err != nil {
		t.Fatal(err)
	}
	raw := [16]byte(id)
	raw[0] = 0xfd
	ip := netip.AddrFrom16(raw)
	t.Cleanup(func() { _, _ = f.admin.Exec(context.Background(), "DELETE FROM auth.ip_attempts WHERE ip=$1", ip) })
	pending, err := engine.Login(ctx, email, bootstrapPassword, Platform, ip)
	if err != nil || pending.SessionToken != "" || pending.ChallengeToken == "" || pending.EnrollmentURL == "" {
		t.Fatal("bootstrap platform login bypassed MFA")
	}
	otpKey, err := otp.NewKeyFromURL(pending.EnrollmentURL)
	if err != nil {
		t.Fatal("invalid enrollment URI")
	}
	code, err := totp.GenerateCode(otpKey.Secret(), f.now)
	if err != nil {
		t.Fatal("generate test TOTP")
	}
	complete, err := engine.CompleteMFA(ctx, pending.ChallengeToken, code, Platform, ip)
	if err != nil || complete.SessionToken == "" {
		t.Fatal("bootstrapped admin could not finish MFA")
	}
	scope, err := f.service.Resolve(ctx, complete.SessionToken, Platform)
	if err != nil || scope.UserID() != id {
		t.Fatal("bootstrapped identity not authenticated")
	}
	// Deleting the initial identity must not reopen operator bootstrap.
	if _, err := f.admin.Exec(ctx, "DELETE FROM auth.users WHERE id=$1", id); err != nil {
		t.Fatal("delete synthetic admin")
	}
	if _, err := f.service.BootstrapFirstAdmin(ctx, uuid.NewString()+"@example.invalid", "Replacement", bootstrapPassword); !errors.Is(err, ErrAdminBootstrapped) {
		t.Fatal("deleted admin reopened bootstrap")
	}
}
func TestBootstrapNeverPromotesExistingIdentity(t *testing.T) {
	f := newSessionFixture(t)
	requireFreshBootstrap(t, f)
	ctx := context.Background()
	if _, err := f.service.BootstrapFirstAdmin(ctx, f.user.String()+"@example.invalid", "Changed name", bootstrapPassword); !errors.Is(err, ErrIdentityExists) {
		t.Fatal("existing identity promoted")
	}
	var name string
	var marked bool
	if err := f.admin.QueryRow(ctx, "SELECT name FROM auth.users WHERE id=$1", f.user).Scan(&name); err != nil || name != "Synthetic user" {
		t.Fatal("existing identity changed")
	}
	if err := f.admin.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM auth.platform_bootstrap)").Scan(&marked); err != nil || marked {
		t.Fatal("failed bootstrap persisted a marker")
	}
}
func TestConcurrentBootstrapCommitsExactlyOnce(t *testing.T) {
	f := newSessionFixture(t)
	requireFreshBootstrap(t, f)
	ctx := context.Background()
	other, err := Open(ctx, testAuthURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(other.Close)
	var ids []uuid.UUID
	cleanupBootstrap(t, f, &ids)
	type result struct {
		id  uuid.UUID
		err error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, service := range []*Service{f.service, other} {
		wg.Add(1)
		go func(s *Service) {
			defer wg.Done()
			<-start
			id, err := s.BootstrapFirstAdmin(ctx, uuid.NewString()+"@example.invalid", "Concurrent synthetic admin", bootstrapPassword)
			results <- result{id, err}
		}(service)
	}
	close(start)
	wg.Wait()
	close(results)
	denied := 0
	for r := range results {
		if r.err == nil {
			ids = append(ids, r.id)
		} else if errors.Is(r.err, ErrAdminBootstrapped) {
			denied++
		} else {
			t.Error("unexpected concurrent bootstrap failure")
		}
	}
	if len(ids) != 1 || denied != 1 {
		t.Fatal("bootstrap was not globally single-use")
	}
}
