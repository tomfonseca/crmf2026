# M1 — operator provisioning and context-bound tenant pools

This tenth increment establishes the privileged provisioning kernel and real
Postgres role/schema isolation. **It does not yet connect network creation in
the QG, add a provisioning job, or complete M1.** The authenticated QG still
shows Planos; no new operational web screen is claimed.

## Privilege and lifecycle

- Only the operator CLI receives `PROVISION_CONTROL_DATABASE_URL` and
  `PROVISION_ANALYTICS_DATABASE_URL`. Both require the non-superuser
  `crmf_migrator`; analytics provisioning requires CREATEROLE.
- The API/worker Compose environments do not receive those credentials. Their
  existing control/identity/platform roles and the existing administrator,
  passkey and bootstrap marker are unchanged.
- The command requires an existing active plan and explicit slug/legal name/
  canonical CNPJ. CNPJ validation is syntactic (12 uppercase alphanumerics plus
  two digits), supports numeric/new alphanumeric identifiers, and does not
  certify tax registration. No company, plan, final user or grant is seeded.
- A cluster-wide per-slug session lock serializes independent operators. Exact
  reruns resume the original identity; differing legal name/CNPJ/plan conflicts.
- Reservation commits tenant `trial`, subscription `trialing`, pending
  metadata and `tenant.provision_reserved` audit together. Reservation is not
  ready analytics access.
- Credentials are random 256-bit service passwords, not human passwords.
  A pinned version binds each secret to the tenant UUID. Existing/malformed/
  disabled/unreadable credentials are never overwritten; loss requires recovery
  of the original. The original auth `mfa.key` is unrelated and untouched.
- Role and schema are created atomically. The migrator owns the schema and a
  tenant-UUID comment marks its identity. Existing unmarked, foreign, partial,
  elevated or role-member resources are rejected, not adopted.
- DDL uses sanitized pgx identifiers and a generated SCRAM verifier, not the
  plaintext password. No caller-supplied schema identifier reaches SQL.
- Goose runs the embedded tenant migrations using a connection whose search
  path is the validated tenant schema. The current tenant baseline is version
  1; canonical facts/dimensions and ERP data are **not** added here.
- Runtime grants are schema USAGE and table SELECT/INSERT/UPDATE/DELETE, with
  sequence USAGE/SELECT; future migrator-owned objects inherit scoped grants.
  Goose history and its sequence remain inaccessible. No CREATE, TEMP, role
  assumption, schema ownership or administrative privilege is granted.
- A real login probe must pass before readiness. Schema version, ready state
  and `tenant.provision_ready` audit commit together. Identical successful
  reruns do not duplicate success events or rotate credentials.
- Cross-database/Key Vault steps are resumable, not one distributed transaction.
  A failure after analytics commit preserves data for the next identical run.
  Missing resources of an already-ready tenant are never recreated empty.

Migration `00009_tenant_provisioning.sql` is forward-only. The new metadata
table grants `crmf_core` SELECT only: runtime cannot publish readiness.
CLI audit has no impersonated user; actor is null with `source=operator_cli`.
A future QG job must preserve its real authenticated actor separately.

## Operator command

Build `go build -o bin/crmfctl.exe ./cmd/crmfctl` on Windows (omit `.exe`
elsewhere). Supply connection URLs securely in the CLI process environment,
never command-line flags, chat, logs, or API/worker configuration.

Choose exactly one custody adapter:

- Production: `TENANT_KEYVAULT_URL=https://<vault>.vault.azure.net`, optionally
  `AZURE_CLIENT_ID`. Managed identity only; no Azure CLI/default/file fallback.
  Provisioner identity needs secret Get/Set; future runtime identity needs Get
  only. Use a separate vault/namespace per environment and a single authoritative
  control database/writer. Versions are pinned after creation. Actual Azure
  RBAC/network acceptance is pending.
- Development: `APP_ENV=development` plus
  `TENANT_CREDENTIALS_DIR=<private absolute directory>`, preferably
  `.tools/local-secrets/tenant-credentials`. Files are never a production
  fallback. POSIX group/other permissions are rejected; Windows requires
  private workstation ACLs. Keep this directory outside build context and back
  it up securely. Atomic no-replace publication requires filesystem hard links.

Provide `PROVISION_CONTROL_DATABASE_URL` and
`PROVISION_ANALYTICS_DATABASE_URL`, then:

```text
crmfctl tenant provision --slug <immutable_slug> --legal-name "<legal name>" --cnpj <canonical_cnpj> --plan-id <existing-active-plan-uuid>
```

Output contains only tenant UUID and schema version, never its password.
The command has a two-minute deadline and sanitized errors. Do not rerun
administrator bootstrap or enroll an operator authenticator for this command.

## Runtime pools

`tenancy.NewManager(ctx, restrictedControlPool, platformAnalyticsURL, credentials)`
validates the restricted control role and uses the analytics URL only as a
connection template. No migrator URL is accepted as a runtime template.

`manager.Pool(ctx)` resolves the tenant exclusively from
`auth.Principal(ctx)`. Anonymous/platform contexts fail before DB lookup.
Current tenant/subscription/readiness is checked before every cache lookup;
ingestion grace never unlocks analytics. The lookup is typed sqlc through
`crmf_core`, with no identity SQL or tenant/schema argument.

Each tenant pool has max 4 connections and fixes its own role/search path on
every new physical connection. Role flags, membership and forbidden CREATE/TEMP
rights are checked. Concurrent opens coalesce; unsuccessful opens can retry.
Idle pool objects without acquired connections are closed after ten idle
minutes, checked each minute. Close the manager before closing its control pool.
Do not retain pools across authenticated request scopes. Intentional credential
rotation/pool replacement and worker device principals are subsequent work.

The manager is not yet wired into business routes: there are no real analytic
handlers to serve until later milestones.

## Verification and limits

Real local Postgres integration covers two isolated tenant logins, own DML,
cross-schema read/write denial (42501), role-assumption/DDL/TEMP/history denial,
control-database connection denial, runtime readiness-write denial, live
subscription suspension despite cache, concurrent pool reuse, idempotency,
credential failure/retry, recovery after analytics commit without losing rows,
foreign-role refusal, missing ready schema refusal, missing original credential
refusal, and cross-process advisory locking. Fixtures are UUID-namespaced,
synthetic and removed after the test. Cleanup explicitly revokes the fixture's
analytics CONNECT grant before dropping its role; it does not grant SET ROLE
or weaken runtime isolation to make DROP OWNED work on Postgres 16.

Unit tests cover credential redaction/durability/no overwrite/path restrictions,
idle eviction, CLI validation/error redaction and Key Vault ownership/version/
disabled/permission/outage behavior with simulated transport, including the
SDK's initial bodyless authentication challenge.

A further local smoke executed the compiled operator CLI against real control/
analytics databases, provisioned a disposable synthetic tenant and repeated the
same command with identical output. Cleanup was checked separately. No real
operator identity, passkey or ERP was touched.

These tests do not establish every isolation layer, QG network creation, real
Azure access, canonical ERP data, tenant-wide migration orchestration or final
M1 acceptance. Do not reset volumes or edit applied migrations to demonstrate
this increment.
