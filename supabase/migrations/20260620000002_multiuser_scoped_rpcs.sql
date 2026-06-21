-- FEA: Multi-user households (phase 2 - owner/household-scoped RPCs)
--
-- The original aggregation RPCs (get_income_statement, get_ledger_balances,
-- get_credit_balances, get_tag_summaries, detect_subscriptions) are left
-- UNTOUCHED. The client calls them as-is for the "Combined" household view, so
-- existing numbers are guaranteed unchanged.
--
-- These *_scoped variants add p_owner / p_household_id filters and power the
-- single-person (Mark-only / Shilpa-only) views. p_owner = NULL means
-- "all owners in the household". Tables are fully-qualified to disciplan.* so
-- name resolution does not depend on search_path.

-- ── Income statement (accrual: daily_cost x overlap-days per month) ──────
-- Mirrors the client-side accrual in showISDrilldown(): for each calendar
-- month of p_year, sum daily_cost * (overlap days between the txn service
-- period and the month) per category. daily_cost keeps its sign (income and
-- reimbursements are negative).
CREATE OR REPLACE FUNCTION disciplan.get_income_statement_scoped(
  p_year         INTEGER,
  p_owner        TEXT   DEFAULT NULL,
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(month DATE, category_id TEXT, amount NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH months AS (
    SELECT make_date(p_year, m, 1) AS m_start,
           (make_date(p_year, m, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS m_end
    FROM generate_series(1, 12) AS m
  )
  SELECT mo.m_start AS month,
         t.category_id,
         SUM(t.daily_cost * ((LEAST(t.service_end, mo.m_end) - GREATEST(t.service_start, mo.m_start)) + 1)) AS amount
  FROM disciplan.transactions t
  JOIN months mo
    ON t.service_start <= mo.m_end
   AND t.service_end   >= mo.m_start
  WHERE t.daily_cost   IS NOT NULL
    AND t.service_start IS NOT NULL
    AND t.service_end   IS NOT NULL
    AND (p_owner        IS NULL OR t.owner        = p_owner)
    AND (p_household_id IS NULL OR t.household_id = p_household_id)
  GROUP BY mo.m_start, t.category_id
  HAVING ABS(SUM(t.daily_cost * ((LEAST(t.service_end, mo.m_end) - GREATEST(t.service_start, mo.m_start)) + 1))) > 0.0001;
$$;

-- ── Ledger balances (live balance sheet) ─────────────────────────────────
-- net_balance = -SUM(amount_usd): income is stored negative, so deposits raise
-- asset balances and card spend creates negative (liability) balances.
CREATE OR REPLACE FUNCTION disciplan.get_ledger_balances_scoped(
  p_owner        TEXT   DEFAULT NULL,
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(payment_type TEXT, net_balance NUMERIC, txn_count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT t.payment_type,
         -SUM(t.amount_usd) AS net_balance,
         COUNT(*)           AS txn_count
  FROM disciplan.transactions t
  WHERE t.payment_type IS NOT NULL AND t.payment_type <> ''
    AND (p_owner        IS NULL OR t.owner        = p_owner)
    AND (p_household_id IS NULL OR t.household_id = p_household_id)
  GROUP BY t.payment_type;
$$;

-- ── Credit / transfer sub-ledger balances ────────────────────────────────
CREATE OR REPLACE FUNCTION disciplan.get_credit_balances_scoped(
  p_owner        TEXT   DEFAULT NULL,
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(credit_name TEXT, net_balance NUMERIC, txn_count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT t.credit AS credit_name,
         -SUM(t.amount_usd) AS net_balance,
         COUNT(*)           AS txn_count
  FROM disciplan.transactions t
  WHERE t.credit IS NOT NULL AND t.credit <> ''
    AND (p_owner        IS NULL OR t.owner        = p_owner)
    AND (p_household_id IS NULL OR t.household_id = p_household_id)
  GROUP BY t.credit;
$$;

-- ── Tag summaries (accrual via overlap with tag window) ──────────────────
-- Same logic as get_tag_summaries() with owner/household filters on the txns.
CREATE OR REPLACE FUNCTION disciplan.get_tag_summaries_scoped(
  p_owner        TEXT   DEFAULT NULL,
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(
  tag_name        TEXT,
  total_accrual   NUMERIC,
  txn_count       BIGINT,
  category_totals JSONB
)
LANGUAGE sql STABLE AS $$
  WITH all_counts AS (
    SELECT tag, COUNT(*) AS cnt
    FROM disciplan.transactions
    WHERE tag IS NOT NULL AND tag <> ''
      AND (p_owner        IS NULL OR owner        = p_owner)
      AND (p_household_id IS NULL OR household_id = p_household_id)
    GROUP BY tag
  ),
  accruals AS (
    SELECT
      t.tag,
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
      AND (p_owner        IS NULL OR t.owner        = p_owner)
      AND (p_household_id IS NULL OR t.household_id = p_household_id)
  ),
  cat_agg AS (
    SELECT tag, category_id, SUM(accrual) AS cat_total
    FROM accruals
    GROUP BY tag, category_id
  ),
  tag_agg AS (
    SELECT tag,
           SUM(cat_total) AS total_accrual,
           jsonb_object_agg(category_id, ROUND(cat_total::NUMERIC, 4)) AS category_totals
    FROM cat_agg
    GROUP BY tag
  )
  SELECT ac.tag                                            AS tag_name,
         COALESCE(ROUND(ta.total_accrual::NUMERIC, 4), 0)  AS total_accrual,
         ac.cnt                                            AS txn_count,
         COALESCE(ta.category_totals, '{}'::jsonb)         AS category_totals
  FROM all_counts ac
  LEFT JOIN tag_agg ta ON ac.tag = ta.tag;
$$;

-- ── Subscriptions (auxiliary card on the Income Statement tab) ───────────
-- Best-effort owner-scoped detector using the is_subscription flag.
CREATE OR REPLACE FUNCTION disciplan.detect_subscriptions_scoped(
  p_owner        TEXT   DEFAULT NULL,
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(
  merchant           TEXT,
  sample_description TEXT,
  typical_amount     NUMERIC,
  category_id        TEXT,
  payment_type       TEXT,
  last_date          DATE
)
LANGUAGE sql STABLE AS $$
  SELECT lower(description)                                                  AS merchant,
         (array_agg(description  ORDER BY date DESC))[1]                     AS sample_description,
         ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd)::numeric, 2) AS typical_amount,
         (array_agg(category_id  ORDER BY date DESC))[1]                     AS category_id,
         (array_agg(payment_type ORDER BY date DESC))[1]                     AS payment_type,
         MAX(date)                                                          AS last_date
  FROM disciplan.transactions
  WHERE is_subscription = TRUE
    AND amount_usd > 0
    AND (p_owner        IS NULL OR owner        = p_owner)
    AND (p_household_id IS NULL OR household_id = p_household_id)
  GROUP BY lower(description)
  ORDER BY typical_amount DESC;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION disciplan.get_income_statement_scoped(INTEGER, TEXT, BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.get_ledger_balances_scoped(TEXT, BIGINT)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.get_credit_balances_scoped(TEXT, BIGINT)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.get_tag_summaries_scoped(TEXT, BIGINT)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.detect_subscriptions_scoped(TEXT, BIGINT)           TO authenticated, service_role;
