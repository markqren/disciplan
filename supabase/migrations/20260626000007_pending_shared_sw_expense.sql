-- FEA-29D: deterministic cross-channel dedup. When a reimbursement is both
-- mirrored to a household member AND pushed to Splitwise, record the created
-- Splitwise expense id on the mirror proposal. On approval the recipient's
-- ledger pre-registers that expense_id as 'imported', so when they later sync
-- their own Splitwise account the shared expense is skipped (no double-count).

ALTER TABLE disciplan.pending_shared_txns
  ADD COLUMN IF NOT EXISTS sw_expense_id BIGINT;
