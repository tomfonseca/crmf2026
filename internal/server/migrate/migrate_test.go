package migrate

import (
	"context"
	"testing"
)

func TestRejectUnsafeScope(t *testing.T) {
	for _, scope := range []string{"tenant", "../../control", "public", ""} {
		if err := Up(context.Background(), "postgres://unused", scope); err == nil {
			t.Fatalf("accepted %q", scope)
		}
	}
}
