# Restrict QG catalog mutations to platform administrators

The specification separates platform admin/support roles without assigning
catalog write privileges. Use least privilege: both roles may read plans, but
only `platform_admin` may create, edit/deactivate or delete them; tenant roles
cannot access the QG catalog. Enforce this both at the authenticated HTTP seam
and inside the application service, rather than treating every platform session
or hidden frontend button as administrative authorization.

Plan edits are full replacements guarded by an explicit database revision.
Codes/IDs remain immutable, any subscription reference prevents deletion, and
all successful mutations append an actor/target/revision audit event in the same
transaction. This avoids silent concurrent overwrites and preserves subscription
history without granting runtime identity SQL, audit reads or migration powers.
