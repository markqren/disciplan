-- Phase B follow-up #2: switch category_trend gate from absolute $/mo to relative
-- drift (|slope * 12| / mean monthly spend), so utilities ($23/mo on $500 base =
-- 53% drift) isn't penalised vs home ($110/mo on $4000 base = 32% drift). Lower
-- min_r2 to 0.10 since monthly spending data is noisy.
UPDATE insight_strategy
SET requires = jsonb_build_object(
      'min_months',                   6,
      'min_slope',                    15,       -- absolute floor (noise filter)
      'min_r2',                       0.10,
      'min_relative_strength',        0.15,     -- 15% drift over 12 months
      'recent_parent_exclusion_days', 35
    ),
    notes = COALESCE(notes, '') || E'\n[2026-04-27 Phase B tune #2] Switched to relative drift gate (15%) + R²≥0.10. Utilities/home now eligible.',
    updated_at = NOW()
WHERE insight_type = 'category_trend';
