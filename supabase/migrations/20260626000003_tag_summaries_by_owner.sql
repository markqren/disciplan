-- FEA: Multi-owner tags (per-owner tag accrual breakdown)
--
-- A tag's "ownership" is DERIVED from who has transactions tagged with it, not
-- from the tags.owner creator column. This RPC mirrors get_tag_summaries()'s
-- accrual logic but groups by (tag, owner) so the Tags view can:
--   * single-person view  -> show only that owner's contribution ("my half")
--   * Combined view        -> show separate per-owner sums under the tag total
--
-- Purely additive: get_tag_summaries / get_tag_summaries_scoped are left
-- untouched, so daily-insight and the Combined aggregates are unchanged.
-- p_household_id = NULL means "all households" (legacy single-user safety).

CREATE OR REPLACE FUNCTION disciplan.get_tag_summaries_by_owner(
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(
  tag_name        TEXT,
  owner           TEXT,
  total_accrual   NUMERIC,
  txn_count       BIGINT,
  category_totals JSONB
)
LANGUAGE sql STABLE AS $$
  WITH all_counts AS (
    SELECT tag, owner, COUNT(*) AS cnt
    FROM disciplan.transactions
    WHERE tag IS NOT NULL AND tag <> ''
      AND (p_household_id IS NULL OR household_id = p_household_id)
    GROUP BY tag, owner
  ),
  accruals AS (
    SELECT
      t.tag,
      t.owner,
      t.category_id,
      CASE
        WHEN t.daily_cost IS NOT NULL
          AND tg.start_date IS NOT NULL AND tg.end_date IS NOT NULL
          AND t.service_start IS NOT NULL AND t.service_end IS NOT NULL
        THEN CASE
          WHEN GREATEST(t.service_start, tg.start_date) <= LEAST(t.service_end, tg.end_date)
          THEN t.daily_cost * ((LEAST(t.service_end, tg.end_date) - GREATEST(t.service_start, tg.start_date)) + 1)
          ELSE 0
        END
        WHEN t.amount_usd > 0 THEN t.amount_usd
        ELSE 0
      END AS accrual
    FROM disciplan.transactions t
    JOIN disciplan.tags tg ON t.tag = tg.name
    WHERE t.tag IS NOT NULL AND t.tag <> ''
      AND t.category_id NOT IN ('income', 'investment', 'adjustment')
      AND (p_household_id IS NULL OR t.household_id = p_household_id)
  ),
  cat_agg AS (
    SELECT tag, owner, category_id, SUM(accrual) AS cat_total
    FROM accruals
    GROUP BY tag, owner, category_id
  ),
  tag_agg AS (
    SELECT tag, owner,
           SUM(cat_total) AS total_accrual,
           jsonb_object_agg(category_id, ROUND(cat_total::NUMERIC, 4)) AS category_totals
    FROM cat_agg
    GROUP BY tag, owner
  )
  SELECT ac.tag                                            AS tag_name,
         ac.owner                                          AS owner,
         COALESCE(ROUND(ta.total_accrual::NUMERIC, 4), 0)  AS total_accrual,
         ac.cnt                                            AS txn_count,
         COALESCE(ta.category_totals, '{}'::jsonb)         AS category_totals
  FROM all_counts ac
  LEFT JOIN tag_agg ta ON ac.tag = ta.tag AND ac.owner = ta.owner;
$$;

GRANT EXECUTE ON FUNCTION disciplan.get_tag_summaries_by_owner(BIGINT)
  TO authenticated, service_role;
