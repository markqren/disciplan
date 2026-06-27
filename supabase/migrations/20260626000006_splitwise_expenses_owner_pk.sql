-- FEA-29D: a Splitwise expense shared by two household members has the SAME
-- expense_id on both accounts. With expense_id as a global primary key, the
-- second member to sync would collide with / overwrite the first member's row.
-- Re-key the dedup table on (owner, expense_id) so both accounts coexist.

UPDATE disciplan.splitwise_expenses SET owner = 'mark' WHERE owner IS NULL;

ALTER TABLE disciplan.splitwise_expenses ALTER COLUMN owner SET NOT NULL;
ALTER TABLE disciplan.splitwise_expenses ALTER COLUMN owner SET DEFAULT 'mark';

-- Swap the primary key (drop whatever the existing single-column PK is named).
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'disciplan.splitwise_expenses'::regclass AND contype = 'p';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE disciplan.splitwise_expenses DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE disciplan.splitwise_expenses
  ADD CONSTRAINT splitwise_expenses_pkey PRIMARY KEY (owner, expense_id);
