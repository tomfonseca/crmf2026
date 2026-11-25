-- name: PasskeyCredentials :many
SELECT credential_id,credential_enc FROM auth.passkey_credentials WHERE user_id=$1 AND realm=$2 ORDER BY credential_id;

-- name: AddPasskeyCredential :exec
INSERT INTO auth.passkey_credentials(credential_id,user_id,realm,credential_enc,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5);

-- name: UpdatePasskeyCredential :exec
UPDATE auth.passkey_credentials SET credential_enc=$4,updated_at=$5 WHERE credential_id=$1 AND user_id=$2 AND realm=$3;

-- name: ClearPasskeyChallenges :exec
DELETE FROM auth.passkey_challenges WHERE user_id=$1 AND realm=$2;

-- name: CreatePasskeyChallenge :exec
INSERT INTO auth.passkey_challenges(token_hash,user_id,realm,kind,session_enc,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7);

-- name: PasskeyChallengeOwner :one
SELECT user_id FROM auth.passkey_challenges WHERE token_hash=$1 AND realm=$2;

-- name: LockPasskeyChallenge :one
SELECT * FROM auth.passkey_challenges WHERE token_hash=$1 AND realm=$2 FOR UPDATE;

-- name: FailPasskeyChallenge :exec
UPDATE auth.passkey_challenges SET attempts=attempts+1 WHERE token_hash=$1 AND attempts<5;

-- name: ConsumePasskeyChallenge :exec
UPDATE auth.passkey_challenges SET used_at=$2 WHERE token_hash=$1;

-- name: CancelPasskeyChallenge :one
DELETE FROM auth.passkey_challenges WHERE token_hash=$1 AND realm=$2 AND used_at IS NULL RETURNING user_id;

-- name: PrunePasskeyChallenges :exec
DELETE FROM auth.passkey_challenges WHERE expires_at < $1;
