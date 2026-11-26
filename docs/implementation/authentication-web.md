# M1 — authentication screens

See [the updated layout, all 94 reference variations and implementation boundaries](authentication-layout.md).

## Available surfaces

- QG: `http://localhost:5173/`, platform realm.
- Customer login: `http://localhost:5174/login`, tenant realm.
- Performance/goals routes remain an explicit synthetic demo. Successful login
  opens an authenticated placeholder, never fake indicators presented as real.

Enable the API explicitly with `python scripts/tasks.py auth-dev`; rebuild the
frontends with `docker compose up -d --no-deps --build hq dash`. Base Compose
disables auth. A 404/outage/bad response never grants anonymous/demo access.

The shared `@crmf/auth` uses generated OpenAPI clients, credentialed cookies,
the mandatory mutation header, no-store requests and bounded network deadlines.
Production requires an HTTPS `VITE_API_BASE_URL` at build time. Never put secrets
in `VITE_*`. Use the **exact configured frontend origin**: local passkeys use
`localhost`, not `127.0.0.1` or a workstation IP. Production origins must be DNS
names with HTTPS. RP ID is the frontend hostname, not the API hostname.

## Authentication flow

1. Resolve the realm's current identity; expired sessions return to login.
2. Submit email/password. Inputs clear immediately; nothing is written to
   localStorage/sessionStorage, URLs, console, analytics or logs. Only a literal
   theme preference may persist; it contains no authentication data.
3. For mandatory/previously enrolled MFA, receive five-minute, realm-bound
   WebAuthn options and a separate HttpOnly challenge cookie, never a session.
4. Click **Criar passkey** on first enrollment, or **Usar passkey** thereafter.
   `@simplewebauthn/browser` invokes the browser's native credential API. Choose
   Windows Hello, device PIN/biometrics, a compatible security key, or a passkey
   provider offered by the browser. User verification is required; UP-only
   authenticators are insufficient. Private keys and biometrics stay off-server.
5. Submit the serialized credential to `/v1/auth/passkey` or its QG equivalent.
   The server verifies origin/RP ID, user/credential, challenge, UV, signature,
   expiry and counter state before transactionally issuing the session.
6. Enrollment shows ten random recovery codes once. Acknowledge secure storage
   before the UI reloads identity and grants `useScope()`. Recovery is an
   explicit password-plus-single-use-code exception for an already enrolled key;
   it never bypasses initial enrollment. TOTP and its old endpoints are removed.
7. Logout/cancel revokes backend state; failure is not presented as success.

Cancellation/unsupported browsers fail closed without fallback. Native prompts
are aborted on UI expiration/unmount; retry remains possible. Focus rechecks
identity without keeping idle sessions alive in the background. Server-side
authorization remains authoritative, not hidden frontend controls.

`AuthOutcome.public_key` is a JSON-serialized creation/request options string;
`PasskeyInput.response` is serialized WebAuthn credential JSON or the explicit
32-hex recovery code. Both stay memory-only. Existing 8 KiB request bounds apply
(attestation preference is none); oversized responses fail, never fall back.

## Migration and key custody

See [ADR 0005](../adr/0005-passkeys-replace-totp.md). Migration 00007 preserves
users/passwords/bootstrap markers, expires old sessions/challenges and refuses
legacy enrolled secrets. Do not edit applied migrations or reset databases.
An initialized platform must **not** rerun administrator bootstrap. Refresh the
login page and use the existing credentials to enroll the passkey personally.

Keep the original ignored `.tools/local-secrets/mfa.key`: despite its historical
name, it now seals passkey credentials and ceremony state. The helper refuses
replacement when either legacy or passkey encrypted state exists. Do not print,
delete or rotate it by replacement. Key rotation/recovery need a separate design.

## Own-account security

[Minha conta: password changes and own sessions](account-security.md) is now
integrated in both realms. Password changes require the current password and end
all sessions while preserving passkeys/recovery codes. Session lists are bounded,
own-realm only, without bearer tokens/device guesses/background polling.
This is not password recovery by email or additional-passkey management.

## Verification and remaining work

Vitest covers transport/CSRF, realm validation, required UV options, secret
handling, recovery, native-prompt cancellation and expired-session behavior.
Playwright invokes **real native WebAuthn with a virtual Chromium authenticator**
for enrollment and subsequent assertion in both realms, with synthetic API
responses; the unchanged demo/mobile-outage tests run alongside. Separate
Go/Postgres HTTPS tests verify real cryptographic proofs, cookies, transactions,
replay, invalid origin/RP/UV/signature/credential/counter, locks and recovery.
This is not acceptance of a human's physical authenticator or Azure deployment.

The agent never enrolls the operator's authenticator or asks for credentials,
device PIN, biometrics or recovery codes. Initial bootstrap remains a human-only
CLI operation documented in the [local runbook](../runbooks/local-development.md#initial-platform-administrator).

Invites/reset/email APIs, optional-factor settings, additional-key management/removal,
lost-key/admin recovery, user quotas and plan modules in identity remain pending.
Their layouts now expose truthful Previsto/unavailable states. QG Planos/Redes
and isolated tenant provisioning are delivered in later increments; real sales
and the complete operational QG/Dash remain pending. M1 is still incomplete.
