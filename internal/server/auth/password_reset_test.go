package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestPasswordResetIssuanceRejectsInvalidOwnerAndRealmBeforeStorage(t *testing.T) {
	var engine Engine
	for _, tc := range []struct {
		id    uuid.UUID
		realm Realm
	}{
		{uuid.Nil, Tenant}, {uuid.Nil, Platform}, {uuid.New(), "invalid"},
	} {
		if _, err := engine.issuePasswordReset(context.Background(), tc.id, tc.realm); !errors.Is(err, ErrResetToken) {
			t.Fatal("unbound reset issuance accepted")
		}
	}
}
