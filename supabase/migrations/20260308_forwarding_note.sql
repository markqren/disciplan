-- FEA-40 Enhancement: Forwarding note columns
ALTER TABLE pending_imports ADD COLUMN IF NOT EXISTS forwarding_note TEXT;
ALTER TABLE pending_imports ADD COLUMN IF NOT EXISTS forwarding_category TEXT;
ALTER TABLE pending_imports ADD COLUMN IF NOT EXISTS forwarding_hint TEXT;
