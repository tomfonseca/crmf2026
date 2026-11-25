-- +goose Up
-- An operator-only, durable marker. Removing/disabling an administrator must
-- never implicitly reopen initial provisioning.
CREATE TABLE auth.platform_bootstrap (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    admin_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
GRANT SELECT, INSERT ON auth.platform_bootstrap TO crmf_auth;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'platform_bootstrap is irreversible; deploy a forward migration';
END $$;
-- +goose StatementEnd
