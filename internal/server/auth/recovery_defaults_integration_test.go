//go:build integration

package auth

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestRecoveryQueueDatabaseDefaultsAreCoherent(t *testing.T) {
	f, e, _ := recoveryFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("default fixture mailed") })
	ctx := context.Background()
	var safe bool
	if err := f.admin.QueryRow(ctx, `SELECT bool_and(position('clock_timestamp' IN pg_get_expr(d.adbin,d.adrelid))=0)
 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
 WHERE d.adrelid='auth.recovery_requests'::regclass AND a.attname IN ('created_at','expires_at')`).Scan(&safe); err != nil || !safe {
		t.Fatal("queue defaults use inconsistent clocks", err)
	}
	id := uuid.New()
	enc, err := sealSecret(e.secrets, id, recoveryPurpose(Tenant), f.user.String()+"@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	var exact bool
	err = f.admin.QueryRow(ctx, `INSERT INTO auth.recovery_requests(id,recipient_key,custody_id,realm,recipient_enc)
 VALUES($1,$2,$3,'tenant',$4) RETURNING expires_at-created_at=interval '15 minutes'`, id, e.recoveryIndex("coalesce:"+string(Tenant), f.user.String()+"@example.invalid"), e.recoveryIndex("custody", ""), enc).Scan(&exact)
	if err != nil || !exact {
		t.Fatal("default queue lifetime rejected", err)
	}
}
