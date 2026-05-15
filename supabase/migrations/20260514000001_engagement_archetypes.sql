-- FEA-100: Newsletter engagement archetypes (Phase C)
-- Adds 6 new archetypes drawing from previously-unused dimensions of the corpus,
-- plus a `theme` column on insight_strategy used by the selection-policy upgrades
-- (theme rotation soft penalty + novelty bonus). All builders are accrual-aware
-- per Mark's 2026-05-14 directive: "don't overindex on amounts paid on a single
-- day, pay attention to the accrual rate".
--
-- Runtime:
--   - supabase/functions/daily-insight/archetypes.ts (new builders + register)
--   - supabase/functions/daily-insight/index.ts      (new feature fetchers)
--   - supabase/functions/daily-insight/selection.ts  (theme rotation + novelty)
--   - js/ai-portal.js                                (theme column in strategy table)

-- ── 1. Add theme column ─────────────────────────────────────────────────────
ALTER TABLE disciplan.insight_strategy
  ADD COLUMN IF NOT EXISTS theme TEXT;

CREATE INDEX IF NOT EXISTS insight_strategy_theme_idx
  ON disciplan.insight_strategy (theme);

-- ── 2. Backfill themes for existing 11 archetypes ───────────────────────────
-- current_month = parent rollup vs recent history (the dominant existing pattern)
-- storytelling = retrospective / nostalgic
-- rhythm       = behavioral cadence
-- longhorizon  = multi-year trend / structural drift
-- forward      = future commitments / projections
-- health       = data integrity / maintenance pings
-- trips        = trip/tag analytics
UPDATE disciplan.insight_strategy SET theme = 'current_month'
  WHERE insight_type IN ('category_yoy','budget_pace','category_anomaly','large_transactions','spend_projection','income_breakdown');
UPDATE disciplan.insight_strategy SET theme = 'storytelling'
  WHERE insight_type IN ('tag_recap');
UPDATE disciplan.insight_strategy SET theme = 'longhorizon'
  WHERE insight_type IN ('subscription_creep','category_trend');
UPDATE disciplan.insight_strategy SET theme = 'forward'
  WHERE insight_type IN ('service_expiry');
UPDATE disciplan.insight_strategy SET theme = 'health'
  WHERE insight_type IN ('accrual_quality_alert');
-- parse_fallback gets no theme — never selected by policy.

-- ── 3. Seed 6 new archetypes ────────────────────────────────────────────────
-- Initial priority_weight=1.0 for parity with incumbents; the novelty bonus in
-- the selector gives them a guaranteed exploration head start over their first
-- 5 sends. Cooldowns are deliberate: longer for archetypes that don't change
-- much day-to-day (cashback_roi, trip_year_in_review). monthly_max keeps any
-- one new archetype from monopolising a month.

INSERT INTO disciplan.insight_strategy
  (insight_type, enabled, cooldown_days, monthly_target, monthly_max, priority_weight, min_quality_score, requires, theme, notes)
VALUES
  ('on_this_day_flashback', TRUE, 14, 1, 2, 1.0, 0.10,
    -- Pulls service-period accrual on today's MM-DD across prior 9 years.
    -- min_prior_year_daily_cost: a "quiet" day still has rent + subs (~$75-$100/d),
    -- so the bar is low — we mostly fire when at least one prior year had a real
    -- one-off accrual peak (trip, big purchase, etc.).
    '{"min_prior_year_daily_cost": 15, "max_lookback_years": 9, "chart_max_years": 5}'::jsonb,
    'storytelling',
    'On-this-day accrual flashback. Computes daily-cost from txns whose service period overlaps {prior_year}-MM-DD; surfaces top contributors per year. Accrual-aware: rent shows daily share, trips show daily-burn, annual subs show daily slice — not whatever random txn happened to clear that calendar date.'),

  ('streak_or_gap', TRUE, 10, 1, 2, 1.0, 0.15,
    -- "Spend day" = day with overlapping txn whose daily_cost > 0, restricted to
    -- commitment-based parents (restaurant/groceries/clothes/tech, plus
    -- entertainment filtered to short-window service_days <= 7). Always-on subs
    -- would make every day a "spend day" for utilities — meaningless.
    '{"min_current_gap_days": 7, "trailing_months": 12, "rank_within_top_n": 3}'::jsonb,
    'rhythm',
    'Behavioral rhythm: surfaces the longest current spending gap among commitment-based parents. Restricted to categories where streaks are narratively meaningful (no always-on subscriptions).'),

  ('net_worth_velocity', TRUE, 14, 1, 2, 1.0, 0.10,
    -- Monthly net-worth aggregates from balance_snapshots; 90d delta vs same
    -- window 1y ago. Eligibility requires snapshots in both windows.
    '{"min_snapshots_recent_window": 2, "min_snapshots_yearago_window": 2, "primary_window_days": 90}'::jsonb,
    'longhorizon',
    'Net worth change last 90 days vs same window 1y ago. Reads balance_snapshots; pure cash/asset data, not accrual.'),

  ('monthly_burn_forecast', TRUE, 7, 2, 4, 1.0, 0.15,
    -- Projects total accrued cost for current month given already-accrued MTD,
    -- locked-in remainder (txns whose service period extends past today), and
    -- variable forecast (trailing-30d non-locked rate × remaining days).
    -- Mid-month sweet spot; too-early projections are unstable, too-late are
    -- redundant with budget_pace.
    '{"month_day_min": 8, "month_day_max": 25, "min_history_months": 3}'::jsonb,
    'forward',
    'Forward-looking accrual forecast: where will May land vs trailing 12mo monthly mean and same calendar month 1y ago. Pure accrual — cash-flow forecasting is FEA-09 (Plaid) territory.'),

  ('cashback_roi', TRUE, 30, 0, 1, 1.0, 0.10,
    -- YTD effective rate per card (cashback / eligible_spend by payment_type).
    -- Long cooldown because the answer changes slowly; monthly_max=1 keeps it
    -- from dominating a month even if the bandit loves it.
    '{"min_ytd_cashback_usd": 50, "min_distinct_cards": 2}'::jsonb,
    'health',
    'YTD cashback effective rate per card. Eligible spend uses txn amount_usd by payment_type (cashback is a single-day event, transaction-date is correct here).'),

  ('trip_year_in_review', TRUE, 30, 0, 1, 1.0, 0.10,
    -- Two windows: prior-completed-year (fires Jan 1-31) and current YTD.
    -- Uses get_tag_summaries() which is already accrual-correct via overlap days.
    '{"min_completed_trips": 2, "min_total_trip_spend": 500}'::jsonb,
    'trips',
    'Annual trip rollup across completed trip-style tags. Uses get_tag_summaries() — accrual-correct via overlap days. Fires for prior year in Jan, YTD otherwise.')
ON CONFLICT (insight_type) DO UPDATE
  SET enabled           = EXCLUDED.enabled,
      cooldown_days     = EXCLUDED.cooldown_days,
      monthly_target    = EXCLUDED.monthly_target,
      monthly_max       = EXCLUDED.monthly_max,
      priority_weight   = EXCLUDED.priority_weight,
      min_quality_score = EXCLUDED.min_quality_score,
      requires          = EXCLUDED.requires,
      theme             = EXCLUDED.theme,
      notes             = EXCLUDED.notes,
      updated_at        = NOW();

-- Defense vs Supabase Oct 30, 2026 auto-grant removal (per CLAUDE.md). No new
-- table created here, but the column add is covered by the existing default
-- privileges set in 20260513000003_disciplan_schema.sql. Nothing else needed.
