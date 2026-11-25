//go:build integration

package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestExpiredSessionCannotRenew(t *testing.T) {
	f := newSessionFixture(t)
	f.now = f.now.Add(time.Hour) // Exactly the stored idle deadline, not one nanosecond after.
	if _, err := f.service.Resolve(context.Background(), f.token, Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("expired session renewed")
	}
	if _, err := f.service.Resolve(context.Background(), "malformed", Tenant); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("malformed token accepted")
	}
}
