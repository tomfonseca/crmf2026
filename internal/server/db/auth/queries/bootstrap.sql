-- name: LockPlatformBootstrap :exec
SELECT pg_advisory_xact_lock(1129467206, 1);

-- name: PlatformBootstrapped :one
SELECT (EXISTS(SELECT 1 FROM auth.platform_bootstrap)
    OR EXISTS(SELECT 1 FROM auth.user_grants WHERE role='platform_admin'))::boolean AS bootstrapped;

-- name: CreateBootstrapUser :exec
INSERT INTO auth.users(id,email,name,status,password_hash,password_changed_at,created_at,updated_at)
VALUES(sqlc.arg(id)::uuid,sqlc.arg(email)::text::auth.citext,sqlc.arg(name)::text,'active',sqlc.arg(password_hash)::text,sqlc.arg(at)::timestamptz,sqlc.arg(at)::timestamptz,sqlc.arg(at)::timestamptz);

-- name: CreateBootstrapGrant :exec
INSERT INTO auth.user_grants(id,user_id,role,created_at,updated_at)
VALUES($1,$2,'platform_admin',$3,$3);

-- name: MarkPlatformBootstrapped :exec
INSERT INTO auth.platform_bootstrap(singleton,admin_user_id,created_at) VALUES(true,$1,$2);
