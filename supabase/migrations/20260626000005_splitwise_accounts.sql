-- FEA-29D: per-person Splitwise API keys. Each household member can connect
-- their OWN Splitwise account so they sync their own expenses (the old single
-- shared SPLITWISE_API_KEY env secret remains the fallback / default account).
--
-- SECURITY: api_key is a live credential. This table is deliberately readable
-- ONLY by service_role (the edge function). The browser/anon role is REVOKEd,
-- so even with the public anon key the key column can never be SELECTed. Keys
-- are written via the splitwise-sync `set_key` action (service role), never by
-- a direct client insert.

CREATE TABLE IF NOT EXISTS disciplan.splitwise_accounts (
  owner        TEXT PRIMARY KEY,
  household_id BIGINT,
  api_key      TEXT NOT NULL,
  sw_user_id   BIGINT,
  sw_name      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-only access. Explicitly revoke the roles that back the public anon key
-- (defends against the ALTER DEFAULT PRIVILEGES auto-grant to authenticated).
GRANT ALL ON disciplan.splitwise_accounts TO service_role;
REVOKE ALL ON disciplan.splitwise_accounts FROM authenticated;
REVOKE ALL ON disciplan.splitwise_accounts FROM anon;

DO $$
DECLARE hid BIGINT;
BEGIN
  SELECT id INTO hid FROM disciplan.households ORDER BY id LIMIT 1;
  IF hid IS NOT NULL THEN
    EXECUTE format('ALTER TABLE disciplan.splitwise_accounts ALTER COLUMN household_id SET DEFAULT %L', hid);
  END IF;
END $$;

-- RLS on with no authenticated policy = no PostgREST access for app users.
ALTER TABLE disciplan.splitwise_accounts ENABLE ROW LEVEL SECURITY;
