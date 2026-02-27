# FEA-24: CSV Transaction Import — Implementation Spec

**Feature ID:** FEA-24  
**Priority:** High  
**Depends on:** Existing Entry tab, Supabase transactions table, Anthropic API access  
**Implementation target:** Claude Code (single index.html file)

---

## 1. Overview

Add a CSV import flow as a collapsible sub-section within the **Entry tab**. Users upload a bank/credit card CSV statement, the system auto-detects the bank format, AI-categorizes each row using historical transaction patterns via the Claude API, and presents an editable review table. Users approve/edit/skip rows, then batch-commit to Supabase.

---

## 2. UI Location & Layout

**Where:** New collapsible section in the Entry tab, below the existing manual entry form.

**Structure:**
```
Entry Tab
├── Manual Entry Form (existing)
└── 📥 Import CSV (collapsible, collapsed by default)
    ├── Upload Bar: [Choose File] [Payment Type ▼] [Tag input] [Import Button]
    ├── Status: "Parsing... → AI categorizing... → Ready for review"
    └── Review Table (appears after processing)
```

**Styling:** Match existing Disciplan dark theme — same card styling (`.cd` class), same fonts, same color variables (`--g`, `--b`, `--y`, etc.), same table striping pattern as the ledger.

---

## 3. Step-by-Step Flow

### 3.1 Upload & Configure

- **File picker**: Standard `<input type="file" accept=".csv">`
- **Payment type dropdown**: Same `PTS` array as Entry form. Try to auto-detect from filename:
  - `Chase` in filename → default "Chase Sapphire" (most common Chase card)
  - `AMEX` in filename → default "AMEX Rose Gold"
  - Otherwise → default "Chase Sapphire" (current primary card)
- **Bulk tag input**: Optional text field. If filled, applies to all imported rows.
- **Import button**: Triggers parse → enrich → display pipeline.

### 3.2 Parse CSV

**Bank profile detection** from header row:

```javascript
const BANK_PROFILES = {
  chase: {
    detect: headers => headers.includes("Transaction Date") && headers.includes("Post Date") && headers.includes("Memo"),
    columns: {
      date: "Transaction Date",
      description: "Description", 
      amount: "Amount",
      bankCategory: "Category",
      type: "Type"
    },
    // Chase amounts: negative = expense, positive = payment/refund
    transformAmount: amt => -amt,  // flip so expenses are positive (Disciplan convention)
    skipTypes: ["Payment"],        // CC payments are not real expenses
    currency: "USD"
  }
  // Future: amex, schwab, etc.
};
```

**CSV parsing:** Use a simple parser that handles quoted fields (descriptions can contain commas). Don't need a library — a regex-based splitter or state machine works. Handle edge cases: quotes within quotes, trailing commas, BOM bytes.

**Output:** Array of raw row objects with bank-native field names, plus a `_bankProfile` reference.

### 3.3 Transform to Disciplan Schema

For each parsed row, create a **candidate transaction object**:

```javascript
{
  // From CSV
  date: "2026-02-23",           // Transaction Date, reformatted to YYYY-MM-DD
  description: "Restaurant - La Choza", // AI-cleaned description (what gets saved)
  amount_usd: 63.67,            // Absolute value, flipped from Chase negative
  
  // Enriched by AI
  category_id: "restaurant",    // From AI (Step 3.4)
  ai_confidence: "high",        // high | medium | low
  _rawDescription: "REST LA CHOZA", // Original bank description (shown as reference)
  
  // Defaults
  currency: "USD",
  fx_rate: 1,
  original_amount: 63.67,       // Same as amount_usd since we're using Chase's converted amount
  service_start: "2026-02-23",  // = date
  service_end: "2026-02-23",    // Computed from ACCRUAL_D after category assigned
  payment_type: "Chase Sapphire", // From upload-time dropdown
  tag: "",                       // From bulk tag input, or empty
  credit: "",
  
  // Import metadata
  _status: "pending",           // pending | approved | skipped | duplicate
  _isDuplicate: false,          // From dupe detection
  _bankCategory: "Food & Drink", // Chase's original category (shown as hint)
  _rowIndex: 0
}
```

**Service period computation** — apply after category is assigned:
```javascript
function computeServiceEnd(categoryId, dateStr) {
  const rule = ACCRUAL_D[categoryId];
  if (!rule) return dateStr;  // same-day default
  if (rule === "month") return endOfMonth(dateStr);
  return addDays(dateStr, rule);  // e.g., groceries: +7 days
}
```

### 3.4 AI Category Matching (Claude API)

**Pre-fetch merchant patterns** from Supabase at import time:

```javascript
// Query: aggregate historical categorizations by first description word
// This runs once per import session
async function fetchMerchantPatterns() {
  const txns = await sbPaginated("transactions", "select=description,category_id");
  const patterns = {};
  for (const t of txns) {
    // Extract first 1-2 meaningful words as merchant key
    const key = normalizeMerchant(t.description);
    if (!patterns[key]) patterns[key] = {};
    patterns[key][t.category_id] = (patterns[key][t.category_id] || 0) + 1;
  }
  return patterns;
}

function normalizeMerchant(desc) {
  // Strip common prefixes: "SQ *", "TST*", "CLIP MX*", etc.
  // Lowercase, take first 2 tokens
  return desc.replace(/^(SQ \*|TST\*|CLIP MX\*|TCB\*)/i, "")
             .trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ");
}
```

**Claude API batch call:**

```javascript
async function aiCategorize(candidates, merchantPatterns, sampleDescriptions) {
  const apiKey = getApiKey();
  if (!apiKey) return null; // No key → caller uses CHASE_CAT_MAP fallback
  
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: buildCategorizationPrompt(candidates, merchantPatterns, sampleDescriptions)
        }]
      })
    });
    
    if (response.status === 401) {
      clearApiKey(); // Bad key — clear so user is prompted to re-enter
      throw new Error("Invalid API key");
    }
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    return parseAIResponse(data);
  } catch (e) {
    console.error("AI categorization failed:", e);
    return null; // Fallback to CHASE_CAT_MAP
  }
}

// localStorage helpers for API key persistence
function getApiKey() { return localStorage.getItem('anthropic_api_key'); }
function setApiKey(key) { localStorage.setItem('anthropic_api_key', key); }
function clearApiKey() { localStorage.removeItem('anthropic_api_key'); }
```

**Prompt design:**

```
You are a personal finance assistant that categorizes AND cleans up transaction descriptions for a detailed expense tracker.

CATEGORY TAXONOMY (use exact IDs):
- entertainment: Entertainment (concerts, movies, events, activities, hotels/accommodation)
- food: Food - use only when not clearly groceries or restaurant
- groceries: Groceries (grocery stores, supermarkets)
- restaurant: Restaurant (dining out, bars, cafes, food delivery)
- home: Home - general household
- rent: Rent
- furniture: Furniture (furnishings, home goods)
- health: Health (pharmacy, medical, fitness, wellness)
- personal: Personal - general personal items
- clothes: Clothes (apparel, shoes)
- tech: Tech (electronics, software, subscriptions, apps)
- transportation: Transportation (flights, trains, rideshare, gas, tolls, parking)
- utilities: Utilities (phone, internet, laundry)
- financial: Financial (fees, interest)
- other: Other (gifts, misc)
- income: Income (refunds, reimbursements, credits — ONLY if amount is negative/credit)

DESCRIPTION STYLE GUIDE:
The user writes clean, human-readable descriptions. Study these real examples to learn the style:
- "Restaurant - La Choza" (not "REST LA CHOZA")
- "Groceries - Whole Foods" (not "WHOLE FOODS MARKET #123")  
- "Walgreens" (not "WALGREENS #16373")
- "Waymo" (not "WAYMO")
- "United Flights - SFO-CZM" (not "UNITED 0162374132542")
- "Amazon - [item description]" (not "AMAZON MKTPL*UY16L7LN3")
- "Claude AI Subscription (Feb 2026)" (not "CLAUDE.AI SUBSCRIPTION")
- "MTA Meter Parking" (not "TCB*MTA METER MTA P")
- "Groceries - Gus's Community Market" (not "GUS'S COMMUNITY MARKET")
- "Groceries - Jagalchi" (not "JAGALCHI")
- "Restaurant - Money Bar" (not "MONEY BAR")
- "Restaurant - Morella" (not "MORELLA")

Key patterns:
- Prefix with "Restaurant - " for dining. Prefix with "Groceries - " for grocery stores.
- Prefix with "Flight - " or "United Flights - " for airline charges, include route if identifiable.
- Prefix with "Amazon - " for Amazon purchases; add context from description if possible.
- For subscriptions, include the month/year: "Claude AI Subscription (Feb 2026)"
- Strip store numbers, transaction codes, prefixes like "SQ *", "TST*", "CLIP MX*", "TCB*"
- Use Title Case for merchant names
- Keep it concise but descriptive — the user should be able to remember what this was

HISTORICAL MERCHANT PATTERNS (merchant → {category: count}):
{merchantPatternsJSON}

SAMPLE OF USER'S EXISTING DESCRIPTIONS (for style reference):
{sampleDescriptionsJSON — ~50 recent unique descriptions}

TRANSACTIONS TO CATEGORIZE AND CLEAN:
{candidatesJSON — array of {index, description, amount, bankCategory}}

For each transaction, return a JSON array of objects:
[{"i": <index>, "cat": "<category_id>", "conf": "high|medium|low", "desc": "<cleaned description>"}]

Rules:
- "desc" must be a clean, human-readable description matching the style guide above
- Use historical patterns when available and clear (one dominant category >70%)
- Use bank category as a secondary signal but don't trust it blindly
- "Shopping" from Chase is ambiguous — look at the merchant name and amount
- Subscriptions (CLAUDE.AI, software) → tech
- Amazon → personal unless description suggests otherwise
- Negative amounts (credits/refunds) that clearly offset an expense → same category as the expense, NOT income
- Positive amounts that are clearly income (paycheck, reimbursement) → income
- confidence: high = historical match or obvious merchant, medium = reasonable guess from bank category + description, low = ambiguous

Return ONLY the JSON array, no other text.
```

**Feeding the style context:** At import time, alongside the merchant patterns query, also fetch ~50 recent unique descriptions to include as style examples:

```javascript
async function fetchSampleDescriptions() {
  const recent = await sb(
    "transactions?select=description&order=id.desc&limit=200"
  );
  // Deduplicate and take 50 diverse examples
  const unique = [...new Set(recent.map(r => r.description))].slice(0, 50);
  return unique;
}
```

This gives the AI concrete examples of how the user writes, so it can mimic the style for new merchants it hasn't seen before.

**Fallback:** If the AI call fails (rate limit, network), fall back to a static mapping:
```javascript
const CHASE_CAT_MAP = {
  "Food & Drink": "restaurant",
  "Groceries": "groceries", 
  "Travel": "transportation",
  "Entertainment": "entertainment",
  "Shopping": "personal",      // safe default
  "Bills & Utilities": "utilities",
  "Health & Wellness": "health",
  "Home": "home",
  "Gas": "transportation",
  "Personal": "personal"
};
```

### 3.5 Duplicate Detection

**Query existing transactions** within the date range of the CSV:

```javascript
async function findDuplicates(candidates, paymentType) {
  const minDate = min(candidates.map(c => c.date));
  const maxDate = max(candidates.map(c => c.date));
  
  const existing = await sb(
    `transactions?payment_type=eq.${encodeURIComponent(paymentType)}` +
    `&date=gte.${minDate}&date=lte.${maxDate}` +
    `&select=date,amount_usd,description`
  );
  
  // Match: same date + same absolute amount (within $0.01) + same payment type
  for (const candidate of candidates) {
    candidate._isDuplicate = existing.some(e => 
      e.date === candidate.date && 
      Math.abs(Math.abs(e.amount_usd) - candidate.amount_usd) < 0.02
    );
    if (candidate._isDuplicate) candidate._status = "skipped";
  }
}
```

### 3.6 Review Table UI

**Table columns:**

| Status | Date | Description | Amount | Category | Service Period | Tag | Bank Cat |
|--------|------|-------------|--------|----------|---------------|-----|----------|

- **Status column**: Icon buttons — ✓ (approved, green), ✕ (skipped, red), ⚠ (duplicate, yellow). Click to toggle.
- **Description column**: Shows the AI-cleaned description (editable inline). The original raw bank description (e.g., "REST LA CHOZA") shown as a muted subtitle or tooltip beneath/beside the cleaned version, so the user can verify the AI's interpretation.
- **Category column**: Shows AI-assigned category with a colored confidence dot (green/yellow/red). The category name is a dropdown so you can change it inline without opening the modal.
- **Service Period**: Shows computed start–end. Read-only in table; editable in modal.
- **Bank Cat**: Chase's original category in muted text as a reference hint.
- **Tag**: Shows bulk tag if set; editable inline.
- **Row click** (anywhere except status/category/description): Opens **edit modal** with full Entry-form-style fields (same layout as existing manual entry: date, description, category, amount, currency, service start/end with accrual preview, payment type, tag). The edit modal shows both the cleaned description (editable) and the raw bank description (read-only reference).

**Bulk actions bar** (above table):
- `[✓ Approve All High-Confidence]` — sets all `high` confidence rows to approved
- `[✓ Approve All]` — approves everything not marked duplicate
- `[Tag Selected: ___]` — applies a tag to checked rows
- `[Clear All]` — resets to pending

**Row styling:**
- Approved rows: subtle green left border
- Skipped rows: dimmed/muted, strikethrough description
- Duplicate rows: yellow left border, dimmed
- Pending rows: default styling

**Summary stats** (shown above table):
- "40 transactions parsed · 1 payment (auto-skipped) · 3 potential duplicates · 28 high confidence · 8 medium · 3 low"

### 3.7 Edit Modal

Reuse the existing Entry form layout and fields. Pre-populate from the candidate object. Changes update the candidate in-memory (not yet saved to Supabase). On save within modal:
- Update the candidate object
- Mark as approved
- Recompute service_end if category changed (apply ACCRUAL_D)
- Close modal, return to table

### 3.8 Commit to Supabase

**On "Save Approved" button click:**

```javascript
async function commitImport(candidates) {
  const approved = candidates.filter(c => c._status === "approved");
  if (!approved.length) return;
  
  // Build Supabase transaction objects
  const rows = approved.map(c => ({
    date: c.date,
    service_start: c.service_start,
    service_end: c.service_end,
    description: c.description,
    category_id: c.category_id,
    original_amount: c.original_amount,
    currency: c.currency,
    fx_rate: c.fx_rate,
    amount_usd: Math.round(c.amount_usd * 100) / 100,
    payment_type: c.payment_type,
    tag: c.tag.toLowerCase().trim(),
    daily_cost: computeDailyCost(c),
    service_days: computeServiceDays(c),
    credit: c.credit || ""
  }));
  
  // Batch POST (Supabase supports array insert)
  await sb("transactions", {
    method: "POST",
    body: JSON.stringify(rows)
  });
  
  // Update txn count in state
  state.txnCount += rows.length;
  
  // Show success summary
  showImportSummary(approved.length, candidates.length);
}
```

**Success summary card:**
> "✓ Imported 28 transactions · 8 skipped · 4 duplicates"
> With a "View in Ledger" link that switches to the Ledger tab filtered to the import date range.

---

## 4. Data Flow Diagram

```
CSV File
  │
  ▼
[Parse] ──→ Raw rows (bank-native format)
  │
  ▼
[Bank Profile] ──→ Column mapping + amount transform
  │
  ▼
[Transform] ──→ Candidate transactions (Disciplan schema)
  │
  ├──→ [Fetch Merchant Patterns from Supabase]
  │         │
  │         ▼
  ├──→ [Claude API Batch Call] ──→ AI categories + confidence
  │
  ├──→ [Duplicate Detection Query] ──→ Flag matches
  │
  ▼
[Review Table] ◄──► [Edit Modal]
  │
  ▼
[Commit] ──→ POST to Supabase transactions table
```

---

## 5. Edge Cases & Error Handling

| Case | Handling |
|------|----------|
| Empty file or wrong format | Show error: "Couldn't detect bank format. Expected headers: ..." |
| AI API fails | Fall back to static `CHASE_CAT_MAP`. Show banner: "AI unavailable — using default categories" |
| AI returns malformed JSON | Parse what we can, fall back to static mapping for failed rows |
| Duplicate detection finds 100% matches | Show warning: "All transactions appear to already exist" |
| CSV has > 200 rows | Paginate the review table (50 per page) |
| User closes tab mid-review | State is lost (no persistence). Acceptable for v1. |
| Return/refund rows (negative amounts from Chase = positive after flip) | These become negative in Disciplan (credits). Detect via Chase `Type=Return` or original negative amount. Store as negative `amount_usd`. |
| Payment rows (Type=Payment) | Pre-marked as "skipped" with visual indicator "CC Payment" |

---

## 6. Files to Modify

| File | Changes |
|------|---------|
| `index.html` | Add Import sub-section in Entry tab. New functions: `renderImport()`, `parseCSV()`, `detectBankProfile()`, `aiCategorize()`, `findDuplicates()`, `renderReviewTable()`, `openImportEditModal()`, `commitImport()`. Add `BANK_PROFILES` and `CHASE_CAT_MAP` to constants section. |

No new files, no new Supabase tables. Everything lives in the single `index.html` and writes to the existing `transactions` table.

---

## 7. Testing Checklist

- [ ] Upload Chase CSV → headers detected, 40 rows parsed
- [ ] Payment row (Type=Payment) shows as pre-skipped
- [ ] AI categorization returns results for all rows
- [ ] AI fallback works when API key missing or call fails  
- [ ] **Category tests:**
  - [ ] "CLAUDE.AI SUBSCRIPTION" → tech
  - [ ] "REST LA CHOZA" → restaurant
  - [ ] "SORIANA970 COZUMEL" → groceries
  - [ ] "UNITED 0162374132542" → transportation
  - [ ] "PARALLEL MOUNTIAN SPOR" → entertainment or clothes (sports store)
- [ ] **Description normalization tests:**
  - [ ] "REST LA CHOZA" → "Restaurant - La Choza"
  - [ ] "CLAUDE.AI SUBSCRIPTION" → "Claude AI Subscription (Feb 2026)"
  - [ ] "SORIANA970 COZUMEL" → "Groceries - Soriana Cozumel"
  - [ ] "GUS'S COMMUNITY MARKET" → "Groceries - Gus's Community Market"
  - [ ] "UNITED      0162374132542" → "United Flights - SFO-CZM" or similar
  - [ ] "TCB*MTA METER MTA P" → "MTA Meter Parking"
  - [ ] "AMAZON MKTPL*UY16L7LN3" → "Amazon" (with category-specific prefix if identifiable)
  - [ ] "SQ *ALICE?S MOUNTAIN MARK" → "Alice's Mountain Market"
  - [ ] "WAYMO" → "Waymo"
  - [ ] "WALGREENS #16373" → "Walgreens"
  - [ ] "MONEY BAR" → "Restaurant - Money Bar"
  - [ ] Raw description visible as subtitle/tooltip in review table
  - [ ] Description editable inline and in modal
- [ ] Duplicate detection flags rows already in Supabase
- [ ] Inline category dropdown updates service_end via ACCRUAL_D
- [ ] Edit modal pre-populates correctly and saves back to candidate
- [ ] "Approve All High Confidence" button works
- [ ] Batch commit POSTs correct data to Supabase
- [ ] Success summary shows accurate counts
- [ ] Mobile responsive (table scrolls horizontally, modal stacks vertically)

---

## 8. Future Enhancements (Out of Scope for v1)

- AMEX, Schwab, Capital One bank profiles
- `category_overrides` table for deterministic merchant → category rules
- Persistent import queue (resume interrupted imports)
- Automatic tag suggestion based on date ranges matching existing tags
- Receipt image attachment per transaction
