//go:build integration

package auth

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestRecoveryQueuePersistentLimitsAndTerminalGuards(t *testing.T) {
	f, e, s := recoveryFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("rate test sent mail") })
	ctx := context.Background()
	email := f.user.String() + "@example.invalid"
	ip := fixtureIP(f)
	tests := []struct {
		purpose, value string
		count          int
	}{
		{"global", "", 120}, {"ip", ip.Unmap().String(), 10}, {"recipient", email, 3},
	}
	for _, tc := range tests {
		t.Run(tc.purpose, func(t *testing.T) {
			global := e.recoveryIndex("global", "")
			ipkey := e.recoveryIndex("ip", ip.Unmap().String())
			recipient := e.recoveryIndex("recipient", email)
			for _, key := range [][]byte{global, ipkey, recipient} {
				_, err := f.admin.Exec(ctx, "DELETE FROM auth.recovery_limits WHERE key=$1", key)
				if err != nil {
					t.Fatal(err)
				}
			}
			_, err := f.admin.Exec(ctx, "INSERT INTO auth.recovery_limits(key,attempts) VALUES($1,array_fill(statement_timestamp(),ARRAY[$2::int]))", e.recoveryIndex(tc.purpose, tc.value), tc.count)
			if err != nil {
				t.Fatal(err)
			}
			second, err := NewLocalRecovery(e, s.mailer)
			if err != nil {
				t.Fatal(err)
			}
			if err := second.Request(ctx, email, Tenant, ip); err != nil {
				t.Fatal("limited input became an oracle", err)
			}
			if did, err := s.ProcessOne(ctx); did || err != nil {
				t.Fatal("over-limit input queued")
			}
		})
	}
	bounded, cancel := context.WithTimeout(ctx, time.Nanosecond)
	defer cancel()
	if err := s.Request(bounded, email, Tenant, ip); err == nil {
		t.Fatal("unavailable intake falsely acknowledged")
	}
}
