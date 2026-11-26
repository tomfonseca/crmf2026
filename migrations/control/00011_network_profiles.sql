-- +goose Up
CREATE TABLE core.network_profiles (
 tenant_id uuid PRIMARY KEY REFERENCES core.tenants ON DELETE CASCADE,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=8192),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON core.network_profiles TO crmf_core;
GRANT UPDATE(data,version,updated_at) ON core.network_profiles TO crmf_core;
-- +goose StatementBegin
CREATE FUNCTION core.enforce_network_profile_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id THEN RAISE EXCEPTION 'immutable profile identity' USING ERRCODE='23514'; END IF;
 NEW.version=OLD.version+1; NEW.updated_at=now(); RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER network_profile_version BEFORE UPDATE ON core.network_profiles FOR EACH ROW EXECUTE FUNCTION core.enforce_network_profile_version();
REVOKE ALL ON FUNCTION core.enforce_network_profile_version() FROM PUBLIC;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'network profiles are forward-only'; END $$;
-- +goose StatementEnd
