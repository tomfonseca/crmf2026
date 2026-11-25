# M1 — authenticated QG plan catalog

The first operational QG screen replaces the post-login placeholder with
**Planos**. It reads/writes the real control database, not the dashboard demo or
ERP. No commercial plans, prices, tenants or subscriptions are seeded.

## Policy and API

- Platform sessions are reloaded through the auth module on each request.
  Tenant cookies, anonymous/revoked/expired sessions and bearer credentials do
  not grant QG access.
- `platform_admin` can create, edit/deactivate and delete. `platform_support`
  is read-only; backend policy applies even when UI controls are bypassed.
- `GET /v1/hq/plans?after=<code>`: at most 100 items, ordered by code with C
  collation. `next_cursor` is the last returned code when another page exists.
  Unknown/duplicate/malformed query filters are rejected.
- `POST /v1/hq/plans`: all policy fields required; creates a UUIDv7 plan.
- `PUT /v1/hq/plans/{id}`: full replacement of mutable policy fields plus
  required `version`. ID/code are immutable. Stale revisions return 409.
- `DELETE /v1/hq/plans/{id}`: requires current `version` and exact code as
  `confirmation`. Any subscription reference, including historical statuses,
  prevents deletion (409). Deactivate such plans instead.
- Every mutation requires exact QG Origin and `X-CRMF-Request: 1`. Secure
  realm cookies, no-store, bounded JSON bodies/contexts and redacted errors are
  shared with authentication. Null/missing/duplicate/unknown fields are checked;
  null is allowed only for unlimited store/user quotas.
- Price is integer cents (zero allowed). Intervals/history/finite quotas are
  positive int32. Modules are an explicit unique subset of
  `core/realtime/export/pulse`; an empty array enables nothing. UI BRL parsing
  uses decimal text, never floating-point rounding of submitted currency.

## Persistence and audit

`app.PlanCatalog` verifies the existing pool is logged in as restricted
`crmf_core`; it opens no privileged pool and imports no identity DB package.
Its methods require `auth.Principal(ctx)` and independently check platform role.
SQL is generated with sqlc; request fields never become SQL identifiers.

Forward migration 00008 adds positive integer revisions and a database trigger
that preserves plan identity and advances revision/time on every update,
including direct SQL changes. Updates lock the target and compare its revision.
Foreign keys make subscription-vs-delete races safe; there is no cascade delete.

Create/update/delete and their append-only `hq.plan_*` audit event commit in
one transaction. Audit records identify actor, target UUID and revision without
credentials or raw request payloads. Failed, stale and prohibited mutations do
not produce successful mutation events. No runtime audit-read privilege is added.

Deactivation is not subscription suspension: existing subscribers remain
linked and the existing effective-limit resolver continues to resolve retired
plans. Subscription reassignment and its eligibility checks are still pending.

## Frontend and tests

The authenticated QG owns its TanStack Query cache, which is not shared across
authenticated mounts; unobserved query/mutation data has zero GC retention.
401 remounts authentication and removes operational UI. Outages never become
an empty/synthetic success. The editor uses immutable identity, explicit
unlimited quotas, revision checks and a typed-code delete confirmation.
Canceled/unmounted transport does not promise that an already committed server
transaction was rolled back. Refresh before retrying an uncertain write.

The catalog uses existing light/dark tokens, keyboard-visible focus, native
labeled fields, semantic tables and bounded internal table scrolling at 360 px.
Vitest checks exact BRL conversion, credentialed versioned transport and error
redaction; Chromium tests cover CRUD, read-only support/mobile and session expiry.
Those browser API responses are synthetic. Real PostgreSQL/HTTPS integration
separately exercises restricted roles, MFA-proven platform sessions, live grant
revocation, CSRF, persistence/audit, in-use deletion, bounded pagination and
concurrent-edit conflict rejection. A further local live smoke used the rebuilt
API, Postgres and browser with a disposable synthetic identity and virtual
passkey, without mocked API requests: enrollment, plan create/edit/delete and
logout passed; the temporary identity/plan were removed. No test enrolls an
operator authenticator.

Rebuild the local API with `python scripts/tasks.py auth-dev`, then frontend
containers with `docker compose up -d --no-deps --build hq dash`.
Open **http://localhost:5173/** and refresh; existing accounts/passkeys are kept.
There is no need to rerun administrator bootstrap.

## Remaining M1

This is not M1 completion. Tenant provisioning/schema-bound pools and isolation
acceptance, networks/subscriptions/stores/pairing UI, invitations/reset/email,
account/session settings, audit reader and integration of limits into business
routes/quotas remain pending. No analytics, tenant provisioning, ERP connection,
billing gateway or device pairing is implemented by this catalog.
