-- FEA-38: Balance Sheet restructure — Working Capital section
-- Reclassify Venmo to working_capital (flow-through intermediary)
UPDATE accounts SET account_type = 'working_capital' WHERE id = 'venmo';

-- Move Venmo Credit from 'liability' to 'credit' (it's a real credit card)
UPDATE accounts SET account_type = 'credit' WHERE id = 'venmo_credit';

-- Add Rakuten as a new working_capital account (for future FEA-37)
INSERT INTO accounts (id, label, account_type, display_order, is_active)
VALUES ('rakuten', 'Rakuten', 'working_capital', 50, true)
ON CONFLICT (id) DO NOTHING;
