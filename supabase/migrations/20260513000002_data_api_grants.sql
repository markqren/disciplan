-- FEA: Explicit Data API grants on public schema.
--
-- Background: Per Supabase email (May 2026), starting Oct 30, 2026 the Data
-- API on existing projects will no longer auto-grant access to tables in
-- `public`. Without explicit GRANTs, PostgREST returns "42501" errors.
--
-- This migration:
--   1. Re-grants on every existing object in `public` (idempotent, no-op if
--      grants already present from legacy auto-grant).
--   2. Sets default privileges so any future table/sequence/function created
--      in `public` automatically receives the same grants.
--
-- Roles:
--   - `authenticated`: SELECT/INSERT/UPDATE/DELETE on tables (RLS still
--     enforces row visibility).
--   - `service_role`: ALL (used by Edge Functions; bypasses RLS).
--   - `anon`: not granted. The app requires sign-in; no anon path exists.

-- ── 1. Schema usage ──────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- ── 2. Existing objects ──────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT ALL                            ON ALL TABLES    IN SCHEMA public TO service_role;

GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- ── 3. Default privileges (future objects) ───────────────────────────────
-- Note: ALTER DEFAULT PRIVILEGES applies only to objects created by the role
-- that runs this statement. Migrations and Dashboard SQL both run as
-- `postgres`, so this covers the normal table-creation paths.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
