# M1 — control and identity foundation

**Current factor: passkeys/WebAuthn, not TOTP.** Increment 8 below and
[ADR 0005](../adr/0005-passkeys-replace-totp.md) supersede the historical
TOTP-specific notes in increments 3/4. Applied migrations remain unchanged.

## Delivered in the first increment

- Migration `migrations/control/00002_identity_and_control.sql`: operational
  tables in `core` and identity/session/grant tables in `auth`.
- Restricted roles `crmf_core` and `crmf_auth`; neither owns objects, has
  administrative privileges, inherits privileges or can assume the other role.
- Audit append permissions only, including sequence usage; neither role can
  read, update, delete or truncate audit history.
- Tenant slug/schema/role consistency and immutable identifiers; store/tenant
  composite foreign keys prevent attaching devices or grants to another
  tenant's store. Grant shape and uniqueness constraints distinguish platform,
  network, manager and employee grants.
- Case-insensitive unique user emails through `auth.citext`, hash-length
  constraints for sessions/tokens, session realms and expiry constraints.
- No default broad permissions for future tables. Future migrations must grant
  the specific application permissions they require.
- `postgres-bootstrap` prepares disposable local roles before migrations,
  including on previously initialized volumes. No volume reset is needed.
- API/worker use `crmf_core`; analytics dependency probes use platform reader
  and writer roles respectively. Migration credentials are isolated to the
  migration containers.
- sqlc omits unused models so the general control package does not gain
  identity/password/session models merely by parsing the control migrations.

See [ADR 0002](../adr/0002-control-identity-isolation.md).

## Delivered in the second increment: authentication core

- `internal/server/auth`: password policy, Argon2id PHC hashing/verifying and
  bounded legacy-hash verification with a rehash signal. A pinned, licensed
  public corpus supplies 100,000 common passwords; see the adjacent
  `passwords/README.md` and `source.json` for provenance. Random salt and
  concurrency limits bound the memory allocated by password operations.
- Canonical random 32-byte opaque tokens and SHA-256 digests. Session issuance
  is owned by the later credential/MFA engine, never an unguarded token minter.
- An isolated auth-role pool, typed sqlc session queries and an import guard:
  only `internal/server/auth` imports `internal/server/db/auth`.
- `Service.Authenticate` resolves persisted sessions into `auth.Principal(ctx)`;
  callers cannot supply a tenant/schema/seller as an authorization shortcut.
  Scope getters return copies, and forbidden stores return not-found.
- Sessions reload identity/grants/tenant and store status on every resolution,
  enforce realm and MFA requirements, reject revoked/expired sessions and
  refresh idle expiry without extending the absolute expiry.
- Migration `00003_session_security.sql` rejects grants spanning customer
  tenants or mixing platform/customer realms. Grant changes and security-field
  changes revoke sessions in the same transaction, including direct SQL writes.
  Existing incompatible grants cause migration failure, not silent repair.
- Absolute session TTL and maximum idle extensions are constrained in Postgres.
  User-before-session lock ordering is shared by resolution and grant triggers.
- Migration execution now takes a PostgreSQL advisory lock; local integration
  packages also run serially to keep shared fixture migrations deterministic.

## Delivered in the third increment: password and MFA engine

- `Engine.Login` validates password/current grants and either issues a session
  or returns a separate, realm-bound, five-minute challenge. Platform first
  login and tenants requiring MFA receive no bypass session.
- `Engine.StartEnrollment` supports optional MFA with a current session and
  fresh password proof. Confirmation revokes existing non-MFA sessions.
- `Engine.CompleteMFA` enrolls/verifies TOTP through `pquerna/otp`, with
  six digits, 30-second periods and one adjacent step of clock skew. Persisted
  steps reject replay across challenges; user locks serialize concurrent use.
- AES-256-GCM protects pending/enrolled secrets with independent random nonces
  and user/purpose-bound AAD. Construction fails without an externally supplied
  32-byte key. There is no generated runtime-key fallback. Key Vault wiring
  arrives in the fourth increment below; automatic rotation remains pending.
- Enrollment returns ten random 128-bit recovery codes once; only SHA-256
  digests persist. Recovery consumption, challenge consumption, session
  issuance and successful audit events share one transaction.
- Every fifth consecutive credential/MFA failure blocks the account for
  1, 5, 15, then 60 minutes. Only complete authentication resets failures;
  password success cannot reset MFA counters. Attempts while locked do not
  prolong the block. Credential failures use one generic response.
- A sliding 20-attempt/minute IP budget persists in Postgres and is shared by
  realms, MFA steps and processes, independently of credential transactions.
  HTTP must derive IP from the trusted peer/proxy policy, not arbitrary headers.
- Failed login, account lock, challenge creation, MFA failure/enrollment and
  successful login append audit records without passwords/codes/URI/tokens.
  Result formatting is redacted and implicit JSON excludes all secret fields.
- `Engine.PruneExpiredState` removes stale IP buckets/expired challenges.
  Scheduling this maintenance and bounded HTTP deadlines/body sizes are gates
  before exposing routes. WAF/admission limits remain necessary under load.

See [ADR 0003](../adr/0003-password-proven-mfa-challenges.md). Integration tests
use synthetic credentials and a random test-only encryption key; they retain
synthetic audit history but clean users, grants, sessions, challenges and IP
buckets. No real user or reusable runtime key is provisioned.

## Delivered in the fourth increment: opt-in HTTP authentication

- Generated OpenAPI/Go/TypeScript contracts for tenant and platform login,
  MFA completion, logout, optional enrollment and authenticated identity:
  `/v1/auth/*`, `/v1/me`, `/v1/me/mfa` and their `/v1/hq` equivalents.
- Host-only realm-specific `__Host-` cookies are always Secure/HttpOnly/
  SameSite=Strict with path `/`. A separate five-minute challenge cookie is
  not a session. No opaque token appears in the JSON body. Provisioning URIs
  and recovery codes are intentionally returned only when needed and must not
  be persisted by the future frontend.
- Every mutation requires its realm's exact Origin and `X-CRMF-Request: 1`.
  Credentialed CORS does not accept wildcard/reflected origins, and the Dash
  origin cannot call QG routes. Bearer transport remains reserved for phase 2.
- Auth responses have no-store/no-cache, nosniff and no-referrer headers.
  JSON requests are limited to 8 KiB, reject unknown fields/trailing JSON and
  compressed bodies, and have ten-second operation contexts. The server
  bounds headers as well. Validation errors never echo submitted credentials.
- Source IP defaults to the TCP peer. Explicit ingress CIDRs can enable a
  bounded right-to-left X-Forwarded-For chain; untrusted peers cannot spoof it.
  A trusted proxy without a valid chain is rejected.
- Session logout/revocation and pending-challenge cancellation append audit
  records transactionally. Used challenges are not falsely audited as canceled.
  Disabled identities yield 403 when their persisted session identifies them.
- Auth uses its own pool and readiness probe. Expired IP/challenge cleanup
  runs at startup and every five minutes, with bounded contexts.
- `AUTH_ENABLED=true` requires full valid configuration. Production loads a
  canonical base64 32-byte key from a version-pinned Key Vault secret using
  managed identity (no CLI/default-credential or file fallback). Tests exercise
  the SDK with a fake transport, **not real Azure credentials/RBAC**.
- Explicit local opt-in: `python scripts/tasks.py auth-dev`, using
  `compose.auth.yaml`. A persistent key lives in ignored
  `.tools/local-secrets/mfa.key`, outside the build context. The helper refuses
  to generate a replacement if encrypted MFA state exists. API startup never
  generates a key or user. Base `make dev` keeps own-auth disabled (404 routes).

## Delivered in the fifth increment: operator-only initial administrator

- `crmfctl user create-admin --email ... --name ...` reads and confirms the
  password from an interactive terminal with echo disabled. No password flag,
  password environment variable, piped input or public registration endpoint
  is supported. Validation/storage errors do not echo credentials or DSNs.
- The CLI uses `AUTH_DATABASE_URL` and the isolated `crmf_auth` role; no
  migrator/superuser credentials or MFA encryption key are needed by the CLI.
  Password policy/Argon2id remain owned by the auth module.
- Migration `00006_platform_bootstrap.sql`, typed auth sqlc queries and
  `Service.BootstrapFirstAdmin` create the active identity, platform grant,
  durable marker and audit event atomically under an advisory transaction lock.
- Existing platform administrators or a previous marker close bootstrap.
  Existing emails are never promoted/replaced. The runtime role has only
  SELECT/INSERT on the marker, so deactivation/deletion does not reopen it.
- Bootstrap creates no session or MFA secret; first login still requires
  platform MFA enrollment. The backend image includes `/crmfctl`.
- CLI tests cover secret argument rejection, confirmation/read errors, output
  redaction and clearing mutable password buffers. Integration tests exercise
  concurrent bootstrap, marker ACLs, audit, no-promotion and mandatory MFA.
  Creation tests skip an already initialized developer database rather than
  reset its administration; fresh CI exercises creation normally.

See [ADR 0004](../adr/0004-one-time-platform-bootstrap.md) and the
[local operator procedure](../runbooks/local-development.md#initial-platform-administrator).

Invitations, password reset and MFA disable/recovery-code regeneration remain
**pending**. Initial login/MFA screens are delivered below; invitation/reset
screens and complete authenticated business navigation remain pending. No final user was provisioned by
the agent; only disposable synthetic identities were used in tests. The
dashboard remains mocked, and no business/ERP endpoint has been exposed.

## Delivered in the sixth increment: effective plan limits

- `app.EffectiveLimits` resolves the tenant exclusively from the authenticated
  context and loads its subscription/plan with the restricted control role.
- Strict override handling distinguishes absent quotas, explicit unlimited
  quotas and invalid zero/null values; modules replace rather than extend
  the base plan. Suspended/cancelled tenants/subscriptions fail closed.
- Unit and real-Postgres tests cover overrides, isolation, stale status,
  retired plans and invalid configuration. No identity SQL leaves auth.
- This is the internal policy module, not enforcement on still-pending
  business/admin routes. See [scope and remaining integration](effective-limits.md).

## Delivered in the seventh increment: initial authentication screens

- Shared generated-client transport for realm-specific credentialed requests,
  CSRF headers, no-store, HTTPS production configuration and bounded timeouts.
- QG login and separate customer `/login`, MFA verification/manual enrollment,
  one-time recovery-code acknowledgement, logout and expired-session handling.
- Secrets stay in memory only, with no external QR service, URL persistence,
  browser storage or logging. Outages never fall back to the synthetic demo.
- Vitest and synthetic-contract Playwright tests supplement the existing real
  backend HTTPS/Postgres tests; final-user/Azure acceptance still needs humans.
- See [authentication-web scope](authentication-web.md). No final account was
  created and no business/ERP route was exposed.

## Verify locally

```sh
make gen
make integration
go test ./...
make lint
make dev
```

`TestControlRoleIsolation` uses actual application-role logins and requires
SQLSTATE `42501` for denied operations; a missing table/schema is not accepted
as proof of isolation. `TestControlConstraints` exercises disposable synthetic
rows inside a rolled-back transaction. `make integration` runs the idempotent
local role bootstrap first. No test connects to the restored ERP.

The identity migration deliberately rejects `Down`. Changes must be new
forward migrations; never edit an already-applied migration to fix deployed
state. PostgreSQL role bootstrap is administrative and separate from domain
migrations; never execute the local-password script in Azure.

## Delivered in the eighth increment: passkeys replace TOTP

- Password-proven WebAuthn enrollment/assertion with required resident key and
  user verification, exact per-realm origin/RP ID and realm-derived user handle.
- `Engine.CompletePasskey` and `/v1/{hq/}auth/passkey` replace the TOTP engine
  and routes; optional initial enrollment uses `/v1/{hq/}me/passkey`.
- Forward migration 00007 preserves identities/passwords/bootstrap, invalidates
  old sessions/challenges, and refuses legacy enrolled factors instead of
  silently removing them. TOTP columns remain inert for migration compatibility.
- Sealed public credential/counter/backup state and challenge sessions use the
  original external key. Key-loss checks now include both new encrypted tables.
- Enrollment, proof, counter update, one-use recovery, session issuance and
  audit are transactional under user-before-challenge locking.
- Native browser prompts replace manual TOTP setup/codes. Windows Hello/PIN,
  biometrics and compatible external/synced passkeys are browser-mediated.
  Unsupported/canceled/expired ceremonies never grant access.
- Real cryptographic Go/Postgres/HTTPS tests plus native Chromium virtual-device
  browser enrollment/assertion cover both realms. No real operator passkey is
  created by tests. First/extra-key management and recovery are distinct:
  additional-key CRUD, disable/replacement and lost-admin recovery remain pending.

See [web authentication](authentication-web.md) for protocol, key custody,
local origins, migration boundaries and the limits of these tests.

## Delivered in the ninth increment: real QG plan catalog

- Authenticated Planos screen replaces the QG placeholder. Listing, creation,
  editing/deactivation and deletion use the real restricted control pool.
- Platform admins mutate; support reads only; every request reloads identity.
  Business methods independently enforce server-principal authorization.
- Forward migration 00008 adds database-owned revisions and immutable plan
  identity. Stale concurrent edits fail; subscription references prevent delete.
- All writes and actor/target/revision audit events are transactional. No
  audit-read or identity SQL privilege is added.
- Credentialed generated clients, exact-origin CSRF for POST/PUT/DELETE, strict
  policy JSON, bounded keyset pages, exact decimal-to-cents parsing and explicit
  unlimited quotas; no plans/prices are invented or seeded.
- Per-authenticated-mount TanStack Query cache, expiry handling, light/dark
  tokens, 360px layout and typed-code delete confirmation.
- Real restricted-role/Postgres/HTTPS tests and synthetic browser-contract CRUD/
  support/expiry tests complement the existing passkey and dashboard tests.

See [catalog scope and tests](hq-plans.md) and
[ADR 0006](../adr/0006-platform-catalog-write-policy.md). Networks, subscriptions,
tenant provisioning, stores and pairing remain subsequent M1 work.

## Not delivered / next increments

This is **M1 started, not M1 complete**. Authentication endpoints are available
only with explicit configuration; no business endpoints or real ERP records
are present in the dashboard yet. The worker still checks dependencies
and idles; giving it its future role does not implement ingestion.

1. Implement invitations/password-reset flows and their remaining screens using
   generated contracts. Never bypass platform MFA or reuse bootstrap to recover
   an already initialized platform.
2. Validate Key Vault/managed identity in Azure, design key rotation/rewrapping,
   ingress restrictions, load/admission protection and operational recovery.
3. Add authenticated identity/grant mutation interfaces and audit actor context;
   preserve the single-tenant/realm and session-revocation invariants already
   enforced by the database and resolver.
4. Invites/reset emails via Mailpit locally and ACS in Azure. Retire the unused
   Keycloak dependency, stale OIDC descriptions and local readiness check at
   that cutover, rather than presenting it as the new auth implementation.
5. Tenant provisioner, schema-bound pools, tenant migrations, integration of
   `EffectiveLimits` into authenticated routes/creation quotas, and additional
   cross-tenant/store authorization tests.
6. `/v1/me`, audited administrative endpoints and minimal QG, with generated
   OpenAPI clients. No unauthenticated provisioning route will be introduced.

Subsequent milestones implement the approved historical slice January–April
2026 through agent → Blob Storage → worker → aggregates → authenticated API.
Cost quality, comparison periods and target/role decisions remain explicit
prerequisites; no missing cost is replaced with zero in this increment.

GitHub CI passed on the dedicated CI repair and effective-limits PRs; local
checks alone never imply remote acceptance. The auth-screen PR must pass its
own CI. Azure provisioning and final-user acceptance remain unverified.
