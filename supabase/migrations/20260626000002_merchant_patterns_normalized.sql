-- FEA: AI category learning for recurring subscriptions
--
-- Problem: get_merchant_patterns / _scoped grouped by the FULL description, which
-- carries a unique month suffix on every recurring charge ("Amazon Prime - June
-- 2026", "Claude AI Subscription (Feb 2026)"). Each month therefore counted as a
-- distinct group of size 1, got dropped by HAVING COUNT(*) > 2, and never reached
-- the AI's HISTORICAL MERCHANT PATTERNS map. The parser had no signal that the
-- user consistently files these as Utilities, so it kept guessing Tech/Personal.
--
-- Fix: collapse descriptions to a stable merchant key BEFORE grouping, mirroring
-- the client-side normalizeMerchant() in js/helpers.js (strip trailing
-- "(...)" and "- Month YYYY", strip known prefixes, lowercase, keep first 2
-- words). Recurring subscriptions now accumulate across months and expose their
-- dominant category to the AI.

-- ── Shared normalizer (mirrors normalizeMerchant in js/helpers.js) ──────────
CREATE OR REPLACE FUNCTION disciplan.normalize_merchant(p_desc TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT array_to_string(
    (regexp_split_to_array(
      lower(btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(COALESCE(p_desc, ''), '\s*\([^)]*\)\s*$', ''),
            '\s*-\s*(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2}.*$', '', 'i'),
          '^(SQ \*|TST\*|CLIP MX\*|TCB\*)', '', 'i')
      )),
      '\s+'
    ))[1:2],
    ' '
  );
$$;

-- ── Non-scoped (Combined household view) ────────────────────────────────────
CREATE OR REPLACE FUNCTION disciplan.get_merchant_patterns()
RETURNS TABLE(description TEXT, category_id TEXT, count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT disciplan.normalize_merchant(description) AS description,
         category_id,
         COUNT(*) AS count
  FROM disciplan.transactions
  WHERE category_id IS NOT NULL
    AND disciplan.normalize_merchant(description) <> ''
  GROUP BY 1, 2
  HAVING COUNT(*) > 2
  ORDER BY 3 DESC
  LIMIT 200;
$$;

-- ── Owner / household scoped (single-person views, import personalization) ──
CREATE OR REPLACE FUNCTION disciplan.get_merchant_patterns_scoped(
  p_owner        TEXT   DEFAULT NULL,
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(description TEXT, category_id TEXT, count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT disciplan.normalize_merchant(t.description) AS description,
         t.category_id,
         COUNT(*) AS count
  FROM disciplan.transactions t
  WHERE t.category_id IS NOT NULL
    AND disciplan.normalize_merchant(t.description) <> ''
    AND (p_owner        IS NULL OR t.owner        = p_owner)
    AND (p_household_id IS NULL OR t.household_id = p_household_id)
  GROUP BY 1, 2
  HAVING COUNT(*) > 2
  ORDER BY count DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION disciplan.normalize_merchant(TEXT)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.get_merchant_patterns()                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.get_merchant_patterns_scoped(TEXT, BIGINT) TO authenticated, service_role;
