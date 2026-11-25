# Password-proven MFA challenges are not sessions

A correct password cannot create a usable session when the realm, tenant or
user requires MFA. We persist a separate, realm-bound, five-minute challenge
whose token is stored only as a SHA-256 digest. First-login enrollment and
subsequent verification use this same boundary; giving an administrator a
temporary low-privilege session was rejected because it would let authorization
mistakes bypass mandatory MFA.

Challenge consumption, TOTP replay prevention/recovery-code consumption,
session creation and audit records commit together under an identity-first
lock. Password/status/grant changes invalidate outstanding challenges as well
as sessions. Password success alone does not reset the account failure count,
otherwise an attacker knowing the password could repeatedly reset MFA limits.

MFA secrets use AES-256-GCM with random nonces and identity/purpose-bound AAD.
The application must supply a stable 32-byte key from its secret provider;
there is no startup-generated fallback. The HTTP increment adds a Key Vault
adapter using managed identity and an explicitly pinned secret version; no
real Azure deployment has been validated. Automatic rotation/rewrapping and
multi-key envelope selection remain deployment gates: changing the configured
key without a migration makes existing encrypted MFA state unreadable.

IP attempt windows live in the auth database, not process memory, so the
20-attempt sliding-minute budget is shared across realms, MFA steps and API
instances. This adds a short database transaction per attempt, deliberately
independent of credential transactions so failures and rollbacks still count.
