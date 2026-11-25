package tenancy

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/db/control"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const cleanupTimeout = 5 * time.Second
const poolIdle = 10 * time.Minute

type poolEntry struct {
	ready       chan struct{}
	pool        *pgxpool.Pool
	err         error
	lastUsed    time.Time
	fingerprint string
}
type Manager struct {
	core        *pgxpool.Pool
	base        *pgx.ConnConfig
	credentials Credentials
	mu          sync.Mutex
	entries     map[uuid.UUID]*poolEntry
	closed      bool
	stop        context.CancelFunc
	done        chan struct{}
}

func NewManager(ctx context.Context, core *pgxpool.Pool, analyticsURL string, credentials Credentials) (*Manager, error) {
	if core == nil || credentials == nil {
		return nil, ErrInvalid
	}
	var allowed bool
	if err := core.QueryRow(ctx, "SELECT current_user='crmf_core' AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolinherit OR rolbypassrls) FROM pg_roles WHERE rolname=current_user").Scan(&allowed); err != nil || !allowed {
		return nil, ErrUnavailable
	}
	cfg, err := pgx.ParseConfig(analyticsURL)
	if err != nil || cfg.Database != "crmf_analytics" || (cfg.User != "crmf_platform_reader" && cfg.User != "crmf_platform_writer") {
		return nil, ErrInvalid
	}
	cfg.Password = "" // Never retain even a restricted global password in tenant state.
	lifecycle, stop := context.WithCancel(context.Background())
	m := &Manager{core: core, base: cfg, credentials: credentials, entries: map[uuid.UUID]*poolEntry{}, stop: stop, done: make(chan struct{})}
	go func() {
		defer close(m.done)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-lifecycle.Done():
				return
			case now := <-ticker.C:
				m.prune(now)
			}
		}
	}()
	return m, nil
}

// Pool accepts no tenant/schema selector. Identity comes exclusively from the
// auth module's server-created principal. Current status is checked even when
// the tenant already has a cached pool.
func (m *Manager) Pool(ctx context.Context) (*pgxpool.Pool, error) {
	scope, ok := auth.Principal(ctx)
	if !ok || scope.Realm() != auth.Tenant || scope.TenantID() == uuid.Nil {
		return nil, auth.ErrForbidden
	}
	if m == nil {
		return nil, ErrUnavailable
	}
	row, err := control.New(m.core).RuntimeTenant(ctx, pgID(scope.TenantID()))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, auth.ErrSuspended
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrUnavailable
	}
	if !slugPattern.MatchString(row.Slug) || row.SchemaName != "t_"+row.Slug || row.DbRole != "r_"+row.Slug || !versionPattern.MatchString(row.SecretVersion) {
		return nil, ErrConflict
	}
	fingerprint := row.SecretVersion + ":" + row.SchemaName + ":" + row.DbRole
	id := scope.TenantID()
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil, ErrUnavailable
	}
	if entry, exists := m.entries[id]; exists {
		if entry.fingerprint != fingerprint {
			m.mu.Unlock()
			return nil, ErrConflict
		} // Rotation requires a deliberate replacement ceremony.
		entry.lastUsed = time.Now()
		m.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-entry.ready:
			return entry.pool, entry.err
		}
	}
	entry := &poolEntry{ready: make(chan struct{}), lastUsed: time.Now(), fingerprint: fingerprint}
	m.entries[id] = entry
	m.mu.Unlock()
	pool, openErr := m.open(ctx, row)
	m.mu.Lock()
	if m.closed && pool != nil {
		pool.Close()
		pool = nil
		openErr = ErrUnavailable
	}
	entry.pool, entry.err = pool, openErr
	if openErr != nil {
		delete(m.entries, id)
	}
	close(entry.ready)
	m.mu.Unlock()
	return pool, openErr
}
func (m *Manager) open(ctx context.Context, row control.RuntimeTenantRow) (*pgxpool.Pool, error) {
	operation, stop := context.WithTimeout(ctx, 20*time.Second)
	defer stop()
	secret, err := m.credentials.Get(operation, uuid.UUID(row.ID.Bytes), row.Slug, row.SecretVersion)
	if err != nil {
		return nil, err
	}
	if !validCredential(secret, uuid.UUID(row.ID.Bytes)) {
		return nil, ErrConflict
	}
	cfg, err := pgxpool.ParseConfig("")
	if err != nil {
		return nil, ErrUnavailable
	}
	cfg.ConnConfig = m.base.Copy()
	cfg.ConnConfig.User = row.DbRole
	cfg.ConnConfig.Password = secret.Password
	cfg.ConnConfig.RuntimeParams = map[string]string{"search_path": row.SchemaName, "statement_timeout": "20000", "lock_timeout": "5000", "application_name": "crmf-tenant"}
	cfg.MaxConns = 4
	cfg.MinConns = 0
	cfg.MaxConnIdleTime = poolIdle
	// Every newly opened physical connection must prove the expected role/path.
	cfg.AfterConnect = func(c context.Context, conn *pgx.Conn) error {
		return checkRuntime(c, conn, row.DbRole, row.SchemaName)
	}
	pool, err := pgxpool.NewWithConfig(operation, cfg)
	if err != nil {
		return nil, ErrUnavailable
	}
	if err = pool.Ping(operation); err != nil {
		pool.Close()
		return nil, ErrUnavailable
	}
	return pool, nil
}
func checkRuntime(ctx context.Context, conn *pgx.Conn, role, schema string) error {
	var allowed bool
	err := conn.QueryRow(ctx, `SELECT current_user=$1 AND current_schema()=$2 AND current_setting('search_path')=$2
 AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication)
 AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
 AND NOT has_schema_privilege(current_user,$2,'CREATE')
 AND NOT has_database_privilege(current_user,current_database(),'CREATE')
 AND NOT has_database_privilege(current_user,current_database(),'TEMP')
 FROM pg_roles r WHERE rolname=current_user`, role, schema).Scan(&allowed)
	if err != nil || !allowed {
		return ErrUnavailable
	}
	return nil
}
func (m *Manager) prune(now time.Time) {
	var unused []*pgxpool.Pool
	m.mu.Lock()
	for id, entry := range m.entries {
		select {
		case <-entry.ready:
			if entry.pool != nil && now.Sub(entry.lastUsed) >= poolIdle && entry.pool.Stat().AcquiredConns() == 0 {
				delete(m.entries, id)
				unused = append(unused, entry.pool)
			}
		default:
		}
	}
	m.mu.Unlock()
	for _, pool := range unused {
		pool.Close()
	}
}
func (m *Manager) Close() {
	m.stop()
	<-m.done
	m.mu.Lock()
	m.closed = true
	entries := m.entries
	m.entries = map[uuid.UUID]*poolEntry{}
	m.mu.Unlock()
	for _, entry := range entries {
		<-entry.ready
		if entry.pool != nil {
			entry.pool.Close()
		}
	}
}
