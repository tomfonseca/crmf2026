-- +goose Up
-- M1 control foundation. Application roles must exist before migration.
CREATE SCHEMA core AUTHORIZATION crmf_migrator;
CREATE SCHEMA auth AUTHORIZATION crmf_migrator;
REVOKE ALL ON SCHEMA core, auth FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA auth;

CREATE TABLE core.plans (
    id uuid PRIMARY KEY,
    code text UNIQUE NOT NULL CHECK (length(btrim(code)) > 0),
    name text NOT NULL,
    price_cents integer NOT NULL CHECK (price_cents >= 0),
    active boolean NOT NULL DEFAULT true,
    sync_interval_seconds integer NOT NULL CHECK (sync_interval_seconds > 0),
    max_stores integer CHECK (max_stores > 0),
    max_users integer CHECK (max_users > 0),
    history_months integer NOT NULL CHECK (history_months > 0),
    modules text[] NOT NULL DEFAULT ARRAY['core']::text[],
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (modules <@ ARRAY['core', 'realtime', 'export', 'pulse']::text[])
);

CREATE TABLE core.tenants (
    id uuid PRIMARY KEY,
    slug text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9_]{3,40}$'),
    legal_name text NOT NULL,
    cnpj text UNIQUE NOT NULL,
    status text NOT NULL CHECK (status IN ('trial', 'active', 'suspended', 'cancelled')),
    schema_name text UNIQUE NOT NULL,
    db_role text UNIQUE NOT NULL,
    schema_version bigint NOT NULL DEFAULT 0 CHECK (schema_version >= 0),
    require_mfa boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (schema_name = 't_' || slug),
    CHECK (db_role = 'r_' || slug)
);

-- Tenant identifiers are immutable even to ordinary application updates.
-- +goose StatementBegin
CREATE FUNCTION core.enforce_tenant_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF (NEW.slug, NEW.schema_name, NEW.db_role) IS DISTINCT FROM
       (OLD.slug, OLD.schema_name, OLD.db_role) THEN
        RAISE EXCEPTION 'tenant identity is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER immutable_tenant_identity BEFORE UPDATE ON core.tenants
FOR EACH ROW EXECUTE FUNCTION core.enforce_tenant_identity();
REVOKE ALL ON FUNCTION core.enforce_tenant_identity() FROM PUBLIC;

CREATE TABLE core.subscriptions (
    id uuid PRIMARY KEY,
    tenant_id uuid UNIQUE NOT NULL REFERENCES core.tenants,
    plan_id uuid NOT NULL REFERENCES core.plans,
    status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
    overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides) = 'object'),
    gateway text,
    gateway_customer_id text,
    gateway_subscription_id text,
    current_period_end date,
    grace_until date,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE core.stores (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES core.tenants,
    code text NOT NULL,
    name text NOT NULL,
    cnpj text,
    city text,
    uf char(2),
    timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
    erp text NOT NULL DEFAULT 'linx_big',
    status text NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, code),
    UNIQUE (tenant_id, id)
);

CREATE TABLE core.pairing_codes (
    code_hash bytea PRIMARY KEY CHECK (octet_length(code_hash) = 32),
    store_id uuid NOT NULL REFERENCES core.stores,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > created_at)
);
CREATE INDEX pairing_codes_store_idx ON core.pairing_codes (store_id);

CREATE TABLE core.devices (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES core.tenants,
    store_id uuid NOT NULL,
    public_key bytea NOT NULL CHECK (octet_length(public_key) = 32),
    status text NOT NULL CHECK (status IN ('active', 'revoked')),
    agent_version text,
    updater_version text,
    target_agent_version text,
    os_version text,
    erp_version text,
    arch text CHECK (arch IN ('amd64', '386')),
    last_heartbeat_at timestamptz,
    last_batch_at timestamptz,
    last_error text,
    paired_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id, store_id) REFERENCES core.stores (tenant_id, id)
);
CREATE INDEX devices_store_idx ON core.devices (tenant_id, store_id);
CREATE UNIQUE INDEX one_active_device_per_store ON core.devices (store_id) WHERE status = 'active';

CREATE TABLE core.connector_configs (
    id uuid PRIMARY KEY,
    erp text NOT NULL,
    version text NOT NULL,
    spec jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object'),
    status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (erp, version)
);

CREATE TABLE core.audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id uuid,
    actor_device_id uuid,
    tenant_id uuid,
    action text NOT NULL CHECK (length(btrim(action)) > 0),
    target text,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
    at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_log_tenant_at_idx ON core.audit_log (tenant_id, at DESC);

CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    email auth.citext UNIQUE NOT NULL CHECK (length(btrim(email::text)) > 0),
    name text NOT NULL,
    status text NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
    password_hash text,
    password_changed_at timestamptz,
    mfa_secret_enc bytea,
    mfa_enabled_at timestamptz,
    failed_logins integer NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
    locked_until timestamptz,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth.user_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    token_hash bytea UNIQUE NOT NULL CHECK (octet_length(token_hash) = 32),
    realm text NOT NULL CHECK (realm IN ('platform', 'tenant')),
    mfa_verified boolean NOT NULL DEFAULT false,
    ip inet,
    user_agent text,
    last_seen_at timestamptz NOT NULL,
    idle_expires_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (idle_expires_at <= expires_at)
);
CREATE INDEX user_sessions_user_idx ON auth.user_sessions (user_id);
CREATE INDEX user_sessions_expiry_idx ON auth.user_sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE auth.user_tokens (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('invite', 'password_reset')),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > created_at)
);
CREATE INDEX user_tokens_user_idx ON auth.user_tokens (user_id);

CREATE TABLE auth.mfa_recovery_codes (
    user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    code_hash text NOT NULL,
    used_at timestamptz,
    PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE auth.user_grants (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    role text NOT NULL,
    tenant_id uuid REFERENCES core.tenants,
    store_id uuid,
    seller_code text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id, store_id) REFERENCES core.stores (tenant_id, id),
    CHECK (
        (role IN ('platform_admin', 'platform_support') AND tenant_id IS NULL AND store_id IS NULL AND seller_code IS NULL)
        OR (role = 'network_admin' AND tenant_id IS NOT NULL AND store_id IS NULL AND seller_code IS NULL)
        OR (role = 'store_manager' AND tenant_id IS NOT NULL AND store_id IS NOT NULL AND seller_code IS NULL)
        OR (role = 'employee' AND tenant_id IS NOT NULL AND store_id IS NOT NULL AND seller_code IS NOT NULL AND length(btrim(seller_code)) > 0)
    )
);
CREATE INDEX user_grants_user_idx ON auth.user_grants (user_id);
CREATE UNIQUE INDEX platform_grants_unique ON auth.user_grants (user_id, role) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX network_grants_unique ON auth.user_grants (user_id, tenant_id, role) WHERE tenant_id IS NOT NULL AND store_id IS NULL;
CREATE UNIQUE INDEX store_grants_unique ON auth.user_grants (user_id, tenant_id, store_id, role) WHERE store_id IS NOT NULL;

-- Application roles own no schemas/tables and cannot grant themselves access.
GRANT USAGE ON SCHEMA core TO crmf_core, crmf_auth;
GRANT USAGE ON SCHEMA auth TO crmf_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO crmf_core;
REVOKE ALL ON core.audit_log FROM crmf_core;
GRANT INSERT ON core.audit_log TO crmf_core, crmf_auth;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA core TO crmf_core;
GRANT USAGE ON SEQUENCE core.audit_log_id_seq TO crmf_auth;
GRANT SELECT ON core.tenants, core.stores TO crmf_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO crmf_auth;

-- Future migrations grant permissions explicitly; no broad default ACLs.
ALTER DEFAULT PRIVILEGES FOR ROLE crmf_migrator IN SCHEMA core, auth
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crmf_migrator IN SCHEMA core, auth
    REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crmf_migrator IN SCHEMA core, auth
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- +goose Down
-- Identity data and audit history must not be erased by automatic rollback.
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'identity_and_control is irreversible; deploy a forward migration';
END $$;
-- +goose StatementEnd
