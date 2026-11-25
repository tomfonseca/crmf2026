-- +goose Up
CREATE SCHEMA jobs AUTHORIZATION crmf_migrator;
REVOKE ALL ON SCHEMA jobs FROM PUBLIC;
GRANT USAGE ON SCHEMA jobs TO crmf_core;
-- API may reserve pending metadata, never write readiness or secret versions.
GRANT INSERT (tenant_id) ON core.tenant_provisioning TO crmf_core;
CREATE TABLE core.network_requests (
 tenant_id uuid NOT NULL REFERENCES core.tenants,
 generation integer NOT NULL CHECK(generation>0),
 job_id bigint UNIQUE NOT NULL,
 actor_user_id uuid NOT NULL,
 slug text NOT NULL CHECK(slug ~ '^[a-z0-9_]{3,40}$'),
 legal_name text NOT NULL, cnpj text NOT NULL,
 plan_id uuid NOT NULL REFERENCES core.plans,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,generation)
);
GRANT SELECT,INSERT ON core.network_requests TO crmf_core;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'network requests are irreversible; deploy a forward migration'; END $$;
-- +goose StatementEnd
