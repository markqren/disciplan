-- Give the daily-insight AI a real tool: a guarded, read-only, owner-scoped SQL
-- surface it can query mid-generation (Anthropic tool use). This lets the writer
-- fetch numbers the fixed archetype "facts" never computed — e.g. split spend by
-- trip tag, verify a net-accrual figure, or derive a YTD run-rate — in direct
-- response to feedback, WITHOUT a backend code change.
--
-- SAFETY MODEL (defense in depth — the LLM is untrusted input):
--   1. disciplan.insight_run_query() is the ONLY entry point; EXECUTE is granted
--      to service_role only (the edge function), never to anon/authenticated.
--   2. It accepts a single read-only statement (must start with SELECT/WITH),
--      rejects multiple statements, comments, and any write/DDL/admin keyword.
--   3. It runs with search_path = insight_ro, so UNQUALIFIED table names resolve
--      ONLY to the owner-scoped views below. The base disciplan.* tables are not
--      on the path.
--   4. Schema-qualified references to sensitive schemas (disciplan., pg_,
--      information_schema, auth., storage., public., nocturnal.) are rejected, so
--      the query cannot escape insight_ro to reach another owner or the catalogs.
--   5. The owner is pinned via a GUC the views read; the model never supplies it.
--      Views fail CLOSED — if the GUC is unset they return zero rows.
--   6. A statement_timeout and a hard 500-row LIMIT bound cost.

CREATE SCHEMA IF NOT EXISTS insight_ro;

-- Owner-scoped views. current_setting(..., true) returns NULL when unset, and
-- `owner = NULL` is never true, so an unset GUC yields zero rows (fail closed).
CREATE OR REPLACE VIEW insight_ro.transactions AS
  SELECT id, date, description, category_id, amount_usd, daily_cost,
         service_start, service_end, service_days, payment_type, credit, tag,
         transaction_group_id, is_subscription
    FROM disciplan.transactions
   WHERE owner = current_setting('disciplan.insight_owner', true);

CREATE OR REPLACE VIEW insight_ro.tags AS
  SELECT name, start_date, end_date, tag_type, notes
    FROM disciplan.tags
   WHERE owner = current_setting('disciplan.insight_owner', true);

CREATE OR REPLACE VIEW insight_ro.accounts AS
  SELECT id, label, account_type, institution, currency, is_active
    FROM disciplan.accounts
   WHERE owner = current_setting('disciplan.insight_owner', true);

CREATE OR REPLACE VIEW insight_ro.balance_snapshots AS
  SELECT id, account_id, snapshot_date, balance_usd, notes
    FROM disciplan.balance_snapshots
   WHERE owner = current_setting('disciplan.insight_owner', true);

CREATE OR REPLACE VIEW insight_ro.cashback_redemptions AS
  SELECT id, date, item, payment_type, cashback_type, dollar_value, redemption_rate
    FROM disciplan.cashback_redemptions
   WHERE owner = current_setting('disciplan.insight_owner', true);

-- categories has no owner — it is shared reference data. Expose it read-only.
CREATE OR REPLACE VIEW insight_ro.categories AS
  SELECT id, label, parent_id, is_expense, default_accrual_days
    FROM disciplan.categories;

CREATE OR REPLACE FUNCTION disciplan.insight_run_query(p_sql text, p_owner text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = insight_ro, pg_temp
AS $function$
DECLARE
  q      text := btrim(p_sql);
  lc     text := lower(btrim(p_sql));
  result jsonb;
BEGIN
  IF p_owner IS NULL OR p_owner = '' THEN
    RAISE EXCEPTION 'insight_run_query: owner is required';
  END IF;
  IF q IS NULL OR length(q) = 0 OR length(q) > 4000 THEN
    RAISE EXCEPTION 'insight_run_query: query missing or too long';
  END IF;
  IF lc !~ '^(select|with)\s' THEN
    RAISE EXCEPTION 'insight_run_query: only a single SELECT/WITH query is allowed';
  END IF;
  -- Reject multiple statements: strip a single trailing ';' then forbid any ';'.
  IF position(';' IN rtrim(q, ' ;' || chr(10) || chr(9) || chr(13))) > 0 THEN
    RAISE EXCEPTION 'insight_run_query: multiple statements are not allowed';
  END IF;
  -- Reject comments (used to smuggle payloads).
  IF q LIKE '%--%' OR q LIKE '%/*%' THEN
    RAISE EXCEPTION 'insight_run_query: comments are not allowed';
  END IF;
  -- Reject writes / DDL / admin verbs as whole words.
  IF lc ~ '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|merge|copy|call|do|vacuum|analyze|reindex|refresh|listen|notify|lock|set|reset|prepare|execute|into)\M' THEN
    RAISE EXCEPTION 'insight_run_query: query contains a disallowed keyword';
  END IF;
  -- Reject schema-qualified access to anything outside insight_ro (blocks
  -- reaching base tables, other owners, and system catalogs).
  IF lc ~ '(disciplan\.|public\.|pg_|information_schema|pg_catalog|auth\.|storage\.|nocturnal\.|extensions\.)' THEN
    RAISE EXCEPTION 'insight_run_query: schema-qualified or system references are not allowed';
  END IF;

  PERFORM set_config('statement_timeout', '4000', true);
  PERFORM set_config('disciplan.insight_owner', p_owner, true);

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(sub)), ''[]''::jsonb) FROM (SELECT * FROM (%s) inner_q LIMIT 500) sub',
    q
  ) INTO result;
  RETURN result;
END;
$function$;

-- Only the edge function (service_role) may run ad-hoc queries. Lock everything else out.
REVOKE ALL ON FUNCTION disciplan.insight_run_query(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION disciplan.insight_run_query(text, text) TO service_role;
