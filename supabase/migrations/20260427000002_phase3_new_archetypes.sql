-- FEA-XX (Phase 3): New insight archetypes
--   accrual_quality_alert — surfaces real data-integrity bugs (run_data_health_check)
--   tag_burn_rate         — surfaces $ burned on currently-active trip-style tags

INSERT INTO insight_strategy (insight_type, enabled, cooldown_days, monthly_target, monthly_max, priority_weight, min_quality_score, requires, notes)
VALUES
  ('accrual_quality_alert', TRUE, 14, 1, 2, 0.7, 0.0,
    '{"min_recent_duplicates":1,"min_orphaned_groups":1,"min_accrual_mismatches":1}'::jsonb,
    'Maintenance ping. Fires only when run_data_health_check surfaces orphans, accrual mismatches, or duplicates within 60 days.'),
  ('tag_burn_rate',         TRUE,  7, 2, 4, 1.0, 0.1,
    '{"min_total_accrual":200,"min_txn_count":3}'::jsonb,
    'Picks the highest-spend currently-active tag with end_date within window. Skipped when no qualifying tag is in flight.')
ON CONFLICT (insight_type) DO NOTHING;
