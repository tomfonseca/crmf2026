-- +goose Up
-- Earlier queue migrations have already been applied. Fix the defaults forward:
-- separate clock_timestamp() calls can exceed the strict 15-minute CHECK.
ALTER TABLE auth.recovery_requests
    ALTER COLUMN created_at SET DEFAULT statement_timestamp(),
    ALTER COLUMN expires_at SET DEFAULT (statement_timestamp()+interval '15 minutes');
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'recovery defaults fix is forward-only'; END $$;
-- +goose StatementEnd
