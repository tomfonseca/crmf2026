# Initial platform bootstrap is an operator-only one-time capability

`crmfctl user create-admin` uses the isolated auth role and an interactive
password prompt, never a public registration endpoint. A transaction-scoped
advisory lock and a durable singleton marker make initial creation globally
single-use; checking only for an active administrator was rejected because
disabling or deleting that identity would silently reopen bootstrap.

User creation, the platform grant, marker and audit event commit together.
The runtime auth role may read/insert the marker but cannot update, delete or
truncate it. The marker deliberately has no foreign key to the created user,
so removing that user does not erase the guard. Existing platform-admin grants
also block bootstrap, and an existing email is never promoted or overwritten.

Bootstrap emits no session, TOTP secret or recovery code. The mandatory
platform MFA flow performs enrollment on first login. Lost-administrator
recovery requires a separate deliberate operational procedure, not deleting
the marker or rerunning initialization.
