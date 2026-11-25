-- name: LoginOwner :one
SELECT id FROM auth.users WHERE email = sqlc.arg(email)::text::auth.citext;

-- name: LockLoginUser :one
SELECT id,status,password_hash,mfa_enabled_at,failed_logins,locked_until
FROM auth.users WHERE id=$1 FOR UPDATE;

-- name: RecordFailure :exec
UPDATE auth.users SET failed_logins=$2,locked_until=$3,updated_at=$4 WHERE id=$1;

-- name: RehashPassword :exec
UPDATE auth.users SET password_hash=$2,updated_at=$3 WHERE id=$1;

-- name: LoginSuccess :exec
UPDATE auth.users SET failed_logins=0,locked_until=NULL,last_login_at=$2,updated_at=$2 WHERE id=$1;

-- name: CreateSession :exec
INSERT INTO auth.user_sessions(id,user_id,token_hash,realm,mfa_verified,ip,last_seen_at,idle_expires_at,expires_at,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$7);

-- name: ClearRecoveryCodes :exec
DELETE FROM auth.mfa_recovery_codes WHERE user_id=$1;

-- name: AddRecoveryCode :exec
INSERT INTO auth.mfa_recovery_codes(user_id,code_hash) VALUES($1,$2);

-- name: UseRecoveryCode :one
UPDATE auth.mfa_recovery_codes SET used_at=$3 WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash;

-- name: AuditAuth :exec
INSERT INTO core.audit_log(actor_user_id,action,target,detail,at)
VALUES (sqlc.narg(actor)::uuid,sqlc.arg(action)::text,sqlc.arg(target)::text,jsonb_build_object('realm',sqlc.arg(realm)::text),sqlc.arg(at)::timestamptz);

-- name: EnsureIP :exec
INSERT INTO auth.ip_attempts(ip,last_attempt_at) VALUES ($1,$2) ON CONFLICT DO NOTHING;

-- name: LockIP :one
SELECT attempts FROM auth.ip_attempts WHERE ip=$1 FOR UPDATE;

-- name: UpdateIP :exec
UPDATE auth.ip_attempts SET attempts=$2,last_attempt_at=$3 WHERE ip=$1;

-- name: PruneIPAttempts :exec
DELETE FROM auth.ip_attempts WHERE last_attempt_at < $1;
