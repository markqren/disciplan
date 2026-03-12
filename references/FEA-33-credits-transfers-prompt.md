# FEA-33: Credits & Transfers Sub-Ledger on Balance Sheet

## Context

Transactions with `payment_type = 'Transfer'` always have an associated `credit` field value (e.g., "Tony", "Home", "Kevin", "HSA", "FSA", "Ski Lease", etc.). These represent internal transfers and IOUs — money owed to or from various people/accounts. The original spreadsheet tracks this as a sub-payment table with Credit/Debit/Balance rows per credit name (see `TransactionsTransactions111111.csv` in the project files).

Currently the Balance Sheet shows live ledger balances grouped by account type (checking, savings, credit, investment, liability) via the `get_ledger_balances()` RPC. Transfer transactions are summed under the "Transfer" payment type as a single line item. **We need to break this out into individual credit-name balances.**

## Data Model

In the `transactions` table:
- `payment_type = 'Transfer'` + `credit = 'Tony'` → money flowing to/from Tony
- `amount_usd > 0` (positive) = money going OUT (debit to that credit account)
- `amount_usd < 0` (negative) = money coming IN (credit to that credit account)
- Net balance per credit name = `SUM(-amount_usd)` where `payment_type = 'Transfer'` grouped by `credit`

The original spreadsheet shows these credit names and their balances:

**Active credits** (from `TransactionsTransactions111111.csv`):
Tony, Home, Kevin, Cornerstone, Google, Delta, Bonus, Laundry, Wageworks, Poker, Rent, Apple, Basketball, HSA, FSA, Ski Lease, Credits

**Retired credits** (from `TransactionsTransactions1111113.csv` — many zero-balance):
Amazon - GBP, Air Canada, Walmart, Cash - CZK, Cash - GBP, Cash - EUR, Cash - TRY, Alishan, Imran, Amy, Wealthsimple, AMEX, Home Trust, Procom, Presto, Wageworks, Clipper, Amazon - CAD, Amazon - USD, First Republic

**Spreadsheet SOT balances for validation** (from the CSV):
- Home: CA$15,387.67 → $11,231.87 USD
- HSA: $587.50
- FSA: $321.90
- Google: $205.71
- Poker: $150.00
- Apple: $46.89
- Tony: -CA$7.11 → -$5.19 USD
- Total Credits balance: $12,572.76

## Requirements

### 1. New RPC Function: `get_credit_balances()`

Create a Supabase RPC that returns per-credit-name balances:

```sql
CREATE OR REPLACE FUNCTION get_credit_balances()
RETURNS TABLE(
  credit_name TEXT,
  credits NUMERIC,
  debits NUMERIC,
  net_balance NUMERIC,
  txn_count BIGINT
) AS $$
  SELECT
    credit,
    ROUND(SUM(CASE WHEN amount_usd < 0 THEN ABS(amount_usd) ELSE 0 END)::numeric, 2) AS credits,
    ROUND(SUM(CASE WHEN amount_usd > 0 THEN amount_usd ELSE 0 END)::numeric, 2) AS debits,
    ROUND(SUM(-amount_usd)::numeric, 2) AS net_balance,
    COUNT(*) AS txn_count
  FROM transactions
  WHERE payment_type = 'Transfer' AND credit IS NOT NULL AND credit != ''
  GROUP BY credit
  ORDER BY ABS(SUM(-amount_usd)) DESC;
$$ LANGUAGE SQL STABLE;
```

**Important:** Also add this to `supabase-schema.sql` for documentation.

### 2. Balance Sheet UI: Expandable Credits Section

In `renderBS()`, after fetching `get_ledger_balances`, also fetch `get_credit_balances()`. Then:

**a) Remove "Transfer" from the main account groups** — it shouldn't show as a single line item anymore since we're breaking it out.

**b) Add a "Credits & Transfers" expandable section** on the Liabilities card (or as its own card). It should show:

- **Summary row** showing the total net credits balance ($12,572.76) with a `▸`/`▾` expand toggle (same pattern as subcategory collapse in the Income Statement, using TD-02's approach)
- **Expanded detail** showing each credit name with its net balance, sorted by absolute value descending
- Skip zero-balance credits (< $0.01 absolute)
- Positive balances = money owed TO Mark (asset-like, show in green)
- Negative balances = money Mark OWES (liability-like, show in red)

**c) The total credits balance should be factored into the net worth KPI cards.** Currently the Transfer payment type already contributes to the balance. Make sure the math stays consistent — the sum of individual credit balances should equal what was previously shown as the single "Transfer" line.

### 3. Visual Design

Follow existing Balance Sheet patterns:
- Use `acctGroup()` function style or similar for the expandable section
- Use `fmtF()` for full-digit formatting
- Monospace font for numbers, right-aligned
- Colors: positive balances in `var(--g)` (green), negative in `var(--r)` (red)
- Collapsed by default with toggle arrow
- Each row: credit name on left, balance on right (same as account rows)

### 4. Validation

After implementing, verify these values against the spreadsheet SOT:
- Home balance ≈ $11,231.87
- HSA ≈ $587.50
- Total credits ≈ $12,572.76
- Tony ≈ -$5.19

Small discrepancies (< $1) are acceptable due to rounding. Large discrepancies indicate a bug.

## Implementation Steps

1. **Pull latest `index.html` from git** (always do this first)
2. **Create the RPC function** — run the SQL in Supabase SQL editor, add to `supabase-schema.sql`
3. **Modify `renderBS()`** in `index.html`:
   - Add `sbRPC("get_credit_balances")` to the `Promise.all` call
   - Filter out "Transfer" from the main `byType` groups (or handle it specially)
   - Build the expandable credits section
   - Ensure net worth KPI math remains correct
4. **Test & validate** against spreadsheet SOT values
5. **Update `disciplan-roadmap.md`** — add FEA-33 and move to Completed when done
6. **Do NOT git push** — accumulate changes locally per the batching rule

## Files to Modify

- `index.html` — `renderBS()` function (~lines 1041-1138)
- `supabase-schema.sql` — add `get_credit_balances()` function
- `disciplan-roadmap.md` — add FEA-33 entry
