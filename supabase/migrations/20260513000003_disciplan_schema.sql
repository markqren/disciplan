-- FEA: Move all Disciplan tables/views/functions from `public` into a
-- dedicated `disciplan` schema, namespacing them away from Nocturnal
-- (which lives in its own `nocturnal.` schema in the same project).
--
-- ⚠ DO NOT APPLY UNTIL:
--   1. The previous migration (20260513000002_data_api_grants.sql) has run.
--   2. `disciplan` has been added to "Exposed schemas" in the Supabase
--      Dashboard (Project Settings → API). Without this, PostgREST returns
--      "schema not in search_path" errors.
--   3. The web app and Edge Functions have been updated to send
--      Accept-Profile: disciplan / Content-Profile: disciplan headers (web)
--      or `db: { schema: 'disciplan' }` to createClient (edge).
--
-- See tasks/disciplan-schema-rollout.md for full sequencing.

-- ── 1. Create schema ─────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS disciplan;

GRANT USAGE ON SCHEMA disciplan TO authenticated, service_role;

-- ── 2. Move tables ───────────────────────────────────────────────────────
-- Iterates all tables in `public` (skipping extension-owned tables, of which
-- this project has none today). Auto-owned IDENTITY sequences travel with
-- their tables. RLS policies, triggers, indexes, and FKs all follow.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'  -- ordinary tables only
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA disciplan', r.tname);
  END LOOP;
END $$;

-- ── 3. Move views ────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS vname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')  -- views and materialized views
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET SCHEMA disciplan', r.vname);
  END LOOP;
END $$;

-- ── 4. Move standalone sequences ─────────────────────────────────────────
-- Auto-owned IDENTITY sequences moved with their tables in step 2.
-- This catches any standalone sequences (none expected today).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS sname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.deptype IN ('a', 'e')
      )
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I SET SCHEMA disciplan', r.sname);
  END LOOP;
END $$;

-- ── 5. Move functions ────────────────────────────────────────────────────
-- Skips extension-owned functions (e.g. uuid-ossp, pgcrypto helpers) which
-- must stay in `public` so that DEFAULT clauses referencing them keep
-- resolving via the standard search_path.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname AS fname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA disciplan', r.fname, r.args);
  END LOOP;
END $$;

-- ── 6. Grants on disciplan (mirrors public grants from prior migration) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA disciplan TO authenticated;
GRANT ALL                            ON ALL TABLES    IN SCHEMA disciplan TO service_role;

GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA disciplan TO authenticated, service_role;

GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA disciplan TO authenticated, service_role;

-- ── 7. Default privileges (future objects in disciplan) ──────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA disciplan
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA disciplan
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA disciplan
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA disciplan
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
