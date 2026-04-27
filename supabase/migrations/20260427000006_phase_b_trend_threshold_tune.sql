-- Phase B follow-up: tune category_trend gates after dry-run validation showed
-- R²≥0.35 was too strict for noisy monthly spending data (real data peaks at
-- ~0.20). Lower R² floor to 0.15 and let the builder also exclude transfer-like
-- parents (financial, other) and fit on 12 *complete* months only.
UPDATE insight_strategy
SET requires = jsonb_build_object(
      'min_months',                   6,
      'min_slope',                    30,
      'min_r2',                       0.15,
      'recent_parent_exclusion_days', 35
    ),
    notes = COALESCE(notes, '') || E'\n[2026-04-27 Phase B tune] Lowered min_r2 0.35→0.15; builder now excludes financial+other parents and fits on 12 complete months (drops partial current month).',
    updated_at = NOW()
WHERE insight_type = 'category_trend';
