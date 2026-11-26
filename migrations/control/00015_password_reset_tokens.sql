-- +goose Up
-- No email-token lifecycle was previously implemented. Do not adopt unbound
-- legacy tokens; this never changes passwords, sessions or MFA credentials.
UPDATE auth.user_tokens SET used_at=clock_timestamp(),updated_at=clock_timestamp()
WHERE used_at IS NULL;
ALTER TABLE auth.user_tokens
    ADD COLUMN realm text CHECK (realm IN ('tenant','platform')),
    ADD COLUMN password_epoch timestamptz,
    ADD CONSTRAINT bounded_password_reset CHECK (
        kind <> 'password_reset' OR used_at IS NOT NULL OR
        (realm IS NOT NULL AND expires_at <= created_at + interval '30 minutes')
    );
CREATE INDEX user_tokens_reset_live_idx ON auth.user_tokens(user_id,realm,created_at DESC)
WHERE kind='password_reset' AND used_at IS NULL;
CREATE UNIQUE INDEX user_tokens_one_reset_idx ON auth.user_tokens(user_id,realm)
WHERE kind='password_reset' AND used_at IS NULL;

-- +goose StatementBegin
CREATE FUNCTION auth.guard_user_token() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
    IF (NEW.token_hash,NEW.user_id,NEW.kind,NEW.realm,NEW.password_epoch,NEW.created_at,NEW.expires_at)
       IS DISTINCT FROM
       (OLD.token_hash,OLD.user_id,OLD.kind,OLD.realm,OLD.password_epoch,OLD.created_at,OLD.expires_at)
       OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at) THEN
        RAISE EXCEPTION 'user token identity and terminal state are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER guard_user_token BEFORE UPDATE ON auth.user_tokens
FOR EACH ROW EXECUTE FUNCTION auth.guard_user_token();
REVOKE ALL ON FUNCTION auth.guard_user_token() FROM PUBLIC;

-- Grant mutations already lock identity first (00003). Reset issuance and
-- consumption follow identity -> token, matching session/challenge revocation.
-- +goose StatementBegin
CREATE FUNCTION auth.invalidate_user_tokens() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE identity_id uuid;
BEGIN
    IF TG_TABLE_NAME='users' THEN
        IF (NEW.email,NEW.password_hash,NEW.password_changed_at,NEW.status,NEW.mfa_secret_enc,NEW.mfa_enabled_at)
           IS NOT DISTINCT FROM
           (OLD.email,OLD.password_hash,OLD.password_changed_at,OLD.status,OLD.mfa_secret_enc,OLD.mfa_enabled_at) THEN
            RETURN NEW;
        END IF;
        identity_id:=NEW.id;
    ELSIF TG_OP='DELETE' THEN identity_id:=OLD.user_id;
    ELSE identity_id:=NEW.user_id;
    END IF;
    UPDATE auth.user_tokens SET used_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE user_id=identity_id AND used_at IS NULL;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER invalidate_identity_user_tokens AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION auth.invalidate_user_tokens();
CREATE TRIGGER invalidate_grant_user_tokens AFTER INSERT OR UPDATE OR DELETE ON auth.user_grants
FOR EACH ROW EXECUTE FUNCTION auth.invalidate_user_tokens();
REVOKE ALL ON FUNCTION auth.invalidate_user_tokens() FROM PUBLIC;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'password_reset_tokens is irreversible; deploy a forward migration';
END $$;
-- +goose StatementEnd
