-- name: AccountHasPasskey :one
SELECT EXISTS(SELECT 1 FROM auth.passkey_credentials WHERE user_id=$1 AND realm=$2);

-- name: ListOwnSessions :many
SELECT id,created_at,last_seen_at,idle_expires_at,expires_at,mfa_verified
FROM auth.user_sessions
WHERE user_id=$1 AND realm=$2 AND revoked_at IS NULL AND idle_expires_at>sqlc.arg(at)::timestamptz AND expires_at>sqlc.arg(at)::timestamptz
AND (sqlc.narg(after_id)::uuid IS NULL OR id<sqlc.narg(after_id)::uuid)
ORDER BY id DESC LIMIT 101;

-- name: OwnSessionExists :one
SELECT EXISTS(SELECT 1 FROM auth.user_sessions WHERE id=$1 AND user_id=$2 AND realm=$3);

-- name: RevokeOwnSession :execrows
UPDATE auth.user_sessions SET revoked_at=$4,updated_at=$4 WHERE id=$1 AND user_id=$2 AND realm=$3 AND revoked_at IS NULL;

-- name: ChangeOwnPassword :exec
UPDATE auth.users SET password_hash=$2,password_changed_at=$3,updated_at=$3,failed_logins=0,locked_until=NULL WHERE id=$1;
