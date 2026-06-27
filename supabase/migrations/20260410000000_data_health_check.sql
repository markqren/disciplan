-- FEA-92: Data Integrity Health Check RPC
-- Runs 4 checks and returns results as JSONB.

CREATE OR REPLACE FUNCTION run_data_health_check()
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  orphaned_groups JSONB;
  accrual_mismatches JSONB;
  missing_tags JSONB;
  duplicates JSONB;
BEGIN
  -- Check 1: Groups with only 1 member (should have >= 2)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'group_id', transaction_group_id, 'count', cnt
  )), '[]'::jsonb)
  INTO orphaned_groups
  FROM (
    SELECT transaction_group_id, COUNT(*) AS cnt
    FROM transactions
    WHERE transaction_group_id IS NOT NULL
    GROUP BY transaction_group_id
    HAVING COUNT(*) = 1
  ) sub;

  -- Check 2: daily_cost × service_days diverges from amount_usd by > $0.02
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'date', date,
    'description', description,
    'amount_usd', amount_usd,
    'daily_cost', daily_cost,
    'service_days', service_days,
    'computed', ROUND((daily_cost * service_days)::numeric, 2),
    'delta', ROUND(ABS(daily_cost * service_days - amount_usd)::numeric, 2)
  ) ORDER BY ABS(daily_cost * service_days - amount_usd) DESC), '[]'::jsonb)
  INTO accrual_mismatches
  FROM transactions
  WHERE service_days > 0
    AND daily_cost IS NOT NULL
    AND ABS(daily_cost * service_days - amount_usd) > 0.02
  LIMIT 20;

  -- Check 3: Tag values in transactions with no matching tags.name row
  SELECT COALESCE(jsonb_agg(DISTINCT to_jsonb(tag)), '[]'::jsonb)
  INTO missing_tags
  FROM transactions t
  WHERE t.tag IS NOT NULL
    AND t.tag <> ''
    AND NOT EXISTS (SELECT 1 FROM tags tg WHERE tg.name = t.tag);

  -- Check 4: Potential duplicate transactions (same date + description + amount + payment_type)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', date,
    'description', description,
    'amount_usd', amount_usd,
    'payment_type', payment_type,
    'count', cnt
  ) ORDER BY cnt DESC), '[]'::jsonb)
  INTO duplicates
  FROM (
    SELECT date, description, amount_usd, payment_type, COUNT(*) AS cnt
    FROM transactions
    GROUP BY date, description, amount_usd, payment_type
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  ) sub;

  RETURN jsonb_build_object(
    'orphaned_groups', orphaned_groups,
    'accrual_mismatches', accrual_mismatches,
    'missing_tags', missing_tags,
    'duplicates', duplicates
  );
END;
$$;
