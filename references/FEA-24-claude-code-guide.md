# FEA-24: CSV Import — Claude Code Step-by-Step Guide

## Before You Start

1. Copy `FEA-24-csv-import-spec.md` into your repo root
2. Put the sample CSV at `data/Chase7483_Activity20260227.CSV`
3. Make sure you're on latest `main` in your repo
4. Open Claude Code from the repo root

---

## Step 1: Load Context

**Prompt to Claude Code:**

```
Read these files to understand the project:
- CLAUDE.md (project rules and architecture)
- FEA-24-csv-import-spec.md (the feature spec we're implementing)
- data/Chase7483_Activity20260227.CSV (sample Chase CSV, 40 rows)
- index.html (the entire app — focus on the CONSTANTS section lines 134-148, the renderEntry function lines 218-305, and the sb/authHeaders helpers lines 118-132)

Confirm you understand:
1. The existing Entry tab structure (renderEntry at line 218)
2. The constants: CATS_LIST, PTS, ACCRUAL_D, CC, DFX, CURS
3. The h() DOM helper pattern
4. The sb() function for Supabase calls with authHeaders()
5. The Chase CSV column format

Don't make changes yet.
```

---

## Step 2: Add Constants + CSV Parser

**Prompt to Claude Code:**

```
Step 2 of FEA-24. Add the CSV import infrastructure to index.html. Make these changes:

A) After the ACCRUAL_D constant (line ~147), add these new constants:

1. BANK_PROFILES — object with a 'chase' key containing:
   - detect(headers): returns true if headers include "Transaction Date", "Post Date", and "Memo"
   - columns: { date: "Transaction Date", description: "Description", amount: "Amount", bankCategory: "Category", type: "Type" }
   - transformAmount(amt): returns -amt (Chase uses negative for expenses)
   - skipTypes: ["Payment"]
   - currency: "USD"

2. CHASE_CAT_MAP — fallback mapping from Chase categories to Disciplan IDs:
   "Food & Drink" → "restaurant", "Groceries" → "groceries", "Travel" → "transportation",
   "Entertainment" → "entertainment", "Shopping" → "personal", "Bills & Utilities" → "utilities",
   "Health & Wellness" → "health", "Home" → "home", "Gas" → "transportation", "Personal" → "personal"

B) Add a parseCSV(text) function that:
   - Handles quoted fields (descriptions can contain commas)
   - Returns { headers: string[], rows: object[] } where each row is keyed by header name
   - Strips BOM if present
   - Skips empty rows

C) Add a detectBankProfile(headers) function that iterates BANK_PROFILES and returns the first matching profile, or null.

Keep it minimal. Don't touch renderEntry yet.
```

---

## Step 3: API Key Management + Merchant Pattern Fetcher + AI Categorization

**Prompt to Claude Code:**

```
Step 3 of FEA-24. Add API key management and AI categorization functions to index.html (after the new constants from Step 2, before renderEntry).

A) Add API key helper functions:

   function getApiKey() — returns localStorage.getItem('anthropic_api_key') or null
   
   function setApiKey(key) — localStorage.setItem('anthropic_api_key', key)
   
   function clearApiKey() — localStorage.removeItem('anthropic_api_key')

B) Add fetchMerchantPatterns() — async function that:
   - Fetches all transactions from Supabase (paginated, only description + category_id columns)
   - Builds a dictionary keyed by normalized merchant name (strip prefixes like "SQ *", "TST*", "CLIP MX*", "TCB*", lowercase, first 2 tokens)
   - Values are {category_id: count} objects
   - Returns the dictionary

C) Add fetchSampleDescriptions() — async function that:
   - Fetches the 200 most recent transactions (select=description, order=id.desc, limit=200)
   - Deduplicates and returns 50 unique description strings as a JSON array

D) Add aiCategorize(candidates, merchantPatterns, sampleDescriptions) — async function that:
   - First checks for API key via getApiKey(). If no key, return null immediately (caller will use fallback).
   - Calls the Anthropic API at https://api.anthropic.com/v1/messages
   - Uses model "claude-sonnet-4-20250514", max_tokens 4000
   - Headers must include:
     "x-api-key": getApiKey(),
     "anthropic-version": "2023-06-01",
     "Content-Type": "application/json",
     "anthropic-dangerous-direct-browser-access": "true"
   - Sends a single batch prompt with all candidates (see the full prompt in references/FEA-24-csv-import-spec.md section 3.4)
   - The prompt must include:
     * Category taxonomy with IDs
     * Description style guide with before/after examples (REST LA CHOZA → Restaurant - La Choza, etc.)
     * The merchantPatterns dictionary
     * The sampleDescriptions array
     * The candidates as JSON array of {index, description, amount, bankCategory}
   - Parses the response JSON array of {i, cat, conf, desc}
   - Returns the parsed array
   - On failure (network error, 401 auth error, malformed response): log the error and return null (caller will use CHASE_CAT_MAP fallback)
   - If 401 error specifically: call clearApiKey() so user is prompted to re-enter on next attempt

Don't touch renderEntry yet.
```

---

## Step 4: Duplicate Detection + Transform Pipeline

**Prompt to Claude Code:**

```
Step 4 of FEA-24. Add the transform and duplicate detection functions.

A) Add transformCSVRow(row, bankProfile, paymentType, bulkTag) — function that:
   - Takes a raw parsed CSV row, the bank profile, selected payment type, and optional bulk tag
   - Returns a candidate transaction object:
     {
       date: YYYY-MM-DD format (converted from MM/DD/YYYY),
       description: row.Description (raw — will be overwritten by AI later),
       amount_usd: bankProfile.transformAmount(parseFloat(row.Amount)),
       category_id: null (filled by AI later),
       ai_confidence: null,
       currency: "USD",
       fx_rate: 1,
       original_amount: same as amount_usd,
       service_start: same as date,
       service_end: same as date (recomputed after category assigned),
       payment_type: paymentType,
       tag: bulkTag || "",
       credit: "",
       _status: bankProfile.skipTypes.includes(row.Type) ? "skipped" : "pending",
       _isDuplicate: false,
       _rawDescription: row.Description,
       _bankCategory: row.Category || "",
       _rowIndex: index,
       _skipReason: bankProfile.skipTypes.includes(row.Type) ? "CC Payment" : null
     }
   - For Return type rows: make amount_usd negative (it's a refund/credit)

B) Add findDuplicates(candidates, paymentType) — async function that:
   - Finds min/max dates from candidates
   - Queries Supabase: transactions where payment_type = paymentType AND date between min-max
   - For each candidate, checks if any existing txn matches: same date + abs(amount_usd) within $0.02
   - Sets _isDuplicate = true and _status = "skipped" for matches

C) Add applyAIResults(candidates, aiResults) — function that:
   - If aiResults is null (AI failed), use CHASE_CAT_MAP fallback for each candidate
   - Otherwise, merge AI results into candidates: set category_id, ai_confidence, description (cleaned)
   - After category is set, recompute service_end using getDefEnd(category_id, date)
   - Recompute service_days and daily_cost

D) Add propagateEdits(candidates, editedIndex) — function that:
   - When a candidate is edited, find other candidates with the same normalized merchant token
   - Auto-update their description and category_id to match the edit
   - Only update candidates that are still "pending" (don't overwrite already-approved ones)
   - This is the within-session learning feature
```

---

## Step 5: Import UI — Upload Bar + Review Table

**Prompt to Claude Code:**

```
Step 5 of FEA-24. This is the big one — add the Import CSV UI to the Entry tab.

Modify renderEntry(el) to add a collapsible "Import CSV" section BELOW the existing manual entry form. The existing form must remain unchanged.

After line 304 (el.append(card)) and before the closing brace of renderEntry, add:

A) Import section header — a collapsible card:
   - Title: "📥 Import CSV" with a toggle arrow (▸/▾), collapsed by default
   - When expanded, shows the upload bar and (later) the review table

B) Upload bar (inside the collapsible):
   - Row 1: [File input (.csv)] [Payment Type dropdown (PTS array, default Chase Sapphire)]
   - Row 2: [Tag input (optional, placeholder "Bulk tag for all rows")] [API Key input]
   - Row 3: [Import button]
   - The API Key input:
     * Label: "Anthropic API Key"
     * type="password" so the key is masked
     * On load, pre-fill from getApiKey() if it exists in localStorage
     * Placeholder: "sk-ant-..." 
     * Small help text below: "Get one at console.anthropic.com · Stored locally in your browser"
     * When Import is clicked and key field has a value, call setApiKey(value) to persist it
     * If no key entered, show a confirm dialog: "No API key set. Import with basic category mapping (no AI description cleanup)?" — if they confirm, proceed with CHASE_CAT_MAP fallback
   - Use the same row() and field() helpers as the manual entry form
   - Import button style: same as Add Transaction but with blue/import color

C) On Import button click, run the full pipeline:
   1. Parse CSV with parseCSV()
   2. Detect bank profile with detectBankProfile()
   3. If no profile detected, show error
   4. Transform all rows with transformCSVRow()
   5. Show status: "AI categorizing..." 
   6. Fetch merchant patterns + sample descriptions in parallel
   7. Call aiCategorize() 
   8. Apply AI results with applyAIResults()
   9. Run findDuplicates()
   10. Render the review table

D) Review table — render inside the import card:
   - Summary stats bar: "X parsed · Y auto-skipped · Z duplicates · A high / B medium / C low confidence"
   - Bulk action buttons: [✓ Approve All High-Confidence] [✓ Approve All] [Save Approved]
   - Table with columns: Status | Date | Description | Amount | Category | Svc Period | Tag | Bank Cat
   - Status column: clickable icon that cycles pending→approved→skipped (use ○ / ✓ / ✕)
   - Description column: shows AI-cleaned description as primary text, raw bank description as muted subtitle below
   - Category column: inline <select> dropdown (CATS_LIST), with a small colored confidence dot (green/yellow/red) before it
   - Svc Period: shows date range, read-only in table
   - Tag: inline text input
   - Bank Cat: muted text showing Chase's original category
   - Row click (on description or date cells): opens edit modal
   - Row styling: approved = green left border, skipped = dimmed + strikethrough, duplicate = yellow left border

E) Bulk action handlers:
   - "Approve All High-Confidence": set _status="approved" for all candidates with ai_confidence="high" and _status="pending"
   - "Approve All": set _status="approved" for all _status="pending" (not skipped/duplicate)
   - "Save Approved": calls commitImport()

F) When user changes category via inline dropdown:
   - Update candidate's category_id
   - Recompute service_end via getDefEnd()
   - Call propagateEdits() to update same-merchant rows
   - Re-render affected table rows

Match the existing Disciplan dark theme exactly: same .cd card styling, same table patterns (striped rows, .m mono class for numbers, .r right-align), same .inp and .btn classes, hide-m for optional columns on mobile.
```

---

## Step 6: Edit Modal

**Prompt to Claude Code:**

```
Step 6 of FEA-24. Add the edit modal for individual transaction review.

When a user clicks a row in the import review table (on description or date cells), open a modal with:

A) Modal structure:
   - Use the existing .modal-bg and .modal CSS classes
   - Title: "Edit Transaction" with the raw bank description as subtitle
   - Close button (X) in top-right corner

B) Form fields (same layout as the manual entry form):
   - Date (pre-filled from candidate)
   - Description (pre-filled with AI-cleaned description, editable)
   - Raw description shown as read-only reference text below the input
   - Category dropdown (CATS_LIST, pre-selected with candidate's category_id)
   - Amount (pre-filled, editable)
   - Service Start / Service End (with accrual hint, same as manual entry)
   - Payment Type dropdown (pre-filled)
   - Tag input (pre-filled)
   - Accrual preview (same as manual entry, updates live as fields change)

C) Action buttons:
   - "Save & Approve" — updates the candidate object, sets _status="approved", calls propagateEdits(), closes modal, re-renders table row
   - "Skip" — sets _status="skipped", closes modal
   - "Cancel" — closes modal without changes

Reuse the exact same form styling patterns from renderEntry (row(), field(), updatePreview pattern, etc.)
```

---

## Step 7: Commit to Supabase

**Prompt to Claude Code:**

```
Step 7 of FEA-24. Add the commitImport function.

When user clicks "Save Approved":

A) commitImport(candidates) function:
   - Filter to _status === "approved" only
   - If none, show alert "No transactions approved"
   - Build array of Supabase transaction objects matching the exact schema used in the manual entry submit handler (line ~283):
     { date, service_start, service_end, description, category_id, original_amount, currency, fx_rate, amount_usd (rounded to 2 decimals), payment_type, tag (lowercased, trimmed), daily_cost, service_days, credit: "" }
   - POST to Supabase as a batch (sb("transactions", {method:"POST", body:JSON.stringify(rows)}))
   - Update state.txnCount
   - Show success summary: "✓ Imported X transactions · Y skipped · Z duplicates"
   - Add a "View in Ledger" button that switches to ledger tab with date filters set to the import date range
   - Disable the Save button after successful commit to prevent double-submit

B) Error handling:
   - If POST fails, show error message and don't clear the review table
   - Log the full error for debugging
```

---

## Step 8: Test with Sample CSV

**Prompt to Claude Code:**

```
Step 8 of FEA-24. Let's test the implementation.

1. Open disciplan.netlify.app (or serve locally), go to Entry tab
2. Expand the Import CSV section
3. Upload data/Chase7483_Activity20260227.CSV
4. Set payment type to "Chase Sapphire" 
5. Click Import

Verify:
- [ ] All 40 rows are parsed
- [ ] Bank profile "chase" is detected
- [ ] AI categorization runs (or fallback works)
- [ ] Summary stats show correct counts
- [ ] Payment rows (if any) show as pre-skipped
- [ ] Description normalization looks right (e.g., "REST LA CHOZA" → "Restaurant - La Choza")
- [ ] Category assignments make sense
- [ ] Confidence dots show green/yellow/red appropriately
- [ ] Inline category dropdown works and triggers propagateEdits
- [ ] Edit modal opens and pre-populates correctly
- [ ] "Approve All High-Confidence" button works
- [ ] "Save Approved" commits to Supabase
- [ ] Mobile responsive (table scrolls horizontally)

If the AI call fails (which it might if the artifact API isn't available in the local test), verify the CHASE_CAT_MAP fallback works correctly. The descriptions would stay as raw bank text in that case — that's acceptable for fallback mode.

Fix any bugs you find. Don't git push yet — we'll batch the deploy.
```

---

## Step 9: Polish + Roadmap Update

**Prompt to Claude Code:**

```
Step 9. Final polish for FEA-24.

1. Review the entire import flow for edge cases:
   - What happens with an empty CSV?
   - What about a non-Chase CSV (should show "Unrecognized format" error)?
   - What if all rows are duplicates?
   
2. Make sure mobile works:
   - Bank Cat column should have class "hide-m"
   - Svc Period column should have class "hide-m"  
   - Table should scroll horizontally in its container
   - Modal should not overflow the viewport

3. Update disciplan-roadmap.md:
   - Move FEA-24 from Future to Completed section
   - Add completion date and description summary

4. Do a final review of the code — any obvious cleanup needed?

Don't git push yet.
```

---

## Step 10: Deploy

**Prompt to Claude Code:**

```
All FEA-24 work is done. Commit everything and push to deploy.

git add -A
git commit -m "FEA-24: CSV Transaction Import with AI categorization

- Collapsible Import CSV section in Entry tab
- Chase bank profile auto-detection from CSV headers
- Claude API batch categorization with historical merchant patterns
- AI-powered description normalization to match existing ledger style
- Within-session learning: edits propagate to same-merchant rows
- Review table with inline category editing, confidence indicators
- Edit modal with full entry form fields and accrual preview
- Duplicate detection (date + amount + payment type)
- Batch commit to Supabase
- Fallback to static category mapping if AI unavailable
- Mobile responsive"

git push origin main
```

---

## Notes for Troubleshooting

**If Claude Code's context gets too large** after reading the full index.html: Start a fresh session and tell it to focus only on the import-related code. The spec file is self-contained enough.

**If the AI categorization call doesn't work** from the deployed site: The API key is stored in localStorage and sent via `x-api-key` header with `anthropic-dangerous-direct-browser-access: true`. If you get CORS errors, make sure the header is included. If you get 401 errors, the key is invalid — the app will auto-clear it from localStorage and prompt for re-entry on next import. You can also manually clear it from browser DevTools: `localStorage.removeItem('anthropic_api_key')`.

**If Claude Code tries to split into multiple files**: Remind it this is a single-file app per CLAUDE.md rules. Everything goes in index.html.

**If a single step is too large for Claude Code**: The biggest step is Step 5 (review table UI). If Claude Code struggles, split it into 5a (upload bar + pipeline trigger) and 5b (review table rendering).
