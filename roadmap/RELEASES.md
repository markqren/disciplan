<!--
  ⚠️  Auto-synced from ROADMAP.md — edit the master file, not this split.
  Last synced: 2026-04-07
  Source: ../ROADMAP.md § "Releases"
  Usage: Archive reference. Rarely loaded; browse on GitHub.
-->

# Release History

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
