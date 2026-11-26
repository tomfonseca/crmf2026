# Separate own-account security from email recovery

Allow each authenticated realm to list/revoke only its own sessions and change its password with current-password proof, without waiting for or impersonating email delivery. Resolve ownership from the cookie and serialize identity → session locks with live scope checks; UUID session references are metadata, never bearer credentials.

Password changes deliberately end every session and invalidate pending challenges through the existing identity-security triggers, but preserve passkeys and recovery codes rather than resetting factors. Apply the existing persistent password/IP failure limits; failed current-password proof is a distinct 400 so it does not masquerade as session expiry. Email reset/invitations and additional-passkey management remain separate work with their own proof/delivery requirements.
