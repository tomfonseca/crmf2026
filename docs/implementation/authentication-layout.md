# Authentication layout — M1 increment 12

The supplied static authentication boards are visual references, not executable
application HTML. React implements their structure, scoped tokens and interactions;
the original ZIP/HTML and screenshots remain private under ignored local tooling.
The original visual increment changed no SQL or credentials. Subsequent
[own-account security](account-security.md) connects password/session APIs; deployment
still changes no operator password, passkey, bootstrap marker or ERP data.

## Layout and scope

- Light theme by default; split login above 992px, central cards for other auth
  steps, wide recovery-code card and account header/tabs. Mobile works from 320px,
  with hidden cover and 44px controls. The cover is deliberately a labelled
  placeholder, not an invented final asset.
- Shared CRM Farma branding, QG chip, system typography, blue focus rings,
  status banners/icons and separate clear/dark tokens. Styles are scoped to
  authentication and its authenticated workspace, not the synthetic Dash.
- Explicit field labels/IDs, inline validation/descriptions, first-error focus,
  password visibility toggle, a single h1 per surface, live status/error banners
  and keyboard-operable account tabs.
- Only the literal light/dark preference may persist as `crmf.auth.theme` in
  localStorage. No email, user/tenant ID, password, session, challenge, credential,
  recovery code or link token is stored there or in sessionStorage.
- Recovery codes are shown once in four groups of eight hex characters. Copy
  and .txt download require explicit user actions; acknowledgment is a checkbox
  followed by Continuar, which reloads authoritative server identity.
- Native WebAuthn remains browser-owned. No web PIN, biometric, TOTP or six-digit
  field is added. During browser interaction Cancel aborts the ceremony and
  revokes backend challenge state; after proof submission cancellation is
  disabled until the response to avoid racing cookie issuance against logout.
  Failed logout/cancellation is never reported as success.

## Surface inventory

| Reference family | Runtime status |
| --- | --- |
| Login, QG-Login, Login-Mobile | Real credential API; required-field, sending and generic-error states |
| Passkey, QG-Passkey-Primeiro | Real mandatory enrollment, native browser and server-verification phases |
| Passkey-Verificar | Real subsequent verification; recovery only for an existing credential |
| Passkey-Falha, Passkey-SemSuporte | Fail closed; retry or backend cancellation, never alternate authentication |
| Codigos-Recuperacao | Ten actual one-use codes, once-only acknowledgment/copy/download |
| Codigo-Uso | Real password-proven challenge completion; normalized four-block paste and generic errors |
| Sessao-Expirada | Focus revalidation removes authenticated content; realm-specific TTL guidance |
| Acesso-Bloqueado | Generic denial/rate-limit guidance; no account enumeration or remaining lock time |
| Auth-Indisponivel | Retry without granting demo/private access |
| EsqueciSenha | Layout available; sending disabled and explicitly Previsto until reset/email API exists |
| NovaSenha | Layout available; saving disabled until secure one-use link validation/reset API exists |
| Convite-Aceite | Layout available; no identity/role/email is asserted from an unvalidated link |
| Link-Invalido | Generic public guidance; precise expired/used/invalid variations are visual previews only |
| Conta, QG-Conta | Current identity, read-only profile, real password/session APIs; passkey management Previsto |

Profile name/email/last-access, passkey inventory and tenant MFA policy remain
absent from the identity contract; display unavailable states, never synthetic
people/keys/policy. Separate own-session endpoints now provide checked live
session references/timestamps without inventing devices. Password changes require
the current password and end all sessions while preserving passkeys/recovery
codes. The QG's mandatory passkey policy stays explicit. Additional/removable
passkeys, optional enrollment settings and recovery regeneration remain disabled.
The existing Sair action still revokes the current session.

Forgot/reset/invitation flows **do not** simulate HTTP 202, email delivery,
token validation, password updates, session revocation or activation. Incoming
reset/invitation query/hash values are discarded from the current browser entry;
they are not parsed as trusted claims or sent to an unimplemented API. Future
backend implementation still needs digests, single-use tokens, 30min/72h expiry,
anti-enumeration, rate limits, email delivery, revocation and audit.

## Entry points

QG:
- `/`, `/esqueci-senha`, `/nova-senha`, `/convite`, `/link-invalido`;
- `/minha-conta` requires the platform session and current backend identity.

Dash:
- `/login` and the same subpaths beneath `/login/`;
- `/login/minha-conta` requires the tenant session.
- Existing performance/goals demos remain separate; login never redirects to
  fake analytics presented as actual customer data.

The QG Vite development server also offers `/__auth-design`: an explicitly
synthetic **94-board** catalogue for both realms, states and themes. It neither
calls the API nor provides authenticated scope. Completed email/reset/invite
states can be inspected only as labelled visual boards, not reached as fake
runtime successes. The route is guarded by `import.meta.env.DEV`; reference case
data and preview UI are tree-shaken from the production build.

## Verification and local deployment

Tests cover transport invariants, the original native virtual-authenticator flows,
recovery acknowledgment, field focus, theme-only persistence, pending-action
denial, token disposal, account scope and preserved catalog/demo behavior.
Playwright selects all 94 boards at desktop and 320px, checks every supplied h1,
one-title semantics, no horizontal overflow, no API request and no page errors.
This is structural/responsive/interaction evidence, not a pixel-diff acceptance
of every browser or a claim that pending security APIs exist.

Rebuild only the frontends:
`docker compose up -d --no-deps --build hq dash`.
Use the existing credentials/passkey at exact localhost origins. Do not rerun
bootstrap or enroll an operator authenticator. On resource-constrained Windows
hosts tests may be run with two workers without increasing individual timeouts.
Review the stacked PR and remote CI independently of local validation.
