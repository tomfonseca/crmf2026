package tenancy

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io/fs"
	"regexp"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/crmf/crmf/internal/server/db/control"
	"github.com/crmf/crmf/migrations"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
	"golang.org/x/crypto/pbkdf2"
)

type ProvisionInput struct {
	Slug, LegalName, CNPJ string
	PlanID                uuid.UUID
}
type ProvisionResult struct {
	ID            uuid.UUID
	Slug          string
	SchemaVersion int64
}
type Provisioner struct {
	control, analytics *pgx.Conn
	credentials        Credentials
	mu                 sync.Mutex
}

func OpenProvisioner(ctx context.Context, controlURL, analyticsURL string, credentials Credentials) (*Provisioner, error) {
	if credentials == nil {
		return nil, ErrInvalid
	}
	connect := func(raw, database string) (*pgx.Conn, error) {
		cfg, err := pgx.ParseConfig(raw)
		if err != nil {
			return nil, ErrUnavailable
		}
		cfg.RuntimeParams = map[string]string{"search_path": "pg_catalog", "statement_timeout": "20000", "lock_timeout": "5000", "application_name": "crmf-provisioner"}
		conn, err := pgx.ConnectConfig(ctx, cfg)
		if err != nil {
			return nil, ErrUnavailable
		}
		var allowed bool
		err = conn.QueryRow(ctx, "SELECT current_user='crmf_migrator' AND current_database()=$1 AND NOT rolsuper AND rolcreaterole FROM pg_roles WHERE rolname=current_user", database).Scan(&allowed)
		if err != nil || !allowed {
			_ = conn.Close(ctx)
			return nil, ErrUnavailable
		}
		return conn, nil
	}
	c, err := connect(controlURL, "crmf_control")
	if err != nil {
		return nil, err
	}
	a, err := connect(analyticsURL, "crmf_analytics")
	if err != nil {
		_ = c.Close(ctx)
		return nil, err
	}
	return &Provisioner{control: c, analytics: a, credentials: credentials}, nil
}
func (p *Provisioner) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	_ = p.control.Close(context.Background())
	_ = p.analytics.Close(context.Background())
}
func validProvisionInput(in ProvisionInput) bool {
	return slugPattern.MatchString(in.Slug) && utf8.ValidString(in.LegalName) && strings.TrimSpace(in.LegalName) == in.LegalName && utf8.RuneCountInString(in.LegalName) > 0 && utf8.RuneCountInString(in.LegalName) <= 200 && !strings.ContainsFunc(in.LegalName, unicode.IsControl) && regexp.MustCompile(`^[A-Z0-9]{12}[0-9]{2}$`).MatchString(in.CNPJ) && in.PlanID != uuid.Nil
}
func pgID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
func ident(name string) string      { return pgx.Identifier{name}.Sanitize() }

// Provision is idempotent only for the exact previously reserved identity.
// Cross-database steps are resumable, not falsely advertised as one transaction.
func (p *Provisioner) Provision(ctx context.Context, in ProvisionInput) (ProvisionResult, error) {
	if !validProvisionInput(in) {
		return ProvisionResult{}, ErrInvalid
	}
	if !p.mu.TryLock() {
		return ProvisionResult{}, ErrBusy
	}
	defer p.mu.Unlock()
	// The session lock spans both databases and secret custody. Closing this
	// operator-only connection always releases it, including cancellation/errors.
	var acquired bool
	if err := p.control.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1,7319))", in.Slug).Scan(&acquired); err != nil {
		return ProvisionResult{}, ErrUnavailable
	}
	if !acquired {
		return ProvisionResult{}, ErrBusy
	}
	defer func() {
		unlock, stop := context.WithTimeout(context.Background(), cleanupTimeout)
		defer stop()
		if _, err := p.control.Exec(unlock, "SELECT pg_advisory_unlock(hashtextextended($1,7319))", in.Slug); err != nil {
			_ = p.control.Close(unlock)
		}
	}()
	row, err := p.reserve(ctx, in)
	if err != nil {
		return ProvisionResult{}, err
	}
	// Existing resources require the original secret. Never regenerate a lost
	// password or adopt an unmarked schema/role merely because the slug matches.
	exists, err := p.resources(ctx, row)
	if err != nil {
		return ProvisionResult{}, err
	}
	if !exists && row.State == "ready" {
		return ProvisionResult{}, ErrConflict
	}
	id := uuid.UUID(row.ID.Bytes)
	secret, err := p.credentials.Get(ctx, id, row.Slug, row.SecretVersion)
	if errors.Is(err, ErrCredentialMissing) && row.SecretVersion == "" && !exists {
		secret, err = p.credentials.Create(ctx, id, row.Slug)
	}
	if err != nil {
		return ProvisionResult{}, err
	}
	if !validCredential(secret, id) {
		return ProvisionResult{}, ErrConflict
	}
	if row.SecretVersion == "" {
		if err := control.New(p.control).PinTenantSecret(ctx, control.PinTenantSecretParams{TenantID: row.ID, SecretVersion: secret.Version}); err != nil {
			return ProvisionResult{}, ErrUnavailable
		}
	}
	if !exists {
		if err := p.createResources(ctx, row, secret.Password); err != nil {
			return ProvisionResult{}, err
		}
	}
	version, err := p.migrate(ctx, row)
	if err != nil {
		return ProvisionResult{}, err
	}
	if version < 1 || version < row.SchemaVersion {
		return ProvisionResult{}, ErrConflict
	}
	if err := p.grants(ctx, row); err != nil {
		return ProvisionResult{}, err
	}
	// Verify the generated password and isolated login before publishing ready.
	cfg := p.analytics.Config().Copy()
	cfg.User = row.DbRole
	cfg.Password = secret.Password
	cfg.RuntimeParams = map[string]string{"search_path": row.SchemaName, "statement_timeout": "20000"}
	probe, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return ProvisionResult{}, ErrUnavailable
	}
	err = checkRuntime(ctx, probe, row.DbRole, row.SchemaName)
	_ = probe.Close(ctx)
	if err != nil {
		return ProvisionResult{}, err
	}
	if row.State != "ready" || row.SchemaVersion != version {
		tx, err := p.control.Begin(ctx)
		if err != nil {
			return ProvisionResult{}, ErrUnavailable
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := control.New(tx)
		if q.TenantSchemaVersion(ctx, control.TenantSchemaVersionParams{ID: row.ID, SchemaVersion: version}) != nil || q.ReadyTenantProvisioning(ctx, row.ID) != nil || q.AuditTenantProvisioning(ctx, control.AuditTenantProvisioningParams{TenantID: row.ID, Action: "tenant.provision_ready", Target: pgtype.Text{String: id.String(), Valid: true}}) != nil {
			return ProvisionResult{}, ErrUnavailable
		}
		if tx.Commit(ctx) != nil {
			return ProvisionResult{}, ErrUnavailable
		}
	}
	return ProvisionResult{ID: id, Slug: row.Slug, SchemaVersion: version}, nil
}
func (p *Provisioner) reserve(ctx context.Context, in ProvisionInput) (control.ProvisionTenantRow, error) {
	q := control.New(p.control)
	row, err := q.ProvisionTenant(ctx, in.Slug)
	if err == nil {
		if row.LegalName != in.LegalName || row.Cnpj != in.CNPJ || uuid.UUID(row.PlanID.Bytes) != in.PlanID || row.Status != "trial" && row.Status != "active" {
			return row, ErrConflict
		}
		return row, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return row, ErrUnavailable
	}
	tx, err := p.control.Begin(ctx)
	if err != nil {
		return row, ErrUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q = control.New(tx)
	if _, err = q.ActiveProvisionPlan(ctx, pgID(in.PlanID)); err != nil {
		return row, ErrInvalid
	}
	id, err := uuid.NewV7()
	if err != nil {
		return row, ErrUnavailable
	}
	if q.ReserveTenant(ctx, control.ReserveTenantParams{ID: pgID(id), Slug: in.Slug, LegalName: in.LegalName, Cnpj: in.CNPJ, SchemaName: "t_" + in.Slug, DbRole: "r_" + in.Slug}) != nil {
		return row, ErrConflict
	}
	subscriptionID, err := uuid.NewV7()
	if err != nil {
		return row, ErrUnavailable
	}
	if q.ReserveTenantSubscription(ctx, control.ReserveTenantSubscriptionParams{ID: pgID(subscriptionID), TenantID: pgID(id), PlanID: pgID(in.PlanID)}) != nil || q.ReserveTenantProvisioning(ctx, pgID(id)) != nil || q.AuditTenantProvisioning(ctx, control.AuditTenantProvisioningParams{TenantID: pgID(id), Action: "tenant.provision_reserved", Target: pgtype.Text{String: id.String(), Valid: true}}) != nil {
		return row, ErrUnavailable
	}
	if tx.Commit(ctx) != nil {
		return row, ErrUnavailable
	}
	row, err = control.New(p.control).ProvisionTenant(ctx, in.Slug)
	if err != nil {
		return row, ErrUnavailable
	}
	return row, nil
}
func (p *Provisioner) resources(ctx context.Context, row control.ProvisionTenantRow) (bool, error) {
	var schema, role, owned, marked, safe bool
	err := p.analytics.QueryRow(ctx, `SELECT
 EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1),
 EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2),
 EXISTS(SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname=$1 AND r.rolname=current_user),
 COALESCE((SELECT obj_description(oid,'pg_namespace')=$3 FROM pg_namespace WHERE nspname=$1),false),
 EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=$2 AND r.rolcanlogin AND NOT(r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication) AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid))`, row.SchemaName, row.DbRole, "crmf-tenant:"+uuid.UUID(row.ID.Bytes).String()).Scan(&schema, &role, &owned, &marked, &safe)
	if err != nil {
		return false, ErrUnavailable
	}
	if !schema && !role {
		return false, nil
	}
	if !schema || !role || !owned || !marked || !safe {
		return false, ErrConflict
	}
	return true, nil
}
func (p *Provisioner) createResources(ctx context.Context, row control.ProvisionTenantRow, password string) error {
	verifier, err := scramVerifier(password)
	if err != nil {
		return ErrUnavailable
	}
	tx, err := p.analytics.Begin(ctx)
	if err != nil {
		return ErrUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	statements := []string{
		"CREATE ROLE " + ident(row.DbRole) + " LOGIN PASSWORD '" + verifier + "' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION",
		"CREATE SCHEMA " + ident(row.SchemaName) + " AUTHORIZATION crmf_migrator",
		"REVOKE ALL ON SCHEMA " + ident(row.SchemaName) + " FROM PUBLIC",
		"COMMENT ON SCHEMA " + ident(row.SchemaName) + " IS 'crmf-tenant:" + uuid.UUID(row.ID.Bytes).String() + "'",
		"GRANT CONNECT ON DATABASE crmf_analytics TO " + ident(row.DbRole),
		"ALTER ROLE " + ident(row.DbRole) + " IN DATABASE crmf_analytics SET search_path TO " + ident(row.SchemaName),
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return ErrConflict
		}
	}
	if tx.Commit(ctx) != nil {
		return ErrUnavailable
	}
	return nil
}
func (p *Provisioner) migrate(ctx context.Context, row control.ProvisionTenantRow) (int64, error) {
	cfg := p.analytics.Config().Copy()
	cfg.RuntimeParams["search_path"] = row.SchemaName
	db := stdlib.OpenDB(*cfg)
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(1)
	files, err := fs.Sub(migrations.Files, "tenant")
	if err != nil {
		return 0, ErrUnavailable
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return 0, ErrUnavailable
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, files, goose.WithSessionLocker(locker))
	if err != nil {
		return 0, ErrUnavailable
	}
	if _, err := provider.Up(ctx); err != nil {
		return 0, ErrUnavailable
	}
	version, err := provider.GetDBVersion(ctx)
	if err != nil {
		return 0, ErrUnavailable
	}
	return version, nil
}
func (p *Provisioner) grants(ctx context.Context, row control.ProvisionTenantRow) error {
	schema, role := ident(row.SchemaName), ident(row.DbRole)
	tx, err := p.analytics.Begin(ctx)
	if err != nil {
		return ErrUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, statement := range []string{
		"GRANT USAGE ON SCHEMA " + schema + " TO " + role,
		"GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA " + schema + " TO " + role,
		"REVOKE ALL ON " + schema + ".goose_db_version FROM " + role,
		"GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA " + schema + " TO " + role,
		"REVOKE ALL ON SEQUENCE " + schema + ".goose_db_version_id_seq FROM " + role,
		"ALTER DEFAULT PRIVILEGES IN SCHEMA " + schema + " GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO " + role,
		"ALTER DEFAULT PRIVILEGES IN SCHEMA " + schema + " GRANT USAGE,SELECT ON SEQUENCES TO " + role,
	} {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return ErrUnavailable
		}
	}
	if tx.Commit(ctx) != nil {
		return ErrUnavailable
	}
	return nil
}
func scramVerifier(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	salted := pbkdf2.Key([]byte(password), salt, 4096, 32, sha256.New)
	defer clear(salted)
	mac := func(label string) []byte {
		m := hmac.New(sha256.New, salted)
		_, _ = m.Write([]byte(label))
		return m.Sum(nil)
	}
	client := mac("Client Key")
	defer clear(client)
	stored := sha256.Sum256(client)
	server := mac("Server Key")
	defer clear(server)
	enc := base64.StdEncoding.EncodeToString
	return "SCRAM-SHA-256$4096:" + enc(salt) + "$" + enc(stored[:]) + ":" + enc(server), nil
}
