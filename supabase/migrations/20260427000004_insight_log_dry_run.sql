-- FEA-XX (Phase 6): Reproducible newsletter evaluation.
-- Adds a dry_run flag so historical-replay emails can be persisted for diff/review
-- without polluting strategy aggregates or triggering real Postmark sends.
-- See supabase/functions/daily-insight/index.ts for INSIGHT_DRY_RUN env handling
-- and the ?fixture=YYYY-MM-DD query param.

ALTER TABLE insight_log
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS insight_log_dry_run_idx
  ON insight_log (dry_run, created_at DESC);
