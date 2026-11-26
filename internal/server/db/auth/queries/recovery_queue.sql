-- name: EnsureRecoveryLimit :exec
INSERT INTO auth.recovery_limits(key) VALUES($1) ON CONFLICT DO NOTHING;

-- name: LockRecoveryLimit :one
SELECT attempts FROM auth.recovery_limits WHERE key=$1 FOR UPDATE;

-- name: UpdateRecoveryLimit :exec
UPDATE auth.recovery_limits SET attempts=$2,touched_at=clock_timestamp() WHERE key=$1;

-- name: CountLiveRecoveryRequests :one
SELECT count(*) FROM auth.recovery_requests WHERE state<>'finished' AND custody_id=$1;

-- name: InsertRecoveryRequest :exec
INSERT INTO auth.recovery_requests(id,recipient_key,realm,recipient_enc,custody_id,created_at,expires_at)
VALUES($1,$2,$3,$4,$5,statement_timestamp(),statement_timestamp()+interval '15 minutes')
ON CONFLICT (recipient_key) WHERE state IN ('pending','claimed') DO NOTHING;

-- name: ClaimRecoveryRequest :one
UPDATE auth.recovery_requests SET state='claimed',claimed_at=clock_timestamp()
WHERE id=(SELECT candidate.id FROM auth.recovery_requests AS candidate WHERE candidate.state='pending' AND candidate.custody_id=$1 AND candidate.expires_at>clock_timestamp()
          ORDER BY candidate.created_at,candidate.id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id,realm,recipient_enc,created_at;

-- name: FinishRecoveryRequest :exec
UPDATE auth.recovery_requests SET state='finished',recipient_enc=NULL,finished_at=clock_timestamp()
WHERE id=$1 AND state='claimed';

-- name: ExpireRecoveryRequests :exec
UPDATE auth.recovery_requests SET state='finished',recipient_enc=NULL,finished_at=clock_timestamp()
WHERE (state='pending' AND expires_at<=clock_timestamp())
   OR (state='claimed' AND claimed_at<clock_timestamp()-interval '2 minutes');

-- name: PruneRecoveryRequests :exec
DELETE FROM auth.recovery_requests WHERE state='finished' AND finished_at<clock_timestamp()-interval '1 day';

-- name: PruneRecoveryLimits :exec
DELETE FROM auth.recovery_limits WHERE touched_at<clock_timestamp()-interval '2 hours';
