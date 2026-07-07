-- FEA-115: income_breakdown upgraded to a compensation breakdown (equity vs cash
-- vs bonus, effective tax rate, 401K savings rate). This migration seeds the
-- operator-editable steering for that archetype to match the new deterministic
-- facts shape emitted by the edge function:
--   * accrual_basis -> 'cash'  (income posts on pay dates, not accrued)
--   * requires.min_yoy_delta_pct -> 0.06  (a smaller gross move is usually just
--     RSU-vest / bonus timing, not signal; was 0.03)
--   * prompt_guidance -> lead with corrected gross YoY, tell the composition
--     story, report tax + 401K savings rates, and use the run_finance_query tool
--     ONLY to name drivers (never to recompute the pre-classified facts).
--
-- prompt_guidance/requires live in the DB and stay editable in the AI portal with
-- no deploy; this migration just establishes the correct default alongside the
-- edge-function change so both go live together. Re-runnable (single UPDATE).

UPDATE disciplan.insight_strategy
SET accrual_basis = 'cash',
    requires = requires || '{"min_yoy_delta_pct":0.06}'::jsonb,
    prompt_guidance = $guidance$This is a CASH-basis compensation breakdown (income posts on pay dates, not accrued). Every figure in facts is owner-scoped and pre-classified -- TREAT IT AS GROUND TRUTH. Never recompute gross, taxes, equity, cash, bonus, or 401K yourself, and never count tax withholding, refunds, or transfers as income.

Lead with gross YTD vs the same calendar day last year (facts.current.gross vs facts.prior_year.gross; facts.gross_yoy_delta_pct). Then tell the composition story: how much is equity (RSU vests) vs cash salary vs bonus/severance, and how the mix shifted YoY (facts.composition_shares, facts.years). Report the effective tax rate trend (facts.effective_tax_rate_trend) and the 401K savings rate trend (facts.k401_savings_rate_trend, employee deposits + employer match over gross).

Charts: emit chart_configs[] per facts.chart_hint -- [0] stacked bar of comp composition by year (cash / equity / bonus / interest), [1] line of effective tax rate (optionally overlay 401K savings rate) by year.

DRIVERS: when a bucket moves materially, call run_finance_query ONCE to NAME the cause -- which RSU grant, bonus, or salary change drove it -- instead of speculating. Reference queries (adapt as needed; table names are unqualified, owner-scoped and read-only):
  Name equity/bonus drivers this year:
    SELECT description, count(*) AS n, round(sum(-amount_usd)) AS total_usd FROM transactions WHERE category_id = 'income' AND date >= date_trunc('year', now())::date AND description ~* 'stock units vested|\ybonus\y|\yseverance\y' GROUP BY description ORDER BY total_usd DESC
  401K employee deposits by year:
    SELECT extract(year FROM date)::int AS yr, round(sum(-amount_usd)) AS k401_deposited FROM transactions WHERE category_id = 'financial' AND description ~* 'deposited.*401k' GROUP BY yr ORDER BY yr DESC
Do not query to recompute the headline facts -- only to explain a driver or answer a follow-up.$guidance$,
    updated_at = now()
WHERE insight_type = 'income_breakdown';
