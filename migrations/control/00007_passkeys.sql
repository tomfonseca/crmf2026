-- +goose Up
-- Do not silently strand identities already enrolled with a legacy factor.
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM auth.users WHERE mfa_enabled_at IS NOT NULL OR mfa_secret_enc IS NOT NULL) THEN
        RAISE EXCEPTION 'legacy MFA enrollment exists; an authorized migration ceremony is required before passkey cutover';
    END IF;
END $$;
-- +goose StatementEnd
DELETE FROM auth.login_challenges;
UPDATE auth.user_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP);
ALTER TABLE auth.users ADD CONSTRAINT no_legacy_totp CHECK (mfa_secret_enc IS NULL AND mfa_last_step=-1);

CREATE TABLE auth.passkey_credentials (
    credential_id bytea PRIMARY KEY CHECK (octet_length(credential_id) BETWEEN 1 AND 1023),
    user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    realm text NOT NULL CHECK (realm IN ('platform','tenant')),
    credential_enc bytea NOT NULL CHECK (octet_length(credential_enc) >= 30),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX passkey_credentials_user_idx ON auth.passkey_credentials(user_id,realm);
CREATE TABLE auth.passkey_challenges (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash)=32),
    user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    realm text NOT NULL CHECK (realm IN ('platform','tenant')),
    kind text NOT NULL CHECK (kind IN ('verify','enroll')),
    session_enc bytea NOT NULL CHECK (octet_length(session_enc)>=30),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX passkey_challenges_user_idx ON auth.passkey_challenges(user_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON auth.passkey_credentials,auth.passkey_challenges TO crmf_auth;

-- +goose StatementBegin
CREATE FUNCTION auth.guard_passkey_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
    IF TG_OP='UPDATE' AND (NEW.user_id,NEW.realm,NEW.credential_id) IS DISTINCT FROM (OLD.user_id,OLD.realm,OLD.credential_id) THEN
        RAISE EXCEPTION 'passkey ownership is immutable' USING ERRCODE='23514';
    END IF;
    PERFORM 1 FROM auth.users WHERE id=NEW.user_id FOR UPDATE;
    RETURN NEW;
END $$;
CREATE FUNCTION auth.passkey_enrollment_changed() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE owner uuid;
BEGIN
    IF TG_OP='DELETE' THEN owner:=OLD.user_id; ELSE owner:=NEW.user_id; END IF;
    UPDATE auth.users SET mfa_enabled_at=CASE WHEN EXISTS(SELECT 1 FROM auth.passkey_credentials WHERE user_id=owner) THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=owner;
    UPDATE auth.user_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE user_id=owner;
    DELETE FROM auth.passkey_challenges WHERE user_id=owner;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION auth.invalidate_passkey_challenges() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE owner uuid;
BEGIN
    IF TG_TABLE_NAME='users' THEN
        IF (NEW.password_hash,NEW.password_changed_at,NEW.status,NEW.mfa_enabled_at) IS NOT DISTINCT FROM
           (OLD.password_hash,OLD.password_changed_at,OLD.status,OLD.mfa_enabled_at) THEN RETURN NEW; END IF;
        owner:=NEW.id;
    ELSIF TG_OP='DELETE' THEN owner:=OLD.user_id;
    ELSE owner:=NEW.user_id;
    END IF;
    DELETE FROM auth.passkey_challenges WHERE user_id=owner;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER passkey_owner BEFORE INSERT OR UPDATE ON auth.passkey_credentials FOR EACH ROW EXECUTE FUNCTION auth.guard_passkey_owner();
CREATE TRIGGER passkey_enrollment AFTER INSERT OR DELETE ON auth.passkey_credentials FOR EACH ROW EXECUTE FUNCTION auth.passkey_enrollment_changed();
CREATE TRIGGER passkey_identity_changed AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION auth.invalidate_passkey_challenges();
CREATE TRIGGER passkey_grants_changed AFTER INSERT OR UPDATE OR DELETE ON auth.user_grants FOR EACH ROW EXECUTE FUNCTION auth.invalidate_passkey_challenges();
REVOKE ALL ON FUNCTION auth.guard_passkey_owner(),auth.passkey_enrollment_changed(),auth.invalidate_passkey_challenges() FROM PUBLIC;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'passkey cutover is irreversible; deploy a forward migration'; END $$;
-- +goose StatementEnd
