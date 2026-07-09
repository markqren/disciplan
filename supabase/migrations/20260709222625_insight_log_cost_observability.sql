-- FEA-116: newsletter cost observability. Persist the tool-call count and the
-- Anthropic prompt-cache token split so we can watch efficiency over time (the
-- AI portal surfaces these). Costs recently doubled to $0.04-0.16/send driven by
-- the multi-turn tool loop re-billing context; prompt caching now bills the
-- re-sent prefix at 0.1x, and these columns let us confirm the drop and catch
-- future regressions.
--
-- All nullable with a 0 default so historical rows (pre-caching) read cleanly.

ALTER TABLE disciplan.insight_log
  ADD COLUMN IF NOT EXISTS tool_calls        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;
