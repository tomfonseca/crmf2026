-- +goose Up
ALTER TABLE core.pairing_codes ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN store_version integer CHECK (store_version > 0), ADD COLUMN revoked_at timestamptz;
CREATE INDEX pairing_codes_latest_idx ON core.pairing_codes(store_id,created_at DESC,id DESC);
CREATE TABLE core.pairing_issuers(actor_id uuid PRIMARY KEY, window_start timestamptz NOT NULL, issued integer NOT NULL CHECK(issued BETWEEN 1 AND 5));
REVOKE ALL ON core.pairing_issuers FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON core.pairing_issuers TO crmf_core;
-- +goose StatementBegin
CREATE FUNCTION core.guard_pairing_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.store_version IS DISTINCT FROM OLD.store_version OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at) OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
 RAISE EXCEPTION 'pairing identity and terminal state are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION core.guard_pairing_identity() FROM PUBLIC;
CREATE TRIGGER pairing_identity BEFORE UPDATE ON core.pairing_codes FOR EACH ROW EXECUTE FUNCTION core.guard_pairing_identity();
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'pairing code migration is forward-only'; END $$;
-- +goose StatementEnd
