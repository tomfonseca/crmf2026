# Reserve store quota under live policy and retain identity

Store creation counts every registered store, including inactive ones, under a tenant-row lock and shared subscription/plan locks, then inserts configuration and actor audit in the same restricted-control transaction. A detached EffectiveLimits snapshot or UI count cannot reserve concurrent capacity; null alone is unlimited and invalid policy fails closed.

Inactivation is the supported removal from active access, not physical deletion or automatic quota release. Keep store/network identity immutable and reject ERP-code changes once any device history exists, including revoked devices, to avoid silently redirecting future extraction/history; subsequent pairing/policy writers must follow tenant → subscription/plan → store lock order. Provisioning readiness stays read-only to the API rather than granting privileged UPDATE merely to acquire a row lock.
