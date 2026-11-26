# QG layouts — M1 increment 13 (visual scope)

The supplied QG ZIP/Markdown defines the visual reference, not new backend
capabilities or permission policy. Sources remain private under ignored local
tooling. React components and scoped CSS reconstruct the shell and screen
families; no exported HTML, inline-style runtime or ERP connection is embedded.

## Delivered

- Authenticated full-width shell: 256px sidebar, collapsible 72px variant,
  mobile overlay/drawer with keyboard dismissal/focus containment, topbar,
  role-aware account disclosure, existing logout, theme, footer and skip link.
  The sidebar starts compact at medium desktop widths; manual preference persists
  only as literal expanded/collapsed under `crmf.hq.sidebar`. Theme remains the
  existing literal light/dark preference. Neither contains identity or secrets.
- Existing opaque-session/passkey platform authentication provides scope through
  an optional authenticated workspace render seam. No token or principal is
  accepted from navigation parameters. Account access still resolves the current
  backend identity and uses the established authentication UI.
- **Real Planos:** searchable current page, active/inactive filtering, desktop
  table and mobile cards, revision-protected create/update/delete, confirmation,
  unlimited checkboxes, immutable code, currency cents, minute presentation
  converted to integral API seconds. Existing sub-minute intervals and existing
  pulse assignments are preserved; new Pulse selection stays disabled, phase 2.
  Draft guards and failed-save draft retention, frozen revision during editing,
  explicit conflict/in-use feedback, user-initiated draft copy and list reload.
  No overwrite, actor or current-revision claims are fabricated.
- **Real Redes:** existing authenticated creation/active-plan selection,
  provisioning status and explicit same-tenant retry preserved in the shell.
  `/tenants/new` opens the real form. Search is explicitly scoped to the current
  bounded page. Runtime status is tenant status, not invented billing status.
- Shared UI Panel plus QG cards, badges, tables, filters, key-value lists,
  stepper, timeline/table alternative, native modal focus containment and
  responsive tokens. Existing auth and synthetic Dash remain separate.

## Complete visual screen-family inventory

The development-only `/__qg-design` catalogue contains all **125 QG boards**
(20 families) with the supplied headings and role/theme/state variations:

| Families | Production integration |
| --- | --- |
| QG-Painel | Planned health, alerts and aggregate overview; unknown values are unavailable, never zero |
| QG-Planos, QG-Planos-Mobile | Real bounded catalog; mobile cards |
| QG-Plano-Form, QG-Plano-Conflito, QG-Plano-Excluir | Real catalog operations; preview comparisons are illustrative, not an API enhancement |
| QG-Redes, QG-Rede-Nova | Real listing/creation/preparation summary |
| QG-Rede-Preparacao | Detailed step layout only; no invented per-step progress or invitation readiness |
| QG-Rede, QG-Rede-Acao | Data/subscription/limits/stores/first-admin/billing layouts and lifecycle dialogs; mutations disabled |
| QG-Lojas, QG-Loja-Form, QG-Loja | Store list/form/detail and health layouts; no store quota/backend implementation claimed |
| QG-Loja-Pareamento, QG-Loja-Reinstalar | Code/instructions/replacement layouts; no actual pairing code, MSI or revocation issued |
| QG-Dispositivos, QG-Dispositivo | Health/resources/streams/commands and confirmation dialogs; commands disabled |
| QG-Envios, QG-Lote | Monitor/timeline/detail/stages/attempts/quarantine layouts; no real ingest/reprocessing |

All production operational stubs require the existing platform identity, display
**Previsto**, expose no synthetic records and cannot mutate anything. Synthetic
values belong solely to explicit visual-preview mode, which makes no API calls
and does not supply authenticated scope. Confirming destructive preview dialogs
never calls a backend or claims success. These are UI implementations, **not
completed M1 store/pairing, M4 ingestion, M6 operational acceptance or M7 OTA**.
Releases/connectors/internal-users/audit are navigation placeholders, not extra
screen designs invented beyond the supplied ZIP.

## Menu icon correction

The shell now maps every navigation entry explicitly to the supplied SVG geometry,
including Documentation and the topbar controls. No generic building fallback or
font/Unicode icon substitutes remain. The SVGs use the reference viewBox, 1.75px
rounded stroke, inherited currentColor and 20px/16px dimensions. Decorative SVGs
are hidden from assistive technology; links retain accessible names when compact.
Documentation remains available as an icon in the collapsed sidebar and regains
its label in the mobile drawer. The search magnifier has reserved text padding.

Independent reference-geometry tests reproduced the original mismatch before the
fix. Browser checks cover exact navigation paths, actual size/color, light/dark,
collapse, mobile, documentation accessibility and non-overlapping search text.
The complete frontend suite passes with **67 unit and 15 browser tests**. This
correction changes no authentication, permissions, API or backend capability.

## Planos composition correction

The actual authenticated Planos screens now follow the supplied listing, form,
delete and discard screenshots: aligned page actions, compact search/segmented
filters, persistent table structure for an empty real catalog, compact rows and
module badges, five independent form cards in an adaptive 420px-minimum grid,
unit suffixes, quota checkboxes, a native accessible active switch and a separate
bottom action bar. Delete/discard use focused native dialogs with the reference
headers, borders, widths, backdrop and distinct destructive buttons. The earlier
all-board catalogue remains an illustrative development inventory, not visual
acceptance of the other internal modules.

SPA cancel/navigation, account/logout actions and browser history request a
custom discard confirmation. Continuing editing/Escape preserves the draft;
confirmed discard proceeds without saving. Browser reload/tab close retains the
browser-native beforeunload protection. Navigation is blocked during submission;
a confirmed server success releases that guard before returning to the listing.

The added production-component browser regression first failed on the original
composition. It checks action placement, five-card geometry, switch semantics,
dialogs, draft retention, back navigation, dark styling and mobile overflow, and
captures private screenshots for visual inspection. Existing CRUD still checks
BRL cents, nullable quotas, frozen revisions, typed deletion, support read-only
and session expiry. Complete local validation: **67 unit / 16 browser tests**,
typecheck, lint and production build. No pixel-perfect acceptance is claimed.

Example plans exist only in intercepted browser tests, never as seeded records
or an API-to-mock fallback. Missing subscription counts remain unavailable;
no fictional author/counts/plan prices are inserted to match a screenshot.

## Plan code validation correction

Plan codes retain the approved lowercase `[a-z0-9][a-z0-9_-]{0,63}` API
contract. For example, `P01` is invalid and `p01` is valid; no silent case
conversion, identifier migration or backend policy change is performed.

The original HTML pattern contained an unescaped hyphen. Modern browsers compile
`pattern` in Unicode-sets (`v`) mode and ignored that invalid expression, letting
uppercase values reach the API. The shared frontend pattern now escapes the
hyphen, shows an associated inline field error/focus before submission, and the
client independently rejects invalid creation codes before fetch. The server
remains authoritative and still rejects uppercase manual HTTP requests.

Regression evidence: the original browser considered `P01` valid; the same test
now rejects it with no POST, clears the field error on correction and completes
the existing CRUD flow. Unit checks cover native `v` compilation, accepted and
rejected codes, no silent normalization/no network for invalid creation and the
reported Essencial payload with explicit `p01`. Full frontend suite: **70 unit /
16 browser tests**, plus typecheck/lint/build.

## Automatic plan codes

Superseding the editable-code creation flow above, the real QG now requests
server-generated identifiers. Create displays **Gerado automaticamente** in a
read-only field, sends no `code`, then uses the authoritative returned value.
Editing and deleting retain immutable-code/revision protections. Codes are
`p_` plus the complete UUIDv7 hex, not guessed sequential values from a partial
page. Existing codes are preserved. See [catalog policy](hq-plans.md) for explicit
legacy-code API compatibility, concurrent allocation and uncertain-write limits.
Current full frontend verification: **71 unit / 16 browser tests**; real
PostgreSQL/HTTPS integration covers concurrent automatic allocation and audit.

## Routes and boundaries

- `/` retains the existing plan-catalog entry; `/overview` opens the planned panel.
- `/plans`, `/plans/new`, `/plans/:id`: existing authoritative plan API; direct
  edit lookup is limited to the loaded page. Unknown/unloaded IDs cannot select
  arbitrary data or mutate a record.
- `/tenants`, `/tenants/new`: reference-aligned real listing/four-card creation.
- `/tenants/:slug`, `/tenants/:slug/setup` and `?aba=dados|assinatura|lojas|usuarios|cobranca`:
  details/setup resolve checked records from the bounded real catalog page.
  Missing records offer explicit pagination; a route parameter never proves
  existence. Unsupported tab services/actions remain **Previsto**. See
  [network layout scope and evidence](hq-networks.md#reference-aligned-network-screens).
- `/stores[/new|/:id[/edit|/pairing|/reinstall]]`,
  `/devices[/:id]`, `/batches[/:id]`: planned layouts, authenticated, actions disabled.
- `/__qg-design`: Vite development only; preview inventory/route excluded from
  production build. No public registration, business mock fallback or impersonation.

## Deliberate differences from static references

1. Network identifiers keep the approved immutable `[a-z0-9_]` schema/role
   convention, not the design's hyphen example. No migration or credential naming
   rule is changed by a layout task.
2. Current APIs do not expose subscription counts, update actor/revision on
   conflict, commercial contacts, billing history, policy/health telemetry or
   provisioning substeps. Show unavailable information; do not guess.
3. Full client-wide search is not implemented by filtering one bounded page.
4. Support command/reprocessing authorization remains undecided. Neither support
   nor admin can execute not-yet-implemented commands.
5. Real readiness still requires verified provisioning metadata and schema
   version, not elapsed time, a completed-looking stepper or a completed job.
6. No historical ERP screenshot/store IDs are operational fixtures. Visual sample
   records are explicitly synthetic and cannot substitute for imported data.

## Evidence / local use

TypeScript, lint, Vitest and Playwright cover real catalog mutations/revisions,
opaque-cookie/passkey flows, support read-only behavior, theme, drawer/navigation,
planned action denial and existing demo regressions. The reference traversal
checks all 125 supplied titles at desktop and 320px, a single h1, no horizontal
overflow, no API request and no page error. This is structural/responsive
evidence, **not a pixel-diff approval of all boards or completion of pending APIs**.

An additional no-mock local browser smoke uses a disposable virtual passkey and
actual API/separate provisioner through the new shell, account navigation,
network creation/readiness and logout. Fixtures are removed; operator, sealing
key, credential versions/volume and restored ERP remain unchanged.

Rebuild only frontends with
`docker compose up -d --no-deps --build hq dash`. Use the current login/passkey;
do not bootstrap or enroll a new operator authenticator. Review the stacked PR
and remote CI before merging; predecessors remain separately reviewable.
