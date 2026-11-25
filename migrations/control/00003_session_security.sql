-- +goose Up
-- Fail closed on incompatible pre-existing grants instead of silently repairing identity.
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (
        SELECT user_id FROM auth.user_grants GROUP BY user_id
        HAVING count(DISTINCT tenant_id) > 1
            OR (bool_or(tenant_id IS NULL) AND bool_or(tenant_id IS NOT NULL))
    ) THEN
        RAISE EXCEPTION 'incompatible user grants require explicit remediation';
    END IF;
END $$;
-- +goose StatementEnd

-- All grant mutations lock identity before sessions, matching session resolution.
-- +goose StatementBegin
CREATE FUNCTION auth.guard_grant_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE identity_id uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'grant ownership is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN identity_id := OLD.user_id;
    ELSE identity_id := NEW.user_id; END IF;
    PERFORM 1 FROM auth.users WHERE id = identity_id FOR UPDATE;
    IF TG_OP <> 'DELETE' THEN
        IF EXISTS (
            SELECT 1 FROM auth.user_grants g
            WHERE g.user_id = identity_id AND g.id <> NEW.id
              AND g.tenant_id IS DISTINCT FROM NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'user grants must belong to one tenant or platform realm' USING ERRCODE = '23514';
        END IF;
    END IF;
    UPDATE auth.user_sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = identity_id AND revoked_at IS NULL;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER guard_grant_change BEFORE INSERT OR UPDATE OR DELETE ON auth.user_grants
FOR EACH ROW EXECUTE FUNCTION auth.guard_grant_change();
REVOKE ALL ON FUNCTION auth.guard_grant_change() FROM PUBLIC;

-- +goose StatementBegin
CREATE FUNCTION auth.revoke_identity_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF (NEW.password_hash, NEW.password_changed_at, NEW.status, NEW.mfa_secret_enc, NEW.mfa_enabled_at)
       IS DISTINCT FROM
       (OLD.password_hash, OLD.password_changed_at, OLD.status, OLD.mfa_secret_enc, OLD.mfa_enabled_at) THEN
        UPDATE auth.user_sessions SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = NEW.id AND revoked_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER revoke_identity_sessions AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION auth.revoke_identity_sessions();
REVOKE ALL ON FUNCTION auth.revoke_identity_sessions() FROM PUBLIC;

ALTER TABLE auth.user_sessions ADD CONSTRAINT bounded_session_expiry CHECK (
    expires_at > created_at
    AND expires_at <= created_at + CASE WHEN realm = 'platform' THEN interval '12 hours' ELSE interval '7 days' END
    AND idle_expires_at <= last_seen_at + CASE WHEN realm = 'platform' THEN interval '30 minutes' ELSE interval '12 hours' END
);

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'session_security is irreversible; deploy a forward migration';
END $$;
-- +goose StatementEnd
