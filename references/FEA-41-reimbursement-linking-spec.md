# FEA-41: Reimbursement Auto-Linking & Venmo Description Improvements

**Feature ID:** FEA-41  
**Priority:** High  
**Depends on:** FEA-39 (Email Import), existing transactions table  
**Scope:** Three sub-features that work together

---

## Overview

When someone Venmo-pays you back for a shared expense, Disciplan should automatically detect the reimbursement and link it to the original expense. This requires better Venmo description formatting (so the merchant name is extractable), a `related_transaction_id` column for linking, an auto-matching scan on app load, and a visual grouping in the Ledger.

---

## Part A: Venmo Description Format Improvements

### Current behavior
- Paid with category "restaurant" and note "Buoy": `Restaurant - Buoy`  
- Paid without category: `Venmo - Aud Li (Buoy)`
- Received: `Venmo from Joanna Zhang`

### New behavior — include counterparty in category-aware descriptions

**Outgoing (You paid):**
- With category + note: `Restaurant - Buoy - Aud Li`  
  Format: `{Category} - {Note} - {Counterparty}`
- With category, no note: `Restaurant - Aud Li`
- Without category: `Venmo - Aud Li (Buoy)` (unchanged)

**Incoming (received / "paid your request"):**
- Always treat as reimbursement: `Reimbursed - {Note} ({Category}) - {Counterparty}`
- Example: `Reimbursed - Gao Viet (Restaurant) - Joanna`
- If no note: `Reimbursed - Joanna Zhang`
- Category comes from: forwarding note keyword > AI guess from note text > "other"

### Edge Function changes (inbound-email/index.ts)

In `parseVenmoEmail()`, update the description building logic:

```typescript
// OUTGOING (You paid)
if (fwdCat && isPaid) {
  const catLabel = fwdCat.charAt(0).toUpperCase() + fwdCat.slice(1);
  const mainNote = note || "";
  description = mainNote
    ? `${catLabel} - ${mainNote} - ${counterparty}`
    : `${catLabel} - ${counterparty}`;
  if (fwdHint) description += ` (${fwdHint})`;
} else if (isPaid) {
  description = `Venmo - ${counterparty}${note ? ` (${note})` : ""}`;
}

// INCOMING (received / paid your request)  
if (isReceived || isPaidRequest) {
  const catLabel = fwdCat 
    ? fwdCat.charAt(0).toUpperCase() + fwdCat.slice(1)
    : null;
  const firstName = counterparty.split(" ")[0];
  if (note) {
    description = catLabel
      ? `Reimbursed - ${note} (${catLabel}) - ${firstName}`
      : `Reimbursed - ${note} - ${firstName}`;
  } else {
    description = `Reimbursed - ${counterparty}`;
  }
  // Category: match the original expense's category, not "income"
  // For now, use forwarding note category or AI; linking will refine later
  categoryId = fwdCat || null;  // NOT "income" — it's a reimbursement
}
```

**Reimbursement category logic:** A reimbursement should carry the **same category as the original expense** (e.g., "restaurant"), not "income". This is because the reimbursement reduces the net cost of that category. The amount is negative (credit), so it correctly reduces the category total in the income statement. If we can't determine the category at import time, default to "other" and let the auto-linker fix it later.

---

## Part B: Transaction Linking (Database + Auto-Match)

### Database migration

```sql
-- Add linking column to transactions
ALTER TABLE transactions 
  ADD COLUMN IF NOT EXISTS related_transaction_id BIGINT 
  REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX idx_txn_related ON transactions(related_transaction_id) 
  WHERE related_transaction_id IS NOT NULL;
```

The link is **bidirectional**: when A links to B, set `A.related_transaction_id = B.id` AND `B.related_transaction_id = A.id`. This makes lookups easy from either side.

### Auto-linking scan (runs on init)

Add a function `scanForReimbursementLinks()` that runs on app init (after auth, before renderContent). It scans recent transactions (last 90 days) for unlinked reimbursement candidates.

**Matching algorithm:**

```javascript
async function scanForReimbursementLinks() {
  // 1. Fetch recent unlinked reimbursements (negative Venmo transactions, last 90 days)
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const reimbursements = await sb(
    `transactions?payment_type=eq.Venmo&amount_usd=lt.0` +
    `&related_transaction_id=is.null&date=gte.${cutoff}` +
    `&select=id,date,description,amount_usd,category_id,tag`
  );
  if (!reimbursements.length) return;

  // 2. Fetch candidate expenses (positive transactions, expanded date range)
  const expandedCutoff = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const expenses = await sb(
    `transactions?amount_usd=gt.0&related_transaction_id=is.null` +
    `&date=gte.${expandedCutoff}` +
    `&select=id,date,description,amount_usd,category_id,payment_type,tag`
  );

  // 3. For each reimbursement, find best matching expense
  const links = [];
  for (const reimb of reimbursements) {
    const reimbAmt = Math.abs(reimb.amount_usd);
    
    // Extract merchant/note from description
    // "Reimbursed - Gao Viet (Restaurant) - Joanna" → "gao viet"
    // "Reimbursed - Buoy - Joanna" → "buoy"
    const noteMatch = reimb.description.match(/Reimbursed - (.+?)(?:\s*\(.+?\))?\s*-\s*\w+$/);
    const reimbNote = noteMatch ? noteMatch[1].toLowerCase().trim() : "";
    
    // Score candidates
    let bestMatch = null;
    let bestScore = 0;
    
    for (const exp of expenses) {
      let score = 0;
      
      // Amount proximity: reimbursement should be ≤ expense amount
      if (reimbAmt > exp.amount_usd * 1.05) continue; // skip if reimb > expense + 5%
      
      // Check if reimbursement is a clean fraction of the expense
      // Recognizes: 1/1, 1/2, 1/3, 1/4, 1/5, 2/3, 3/4, 2/5, 3/5, 4/5
      const ratio = reimbAmt / exp.amount_usd;
      const CLEAN_FRACTIONS = [
        1, 1/2, 1/3, 1/4, 1/5, 
        2/3, 3/4, 2/5, 3/5, 4/5
      ];
      const isCleanFraction = CLEAN_FRACTIONS.some(f => 
        Math.abs(ratio - f) < 0.03  // within 3% tolerance (~$1 on a $40 bill)
      );
      
      // Exact or near-exact amount match (within $1)
      if (Math.abs(reimbAmt - exp.amount_usd) < 1.0) score += 40;
      // Clean fraction (1/2, 1/3, 1/4, 2/3, etc.) — strong signal of a split
      else if (isCleanFraction) score += 35;
      // Any other amount where reimb < expense
      else if (reimbAmt < exp.amount_usd) score += 10;
      
      // Date proximity (within 30 days preferred, up to 90)
      const daysDiff = Math.abs(
        (new Date(reimb.date) - new Date(exp.date)) / 864e5
      );
      if (daysDiff <= 3) score += 25;
      else if (daysDiff <= 14) score += 20;
      else if (daysDiff <= 30) score += 10;
      else if (daysDiff <= 90) score += 5;
      else continue; // too far apart
      
      // Description/note match (fuzzy)
      const expDesc = exp.description.toLowerCase();
      if (reimbNote && expDesc.includes(reimbNote)) score += 35;
      else if (reimbNote) {
        // Try individual words (at least 2 chars)
        const words = reimbNote.split(/\s+/).filter(w => w.length >= 3);
        const matches = words.filter(w => expDesc.includes(w));
        if (matches.length > 0) score += 15 * (matches.length / words.length);
      }
      
      // Same category bonus
      if (reimb.category_id && reimb.category_id === exp.category_id) score += 10;
      
      // Same tag bonus
      if (reimb.tag && reimb.tag === exp.tag) score += 10;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = exp;
      }
    }
    
    // Only auto-link if confidence is high enough (score >= 60)
    if (bestMatch && bestScore >= 60) {
      links.push({
        reimbursement: reimb,
        expense: bestMatch,
        score: bestScore
      });
      // Remove matched expense from pool so it's not double-matched
      expenses.splice(expenses.indexOf(bestMatch), 1);
    }
  }

  // 4. Apply links (PATCH both sides)
  for (const link of links) {
    await sb(`transactions?id=eq.${link.reimbursement.id}`, {
      method: "PATCH",
      body: JSON.stringify({ 
        related_transaction_id: link.expense.id,
        // Also update category to match expense if it was "other"
        ...(link.reimbursement.category_id === "other" 
          ? { category_id: link.expense.category_id } 
          : {})
      })
    });
    await sb(`transactions?id=eq.${link.expense.id}`, {
      method: "PATCH",
      body: JSON.stringify({ related_transaction_id: link.reimbursement.id })
    });
  }

  if (links.length > 0) {
    console.log(`Auto-linked ${links.length} reimbursement(s)`);
  }
}
```

**Call this in init()** after auth check, fire-and-forget (don't block app load):

```javascript
// In init(), after the txnCount fetch:
scanForReimbursementLinks().catch(e => console.error("Link scan error:", e));
```

---

## Part C: Linked Transaction UI (Ledger)

### Visual treatment in Ledger table

When transactions have a `related_transaction_id`, show them as a linked pair:

1. **Connector indicator:** Add a small link icon (🔗) or a colored left-border bracket connecting the two rows when they're adjacent in the list.

2. **If the linked partner is visible in the current page:** Draw a subtle connecting line on the left margin between the two rows. Both rows get a shared muted left-border color (e.g., `var(--b)` blue).

3. **If the linked partner is NOT visible** (different page, filtered out): Show a small "🔗 Linked" badge on the row. Clicking it could:
   - Jump to the partner transaction (adjust page/filters)
   - Or show the partner's details in a tooltip

4. **In the Ledger edit modal:** Add a "Linked to:" section showing the partner transaction's description, amount, and date. Include an "Unlink" button.

### Fetching linked data

Modify `renderLedger` to include `related_transaction_id` in the SELECT:

```javascript
let q = `transactions?order=date.desc,id.desc&limit=${PS}&offset=${state.page*PS}` +
  `&select=*,linked:transactions!related_transaction_id(id,description,amount_usd,date)`;
```

This uses Supabase's foreign key join to fetch the linked partner in a single query.

### Sort consideration

Linked transactions should appear adjacent when sorted by date. Since expenses and their reimbursements often have different dates (you pay on Monday, friend reimburses on Thursday), the Ledger should optionally sort linked pairs together. For v1, just showing the link indicator is sufficient — we can add sort-grouping later.

---

## Part D: Email Import Integration

When committing email imports in `commitEmailImports()`:

After the batch INSERT to `transactions` succeeds, for each reimbursement transaction (negative amount, Venmo), immediately attempt to find and link to the matching expense. This provides instant linking rather than waiting for the next init() scan.

```javascript
// After successful commit in commitEmailImports:
const newReimbursements = valid.filter(c => c.amount_usd < 0 && c.payment_type === "Venmo");
if (newReimbursements.length) {
  // Trigger linking scan for just these new transactions
  setTimeout(() => scanForReimbursementLinks(), 1000);
}
```

---

## Implementation Order

1. **Edge Function fix** — Update Venmo parser description format (Part A)
2. **DB migration** — Add `related_transaction_id` column (Part B)  
3. **Auto-linking scan** — Add `scanForReimbursementLinks()` to init() (Part B)
4. **Ledger UI** — Show linked pairs visually (Part C)
5. **Email import hook** — Trigger linking after email commit (Part D)

---

## Examples

### Example 1: Restaurant split
You pay $150 at Gao Viet on Chase Sapphire. Joanna Venmo-pays you $72.50 with note "gao viet".

**Expense (from CSV import):**
`Restaurant - Gao Viet` | $150.00 | Chase Sapphire | restaurant

**Reimbursement (from email import):**
`Reimbursed - Gao Viet (Restaurant) - Joanna` | ($72.50) | Venmo | restaurant

**Auto-link score:** description match "gao viet" (+35) + date within 3 days (+25) + same category (+10) + clean 1/2 fraction (+35) = **105** ✅

**Net cost in IS:** $150.00 - $72.50 = $77.50 under "restaurant"

### Example 2: Activity with note
You pay $110 to Aud Li for "Buoy" (forwarded as "restaurant").

**Expense (from email import):**
`Restaurant - Buoy - Aud Li` | $110.00 | Venmo | restaurant

No reimbursement expected (you paid the full amount to one person).

### Example 3: Ambiguous reimbursement  
Kevin Venmos you $40 with note "dinner". No clear match to a specific expense.

**Import:** `Reimbursed - Dinner - Kevin` | ($40.00) | Venmo | restaurant (AI guess)

**Auto-link score:** "dinner" is too generic — won't match any specific restaurant description strongly enough. Score likely < 60. **Not auto-linked** — user can manually link in Ledger edit modal.

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/inbound-email/index.ts` | Part A: Update description format in parseVenmoEmail(), handle "paid your request" subject, add Fwd: stripping |
| `supabase/migrations/20260308_related_txn.sql` | Part B: Add `related_transaction_id` column + index |
| `index.html` | Parts B+C+D: Add scanForReimbursementLinks(), update renderLedger() for link indicators, update commitEmailImports() for post-commit linking |

---

## Claude Code Prompt

```
Read references/FEA-41-reimbursement-linking-spec.md and implement all changes.

ORDER OF OPERATIONS:
1. First read the current supabase/functions/inbound-email/index.ts and 
   index.html to understand existing code.

2. Update the Edge Function (Part A):
   - Fix Venmo detect() to match forwarded emails (subject-only patterns, 
     strip "Fwd: " prefix)
   - Add "paid your $X request" subject pattern as isReceived
   - Update description format:
     * Outgoing + category: "{Category} - {Note} - {Counterparty}"
     * Incoming: "Reimbursed - {Note} ({Category}) - {FirstName}"
   - Reimbursements should NOT be category "income" — use the forwarding 
     note category, or "other" (auto-linker will fix later)
   - Add date fallback: if parser can't extract date, use email received date
   - Deploy: supabase functions deploy inbound-email --no-verify-jwt

3. Create migration (Part B):
   - supabase/migrations/20260308_related_txn.sql
   - ALTER TABLE transactions ADD COLUMN related_transaction_id BIGINT 
     REFERENCES transactions(id) ON DELETE SET NULL
   - CREATE INDEX on that column

4. Add auto-linking to index.html (Part B):
   - Add scanForReimbursementLinks() function per the spec
   - Call it in init() after auth, fire-and-forget
   - Scoring: description match (35pts), date proximity (25pts), 
     amount match (40pts), same category (10pts), same tag (10pts)
   - Threshold: 60 points minimum for auto-link
   - Update both sides (bidirectional linking)

5. Update Ledger UI (Part C):
   - Include related_transaction_id in ledger query SELECT
   - Show 🔗 icon on linked rows with blue left border
   - In openLedgerEditModal, show "Linked to:" section with partner details
   - Add "Unlink" button in edit modal

6. Post-commit linking (Part D):
   - After commitEmailImports succeeds, trigger scanForReimbursementLinks()

Don't git push — we'll batch the deploy.
```
