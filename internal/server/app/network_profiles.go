package app

import (
	"context"
	"encoding/json"
	"net/mail"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode"
	"unicode/utf8"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/db/control"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Profile is mutable commercial metadata, not provisioning identity or billing authority.
// LegalName remains the legacy registration/provisioning snapshot; DisplayName is editable.
type NetworkProfile struct {
	DisplayName       string `json:"display_name"`
	RegisteredName    string `json:"registered_name"`
	City              string `json:"city"`
	UF                string `json:"uf"`
	ContactName       string `json:"contact_name"`
	ContactEmail      string `json:"contact_email"`
	DefaultTimezone   string `json:"default_timezone"`
	BillingCustomerID string `json:"billing_customer_id"`
}
type ProfileVersion struct {
	Data    NetworkProfile
	Version int32
}

func validProfile(p NetworkProfile) bool {
	for _, v := range []string{p.DisplayName, p.RegisteredName, p.City, p.ContactName, p.ContactEmail, p.BillingCustomerID, p.DefaultTimezone} {
		if !utf8.ValidString(v) || len(v) > 800 || utf8.RuneCountInString(v) > 200 || strings.TrimSpace(v) != v || strings.ContainsFunc(v, unicode.IsControl) {
			return false
		}
	}
	if p.UF != "" && (len(p.UF) != 2 || !strings.Contains("|AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO|", "|"+p.UF+"|")) {
		return false
	}
	if p.ContactEmail != "" {
		a, e := mail.ParseAddress(p.ContactEmail)
		if e != nil || a.Address != p.ContactEmail || a.Name != "" {
			return false
		}
	}
	if p.DefaultTimezone != "" {
		if !strings.HasPrefix(p.DefaultTimezone, "America/") {
			return false
		}
		if _, e := time.LoadLocation(p.DefaultTimezone); e != nil {
			return false
		}
	}
	return true
}
func loadProfile(ctx context.Context, db control.DBTX, id uuid.UUID) (ProfileVersion, error) {
	var p ProfileVersion
	var data []byte
	err := db.QueryRow(ctx, "SELECT data,version FROM core.network_profiles WHERE tenant_id=$1", id).Scan(&data, &p.Version)
	if err == pgx.ErrNoRows {
		return p, nil
	}
	if err != nil {
		return p, ErrNetworkUnavailable
	}
	if json.Unmarshal(data, &p.Data) != nil || !validProfile(p.Data) {
		return ProfileVersion{}, ErrNetworkUnavailable
	}
	return p, nil
}
func (n *Networks) UpdateProfile(ctx context.Context, id uuid.UUID, version int32, p NetworkProfile) (ProfileVersion, error) {
	if e := RequirePlatform(ctx, true); e != nil {
		return ProfileVersion{}, e
	}
	if id == uuid.Nil || version < 0 || !validProfile(p) {
		return ProfileVersion{}, ErrNetworkInvalid
	}
	tx, e := n.pool.Begin(ctx)
	if e != nil {
		return ProfileVersion{}, ErrNetworkUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := control.New(tx)
	slug, e := q.NetworkSlug(ctx, planUUID(id))
	if e == pgx.ErrNoRows {
		return ProfileVersion{}, ErrNetworkNotFound
	}
	if e != nil || q.LockNetworkSlug(ctx, slug) != nil {
		return ProfileVersion{}, ErrNetworkUnavailable
	}
	current, e := loadProfile(ctx, tx, id)
	if e != nil {
		return current, e
	}
	if current.Version != version {
		return ProfileVersion{}, ErrNetworkConflict
	}
	raw, e := json.Marshal(p)
	if e != nil {
		return ProfileVersion{}, ErrNetworkInvalid
	}
	var next int32
	e = tx.QueryRow(ctx, `INSERT INTO core.network_profiles(tenant_id,data) VALUES($1,$2) ON CONFLICT(tenant_id) DO UPDATE SET data=EXCLUDED.data RETURNING version`, id, raw).Scan(&next)
	if e != nil {
		return ProfileVersion{}, ErrNetworkUnavailable
	}
	if e = auditProfile(ctx, tx, id, next); e != nil {
		return ProfileVersion{}, e
	}
	if tx.Commit(ctx) != nil {
		return ProfileVersion{}, ErrNetworkUnavailable
	}
	return ProfileVersion{Data: p, Version: next}, nil
}
func (n *Networks) loadProfiles(ctx context.Context, items []Network) error {
	ids := make([]uuid.UUID, 0, len(items))
	for _, n := range items {
		ids = append(ids, n.ID)
	}
	if len(ids) == 0 {
		return nil
	}
	rows, e := n.pool.Query(ctx, "SELECT tenant_id,data,version FROM core.network_profiles WHERE tenant_id=ANY($1::uuid[])", ids)
	if e != nil {
		return ErrNetworkUnavailable
	}
	defer rows.Close()
	profiles := map[uuid.UUID]ProfileVersion{}
	for rows.Next() {
		var id uuid.UUID
		var data []byte
		var p ProfileVersion
		if rows.Scan(&id, &data, &p.Version) != nil || json.Unmarshal(data, &p.Data) != nil || !validProfile(p.Data) {
			return ErrNetworkUnavailable
		}
		profiles[id] = p
	}
	if rows.Err() != nil {
		return ErrNetworkUnavailable
	}
	for i := range items {
		if p, ok := profiles[items[i].ID]; ok {
			items[i].Profile = &p
		}
	}
	return nil
}
func auditProfile(ctx context.Context, tx pgx.Tx, id uuid.UUID, version int32) error {
	// No names, email, CNPJ or upstream payload in append-only audit.
	principal, _ := auth.Principal(ctx)
	_, e := tx.Exec(ctx, `INSERT INTO core.audit_log(actor_user_id,tenant_id,action,target,detail) VALUES($1,$2,'hq.tenant_profile_saved',$4,jsonb_build_object('version',$3::int))`, principal.UserID(), id, version, id.String())
	if e != nil {
		return ErrNetworkUnavailable
	}
	return nil
}
