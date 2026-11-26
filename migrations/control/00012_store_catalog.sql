-- +goose Up
ALTER TABLE core.stores ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
-- +goose StatementBegin
CREATE FUNCTION core.enforce_store_catalog_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.id,NEW.tenant_id) IS DISTINCT FROM (OLD.id,OLD.tenant_id) THEN
  RAISE EXCEPTION 'store identity is immutable' USING ERRCODE='23514';
 END IF;
 NEW.version=OLD.version+1;NEW.updated_at=now();RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER store_catalog_version BEFORE UPDATE ON core.stores FOR EACH ROW EXECUTE FUNCTION core.enforce_store_catalog_version();
REVOKE ALL ON FUNCTION core.enforce_store_catalog_version() FROM PUBLIC;
CREATE INDEX stores_catalog_tenant_id ON core.stores(tenant_id,id);
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'store catalog is forward-only'; END $$;
-- +goose StatementEnd
