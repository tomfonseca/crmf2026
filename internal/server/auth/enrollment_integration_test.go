//go:build integration

package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestOptionalEnrollmentRequiresPasswordAndRevokesOldSession(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	existing := loginFixture(t, f, e, ip)
	if result, err := e.StartEnrollment(ctx, existing.SessionToken, "incorrect synthetic password", Tenant, ip); !errors.Is(err, ErrUnauthenticated) || result.ChallengeToken != "" {
		t.Fatal("enrollment without password")
	}
	pending, err := e.StartEnrollment(ctx, existing.SessionToken, fixturePassword, Tenant, ip)
	if err != nil || !pending.Enrollment || pending.SessionToken != "" {
		t.Fatal("optional enrollment failed")
	}
	if _, err := f.service.Resolve(ctx, existing.SessionToken, Tenant); err != nil {
		t.Fatal("unconfirmed enrollment revoked session")
	}
	result, err := e.CompletePasskey(ctx, pending.ChallengeToken, enrollmentCode(t, pending, f.now), Tenant, ip)
	if err != nil || result.SessionToken == "" {
		t.Fatal("optional enrollment confirmation failed")
	}
	if _, err := f.service.Resolve(ctx, existing.SessionToken, Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("old non-MFA session survived enrollment")
	}
}
func TestMFAFailuresDoNotResetAtPasswordStep(t *testing.T) {
	f, e, ip := newLoginFixture(t)
	ctx := context.Background()
	if _, err := f.admin.Exec(ctx, "UPDATE core.tenants SET require_mfa=true WHERE id=$1", f.tenant); err != nil {
		t.Fatal(err)
	}
	var pending LoginResult
	for range 5 {
		pending = loginFixture(t, f, e, ip)
		if _, err := e.CompletePasskey(ctx, pending.ChallengeToken, "invalid", Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
			t.Fatal("invalid MFA accepted")
		}
	}
	if _, err := e.Login(ctx, f.user.String()+"@example.invalid", fixturePassword, Tenant, ip); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("password step reset MFA failure lock")
	}
	f.now = f.now.Add(time.Minute)
	pending = loginFixture(t, f, e, ip)
	if result, err := e.CompletePasskey(ctx, pending.ChallengeToken, enrollmentCode(t, pending, f.now), Tenant, ip); err != nil || result.SessionToken == "" {
		t.Fatal("MFA did not recover after lock expired")
	}
}
