# FEA-29A: One-Click Reimburse on Ledger Items

**Feature ID:** FEA-29 (Part A only — Splitwise API deferred to Part B)  
**Priority:** High  
**Depends on:** FEA-41 (Reimbursement Auto-Linking — done), FEA-21 (Ledger Edit/Delete — done)  
**Scope:** Add "Reimburse" action to ledger edit modal; create offsetting reimbursement transaction with linking

---

## 1. Overview

When Mark pays for a shared expense (dinner, trip activity, groceries), he often splits the cost with friends who pay him back later. Currently this requires manually creating a negative transaction. FEA-29A adds a **"Reimburse" button** in the ledger edit modal that opens a reimbursement form pre-populated from the original expense, lets Mark pick a person, split percentage, and payment method, then creates the offsetting negative transaction with automatic `related_transaction_id` linking.

This works with the existing FEA-41 auto-linking infrastructure — but instead of waiting for a Venmo email to arrive and be matched, Mark can proactively record that a reimbursement is expected or has been received.

---

## 2. User Flow

1. Mark opens the Ledger tab, finds a $150 restaurant transaction
2. Clicks the row → edit modal opens (existing FEA-21 behavior)
3. Clicks the new **"Reimburse"** button (between Save and Delete)
4. Reimbursement form appears (replaces the edit form in the modal):
   - **Person:** dropdown of friends (Tony, Kevin, Aditya, Home, etc.)
   - **Split:** preset buttons [50% | 33% | 25% | Custom ___]
   - **Reimbursement amount:** auto-calculated, editable for custom amounts
   - **Payment method:** dropdown defaulting to "Venmo" (can switch to Splitwise, Cash, etc.)
   - **Note (optional):** text field for context
5. Clicks "Create Reimbursement"
6. System creates a new negative transaction:
   - `description`: "Reimbursed - {original description} - {Person}"
   - `amount_usd`: negative (e.g., -$75.00)
   - `category_id`: same as original expense
   - `payment_type`: selected method (Venmo, Splitwise, Cash, etc.)
   - `date`, `service_start`, `service_end`: same as original expense
   - `daily_cost`, `service_days`: recalculated for negative amount over same period
   - `tag`: same as original expense
   - `related_transaction_id`: linked to original expense
7. Original expense also gets `related_transaction_id` set to the new reimbursement
8. Modal closes, ledger refreshes, both transactions now show as linked (🔗)

---

## 3. Implementation Details

### 3.1 New Payment Types & Accounts

Add "Splitwise" to the PTS array and accounts table. This is a **new payment type** that will eventually become a Working Capital account (FEA-38), but for now just needs to exist as a valid payment_type:

```javascript
// Add to PTS array (alphabetical position):
"Splitwise"

// SQL (run in Supabase):
INSERT INTO accounts (id, label, account_type) 
VALUES ('splitwise', 'Splitwise', 'liability') 
ON CONFLICT (id) DO NOTHING;
```

**Balance Sheet behavior:** Once the Splitwise account exists with `account_type = 'liability'`, it will automatically appear in the Balance Sheet under "Other Liabilities" — `renderBS` picks up any payment type with ledger transactions and groups by account_type. The net balance reflects reimbursements: positive means friends owe Mark money (he paid and recorded reimbursements), negative means he owes others. Each reimbursement created via the Reimburse button uses `payment_type = "Splitwise"`, shifting that balance. With FEA-38 (future), Splitwise gets reclassified from `liability` to `working_capital` and moves into its own "Working Capital" section alongside Venmo and Rakuten.

### 3.2 Friends List (Dynamic from History)

Derive the person dropdown dynamically from past reimbursement transactions. Scan the ledger for the most common names that appear in reimbursement-style transactions, ranked by frequency:

```javascript
async function fetchReimburseFriends() {
  // Pull names from two sources:
  // 1. Transfer credit names (the old pattern: payment_type="Transfer", credit="Kevin")
  // 2. Venmo reimbursement descriptions ("Reimbursed - ... - Kevin")
  
  // Source 1: Transfer credits (existing historical pattern)
  const creditRows = await sb(
    "transactions?payment_type=eq.Transfer&credit=neq.&select=credit&limit=5000"
  );
  
  // Source 2: Reimbursement descriptions (FEA-41 pattern)
  const reimbRows = await sb(
    "transactions?description=like.Reimbursed*&amount_usd=lt.0&select=description&limit=5000"
  );
  
  // Count frequency of each name
  const counts = {};
  for (const r of creditRows) {
    const name = r.credit.trim();
    if (name) counts[name] = (counts[name] || 0) + 1;
  }
  for (const r of reimbRows) {
    // Extract person from "Reimbursed - ... - Kevin"
    const m = r.description.match(/-\s*(\w+)\s*$/);
    if (m) {
      const name = m[1].trim();
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  
  // Sort by frequency descending, return top 15
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name]) => name);
}
```

The dropdown renders these names sorted by frequency (most reimbursed person first), plus a free-text input field below/after the dropdown for entering a new name not in the list. No "Other" option needed — the free-text input is always visible as a fallback. If the dropdown is empty (first-time use, no history), only the free-text input shows.

### 3.3 Split Presets

```javascript
const SPLIT_PRESETS = [
  { label: "50%", value: 0.5 },
  { label: "33%", value: 1/3 },
  { label: "25%", value: 0.25 },
  { label: "Custom", value: null }  // shows manual input
];
```

### 3.4 Reimburse Button Placement

In `openLedgerEditModal`, add a "Reimburse" button in the action button row. It should only appear for **expense transactions** (positive `amount_usd`, not income/investment/financial categories):

```javascript
// Show Reimburse button only for reimbursable expenses
const isReimbursable = txn.amount_usd > 0 
  && txn.category_id !== "income" 
  && txn.category_id !== "investment" 
  && txn.category_id !== "financial"
  && txn.category_id !== "adjustment";
```

### 3.5 Reimbursement Form (replaces edit form content in modal)

When "Reimburse" is clicked, the modal content transitions to the reimbursement form:

**Layout:**
```
┌─────────────────────────────────────────────┐
│ Reimburse                              ✕    │
│ Restaurant - Gao Viet · $150.00             │
│                                             │
│ Person:     [Kevin ▼]  (from history)       │
│             [or type a name___]             │
│                                             │
│ Split:  [50%] [33%] [25%] [Custom]          │
│                                             │
│ Amount:     $75.00  (auto-calculated)       │
│                                             │
│ Payment:    [Venmo ▼]                       │
│                                             │
│ Note:       [optional context]              │
│                                             │
│ ┌─ Preview ──────────────────────────────┐  │
│ │ Reimbursed - Gao Viet - Kevin          │  │
│ │ -$75.00 · Venmo · restaurant           │  │
│ │ Linked to: Restaurant - Gao Viet       │  │
│ └────────────────────────────────────────┘  │
│                                             │
│ [Create Reimbursement]  [Back]              │
└─────────────────────────────────────────────┘
```

### 3.6 Transaction Creation Logic

```javascript
async function createReimbursement(originalTxn, person, splitRatio, paymentType, note) {
  const reimbAmount = -(originalTxn.amount_usd * splitRatio);
  
  // Use original expense's service period so accruals align
  const ss = new Date(originalTxn.service_start + "T00:00:00");
  const se = new Date(originalTxn.service_end + "T00:00:00");
  const serviceDays = Math.max(1, Math.floor((se - ss) / 864e5) + 1);
  const dailyCost = Math.round(reimbAmount / serviceDays * 1e6) / 1e6;
  
  // Build description
  const cleanDesc = originalTxn.description;
  const firstName = person.split(" ")[0];
  const description = `Reimbursed - ${cleanDesc} - ${firstName}`;
  
  // Create the reimbursement transaction
  const newTxn = {
    date: originalTxn.date,
    service_start: originalTxn.service_start,
    service_end: originalTxn.service_end,
    description,
    category_id: originalTxn.category_id,
    original_amount: reimbAmount,
    currency: "USD",
    fx_rate: 1,
    amount_usd: Math.round(reimbAmount * 100) / 100,
    payment_type: paymentType,
    tag: (originalTxn.tag || "").toLowerCase().trim(),
    daily_cost: dailyCost,
    service_days: serviceDays,
    credit: "",
    related_transaction_id: originalTxn.id
  };
  
  // POST to Supabase
  const result = await sb("transactions", {
    method: "POST",
    headers: { "Prefer": "return=representation" },
    body: JSON.stringify(newTxn)
  });
  
  // Link back: update original transaction
  const newId = result[0]?.id;
  if (newId && !originalTxn.related_transaction_id) {
    await sb(`transactions?id=eq.${originalTxn.id}`, {
      method: "PATCH",
      headers: { "Prefer": "return=representation" },
      body: JSON.stringify({ related_transaction_id: newId })
    });
  }
  
  return result;
}
```

### 3.7 Edge Cases

| Case | Handling |
|------|----------|
| Transaction already has a linked reimbursement | Show "Already linked to a reimbursement" note; still allow creating another (multiple friends might reimburse) |
| Custom split amount exceeds original | Validate: reimbursement amount must be ≤ original amount. Show error. |
| Split amount is $0 or negative | Validate: must be > $0. Show error. |
| "Other" person selected | Free-text input is always visible below the dropdown; person name required before submit |
| No reimbursement history (empty dropdown) | Only the free-text input shows; dropdown hidden |
| Transaction is negative (already a credit) | Don't show Reimburse button (handled by `isReimbursable` check) |
| Transaction is in a tag (trip) | Reimbursement inherits the same tag — correctly reduces trip cost |

---

## 4. Files to Modify

| File | Changes |
|------|---------|
| `index.html` | (1) Add "Splitwise" to PTS array. (2) Add SPLIT_PRESETS constant and `fetchReimburseFriends()` function. (3) Add `showReimburseForm()` function. (4) Add `createReimbursement()` function. (5) Modify `openLedgerEditModal()` to include Reimburse button and form transition. |

No new Supabase tables or migrations needed — uses existing `transactions` table and `related_transaction_id` column from FEA-41.

**SQL to run (one-time):**
```sql
INSERT INTO accounts (id, label, account_type) 
VALUES ('splitwise', 'Splitwise', 'liability') 
ON CONFLICT (id) DO NOTHING;
```

---

## 5. Testing Checklist

- [ ] Open Ledger, click any expense row → edit modal has "Reimburse" button
- [ ] Reimburse button NOT shown for: income transactions, investment transactions, negative amounts, financial category
- [ ] Click Reimburse → form shows with correct original amount and description
- [ ] Split presets calculate correctly: 50% of $150 = $75, 33% = $50, 25% = $37.50
- [ ] Custom split: entering 40% or a dollar amount works
- [ ] Person dropdown shows names from transaction history, sorted by frequency
- [ ] Free-text input visible below dropdown for entering new names
- [ ] Selecting a dropdown name populates the person field; typing in free-text overrides it
- [ ] If no reimbursement history exists, dropdown is hidden, only free-text shows
- [ ] Payment type defaults to Venmo; can switch to Splitwise, Cash, etc.
- [ ] Preview section updates live as selections change
- [ ] "Create Reimbursement" creates negative transaction in Supabase with correct fields
- [ ] New transaction has `related_transaction_id` pointing to original
- [ ] Original transaction gets `related_transaction_id` updated to point to new reimbursement
- [ ] Both transactions show 🔗 linked icon in Ledger
- [ ] Reimbursement inherits original's tag, category, service period
- [ ] Description format: "Reimbursed - {original desc} - {FirstName}"
- [ ] Net effect on IS: original category total reduced by reimbursement amount
- [ ] Mobile responsive: form stacks vertically on small screens

---

## 6. Claude Code Step-by-Step Implementation Guide

### Before You Start

1. Copy this spec file into the repo root as `references/FEA-29A-reimburse-spec.md`
2. Make sure you're on latest `main`
3. Read CLAUDE.md for project rules

---

### Step 1: Load Context & Add Constants

**Prompt to Claude Code:**

```
Read these files to understand the project:
- CLAUDE.md (project rules)
- references/FEA-29A-reimburse-spec.md (this spec)
- index.html (focus on: PTS array around line 137, openLedgerEditModal function, 
  createReimbursement pattern from commitImport, scanForReimbursementLinks)

Step 1: Add constants, the Splitwise payment type, and the dynamic friends fetcher.

A) Add "Splitwise" to the PTS array in alphabetical position (between "Presto" and "TD Chequing" area — actually between any S entries, just keep it sorted).

B) After the CC_PAY_NAMES or CHASE_CAT_MAP constants, add the SPLIT_PRESETS constant:

const SPLIT_PRESETS = [
  { label: "50%", value: 0.5 },
  { label: "33%", value: 1/3 },
  { label: "25%", value: 0.25 },
  { label: "Custom", value: null }
];

C) Add the fetchReimburseFriends() async function per spec section 3.2.
   It queries two sources:
   1. Transfer credit names (payment_type=Transfer, credit field)
   2. "Reimbursed - ... - Name" description patterns (from FEA-41)
   Counts frequency of each name, returns top 15 sorted by most frequent.

Don't touch openLedgerEditModal yet.
```

---

### Step 2: Add createReimbursement Function

**Prompt to Claude Code:**

```
Step 2 of FEA-29A. Add the createReimbursement function.

Add this function after the scanForReimbursementLinks function (or near the ledger section):

async function createReimbursement(originalTxn, person, splitRatio, paymentType, note) {
  // See spec section 3.6 for the full implementation
  // Key points:
  // - reimbAmount = -(originalTxn.amount_usd * splitRatio), rounded to 2 decimals
  // - Uses original's date, service_start, service_end, category_id, tag
  // - Description: "Reimbursed - {original description} - {person first name}"
  // - POST to transactions with related_transaction_id = originalTxn.id
  // - PATCH original to set related_transaction_id = new txn id (only if not already linked)
  // - Update state.txnCount
  // - Return the created transaction
}

Follow the spec exactly for the implementation.
```

---

### Step 3: Add Reimburse Button to Ledger Edit Modal

**Prompt to Claude Code:**

```
Step 3 of FEA-29A. This is the main UI change. Modify openLedgerEditModal to add the Reimburse button and form.

A) In the button row of openLedgerEditModal (where Save, Delete, Cancel are), add a "Reimburse" button BETWEEN Save and Delete. 

   Only show it when the transaction is reimbursable:
   - amount_usd > 0
   - category_id not in ["income", "investment", "financial", "adjustment"]
   
   Style: background rgba(74,111,165,0.2), color var(--b), width auto, padding 12px 20px
   Text: "💸 Reimburse"

B) When clicked, the Reimburse button should replace the modal content with a reimbursement form:

   The form shows:
   1. Header: "Reimburse" with original description + amount as subtitle
   2. Person selection: call fetchReimburseFriends() when the form opens.
      - If results exist: render a <select> dropdown with the names sorted by frequency,
        plus a free-text <input> below it (placeholder: "or type a name").
        Selecting from dropdown populates the person; typing in free-text overrides dropdown.
      - If no results (empty history): hide the dropdown, show only the free-text input.
   3. Split preset buttons (50% | 33% | 25% | Custom). Clicking one highlights it (selected state).
      When Custom selected, show a text input for either % or $ amount.
   4. Reimbursement amount: auto-calculated display (e.g., "$75.00"), updates when split changes
   5. Payment method dropdown: PTS array, defaulting to "Venmo"
   6. Note: optional text input
   7. Preview section (same .preview class as entry form):
      - Shows the description that will be created
      - Shows amount, payment type, category
      - Shows "Linked to: {original description}"
   8. Buttons: [Create Reimbursement (green)] [Back (gray, returns to edit form)]

   The "Back" button should restore the original edit modal content.

   "Create Reimbursement" calls createReimbursement(), shows success feedback,
   closes the modal, and refreshes the ledger page.

C) Use the same h() DOM helper, mRow(), mField() patterns from the edit modal.
   Match the existing dark theme styling exactly.

D) The form should update the preview live as the user changes person, split, or payment type.

E) Validation before submit:
   - Person must be selected (not empty)
   - If "Other", custom name must be filled
   - Split amount must be > 0 and ≤ original amount
   - Show validation errors inline
```

---

### Step 4: Test & Polish

**Prompt to Claude Code:**

```
Step 4 of FEA-29A. Test the implementation.

1. Load the app, go to Ledger tab
2. Click any positive expense transaction (e.g., a restaurant bill)
3. Verify:
   - [ ] Edit modal shows the 💸 Reimburse button
   - [ ] Button NOT shown for: income rows, investment rows, negative amounts
   - [ ] Clicking Reimburse shows the reimbursement form
   - [ ] Person dropdown works, "Other" shows text input
   - [ ] Split presets calculate correctly
   - [ ] Custom split works (both % and $ input)
   - [ ] Preview updates live
   - [ ] "Back" returns to edit form
   - [ ] "Create Reimbursement" creates the transaction
   - [ ] Both transactions show as linked in Ledger (🔗 icon)
   - [ ] New transaction has correct: description, negative amount, category, service period, tag, payment_type
   - [ ] Mobile: form doesn't overflow

4. Also verify existing functionality not broken:
   - [ ] Save button still works in edit modal
   - [ ] Delete button still works
   - [ ] Linked transaction section still shows for already-linked txns

Fix any bugs. Don't git push yet.
```

---

### Step 5: Roadmap Update & Deploy

**Prompt to Claude Code:**

```
Step 5. Final steps for FEA-29A.

1. Update disciplan-roadmap.md:
   - In the "Next Up" table, update FEA-29 to note that Part A is complete
   - Change the description to indicate Part A (One-Click Reimburse) is done,
     Part B (Splitwise API) remains for future
   - Or split into FEA-29A (completed) and FEA-29B (future)

2. Run the SQL to add the Splitwise account:
   INSERT INTO accounts (id, label, account_type) 
   VALUES ('splitwise', 'Splitwise', 'liability') 
   ON CONFLICT (id) DO NOTHING;

3. Commit and push:
   git add -A
   git commit -m "FEA-29A: One-Click Reimburse on Ledger Items

   - Reimburse button in ledger edit modal for expense transactions
   - Split presets (50%, 33%, 25%, custom) with live amount calculation
   - Friends dropdown (Tony, Kevin, Aditya, Home, etc.) with Other option
   - Payment method selector defaulting to Venmo
   - Creates negative offsetting transaction with same category/tag/service period
   - Automatic bidirectional related_transaction_id linking
   - Live preview of reimbursement before creation
   - Added Splitwise payment type for future API integration
   - Description format: 'Reimbursed - {desc} - {Person}'"

   git push origin main
```

---

## 7. Interaction with Existing Features

**FEA-41 (Auto-Linking):** If Mark creates a reimbursement via this feature AND later receives a Venmo email for the same reimbursement, the auto-linker might try to match the Venmo receipt to the original expense. But since the original already has `related_transaction_id` set, the auto-linker's query (`related_transaction_id=is.null`) will skip it. No conflict.

**FEA-40 (Email Import):** Venmo emails arriving after a manual reimbursement was already created will appear as regular pending imports. The duplicate detection (date + amount + payment_type) should catch exact matches. If amounts differ slightly (Venmo fee, rounding), both might exist — user can skip the email import during review.

**Income Statement:** The negative reimbursement transaction in the same category (e.g., "restaurant") correctly reduces the category total via the accrual engine. If Mark spent $150 and got $75 back, the IS shows net $75 for that transaction pair.

**Tags:** Reimbursement inherits the original's tag, so trip cost tracking (e.g., "japan" tag) automatically shows the net cost after reimbursements.

---

## 8. Future: FEA-29B (Splitwise API)

Part B will add:
- OAuth2 flow with Splitwise (register app at dev.splitwise.com)
- `getExpenses()` API sync to pull shared expenses
- "Splitwise" as a `working_capital` account type (FEA-38)
- Balance reconciliation between Disciplan and actual Splitwise balance
- Automatic import of Splitwise settlements

Part A prepares for this by establishing the "Splitwise" payment type and the reimbursement transaction pattern.
