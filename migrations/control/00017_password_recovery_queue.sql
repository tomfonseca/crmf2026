-- +goose Up
-- Authentication-only. No raw recipient, IP, link or token is stored in this queue.
CREATE TABLE auth.recovery_limits (
    key bytea PRIMARY KEY CHECK (octet_length(key)=32),
    attempts timestamptz[] NOT NULL DEFAULT '{}',
    touched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (cardinality(attempts)<=120)
);
CREATE TABLE auth.recovery_requests (
    id uuid PRIMARY KEY,
    recipient_key bytea NOT NULL CHECK (octet_length(recipient_key)=32),
    realm text NOT NULL CHECK (realm IN ('tenant','platform')),
    recipient_enc bytea,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','finished')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '15 minutes'),
    claimed_at timestamptz,
    finished_at timestamptz,
    CHECK (expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),
    CHECK ((state='pending' AND claimed_at IS NULL AND finished_at IS NULL AND recipient_enc IS NOT NULL)
        OR (state='claimed' AND claimed_at IS NOT NULL AND finished_at IS NULL AND recipient_enc IS NOT NULL)
        OR (state='finished' AND finished_at IS NOT NULL AND recipient_enc IS NULL)),
    CHECK (recipient_enc IS NULL OR octet_length(recipient_enc) BETWEEN 30 AND 1024)
);
CREATE UNIQUE INDEX recovery_requests_one_live ON auth.recovery_requests(recipient_key)
WHERE state IN ('pending','claimed');
CREATE INDEX recovery_requests_pending ON auth.recovery_requests(created_at,id) WHERE state='pending';
GRANT SELECT,INSERT,UPDATE,DELETE ON auth.recovery_requests,auth.recovery_limits TO crmf_auth;
REVOKE ALL ON auth.recovery_requests,auth.recovery_limits FROM crmf_core;
-- +goose StatementBegin
CREATE FUNCTION auth.guard_recovery_request() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
    IF (NEW.id,NEW.recipient_key,NEW.realm,NEW.created_at,NEW.expires_at)
       IS DISTINCT FROM (OLD.id,OLD.recipient_key,OLD.realm,OLD.created_at,OLD.expires_at)
       OR (OLD.state='finished')
       OR (OLD.state='claimed' AND NEW.state<>'finished')
       OR (OLD.state='pending' AND NEW.state NOT IN ('claimed','finished'))
       OR (NEW.state<>'finished' AND NEW.recipient_enc IS DISTINCT FROM OLD.recipient_enc)
       OR (OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at) THEN
        RAISE EXCEPTION 'recovery request transition rejected' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER guard_recovery_request BEFORE UPDATE ON auth.recovery_requests
FOR EACH ROW EXECUTE FUNCTION auth.guard_recovery_request();
REVOKE ALL ON FUNCTION auth.guard_recovery_request() FROM PUBLIC;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'recovery_queue is forward-only';
END $$;
-- +goose StatementEnd
