-- FEA-XX (Phase 1): Newsletter insight strategy + selection trace
-- Replaces prompt-only type selection with a policy-gated candidate engine.
-- Selection runtime: see supabase/functions/daily-insight/index.ts
-- Operator UI:        see js/ai-portal.js (newsletter tab)
--
-- Design notes (calibrated against insight_log as of 2026-04-27, n=30):
--  - category_yoy was 33% of all sends and Mark explicitly flagged repetition fatigue,
--    so its cooldown_days=5 (above the default of 3) and monthly_max=5.
--  - category_trend (avg 5.25) and income_breakdown (avg 5.5) are weak performers,
--    so they get long cooldowns + low priority_weight.
--  - All "feedback aggregate" columns (sent_count, rated_count, rating_sum, rating_sumsq)
--    will be back-filled from insight_log at the end of this migration.

CREATE TABLE IF NOT EXISTS insight_strategy (
  insight_type      TEXT PRIMARY KEY,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  cooldown_days     SMALLINT NOT NULL DEFAULT 3,
  monthly_target    SMALLINT,                                    -- soft target per calendar month (informational)
  monthly_max       SMALLINT,                                    -- hard cap per calendar month; NULL = unlimited
  priority_weight   REAL NOT NULL DEFAULT 1.0,
  min_quality_score REAL NOT NULL DEFAULT 0.0,                   -- archetype must produce >= this data-strength score to be eligible
  requires          JSONB NOT NULL DEFAULT '{}'::jsonb,          -- per-archetype precondition thresholds (see daily-insight runtime)
  sent_count        INTEGER NOT NULL DEFAULT 0,
  rated_count       INTEGER NOT NULL DEFAULT 0,
  rating_sum        REAL NOT NULL DEFAULT 0,
  rating_sumsq      REAL NOT NULL DEFAULT 0,                     -- enables std-dev / variance later if needed
  last_used_at      TIMESTAMPTZ,
  last_rated_at     TIMESTAMPTZ,
  last_skip_reason  TEXT,                                        -- why was this archetype skipped on the most recent run
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS insight_strategy_enabled_idx
  ON insight_strategy (enabled, last_used_at);

-- Per-newsletter selection trace. Captures candidate set, policy params, and whether
-- exploration was taken. Kept in a sibling table so insight_log.html_body stays compact.
CREATE TABLE IF NOT EXISTS insight_selection_log (
  insight_log_id    BIGINT PRIMARY KEY REFERENCES insight_log(id) ON DELETE CASCADE,
  candidates        JSONB NOT NULL,                              -- [{type, score, eligible, reasons:{...}}, ...]
  policy            TEXT NOT NULL,                               -- e.g. 'epsilon_greedy_v1'
  policy_params     JSONB NOT NULL,                              -- e.g. {"epsilon":0.15}
  exploration_taken BOOLEAN NOT NULL,
  selected_type     TEXT NOT NULL
);

-- Convenience: average rating per archetype (NULL when rated_count = 0).
CREATE OR REPLACE FUNCTION insight_strategy_avg_rating(s insight_strategy)
RETURNS REAL
LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN s.rated_count > 0 THEN s.rating_sum / s.rated_count ELSE NULL END $$;

-- ── Seed: existing archetypes with data-calibrated initial weights ──────────
INSERT INTO insight_strategy (insight_type, enabled, cooldown_days, monthly_target, monthly_max, priority_weight, requires, notes)
VALUES
  ('category_yoy',        TRUE,  5, 4, 5,  0.9, '{}'::jsonb,
    'High-quality (avg 7.5/10) but Mark flagged repetition fatigue on 2026-04-19. Heavier cooldown.'),
  ('budget_pace',         TRUE,  4, 5, 6,  1.1, '{"month_day_min":8,"month_day_max":24}'::jsonb,
    'Avg 7.0; mid-month sweet spot.'),
  ('service_expiry',      TRUE,  7, 1, 2,  1.0, '{"min_expiring_30d":2}'::jsonb,
    'Useful monthly, not weekly.'),
  ('category_anomaly',    TRUE,  5, 2, 4,  1.1, '{"min_zscore":2.0}'::jsonb,
    'Only fire on a real spike. Mark requested parent->child breakdown context (see category_anomaly_with_breakdown).'),
  ('large_transactions',  TRUE,  5, 2, 4,  1.0, '{"min_total_groups":3}'::jsonb,
    'Always evaluate at the group level (net amount), never individual lines.'),
  ('spend_projection',    TRUE,  5, 2, 3,  1.0, '{"month_day_min":5}'::jsonb,
    'Useful but rarely surprising; use sparingly.'),
  ('subscription_creep',  TRUE,  7, 1, 2,  0.9, '{}'::jsonb,
    'Look for slow 12-month creep, not weekly drift.'),
  ('income_breakdown',    TRUE, 14, 0, 1,  0.5, '{}'::jsonb,
    'Bottom-quartile rated (avg 5.5). Mark on 2026-04-22: "income is paid start and end of month, not useful." Demoted but kept for irregular months.'),
  ('category_trend',      TRUE, 10, 1, 2,  0.6, '{"min_months":4}'::jsonb,
    'Worst rated archetype (avg 5.25). Demoted; long cooldown.'),
  ('parse_fallback',      FALSE, 0, 0, 0,  0.0, '{}'::jsonb,
    'Never selected by policy — used only when LLM JSON parse fails.')
ON CONFLICT (insight_type) DO NOTHING;

-- ── Back-fill aggregates from existing insight_log so the bandit starts informed ──
WITH agg AS (
  SELECT
    insight_type,
    COUNT(*)::int                                           AS sent,
    COUNT(feedback_rating)::int                             AS rated,
    COALESCE(SUM(feedback_rating)::real, 0)                 AS rsum,
    COALESCE(SUM((feedback_rating)*(feedback_rating))::real, 0) AS rsumsq,
    MAX(created_at)                                         AS last_used,
    MAX(feedback_received_at)                               AS last_rated
  FROM insight_log
  GROUP BY insight_type
)
UPDATE insight_strategy s
SET sent_count    = agg.sent,
    rated_count   = agg.rated,
    rating_sum    = agg.rsum,
    rating_sumsq  = agg.rsumsq,
    last_used_at  = agg.last_used,
    last_rated_at = agg.last_rated,
    updated_at    = NOW()
FROM agg
WHERE s.insight_type = agg.insight_type;
