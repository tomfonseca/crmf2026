-- name: LatestHQPairing :one
SELECT c.id,c.store_id,c.expires_at,
 CASE WHEN c.used_at IS NOT NULL THEN 'used' WHEN c.revoked_at IS NOT NULL THEN 'revoked'
 WHEN c.store_version IS NULL OR c.store_version<>s.version OR s.status<>'active' THEN 'invalidated'
 WHEN c.expires_at<=clock_timestamp() THEN 'expired' ELSE 'pending' END::text AS status
FROM core.pairing_codes c JOIN core.stores s ON s.id=c.store_id
WHERE c.store_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 1;

-- name: ReservePairingIssuer :one
INSERT INTO core.pairing_issuers(actor_id,window_start,issued) VALUES($1,clock_timestamp(),1)
ON CONFLICT(actor_id) DO UPDATE SET
 window_start=CASE WHEN pairing_issuers.window_start<=clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE pairing_issuers.window_start END,
 issued=CASE WHEN pairing_issuers.window_start<=clock_timestamp()-interval '1 minute' THEN 1 ELSE pairing_issuers.issued+1 END
WHERE pairing_issuers.window_start<=clock_timestamp()-interval '1 minute' OR pairing_issuers.issued<5 RETURNING issued;

-- name: RecentStorePairing :one
SELECT EXISTS(SELECT 1 FROM core.pairing_codes WHERE store_id=$1 AND created_at>clock_timestamp()-interval '1 minute');

-- name: InsertHQPairing :exec
WITH stamp AS(SELECT clock_timestamp() AS at)
INSERT INTO core.pairing_codes(id,code_hash,store_id,store_version,created_at,expires_at)
SELECT $1,$2,$3,$4,at,at+interval '72 hours' FROM stamp;

-- name: RevokeStorePairings :exec
UPDATE core.pairing_codes SET revoked_at=clock_timestamp() WHERE store_id=$1 AND used_at IS NULL AND revoked_at IS NULL;

-- name: RevokeHQPairing :execrows
UPDATE core.pairing_codes SET revoked_at=clock_timestamp() WHERE store_id=$1 AND id=$2 AND used_at IS NULL AND revoked_at IS NULL;

-- name: LockPairingTenant :one
SELECT id FROM core.tenants WHERE id=$1 FOR UPDATE;

-- name: AuditHQPairing :exec
INSERT INTO core.audit_log(actor_user_id,tenant_id,action,target,detail)
VALUES($1,$2,$3,$4,jsonb_build_object('pairing_id',sqlc.arg(pairing_id)::uuid));
