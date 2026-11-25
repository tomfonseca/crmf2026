-- name: ProvisionTenant :one
SELECT t.*, s.plan_id, p.secret_version, p.state
FROM core.tenants t
JOIN core.subscriptions s ON s.tenant_id=t.id
JOIN core.tenant_provisioning p ON p.tenant_id=t.id
WHERE t.slug=$1;

-- name: ReserveTenant :exec
INSERT INTO core.tenants(id,slug,legal_name,cnpj,status,schema_name,db_role)
VALUES($1,$2,$3,$4,'trial',$5,$6);

-- name: ReserveTenantSubscription :exec
INSERT INTO core.subscriptions(id,tenant_id,plan_id,status)
VALUES($1,$2,$3,'trialing');

-- name: ActiveProvisionPlan :one
SELECT id,name FROM core.plans WHERE id=$1 AND active=true FOR SHARE;

-- name: ReserveTenantProvisioning :exec
INSERT INTO core.tenant_provisioning(tenant_id) VALUES($1);

-- name: PinTenantSecret :exec
UPDATE core.tenant_provisioning SET secret_version=$2,updated_at=now() WHERE tenant_id=$1;

-- name: ReadyTenantProvisioning :exec
UPDATE core.tenant_provisioning SET state='ready',updated_at=now() WHERE tenant_id=$1;

-- name: TenantSchemaVersion :exec
UPDATE core.tenants SET schema_version=$2,updated_at=now() WHERE id=$1;

-- name: AuditTenantProvisioning :exec
INSERT INTO core.audit_log(tenant_id,action,target,actor_user_id,detail)
VALUES($1,$2,$3,$4,jsonb_build_object('source',sqlc.arg(source)::text));

-- name: RuntimeTenant :one
SELECT t.id,t.slug,t.schema_name,t.db_role,t.schema_version,p.secret_version
FROM core.tenants t
JOIN core.tenant_provisioning p ON p.tenant_id=t.id AND p.state='ready'
JOIN core.subscriptions s ON s.tenant_id=t.id
WHERE t.id=$1 AND t.status IN ('trial','active')
AND s.status IN ('trialing','active','past_due') AND t.schema_version>0;
