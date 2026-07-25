-- Weekly Income Statement buckets (Monday-Sunday).
--
-- p_start_date / p_end_date are exact inclusive bounds. The generated edge
-- weeks are clipped to those bounds, which lets callers validate a calendar
-- month exactly while the UI normally passes complete Monday-Sunday ranges.

CREATE OR REPLACE FUNCTION disciplan.get_income_statement_weekly_scoped(
  p_start_date   DATE,
  p_end_date     DATE,
  p_owner        TEXT   DEFAULT NULL,
  p_household_id BIGINT DEFAULT NULL
)
RETURNS TABLE(week_start DATE, week_end DATE, category_id TEXT, amount NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH weeks AS (
    SELECT w::date AS week_start,
           GREATEST(w::date, p_start_date) AS bucket_start,
           LEAST((w + INTERVAL '6 days')::date, p_end_date) AS bucket_end
    FROM generate_series(
      date_trunc('week', p_start_date::timestamp),
      date_trunc('week', p_end_date::timestamp),
      INTERVAL '7 days'
    ) AS w
    WHERE p_start_date <= p_end_date
  )
  SELECT w.week_start,
         (w.week_start + 6) AS week_end,
         t.category_id,
         SUM(t.daily_cost * (
           (LEAST(t.service_end, w.bucket_end) -
            GREATEST(t.service_start, w.bucket_start)) + 1
         )) AS amount
  FROM disciplan.transactions t
  JOIN weeks w
    ON t.service_start <= w.bucket_end
   AND t.service_end   >= w.bucket_start
  WHERE t.daily_cost    IS NOT NULL
    AND t.service_start IS NOT NULL
    AND t.service_end   IS NOT NULL
    AND (p_owner        IS NULL OR t.owner        = p_owner)
    AND (p_household_id IS NULL OR t.household_id = p_household_id)
  GROUP BY w.week_start, t.category_id
  HAVING ABS(SUM(t.daily_cost * (
    (LEAST(t.service_end, w.bucket_end) -
     GREATEST(t.service_start, w.bucket_start)) + 1
  ))) > 0.0001
  ORDER BY w.week_start, t.category_id;
$$;

CREATE OR REPLACE FUNCTION disciplan.get_income_statement_weekly(
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE(week_start DATE, week_end DATE, category_id TEXT, amount NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT *
  FROM disciplan.get_income_statement_weekly_scoped(
    p_start_date,
    p_end_date,
    NULL,
    NULL
  );
$$;

REVOKE ALL ON FUNCTION disciplan.get_income_statement_weekly_scoped(DATE, DATE, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION disciplan.get_income_statement_weekly(DATE, DATE) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION disciplan.get_income_statement_weekly_scoped(DATE, DATE, TEXT, BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION disciplan.get_income_statement_weekly(DATE, DATE)
  TO authenticated, service_role;
