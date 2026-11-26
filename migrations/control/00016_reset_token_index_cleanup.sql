-- +goose Up
-- 00015 was already applied during local validation. The unique live-token
-- index covers user/realm lookup; one live row makes created_at ordering redundant.
DROP INDEX auth.user_tokens_reset_live_idx;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    RAISE EXCEPTION 'reset_token_index_cleanup is forward-only';
END $$;
-- +goose StatementEnd
