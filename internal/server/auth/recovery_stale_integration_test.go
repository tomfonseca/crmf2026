//go:build integration

package auth

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"net/http"
	"testing"
	"time"
)

func TestRecoveryQueueStaleRequestCannotReplaceNewerProof(t *testing.T) {
	f, e, s := recoveryFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("stale recovery mailed") })
	ctx := context.Background()
	email := f.user.String() + "@example.invalid"
	if err := s.Request(ctx, email, Tenant, fixtureIP(f)); err != nil {
		t.Fatal(err)
	}
	// A password epoch changes after anonymous intake and before delivery.
	if _, err := f.admin.Exec(ctx, "UPDATE auth.users SET password_changed_at=clock_timestamp() WHERE id=$1", f.user); err != nil {
		t.Fatal(err)
	}
	fresh, err := e.issuePasswordReset(ctx, f.user, Tenant)
	if err != nil {
		t.Fatal(err)
	}
	if did, err := s.ProcessOne(ctx); !did || err != nil {
		t.Fatal("stale job not terminal", err)
	}
	// The stale queued request must not invalidate this newer valid proof.
	if err := e.ResetPassword(ctx, fresh.Token, resetFixturePassword, Tenant, fixtureIP(f)); err != nil {
		t.Fatal("stale job invalidated newer proof", err)
	}
}
func TestRecoveryIssuerRechecksExpectedEmailUnderIdentityLock(t *testing.T) {
	f, e, _ := newLoginFixture(t)
	_, err := e.issuePasswordReset(context.Background(), f.user, Tenant, resetExpectation{Email: uuid.New().String() + "@example.invalid", RequestedAt: time.Now()})
	if !errors.Is(err, ErrResetToken) {
		t.Fatal("recipient race not rejected before issuance")
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), "SELECT count(*) FROM auth.user_tokens WHERE user_id=$1", f.user).Scan(&count); err != nil || count != 0 {
		t.Fatal("recipient mismatch minted a proof")
	}
}
