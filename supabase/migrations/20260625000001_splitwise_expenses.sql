-- FEA-29B: Splitwise API Sync — dedup + update-detection foundation
--
-- A dedicated mapping table that is the single source of truth for "have I
-- imported this Splitwise expense?" and "did it change in Splitwise after I
-- imported it?". Keyed on the Splitwise expense id (stable) and storing the
-- last-synced updated_at, every sync reconciles fetched expenses against this
-- table:
--   - no row            -> NEW          (sync_status='pending', raw=payload)
--   - row + newer sw ts -> CHANGED      (sync_status='needs_review', pending_raw=new)
--   - row + deleted_at  -> DELETED      (sync_status='needs_review')
--   - row + same ts     -> unchanged    (skip; bump last_synced_at)
--
-- owner/household_id mirror the multiuser stamps added in
-- 20260620000001_multiuser_households.sql so Splitwise rows participate in the
-- same Combined/per-person views.

CREATE TABLE IF NOT EXISTS disciplan.splitwise_expenses (
  expense_id           BIGINT PRIMARY KEY,        -- Splitwise's stable expense id
  owner                TEXT,
  household_id         BIGINT,

  -- ── Splitwise change-tracking ──
  sw_updated_at        TIMESTAMPTZ,               -- Splitwise updated_at, last synced/imported
  sw_deleted_at        TIMESTAMPTZ,               -- Splitwise soft-delete marker
  content_hash         TEXT,                      -- hash of material fields (belt-and-suspenders)

  -- ── Disciplan linkage ──
  transaction_group_id BIGINT,                    -- groups the expense + reimbursement rows
  expense_txn_id       BIGINT,                    -- main expense transaction
  reimburse_txn_id     BIGINT,                    -- reimbursement credit transaction (nullable)

  -- ── Lifecycle ──
  sync_status          TEXT NOT NULL DEFAULT 'pending'
                         CHECK (sync_status IN ('pending','imported','needs_review','dismissed')),
  raw                  JSONB,                     -- last-synced / imported payload snapshot
  pending_raw          JSONB,                     -- new payload awaiting review (needs_review only)

  first_imported_at    TIMESTAMPTZ,
  last_synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Explicit grants (defense vs Supabase Oct 30, 2026 auto-grant removal)
GRANT SELECT, INSERT, UPDATE, DELETE ON disciplan.splitwise_expenses TO authenticated;
GRANT ALL ON disciplan.splitwise_expenses TO service_role;

CREATE INDEX IF NOT EXISTS idx_splitwise_expenses_status
  ON disciplan.splitwise_expenses (sync_status);
CREATE INDEX IF NOT EXISTS idx_splitwise_expenses_household
  ON disciplan.splitwise_expenses (household_id, owner);

-- Default household_id to the seeded household so an un-stamped service-role
-- insert still appears in the Combined view (mirrors 20260620000001).
DO $$
DECLARE hid BIGINT;
BEGIN
  SELECT id INTO hid FROM disciplan.households ORDER BY id LIMIT 1;
  IF hid IS NOT NULL THEN
    EXECUTE format('ALTER TABLE disciplan.splitwise_expenses ALTER COLUMN household_id SET DEFAULT %L', hid);
  END IF;
END $$;

ALTER TABLE disciplan.splitwise_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "splitwise_expenses_all" ON disciplan.splitwise_expenses;
CREATE POLICY "splitwise_expenses_all" ON disciplan.splitwise_expenses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
