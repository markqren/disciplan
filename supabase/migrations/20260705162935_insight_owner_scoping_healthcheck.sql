-- Owner-scoped data health check for the daily-insight newsletter.
--
-- The existing run_data_health_check() scans the whole household's transactions.
-- After multi-user households shipped (20260620000001) that meant one member's
-- rows leaked into another member's newsletter — the top driver of recent 2-3/10
-- feedback ("this is pulling Shilpa's transaction data"). This scoped variant
-- filters to a single owner (and optional household) so accrual_quality_alert
-- only ever reflects the recipient's own ledger.
--
-- Mirrors run_data_health_check() exactly except every scan is owner-filtered and
-- table names are schema-qualified (the newsletter runs with search_path unset).

CREATE OR REPLACE FUNCTION disciplan.run_data_health_check_scoped(
  p_owner        text   DEFAULT NULL,
  p_household_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  orphaned_groups    JSONB;
  accrual_mismatches JSONB;
  missing_tags       JSONB;
  duplicates         JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('group_id', transaction_group_id, 'count', cnt)), '[]'::jsonb)
    INTO orphaned_groups
    FROM (
      SELECT transaction_group_id, COUNT(*) AS cnt
        FROM disciplan.transactions
       WHERE transaction_group_id IS NOT NULL
         AND (p_owner        IS NULL OR owner        = p_owner)
         AND (p_household_id  IS NULL OR household_id = p_household_id)
       GROUP BY transaction_group_id
      HAVING COUNT(*) = 1
    ) sub;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'date', date, 'description', description, 'amount_usd', amount_usd,
           'daily_cost', daily_cost, 'service_days', service_days,
           'computed', ROUND((daily_cost * service_days)::numeric, 2),
           'delta', ROUND(ABS(daily_cost * service_days - amount_usd)::numeric, 2)
         ) ORDER BY ABS(daily_cost * service_days - amount_usd) DESC), '[]'::jsonb)
    INTO accrual_mismatches
    FROM (
      SELECT id, date, description, amount_usd, daily_cost, service_days
        FROM disciplan.transactions
       WHERE service_days > 0
         AND daily_cost IS NOT NULL
         AND ABS(daily_cost * service_days - amount_usd) > 0.02
         AND (p_owner        IS NULL OR owner        = p_owner)
         AND (p_household_id  IS NULL OR household_id = p_household_id)
       ORDER BY ABS(daily_cost * service_days - amount_usd) DESC
       LIMIT 20
    ) sub;

  SELECT COALESCE(jsonb_agg(DISTINCT to_jsonb(t.tag)), '[]'::jsonb)
    INTO missing_tags
    FROM disciplan.transactions t
   WHERE t.tag IS NOT NULL AND t.tag <> ''
     AND (p_owner        IS NULL OR t.owner        = p_owner)
     AND (p_household_id  IS NULL OR t.household_id = p_household_id)
     AND NOT EXISTS (SELECT 1 FROM disciplan.tags tg WHERE tg.name = t.tag);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', date, 'description', description, 'amount_usd', amount_usd,
           'payment_type', payment_type, 'count', cnt
         ) ORDER BY cnt DESC), '[]'::jsonb)
    INTO duplicates
    FROM (
      SELECT date, description, amount_usd, payment_type, COUNT(*) AS cnt
        FROM disciplan.transactions
       WHERE (p_owner        IS NULL OR owner        = p_owner)
         AND (p_household_id  IS NULL OR household_id = p_household_id)
       GROUP BY date, description, amount_usd, payment_type
      HAVING COUNT(*) > 1
       ORDER BY cnt DESC
       LIMIT 20
    ) sub;

  RETURN jsonb_build_object(
    'orphaned_groups',    orphaned_groups,
    'accrual_mismatches', accrual_mismatches,
    'missing_tags',       missing_tags,
    'duplicates',         duplicates
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION disciplan.run_data_health_check_scoped(text, bigint) TO authenticated, service_role;
