-- FEA-39: Email-to-Ledger Import Pipeline
-- Migration: Create pending_imports staging table
-- Run via Supabase Dashboard SQL Editor or supabase db push

-- ═══════════════════════════════════════════════════════
-- 1. Create table
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pending_imports (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                    -- 'venmo', 'rakuten', 'chase_alert', 'subscription', 'unknown'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'committed', 'skipped', 'error'

  -- ── Parsed candidate fields (mirror transactions schema) ──
  date DATE,
  description TEXT,
  category_id TEXT,
  amount_usd NUMERIC(12,2),
  currency TEXT DEFAULT 'USD',
  payment_type TEXT,
  credit TEXT DEFAULT '',
  tag TEXT DEFAULT '',
  service_start DATE,
  service_end DATE,
  service_days INT DEFAULT 1,
  daily_cost NUMERIC(12,6),

  -- ── Raw email metadata (for debugging / re-parsing / unknown emails) ──
  email_subject TEXT,
  email_from TEXT,
  email_body_text TEXT,                    -- Plain text version
  email_body_html TEXT,                    -- HTML version (for structured parsing)
  email_received_at TIMESTAMPTZ DEFAULT now(),
  email_message_id TEXT,                   -- For dedup on re-forwarded emails

  -- ── Source-specific extracted data (flexible JSON) ──
  parsed_data JSONB DEFAULT '{}',

  -- ── AI enrichment ──
  ai_category TEXT,                        -- AI-suggested category_id
  ai_confidence TEXT,                      -- 'high', 'medium', 'low'
  ai_description TEXT,                     -- AI-cleaned description

  -- ── Error tracking ──
  parse_errors TEXT[],                     -- Any issues during extraction

  -- ── Lifecycle ──
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  committed_at TIMESTAMPTZ,
  committed_txn_id BIGINT                  -- FK to transactions.id after commit
);

-- ═══════════════════════════════════════════════════════
-- 2. Indexes
-- ═══════════════════════════════════════════════════════

CREATE INDEX idx_pi_status ON pending_imports(status);
CREATE INDEX idx_pi_source ON pending_imports(source);
CREATE INDEX idx_pi_email_message_id ON pending_imports(email_message_id);

-- ═══════════════════════════════════════════════════════
-- 3. Row Level Security
-- ═══════════════════════════════════════════════════════

ALTER TABLE pending_imports ENABLE ROW LEVEL SECURITY;

-- Authenticated users: full CRUD (same pattern as transactions table)
CREATE POLICY "authenticated_select" ON pending_imports
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "authenticated_insert" ON pending_imports
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_update" ON pending_imports
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_delete" ON pending_imports
  FOR DELETE TO authenticated
  USING (true);

-- Service role: full access (for the Edge Function webhook handler)
-- Note: service_role bypasses RLS by default in Supabase,
-- but we add an explicit policy for clarity.
CREATE POLICY "service_role_all" ON pending_imports
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
