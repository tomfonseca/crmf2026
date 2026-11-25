-- name: LockNetworkSlug :exec
SELECT pg_advisory_xact_lock(hashtextextended($1,7319));

-- name: NetworkBySlug :one
SELECT t.*,s.plan_id,pl.name AS plan_name,p.state AS provision_state,
 COALESCE(r.generation,0)::int AS generation,COALESCE(r.job_id,0)::bigint AS job_id
FROM core.tenants t JOIN core.subscriptions s ON s.tenant_id=t.id
JOIN core.plans pl ON pl.id=s.plan_id
JOIN core.tenant_provisioning p ON p.tenant_id=t.id
LEFT JOIN LATERAL(SELECT generation,job_id FROM core.network_requests WHERE tenant_id=t.id ORDER BY generation DESC LIMIT 1)r ON true
WHERE t.slug=$1;

-- name: ListNetworks :many
SELECT t.*,s.plan_id,pl.name AS plan_name,p.state AS provision_state,
 COALESCE(r.generation,0)::int AS generation,COALESCE(r.job_id,0)::bigint AS job_id
FROM core.tenants t JOIN core.subscriptions s ON s.tenant_id=t.id
JOIN core.plans pl ON pl.id=s.plan_id
JOIN core.tenant_provisioning p ON p.tenant_id=t.id
LEFT JOIN LATERAL(SELECT generation,job_id FROM core.network_requests WHERE tenant_id=t.id ORDER BY generation DESC LIMIT 1)r ON true
WHERE t.slug COLLATE "C" > $1 ORDER BY t.slug COLLATE "C" LIMIT 101;

-- name: NetworkSlug :one
SELECT slug FROM core.tenants WHERE id=$1;

-- name: InsertNetworkRequest :exec
INSERT INTO core.network_requests(tenant_id,generation,job_id,actor_user_id,slug,legal_name,cnpj,plan_id)
VALUES($1,$2,$3,$4,$5,$6,$7,$8);

-- name: NetworkWork :one
SELECT r.* FROM core.network_requests r
JOIN core.tenants t ON t.id=r.tenant_id
JOIN core.subscriptions s ON s.tenant_id=t.id
WHERE r.tenant_id=$1 AND r.generation=$2 AND r.job_id=$3
AND t.slug=r.slug AND t.legal_name=r.legal_name AND t.cnpj=r.cnpj AND s.plan_id=r.plan_id;

-- name: AuditNetworkRequest :exec
INSERT INTO core.audit_log(actor_user_id,tenant_id,action,target,detail)
VALUES($1,$2,$3,$4,jsonb_build_object('generation',sqlc.arg(generation)::int,'source','qg'));
