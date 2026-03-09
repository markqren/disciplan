-- FEA-41: Add related_transaction_id for reimbursement linking
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS related_transaction_id BIGINT
  REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_txn_related ON transactions(related_transaction_id)
  WHERE related_transaction_id IS NOT NULL;
