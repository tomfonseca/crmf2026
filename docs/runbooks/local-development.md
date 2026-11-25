# Local development

The `crmf-dev` Compose project is isolated from the restored `crmf-local` ERP.
Keycloak uses host port 18080: port 58080 is reserved by Hyper-V on this Windows
host and silently failed forwarding despite a healthy container. If another
port fails, check Windows excluded TCP port ranges and Rancher forwarding logs;
do not disable firewall or change system reservations to work around it.
Ports are bound to 127.0.0.1. Never run `down -v` unless intentionally discarding
the synthetic local databases. Do not use production passwords in this stack.

Start with `make dev`; inspect `docker compose ps` and `docker compose logs api`.
The role-bootstrap and two migration containers should exit with status 0. The foundation worker
stays idle after validating dependencies. API readiness requires both databases
and an authenticated Blob Storage service-properties request.

M0 does not provision tenants. Tenant migration files cannot be applied with
the global migration CLI; M1 must provision a schema-bound role and connection.

Docker does not rerun initdb scripts on existing volumes. M1 adds a separate,
idempotent `postgres-bootstrap` service for application roles, ordered before
migrations. Run `docker compose up -d postgres-bootstrap` and
`docker compose wait postgres-bootstrap` if applying these roles independently.
Apply schema changes with new tracked migrations, not by deleting volumes.
Never point these initializers at the restored ERP. The local role/password
script is not an Azure provisioning script.

The API/worker control pool uses `crmf_core`, not the migrator. The analytics
dependency probe uses `crmf_platform_reader` in the API and
`crmf_platform_writer` in the worker; tenant pools arrive later in M1.
Identity access is reserved for `crmf_auth`. See
[M1 implementation status](../implementation/m1-control.md).

Keycloak is an unused legacy M0 dependency, not the authentication selected
by the current specification. Its removal and replacement by Mailpit happens
with the own-authentication implementation (passwords, opaque sessions, MFA,
invites/reset and grants). No business endpoint currently trusts Keycloak or
exposes data without the pending M1 authentication.

## Own-auth HTTP API (explicit opt-in)

Run `python scripts/tasks.py auth-dev`. This builds the backend and applies
`compose.auth.yaml`; the base `make dev` remains auth-disabled. Health probes
continue on port 8080. `GET /v1/me` returns 401 without a valid tenant session
when auth is enabled, and 404 when disabled. Equivalent QG routes live under
`/v1/hq`. No final users are automatically provisioned; use the operator-only
procedure below to create the first administrator. SPA login screens are pending.

The helper provisions an ignored persistent development key only when no
encrypted MFA state exists. Back up `.tools/local-secrets/mfa.key` securely;
never print, commit or rotate it by deleting it. Startup fails on missing or
invalid keys. Windows file permissions also depend on the workstation ACLs.
Production rejects file keys and requires a version-pinned Key Vault reference
plus managed identity. Never point this override at Azure or real ERP.

Cookies stay Secure even locally. Browser development must use trusted
localhost/HTTPS behavior; do not disable cookie security as a workaround.
Current allowed local Origins are `http://localhost:5174` (tenant) and
`http://localhost:5173` (platform), with `credentials: include` and
`X-CRMF-Request: 1` on mutations. No bearer login is enabled in phase 1.

Proxy headers are ignored by default. In Azure, explicitly restrict backend
ingress to the configured trusted proxy networks and set
`AUTH_TRUSTED_PROXIES` to those CIDRs, never all addresses. A trusted proxy
must append the client chain. Review this against the actual ingress before
deployment; do not trust arbitrary X-Forwarded-For headers.

## Initial platform administrator

After `python scripts/tasks.py auth-dev`, an authorized human can run:

```sh
MSYS_NO_PATHCONV=1 docker compose -f compose.yaml -f compose.auth.yaml exec api /crmfctl user create-admin \
  --email operator@example.invalid --name "Administrador local"
```

Replace the example identity before executing. `MSYS_NO_PATHCONV=1` prevents
Git Bash from rewriting `/crmfctl` as a Windows path. On PowerShell/Linux,
omit this environment-prefix syntax (or set the variable using the native
shell). In Git Bash/Mintty, insert `winpty` before `docker` if Docker cannot
attach a native TTY; alternatively use a supported native terminal. The password is requested twice without echo. Do not pass
it through flags, environment variables, shell history or a pipe. The command
rejects noninteractive password input. Never send passwords to the agent.

The native CLI can also be built with `go build -o bin/crmfctl.exe ./cmd/crmfctl`
on Windows (omit `.exe` on Linux), then run from an interactive terminal with
`AUTH_DATABASE_URL` securely supplied for the isolated auth role. Do not use
the migration role or point this procedure at the ERP. No default administrator
or password exists. `/crmfctl version` and `/crmfctl help` do not create users.

Successful bootstrap prints only the new UUID and instructions that MFA is
mandatory. It does not create a session, enroll TOTP or print recovery codes.
The first QG login must enroll/confirm MFA through the own-auth API; browser
login screens are still pending. Customer routes do not accept platform sessions.

Bootstrap is not an upsert, user-promotion command or password-recovery tool.
It refuses initialized platforms and existing emails. The durable marker stays
after the original identity is disabled/deleted; do not delete it or reset
volumes to regain access. A deliberate administrator-recovery procedure is
still pending. Integration tests never reset a real marker; their disposable
synthetic marker cleanup uses the local test migrator only.

All dependencies are locked by go.sum, pnpm-lock.yaml and Terraform lockfiles.
Generated files are committed; `make gen` must produce no diff in CI.
