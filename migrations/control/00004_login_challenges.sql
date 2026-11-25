-- +goose Up
ALTER TABLE auth.users ADD COLUMN mfa_last_step bigint NOT NULL DEFAULT -1 CHECK (mfa_last_step >= -1);

CREATE TABLE auth.login_challenges (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash)=32),
    user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    realm text NOT NULL CHECK (realm IN ('platform','tenant')),
    kind text NOT NULL CHECK (kind IN ('verify','enroll')),
    secret_enc bytea,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
    CHECK ((kind='enroll' AND secret_enc IS NOT NULL) OR (kind='verify' AND secret_enc IS NULL))
);
CREATE INDEX login_challenges_user_idx ON auth.login_challenges(user_id);
CREATE INDEX login_challenges_expiry_idx ON auth.login_challenges(expires_at);

-- Shared across processes/realms. At most 20 retained instants per IP.
CREATE TABLE auth.ip_attempts (
    ip inet PRIMARY KEY,
    attempts timestamptz[] NOT NULL DEFAULT '{}',
    last_attempt_at timestamptz NOT NULL,
    CHECK (cardinality(attempts) <= 20)
);
CREATE INDEX ip_attempts_cleanup_idx ON auth.ip_attempts(last_attempt_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.login_challenges, auth.ip_attempts TO crmf_auth;

-- Security changes invalidate password-proven challenges too, not just sessions.
-- +goose StatementBegin
CREATE FUNCTION auth.invalidate_login_challenges() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE identity_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'users' THEN
        IF (NEW.password_hash,NEW.status,NEW.mfa_secret_enc,NEW.mfa_enabled_at)
           IS NOT DISTINCT FROM (OLD.password_hash,OLD.status,OLD.mfa_secret_enc,OLD.mfa_enabled_at) THEN
            RETURN NEW;
        END IF;
        identity_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN identity_id := OLD.user_id;
    ELSE identity_id := NEW.user_id;
    END IF;
    DELETE FROM auth.login_challenges WHERE user_id=identity_id;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER invalidate_identity_challenges AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION auth.invalidate_login_challenges();
CREATE TRIGGER invalidate_grant_challenges AFTER INSERT OR UPDATE OR DELETE ON auth.user_grants
FOR EACH ROW EXECUTE FUNCTION auth.invalidate_login_challenges();
REVOKE ALL ON FUNCTION auth.invalidate_login_challenges() FROM PUBLIC;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'login_challenges is irreversible; deploy a forward migration';
END $$;
-- +goose StatementEnd
