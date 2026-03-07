# FEA-39: Email-to-Ledger Import Pipeline

**Feature ID:** FEA-39  
**Priority:** High  
**Depends on:** FEA-10 (Auth), FEA-24 (CSV Import review UI pattern)  
**Inbound email service:** Postmark (free tier: 100 inbound/month)  
**Scope:** Full framework with parser templates + AI fallback for unrecognized emails  
**Review UI:** Collapsible sub-section under Entry tab (same pattern as CSV import)

---

## 1. Overview

Forward transaction-related emails (Venmo payments, Rakuten cashback, bank alerts, subscription confirmations) to a dedicated Postmark inbound email address. A Supabase Edge Function receives the email webhook, identifies the source, runs the matching parser template (or AI fallback for unknown sources), and writes a candidate row to a `pending_imports` staging table. On next Disciplan load, the app shows a notification banner and an import review section under the Entry tab — reusing the familiar approve/edit/skip flow from CSV import before committing to the live ledger.

---

## 2. Architecture

```
┌──────────────┐     Forward email      ┌─────────────────────┐
│  Gmail inbox  │ ───────────────────►   │  Postmark Inbound   │
│  (your phone) │                        │  import@[hash].      │
└──────────────┘                         │  inbound.postmark    │
                                         │  app.com             │
                                         └─────────┬───────────┘
                                                   │ JSON POST (webhook)
                                                   ▼
                                         ┌─────────────────────┐
                                         │  Supabase Edge Fn   │
                                         │  /inbound-email     │
                                         │                     │
                                         │  1. Validate secret │
                                         │  2. Detect source   │
                                         │  3. Parse email     │
                                         │  4. AI categorize   │
                                         │  5. INSERT staging  │
                                         └─────────┬───────────┘
                                                   │
                                                   ▼
                                         ┌─────────────────────┐
                                         │  pending_imports     │
                                         │  (Supabase table)   │
                                         │  status = 'pending'  │
                                         └─────────┬───────────┘
                                                   │
                                                   ▼
                                         ┌─────────────────────┐
                                         │  Disciplan App      │
                                         │  init() → banner    │
                                         │  Entry tab → review │
                                         │  Approve → commit   │
                                         │  to transactions    │
                                         └─────────────────────┘
```

**Three-stage pipeline:**

1. **Email → Postmark webhook**: You forward a Venmo email (or any transaction email) to the Postmark inbound address. Postmark parses it and POSTs the email (subject, from, HTML body, text body, headers) as JSON to the Supabase Edge Function endpoint.

2. **Edge Function → staging table**: The Edge Function identifies the email source via sender address/subject patterns, runs the matching parser template to extract transaction fields, optionally calls Claude API for category assignment, and INSERTs a row into `pending_imports` with status `pending`.

3. **App load → review & commit**: On `init()`, the app queries `pending_imports?status=eq.pending`. If any exist, shows a notification banner below the header ("📧 3 pending email imports — Review"). The Entry tab gains a new collapsible "Email Imports" section (below CSV Import) with the same review table UX: approve/edit/skip rows, inline category dropdown, edit modal, then batch-commit to `transactions`.

---

## 3. Database Schema

### 3.1 `pending_imports` table

```sql
CREATE TABLE IF NOT EXISTS pending_imports (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                    -- 'venmo', 'rakuten', 'chase_alert', 'subscription', 'unknown'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'committed', 'skipped', 'error'
  
  -- ── Parsed candidate fields (mirror transactions schema) ──
  date DATE,
  description TEXT,
  category_id TEXT,
  amount_usd NUMERIC(12,2),
  currency TEXT DEFAULT 'USD',
  payment_type TEXT,
  credit TEXT DEFAULT '',
  tag TEXT DEFAULT '',
  service_start DATE,
  service_end DATE,
  service_days INT DEFAULT 1,
  daily_cost NUMERIC(12,6),
  
  -- ── Raw email metadata (for debugging / re-parsing / unknown emails) ──
  email_subject TEXT,
  email_from TEXT,
  email_body_text TEXT,                    -- Plain text version
  email_body_html TEXT,                    -- HTML version (for structured parsing)
  email_received_at TIMESTAMPTZ DEFAULT now(),
  email_message_id TEXT,                   -- For dedup on re-forwarded emails
  
  -- ── Source-specific extracted data (flexible JSON) ──
  parsed_data JSONB DEFAULT '{}',
  -- Venmo example:
  -- {
  --   "direction": "paid",           -- "paid" or "received"
  --   "counterparty": "Aud Li",
  --   "note": "Buoy",
  --   "txn_id": "4547378430212112103",
  --   "payment_method": "Venmo balance",
  --   "venmo_username": "@Mark-Ren-3"
  -- }
  
  -- ── AI enrichment ──
  ai_category TEXT,                        -- AI-suggested category_id
  ai_confidence TEXT,                      -- 'high', 'medium', 'low'
  ai_description TEXT,                     -- AI-cleaned description
  
  -- ── Error tracking ──
  parse_errors TEXT[],                     -- Any issues during extraction
  
  -- ── Lifecycle ──
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  committed_at TIMESTAMPTZ,
  committed_txn_id BIGINT                  -- FK to transactions.id after commit
);

CREATE INDEX idx_pi_status ON pending_imports(status);
CREATE INDEX idx_pi_source ON pending_imports(source);
CREATE INDEX idx_pi_email_message_id ON pending_imports(email_message_id);
```

### 3.2 `email_parser_templates` table (optional, for Phase 2+)

Stores parser rules in the database so new email sources can be added without code changes. For v1, parser templates are hardcoded in the Edge Function.

---

## 4. Inbound Email Setup (Postmark)

### 4.1 Setup Steps

1. Create Postmark account at postmarkapp.com (free tier: 100 inbound/month)
2. Create an Inbound Server — Postmark assigns an address like `[hash]@inbound.postmarkapp.com`
3. Set the webhook URL to: `https://mjuannepfodstbsxweuc.supabase.co/functions/v1/inbound-email`
4. Add a shared secret header for auth validation (e.g., `X-Webhook-Secret: <random_token>`)
5. Store the Postmark inbound address in Disciplan's preferences table so it can be displayed in the app ("Forward emails to: ...")

### 4.2 Postmark Webhook Payload (key fields)

```json
{
  "From": "venmo@venmo.com",
  "FromName": "Venmo",
  "To": "[hash]@inbound.postmarkapp.com",
  "Subject": "You paid Aud Li $110.00",
  "TextBody": "You paid Aud Li $110.00\n\nTransaction details\nDate Mar 06, 2026...",
  "HtmlBody": "<html>...<div>You paid Aud Li</div><div>$110.00</div>...",
  "Date": "Thu, 06 Mar 2026 09:12:00 -0800",
  "MessageID": "<abc123@venmo.com>",
  "Headers": [...]
}
```

### 4.3 Gmail Forwarding Tip

You can either manually forward individual emails, or set up a Gmail filter:
- Filter: `from:venmo@venmo.com subject:"You paid" OR subject:"You received"`
- Action: Forward to `[hash]@inbound.postmarkapp.com`

This auto-forwards all Venmo payment emails without any manual action.

---

## 5. Supabase Edge Function

### 5.1 Endpoint

```
POST /functions/v1/inbound-email
```

### 5.2 Flow

```javascript
// Pseudocode for the Edge Function

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("INBOUND_EMAIL_SECRET");
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// ── Parser registry ──
const EMAIL_PARSERS = {
  venmo: {
    detect: (from, subject) => 
      from.includes("venmo.com") && 
      (subject.includes("You paid") || subject.includes("You received")),
    parse: parseVenmoEmail
  },
  rakuten: {
    detect: (from, subject) =>
      from.includes("rakuten.com") && subject.includes("cashback"),
    parse: parseRakutenEmail
  },
  chase_alert: {
    detect: (from, subject) =>
      from.includes("chase.com") && subject.includes("transaction"),
    parse: parseChaseAlertEmail
  }
  // More parsers added incrementally
};

serve(async (req) => {
  // 1. Validate webhook secret
  if (req.headers.get("X-Webhook-Secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const { From, Subject, TextBody, HtmlBody, MessageID, Date: emailDate } = payload;

  // 2. Dedup: skip if we've already processed this email
  const supabase = createClient(SB_URL, SB_SERVICE_KEY);
  const { data: existing } = await supabase
    .from("pending_imports")
    .select("id")
    .eq("email_message_id", MessageID)
    .limit(1);
  if (existing?.length) {
    return new Response(JSON.stringify({ status: "duplicate" }), { status: 200 });
  }

  // 3. Detect source and parse
  let source = "unknown";
  let parsed = null;
  let parseErrors = [];

  for (const [name, parser] of Object.entries(EMAIL_PARSERS)) {
    if (parser.detect(From, Subject)) {
      source = name;
      try {
        parsed = parser.parse({ from: From, subject: Subject, text: TextBody, html: HtmlBody });
      } catch (e) {
        parseErrors.push(`${name} parser error: ${e.message}`);
      }
      break;
    }
  }

  // 4. AI fallback for unknown emails (or to enrich parsed results)
  let aiResult = null;
  if (ANTHROPIC_KEY) {
    aiResult = await aiCategorize(source, parsed, Subject, TextBody);
  }

  // 5. Build candidate row
  const candidate = buildCandidate(source, parsed, aiResult, {
    email_subject: Subject,
    email_from: From,
    email_body_text: TextBody,
    email_body_html: HtmlBody,
    email_message_id: MessageID,
    email_received_at: emailDate || new Date().toISOString(),
    parse_errors: parseErrors
  });

  // 6. Insert into staging table
  const { error } = await supabase.from("pending_imports").insert(candidate);
  if (error) return new Response(JSON.stringify({ error }), { status: 500 });

  return new Response(JSON.stringify({ status: "ok", source }), { status: 200 });
});
```

### 5.3 Venmo Parser (reference implementation)

Based on the email screenshots:

```javascript
function parseVenmoEmail({ from, subject, text, html }) {
  // ── Parse from subject line ──
  // "You paid Aud Li $110.00" or "You received $50.00 from Kevin Chen"
  const isPaid = subject.includes("You paid");
  const isReceived = subject.includes("You received") || subject.includes("paid you");
  
  let counterparty = "";
  let amount = 0;

  if (isPaid) {
    // "You paid Aud Li $110.00"
    const m = subject.match(/You paid (.+?) \$([0-9,.]+)/);
    if (m) { counterparty = m[1]; amount = parseFloat(m[2].replace(/,/g, "")); }
  } else if (isReceived) {
    // "You received $50.00 from Kevin Chen" or "Kevin Chen paid you $50.00"
    const m1 = subject.match(/received \$([0-9,.]+) from (.+)/);
    const m2 = subject.match(/(.+?) paid you \$([0-9,.]+)/);
    if (m1) { amount = parseFloat(m1[1].replace(/,/g, "")); counterparty = m1[2]; }
    else if (m2) { counterparty = m2[1]; amount = parseFloat(m2[2].replace(/,/g, "")); }
  }

  // ── Parse note from text body ──
  // The note appears between the amount and "See transaction"
  let note = "";
  const noteMatch = text.match(/\$[\d,.]+\s*\n\s*\n\s*(.+?)\s*\n/);
  if (noteMatch) note = noteMatch[1].trim();
  // Alternative: parse from HTML — note is typically in a div after the amount

  // ── Parse date from text body ──
  // "Date\nMar 06, 2026"
  let txnDate = null;
  const dateMatch = text.match(/Date\s*\n\s*(\w+ \d{1,2}, \d{4})/);
  if (dateMatch) {
    txnDate = new Date(dateMatch[1]).toISOString().slice(0, 10);
  }

  // ── Parse Transaction ID ──
  let txnId = null;
  const idMatch = text.match(/Transaction ID\s*\n\s*(\d+)/);
  if (idMatch) txnId = idMatch[1];

  // ── Build Disciplan transaction fields ──
  const direction = isPaid ? "paid" : "received";
  const amountUsd = isPaid ? amount : -amount;  // positive = expense, negative = income

  const description = isPaid
    ? `Venmo - ${counterparty}${note ? ` (${note})` : ""}`
    : `Venmo from ${counterparty}${note ? ` (${note})` : ""}`;

  return {
    date: txnDate,
    description,
    amount_usd: amountUsd,
    category_id: isPaid ? null : "income",  // null = needs AI or manual assignment
    payment_type: "Venmo",
    service_start: txnDate,
    service_end: txnDate,
    service_days: 1,
    daily_cost: amountUsd,
    parsed_data: {
      direction,
      counterparty,
      note,
      txn_id: txnId,
      payment_method: "Venmo balance",
      raw_amount: amount
    }
  };
}
```

### 5.4 AI Categorization (in Edge Function)

For known sources (Venmo), the AI primarily assigns category based on the note text:
- "Buoy" → what is this? AI guesses based on context (restaurant? activity?)
- "Groceries" → groceries
- "Rent" → rent
- "Uber" → transportation

For unknown email sources, the AI attempts full extraction from the email body:

```javascript
async function aiCategorize(source, parsed, subject, textBody) {
  const prompt = source === "unknown"
    ? buildUnknownEmailPrompt(subject, textBody)
    : buildEnrichmentPrompt(source, parsed);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  return JSON.parse(data.content[0].text);
}

function buildEnrichmentPrompt(source, parsed) {
  return `You are a personal finance assistant. Given this ${source} transaction, assign a category.

CATEGORIES: entertainment, food, groceries, restaurant, home, rent, furniture, health, personal, clothes, tech, transportation, utilities, financial, other, income

Transaction:
- Description: ${parsed.description}
- Amount: $${Math.abs(parsed.amount_usd)}
- Direction: ${parsed.parsed_data.direction}
- Note: "${parsed.parsed_data.note || ""}"
- Counterparty: ${parsed.parsed_data.counterparty}

Return ONLY a JSON object: {"cat": "<category_id>", "conf": "high|medium|low", "desc": "<optionally improved description>"}

Rules:
- If the note clearly indicates a category (e.g. "groceries", "dinner"), use high confidence
- If the counterparty is a known business type, use medium confidence  
- If ambiguous, use "other" with low confidence
- For "received" direction, always use "income" with high confidence`;
}

function buildUnknownEmailPrompt(subject, textBody) {
  return `You are a personal finance assistant. Extract a financial transaction from this email.

CATEGORIES: entertainment, food, groceries, restaurant, home, rent, furniture, health, personal, clothes, tech, transportation, utilities, financial, other, income

Email subject: ${subject}
Email body (first 2000 chars): ${textBody.slice(0, 2000)}

If this email contains a financial transaction (purchase, payment, refund, cashback, subscription charge), extract it.
If not a financial email, return {"is_transaction": false}.

Return ONLY a JSON object:
{
  "is_transaction": true,
  "date": "YYYY-MM-DD",
  "description": "Clean description",
  "amount_usd": 123.45,
  "category_id": "<category>",
  "confidence": "high|medium|low",
  "payment_type": "<best guess payment account or 'unknown'>",
  "source_hint": "<what service sent this email>"
}`;
}
```

### 5.5 Candidate Builder

```javascript
function buildCandidate(source, parsed, aiResult, emailMeta) {
  // Start with parsed fields (if parser succeeded)
  const base = parsed || {};
  
  // If AI returned results for an unknown email, use those
  if (source === "unknown" && aiResult?.is_transaction) {
    base.date = aiResult.date;
    base.description = aiResult.description;
    base.amount_usd = aiResult.amount_usd;
    base.category_id = aiResult.category_id;
    base.payment_type = aiResult.payment_type || "unknown";
    base.service_start = aiResult.date;
    base.service_end = aiResult.date;
    base.service_days = 1;
    base.daily_cost = aiResult.amount_usd;
  }

  // AI enrichment for known sources (category + description polish)
  const ai_category = aiResult?.cat || base.category_id;
  const ai_confidence = aiResult?.conf || (base.category_id ? "medium" : "low");
  const ai_description = aiResult?.desc || base.description;

  return {
    source,
    status: (source === "unknown" && !aiResult?.is_transaction) ? "skipped" : "pending",
    date: base.date,
    description: ai_description || base.description || emailMeta.email_subject,
    category_id: ai_category || "other",
    amount_usd: base.amount_usd,
    currency: "USD",
    payment_type: base.payment_type,
    credit: base.credit || "",
    tag: base.tag || "",
    service_start: base.service_start || base.date,
    service_end: base.service_end || base.date,
    service_days: base.service_days || 1,
    daily_cost: base.daily_cost || base.amount_usd,
    ai_category,
    ai_confidence,
    ai_description,
    parsed_data: base.parsed_data || {},
    parse_errors: emailMeta.parse_errors || [],
    ...emailMeta
  };
}
```

---

## 6. Frontend Changes

### 6.1 Pending Import Banner (in `init()`)

After the existing `init()` sets up the connection and tab state, add:

```javascript
// Check for pending email imports
const pending = await sb("pending_imports?status=eq.pending&select=id&limit=1", {
  headers: { Prefer: "count=exact" }
});
const pendingCount = parseInt(pending.headers?.get("content-range")?.split("/")[1] || "0");
// Note: sb() returns parsed JSON, so we need a separate HEAD/count query
// Implementation: add a quick count query via sbRPC or direct fetch with Prefer:count=exact

if (pendingCount > 0) {
  const banner = document.createElement("div");
  banner.id = "emailImportBanner";
  banner.style.cssText = "background:rgba(74,111,165,0.15);color:var(--b);text-align:center;padding:8px 12px;font-size:12px;border-bottom:1px solid rgba(74,111,165,0.2);cursor:pointer";
  banner.innerHTML = `📧 ${pendingCount} pending email import${pendingCount > 1 ? "s" : ""} — <b>Review</b>`;
  banner.onclick = () => {
    state.tab = "entry";
    renderTabs();
    renderContent();
    // Auto-expand the email imports section
    setTimeout(() => document.getElementById("emailImportSection")?.scrollIntoView({ behavior: "smooth" }), 100);
  };
  document.querySelector(".hdr").after(banner);
}
```

### 6.2 Email Import Section (in `renderEntry()`)

Below the existing CSV Import collapsible section, add a third collapsible:

```
Entry Tab
├── Manual Entry Form (existing)
├── 📥 Import CSV (existing, collapsible)
└── 📧 Email Imports (new, collapsible, auto-expands if pending imports exist)
    ├── Setup info: "Forward emails to: [postmark address]"  
    ├── Summary stats: "3 pending · 1 from Venmo · 2 unknown"
    ├── Bulk actions: [✓ Approve All] [Save Approved]
    └── Review table (same columns/UX as CSV import)
        Status | Date | Source | Description | Amount | Category | Payment | Tag
```

### 6.3 Review Table

Reuse the exact same `renderReviewTable()` pattern from CSV import with these adaptations:

- **Source column** (new): Shows the parser source with a colored badge — "venmo" (blue), "rakuten" (green), "chase" (yellow), "unknown" (gray)
- **Description column**: Shows AI-cleaned or parser-generated description, with raw email subject as muted subtitle
- **Category column**: Same inline dropdown + confidence dot
- **Row click → edit modal**: Same `openImportEditModal` pattern, but also shows:
  - Source email subject (read-only reference)
  - Parsed note/counterparty from `parsed_data` (read-only reference)
  - For "unknown" source: shows a snippet of the raw email body so you can verify the AI extraction

### 6.4 Commit Flow

Same as CSV import `commitImport()`:
1. Filter `status === "approved"` rows
2. Build transaction objects matching the `transactions` schema
3. Batch POST to `transactions` table with `import_batch` = `email-YYYY-MM-DDTHH:MM`
4. Update `pending_imports` rows: set `status='committed'`, `committed_at=now()`, `committed_txn_id=<new id>`
5. Update `state.txnCount`, show success summary
6. Duplicate detection: check `transactions` for matching `payment_type` + `date` + `abs(amount_usd)` within $0.02

---

## 7. Future Parser Templates (v1 ships with Venmo + AI fallback; these are queued)

| Source | Sender pattern | Subject pattern | Key extracted fields |
|--------|---------------|----------------|---------------------|
| **Rakuten cashback** | `rakuten.com` | "You've earned Cash Back" | Cashback $, store name, date → category from store |
| **Chase transaction alert** | `chase.com` | "Your transaction" / "Transaction exceeding" | Amount, merchant, last 4 digits, date → auto-detect payment_type from card |
| **Subscription confirmations** | Various (`apple.com`, `anthropic.com`, `spotify.com`, etc.) | "receipt" / "invoice" / "subscription" | Service name, amount, billing period → auto-set `service_start/end` to billing cycle |
| **Amazon order** | `amazon.com` | "Your order" | Item description, amount, date → category "personal" default |
| **Bank transfer alerts** | Various | "transfer" / "deposit" | Amount, direction, accounts → category "financial" |

Each new parser follows the same `{ detect, parse }` interface and is added to the `EMAIL_PARSERS` registry in the Edge Function.

---

## 8. Edge Cases & Error Handling

| Case | Handling |
|------|----------|
| Same email forwarded twice | Dedup via `email_message_id` — Edge Function skips if already in `pending_imports` |
| Non-financial email forwarded | AI fallback returns `{is_transaction: false}` → row inserted with `status='skipped'`, not shown in review |
| Postmark webhook auth fails | Return 401, email silently dropped (Postmark retries 3x then gives up) |
| AI API fails in Edge Function | Parser still extracts what it can; `category_id` defaults to "other" with `ai_confidence='low'` |
| Venmo email format changes | Parser fails gracefully → falls back to AI extraction from raw body |
| Email body too large | Truncate `email_body_html` to 50KB, `email_body_text` to 10KB before INSERT |
| Pending imports grow stale | No auto-expiry for v1; user can manually skip old ones. Future: auto-skip after 30 days |
| Edge Function cold start | Supabase Edge Functions have ~200ms cold start; fine for email processing |
| Multiple transactions in one email | v1: one `pending_imports` row per email. Future: parser can return array |
| Amount parsing fails | Store with `amount_usd = NULL`, `status = 'error'`, `parse_errors` populated — shown in review with warning |

---

## 9. Files to Modify / Create

| File | Changes |
|------|---------|
| **`index.html`** | Add email import section in `renderEntry()`. Add pending import banner in `init()`. New functions: `renderEmailImports()`, `loadPendingImports()`, `commitEmailImports()`. Reuse existing review table pattern. |
| **`supabase/functions/inbound-email/index.ts`** | NEW — Supabase Edge Function. Contains parser registry, Venmo parser, AI categorization, candidate builder. |
| **`supabase/migrations/pending_imports.sql`** | NEW — Creates the `pending_imports` table and indexes. |
| **`disciplan-roadmap.md`** | Add FEA-39 entry to "Next Up" section. |

No changes to existing Supabase tables. The `pending_imports` table is fully independent.

---

## 10. Roadmap Entry (add to `disciplan-roadmap.md` under "Next Up")

```markdown
| FEA-39 | **Email-to-Ledger Import Pipeline** | Feature | **High** | Forward transaction emails (Venmo, etc.) to a Postmark inbound address. Supabase Edge Function receives webhook, parses email with source-specific templates (Venmo parser extracts counterparty, amount, note, date from subject + body), falls back to Claude AI extraction for unknown email sources. Writes to `pending_imports` staging table. On app load, banner shows pending count; Entry tab gains a collapsible "Email Imports" section reusing the CSV import review UI (approve/edit/skip + batch commit). **Architecture:** Postmark free tier (100 inbound/month) → Edge Function (`/inbound-email`) → `pending_imports` table → frontend review. **Venmo mapping:** "You paid Aud Li $110.00" + note "Buoy" → `{description: "Venmo - Aud Li (Buoy)", amount: 110, payment_type: "Venmo", category: AI-assigned}`. Dedup via `email_message_id` + standard date/amount check. **Scope:** Full framework with parser registry + AI fallback, ships with Venmo parser as initial template. |
```

---

## 11. Claude Code Step-by-Step Implementation Guide

### Before You Start

1. Copy `FEA-39-email-import-spec.md` into the repo root (or reference directory)
2. Make sure you're on latest `main`
3. Have Supabase CLI installed (`supabase` command available) for Edge Function deployment
4. Have the Postmark inbound webhook URL ready (or we'll set it up in Step 2)

---

### Step 1: Database Migration

**Prompt to Claude Code:**

```
Read FEA-39-email-import-spec.md (the email import spec) and CLAUDE.md.

Step 1: Create the pending_imports table in Supabase.

Run this SQL against the Supabase database (use the Supabase Dashboard SQL editor or supabase db push):

Create the `pending_imports` table exactly as specified in section 3.1 of the spec:
- All the candidate transaction fields (date, description, category_id, amount_usd, etc.)
- Raw email metadata fields (email_subject, email_from, email_body_text, email_body_html, email_message_id)
- Source-specific parsed_data JSONB
- AI enrichment fields
- Lifecycle fields (created_at, committed_at, committed_txn_id)
- Indexes on status, source, and email_message_id

Also add RLS policies:
- Enable RLS on pending_imports
- Allow authenticated users full CRUD access (same pattern as transactions table)
- Allow the service role full access (for the Edge Function)

Save the migration SQL to supabase/migrations/20260307_pending_imports.sql

Don't touch index.html yet.
```

---

### Step 2: Supabase Edge Function

**Prompt to Claude Code:**

```
Step 2 of FEA-39. Create the Supabase Edge Function for inbound email processing.

Create the file at: supabase/functions/inbound-email/index.ts

The Edge Function should:

A) Validate the webhook secret from the X-Webhook-Secret header against the INBOUND_EMAIL_SECRET env var.

B) Parse the Postmark inbound webhook JSON payload. Key fields: From, FromName, Subject, TextBody, HtmlBody, MessageID, Date.

C) Dedup: check if email_message_id already exists in pending_imports. If so, return 200 with {status: "duplicate"}.

D) Source detection: iterate EMAIL_PARSERS registry. Match on From address + Subject patterns.
   - venmo: from contains "venmo.com" AND subject contains "You paid" or "You received" or "paid you"

E) Venmo parser (parseVenmoEmail): Extract from the spec section 5.3:
   - Direction from subject: "You paid" → outgoing, "You received" / "paid you" → incoming
   - Counterparty name from subject (regex between "paid"/"received" and "$")
   - Amount from subject ($XXX.XX pattern)
   - Note from text body (between amount and "See transaction")
   - Date from text body ("Date\n<date>")
   - Transaction ID from text body
   - Build description: "Venmo - {counterparty} ({note})" for paid, "Venmo from {counterparty} ({note})" for received
   - payment_type = "Venmo"
   - amount_usd = positive for paid (expense), negative for received (income/credit)

F) AI categorization: if ANTHROPIC_API_KEY env var is set, call Claude API to:
   - For known sources: assign category based on parsed note/counterparty (enrichment prompt from spec 5.4)
   - For unknown sources: attempt full transaction extraction from email body (unknown email prompt from spec 5.4)

G) Build the candidate row using buildCandidate() from spec section 5.5.

H) INSERT into pending_imports via Supabase client (use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars).

I) Return 200 with {status: "ok", source: "<detected source>"}.

Error handling:
- Invalid webhook secret → 401
- Duplicate email → 200 {status: "duplicate"}
- Parser error → log error, fall through to AI fallback, store with parse_errors populated
- AI error → continue without AI enrichment, set ai_confidence="low"
- DB insert error → 500

Use Deno-compatible imports (https://esm.sh/@supabase/supabase-js@2).
```

---

### Step 3: Deploy Edge Function

**Prompt to Claude Code:**

```
Step 3 of FEA-39. Deploy the Edge Function and set up secrets.

1. Initialize Supabase functions if not already done:
   supabase functions new inbound-email (if the directory doesn't exist)

2. Set the required secrets:
   supabase secrets set INBOUND_EMAIL_SECRET=<generate a random 32-char token>
   supabase secrets set ANTHROPIC_API_KEY=<your key>
   
   (The SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-available in Edge Functions)

3. Deploy:
   supabase functions deploy inbound-email --no-verify-jwt
   
   Note: --no-verify-jwt is needed because Postmark sends webhooks without a Supabase JWT.
   We validate via the X-Webhook-Secret header instead.

4. Test with a curl command simulating a Venmo email:
   curl -X POST https://mjuannepfodstbsxweuc.supabase.co/functions/v1/inbound-email \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Secret: <your_secret>" \
     -d '{
       "From": "venmo@venmo.com",
       "FromName": "Venmo",
       "Subject": "You paid Aud Li $110.00",
       "TextBody": "You paid Aud Li\n$110.00\n\nBuoy\n\nSee transaction\n\nTransaction details\nDate\nMar 06, 2026\n\nTransaction ID\n4547378430212112103\n\nPayment Method\nVenmo balance\n\nSent from\n@Mark-Ren-3",
       "HtmlBody": "<html><body>You paid Aud Li<br>$110.00<br>Buoy</body></html>",
       "MessageID": "<test-001@venmo.com>",
       "Date": "Thu, 06 Mar 2026 09:12:00 -0800"
     }'

5. Verify: check pending_imports table for the new row:
   SELECT * FROM pending_imports ORDER BY created_at DESC LIMIT 1;

   Expected: source='venmo', description='Venmo - Aud Li (Buoy)', amount_usd=110.00, 
   payment_type='Venmo', parsed_data contains counterparty/note/txn_id

Don't touch index.html yet.
```

---

### Step 4: Frontend — Pending Import Banner

**Prompt to Claude Code:**

```
Step 4 of FEA-39. Add the pending email import banner to index.html.

Read the current index.html to understand the init() function and header structure.

In the init() function, AFTER the existing txnCount fetch and BEFORE renderContent(), add:

A) Fetch pending import count:
   - Direct fetch to pending_imports?status=eq.pending&select=id with Prefer:count=exact header
   - Parse count from content-range header (same pattern as txnCount)

B) If count > 0, create a banner element:
   - Insert it after the .hdr element (before #content)
   - Style: background rgba(74,111,165,0.15), blue text, centered, 12px font
   - Text: "📧 {count} pending email import(s) — Review"
   - On click: set state.tab="entry", renderTabs(), renderContent(), then auto-scroll to #emailImportSection

C) Store the count in state.pendingEmails so renderEntry() knows whether to auto-expand

D) Remove the banner when the email import section is committed (in the commit success handler)

Match the existing offline banner pattern for styling consistency.
```

---

### Step 5: Frontend — Email Import Section in Entry Tab

**Prompt to Claude Code:**

```
Step 5 of FEA-39. This is the big one. Add the Email Imports section to renderEntry() in index.html.

After the existing CSV Import card (impCard), add a new collapsible card:

A) Section header: "📧 Email Imports" with toggle arrow (▸/▾)
   - ID: emailImportSection
   - Auto-expand if state.pendingEmails > 0

B) Inside the collapsible body:

   1. Setup info bar:
      - "Forward transaction emails to:" with the Postmark inbound address shown in a copy-able mono span
      - Small help text: "Venmo, Rakuten, subscriptions, bank alerts — or any financial email"

   2. Load pending imports on expand:
      - Fetch: pending_imports?status=eq.pending&order=email_received_at.desc
      - If none: show "No pending imports" message
      - If some: render the review table

   3. Review table — REUSE the CSV import renderReviewTable pattern but adapted:
      - Summary stats: "X pending · Y from venmo · Z unknown"
      - Bulk actions: [✓ Approve All] [Save Approved]
      - Table columns: Status | Date | Source | Description | Amount | Category | Payment | Tag
      - Source column: colored badge (venmo=blue, rakuten=green, chase=yellow, unknown=gray)
      - Description: AI/parser description as main text, email subject as muted subtitle
      - Status cycling: same ○/✓/✕ pattern
      - Category: inline dropdown with confidence dot
      - Row click → edit modal

   4. Edit modal — reuse openImportEditModal pattern:
      - Same fields: date, description, category, amount, service start/end, payment type, tag
      - Extra read-only reference section:
        - "Email subject: {email_subject}"
        - "Source: {source}" 
        - If venmo: "Counterparty: {parsed_data.counterparty} · Note: {parsed_data.note}"
        - If unknown: show first 200 chars of email_body_text as reference
      - Save & Approve / Skip / Cancel buttons (same pattern)

   5. Commit flow (commitEmailImports):
      - Filter approved rows
      - Build transaction objects (same as commitImport for CSV)
      - Batch POST to transactions with import_batch = "email-YYYY-MM-DDTHH:MM"
      - PATCH each pending_imports row: status='committed', committed_at=now()
      - Show success summary with "View in Ledger" button
      - Remove the pending banner from header
      - Duplicate detection: same findDuplicates pattern (payment_type + date + amount)

IMPORTANT: The pending_imports rows already have all fields pre-populated by the Edge Function.
The frontend just needs to display them for review, allow edits, and commit.
The key difference from CSV import: data comes FROM the database (pending_imports), not from a file upload.

Match the existing Disciplan dark theme exactly.
```

---

### Step 6: Test End-to-End

**Prompt to Claude Code:**

```
Step 6 of FEA-39. Test the full pipeline.

1. Use the curl command from Step 3 to insert a test Venmo email into pending_imports

2. Verify pending_imports has the row:
   SELECT id, source, status, description, amount_usd, category_id, payment_type, 
          parsed_data, ai_category, ai_confidence
   FROM pending_imports 
   WHERE status = 'pending' 
   ORDER BY created_at DESC LIMIT 5;

3. Load disciplan.netlify.app (or serve locally):
   - [ ] Blue banner shows "📧 1 pending email import — Review"
   - [ ] Clicking banner navigates to Entry tab and scrolls to Email Imports section
   - [ ] Email Imports section auto-expands
   - [ ] Review table shows the test row with:
     - Source badge: "venmo" in blue
     - Description: "Venmo - Aud Li (Buoy)"
     - Amount: $110.00
     - Category: AI-assigned (or "other")
     - Payment: "Venmo"
   - [ ] Clicking row opens edit modal with:
     - All fields pre-populated
     - Email subject shown as reference
     - Counterparty and note shown from parsed_data
   - [ ] Approving and saving commits to transactions table
   - [ ] pending_imports row updated to status='committed'
   - [ ] Banner disappears
   - [ ] Transaction visible in Ledger tab

4. Test duplicate detection:
   - Run the same curl command again (same MessageID)
   - Edge Function should return {status: "duplicate"}
   - No new row in pending_imports

5. Test unknown email:
   - Send a curl with a non-Venmo email (from: "noreply@spotify.com", subject: "Your receipt for $9.99")
   - Should appear as source="unknown" with AI-extracted fields (if API key set)

6. Test edge cases:
   - Empty TextBody
   - Missing amount in subject
   - "You received" direction (should be negative amount, category "income")

Fix any bugs found. Don't git push yet.
```

---

### Step 7: Polish + Roadmap Update

**Prompt to Claude Code:**

```
Step 7 of FEA-39. Final polish.

1. Review the email import section for mobile responsiveness:
   - Source column: hide-m on narrow screens
   - Table scrolls horizontally
   - Edit modal doesn't overflow viewport

2. Add the Postmark inbound address to the Disciplan preferences table:
   INSERT INTO preferences (key, value) VALUES 
     ('inbound_email_address', '"[your-postmark-address]@inbound.postmarkapp.com"');
   
   Then in the frontend, fetch this preference and display it in the setup info bar.

3. Update disciplan-roadmap.md:
   - Add FEA-39 to "Next Up" section with the roadmap entry from spec section 10

4. Ensure the Edge Function handles Postmark's retry behavior:
   - Postmark retries failed webhooks (non-2xx) up to 3 times
   - Our dedup on email_message_id prevents duplicate processing on retries
   - Ensure we return 200 even for parse errors (to prevent retries for bad data)

5. Do a final code review — any cleanup needed?

Don't git push yet.
```

---

### Step 8: Deploy

**Prompt to Claude Code:**

```
All FEA-39 work is done. Commit everything and push to deploy.

git add -A
git commit -m "FEA-39: Email-to-Ledger Import Pipeline

- Postmark inbound email webhook → Supabase Edge Function
- pending_imports staging table with full lifecycle tracking
- Venmo parser: extracts counterparty, amount, note, date, txn ID from email
- AI fallback for unknown email sources (Claude API extraction)
- AI category enrichment for known sources (from Venmo note text)
- Email dedup via message_id
- Pending import banner on app load with count
- Collapsible Email Imports section in Entry tab
- Review table reusing CSV import UX (approve/edit/skip)
- Edit modal with email metadata reference
- Batch commit to transactions with import_batch tracking
- Duplicate detection against existing ledger
- Mobile responsive"

git push origin main
```

---

## 12. Postmark Setup Checklist

After implementation, complete these manual setup steps:

- [ ] Create Postmark account at postmarkapp.com
- [ ] Create a new Server → enable Inbound
- [ ] Note the inbound email address: `[hash]@inbound.postmarkapp.com`
- [ ] Set webhook URL: `https://mjuannepfodstbsxweuc.supabase.co/functions/v1/inbound-email`
- [ ] Add custom header in webhook settings: `X-Webhook-Secret: <your_secret>`
- [ ] Test by forwarding a real Venmo email to the inbound address
- [ ] Optional: Set up Gmail filter to auto-forward Venmo emails
- [ ] Store the inbound address in Disciplan preferences table

---

## 13. Security Considerations

- **Webhook auth**: The `X-Webhook-Secret` header prevents unauthorized POSTs. This is simpler than JWT auth for webhooks.
- **Email body storage**: Raw email HTML/text is stored in `pending_imports` for debugging. Consider adding a cleanup job to clear `email_body_html` after 30 days to save storage.
- **Anthropic API key**: Stored as a Supabase secret (`supabase secrets set`), never exposed to the frontend. The Edge Function uses it server-side only.
- **RLS**: `pending_imports` has RLS enabled — only authenticated users can read/write via the frontend. The Edge Function uses the service role key to bypass RLS for inserts.
- **No PII concerns**: Email bodies may contain names/amounts but this is your own financial data in your own Supabase project, same as transactions.

---

## 14. Cost Estimate

| Service | Free tier | Expected usage | Cost |
|---------|-----------|---------------|------|
| Postmark inbound | 100 emails/month | ~20-30 forwards/month | $0 |
| Supabase Edge Functions | 500K invocations/month | ~30/month | $0 |
| Supabase database | 500MB | ~1KB per pending_import row | $0 |
| Claude API (in Edge Fn) | Pay per use | ~30 calls × ~500 tokens each | ~$0.02/month |

**Total: effectively free.**