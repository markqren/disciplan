# FEA-45: Payslip Import — Implementation Spec

**Feature ID:** FEA-45  
**Priority:** High  
**Depends on:** FEA-24 (CSV Import infrastructure), existing Entry tab  
**Scope:** Parse Pinterest payslip PDFs (or CSV exports), generate Disciplan transactions matching Mark's existing income recording style

---

## 1. Overview

Add a "Payslip Import" sub-section to the Entry tab (collapsible, below Email Imports). The user uploads one or more Pinterest payslip PDFs. The system extracts pay period data from each page, computes the standard transaction set per Mark's historical patterns, and presents them in a review table for approval before committing to Supabase.

---

## 2. Transaction Mapping Rules

Each payslip page generates **up to 5 transactions**. The formulas below were reverse-engineered from Mark's existing `disciplan_income_sample.csv` and verified against 6 payslip pages.

### 2.1 Regular Pay Period (salary paycheck)

For each payslip page where `Gross Pay > 0` and the earnings do NOT consist solely of RSU Gain:

#### Transaction 1: Pinterest Income
- **Description:** `Pinterest Income`
- **Category:** `income`
- **Amount:** `-(Earnings Total)` — NEGATIVE (income flowing in)
- **Earnings Total** = sum of all Current Earnings line items. Specifically: `Regular Salary Pay + Connectivity Reimbursement + GTL + Wellness Reimbursement + Home Office Setup Stipend + Sign on Bonus` (only items with nonzero Current amounts)
- **Payment Type:** `Chase Chequing`
- **Service Period:** Pay Period Begin → Pay Period End

#### Transaction 2: Income Taxes and Social Security
- **Description:** `Income Taxes and Social Security`
- **Category:** `income`
- **Amount:** `Employee Taxes Total` — POSITIVE (deduction from income)
- **Employee Taxes Total** = `Social Security + Medicare + Federal Withholding + State Tax - CA + CA VDI - CAVDI`
- **Payment Type:** `Chase Chequing`
- **Service Period:** Pay Period Begin → Pay Period End

#### Transaction 3: Medical Insurance Benefits
- **Description:** `Medical Insurance Benefits`
- **Category:** `health`
- **Amount:** `Pre Tax Deductions Total + (Post Tax Deductions Total - 401k Deferral) + GTL` — POSITIVE
- **Breakdown:**
  - Pre Tax Deductions = `Dental + Flex Spending Health + Medical + Vision`
  - Post Tax non-401k = `Critical Illness-Employee` (and any other post-tax items EXCLUDING "401(k) After-tax Deferral")
  - GTL = Group Term Life (from Earnings section, `$12.30`)
- **Formula verified:** `148.00 + 4.54 + 12.30 = $164.84` ✓
- **Payment Type:** `Chase Chequing`
- **Service Period:** Pay Period Begin → Pay Period End

#### Transaction 4: 401K (only if 401k deferral exists)
- **Description:** `401K`
- **Category:** `financial`
- **Amount:** `401(k) After-tax Deferral` — POSITIVE (money leaving Chase)
- **Payment Type:** `Chase Chequing`
- **Service Period:** Pay Period Begin → Pay Period End

#### Transaction 5: Vanguard Deposited 401K (only if 401k deferral exists)
- **Description:** `Vanguard Deposited 401K`
- **Category:** `financial`
- **Amount:** `-(401(k) After-tax Deferral)` — NEGATIVE (money arriving at Vanguard)
- **Payment Type:** `Vanguard`
- **Service Period:** Pay Period Begin → Pay Period End

### 2.2 RSU Vesting Period

For payslip pages where the earnings consist solely/primarily of "RSU Gain" (detect via `RSU Gain` in earnings descriptions AND `RSU Gain Offset` in post-tax deductions):

#### Transaction 1: Pinterest Stock Units Vested
- **Description:** `Pinterest Stock Units Vested (Q{quarter} {year})`
- **Category:** `income`
- **Amount:** `-(RSU Gain amount)` — NEGATIVE
- **Payment Type:** `Charles Schwab`
- **Service Period:** Quarterly vesting window. Derive from vest date:
  - Q1 vest → `1/1/YYYY` to `3/31/YYYY`
  - Q2 vest → `4/1/YYYY` to `6/30/YYYY`  
  - Q3 vest → `7/1/YYYY` to `9/30/YYYY`
  - Q4 vest → `10/1/YYYY` to `12/31/YYYY`
  - **Exception for first year:** If this is the first year (2025), use hire start date approximation. The sample shows `9/8/25` to `12/31/25` for a 12/23 vest — which is the start of employment to end of quarter. For subsequent years, use standard quarterly windows. **Let the user edit the service_start in the review table.**

#### Transaction 2: Income Taxes and Social Security (RSU)
- **Description:** `Income Taxes and Social Security`
- **Category:** `income`
- **Amount:** `Employee Taxes Total` — POSITIVE
- **Payment Type:** `Charles Schwab`
- **Service Period:** Same as the RSU vesting period above

**NOT generated:** RSU Gain Offset (shares sold to cover taxes) — this is an internal Schwab operation, not recorded as a Disciplan transaction.

### 2.3 Skip Rules

- **Skip pages where Gross Pay = $0.00 and all Current amounts are $0.** These are YTD summary stubs (e.g., the 12/16-12/31 page that rolls up RSU + salary YTD).
- **Skip "Payment" type rows** in earnings (like CC payments in Chase CSVs).

### 2.4 Validation Checksums

For each regular pay period, verify:
```
Net Pay = Earnings Total - Employee Taxes - Pre Tax Deductions - Post Tax Deductions
```
If this doesn't balance within $0.02, flag a warning on the review table.

---

## 3. PDF Parsing

### 3.1 Approach

Use `pdf.js` (Mozilla's PDF parser, available via CDN) to extract text from each page. The payslip PDF has a consistent tabular format that can be parsed with regex patterns.

**CDN:** `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs`  
**Worker:** `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs`

### 3.2 Text Extraction Strategy

Each PDF page is one payslip. Extract text content, then parse using these key patterns:

```javascript
// Pay period dates
/Pay Period Begin\s+Pay Period End\s+Check Date[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/

// Gross Pay (to detect skip pages)
/Gross Pay[\s\S]*?Current\s+[\d.]+\s+([\d,.]+)/

// Or from the summary line:
/Current\s+\d+\.\d+\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/
// Groups: hours, gross_pay, pre_tax, employee_taxes, post_tax, net_pay

// Earnings section — parse each line:
// "Regular Salary Pay10/16/2025 - 10/31/2025 0 230000 9,583.34 0 33,977.30"
// "Connectivity Reimbursement 11/01/2025 - 11/15/2025 0 0 130.00 0 260.00"
// "GTL 10/16/2025 - 10/31/2025 0 0 12.30 0 49.20"
// Key: line starts with description, has Amount and YTD Amount columns

// Employee Taxes section:
// "Social Security 585.76 2,762.94"
// Parse each line for description, amount, YTD

// Pre Tax Deductions:
// "Dental 5.00 20.00"

// Post Tax Deductions:
// "401(k) After-tax Deferral 1,437.51 1,437.51"
// "Critical Illness-Employee 4.54 9.08"
// "RSU Gain Offset 19,690.40 19,690.40"
```

### 3.3 Parsing Each Page

For each page, extract:

```typescript
interface PayslipPage {
  payPeriodBegin: string;   // "10/16/2025"
  payPeriodEnd: string;     // "10/31/2025"
  checkDate: string;        // "10/31/2025"
  
  grossPay: number;         // 9,583.34
  netPay: number;           // 5,980.63
  
  earnings: { description: string; amount: number; ytd: number }[];
  employeeTaxes: { description: string; amount: number; ytd: number }[];
  preTaxDeductions: { description: string; amount: number; ytd: number }[];
  postTaxDeductions: { description: string; amount: number; ytd: number }[];
  
  // Derived
  earningsTotal: number;
  employeeTaxTotal: number;
  preTaxTotal: number;
  postTaxTotal: number;
  
  // Classification
  isRSU: boolean;           // true if RSU Gain is the primary earning
  isSkip: boolean;          // true if all current amounts are $0
}
```

### 3.4 Robust Parsing Notes

The PDF text extraction from payslips can be messy. Key patterns to handle:

- **No spaces between description and dates:** `"Regular Salary Pay10/16/2025"` — split on the first digit that starts a date pattern
- **Numbers with commas:** `"9,583.34"` — strip commas before parseFloat
- **Multiple pages in one PDF:** Each page is a separate payslip. Process independently.
- **Variable earnings:** Some periods have Connectivity Reimbursement, some don't. Only sum items with nonzero Current amounts.
- **RSU Gain Offset in Post Tax:** This is NOT a real deduction — it's shares sold to cover taxes. Exclude from Medical Insurance Benefits calculation. Detect by description containing "RSU Gain Offset".

---

## 4. CSV Fallback

If the user uploads a CSV instead of PDF, attempt to parse it as a manually-prepared payslip summary. Support a simple format:

```csv
Pay Period Begin,Pay Period End,Check Date,Type,Description,Amount
10/16/2025,10/31/2025,10/31/2025,earning,Regular Salary Pay,9583.34
10/16/2025,10/31/2025,10/31/2025,earning,GTL,12.30
10/16/2025,10/31/2025,10/31/2025,tax,Social Security,585.76
...
```

This is a secondary path — PDF is the primary input format.

---

## 5. UI Design

### 5.1 Location

New collapsible section in the Entry tab, below Email Imports:

```
Entry Tab
├── Manual Entry Form (existing)
├── 📥 Import CSV (existing, collapsible)
├── 📧 Email Imports (existing, collapsible)
└── 💰 Payslip Import (new, collapsible)
    ├── Upload bar: [Choose PDF/CSV] [Import Button]
    ├── Status: "Parsing PDF... → Found 6 payslip pages → Generated 24 transactions"
    └── Review Table (payslip-specific grouping)
```

### 5.2 Review Table

Group transactions by pay period for clarity:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 💰 Payslip Import                                                   │
│                                                                     │
│ 6 payslips parsed · 24 transactions generated · 0 duplicates        │
│                                                                     │
│ [✓ Approve All] [Save Approved]                                     │
│                                                                     │
│ ── 10/16/25 – 10/31/25 (Regular) ─────────────────────────────────  │
│ ○ Pinterest Income          income    ($9,595.64)  Chase Chequing   │
│ ○ Income Taxes & SS         income     $3,450.17   Chase Chequing   │
│ ○ Medical Insurance Benefits health      $164.84   Chase Chequing   │
│                                                                     │
│ ── 11/01/25 – 11/15/25 (Regular) ─────────────────────────────────  │
│ ○ Pinterest Income          income    ($9,725.64)  Chase Chequing   │
│ ○ Income Taxes & SS         income     $3,450.17   Chase Chequing   │
│ ○ Medical Insurance Benefits health      $164.84   Chase Chequing   │
│ ○ 401K                      financial  $1,437.51   Chase Chequing   │
│ ○ Vanguard Deposited 401K   financial ($1,437.51)  Vanguard         │
│                                                                     │
│ ── 12/23/25 – 12/23/25 (RSU Vesting) ────────────────────────────  │
│ ○ Pinterest Stock Units...  income   ($33,225.92)  Charles Schwab   │
│ ○ Income Taxes & SS         income    $13,535.52   Charles Schwab   │
│                                                                     │
│ ⚠ 12/16/25 – 12/31/25: Skipped (YTD-only stub, $0 current pay)    │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 Row Click → Edit Modal

Reuse the same `openImportEditModal` pattern. Pre-populated with all fields. The user can adjust:
- Service dates (especially for RSU vesting periods)
- Description
- Category
- Amount (if the parsing was slightly off)

### 5.4 Entered Date

All transactions from a single import batch share the same `date` (entered date). Default to `today()`. Show a date picker at the top of the review section that applies to all rows.

---

## 6. Implementation Plan

### 6.1 New Constants

```javascript
// Add to CONSTANTS section of index.html

const PAYSLIP_PROFILES = {
  pinterest: {
    detect: (text) => text.includes("Pinterest, Inc.") && text.includes("Pay Period Begin"),
    company: "Pinterest",
    // Earnings items to sum for "Pinterest Income"
    incomeItems: ["Regular Salary Pay", "Connectivity Reimbursement", "GTL", 
                  "Wellness Reimbursement", "Home Office Setup Stipend", "Sign on Bonus"],
    // Items that indicate RSU vesting
    rsuIndicators: ["RSU Gain"],
    // Post-tax items to EXCLUDE from Medical Insurance Benefits
    postTaxExclude: ["401(k) After-tax Deferral", "RSU Gain Offset"],
    // Earnings items to INCLUDE in Medical Insurance (non-cash benefits)
    benefitEarnings: ["GTL"],  // Group Term Life
  }
};

// Quarterly vesting date ranges
function getQuarterlyVestingPeriod(vestDate) {
  const d = new Date(vestDate + "T00:00:00");
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  if (month < 3) return { start: `${year}-01-01`, end: `${year}-03-31` };
  if (month < 6) return { start: `${year}-04-01`, end: `${year}-06-30` };
  if (month < 9) return { start: `${year}-07-01`, end: `${year}-09-30` };
  return { start: `${year}-10-01`, end: `${year}-12-31` };
}
```

### 6.2 PDF.js Integration

Add to `<head>`:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs" type="module"></script>
```

Or load dynamically when the payslip section is first expanded:
```javascript
async function loadPdfJs() {
  if (window.pdfjsLib) return;
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";
  script.type = "module";
  document.head.appendChild(script);
  // Set worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = 
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";
}
```

**Important:** pdf.js is an ES module. Since index.html uses a plain `<script>` tag (not `type="module"`), use the UMD/legacy build instead:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js"></script>
```
And set the worker:
```javascript
pdfjsLib.GlobalWorkerOptions.workerSrc = 
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
```

### 6.3 Core Functions

```javascript
// Parse a PDF file into PayslipPage objects
async function parsePayslipPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(" ");
    // Also try to preserve line breaks using y-coordinate changes
    const lines = extractLines(textContent);
    const parsed = parsePayslipPage(lines, text);
    if (parsed) pages.push(parsed);
  }
  return pages;
}

// Convert text content items to lines based on y-coordinate changes
function extractLines(textContent) {
  // Group items by y-coordinate (with tolerance)
  // Sort by y descending (top of page first), then x ascending
  // Join items on same line with spaces
  // Return array of line strings
}

// Parse a single payslip page
function parsePayslipPage(lines, fullText) {
  // 1. Extract pay period dates
  // 2. Extract summary row (gross pay, taxes, deductions, net pay)
  // 3. If gross pay is 0 → mark as skip
  // 4. Parse Earnings section
  // 5. Parse Employee Taxes section
  // 6. Parse Pre Tax Deductions section
  // 7. Parse Post Tax Deductions section
  // 8. Detect RSU vs regular
  // 9. Return PayslipPage object
}

// Generate Disciplan transactions from parsed payslip pages
function generatePayslipTransactions(pages, enteredDate) {
  const transactions = [];
  
  for (const page of pages) {
    if (page.isSkip) continue;
    
    const ss = formatDate(page.payPeriodBegin);  // YYYY-MM-DD
    const se = formatDate(page.payPeriodEnd);
    
    if (page.isRSU) {
      // RSU vesting transactions
      const rsuAmount = page.earnings.find(e => 
        e.description.includes("RSU Gain"))?.amount || 0;
      const vestPeriod = getQuarterlyVestingPeriod(ss);
      const quarter = Math.ceil((new Date(ss + "T00:00:00").getMonth() + 1) / 3);
      const year = new Date(ss + "T00:00:00").getFullYear();
      
      transactions.push({
        date: enteredDate,
        service_start: vestPeriod.start,
        service_end: vestPeriod.end,
        description: `Pinterest Stock Units Vested (Q${quarter} ${year})`,
        category_id: "income",
        amount_usd: -rsuAmount,
        payment_type: "Charles Schwab",
        _group: `${ss} – ${se} (RSU Vesting)`,
        _source: "rsu"
      });
      
      transactions.push({
        date: enteredDate,
        service_start: vestPeriod.start,
        service_end: vestPeriod.end,
        description: "Income Taxes and Social Security",
        category_id: "income",
        amount_usd: page.employeeTaxTotal,
        payment_type: "Charles Schwab",
        _group: `${ss} – ${se} (RSU Vesting)`,
        _source: "rsu_tax"
      });
    } else {
      // Regular pay period transactions
      const earningsTotal = page.earningsTotal;
      const taxTotal = page.employeeTaxTotal;
      const preTaxTotal = page.preTaxTotal;
      const postTax401k = page.postTaxDeductions
        .find(d => d.description.includes("401(k)"))?.amount || 0;
      const postTaxNon401k = page.postTaxDeductions
        .filter(d => !d.description.includes("401(k)") && 
                     !d.description.includes("RSU Gain Offset"))
        .reduce((s, d) => s + d.amount, 0);
      const gtl = page.earnings
        .find(e => e.description === "GTL")?.amount || 0;
      const medicalBenefits = preTaxTotal + postTaxNon401k + gtl;
      
      // 1. Pinterest Income
      transactions.push({
        date: enteredDate,
        service_start: ss, service_end: se,
        description: "Pinterest Income",
        category_id: "income",
        amount_usd: -earningsTotal,
        payment_type: "Chase Chequing",
        _group: `${fmtD(ss)} – ${fmtD(se)} (Regular)`,
        _source: "salary"
      });
      
      // 2. Income Taxes
      transactions.push({
        date: enteredDate,
        service_start: ss, service_end: se,
        description: "Income Taxes and Social Security",
        category_id: "income",
        amount_usd: taxTotal,
        payment_type: "Chase Chequing",
        _group: `${fmtD(ss)} – ${fmtD(se)} (Regular)`,
        _source: "tax"
      });
      
      // 3. Medical Insurance Benefits
      transactions.push({
        date: enteredDate,
        service_start: ss, service_end: se,
        description: "Medical Insurance Benefits",
        category_id: "health",
        amount_usd: Math.round(medicalBenefits * 100) / 100,
        payment_type: "Chase Chequing",
        _group: `${fmtD(ss)} – ${fmtD(se)} (Regular)`,
        _source: "benefits"
      });
      
      // 4 & 5. 401K double-entry (only if deferral exists)
      if (postTax401k > 0) {
        transactions.push({
          date: enteredDate,
          service_start: ss, service_end: se,
          description: "401K",
          category_id: "financial",
          amount_usd: postTax401k,
          payment_type: "Chase Chequing",
          _group: `${fmtD(ss)} – ${fmtD(se)} (Regular)`,
          _source: "401k_out"
        });
        transactions.push({
          date: enteredDate,
          service_start: ss, service_end: se,
          description: "Vanguard Deposited 401K",
          category_id: "financial",
          amount_usd: -postTax401k,
          payment_type: "Vanguard",
          _group: `${fmtD(ss)} – ${fmtD(se)} (Regular)`,
          _source: "401k_in"
        });
      }
    }
  }
  
  return transactions;
}
```

---

## 7. Commit Flow

Reuse the existing `commitImport` pattern:
1. Filter approved transactions
2. Compute `service_days` and `daily_cost` for each
3. Set `currency: "USD"`, `fx_rate: 1`, `original_amount: amount_usd`, `credit: ""`, `tag: ""`
4. Set `import_batch: "payslip-YYYY-MM-DDTHH:MM"`
5. Batch POST to Supabase `transactions` table
6. Run duplicate detection before commit (match on `description + date + amount_usd + payment_type`)

---

## 8. Edge Cases

| Case | Handling |
|------|----------|
| YTD-only page ($0 gross pay) | Auto-skip, show in review as "Skipped (YTD summary)" |
| RSU page (RSU Gain + RSU Gain Offset) | Detect via earnings containing "RSU Gain"; generate RSU transactions, not salary transactions |
| No 401k deferral (first pay period) | Skip 401K and Vanguard transactions for that period |
| Bonus included in earnings | Sum it into earnings total — it's part of "Pinterest Income" |
| Wellness/Home Office reimbursements | Sum into earnings total (they're compensation) |
| Multiple PDFs uploaded | Process each independently, combine all pages |
| Non-Pinterest payslip | Show error: "Unrecognized payslip format" |
| Duplicate payslips (same period re-uploaded) | Standard duplicate detection catches matching date+amount+description |
| Net pay checksum mismatch | Show ⚠ warning on the pay period group header |
| PDF parsing fails on a page | Show error for that page, continue processing others |

---

## 9. Files to Modify

| File | Changes |
|------|---------|
| `index.html` | Add pdf.js CDN script tag. Add PAYSLIP_PROFILES constant. Add `parsePayslipPDF()`, `parsePayslipPage()`, `generatePayslipTransactions()` functions. Add payslip import section to `renderEntry()`. Reuse existing review table and commit patterns. |

No new Supabase tables. Writes to existing `transactions` table.

---

## 10. Testing Checklist

- [ ] Upload the 6-page Pinterest payslip PDF
- [ ] Page 1 (10/16-10/31): 3 transactions generated (no 401k)
  - Pinterest Income: -$9,595.64 ✓
  - Income Taxes: $3,450.17 ✓
  - Medical Insurance: $164.84 ✓
- [ ] Page 2 (11/1-11/15): 5 transactions generated (with 401k)
  - Pinterest Income: -$9,725.64 ✓
  - 401K: $1,437.51 / Vanguard: -$1,437.51 ✓
- [ ] Page 3 (11/16-11/30): 5 transactions, taxes = $3,450.16 (not .17)
- [ ] Page 4 (12/1-12/15): 5 transactions
- [ ] Page 5 (12/16-12/31): **Skipped** (YTD-only, $0 current)
- [ ] Page 6 (12/23-12/23 RSU): 2 transactions
  - Pinterest Stock Units Vested (Q4 2025): -$33,225.92 on Charles Schwab ✓
  - Income Taxes: $13,535.52 on Charles Schwab ✓
- [ ] Total: ~22 transactions across 5 active pages
- [ ] Review table groups by pay period
- [ ] Row click opens edit modal with correct pre-populated values
- [ ] Service dates editable (especially RSU vesting period)
- [ ] Approve All + Save commits to Supabase
- [ ] Duplicate detection prevents re-importing same payslips
- [ ] Mobile responsive

---

## 11. Claude Code Step-by-Step Prompts

### Step 1: Load Context

```
Read these files to understand the project:
- CLAUDE.md (project rules and architecture)
- references/FEA-45-payslip-import-spec.md (this spec)
- index.html (focus on: renderEntry function, the Import CSV and Email Import sections, 
  commitImport pattern, the constants section)

Also read the uploaded files:
- /mnt/user-data/uploads/payslip_sample.pdf (6-page Pinterest payslip)
- /mnt/user-data/uploads/disciplan_income_sample.csv (Mark's existing income transactions)

Confirm you understand:
1. The 5-transaction pattern per regular pay period
2. The 2-transaction pattern for RSU vesting
3. The Medical Insurance Benefits formula: Pre Tax + Post Tax (excl 401k & RSU Offset) + GTL
4. The sign conventions (negative = income, positive = expense/deduction)
5. The skip rule for $0 gross pay pages
6. How the existing Import CSV section works in renderEntry()

Don't make changes yet.
```

### Step 2: Add pdf.js and Payslip Parser

```
Step 2 of FEA-45. Add PDF parsing infrastructure.

A) Add pdf.js CDN to index.html <head> (after Chart.js, before Supabase):
   <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js"></script>

   Then in the script section (top of <script>, after CONFIG), add:
   if (window.pdfjsLib) {
     pdfjsLib.GlobalWorkerOptions.workerSrc = 
       "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
   }

B) Add the PAYSLIP_PROFILES constant near the other bank profile constants.
   Add the getQuarterlyVestingPeriod(dateStr) helper function.

C) Add the core parsing functions:

   1. extractLinesFromPage(textContent) — converts pdf.js textContent items to 
      ordered lines by grouping items with similar y-coordinates (tolerance ~2px),
      sorting by y descending then x ascending, and joining each group with spaces.

   2. parsePayslipPage(lines, fullText) — extracts:
      - Pay Period Begin, Pay Period End, Check Date from header
      - Summary row: Gross Pay, Pre Tax Deductions, Employee Taxes, Post Tax Deductions, Net Pay
      - Earnings section: each line item with Current Amount
      - Employee Taxes section: each line item with Amount
      - Pre Tax Deductions section: each line item with Amount  
      - Post Tax Deductions section: each line item with Amount
      - Computed totals and isRSU / isSkip flags
      
      The PDF text is semi-structured. Key parsing strategy:
      - Find section headers ("Earnings", "Employee Taxes", "Pre Tax Deductions", 
        "Post Tax Deductions") by searching for these exact strings in lines
      - Parse lines between section headers
      - For Earnings: extract description (text before first date or number), 
        Amount (the "Amount" column, which is the current-period amount)
      - For Tax/Deduction sections: each line has "Description Amount YTD" format
      - Handle "Regular Salary Pay10/16/2025" (no space before date) by splitting 
        on first \d{2}/\d{2}/\d{4} pattern
      - Handle number parsing: strip commas, handle negatives

   3. parsePayslipPDF(file) — async function that:
      - Reads file as ArrayBuffer
      - Opens PDF with pdfjsLib.getDocument()
      - Iterates pages, extracts text, calls parsePayslipPage for each
      - Returns array of PayslipPage objects

D) Add generatePayslipTransactions(pages, enteredDate) per spec section 6.3.
   This takes parsed pages and produces the transaction candidates.

Test the parser by logging output — don't build UI yet.

CRITICAL: The PDF text extraction can be tricky. Use the sample PDF at 
/mnt/user-data/uploads/payslip_sample.pdf to verify your parser output 
against these known values:

Page 1 (10/16-10/31): Earnings=9595.64, Taxes=3450.17, PreTax=148.00, PostTax=4.54
Page 2 (11/1-11/15): Earnings=9725.64, Taxes=3450.17, PreTax=148.00, PostTax=1442.05
Page 3 (11/16-11/30): Earnings=9595.64, Taxes=3450.16, PreTax=148.00, PostTax=1442.05
Page 4 (12/1-12/15): Earnings=9725.64, Taxes=3450.17, PreTax=148.00, PostTax=1442.05
Page 5 (12/16-12/31): ALL ZEROS (skip)
Page 6 (12/23-12/23 RSU): Earnings=33225.92, Taxes=13535.52, PostTax=19690.40
```

### Step 3: Add Payslip Import UI to Entry Tab

```
Step 3 of FEA-45. Add the Payslip Import section to renderEntry().

After the existing Email Import card (emailCard), add a new collapsible card:

A) Section header: "💰 Payslip Import" with toggle arrow, collapsed by default

B) Upload bar:
   - File input accepting .pdf and .csv
   - "Entered Date" date picker (default: today())
   - Import button

C) On Import click:
   1. If PDF: call parsePayslipPDF(file)
   2. Show status: "Parsing... → Found X payslip pages → Generated Y transactions"
   3. Call generatePayslipTransactions(pages, enteredDate)
   4. Run duplicate detection (same pattern as CSV import — match on 
      payment_type + date range + amount within $0.02)
   5. Render the review table

D) Review table — similar to CSV import but with pay period grouping:
   - Group transactions by _group field (pay period label)
   - Each group has a header row showing the period and type (Regular/RSU/Skipped)
   - Skipped periods shown as muted info rows
   - Standard status cycling (○/✓/✕), category dropdown, amount display
   - Bulk actions: [✓ Approve All] [Save Approved]
   - Net pay checksum: for each regular period, show 
     "Net Pay: $X (Expected: $Y)" with warning if mismatch > $0.02

E) Row click → edit modal (reuse openImportEditModal pattern):
   - All fields editable
   - Accrual preview
   - Save & Approve / Skip / Cancel

F) Save Approved → commit to Supabase:
   - Reuse commitImport pattern
   - Set import_batch = "payslip-YYYY-MM-DDTHH:MM"
   - Compute service_days and daily_cost for each transaction
   - Set currency="USD", fx_rate=1, original_amount=amount_usd, credit="", tag=""

Match the existing dark theme and table styling exactly.
Use the same h() DOM helper, .cd card class, .btn/.pg-btn button styles.
```

### Step 4: Test & Verify

```
Step 4 of FEA-45. Test with the sample payslip PDF.

1. Upload /mnt/user-data/uploads/payslip_sample.pdf to the Payslip Import section
2. Verify all 6 pages are parsed
3. Check each pay period's transactions against the expected values from the spec:

   10/16-10/31 (3 txns, no 401k):
   - Pinterest Income: -9,595.64
   - Income Taxes: 3,450.17
   - Medical Insurance: 164.84 (= 148.00 + 4.54 + 12.30)

   11/1-11/15 (5 txns, with 401k):
   - Pinterest Income: -9,725.64 (= 9583.34 + 130.00 + 12.30)
   - Income Taxes: 3,450.17
   - Medical Insurance: 164.84
   - 401K: 1,437.51
   - Vanguard: -1,437.51

   11/16-11/30 (5 txns):
   - Pinterest Income: -9,595.64 (no connectivity reimbursement this period)
   - Income Taxes: 3,450.16 (note: .16 not .17)

   12/1-12/15 (5 txns): same as 11/1-11/15

   12/16-12/31: SKIPPED

   12/23-12/23 RSU (2 txns):
   - Pinterest Stock Units Vested (Q4 2025): -33,225.92
   - Income Taxes: 13,535.52

4. Verify total transaction count: 20 transactions
5. Verify the review table groups correctly
6. Approve all and save — verify transactions appear in Ledger
7. Test duplicate detection: re-upload same PDF — all should show as duplicates

Fix any parsing or calculation bugs.
Don't git push yet.
```

### Step 5: Polish & Roadmap Update

```
Step 5 of FEA-45. Final polish.

1. Add FEA-45 to disciplan-roadmap.md (Next Up section):
   | FEA-45 | **Payslip Import** | Feature | **High** | Upload Pinterest payslip PDFs. 
   Parses each page via pdf.js, detects regular pay vs RSU vesting, generates 3-5 
   transactions per pay period matching Mark's existing income recording style 
   (Pinterest Income, Income Taxes, Medical Insurance Benefits, 401K double-entry). 
   Review table with pay-period grouping, edit modal, batch commit. |

2. Edge case handling:
   - What if pdf.js CDN is down? Show error "PDF parser not available"
   - What if the PDF is not a payslip? Show "Unrecognized payslip format"
   - What if a page has unexpected format? Skip that page with error message

3. Mobile responsiveness: 
   - Group headers should wrap nicely
   - Table scrolls horizontally
   - Edit modal doesn't overflow

4. Commit and push:
   git add -A
   git commit -m "FEA-45: Payslip Import with PDF parsing

   - pdf.js integration for extracting payslip data from PDFs
   - Pinterest payslip profile: detects company, parses all sections
   - Generates 3-5 transactions per pay period:
     * Pinterest Income (negative, all earnings)
     * Income Taxes and Social Security (employee taxes total)
     * Medical Insurance Benefits (pre-tax + post-tax non-401k + GTL)
     * 401K / Vanguard double-entry (when 401k deferral exists)
   - RSU vesting detection: generates Stock Units Vested + tax withholding
   - Auto-skips YTD-only stub pages ($0 current pay)
   - Review table with pay-period grouping
   - Net pay checksum validation
   - Duplicate detection
   - Mobile responsive"

   git push origin main
```
