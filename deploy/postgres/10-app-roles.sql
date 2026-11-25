-- crmf-dev ONLY. Run as postgres; safe to rerun on existing local volumes.
-- Production roles/credentials are provisioned separately, never with these passwords.
\set ON_ERROR_STOP on
SELECT 'CREATE ROLE crmf_core LOGIN PASSWORD ''crmf_local_core_only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crmf_core') \gexec
SELECT 'CREATE ROLE crmf_auth LOGIN PASSWORD ''crmf_local_auth_only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crmf_auth') \gexec
SELECT 'CREATE ROLE crmf_platform_reader LOGIN PASSWORD ''crmf_local_platform_reader_only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crmf_platform_reader') \gexec
SELECT 'CREATE ROLE crmf_platform_writer LOGIN PASSWORD ''crmf_local_platform_writer_only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crmf_platform_writer') \gexec
ALTER ROLE crmf_core NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE crmf_auth NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE crmf_platform_reader NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE crmf_platform_writer NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT CONNECT ON DATABASE crmf_control TO crmf_core, crmf_auth;
GRANT CONNECT ON DATABASE crmf_analytics TO crmf_platform_reader, crmf_platform_writer;
ALTER ROLE crmf_core IN DATABASE crmf_control SET search_path = core, pg_catalog;
ALTER ROLE crmf_auth IN DATABASE crmf_control SET search_path = auth, pg_catalog;
ALTER ROLE crmf_platform_reader IN DATABASE crmf_analytics SET search_path = platform, pg_catalog;
ALTER ROLE crmf_platform_writer IN DATABASE crmf_analytics SET search_path = platform, pg_catalog;
