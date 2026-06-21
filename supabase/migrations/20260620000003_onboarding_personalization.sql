-- FEA: Onboarding import module (owner-scoped AI personalization)
--
-- 1. get_merchant_patterns_scoped: owner/household-filtered variant of
--    get_merchant_patterns (20260410_merchant_patterns.sql). Powers per-user
--    AI categorization so the parser learns from the importing user's own
--    history. p_owner = NULL means "all owners in the household" (Combined).
-- 2. ai_rules gains owner + household_id so each member can keep their own
--    description-formatting rules. Backfilled to owner='mark' in the seeded
--    household, matching migration 20260620000001.

-- ── 1. Owner-scoped merchant patterns ────────────────────────────────────
CREATE OR REPLACE FUNCTION disciplan.get_merchant_patterns_scoped(
  p_owner        TEXT   DEFAULT NULL,
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(description TEXT, category_id TEXT, count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT t.description, t.category_id, COUNT(*) AS count
  FROM disciplan.transactions t
  WHERE (p_owner        IS NULL OR t.owner        = p_owner)
    AND (p_household_id IS NULL OR t.household_id = p_household_id)
  GROUP BY t.description, t.category_id
  HAVING COUNT(*) > 2
  ORDER BY count DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION disciplan.get_merchant_patterns_scoped(TEXT, BIGINT)
  TO authenticated, service_role;

-- ── 2. Per-user ai_rules ─────────────────────────────────────────────────
DO $$
DECLARE
  hid BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'disciplan' AND table_name = 'ai_rules'
  ) THEN
    SELECT id INTO hid FROM disciplan.households ORDER BY id LIMIT 1;
    ALTER TABLE disciplan.ai_rules ADD COLUMN IF NOT EXISTS owner TEXT;
    ALTER TABLE disciplan.ai_rules ADD COLUMN IF NOT EXISTS household_id BIGINT;
    UPDATE disciplan.ai_rules SET owner = 'mark' WHERE owner IS NULL;
    UPDATE disciplan.ai_rules SET household_id = hid WHERE household_id IS NULL;
    EXECUTE format('ALTER TABLE disciplan.ai_rules ALTER COLUMN household_id SET DEFAULT %L', hid);
  END IF;
END $$;
