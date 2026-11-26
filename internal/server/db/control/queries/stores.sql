-- name: ListHQStores :many
SELECT s.id,s.tenant_id,s.code,s.name,COALESCE(s.city,'')::text AS city,COALESCE(s.uf,'')::text AS uf,
 s.timezone,s.erp,s.status,s.version,t.slug AS network_slug,
 COALESCE(NULLIF(np.data->>'display_name',''),t.legal_name)::text AS network_name
FROM core.stores s JOIN core.tenants t ON t.id=s.tenant_id
LEFT JOIN core.network_profiles np ON np.tenant_id=t.id
WHERE s.id>sqlc.arg(after_id)::uuid AND (sqlc.narg(tenant_id)::uuid IS NULL OR s.tenant_id=sqlc.narg(tenant_id))
ORDER BY s.id LIMIT 101;

-- name: HQStore :one
SELECT s.id,s.tenant_id,s.code,s.name,COALESCE(s.city,'')::text AS city,COALESCE(s.uf,'')::text AS uf,
 s.timezone,s.erp,s.status,s.version,t.slug AS network_slug,
 COALESCE(NULLIF(np.data->>'display_name',''),t.legal_name)::text AS network_name
FROM core.stores s JOIN core.tenants t ON t.id=s.tenant_id
LEFT JOIN core.network_profiles np ON np.tenant_id=t.id WHERE s.id=$1;

-- name: LockStoreNetworkPolicy :one
SELECT t.status,t.schema_version,pr.state AS provision_state
FROM core.tenants t JOIN core.tenant_provisioning pr ON pr.tenant_id=t.id
JOIN core.subscriptions sub ON sub.tenant_id=t.id JOIN core.plans p ON p.id=sub.plan_id
WHERE t.id=$1 FOR UPDATE OF t FOR SHARE OF sub,p;

-- name: CountNetworkStores :one
SELECT count(*) FROM core.stores WHERE tenant_id=$1;

-- name: InsertHQStore :exec
INSERT INTO core.stores(id,tenant_id,code,name,city,uf,timezone,erp,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9);

-- name: UpdateHQStore :execrows
UPDATE core.stores SET code=$2,name=$3,city=$4,uf=$5,timezone=$6,erp=$7,status=$8
WHERE id=$1 AND version=$9;

-- name: StoreHasDevice :one
SELECT EXISTS(SELECT 1 FROM core.devices WHERE store_id=$1);

-- name: AuditHQStore :exec
INSERT INTO core.audit_log(actor_user_id,tenant_id,action,target,detail)
VALUES($1,$2,$3,$4,jsonb_build_object('version',sqlc.arg(version)::int));
