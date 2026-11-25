# Resumable tenant provisioning outside the API

Tenant provisioning needs CREATEROLE/schema ownership; runtime API/worker roles must not gain those powers. Keep the privileged module behind an operator-only `crmfctl tenant provision` command for this increment; a later authenticated QG operation must dispatch to an isolated provisioner, not open migration credentials in the API.

Control reservation, credential custody and analytics DDL cannot share a transaction. Serialize by a control-session advisory lock, reserve immutable identity, pin a tenant-owned secret version, create role/schema atomically with an ownership marker, run schema-bound Goose migrations, verify the actual restricted login, then publish readiness with audit atomically. Errors leave resumable pending state; never adopt foreign resources, regenerate a lost credential or recreate a missing ready schema.

Azure secret names cannot contain underscores. Since slugs contain only lowercase ASCII, digits and underscores (never hyphens), replacing underscores with hyphens in `pg-tenant-<slug>` is injective. Production uses version-pinned Key Vault secrets and managed identity; explicit private files exist only for development. Runtime pool selection accepts only the auth principal, not a request tenant/schema selector.
