-- name: LoginOwner :one
SELECT id FROM auth.users WHERE email = sqlc.arg(email)::text::auth.citext;

-- name: LockLoginUser :one
SELECT id,status,password_hash,mfa_secret_enc,mfa_enabled_at,mfa_last_step,failed_logins,locked_until
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

-- name: ClearChallenges :exec
DELETE FROM auth.login_challenges WHERE user_id=$1 AND realm=$2;

-- name: CreateChallenge :exec
INSERT INTO auth.login_challenges(token_hash,user_id,realm,kind,secret_enc,created_at,expires_at)
VALUES($1,$2,$3,$4,$5,$6,$7);

-- name: ChallengeOwner :one
SELECT user_id FROM auth.login_challenges WHERE token_hash=$1 AND realm=$2;

-- name: LockChallenge :one
SELECT * FROM auth.login_challenges WHERE token_hash=$1 AND realm=$2 FOR UPDATE;

-- name: FailChallenge :exec
UPDATE auth.login_challenges SET attempts=attempts+1 WHERE token_hash=$1 AND attempts<5;

-- name: ConsumeChallenge :exec
UPDATE auth.login_challenges SET used_at=$2 WHERE token_hash=$1;

-- name: EnableMFA :exec
UPDATE auth.users SET mfa_secret_enc=$2,mfa_enabled_at=$3,mfa_last_step=$4,updated_at=$3 WHERE id=$1;

-- name: AdvanceMFAStep :exec
UPDATE auth.users SET mfa_last_step=$2,updated_at=$3 WHERE id=$1;

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

-- name: CancelChallenge :one
DELETE FROM auth.login_challenges WHERE token_hash=$1 AND realm=$2 AND used_at IS NULL RETURNING user_id;

-- name: PruneChallenges :exec
DELETE FROM auth.login_challenges WHERE expires_at < $1;

-- name: PruneIPAttempts :exec
DELETE FROM auth.ip_attempts WHERE last_attempt_at < $1;
