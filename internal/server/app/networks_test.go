package app

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
	"testing"
)

func TestNetworksRejectWithoutPrincipalBeforeDatabase(t *testing.T) {
	n := &Networks{}
	ctx := context.Background()
	if _, err := n.List(ctx, ""); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal(err)
	}
	if _, err := n.Create(ctx, tenancy.ProvisionInput{}); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal(err)
	}
	if _, err := n.Retry(ctx, uuid.New(), 1); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal(err)
	}
}
func TestNetworkStateNeverTreatsJobCompletionAsReadiness(t *testing.T) {
	for _, state := range []string{"completed", "discarded", "cancelled", "", "unknown"} {
		if networkState(false, state) != "failed" {
			t.Fatal("false ready", state)
		}
	}
	for _, state := range []string{"pending", "available", "scheduled", "retryable"} {
		if networkState(false, state) != "queued" {
			t.Fatal("lost queue state", state)
		}
	}
	if networkState(false, "running") != "preparing" || networkState(true, "discarded") != "ready" {
		t.Fatal("incorrect confirmed readiness")
	}
}
