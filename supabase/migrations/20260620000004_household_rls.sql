-- FEA: Household roles + enforced write RLS (phase 3 - access control)
--
-- Until now multi-user RLS was permissive (USING(true)) - any signed-in member
-- could edit any row, and could even PATCH their own profiles.role to escalate.
-- This migration introduces roles and enforces WRITES at the database level so:
--   * admin  (Mark)   -> read + write every row in the household
--   * member (Shilpa) -> read everything, write ONLY their own rows
-- Reads stay shared (SELECT remains open) so the Combined view is unchanged.
--
-- Enforcement is on the database, not the client: a member cannot edit another
-- member's data even via the REST API / devtools. The app's writes already carry
-- the user's JWT (see authHeaders in js/config.js), so auth.uid() resolves here.
-- Edge Functions use service_role and bypass RLS, so background jobs are
-- unaffected.

-- ── 1. Role column on profiles ───────────────────────────────────────────
ALTER TABLE disciplan.profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('admin','member'));

UPDATE disciplan.profiles SET role = 'admin'  WHERE owner = 'mark';
UPDATE disciplan.profiles SET role = 'member' WHERE owner <> 'mark';

-- ── 2. Helper functions (SECURITY DEFINER so policies can read profiles ───
-- without recursing into profiles' own RLS, and regardless of caller grants).
CREATE OR REPLACE FUNCTION disciplan.my_household()
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = disciplan, public AS $$
  SELECT household_id FROM disciplan.profiles WHERE auth_uid = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION disciplan.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = disciplan, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM disciplan.profiles
    WHERE auth_uid = auth.uid() AND role = 'admin'
  );
$$;

-- True when the current user may write a row owned by p_owner in p_household:
-- an admin of that household, or the owner themselves. A NULL household (legacy
-- un-stamped rows) is permitted so pre-migration data stays editable by members.
CREATE OR REPLACE FUNCTION disciplan.can_write(p_owner TEXT, p_household BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = disciplan, public AS $$
  SELECT p_household IS NULL OR EXISTS (
    SELECT 1 FROM disciplan.profiles p
    WHERE p.auth_uid = auth.uid()
      AND p.household_id = p_household
      AND (p.role = 'admin' OR p.owner = p_owner)
  );
$$;

GRANT EXECUTE ON FUNCTION disciplan.my_household()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.is_admin()                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.can_write(TEXT, BIGINT)    TO authenticated, service_role;

-- ── 3. Enforced write RLS on every owner-stamped table ───────────────────
-- Replaces the permissive "<t>_all" policy with split read/write policies:
--   SELECT open (household-shared reads), writes gated by can_write().
DO $$
DECLARE
  t    TEXT;
  tbls TEXT[] := ARRAY[
    'transactions','accounts','balance_snapshots','tags',
    'cashback_redemptions','cashback_cards',
    'investment_accounts','investment_symbols','investment_lots',
    'investment_price_history',
    'preferences','pending_imports','group_overrides','ai_rules'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'disciplan' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE disciplan.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON disciplan.%I', t || '_all', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON disciplan.%I', t || '_select', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON disciplan.%I', t || '_insert', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON disciplan.%I', t || '_update', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON disciplan.%I', t || '_delete', t);

      EXECUTE format(
        'CREATE POLICY %I ON disciplan.%I FOR SELECT TO authenticated USING (true)',
        t || '_select', t);
      EXECUTE format(
        'CREATE POLICY %I ON disciplan.%I FOR INSERT TO authenticated WITH CHECK (disciplan.can_write(owner, household_id))',
        t || '_insert', t);
      EXECUTE format(
        'CREATE POLICY %I ON disciplan.%I FOR UPDATE TO authenticated USING (disciplan.can_write(owner, household_id)) WITH CHECK (disciplan.can_write(owner, household_id))',
        t || '_update', t);
      EXECUTE format(
        'CREATE POLICY %I ON disciplan.%I FOR DELETE TO authenticated USING (disciplan.can_write(owner, household_id))',
        t || '_delete', t);
    END IF;
  END LOOP;
END $$;

-- ── 4. Lock down profiles + households (privilege-escalation fix) ─────────
-- Previously USING(true): a member could PATCH their own role to 'admin'. Now
-- members can read their household roster but only admins may write.
DROP POLICY IF EXISTS "profiles_all"    ON disciplan.profiles;
DROP POLICY IF EXISTS "profiles_select" ON disciplan.profiles;
DROP POLICY IF EXISTS "profiles_write"  ON disciplan.profiles;
CREATE POLICY "profiles_select" ON disciplan.profiles
  FOR SELECT TO authenticated
  USING (household_id = disciplan.my_household());
CREATE POLICY "profiles_write" ON disciplan.profiles
  FOR ALL TO authenticated
  USING (disciplan.is_admin() AND household_id = disciplan.my_household())
  WITH CHECK (disciplan.is_admin() AND household_id = disciplan.my_household());

DROP POLICY IF EXISTS "households_all"    ON disciplan.households;
DROP POLICY IF EXISTS "households_select" ON disciplan.households;
DROP POLICY IF EXISTS "households_write"  ON disciplan.households;
CREATE POLICY "households_select" ON disciplan.households
  FOR SELECT TO authenticated
  USING (id = disciplan.my_household());
CREATE POLICY "households_write" ON disciplan.households
  FOR ALL TO authenticated
  USING (disciplan.is_admin() AND id = disciplan.my_household())
  WITH CHECK (disciplan.is_admin() AND id = disciplan.my_household());

-- pending_shared_txns intentionally stays permissive: approving a proposed
-- reimbursement stamps a row to the approver's own owner (already allowed by
-- can_write), and both parties must see proposals addressed to/from them.
