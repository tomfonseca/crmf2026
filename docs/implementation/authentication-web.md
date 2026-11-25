# M1 — authentication screens

## Available surfaces

- QG: `http://localhost:5173/`, platform realm.
- Customer login: `http://localhost:5174/login`, tenant realm.
- Existing performance/goals routes remain an explicit synthetic demo. Login
  does not redirect into those mocked indicators or present them as real data.

Enable the backend explicitly with `python scripts/tasks.py auth-dev`.
The base stack still disables auth. A 404, outage or bad response is an error,
never authorization to enter a mock or anonymous operational dashboard.

The shared `@crmf/auth` module uses generated OpenAPI clients with credentialed
cookies, the required mutation header, no-store requests and bounded timeouts.
Production requires an explicit HTTPS `VITE_API_BASE_URL` at frontend build
time. Local HTTP is accepted only for loopback hosts in Vite development.
Never place server secrets or credentials in a `VITE_*` variable.

## Authentication flow

1. Resolve the current realm's identity; expired sessions return to login.
2. Submit email/password. Inputs clear immediately; no secret is written to
   localStorage/sessionStorage, the address bar, console, analytics or logs.
3. Complete the server's MFA challenge. Mandatory first-login enrollment shows
   the secret for manual TOTP setup (SHA-1, six digits, 30 seconds). No external
   QR service receives the provisioning URI; QR rendering is not yet included.
4. Show recovery codes only when returned on enrollment. The operator explicitly
   acknowledges saving them before entering the authenticated placeholder.
5. Read identity again from the server before granting authenticated UI scope.
   `useScope()` exposes this realm's identity/grants/store IDs, not client input.
6. Logout/cancel uses the backend; a failed revocation is not reported as success.

MFA challenges clear from the UI after five minutes. Secret state is memory-only
and removed on transitions/unmount. Focus rechecks session state; background
polling does not keep idle sessions alive. Browser identity snapshots are
read-only. Actual authorization remains enforced by the backend on every
protected operation, not by hiding frontend controls.

## Verification and remaining work

Vitest covers credentialed/CSRF transport, realm validation, secret handling,
MFA/recovery flow, failures, cancellation and session expiration. Playwright
covers both realm flows and mobile outage behavior with **synthetic contract
responses**, alongside the unchanged demo flows. Existing backend HTTPS/
Postgres integration tests separately exercise real cookies and transactions.
These browser tests do not claim a live Azure or final-user acceptance.

No final account is created. An authorized human must perform the one-time
administrator bootstrap and enroll their own authenticator, as described in
the [local runbook](../runbooks/local-development.md#initial-platform-administrator).
Do not send passwords, TOTP secrets or recovery codes to the coding agent.

Invites/reset forms, email delivery, optional-MFA settings, quota enforcement,
plan modules in `/v1/me`, tenant provisioning and operational QG/Dash screens
remain pending. The read-only effective-limit policy module is not yet wired
into these auth routes.
