-- Store compact SQL-tool audit summaries so newsletter failures can be diagnosed
-- after the fact. This is intentionally JSONB (array of objects) rather than raw
-- SQL text in separate rows: each newsletter has at most a handful of tool calls,
-- and `insight_log` is the operator-facing audit surface already used by AI Portal.

ALTER TABLE disciplan.insight_log
  ADD COLUMN IF NOT EXISTS tool_query_summaries JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE disciplan.insight_log
  ADD COLUMN IF NOT EXISTS parse_failure_snippet TEXT;
