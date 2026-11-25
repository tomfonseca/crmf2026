-- +goose Up
ALTER TABLE core.plans ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
-- +goose StatementBegin
CREATE FUNCTION core.guard_plan_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
    IF (NEW.id,NEW.code) IS DISTINCT FROM (OLD.id,OLD.code) THEN
        RAISE EXCEPTION 'plan identity is immutable' USING ERRCODE='23514';
    END IF;
    NEW.version:=OLD.version+1;
    NEW.updated_at:=CURRENT_TIMESTAMP;
    RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER plan_revision BEFORE UPDATE ON core.plans FOR EACH ROW EXECUTE FUNCTION core.guard_plan_revision();
REVOKE ALL ON FUNCTION core.guard_plan_revision() FROM PUBLIC;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'plan_catalog is irreversible; deploy a forward migration'; END $$;
-- +goose StatementEnd
