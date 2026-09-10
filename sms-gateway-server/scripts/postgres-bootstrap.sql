-- One-time, out-of-band setup for this app's schema on a SHARED Postgres
-- instance (other projects, e.g. Tombola_DB, have their own schemas on the
-- same instance/database). Already applied once (2026-09-10) directly
-- against the shared instance. Kept here for reproducibility/disaster
-- recovery - re-running is mostly idempotent except CREATE ROLE, which
-- will error if the role already exists (expected, harmless).
--
-- Run as a superuser/admin role (e.g. the shared "postgres" login), NOT as
-- part of the app's own goose migrations - this creates the role the app
-- migrations subsequently run as.
--
-- Why a dedicated role instead of just setting search_path on the shared
-- "postgres" login: ALTER ROLE/DATABASE search_path is a global default for
-- that role or database. Setting it on the shared "postgres" login would
-- silently repoint search_path for every other project using that same
-- login too. A dedicated role scopes the default to just this project.

-- Pick your own password here instead of reusing this example.
CREATE ROLE ethiotelecom_app LOGIN PASSWORD 'CHANGE_ME';

GRANT CONNECT ON DATABASE postgres TO ethiotelecom_app;

-- CREATE SCHEMA ... AUTHORIZATION requires the connecting role to be a
-- member of the target role (even for admin-ish accounts that aren't a
-- literal Postgres superuser) - grant membership first, use it, revoke
-- after if you want to keep privileges minimal.
GRANT ethiotelecom_app TO postgres;

CREATE SCHEMA IF NOT EXISTS "EthioTelecom-APP-DB" AUTHORIZATION ethiotelecom_app;

-- Scoped to this role only - every new connection ethiotelecom_app opens
-- defaults into this schema, without touching the shared login's default.
ALTER ROLE ethiotelecom_app SET search_path TO "EthioTelecom-APP-DB", public;

-- REVOKE ethiotelecom_app FROM postgres; -- optional cleanup, see below

-- After this, configs/config.yml's database.user/password should be
-- ethiotelecom_app's credentials, NOT the shared postgres login - the app's
-- own goose migrations (migrations/postgres/*.sql) then run as this role
-- and land in "EthioTelecom-APP-DB" automatically, no per-migration
-- schema/search_path statements needed.
