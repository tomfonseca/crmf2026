# M1 — QG Redes and isolated provisioning jobs

Increment 11 adds Redes alongside Planos. It does not complete M1 or implement
stores, pairing, customer invitations, sales ingestion or analytic facts.

The [commercial-profile increment](network-profiles.md) now persists and edits
all eight commercial fields and supplies authenticated CNPJ suggestions. Older
visual-only limitations below have been updated; billing/invitations/telemetry
remain separate unavailable services.

## Visible flow

1. Sign in at the configured QG origin using the existing administrator and
   passkey. Do not rerun administrator bootstrap.
2. In Planos, create an active plan if none exists. No commercial values are seeded.
3. Open Redes → Cadastrar rede. Supply legal name, immutable lowercase identifier,
   canonical CNPJ and an existing active plan.
4. Cadastrar e preparar reserves a trial tenant/trialing subscription and a durable
   job. Na fila / Preparando does **not** mean that the network is ready.
5. Concluída is shown only after the isolated provisioner has created and checked
   its schema, restricted login and tenant migrations, and committed readiness.
6. On failure, Tentar preparar novamente submits a new attempt for the same
   network. Never regenerate a missing original credential or recreate missing
   ready storage as an empty schema.

CNPJ validation is syntactic, not tax-registration certification. No customer
user or grant is created. Support can list networks but cannot create/retry.
The form lists active plans with bounded pagination; inactive plans are rejected
again transactionally on creation. Switching themes and the 360px layout retain
the existing shared tokens. Credentials never enter browser storage.

Updates poll only after an explicit create/retry/refresh, for at most two
minutes, and only while visible. Atualizar redes resumes monitoring; there is no
indefinite polling that silently keeps a platform session alive.

## Reference-aligned network screens

The authenticated module, not just the development gallery, now follows the
Q02–Q09 images and privately supplied layout specifications/HTML:

- List: right-aligned Cadastrar rede, search/plan filters, seven reference
  columns, status badges and bounded cursor pagination. The subscription filter
  is disabled: network status is **not** subscription status. Unknown counts,
  telemetry, subscription status and dates display `—`, never invented zeros.
- Creation: four separate cards in a 420px-minimum responsive grid:
  Identificação, Dados cadastrais, Contato comercial, Assinatura. Display name,
  registered company name, city/UF, commercial contact, default timezone and manual
  billing reference are persisted in a versioned profile. CNPJ lookup supplies
  suggestions, never verified fiscal status. Identifier/CNPJ policy and active-plan
  selection remain unchanged; detail → Editar saves profile with revision checks.
- Accepted creation opens `/tenants/:slug/setup`. Five reference steps are
  visible, but intermediate schema/migration progress is not fabricated.
  Readiness/version alone confirms steps 2–3. Subscription reservation happens
  atomically at registration, not as a later simulated step. Invitations remain
  **Previsto**, even after readiness. Admin retry preserves identity/generation;
  support has no write actions, including on direct URLs.
- Existing network links open real details and five URL-addressable tabs:
  Dados cadastrais, Assinatura e plano, Lojas, Usuários, Eventos de cobrança.
  Subscription/limits cards share a responsive row, history spans the next row.
  Unimplemented services show unavailable values/disabled planned actions, not
  fictitious stores, users, effective limits or billing events.
- Detail/setup resolves only checked records from the bounded catalog page.
  A direct URL outside the loaded page offers explicit next-page loading; it
  does not establish existence or fabricate identity. The reserved creation
  path stays usable even for an existing `new` identifier via `?aba=dados`.
- Draft cancellation, sidebar/account/logout and browser history use the shared
  discard guard; reload uses native beforeunload. Pending saves block SPA
  navigation; success clears guard flags before routing. No drafts/business
  records enter browser storage. Tab arrows/Home/End preserve focus and URL.

Private browser comparisons use original HTML and intercepted test-only data
at 1440px in both themes; originals/captures are ignored. Dark token overrides
are scoped to this module, not an unrequested redesign of Planos. Mobile and
1024px checks cover overflow and adaptive cards. Deliberate service/contract
limitations above mean this is not pixel-perfect acceptance or M1 completion.

Layout-correction verification: **76 frontend unit / 17 browser tests**, typecheck,
lint and production build pass locally. Browser tests retain exact create/retry
payload and generation assertions, cover support direct URLs, all five tabs,
draft discard, keyboard focus and 320/390/1024/1440px layouts. Only HQ was rebuilt;
API/schema/roles, worker custody and ERP are unchanged. The deployed-bundle check
uses intercepted browser contracts with no writes, not a new native-authenticator
or no-mock provisioning acceptance run. The earlier real integration evidence
below remains distinct from this layout verification.

## Privilege boundary and durable intent

```text
QG → authenticated API (crmf_core)
      one control transaction:
        per-slug lock + tenant + subscription + pending metadata
        River job + immutable request snapshot + real-actor audit
    → River jobs schema, queue provision
    → separate server provisioner process (crmf_migrator + credential custody)
        resolve snapshot by tenant/generation/job ID; check reserved identity
        existing resumable kernel → real restricted login → readiness + audit
```

The API and ordinary worker have no migration URLs, tenant credential directory
or tenant-vault write access. Jobs contain only tenant ID and generation.
Legal identity, plan and actor are loaded from persisted intent, never trusted
from arbitrary job arguments. The queue name is trusted server wiring, never a
request parameter; integration tests use UUID-isolated queues so an already
running local provisioner cannot consume their fixtures.

Creation serializes by slug. An exact repeated request returns the original
network without another job; a changed identity conflicts. The reservation,
job and audit commit together or roll back together. Retry requires the latest
generation and a terminal/missing job, increments generation atomically, records
the current authenticated actor, and does not reserve another tenant. Accepted
work is durable; subsequent actor-session expiry does not cancel the authorized
intent. Suspension/cancellation checks in the existing kernel still apply.

API status reads use bounded sqlc control queries and River APIs, not hand-written
SQL over River internals. Successful job completion alone never means ready.
Metadata must be ready with a positive migrated schema version. Failed jobs
expose no raw SQL/Key Vault errors or passwords. Each submission permits one
attempt; River rescues interrupted jobs after three minutes, and terminal
failure can be retried explicitly. A stuck running attempt cannot be duplicated
through the retry endpoint. Job timeout is two minutes.

The schema baseline is still tenant version 1, not ERP facts. No distributed
transaction or exactly-once execution is claimed across databases and custody.
Idempotent provisioning handles worker restarts and post-commit completion races.

## Schema and deployment

- Forward-only control migration 00010 creates request history and the isolated
  jobs namespace. Runtime can insert only tenant ID in provisioning metadata,
  never readiness or secret versions; requests are SELECT/INSERT only.
- Apply control migrations, then `server migrate --scope queue` with the
  operator's control migration URL. River owns/version-migrates its tables.
- Queue runtime permissions are SELECT/INSERT, sequence usage/select, plus
  **UPDATE(kind)** required by River's no-op INSERT ON CONFLICT clause.
  Lifecycle state, attempts, errors and finalization cannot be updated by runtime.
  No queue DELETE, DDL, migration or tenant-secret permission is granted.
- Run `server provisioner` in a distinct privileged deployment/identity.
  It alone receives `PROVISION_CONTROL_DATABASE_URL`,
  `PROVISION_ANALYTICS_DATABASE_URL` and the custody configuration described in
  [tenant provisioning](tenant-provisioning.md). Production custody uses managed
  identity and Key Vault; actual Azure/RBAC/network acceptance remains pending.
- Locally `python scripts/tasks.py auth-dev` adds `compose.provision.yaml`.
  The dedicated nonroot process uses a persistent private Docker volume,
  `crmf-dev_tenant-credentials`. Back it up securely. Never remove/reset this
  volume to recover a network. It is not mounted into API/worker. No ERP mount.
- Rebuild QG after source changes with `docker compose up -d --build hq`, or
  use host Vite. To stop the whole opt-in stack without removing volumes:
  `docker compose -f compose.yaml -f compose.auth.yaml -f compose.provision.yaml stop`.

The base Compose stack remains auth-disabled. The operator CLI remains usable.
Existing operator identity, passkey, bootstrap marker and auth sealing key stay
unchanged.

## Contract and evidence

Generated OpenAPI/Go/TS: GET/POST `/v1/hq/tenants` and POST
`/v1/hq/tenants/{id}/retry`. Lists return at most 100 records and a stable
slug cursor. Admin-only mutations recheck live platform grants, exact Origin,
request header, strict bounded/duplicate-safe JSON and optimistic generation.
Support reads only; tenant cookies do not authenticate in QG.

Real PostgreSQL/HTTPS/River integration covers duplicate and concurrent requests,
identity conflicts, failing custody → explicit retry → genuine readiness,
preserved actor, stale retry, CSRF, injected actor rejection and restricted-role
denial of readiness, intent and lifecycle updates. Existing tenancy tests prove
cross-schema isolation and unsafe recovery refusal. Browser contract tests cover
creation, retry, confirmed ready and mobile support read-only. An additional
local Chrome smoke, without HTTP mocks, exercised a disposable virtual passkey,
real API, separately running Docker provisioner and actual schema/role/migrations.
Only disposable synthetic fixtures were removed; the operator and ERP were not
used. Remote CI and required PR review are separate acceptance gates.
