-- Local-only database roles. Tenant roles are provisioned separately in M1.
CREATE ROLE crmf_migrator LOGIN PASSWORD 'crmf_local_migrator_only' CREATEROLE;
CREATE DATABASE crmf_control OWNER crmf_migrator;
CREATE DATABASE crmf_analytics OWNER crmf_migrator;
REVOKE ALL ON DATABASE crmf_control FROM PUBLIC;
REVOKE ALL ON DATABASE crmf_analytics FROM PUBLIC;
\connect crmf_control
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO crmf_migrator;
\connect crmf_analytics
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO crmf_migrator;
