-- +goose Up
-- Runtime control can observe but cannot claim successful provisioning.
CREATE TABLE core.tenant_provisioning (
    tenant_id uuid PRIMARY KEY REFERENCES core.tenants,
    secret_version text NOT NULL DEFAULT '',
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready')),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (state <> 'ready' OR secret_version <> '')
);
GRANT SELECT ON core.tenant_provisioning TO crmf_core;

-- +goose Down
DO $$ BEGIN
    RAISE EXCEPTION 'tenant provisioning is irreversible; deploy a forward migration';
END $$;
