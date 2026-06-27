-- INF-03: Server-side tag accrual RPC
-- Replaces client-side paginated fetch + JS accrual math in renderTags().
-- Returns per-tag totals with category breakdown; showTagDetail() still fetches
-- individual transactions for the drill-down modal.
--
-- Accrual logic mirrors JS exactly (3 cases):
--  1. Has daily_cost + tag dates + service period:
--       overlap exists  → daily_cost × overlap_days
--       no overlap      → 0  (outside tag window — NOT amount_usd)
--  2. Missing daily_cost or dates/service period → amount_usd (fallback)
--  3. amount_usd <= 0                            → 0

CREATE OR REPLACE FUNCTION get_tag_summaries()
RETURNS TABLE(
  tag_name        TEXT,
  total_accrual   NUMERIC,
  txn_count       BIGINT,
  category_totals JSONB
)
LANGUAGE sql SECURITY DEFINER AS $$
  -- Count ALL tagged transactions per tag (including income/investment/adjustment)
  WITH all_counts AS (
    SELECT tag, COUNT(*) AS cnt
    FROM transactions
    WHERE tag IS NOT NULL AND tag <> ''
    GROUP BY tag
  ),
  -- Compute per-transaction accrual (expense categories only)
  accruals AS (
    SELECT
      t.tag,
      t.category_id,
      CASE
        -- Case 1: all data present — use overlap (or 0 if outside window)
        WHEN t.daily_cost IS NOT NULL
          AND tg.start_date IS NOT NULL
          AND tg.end_date   IS NOT NULL
          AND t.service_start IS NOT NULL
          AND t.service_end   IS NOT NULL
        THEN CASE
          WHEN GREATEST(t.service_start, tg.start_date) <= LEAST(t.service_end, tg.end_date)
          THEN t.daily_cost * (
            (LEAST(t.service_end, tg.end_date) - GREATEST(t.service_start, tg.start_date)) + 1
          )
          ELSE 0
        END
        -- Case 2: missing data — fallback to amount_usd
        WHEN t.amount_usd > 0 THEN t.amount_usd
        ELSE 0
      END AS accrual
    FROM transactions t
    JOIN tags tg ON t.tag = tg.name
    WHERE t.tag IS NOT NULL AND t.tag <> ''
      AND t.category_id NOT IN ('income', 'investment', 'adjustment')
  ),
  -- Aggregate per tag + category
  cat_agg AS (
    SELECT tag, category_id, SUM(accrual) AS cat_total
    FROM accruals
    GROUP BY tag, category_id
  ),
  -- Roll up to per-tag totals with JSONB category map
  tag_agg AS (
    SELECT
      tag,
      SUM(cat_total) AS total_accrual,
      jsonb_object_agg(category_id, ROUND(cat_total::NUMERIC, 4)) AS category_totals
    FROM cat_agg
    GROUP BY tag
  )
  SELECT
    ac.tag                                               AS tag_name,
    COALESCE(ROUND(ta.total_accrual::NUMERIC, 4), 0)    AS total_accrual,
    ac.cnt                                               AS txn_count,
    COALESCE(ta.category_totals, '{}'::jsonb)            AS category_totals
  FROM all_counts ac
  LEFT JOIN tag_agg ta ON ac.tag = ta.tag
$$;
