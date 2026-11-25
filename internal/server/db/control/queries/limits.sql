-- name: TenantPlan :one
SELECT t.status AS tenant_status, s.status AS subscription_status,
       p.sync_interval_seconds, p.max_stores, p.max_users,
       p.history_months, p.modules, s.overrides
FROM core.tenants t
JOIN core.subscriptions s ON s.tenant_id = t.id
JOIN core.plans p ON p.id = s.plan_id
WHERE t.id = $1;
