-- +goose Up
-- Password resets must invalidate challenges even when a caller only advances
-- the password epoch. Keep this forward-only instead of editing applied 00004.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION auth.invalidate_login_challenges() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE identity_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'users' THEN
        IF (NEW.password_hash,NEW.password_changed_at,NEW.status,NEW.mfa_secret_enc,NEW.mfa_enabled_at)
           IS NOT DISTINCT FROM (OLD.password_hash,OLD.password_changed_at,OLD.status,OLD.mfa_secret_enc,OLD.mfa_enabled_at) THEN
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
REVOKE ALL ON FUNCTION auth.invalidate_login_challenges() FROM PUBLIC;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'challenge_password_epoch is irreversible; deploy a forward migration';
END $$;
-- +goose StatementEnd
