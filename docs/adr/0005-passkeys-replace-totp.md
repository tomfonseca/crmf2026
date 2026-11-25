# Replace TOTP with password-proven passkeys

At the user's request, passkeys/WebAuthn replace TOTP as the second factor;
email/password, opaque cookies, mandatory platform MFA and tenant policy stay.
WebAuthn requires user presence/verification and resident credentials, with exact
realm-specific origins and RP IDs derived from those origins (DNS names, never
IP literals). Realm-derived opaque user handles and database credential scoping
prevent cross-realm use even when development apps share localhost.

The authenticator retains its private key; biometric/PIN data never reaches the
server. The complete public credential record (including counter/backup flags)
and ceremony session are AES-256-GCM sealed with the existing external key and
user/realm/purpose/credential-ID binding. This provides record integrity and
protects ceremony state; it does not make a wholly compromised session database
trustworthy. Assertion counters/flags persist transactionally; detected counter
regression is rejected. Ten single-use recovery codes remain an explicit
password-plus-code exception, not a TOTP fallback or initial-enrollment bypass.

Forward migration 00007 preserves accounts/passwords/bootstrap markers, expires
prior sessions/challenges, and refuses cutover if any legacy enrollment/secret
exists: such installations need an authorized migration ceremony, never a silent
factor reset. Historical migrations remain untouched and legacy TOTP columns are
inert (a constraint forbids secrets/steps). Only the initial credential ceremony
is implemented; multi-key management, replacement and lost-admin recovery remain
separate work. This decision supersedes only ADR 0003's TOTP-specific mechanism,
not its password proof, lock ordering, challenges, rate limits or audit guarantees.
