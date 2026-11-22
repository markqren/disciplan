-- Shilpa's own Cash and Venmo accounts, matching Mark's types.
-- Splitwise already exists as splitwise_shilpa. Labels match payment_type.
INSERT INTO disciplan.accounts (id, label, account_type, currency, display_order, is_active, owner, household_id)
VALUES
  ('cash_shilpa', 'Cash', 'other', 'USD', 9, true, 'shilpa', 1),
  ('venmo_shilpa', 'Venmo', 'working_capital', 'USD', 10, true, 'shilpa', 1)
ON CONFLICT (id) DO NOTHING;
