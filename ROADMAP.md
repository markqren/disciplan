# Disciplan — Roadmap & Feedback Tracker

**Last updated:** Apr 7, 2026 | [disciplan.netlify.app](https://disciplan.netlify.app) | Stack: index.html + js/*.js modules + Chart.js + Supabase

---



## 🚀 Releases

### v2.1 — Apr 4, 2026

#### v2.1.2
<sub>Pending deploy</sub>

##### Features
- **FEA-73: Income Tax Tracking in IS** — Collapsible Tax Payments card in the per-year Income Statement view. Shows 3 KPIs (YTD tax paid, effective rate = tax/gross income %, payment count), a monthly bar chart with running YTD line overlay (dual Y-axis), and a date-descending drilldown table (click any row to open the edit modal). Detection uses `category_id=financial` + regex `/\btax\b|\birs\b|\bftb\b/i` client-side — no schema changes required. Cross-year "All" view gains an Income Tax chart (bar = annual tax paid, line = effective rate %) and Tax + Tax% columns in the Annual Detail table (both conditionally hidden if no tax data exists). Tax data cached as `_dc['tax_all']` and included in `dcInvalidateTxns()`. (~8,000 tokens)
- **FEA-90: Year-over-Year Category Comparison** — Clicking any category column header in the Annual Detail table opens a modal showing that category's spending across all years. Bar chart (category color from `CC`), 3 KPIs (total all-time, avg/year, peak year). No new API calls — uses already-fetched `yearData`. Canvas ID keyed by `catId` to avoid chart conflicts. (~3,000 tokens)

##### Infrastructure
- **INF-07: Dual-Roadmap System** — Renamed `disciplan-roadmap.md` → `ROADMAP.md` (master, GitHub-only). Created `roadmap/` directory with three split files: `ACTIVE.md` (Next Up + Future, ~2K tokens), `RELEASES.md` (v0.5–v2.1 history, archive), `COMPLETED.md` (118 items, grep-only). Added `ROADMAP.md` to `.claudeignore` so Claude only loads the compact splits. Updated `CLAUDE.md` file map and workflow rules. Updated `README.md` with roadmap navigation. **84% token reduction** in Claude Code context per session (12.5K → 2K tokens for roadmap). (~6,000 tokens)
- **INF-07b: CLAUDE.md + MEMORY.md token trim** — Removed inline CC color map (17 lines) and payment types list from `CLAUDE.md`; replaced with pointers to `js/constants.js`. Fixed dead `tasks/` references in Self-Improvement Loop and Task Management sections. Condensed "Roadmap Workflow" memory entry (removed duplication with `CLAUDE.md`); removed "Editing Gotchas" memory entry (already in `CLAUDE.md:Known Patterns`). ~300 tokens saved per session. (~2,000 tokens)
- **INF-07c: Inverted roadmap architecture** — Made `roadmap/` splits the source of truth; `ROADMAP.md` is now a generated artifact built by `scripts/build-roadmap.sh`. Claude never reads or edits `ROADMAP.md` directly — eliminates the ~12K token chunk-read required every time release notes needed updating (file exceeded the 10K read limit, forcing 3 separate reads). Updated `CLAUDE.md` workflow rules, `MEMORY.md` roadmap workflow, split file comment headers, and `.claudeignore`. Workflow: edit splits → `bash scripts/build-roadmap.sh` → commit. (~2,500 tokens)

---

#### v2.1.1
<sub>Deployed 2026-04-06 18:52 UTC</sub>

##### Features
- **FEA-93: Subscription History Drilldown** — Clicking any row in the IS Subscriptions card (or the 🔄 badge on a subscription transaction in the Ledger) opens a modal showing the full transaction history for that merchant. Merchant matching uses `normalizeMerchant()` — strips trailing `(Month Year)` date suffixes, strips common prefixes (SQ \*, TST\*, etc.), lowercase first 2 words — so all variants of "Spotify (Jan 2026)", "Spotify (Feb 2026)" etc. group together. Modal shows 4 KPIs (total spend, occurrence count, monthly average `total / months_since_first`, first charged date), a scrollable transaction table (date, description, amount, payment type), and a footer with count + last charged date. Clicking any row opens `openLedgerEditModal` for that transaction. 🔄 badge click uses `stopPropagation` to avoid opening the edit modal for the parent row.

##### Performance
- **FEA-89: Lazy Tab Data Caching** — Tab switches no longer re-fetch data if the tab was already loaded this session. Added a `_dc` in-memory cache (keyed by `is_<year>`, `crossyear`, `bs`, `portfolio`) backed by `dcGet/dcSet/dcDel/dcInvalidateTxns/dcInvalidatePortfolio` helpers in `state.js`. IS, cross-year IS, Balance Sheet, and Portfolio each check the cache before fetching and populate it on miss. ↻ refresh button invalidates only the current tab's cache key, forcing a fresh fetch. Any transaction mutation (edit, delete, add via entry form, CSV/email import commit) calls `dcInvalidateTxns()`. Any portfolio mutation (lot add/edit/delete, price update, import) calls `dcInvalidatePortfolio()`. Common pattern of browsing between tabs without edits now requires zero redundant API calls.

---

#### v2.1.0
<sub>Deployed 2026-04-04 22:00 UTC</sub>

> **⚠️ Pending Postmark approval** — function + cron are live and tested end-to-end, but Postmark account is in sandbox mode (cross-domain sending blocked). Once approved: update `TO_EMAIL` back to `mark.q.ren2020@gmail.com` in `daily-insight/index.ts` and redeploy. Then test feedback loop by replying to an email with a rating.

##### Features
- **FEA-11: Daily AI Finance Insight Newsletter** — Supabase Edge Function (`daily-insight`) runs on a daily cron at 8am PT. Fetches 14 months of accrual expense/income data, calls Claude Sonnet 4.6 to pick the highest-value insight type for the day (trained preferences: `category_yoy` 8/10, `budget_pace` 7/10, etc.), writes a tight 2-3 sentence write-up with a Chart.js chart rendered via QuickChart.io, and sends via Postmark to mark.q.ren2020@gmail.com. Email includes key stat callout, chart image, CTA button to open the app, token cost in footer, and reply instructions.

  Feedback loop: replying with `8/10 comment text` is caught by the existing `inbound-email` Edge Function, matched to the original email via `In-Reply-To` → `postmark_message_id`, and stored in `insight_log`. If the comment is substantive (>20 chars), Claude Haiku distills it into an `insight_context` principles document that is prepended to every future prompt — foundational learnings accumulate over time. Recent feedback (last 10 rated insights) is also included in the prompt.

  Model strategy: start with Sonnet; switch to Haiku once average rating ≥ 7.5 over 20 samples.

---

### v2.0 — Apr 3, 2026

#### v2.0.1
<sub>Deployed 2026-04-04 00:19 UTC</sub>

##### Infrastructure
- **INF-03: Server-side tag accrual RPC** — Replaced client-side paginated fetch + JS accrual math in `renderTags()` with a single Supabase RPC `get_tag_summaries()`. Eliminates 5–12 REST calls (12,000+ rows transferred) on every Tags tab load. RPC computes `daily_cost × overlap_days` per tag/category in SQL and returns pre-aggregated totals. `showTagDetail()` still fetches individual transactions for the drill-down modal.
- **INF-04: Global Error Boundary** — `renderContent()` made `async`; all tab renderers now `await`ed inside a top-level `try/catch`. Previously, any unhandled async rejection left the content area blank ("Loading...") forever. Now shows a styled error card with the message and a Retry button. Error logged to console with tab name.

##### Fixes
- **BUG-25: Service Worker cache auto-rotation** — Replaced hardcoded `SW_VERSION` constant with `CACHE_STATIC` derived from a djb2 hash of `PRECACHE_URLS`. Cache key now auto-rotates whenever modules are added or removed, eliminating the manual version-bump requirement that caused v1.0.0 to persist through v1.2.x.

---

#### v2.0.0
<sub>Deployed 2026-04-03 17:44 UTC</sub>

##### Infrastructure
- **INF-02: Modular JS Split** — Split monolithic `index.html` (~3,800 lines) into 18 focused JS modules under `js/`. `index.html` reduced to ~250 lines (HTML shell, CSS, routing, auth). No build step — plain `<script>` tags with global scope. Each tab is its own file (30–500 lines), enabling ~90% token reduction in Claude Code per focused task. Added `CLAUDE.md` developer context and `.claudeignore`. Service Worker updated to v2.0.0 to cache all 18 modules.

---

<details>
<summary><strong>Previous Releases</strong> (v0.5.0–v1.2)</summary>

### v1.2 — Apr 1, 2026

#### v1.2.2
<sub>Deployed 2026-04-01 22:15 UTC</sub>

##### Fixes
- **BUG-24:** Payslip import only generated 3 line items when payslip had pre-tax 401K or FSA deductions. Root cause: (1) parser looked for `"401(k) After-tax Deferral"` but Pinterest pre-tax 401K appears as bare `"401(k)"` in Pre Tax Deductions; (2) no regex for `"Flex Spending Health"` (FSA label); (3) medical formula used full `preTaxTotal` without subtracting the pre-tax 401K and FSA amounts, inflating medical by ~$2,496. Fixed: added `preTax401k` and `fsa` detection; updated medical formula to `preTaxTotal − preTax401k − fsa + postTaxNon401k + gtl`; generates Pre-tax 401K + Vanguard Deposited Pre-tax 401K entries; generates FSA Deposit + FSA Deposited (Transfer / credit: FSA 2026) entries. After-tax 401K descriptions renamed to `"401K (Post-tax)"` / `"Vanguard Deposited 401K (Post-tax)"` to match reference CSV.
- **BUG-24b:** 401K employer match still not detected after BUG-24. Root cause: `fullText` joins raw PDF items in extraction order, not visual order — in multi-column layouts this interleaves labels and values from different rows, breaking regex matching. Switched `preTax401k`, `fsa`, and employer match detection to use the `lines` array (Y-sorted rows, X-sorted within row) so each regex matches against a single physical line. Employer match now detected from `"(Company|Employer) Match \d"` pattern per line.
- **FEA-87: Payslip XLSX Import** — Payslip import now accepts `.xlsx` in addition to `.pdf`. `parsePayslipXLSX()` uses SheetJS (already loaded for lot import) to parse the structured section rows (Pre Tax Deductions, Employer Paid Benefits, etc.) by direct Description string match — no regex, no PDF column-layout ambiguity. Definitively fixes employer match and all other deduction detection issues. File input updated to accept both formats; label updated to "Payslip (PDF or XLSX)"; dispatcher branches on file extension.

---

#### v1.2.1
<sub>Deployed 2026-03-31 23:12 UTC</sub>

##### Features
- **FEA-85: Email Import AI Enhancements** — AI can now read natural language instructions in the forwarding note (before the forwarding divider) to set or override service period, subscription status, and improve categorization. (1) **Service period:** `servicePeriodHint` extracted from note — AI interprets natural language like "covers Jan 1–15" and returns `{start, end}` which `computeServicePeriod()` converts to exact accrual math (inclusive days, `daily_cost = amount/days`). (2) **Subscription detection:** `is_subscription` boolean — AI flags recurring services from note keywords ("subscription", "monthly"), known services (Netflix, Spotify), email signals, or transaction history patterns. Stored on `pending_imports`, visible in review UI. (3) **Transaction history context:** `lookupTransactionHistory()` queries last 5 matching transactions by description anchor (ilike first 20 chars) — passed as AI context for consistent categorization and subscription pattern recognition. Non-blocking; omitted on failure.
- **FEA-86: Income Ingestion Pre-tax 401K + FSA Pattern** — Updated reference CSV to handle pre-tax 401K deductions and 50% employer match (Pinterest/Google pattern). Pre-tax 401K: deduction on Chase Chequing (financial) + equal offsetting deposit to Vanguard. 401K Match: separate income entry on Vanguard. FSA: `FSA Deposit` on Chase Chequing + equal offsetting `FSA Deposited` on Transfer/credit: FSA 2026 — FSA 2026 sub-account appears under Credits & Transfers on Balance Sheet. Retroactively applied to all 5 prior 2026 Pinterest payroll periods for $141.65 YTD.

##### Fixes
- **BUG-23:** Aggregated annualized returns all displayed as <1% (e.g. VTSAX showing +0.1% instead of ~+12%). Root cause: `Math.pow(mv/cost_basis, 365.25/days) - 1` returns a decimal (e.g. 0.12), but `fPct()` calls `.toFixed(1)` directly expecting percentage points. Fixed by multiplying the formula result by 100: `(Math.pow(...) - 1) * 100`. Per-lot and weighted-average aggregation now display correctly.

---

#### v1.2.0
<sub>Deployed 2026-03-31 05:18 UTC</sub>

**Price history, import confirmation, live API refresh, and display polish.**

##### Features
- **FEA-82: Price History** — New `investment_price_history` table. Every price update (manual edit, import confirm, or live API fetch) archives the previous price before overwriting. Market Prices table shows a `⦿` history button per symbol — click to expand an inline history panel with date, archived price, and Δ from current value.
- **FEA-83: Price confirmation on lot import** — After inserting lots, the flow fetches proposed prices (Yahoo Finance / CSV implied) without saving, then shows a confirmation table (Symbol | Current | New | Δ | Source). User can confirm and apply or skip entirely.
- **FEA-84: ↻ Live API button in price edit** — Clicking a price to edit now shows a "↻ Live" button alongside the manual inputs. Fetches from Yahoo Finance (5s timeout), auto-populates price + today's date, and saves with `source="live"`. Turns red with tooltip on failure; inputs remain open for manual fallback.

##### UI
- **UI-07: Import lot formatting + shares 2dp** — Parsed shares normalized to 4dp / price to 2dp at parse time. All share columns (symbol rows, lot rows, import preview) standardized to 2 decimal places. Preview dates use consistent formatted display.

##### Fixes
- **BUG-22:** Annualized return calculation didn't match source CSV values. Was using `(latest_price / price_exec)^(365.25/days) - 1` (price-per-share ratio), which diverges from the correct formula when `cost_basis` is commission-adjusted or rounded differently from `shares × price_exec`. Fixed to `(shares × latest_price / cost_basis)^(365.25/days) - 1` — exact match to spreadsheet formula `(Market Value / Book Value)^(365.25/days) - 1`. Aggregation (cost-basis-weighted average) was already correct.

---

### v1.1 — Mar 27, 2026

#### v1.1.3
<sub>Deployed 2026-03-28 01:02 UTC</sub>

- **BUG-20c:** Lot import button count frozen on deselect; deselected new lots not remembered. Root cause: per-row checkbox handler called `textContent` on the button which destroyed the inner `<span>`, causing subsequent `getElementById("pfIlImportCount")` calls to null-crash and halt execution. Fix: replaced span-based update with a single `updateLotImportBtn()` helper using `btn.textContent` cleanly. Added `localStorage.rejected_lots` (keyed by `symbol:date:shares`) — deselecting a new lot saves it as rejected; re-checking removes it. Rejected lots start pre-unchecked on future imports. Select-all also persists rejections per row.
- **BUG-21b:** Skipped/rejected auto-link suggestions had no persistence — "Skip All" dismissed the modal but the same pairs reappeared every page load. Added `rejected_links` in `localStorage` (keyed by sorted transaction ID pairs). Scan filters out rejected pairs before showing the modal. Unchecking a link + "Link Selected" permanently rejects unchecked items. "Reject All" (renamed from "Skip All") rejects all. ✕ closes without rejecting (genuine snooze).

---

#### v1.1.2
<sub>Deployed 2026-03-28 00:52 UTC</sub>

- **BUG-21:** Skipped auto-link suggestions were lost until the next email import. Added a scan on first ledger open each page load (`_linkScanDone` flag prevents repeat scans on filter/pagination). Skipped links resurface on next page refresh since transactions remain `transaction_group_id = null`.
- **BUG-20b: Fuzzy lot dedup** — Exact `shares.toFixed(4)` key still missed duplicates where share counts differed by rounding or manual-entry precision. New approach: symbol + date + shares within 2% tolerance (`|s1-s2| / max(s1,s2) < 0.02`). Catches rounding to integers, minor float drift, and data entry differences without conflating genuinely distinct same-day lots (e.g. 8 shares vs 2 shares stay separate).
- **UI-06: Version badge in header** — `v1.1.1` shown next to the logo in dim monospace; updates with each release.

---

#### v1.1.1
<sub>Deployed 2026-03-27 23:34 UTC</sub>

- **FEA-81: Portfolio Lot CSV/XLSX Import** — "↑ Import Lots" in Holdings header. Parses Schwab, eTrade, and Health Equity files (2+ detection signals each), deduplicates against existing lots, shows preview with New/Exists badges, then bulk-inserts and refreshes prices via Yahoo Finance (CSV implied-price fallback). Source badge (Live/CSV/Manual) in Market Prices table. Ann return now dynamic CAGR at render time.
- **BUG-20: Import lot dedup + per-row checkboxes** — Old dedup key used `price_exec` which broke on Supabase ISO timestamps and float drift. New key: `symbol + date(0,10) + shares.toFixed(4)`. Preview now shows a checkbox per row (new = pre-checked, existing = unchecked); select-all header toggle; Import button imports only checked rows.

#### v1.1.0
<sub>Deployed 2026-03-27 21:01 UTC</sub>

**IS drilldown grouping, auto-link confirmation, market prices, portfolio polish.**

##### Features
- **FEA-80: IS Drilldown Linked Transaction Grouping** — IS drilldown modal now collapses linked transactions (same `transaction_group_id`) into parent summary rows with blue left border, 🔗 count badge, group label, and chevron expand/collapse. Child rows hidden by default; click parent to reveal. Clicking a child row opens the edit modal. Consistent with the existing pattern in Ledger and Tags detail modal.
- **FEA-79: Auto-Link Confirmation Modal** — Reimbursement auto-linking now shows a confirmation modal before applying any links. Each proposed pair (expense + reimbursement) is listed with descriptions, amounts, and confidence score. All links pre-checked; uncheck any to skip. "Link Selected" applies only checked items; "Skip All" dismisses without linking. Fixes repeated bad links (e.g. Yadav → Balance adjustment) caused by unlinked transactions re-entering the scoring pool.
- **FEA-78: Market Prices Table** — New card in the Portfolio tab listing all active holdings with their current price, source badge (Live/CSV/Manual), and "as of" date. Click any price cell to edit inline (price + date inputs). Saves to `investment_symbols.latest_price` / `price_as_of` / `price_source` via PATCH, then re-renders the full portfolio so all market values, gains, and KPIs update immediately.

##### UI
- **UI-05: Emoji favicon** — Browser tab now shows 💵 instead of the default globe icon.

##### Fixes
- **BUG-19:** Rakuten cashback imported as `income` category instead of inheriting from the linked parent purchase. Edge Function was hardcoding `category_id: "income"`. Changed to `null` — `linkRakutenCashback` already patches the category from the parent when found; unlinked imports now require manual assignment rather than silently miscategorizing.
- **BUG-18:** "+ Add Holdings" button rendered full-width due to `.btn` class having `width:100%`. Fixed by adding `width:auto` inline style to the button.

---

### v0.9.0 — Mar 23, 2026
<sub>Deployed 2026-03-24</sub>

**Linked transaction aggregation, budget auto-sum fix, and UI polish.**

#### Features
- **FEA-37: Rakuten Cashback Email Import** — Rakuten parser in Edge Function extracts cashback amount and order date from forwarded emails (detects Rakuten via email body for forwarded messages). Store name provided via forwarding note. Parser description ("Rakuten - {Store}") is protected from AI override. On commit, auto-links cashback to the parent purchase transaction via fuzzy store name match (±30 days), inherits parent's category and service dates, and creates a `cashback_redemptions` record (card: "Rakuten") so it appears in the Cashback tab.
- **FEA-69: Linked Transaction Aggregation in Ledger** — Linked transactions (same `transaction_group_id`) collapse into a single summary row by default showing net amount, dominant category/payment/tag, and union service period. Click chevron to expand and reveal indented child rows. AI-powered smart labels via Claude API (cached in sessionStorage) with heuristic fallback. Group checkbox selects all members. Clicking a linked transaction in the edit modal opens that transaction directly. Changing service dates on a linked transaction prompts to update all other linked transactions.

#### UI
- **UI-02: Unrealized G/L Sign + Color** — IS KPI card for Unrealized G/L now shows `+$84K` (green) for gains and `($84K)` (red) for losses, instead of static teal color.
- **UI-03: Cashback Points Redemption Rate** — Points redemptions in the Cashback tab now show points count and cents-per-point rate inline to the left of the dollar value (e.g., `14,060 pts · 1.63¢/pt  $229.18`).
- **UI-04: IS Average Uses Completed Months Only** — Monthly Detail table averages now sum only completed months (e.g., Jan+Feb in March) and divide by that count, instead of including the current partial month.

#### Fixes
- **BUG-17:** Rakuten email import fixes — Detection now checks email body (not just `from` address) for forwarded emails. Amount extraction skips nav link text ("Earn $50") and finds the actual cashback amount near order data. Auto-linking inherits parent transaction's category and service dates. Cashback redemption record uses card "Rakuten" and correct `cashback_type` ("Dollar Value").
- **BUG-16:** Budget target auto-sum — Total Expenses target now auto-sums from parent category targets. Parent categories with subcategories (food, home, entertainment, personal) auto-sum from their children. Savings Rate target = 100% − Total Expenses target. These rows are no longer manually editable.

---

### v0.8.0 — Mar 20, 2026
<sub>Deployed 2026-03-20</sub>

**Subscription detection, live FX rates, investment visibility, AI model selection, BS reorder, and bug fixes.**

#### Features
- **FEA-07: Investment Category Toggle in IS** — "Show Inv" / "Hide Inv" toggle button in Income Statement and cross-year headers. When toggled on, investment appears as a top-level expense row in the detail table, pie chart, stacked chart, budget chart, and totals. IS drilldown includes investment transactions when toggled on. Tags, reimbursement, and cashback remain unaffected.
- **FEA-34: Live FX Rates + CAD Display** — Fetches live exchange rates from frankfurter.app on app load, updating all DFX currencies dynamically. Balance Sheet TD accounts show accurate CAD equivalents using the live rate. BS subtitle displays current CAD/USD rate and date. New transactions entered via the Entry form or Edit modal automatically use the live rate. Falls back to hardcoded defaults if the API is unavailable.
- **FEA-68: AI Model Selector for CSV Import** — Model dropdown in CSV import UI with Haiku 4.5 (fast, default) and Sonnet 4 (quality) options. Choice persisted in localStorage. Haiku is significantly cheaper and faster; Sonnet available when higher categorization accuracy is needed.
- **FEA-67: Subscription Detection & Management** — Supabase RPC `detect_subscriptions` analyzes transaction history to identify recurring subscriptions (3+ occurrences, ~monthly cadence or month/year in description, consistent amounts, service_days > 1). Excludes rent/income/investment. Results fed into CSV import AI prompt for better categorization + auto-applies month accrual for detected subscriptions. IS tab gets a collapsible "Subscriptions" card showing active/stopped subscriptions with KPIs (count, monthly/annual cost) and sortable table. Ledger rows display 🔄 badge for subscription transactions, with a "Subs" filter toggle to show only subscriptions.
- **FEA-70: Balance Sheet KPI Reorder** — Reordered summary cards: Assets → Liabilities → Credits & Transfers → Net Worth (previously Net Worth appeared before Credits).
- **FEA-71: Manual Subscription Flag** — Added `is_subscription` boolean column to transactions. Edit modal and entry form have a "Subscription" checkbox. Flagging any transaction as a subscription makes all transactions from that merchant appear as subscriptions (via `detect_subscriptions` RPC UNION with manual flags). Enables tracking annual or infrequent subscriptions (e.g. Flighty Pro) that auto-detection misses.
- **FEA-72: Transfer Credit Sub-Account Dropdown** — When payment type is "Transfer", a credit sub-account dropdown appears in both the entry form and edit modal. Populated from existing credit names in the DB, with an "Other…" option for custom entry. Saves to the `credit` field, which determines where the transaction posts in the Balance Sheet's Credits & Transfers section. Automatically hidden when payment type is not Transfer.

#### Fixes
- **BUG-15:** Tag date editing broken — Both tag card and tag detail modal date editors were using direct `fetch()` with the anon key instead of the authenticated session token, causing "failed to fetch" errors with RLS policies. Fixed by routing through `sb()` helper which uses `authHeaders()`.

---

### v0.7.0 — Mar 16, 2026
<sub>Deployed 2026-03-16 19:47 UTC</sub>

**Portfolio grouping, tags editing, import improvements, and reimbursement enhancements.**

#### Features
- **FEA-57: Manual Cashback Redemption Form** — "+ Add" button on Recent Redemptions section in Cashback tab. Inline collapsible form creates standalone `cashback_redemptions` records (no linked transaction). Fields: date, item, card (from CB_COLORS), type (Dollar Value/Points), dollar value, points redeemed + rate. Points mode auto-computes dollar value. Undo toast support.
- **FEA-58: Ledger Tag Filter** — Tag dropdown in ledger filter bar (between Payment Type and Date Range). Populated from `tags` table. Filters via `&tag=eq.<name>` Supabase query. Resets with Clear button.
- **FEA-59: Portfolio Institution Grouping** — Holdings section groups accounts by institution. Multi-account institutions (Charles Schwab, eTrade) render as expandable parent rows with aggregated Cost/Market/Gain/Return/Ann. totals and blue left border accent. Three-level drill-down: Institution → Account → Symbol/Lots. Single-account institutions remain flat.
- **FEA-60: Editable Target Allocation** — Click any target percentage in the Asset Allocation legend to inline-edit. Number input replaces the label; Enter/blur commits, Escape cancels. Red warning if targets don't sum to 100%. Subtitle updates dynamically. In-memory only (resets on reload).
- **FEA-61: Monthly Accrual Defaults for Imports** — Categories with "month" accrual type (rent, utilities) now default `service_start` to the 1st of the month and `service_end` to end of month during CSV/email import. All edit modals and category-change handlers updated. AI prompt expanded to append month/year to subscriptions, utilities, and gym memberships (e.g. "Trainability Gym (Jan 2026)").
- **FEA-62: CC Bill Payment Auto-Linking** — CC payment Side A ("Bill Paid: Chase Sapphire") and Side B ("Chase Sapphire Bill Payment") transactions created during CSV import are now automatically linked via `transaction_group_id`. Uses existing `linkToGroup()` after batch insert.
- **FEA-63: Reimbursement Form Improvements** — Person dropdown now only shows recently used reimbursement recipients (ordered by most recent), not Transfer credit names. Added "Manual" split option for entering any dollar amount directly, uncapped (can exceed original transaction amount).
- **FEA-64: Editable Tag Dates** — Click the date range under any tag card title to inline-edit start/end dates with date pickers. Changes PATCH the `tags` table in Supabase and re-render the tag card with recalculated accrual totals. Same editing available in the tag detail modal. Escape to cancel, validation ensures start ≤ end.
- **FEA-65: Tag Out-of-Window Flags** — Tag detail modal transaction rows are visually flagged when their service period falls outside the tag's date window. Two levels: red dashed outline + red tint for completely outside (zero overlap, $0 accrual — possible date error), orange dashed outline for partial overlap. Hover tooltip shows actual service dates. Zero-overlap transactions now included in the list instead of being silently hidden.
- **FEA-66: Import Link to Staged Candidates** — CSV import "Link to Transaction" search now also shows staged (unsaved) candidates from the same import batch. Results split into "Staged in this import" and "Existing transactions" sections. Staged results display a yellow "Staged" badge. On commit, staged-to-staged links are resolved using `linkToGroup()` with deduplication to prevent double-linking.

#### Fixes
- **BUG-14:** IS category column truncation — Widened fixed-layout category column from 110px to 140px so full names (e.g. "Entertainment") display without clipping.

---

### v0.6.0 — Mar 15, 2026
<sub>Deployed 2026-03-15</sub>

**Cashback tracking, PWA, drilldowns, and entertainment subcategories.**

#### Features
- **FEA-14: Cashback & Rewards Tab** — New tab with KPI cards (total redeemed, annual fees, net CC gain, active cards), per-card summary table, stacked bar chart by year, and recent redemptions list. 208 historical redemptions imported. Cashback button in ledger edit creates linked income transaction + cashback record with undo support.
- **FEA-23: Offline Caching / PWA** — Service Worker caches app shell with stale-while-revalidate strategy. `localStorage`-based API data caching with LRU eviction. PWA manifest enables Add to Home Screen. Offline mode messaging for Entry/Export tabs. "New version available" banner on SW update.
- **FEA-56: Ledger Copy-Paste** — Copy button in batch action bar exports selected rows as TSV for pasting into spreadsheets.
- **FEA-28: Monthly IS Drilldown** — Click any month x category cell to see top transactions sorted by accrual contribution. Supports parent categories, subcategories, Total Expenses, and Income. Click-through to ledger edit modal.
- **FEA-55: Bilt CSV Import** — Bilt credit card CSV support with dual format detection (new + legacy headerless). Bilt-specific AI categorization hints.
- **FEA-53: Import Edit Modal Linking** — "Link to Transaction" search UI in CSV import edit modal. Pre-link candidates to existing transactions before commit.
- **FEA-03: Entertainment Subcategories** — Added `accommodation` and `games` as subcategories under Entertainment. LLM-assisted migration reclassified 351 of 1,299 entertainment transactions (167 accommodation, 184 games) via Claude Haiku with grouped human review.

#### Fixes
- Mobile IS: hide month columns, add tap-to-expand with chevrons

---

### v0.5.0 — Mar 14, 2026

**Import linking, AMEX import, payslip improvements, batch ledger ops.**

#### Features
- **FEA-53: Transaction Linking in Import** — Link imported candidates to existing transactions during CSV import review.
- **FEA-48: AMEX Rose Gold CSV Import** — AMEX bank profile with header auto-detection, column mapping, `detectPayment` for AUTOPAY rows, `detectCredit` for AMEX credit/reward rows.
- **FEA-50: 401K Company Match in Payslip** — Parses employer match lines, generates separate "401K Match" income transaction on Vanguard.
- **FEA-49: Linked Group Visual Separation** — Horizontal dividers between different linked groups in ledger. Payslip auto-linking via `transaction_group_id`.
- **FEA-47: Ledger Batch Selection & Operations** — Multi-select checkboxes with floating action bar. Batch Edit, Link, Delete with two-click confirmation.

#### Fixes
- **BUG-12:** Credits & Transfers total no longer offsets real liabilities in Balance Sheet.
- **BUG-13:** Payslip duplicate detection now compares service dates, preventing false positives.
- Hide ledger checkboxes behind Select button toggle.

</details>

---



## 🔧 Next Up

| ID | Item | Type | Priority | Details |
|----|------|------|----------|---------|
| FEA-29B | **Splitwise API Sync** | Feature | **Medium** | Splitwise has a free Self-Serve API (dev.splitwise.com) that supports OAuth2 and provides `getExpenses()` with date filters, plus `getFriends()` and `getGroups()`. Build a sync feature that: (1) authenticates with Splitwise via OAuth2 (register app at secure.splitwise.com/oauth_clients), (2) fetches expenses where the user owes or is owed money, (3) maps Splitwise expenses to Disciplan transactions — expenses you paid get the actual category + a Splitwise reimbursement credit for others' shares, expenses others paid show as your owed share under the "Splitwise" payment type, (4) maintains a "Splitwise" account in the balance sheet that tracks your net balance (what you're owed minus what you owe), which should stay in sync with your actual Splitwise balance. REST API called directly with fetch(). Rate limits are conservative so sync should be periodic (manual trigger or daily), not real-time. Supersedes FEA-16. **Depends on:** FEA-29A (done), FEA-38 (Working Capital reclassification). |

---

## 🔮 Future

| ID | Item | Type | Priority | Details |
|----|------|------|----------|---------|
| FEA-09 | **Plaid Integration** | Feature | High | Auto-sync bank account balances via Plaid API. Needs backend endpoint (Supabase Edge Function) for token management. Auth prerequisite done (FEA-10). |
| FEA-13 | **Income Tracking & Net Savings** | Feature | Medium | Already partially done (IS shows income + savings rate). Could integrate deeper with Investments tab for full financial picture. |
| FEA-17 | **Recurring Transaction Templates** | Feature | Low | Auto-generate recurring expenses (rent, subscriptions) each month instead of manual entry. Would reduce data entry burden before Plaid is live. |
| UI-01 | **IS Unrealized G/L Card + Ledger Filter Compaction** | UI | **High** | Investment as standalone 5th KPI card ("Unrealized G/L") in IS, separate from expenses/savings rate. `.g5` grid for 5-column stats. Detail table row with per-month drilldown. Cross-year G/L column. Remove "Show Inv" toggle. Ledger filter buttons condensed to emoji-only with tooltips. |
| FEA-25 | **Live Stock Prices in Portfolio** | Feature | High | Fetch real-time (or daily-close) stock/ETF/crypto prices from a free API and display live market values on the Portfolio tab. Currently portfolio valuations are static snapshots — this would show up-to-date prices alongside cost basis for accurate unrealized gain/loss. API options: Yahoo Finance (unofficial), Alpha Vantage (free tier: 25 req/day), Finnhub, or Twelve Data. Implementation: (1) on Portfolio tab load, collect unique ticker symbols from `investment_lots`, (2) batch-fetch current prices, (3) compute live market value per lot/symbol/account (shares × current price), (4) update KPI cards (Market Value, Unrealized Gain, Total Return %) with live figures, (5) show "as of" timestamp and a manual refresh button. Considerations: API rate limits (cache prices for 15 min), handle market-hours vs after-hours, crypto tickers may need different API, Schwab 401K has no ticker (keep hardcoded or manual). |
| INF-05 | **Supabase RLS Policies** | Infra | Medium | Auth is Phase 1 only — no Row Level Security on transactions or other tables. The anon key is visible in source, meaning anyone inspecting the page can read/write all data via the REST API. Add RLS policies (`user_id = auth.uid()`) to: `transactions`, `tags`, `accounts`, `balance_snapshots`, `pending_imports`, `cashback_redemptions`, `investment_lots`, `investment_symbols`, `investment_accounts`, and `group_overrides`. Not urgent for single-user but becomes critical if sharing the URL or adding users. **Depends on:** FEA-10 (auth, done). |
| FEA-88 | **Import Merchant Patterns RPC** | Feature | Medium | `fetchMerchantPatterns()` pulls ALL transactions (description + category_id) on every CSV import to build a frequency table for AI categorization context. At 12K+ rows this is a large payload. Replace with a Supabase RPC that returns aggregated patterns server-side: `SELECT description, category_id, COUNT(*) FROM transactions GROUP BY 1,2 HAVING COUNT(*) > 2 ORDER BY 3 DESC LIMIT 200`. Reduces import startup time and network transfer. |
| FEA-91 | **Full-Text Transaction Search** | Feature | Low | Ledger search uses `ilike` pattern matching which is slow on 12K+ rows. Add `credit.ilike.*q*` to the existing OR filter (allows searching credit sub-accounts). Longer term, add a Supabase full-text search index (`to_tsvector`) on description for faster searches. |
| FEA-92 | **Data Integrity Health Check** | Feature | Low | Background validation (on-demand or periodic) checking for: orphaned `transaction_group_id` references (groups with only 1 member), transactions where `daily_cost × service_days` diverges from `amount_usd` beyond rounding tolerance, tags referenced in transactions but missing from the `tags` table, and potential duplicate transactions (same date + amount + description + payment_type). Surface results as a "Data Health" indicator or a section in the Export tab. |
| INF-06 | **Cache Version Key** | Infra | Low | sessionStorage cache keys use prefix `dc_` without versioning. If RPC response shapes change (new columns, renamed fields), stale cached data causes rendering errors on next load. Add a version segment to the prefix (e.g., `dc_v2_`) and bump on schema changes. Trivial to implement. |

---

<details>
<summary><strong>✅ Completed</strong> (134 items)</summary>



| ID | Item | Type | Completed |
|----|------|------|-----------|
| INF-07c | **Inverted roadmap architecture** — `roadmap/` splits are now source of truth; `ROADMAP.md` is generated by `scripts/build-roadmap.sh`. Eliminates ~12K token chunk-read on every release notes update. Workflow: edit splits → run build script → commit. | Infra → Done | Apr 7 |
| FEA-90 | **Year-over-Year Category Comparison** — Click any category header in cross-year Annual Detail table → modal with bar chart + 3 KPIs (total, avg/year, peak year). Uses cached `yearData`, no new API calls. Canvas ID keyed by `catId`. | Feature → Done | Apr 7 |
| INF-07b | **CLAUDE.md + MEMORY.md token trim** — Removed inline CC color map + payment types list from `CLAUDE.md` (replaced with `js/constants.js` pointers). Fixed dead `tasks/` references. Condensed Roadmap Workflow memory; removed duplicate Editing Gotchas memory. ~300 tokens saved per session. | Infra → Done | Apr 7 |
| INF-07 | **Dual-Roadmap System** — Renamed `disciplan-roadmap.md` → `ROADMAP.md` (master, GitHub-only). Created `roadmap/ACTIVE.md` (Next Up + Future, ~2K tokens), `roadmap/RELEASES.md` (history archive), `roadmap/COMPLETED.md` (118 items, grep-only). `ROADMAP.md` added to `.claudeignore`. 84% token reduction in Claude Code context per session. | Infra → Done | Apr 7 |
| FEA-73 | **Income Tax Tracking in IS** — Collapsible Tax Payments card per year: 3 KPIs (YTD paid, effective rate %, count), monthly bar + YTD line chart, drilldown table with edit click-through. Cross-year: annual tax bar + effective rate line chart, Tax/Tax% columns in detail table. Detection: `category_id=financial` + `/\btax\b|\birs\b|\bftb\b/i`. Cached as `tax_all`. | Feature → Done | Apr 7 |
| FEA-93 | **Subscription History Drilldown** — Clicking a subscription row in IS or 🔄 badge in Ledger opens a modal with merchant history. KPIs: total spend, occurrence count, monthly avg, first charged. Scrollable table with click-through to edit modal. `normalizeMerchant()` groups all date-suffixed variants. | Feature → Done | Apr 6 |
| FEA-89 | **Lazy Tab Data Caching** — In-memory `_dc` cache prevents redundant API calls on tab switches. IS (per year), cross-year IS, Balance Sheet, and Portfolio each cache their fetch results. ↻ invalidates current tab only. Mutations call `dcInvalidateTxns()` or `dcInvalidatePortfolio()` to keep data fresh after edits. | Feature → Done | Apr 6 |
| FEA-11 | **Daily AI Finance Insight Newsletter** — `daily-insight` Edge Function sends a daily email (8am PT) via Postmark with Claude-written insight, QuickChart chart, and feedback loop. Replies rated `X/10` update `insight_log`; substantive comments distilled into `insight_context` principles by Haiku. Foundational learnings accumulate across emails. Trained on 15 insight types before launch. | Feature → Done | Apr 4 |
| FEA-87 | **Payslip XLSX Import** — `.xlsx` accepted alongside PDF. `parsePayslipXLSX()` parses structured section rows by Description string match (no regex, no PDF layout ambiguity). Definitively fixes employer match detection. File input + label updated. | Feature → Done | Apr 1 |
| BUG-24b | **401K employer match not detected after BUG-24 fix** — `fullText` joins raw PDF items in extraction order; multi-column layout interleaves labels and values. Switched `preTax401k`, FSA, and match detection to `lines` array (Y-sorted rows). Employer match now reliably detected per physical line. | Bug → Done | Apr 1 |
| BUG-24 | **Payslip import missing pre-tax 401K and FSA line items** — Parser only matched `401(k) After-tax Deferral`; Pinterest uses bare `401(k)` in Pre Tax Deductions. Added `preTax401k` + `fsa` (`Flex Spending Health`) detection. Fixed medical formula to subtract both. Added FSA double-entry (Transfer / credit: FSA 2026). 3 items → 8 items on 03/31/26 payslip. | Bug → Done | Apr 1 |
| FEA-86 | **Income Ingestion Pre-tax 401K + FSA Pattern** — Reference CSV updated for Pinterest/Google pre-tax 401K (Chase deduction + Vanguard deposit + 50% match income) and FSA double-entry (FSA Deposit on Chase + FSA Deposited to Transfer/FSA 2026 sub-account). Retroactively applied to all 5 prior 2026 payroll periods. | Feature → Done | Mar 31 |
| FEA-85 | **Email Import AI Enhancements** — Natural language service period hints from forwarding note, `is_subscription` flagging (from keywords, known services, or history patterns), and last-5-match transaction history passed as AI context. `computeServicePeriod()` does exact accrual math from AI-returned `{start, end}`. | Feature → Done | Mar 31 |
| BUG-23 | **Annualized returns displayed as <1%** — `Math.pow(...)-1` returns a decimal (0.12); `fPct()` expects percentage points. Fixed by multiplying formula result by 100. | Bug → Done | Mar 30 |
| BUG-22 | **Annualized return mismatch with source CSVs** — Was computing `(price/price_exec)^(365.25/days)-1`. Fixed to `(shares×price/cost_basis)^(365.25/days)-1` to match spreadsheet formula `(Market/Book)^(365.25/days)-1`, correctly handling commission-adjusted cost basis. | Bug → Done | Mar 30 |
| FEA-84 | **↻ Live API button in price edit** — "↻ Live" button in inline price editor fetches Yahoo Finance (5s timeout), auto-populates price + today's date, saves with `source="live"`. Turns red on failure. | Feature → Done | Mar 30 |
| UI-07 | **Import lot formatting + shares 2dp** — Shares display standardized to 2dp everywhere. Parsed lots normalized to 4dp shares / 2dp price. Preview dates use `fmtD()`. | UI → Done | Mar 30 |
| FEA-83 | **Price confirmation on lot import** — Import flow fetches proposed prices (Yahoo/implied) without saving, shows confirmation table (Symbol / Current / New / Δ / Source) before applying. User can confirm or skip. | Feature → Done | Mar 30 |
| FEA-82 | **Price history** — `investment_price_history` table logs old price before every update. Market Prices table has `⦿` per symbol to view inline history with Δ from current. | Feature → Done | Mar 30 |
| BUG-20c | **Lot import count frozen + deselections not remembered** — Per-row checkbox handler was calling `textContent` on the import button (destroying inner `<span>`), causing `getElementById("pfIlImportCount")` to null-crash and freeze the count display. Fixed with single `updateLotImportBtn()` helper. Added `localStorage.rejected_lots` (keyed `symbol:date:shares`) — unchecking a new lot persists the rejection; re-checking removes it. Rejected lots start pre-unchecked on future imports. | Bug → Done | Mar 27 |
| BUG-21b | **Auto-link rejections not persisted** — Skipping the modal had no memory; same bad pairs reappeared every page load. Added `localStorage.rejected_links` (sorted ID pairs). Scan filters rejected pairs before showing modal. Unchecking + "Link Selected" rejects unchecked items; "Reject All" rejects everything. ✕ snoozes without rejecting. | Bug → Done | Mar 27 |
| BUG-21 | **Skipped auto-links not re-surfaced** — Skipped suggestions were lost until the next email import. Added scan on first ledger open per page load (`_linkScanDone` flag prevents repeat scans on filter/pagination). Skipped links return on next page refresh since transactions stay `transaction_group_id = null`. | Bug → Done | Mar 27 |
| UI-06 | **Version badge in header** — `v1.1.x` shown next to the logo in dim monospace. | UI → Done | Mar 27 |
| BUG-20b | **Fuzzy lot dedup** — Exact share key still missed duplicates from rounding/manual-entry differences. New: symbol + date + shares within 2% tolerance. | Bug → Done | Mar 27 |
| BUG-20 | **Import lot dedup false positives + no row control** — Dedup key used `price_exec.toFixed(4)` which failed when Supabase returned ISO timestamps for `lot_date` and on float drift. Fixed key: `symbol + date.slice(0,10) + shares.toFixed(4)`. Added per-row checkboxes (new = pre-checked, exists = unchecked), select-all toggle, and Import button respects selection. | Bug → Done | Mar 27 |
| FEA-81 | **Portfolio Lot CSV/XLSX Import** — "↑ Import Lots" button in Holdings header. Supports Schwab, eTrade, and Health Equity formats (2+ detection signals each). Deduplicates against existing lots (symbol+date+price key). Preview table with New/Exists badges. Imports missing symbols and lots, then refreshes prices via Yahoo Finance (5s timeout) with CSV implied-price fallback. `price_source` column (`live`/`csv`/`manual`) shown as badge in Market Prices table. Ann return now computed dynamically via CAGR at render time. XLSX supported via lazy-loaded SheetJS CDN. | Feature → Done | Mar 27 |
| BUG-19 | **Rakuten cashback miscategorized as income** — Edge Function hardcoded `category_id: "income"`. Changed to `null`; category is now inherited from the parent purchase via `linkRakutenCashback`. Unlinked imports require manual assignment. | Bug → Done | Mar 27 |
| UI-05 | **Emoji favicon** — Browser tab shows 💵 via SVG data URL favicon instead of the default globe icon. | UI → Done | Mar 27 |
| FEA-80 | **IS Drilldown Linked Transaction Grouping** — IS drilldown modal now collapses linked transactions into parent summary rows (blue border, 🔗 badge, label, chevron). Child rows hidden by default; click parent to expand. Consistent with Ledger and Tags modal grouping. | Feature → Done | Mar 27 |
| FEA-79 | **Auto-Link Confirmation Modal** — Reimbursement auto-linking now shows a confirmation modal before applying any links. Each proposed pair lists expense + reimbursement with descriptions, amounts, and confidence score. All pre-checked; uncheck any to skip. Fixes repeated bad links (e.g. Yadav → Balance adjustment). | Feature → Done | Mar 27 |
| FEA-78 | **Market Prices Table** — New card in the Portfolio tab showing all active holdings with their current price and as-of date. Click any price cell to edit inline (price + date). PATCHes `investment_symbols` and re-renders the full portfolio so market values, gains, and KPIs update immediately. Manual entry now; API sync planned. | Feature → Done | Mar 25 |
| BUG-18 | **"+ Add Holdings" button full-width** — `.btn` class has `width:100%` which caused the button in the Holdings card header to render full-width. Fixed by adding `width:auto` inline style. | Bug → Done | Mar 25 |
| FEA-76 | **Editable Group Summary with AI Learning** — Clicking a linked group summary row opens a Group Detail Modal with editable description, category, payment type, and tag. Manual edits persist in `group_overrides` Supabase table. AI labels incorporate past corrections as few-shot examples. Reset button reverts to auto-computed values. | Feature → Done | Mar 25 |
| FEA-77 | **Portfolio Lot Management** — Inline edit shares/price on lot rows (PATCH with auto cost_basis), "+ Add Lot" row within expanded symbols (POST), "+ Add Holdings" button with account/symbol/lot creation form (supports new accounts and symbols), delete lot with two-click confirmation (DELETE). Full portfolio re-render on every change. | Feature → Done | Mar 25 |
| FEA-75 | **Tag Detail Linked Transaction Grouping** — Tag detail modal collapses linked transactions into expandable summary rows (net amount/accrual, dominant category, 🔗 badge, group label). Chevron expands indented child rows. Groups sorted by |net accrual|. Overlap styling inherited from worst child. | Feature → Done | Mar 25 |
| UI-04 | **IS Average Uses Completed Months Only** — Monthly Detail averages sum only completed months and divide by that count, excluding the current partial month. Applies to categories, totals, income, net savings, and savings rate. | UI → Done | Mar 23 |
| UI-03 | **Cashback Points Redemption Rate** — Points redemptions show pts count and ¢/pt rate inline to the left of the dollar value in the Recent Redemptions table. | UI → Done | Mar 23 |
| FEA-37 | **Rakuten Cashback Email Import** — Rakuten parser in Edge Function extracts cashback amount and order date from forwarded emails (detects via email body). Store name from forwarding note. On commit, auto-links to parent purchase (fuzzy store match ±30 days), inherits category + service dates, creates `cashback_redemptions` record (card: Rakuten). | Feature → Done | Mar 24 |
| FEA-69 | **Linked Transaction Aggregation in Ledger** — Linked groups collapse into summary rows (net amount, dominant fields, union service period, AI smart labels). Click to expand child rows. Edit modal links open target transaction directly. Service date changes prompt to update all linked members. | Feature → Done | Mar 23 |
| UI-02 | **Unrealized G/L Sign + Color** — IS KPI card shows +$X (green) for gains, ($X) (red) for losses instead of static teal. | UI → Done | Mar 23 |
| BUG-16 | **Budget Target Auto-Sum** — Total Expenses auto-sums from parent category targets. Parents with subcategories auto-sum from children. Savings Rate = 100% − expenses. No longer manually editable. | Bug → Done | Mar 23 |
| FEA-72 | **Transfer Credit Sub-Account Dropdown** — Credit sub-account dropdown in entry form and edit modal, visible when payment type is "Transfer". Populated from existing DB credit names + "Other…" for custom entry. Saves to `credit` field for Balance Sheet Credits & Transfers posting. | Feature → Done | Mar 20 |
| FEA-71 | **Manual Subscription Flag** — Added `is_subscription` column to transactions. Checkbox in edit modal and entry form. Flagging one transaction makes all same-merchant transactions appear as subscriptions via updated `detect_subscriptions` RPC. Covers annual/infrequent subscriptions that auto-detection misses. | Feature → Done | Mar 20 |
| BUG-15 | **Tag Date Edit Auth Fix** — Tag card and tag detail modal date editors were bypassing `authHeaders()` with direct `fetch()` using the anon key, causing "failed to fetch" errors under RLS. Fixed both to use `sb()` helper. | Bug → Done | Mar 19 |
| FEA-68 | **AI Model Selector for CSV Import** — Added model dropdown (Haiku 4.5 default, Sonnet 4 option) to CSV import UI. Choice persisted in localStorage. Haiku is cheaper/faster; Sonnet available for higher quality when needed. | Feature → Done | Mar 18 |
| FEA-34 | **Live FX Rates + CAD Display** — Fetches live exchange rates from frankfurter.app on app load, updates DFX for all supported currencies. Balance Sheet TD accounts show accurate CAD equivalents using live rate. BS subtitle displays current CAD/USD rate + date. New transactions use live rate. Falls back to default rates if API unavailable. | Feature → Done | Mar 18 |
| FEA-07 | **Investment Category Toggle in IS** — Added "Show Inv" toggle in IS and cross-year headers. When toggled on, investment appears as a top-level expense row in the detail table, pie chart, stacked chart, and totals. Drilldown includes investment txns when toggled on. Tags/reimbursement still exclude investment. | Feature → Done | Mar 18 |
| FEA-70 | **Balance Sheet KPI Reorder** — Reordered summary cards: Assets → Liabilities → Credits & Transfers → Net Worth (previously Net Worth was before Credits). | UI → Done | Mar 16 |
| FEA-66 | **Import Link to Staged Candidates** — CSV import "Link to Transaction" search now includes staged candidates from the same batch. Split results with "Staged" badge. Staged-to-staged links resolved on commit via `linkToGroup()` with dedup. | Feature → Done | Mar 16 |
| FEA-65 | **Tag Out-of-Window Flags** — Tag detail transaction rows flagged when service period falls outside tag window. Red dashed outline + tint for zero overlap (possible date error, previously hidden), orange dashed outline for partial overlap. Hover tooltips show service dates. | Feature → Done | Mar 16 |
| FEA-64 | **Editable Tag Dates** — Click date range under tag card or in tag detail modal to inline-edit start/end dates. PATCHes `tags` table and re-renders with recalculated accrual totals. Escape to cancel, validates start ≤ end. | Feature → Done | Mar 16 |
| BUG-14 | **IS Category Column Truncation** — Widened fixed-layout category column from 110px to 140px so full names display without clipping. | Bug → Done | Mar 16 |
| FEA-63 | **Reimbursement Form Improvements** — Person dropdown shows only recent reimbursement recipients (MRU order), not Transfer credits. Added "Manual" split option for entering any dollar amount directly, uncapped. | Feature → Done | Mar 16 |
| FEA-62 | **CC Bill Payment Auto-Linking** — CSV import auto-links CC payment Side A/B pairs via `transaction_group_id` using `linkToGroup()` after batch insert. | Feature → Done | Mar 16 |
| FEA-61 | **Monthly Accrual Defaults for Imports** — "Month" accrual categories default service_start to 1st of month, service_end to end of month. AI prompt appends month/year to subscriptions, utilities, gym memberships. | Feature → Done | Mar 16 |
| FEA-60 | **Editable Target Allocation** — Click target percentages in Portfolio Asset Allocation legend to inline-edit. Number input with Enter/blur commit, Escape cancel. Red warning if sum ≠ 100%. Subtitle updates dynamically. In-memory only. | Feature → Done | Mar 15 |
| FEA-59 | **Portfolio Institution Grouping** — Holdings groups accounts by institution. Multi-account institutions (Charles Schwab, eTrade) render as expandable parent rows with aggregated totals and blue left border. Three-level expand: Institution → Account → Symbol/Lots. Single-account institutions stay flat. | Feature → Done | Mar 15 |
| FEA-58 | **Ledger Tag Filter** — Tag dropdown in ledger filter bar between Payment Type and Date Range. Populated from `tags` table, filters via Supabase `tag=eq.` query. Included in Clear reset. | Feature → Done | Mar 15 |
| FEA-57 | **Manual Cashback Redemption Form** — "+ Add" button on Recent Redemptions in Cashback tab. Inline form creates standalone `cashback_redemptions` records with date, item, card, type (Dollar Value/Points), amount, and optional points+rate fields. Undo toast support. | Feature → Done | Mar 15 |
| FEA-03 | **Entertainment Subcategories (Accommodation, Games)** — Added `accommodation` and `games` as subcategories under Entertainment, following existing parent/child pattern. Updated SUB_MAP, CC color map (#D4726A, #C4625A), CATS_LIST, BUDGET_TARGETS, pMap (export), AI categorization prompt, AMEX_CAT_MAP (Travel-Lodging → accommodation). Created category rows in Supabase. LLM-assisted migration reclassified 351 of 1,299 entertainment transactions (167 accommodation, 184 games) via Claude Haiku batch classification with grouped human review. | Feature → Done | Mar 15 |
| FEA-28 | **Monthly IS Drilldown to Top Ledger Items** — Clicking month×category cells in the IS detail table opens a modal showing top transactions sorted by accrual contribution (daily_cost × overlap days). Shows KPI cards, transaction table with click-through to ledger edit. Works on desktop and mobile. | Feature → Done | Mar 2025 |
| FEA-14 | **Cashback & Rewards Tab** — New "Cashback" tab with KPI cards (total redeemed, annual fees, net CC gain, active cards), per-card summary table with color dots, stacked bar chart by year, and recent redemptions table. 208 historical redemptions imported from CSV. Cashback button in ledger edit modal creates dual-write: negative income transaction (linked) + cashback_redemptions record. Undo support for both. | Feature → Done | Mar 14 |
| FEA-54 | **Global Undo Button** — Toast/snackbar with "Undo" button appears after every mutation (single/batch delete, single/batch edit, new entry, CSV/email/payslip import commits). Auto-dismisses after 10s. Only one undo at a time (latest replaces previous). Deletes re-POST the original rows with preserved IDs. Edits PATCH back previous field values. Import undos DELETE by `import_batch`. Slide-up animation, dismiss button, "Undoing..." loading state. | Feature → Done | Mar 14 |
| FEA-23 | **Offline Caching / PWA** — Service Worker (`sw.js`) caches app shell (index.html, Chart.js, Supabase JS, PDF.js, Google Fonts) with stale-while-revalidate for HTML and cache-first for versioned CDN assets. Upgraded `sessionStorage` → `localStorage` for persistent API data caching with LRU eviction on quota exceeded. PWA manifest (`manifest.json`) with icons enables Add to Home Screen / install. Entry and Export tabs show "Offline Mode" message when disconnected; other tabs serve cached data. Online/offline events reactively update UI. "New version available — Refresh" banner on SW update detection. | Feature → Done | Mar 14 |
| FEA-56 | **Ledger Copy-Paste for Selected Rows** — Added "📋 Copy" button to ledger batch action bar. Copies selected transactions to clipboard as TSV (same column format as Export tab: date, service dates, description, category, amounts, payment type, credit, tag, daily cost) for pasting into spreadsheets. Shows "Copied!" feedback for 1.5s. | Feature → Done | Mar 14 |
| FEA-12 | **Budgeting / Targets** — Historical budget targets (% Desired from original CSV summaries, 2019-2025) embedded as `BUDGET_TARGETS` constant. Income Statement shows: (1) horizontal bar chart comparing actual % vs target % per category with over-budget bars in red, (2) Tgt and Δ columns in the Monthly Detail table showing target percentage and color-coded delta (green=under budget, red=over budget). Targets are per-year and change historically. 2026+ falls back to 2025 targets. Hidden on "All" year view and on mobile. | Feature → Done | Mar 14 |
| FEA-44 | **Tag Drilldown to Ledger Items** — Clicking a tag card opens a detail modal showing all contributing transactions sorted by accrual contribution. Table shows date, description, category, amount, accrual amount, and overlap days. Clicking a row opens the ledger edit modal. Cross-tab navigation: `state.tagDetail` auto-opens a tag's drilldown when navigating from the Ledger tab. | Feature → Done | Mar 14 |
| FEA-53 | **Import Edit Modal: Link to Transaction** — Added "Link to Transaction" search UI to CSV import edit modal. Users can search existing DB transactions by description, select one to pre-link, and see linked transaction details with Unlink button. Link stored on candidate as `_linkToTransactionId`/`_linkToGroupId`. On commit, `commitImport` captures inserted row IDs and PATCHes `transaction_group_id` on both the new and target transactions. Review table shows 🔗 indicator for linked candidates. Mirrors ledger link UI pattern. | Feature → Done | Mar 14 |
| FEA-52 | **Chase Chequing CSV Import** — Added `chase_checking` bank profile with header auto-detection (`Posting Date` + `Details` + `Balance`), bill payment detection (AMEX, Chase CC autopay, Apple Card, Capital One/WF, Bilt, LOAN_PMT), Pinterest payroll detection (auto-skipped as payslip-imported), and credit→income defaults. Checking-specific AI categorization context for Zelle, Venmo, ATM, PG&E, IRS, etc. Fixed CSV row filter to handle non-numeric first columns. Payment type auto-set to "Chase Chequing" from profile detection. | Feature → Done | Mar 13 |
| FEA-51 | **Balance Sheet Snapshot Pre-Fill** — "Take Snapshot" button now pre-fills all account inputs with live ledger balances instead of requiring manual entry. Values are editable before saving. Accounts with zero balances left empty. | Feature → Done | Mar 12 |
| FEA-48 | **AMEX Rose Gold CSV Import** — Added `amex` bank profile to CSV import pipeline with header auto-detection, column mapping, `detectPayment` for AUTOPAY rows, `detectCredit` for AMEX credit/reward rows. `AMEX_CAT_MAP` maps AMEX categories (e.g. "Restaurant-Restaurant", "Merchandise & Supplies-Groceries") to Disciplan categories as AI fallback. Updated `transformCSVRow` to handle missing type column. AI description cleanup applies existing style guide for proper formatting. | Feature → Done | Mar 12 |
| BUG-12 | **Balance Sheet Total Liabilities Fix** — Credits & Transfers total (`creditTotal`) was being added to `totL`, offsetting real liabilities (e.g. -$11,184 showed as $957). Fixed by removing `creditTotal` from `totL` and adding it only to net worth calculation. | Bug → Done | Mar 12 |
| BUG-13 | **Payslip Duplicate Detection Service Dates** — `findDuplicates` now compares `service_start` and `service_end` in addition to date/amount, preventing false positives when importing payslips with same date but different service periods. | Bug → Done | Mar 12 |
| FEA-50 | **401K Company Match in Payslip Parser** — Added parsing for "401(k) Company Match" / "Employer Match" lines in payslip PDFs. Generates a separate "401K Match" income transaction on Vanguard, matching historical pattern (e.g. 1/29/25 Google 401K match). | Feature → Done | Mar 12 |
| FEA-49 | **Linked Group Visual Separation + Payslip Auto-Linking** — Adjacent linked transaction groups in the ledger now show a subtle horizontal divider between different `transaction_group_id` groups instead of one continuous blue border. Payslip import (`commitPayslipImport`) now auto-links salary/tax/benefits/401K transactions by capturing POST return values and PATCHing `transaction_group_id` based on `_group`. | Feature → Done | Mar 12 |
| FEA-47 | **Ledger Batch Selection & Operations** — Multi-select checkboxes on ledger rows with select-all header. Floating action bar appears at bottom when items selected, with Edit/Link/Delete/Cancel buttons. Batch Edit modal applies optional field changes (category, tag, payment type, date, service period) across all selected; recalculates daily_cost per-transaction when service period changes. Batch Link groups selected transactions under one transaction_group_id with existing group merge support. Batch Delete uses two-click confirmation pattern. Selection clears on page/filter change and after operations. | Feature → Done | Mar 12 |
| DAT-05 | **Recategorize Ledger Adjustments to "Adjustment" Category** — Two batches: 15 DAT-04 Credits & Transfers adjustments (IDs 12713-12727) and 13 zero-balance/correction adjustments (IDs 12751-12780) recategorized from `financial` → `adjustment`. Adjustment category excluded from Income Statement (not in `PARENT_CATS`, skipped in cross-year view), Tags, and reimbursement logic. Added `adjustment` color (#B0BEC5 gray) to CC map and CATS_LIST. | Data → Done | Mar 11 |
| FEA-46 | **Linked Transaction Viewer** — New `transaction_group_id` column enables transaction groups of 3+ (vs. old 1:1 `related_transaction_id` pairs). Edit modal shows all group members with descriptions, dates, amounts, and payment types. Net Amount footer aggregates all linked amounts. Individual Unlink buttons per member. "Link Another Transaction" button to add to existing groups. Ledger shows group count badge (e.g. `🔗3`) for groups > 2. Auto-linking and reimbursement creation use group-based linking with group merge support. | Feature → Done | Mar 11 |
| FEA-45 | **Payslip Import** — Upload Pinterest payslip PDFs. pdf.js integration parses each page, detects regular pay vs RSU vesting, generates 3-5 transactions per pay period matching Mark's existing income recording style (Pinterest Income, Income Taxes, Medical Insurance Benefits, 401K double-entry). Review table with pay-period grouping, net pay checksum validation, edit modal, duplicate detection, batch commit. | Feature → Done | Mar 11 |
| DAT-04 | **Fix USD→CAD→USD Round-Trip on Original Import** — Original import used the `Amount in CAD` column (USD × 1.37) and converted back at 0.73, introducing rounding errors. Cumulative error: $9,339.27 across 7,844 USD transactions. Fixed via bulk SQL: `SET amount_usd = original_amount, daily_cost = original_amount / service_days` for all original-import USD transactions. Re-ran Credits & Transfers balance adjustments (15 new adjustments) to restore targets. | Data → Done | Mar 8 |
| FEA-42 | **Auto-Create Tags on New Tag Names** — When a tag name is used that doesn't exist in the `tags` table, a "New Tag Detected" modal prompts for start_date, end_date, and tag_type, then POSTs to Supabase. Skip button saves without creating a tag row. Shared `ensureTagExists()` helper hooked into all 4 save points. Bulk imports deduplicate to unique tag names so the modal only appears once per new tag. | Feature → Done | Mar 8 |
| FEA-43 | **Manual Transaction Linking in Ledger Edit Modal** — "Link to Transaction" button in edit modal when no link exists. Inline search UI: type description, search ledger, click result to select, confirm to create bidirectional `related_transaction_id` link. Shows linked transaction details + unlink button after linking. Supports Rakuten cashback→purchase linking and general-purpose manual linking. | Feature → Done | Mar 8 |
| FEA-38 | **Balance Sheet: Working Capital Section + Credits & Transfers Promotion** | Feature | Mar 8 |
| FEA-29A | **One-Click Reimburse on Ledger Items** — "Reimburse" button in ledger edit modal for expense transactions. Split presets (50%, 33%, 25%, custom) with live amount calculation. Friends dropdown derived dynamically from Transfer credit history + Venmo reimbursement patterns. Creates negative offsetting transaction with same category/tag/service period and automatic bidirectional `related_transaction_id` linking. Description format: "Reimbursed - {desc} - {Person}". | Feature → Done | Mar 8 |
| FEA-41 | **Reimbursement Auto-Linking + Ledger Grouping** — Automatic detection and linking of Venmo reimbursements to their original expenses. Scoring algorithm (amount match + date proximity + description fuzzy match + category/tag match, threshold ≥ 60) runs on app init and post-email-import. Reimbursement inherits expense's date, service_start, service_end (with recalculated daily_cost/service_days) so accruals align. Ledger shows linked pairs with blue left border + 🔗 icon. | Feature → Done | Mar 8 |
| FEA-40 | **Email-to-Ledger Import Pipeline** — Forward transaction emails (Venmo, etc.) to Postmark inbound address → Supabase Edge Function parses with source-specific templates → `pending_imports` staging table → frontend review UI. Venmo parser handles outgoing/incoming/forwarded. Forwarding note metadata supports category, tag, payment type hints. Dedup via `email_message_id`. Banner shows pending count on app load. | Feature → Done | Mar 8 |
| BUG-25 | **SW Cache Auto-Rotation** — Replaced hardcoded `SW_VERSION` with `CACHE_STATIC` derived from a djb2 hash of `PRECACHE_URLS`. Cache key auto-rotates whenever modules are added/removed; no manual version bump needed. | Bug → Done | Apr 3 |
| INF-04 | **Global Error Boundary** — `renderContent()` made async; all tab renderers awaited inside top-level try/catch. Unhandled async rejections now show a styled error card with message + Retry button instead of leaving content blank. | Infra → Done | Apr 3 |
| INF-03 | **Server-Side Tag Accrual RPC** — Supabase RPC `get_tag_summaries()` computes `daily_cost × overlap_days` per tag/category in SQL. `renderTags()` replaced 5–12 paginated REST calls (12K+ rows) with a single RPC call returning pre-aggregated totals. `showTagDetail()` still fetches individual transactions for drill-down. | Infra → Done | Apr 3 |
| INF-02 | **Modular JS Split** — Split monolithic `index.html` (~3,800 lines) into 18 focused JS modules under `js/`. `index.html` reduced to ~250 lines. No build step — plain `<script>` tags, global scope. Each tab is its own file. SW updated to v2.0.0. Added `CLAUDE.md` and `.claudeignore`. | Infra → Done | Apr 3 |
| INF-01 | **Git CI/CD** — GitHub repo (`markqren/disciplan`) + Netlify auto-deploy from `main` branch. Every `git push` triggers a production build. | Infra → Done | Feb 18 |
| FEA-39 | **"Since Last Export" Button** — Tracks highest transaction `id` at export time in `localStorage`. Subsequent clicks only export transactions added after that point. Button label shows last export date. Only the "Since Last Export" button advances the marker. | Feature → Done | Mar 1 |
| BUG-11 | **Import Auto-Detect Overrides Manual Payment Type** — Chase CSV filename auto-detection was overwriting the payment type dropdown to "Chase Sapphire" on every Import click, even after manual selection. Fixed by tracking `impPtManual` flag — auto-detect only runs if the user hasn't changed the dropdown. | Bug → Done | Mar 1 |
| FEA-36 | **CC Payment Auto-Ledger Pairs** — Chase CSV imports now process "Payment" rows instead of skipping them. Each CC payment generates a double-entry pair (Side A on credit card, Side B on Chase Chequing). Pre-approved with 💳 badge in review table. Net ledger impact = zero. | Feature → Done | Mar 1 |
| FEA-35 | **Credits & Transfers Sub-Ledger** — Balance Sheet breaks out Transfer transactions by `credit` field into an expandable "Credits & Transfers" section. Uses `get_credit_balances()` RPC. Positive = owed to Mark (green), negative = Mark owes (red). Transaction count tooltips. Collapsed by default. | Feature → Done | Mar 1 |
| FEA-33 | **TD Account CAD Tooltips** — TD-prefixed account balances in Balance Sheet show a hover tooltip with CAD equivalent (`CA$` = `USD / 0.73`). | Feature → Done | Mar 1 |
| BUG-10 | **Balance Sheet: Live Ledger Balances** — Balance Sheet was only showing manual snapshot balances. Added `get_ledger_balances()` RPC. `renderBS` now calls RPC and groups results by account_type. Validated: Chase Chequing = $137,611.08 (off by $0.01 from spreadsheet SOT). | Bug → Done | Mar 1 |
| DAT-01 | **Reconcile missing transactions** — Full CSV-vs-SQL reconciliation of 12,064 transactions. Original estimate of ~73 missing was incorrect (character encoding differences). India $1,184 flight confirmed present. All non-zero transactions accounted for. | Data → Done | Mar 1 |
| DAT-03 | **Mojibake description cleanup** — ~231 transaction descriptions had `â€™` instead of `'`. Bulk UPDATE to fix curly apostrophes, em dashes, and accented characters. Affected: Trader Joe's, Tony's, McDonald's, etc. | Data → Done | Mar 1 |
| FEA-32 | **Lightweight Offline Cache** — `sb()` and `sbRPC()` cache every successful GET response in `sessionStorage`. On fetch failure, returns cached data. Yellow banner shows "Showing cached data · Xm ago". Only caches reads, not writes. | Feature → Done | Feb 28 |
| FEA-30 | **Persist Tab State on Refresh** — URL hash routing (`#ledger`, `#income-all`, etc.) syncs `state.tab` and `state.year` to `location.hash`. On page load, `init()` reads hash and restores state before first render. | Feature → Done | Feb 28 |
| FEA-31 | **In-App Refresh Button** — `↻` button in header re-renders current tab by calling `renderContent()` without full page reload. CSS spin animation on click for visual feedback. | Feature → Done | Feb 28 |
| BUG-09 | **Delete/edit transaction 401 fix** — `sb()` helper had a header-overwrite bug: trailing `...opts` re-set `headers` to just custom headers, dropping auth. Fixed by destructuring opts before spreading. Affected PATCH, DELETE, and commitImport POST. | Bug → Done | Feb 28 |
| FEA-21 | **Ledger Edit/Delete** — Click any ledger row to open edit modal. All fields editable: date, description, category, amount, service period, payment account, tag. Live accrual preview. Save via PATCH, delete via two-click confirmation DELETE. | Feature → Done | Feb 27 |
| FEA-26 | **Import Batch Tracking** — `commitImport` generates a batch ID and sets `import_batch` on all inserted rows. Enables rollback and audit trail. | Feature → Done | Feb 27 |
| FEA-27 | **Store Original Bank Metadata** — `commitImport` now persists `bank_description` (raw bank text) and `bank_category` (bank's category) from CSV import. Preserves mapping chain for auditing and AI improvement. | Feature → Done | Feb 27 |
| BUG-08 | **Import: Prevent double-submit** — Added `saving` guard variable to Save button click handler. Combined with `saveBtn.disabled=true`. `commitImport` already filters by `_status==="approved"`. | Bug → Done | Feb 26 |
| FEA-24 | **CSV Transaction Import** — Upload bank CSV statements (Chase profile) and auto-translate to Disciplan ledger format. Claude API integration for AI categorization with localStorage API key management. Duplicate detection, review table with status cycling, inline category dropdown, bulk actions, full edit modal with accrual preview. Batch POST to Supabase with success summary. Mobile-responsive. | Feature → Done | Feb 26 |
| FEA-05 | **Portfolio Tab** — New tab showing investment holdings across 10 accounts. Fetches from 3 Supabase tables. 5 KPI stat cards (Market Value, Cost Basis, Unrealized Gain, Total Return %, Ann. Return %). Asset Allocation doughnut chart, Account Performance stacked bar chart. Expandable holdings drill-down: account → symbol → lot level. Cost-basis-weighted annualized returns at all levels. Mobile-responsive. | Feature → Done | Feb 21 |
| FEA-10 | **Authentication (Phase 1)** — Supabase Auth login gate with email/password. Session persists via localStorage. Sign-out button in tab bar. Replaced static `HDRS` with `authHeaders()` that uses session JWT. No RLS yet, no signup form. | Feature → Done | Feb 20 |
| TD-03 | **Savings Rate % right-align** — Added `text-align:right` to savings rate percentage cells in monthly detail table. | To Do → Done | Feb 20 |
| TD-04 | **Furniture default duration = 2 years** — Added `furniture:730` to `ACCRUAL_D` so furniture transactions auto-fill a 2-year service period. | To Do → Done | Feb 20 |
| TD-05 | **Chart right y-axis alignment** — Switched savings rate % axis labels to monospace font (JetBrains Mono) with padded numbers so `%` signs align. Applied to both monthly and cross-year charts. | To Do → Done | Feb 20 |
| FEA-20 | **Monthly Cash Flow Waterfall** — Applied floating-bar waterfall style to both monthly and cross-year charts. Blue=income, red=expenses (floating from net to income level), green=net savings. Added savings rate % line (yellow) on right axis. | Feature → Done | Feb 20 |
| DAT-02 | **szója boys encoding** — Verified encoding is correct: stored as proper Unicode `ó` in both tags table and transactions (179 txns). Not mojibake. No fix needed. | Data → Resolved | Feb 19 |
| BUG-07 | **Tag totals: negative daily_cost + szója boys dates** — `daily_cost>0` filter silently dropped credits/reimbursements from tag totals. Changed to `daily_cost!=null`. Also fixed szója boys tag dates in Supabase. Validated: Japan=$6,980, Szója=$6,765, Ski=$2,845. | Bug → Done | Feb 19 |
| BUG-04 | **Cross-Year Summary Fixed** — Referenced `r.total_amount` instead of `r.amount` from RPC, and included `investment` deposits in income total. Fixed to skip investment and use correct field name. | Bug → Done | Feb 19 |
| BUG-05 | **Accrual-based tag totals** — Tags now compute `daily_cost × overlap_days` instead of summing raw `amount_usd`. Validated: Japan=$6,980, Szója=$6,765, Ski=$2,845. | Bug → Done | Feb 19 |
| BUG-06 | **Audit Accounts & Liabilities** — Full audit: all 39 payment types in transactions exist in `import-accounts.sql`. PTS dropdown in code expanded from 15 to all 39 entries. | Bug → Done | Feb 19 |
| FEA-04 | **Balance Sheet Snapshots** — Added "📸 Take Snapshot" button. Warning banner if last snapshot >30 days old. Modal form shows all active accounts grouped by type with balance inputs. Saves to `balance_snapshots` table via POST. | Feature → Done | Feb 19 |
| FEA-06 | **Ledger filter & sort** — Filter bar with description search, category dropdown, payment type dropdown (all 39 types), date range, and Clear button. All filters map to Supabase PostgREST query params. | Feature → Done | Feb 19 |
| FEA-08 | **Ledger payment type column** — Added Payment column to ledger table (hidden on mobile via `hide-m` class). | Feature → Done | Feb 19 |
| TD-01 | **Show Full Digits in Tables** — Added `fmtT()` formatter showing `$12,345` instead of `$12.3K`. Applied to IS detail table, totals, avg column, and cross-year detail table. | To Do → Done | Feb 19 |
| TD-02 | **Collapse Subcategories by Default** — Parent rows with subcategories show a `▸` toggle. Click to expand/collapse. Subcategories hidden by default via `.hidden` CSS class. | To Do → Done | Feb 19 |
| FEA-15 | **Cross-year waterfall chart + savings rate** — Changed cross-year chart to waterfall style. Added savings rate line on right-side percentage axis. | Feature → Done | Feb 19 |
| TD-00 | **UI Theme & Readability Overhaul** — Larger fonts, better contrast, wider spacing, alternating row stripes, hover states, table-layout:fixed for even columns. | To Do → Done | Feb 18 |
| BUG-01 | **Fix Soja Boyz Tag Overlap** — Positive-only filter counted gross transfers but ignored offsetting negatives. Fixed to sum net amounts. Also fixed 0-txn bug (Supabase 1000-row default limit) with paginated fetch. | Bug → Done | Feb 18 |
| FEA-01 | **Mobile Responsiveness** — `hide-m` class hides Service Period + Daily Cost columns on <700px. Tabs, fonts, stat cards scale down. Entry form stacks vertically. | Idea → Done | Feb 18 |
| BUG-02 | **Emoji/encoding fix** — Stat card emojis, · separators, ✓ checkmark were triple-encoded mojibake. All replaced with clean UTF-8. | Bug → Done | Feb 18 |
| FEA-02 | **Average column** — Added Avg column to IS monthly detail table (total ÷ active months). | Feature → Done | Feb 18 |
| BUG-03 | **Tag date ranges** — 20 tags had wrong start/end dates in Supabase. Parsed correct dates from original CSV filenames and ran SQL fix. | Bug → Done | Feb 18 |
| FEA-18 | **Cross-year summary** — "All" year tab on Income Statement showing annual income/expenses/savings 2017–2026 with bar chart and detail table. | Feature → Done | Feb 18 |
| FEA-19 | **Export tab** — All Transactions TSV, New Only TSV, Full JSON Backup. TSV maps subcategories back to parent names for Numbers compatibility. | Feature → Done | Feb 18 |
| BUG-00 | **TD TFSA reclassification** — Was showing as credit card; reclassified to investment account type via SQL update. | Bug → Done | Feb 18 |

</details>
