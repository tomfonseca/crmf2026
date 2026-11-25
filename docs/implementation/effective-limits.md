# EffectiveLimits — M1 policy core

`app.EffectiveLimits(ctx, controlConnection)` reads the tenant only from
`auth.Principal(ctx)`. Anonymous/platform contexts are rejected before SQL.
It uses the existing restricted control connection and typed sqlc queries;
it does not access identity tables, accept a tenant/schema parameter, or cache
policy across requests.

The selected subscription replaces these plan limits through overrides:

- `sync_interval_seconds` and `history_months`: positive 32-bit integers.
- `max_stores` and `max_users`: positive 32-bit integers or explicit null
  (unlimited). Missing keys retain the plan value; zero is not unlimited.
- `modules`: a replacement array of known modules, not a union. An empty
  array disables all modules. Null and unknown names are rejected.

These are enforcement overrides, not edits to plan identity or billing
metadata. Unknown keys, invalid types, null required fields and payloads above
8 KiB fail closed. Modules are detached, sorted and deduplicated; getters do
not expose mutable internal slices.

Only active/trial tenants with active/trialing/past_due subscriptions receive
limits. Missing subscriptions and suspended/cancelled states are denied.
Ingestion grace does not authorize customer application access. Retiring a
plan prevents future assignment (to be implemented by administration) but
does not revoke existing subscriptions merely because `plans.active=false`.

Integration tests use actual restricted core/auth logins, synthetic persisted
sessions and two tenants with different plans. They verify realm isolation,
fresh overrides/status reads, no-subscription denial, cancellation and that
ingestion grace cannot unlock customer limits.

## Still pending

This increment adds the policy module, **not** provisioning or public routes.
It is not yet wired into login, `/v1/me`, HTTP module middleware, retention,
historical date clamping or agent configuration. User/store creation must
enforce quotas under transaction locks; a read-only limit snapshot is not a
capacity reservation. Administrative writes, concurrent quota enforcement and
the remaining integration points are later M1/M3 work. No final user,
business endpoint, ERP query or applied migration is changed.
