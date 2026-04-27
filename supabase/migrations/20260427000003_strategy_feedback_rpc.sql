-- FEA-XX (Phase 4): Atomic feedback → insight_strategy aggregate update.
-- Called from supabase/functions/inbound-email/index.ts when a feedback rating
-- is matched to an insight_log row.
--
-- Bandit policy notes:
--   - Per-rating priority_weight delta is centered at rating=5 and capped at ±0.10.
--   - Weight is clamped to [0.10, 2.00] so feedback can never zero out an archetype
--     (Mark always reviews via the AI portal before flipping enabled=false).
--   - rating_sumsq is maintained for future variance/UCB calculations.

CREATE OR REPLACE FUNCTION apply_strategy_feedback(p_insight_type TEXT, p_rating NUMERIC)
RETURNS insight_strategy
LANGUAGE plpgsql
AS $$
DECLARE
  v_delta REAL;
  v_row insight_strategy;
BEGIN
  -- Linear delta centered at 5, capped at ±0.10 per rating.
  v_delta := GREATEST(-0.10, LEAST(0.10, (p_rating::REAL - 5) / 50.0));

  UPDATE insight_strategy
  SET
    rated_count     = rated_count + 1,
    rating_sum      = rating_sum + p_rating::REAL,
    rating_sumsq    = rating_sumsq + (p_rating::REAL * p_rating::REAL),
    priority_weight = GREATEST(0.10, LEAST(2.00, priority_weight + v_delta)),
    last_rated_at   = NOW(),
    updated_at      = NOW()
  WHERE insight_type = p_insight_type
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
