-- name: SessionOwner :one
SELECT user_id FROM auth.user_sessions WHERE token_hash = $1 AND realm = $2;

-- name: LockIdentity :one
SELECT u.id, u.status, EXISTS(SELECT 1 FROM auth.passkey_credentials p WHERE p.user_id=u.id AND p.realm=$2) AS passkey_enrolled FROM auth.users u WHERE u.id=$1 FOR SHARE;

-- name: LockSession :one
SELECT id, user_id, mfa_verified, idle_expires_at, expires_at, revoked_at
FROM auth.user_sessions WHERE token_hash = $1 AND realm = $2 FOR UPDATE;

-- name: SessionGrants :many
SELECT g.role, g.tenant_id, g.store_id, COALESCE(g.seller_code, '') AS seller_code,
       COALESCE(t.status, '') AS tenant_status, COALESCE(t.require_mfa, false) AS require_mfa
FROM auth.user_grants g LEFT JOIN core.tenants t ON t.id = g.tenant_id
WHERE g.user_id = $1 ORDER BY g.id;

-- name: ActiveStores :many
SELECT id FROM core.stores WHERE tenant_id = $1 AND status = 'active' ORDER BY id;

-- name: TouchSession :exec
UPDATE auth.user_sessions SET last_seen_at = $2, idle_expires_at = LEAST($3, expires_at), updated_at = $2
WHERE id = $1;

-- name: RevokeSession :one
UPDATE auth.user_sessions SET revoked_at = $3, updated_at = $3
WHERE token_hash = $1 AND realm = $2 AND revoked_at IS NULL
RETURNING user_id;
