-- FEA-XX (Phase B): Newsletter archetype reworks
--   - Replace tag_burn_rate (active-tag burn-rate) with tag_recap (historical trip recap),
--     since active "tags" are mostly ongoing-cost lifestyle tags (pets, bf2025) that aren't
--     interesting as burn-rate insights — Mark wants nostalgia-style reviews of past trips.
--   - Add insight_log.subject_key for archetype-level dedup on a structured key
--     (e.g. tag_recap stores 'tag:cozumel' so we don't recap the same trip twice in 90 days).
--   - Demoted category_trend (avg 5.25) and income_breakdown (avg 5.5) get reworked in code,
--     not schema; their priority_weight stays low until the new versions earn ratings.
-- Runtime: see supabase/functions/daily-insight/{index,archetypes}.ts (Phase B branch).

-- 1. subject_key on insight_log — used by tag_recap (and any future archetype) to dedup
--    on a structured identity rather than fragile subject-line regex matching.
ALTER TABLE insight_log
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

CREATE INDEX IF NOT EXISTS insight_log_subject_key_idx
  ON insight_log (subject_key, created_at DESC)
  WHERE subject_key IS NOT NULL;

-- 2. Disable tag_burn_rate. We don't delete the row so historical insight_selection_log
--    rows that reference it still resolve, and operators can re-enable it manually if
--    they want to test the old behaviour.
UPDATE insight_strategy
SET enabled = FALSE,
    notes = COALESCE(notes, '') || E'\n[2026-04-27 Phase B] Replaced by tag_recap. Disabled — active "tags" are mostly lifestyle (pets, bf2025), not trip-style, so burn-rate framing didn''t fit. tag_recap covers completed trips instead.',
    updated_at = NOW()
WHERE insight_type = 'tag_burn_rate';

-- 3. New tag_recap archetype. Picks a past trip-style tag (end_date < today - 30) and
--    surfaces a fun rundown: total spend, daily burn, top 5 expenses, top spend days,
--    category mix. Skipped if the same tag has been recapped within last 90 days.
INSERT INTO insight_strategy (insight_type, enabled, cooldown_days, monthly_target, monthly_max, priority_weight, min_quality_score, requires, notes)
VALUES
  ('tag_recap', TRUE, 14, 1, 2, 1.0, 0.1,
    -- max_days_since_end=1110 (~3yr) so 1y/2y/3y anniversaries are reachable; the
    -- builder gives an extra weight bump within ±10d of an integer-year anniversary.
    '{"min_total_accrual":200,"min_txn_count":5,"min_days_since_end":30,"max_days_since_end":1110,"recap_cooldown_days":90}'::jsonb,
    'Historical trip recap. Picks a completed past tag never recapped in last 90 days. Avoid recent (need emotional distance) and very old (signal decays). Anniversary boost (±10d of 1y/2y/3y).')
ON CONFLICT (insight_type) DO UPDATE
  SET enabled         = EXCLUDED.enabled,
      cooldown_days   = EXCLUDED.cooldown_days,
      monthly_target  = EXCLUDED.monthly_target,
      monthly_max     = EXCLUDED.monthly_max,
      priority_weight = EXCLUDED.priority_weight,
      min_quality_score = EXCLUDED.min_quality_score,
      requires        = EXCLUDED.requires,
      notes           = EXCLUDED.notes,
      updated_at      = NOW();

-- 4. category_trend rework: 12-month window, R²≥0.35 gate to suppress spike-as-trend
--    false positives, and a 35-day recent-parent exclusion to force rotation across
--    parents (Mark's complaint: "why only focus on health? too many newsletters in a
--    row" — same parent kept winning). The deep-dive multi-chart treatment is in code;
--    schema only controls the gates.
UPDATE insight_strategy
SET requires = jsonb_build_object(
      'min_months',                   6,
      'min_slope',                    30,
      'min_r2',                       0.35,
      'recent_parent_exclusion_days', 35
    ),
    notes = COALESCE(notes, '') || E'\n[2026-04-27 Phase B] Reworked: 12mo window, R²≥0.35 gate, 35d recent-parent exclusion, multi-chart child breakdown.',
    updated_at = NOW()
WHERE insight_type = 'category_trend';

-- 5. income_breakdown rework: pivot from "month velocity vs trailing 6mo mean"
--    (timing-skewed; Mark explicitly disliked it) to YTD-vs-YTD apples-to-apples
--    comparison through today's calendar day, with 1Y delta % and 3Y CAGR. Only fires
--    when YoY delta is ≥3% in either direction and we're past day 60 of the year
--    (so the YTD comparison is statistically meaningful).
UPDATE insight_strategy
SET requires = jsonb_build_object(
      'min_day_of_year',  60,
      'min_yoy_delta_pct', 0.03
    ),
    notes = COALESCE(notes, '') || E'\n[2026-04-27 Phase B] Reworked: YTD YoY through today + 3Y CAGR, replaces month-velocity framing.',
    updated_at = NOW()
WHERE insight_type = 'income_breakdown';
