-- +goose Up
-- (tenant_id,id) already has a unique-constraint index from 00002.
-- 00012 has been applied locally: remove its duplicate forward, never edit history.
DROP INDEX core.stores_catalog_tenant_id;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'store index cleanup is forward-only'; END $$;
-- +goose StatementEnd
