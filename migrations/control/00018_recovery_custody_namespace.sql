-- +goose Up
-- 00017 was already applied during local proof. Preserve forward-only history.
-- Never let a worker holding a different custody key consume another queue.
UPDATE auth.recovery_requests SET state='finished',recipient_enc=NULL,finished_at=clock_timestamp()
WHERE state<>'finished';
ALTER TABLE auth.recovery_requests ADD COLUMN custody_id bytea;
UPDATE auth.recovery_requests SET custody_id=decode(repeat('00',32),'hex');
ALTER TABLE auth.recovery_requests ALTER COLUMN custody_id SET NOT NULL;
ALTER TABLE auth.recovery_requests ADD CONSTRAINT recovery_custody_shape CHECK(octet_length(custody_id)=32);
DROP INDEX auth.recovery_requests_pending;
CREATE INDEX recovery_requests_custody_pending ON auth.recovery_requests(custody_id,created_at,id) WHERE state='pending';
-- +goose StatementBegin
CREATE FUNCTION auth.guard_recovery_custody() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
    IF NEW.custody_id IS DISTINCT FROM OLD.custody_id THEN
        RAISE EXCEPTION 'recovery custody is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER guard_recovery_custody BEFORE UPDATE ON auth.recovery_requests
FOR EACH ROW EXECUTE FUNCTION auth.guard_recovery_custody();
REVOKE ALL ON FUNCTION auth.guard_recovery_custody() FROM PUBLIC;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'recovery_custody is forward-only'; END $$;
-- +goose StatementEnd
