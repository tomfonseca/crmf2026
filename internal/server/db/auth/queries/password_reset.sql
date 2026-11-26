-- name: LockResetIdentity :one
SELECT id,email::text AS email,status,password_hash,password_changed_at
FROM auth.users WHERE id=$1 FOR UPDATE;

-- name: ResetTokenOwner :one
SELECT user_id FROM auth.user_tokens
WHERE token_hash=$1 AND kind='password_reset' AND realm=$2;

-- name: LockResetToken :one
SELECT * FROM auth.user_tokens
WHERE token_hash=$1 AND kind='password_reset' AND realm=$2 FOR UPDATE;

-- name: AuthDatabaseTime :one
SELECT clock_timestamp()::timestamptz AS at;

-- name: InvalidateResetTokens :exec
UPDATE auth.user_tokens SET used_at=clock_timestamp(),updated_at=clock_timestamp()
WHERE user_id=$1 AND realm=$2 AND kind='password_reset' AND used_at IS NULL;

-- name: InsertResetToken :exec
INSERT INTO auth.user_tokens(token_hash,user_id,kind,realm,password_epoch,created_at,expires_at,updated_at)
VALUES ($1,$2,'password_reset',$3,$4,$5,$5::timestamptz+interval '30 minutes',$5);

-- name: ConsumeResetToken :execrows
UPDATE auth.user_tokens SET used_at=clock_timestamp(),updated_at=clock_timestamp()
WHERE token_hash=$1 AND kind='password_reset' AND realm=$2 AND used_at IS NULL
AND expires_at>clock_timestamp();

-- name: PruneUserTokens :exec
DELETE FROM auth.user_tokens WHERE expires_at < $1;
