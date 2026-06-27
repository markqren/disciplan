-- FEA-XX (Phase 0): Newsletter feature hardening
-- 1. Track parse-fallback newsletters (LLM JSON parse failures that fell back to a deterministic template)
-- 2. principles_pending — operator-approval queue for principles distillation,
--    so an inbound email reply cannot directly mutate insight_context.principles.
--    See supabase/functions/inbound-email/index.ts (insight feedback handler) for guardrail logic.

ALTER TABLE insight_log
  ADD COLUMN IF NOT EXISTS parse_fallback BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS principles_pending (
  id                     BIGSERIAL PRIMARY KEY,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggering_log_id      BIGINT REFERENCES insight_log(id) ON DELETE SET NULL,
  current_principles     TEXT NOT NULL,
  proposed_principles    TEXT NOT NULL,
  proposed_length_delta  INTEGER GENERATED ALWAYS AS (
    LENGTH(proposed_principles) - LENGTH(current_principles)
  ) STORED,
  rejection_reason       TEXT,                                -- non-null when guardrails rejected automatically
  status                 TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | auto_rejected
  reviewed_at            TIMESTAMPTZ,
  reviewed_by            TEXT,
  CONSTRAINT principles_pending_status_chk CHECK (
    status IN ('pending','approved','rejected','auto_rejected')
  )
);

CREATE INDEX IF NOT EXISTS principles_pending_status_idx
  ON principles_pending (status, created_at DESC);
