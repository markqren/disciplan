-- FEA-11: Daily AI insight newsletter — log table
-- Stores each generated insight, Postmark message ID for reply matching,
-- token usage for cost tracking, and user feedback from email replies.

CREATE TABLE IF NOT EXISTS insight_log (
  id                   BIGSERIAL PRIMARY KEY,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  insight_type         TEXT NOT NULL,
  subject              TEXT NOT NULL,
  html_body            TEXT,
  model_used           TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  postmark_message_id  TEXT,           -- matched against In-Reply-To on feedback replies
  input_tokens         INTEGER,
  output_tokens        INTEGER,
  cost_usd             NUMERIC(10,6),
  feedback_rating      NUMERIC(3,1),   -- e.g. 8.0, stored from "8/10" reply
  feedback_comment     TEXT,
  feedback_received_at TIMESTAMPTZ
);
