-- name: CatalogPlans :many
SELECT * FROM core.plans WHERE code COLLATE "C" > $1 ORDER BY code COLLATE "C" LIMIT 101;

-- name: LockCatalogPlan :one
SELECT * FROM core.plans WHERE id=$1 FOR UPDATE;

-- name: InsertCatalogPlan :one
INSERT INTO core.plans(id,code,name,price_cents,active,sync_interval_seconds,history_months,max_stores,max_users,modules)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *;

-- name: UpdateCatalogPlan :one
UPDATE core.plans SET name=$2,price_cents=$3,active=$4,sync_interval_seconds=$5,history_months=$6,max_stores=$7,max_users=$8,modules=$9
WHERE id=$1 AND version=$10 RETURNING *;

-- name: DeleteCatalogPlan :exec
DELETE FROM core.plans WHERE id=$1;

-- name: AuditCatalogPlan :exec
INSERT INTO core.audit_log(actor_user_id,action,target,detail,at)
VALUES($1,$2,$3,jsonb_build_object('version',sqlc.arg(version)::integer),CURRENT_TIMESTAMP);
