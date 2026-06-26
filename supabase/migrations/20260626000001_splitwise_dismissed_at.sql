-- FEA-29B follow-up: remember when a Splitwise expense was dismissed.
--
-- Once an expense has been dismissed, the next time it is surfaced in the import
-- queue (restored by the user, or re-surfaced by the sync because it materially
-- changed in Splitwise) the review card flags it as "previously dismissed".
-- dismissed_at is set on dismiss and intentionally NOT cleared on restore/import,
-- so it remains a permanent "was dismissed at least once" marker.

ALTER TABLE disciplan.splitwise_expenses
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- Backfill rows already dismissed before this column existed.
UPDATE disciplan.splitwise_expenses
  SET dismissed_at = COALESCE(dismissed_at, last_synced_at)
  WHERE sync_status = 'dismissed';
