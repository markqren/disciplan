# Disciplan — Roadmap & Feedback Tracker

**Last updated:** Feb 21, 2026 | [disciplan.netlify.app](https://disciplan.netlify.app) | Stack: index.html + Chart.js + Supabase

---

## 🔧 Next Up

| ID | Item | Type | Priority | Details |
|----|------|------|----------|---------|
| FEA-03 | **Travel / Accommodation Category** | Feature | **High** | Hotels are currently lumped under Entertainment, which is misleading. Options: (a) add "accommodation" as a new subcategory under Entertainment, (b) create a top-level "Travel" category with subcategories (flights, hotels, activities). Either way, retroactively re-tag historical hotel transactions. Needs: update PARENT_CATS, SUB_MAP, CC color map, category dropdown, and batch-update existing transactions in Supabase. |
| FEA-05 | **Portfolio Tab** | Feature | **Done** | ~~See Completed section~~ |
| FEA-07 | **Handle "Investments" Category** | Feature | **Medium** | Some transactions are tagged as category "Investments" for unrealized gains. These need special treatment when the Investments tab is built—should not be double-counted as both income and portfolio value. Route into portfolio view instead of income statement. |
| FEA-21 | **Ledger Edit Line Items** | Feature | **High** | Click a transaction row in the ledger to open an edit modal. Allow editing all fields (date, description, category, amount, payment type, service period, tag). Save via PATCH to Supabase. Needs confirmation before save and visual feedback on success. |
| FEA-22 | **Ledger Search Improvements** | Feature | **Medium** | Search currently requires Enter key to trigger. Improve UX: auto-search on typing (debounced), search across more fields (tag, payment type, amount), highlight matched text in results. |
| DAT-01 | **Reconcile missing transactions** | Data | **Low** | ~73 transactions in original CSV not in SQL import. Most are 1-2 per tag (FX rounding). India missing $1,184 flight. "lacma" tag (3 txns) missing from tags table. |

---

## 🔮 Future

| ID | Item | Type | Priority | Details |
|----|------|------|----------|---------|
| FEA-09 | **Plaid Integration** | Feature | High | Auto-sync bank account balances via Plaid API. Needs backend endpoint (Supabase Edge Function) for token management. Auth prerequisite done (FEA-10). |
| FEA-11 | **AI Daily Insights Agent** | Feature | Low | Claude API-powered agent/chatbot that surfaces insights from transaction data. Runs daily (push notification or email digest) and on-demand when prompted. Examples: spending pattern analysis, anomaly detection ("you spent 3x on restaurants this month"), trend summaries, tag comparisons ("Japan was 20% cheaper than szója boys per day"). Could live as a chat panel in the app or a standalone bot. |
| FEA-12 | **Budgeting / Targets** | Feature | Medium | Set monthly or per-category budget targets with visual progress bars. Data exists: original spreadsheet has % Desired and % Delta columns. |
| FEA-13 | **Income Tracking & Net Savings** | Feature | Medium | Already partially done (IS shows income + savings rate). Could integrate deeper with Investments tab for full financial picture. |
| INF-01 | **Git CI/CD** | Infra | Medium | Set up GitHub repo + Netlify auto-deploy from main branch. Xcode ready. |
| FEA-14 | **Cashback tracking** | Feature | Low | Data exists in CashbackSummary.csv and CashbackTRANSACTIONS.csv (219 redemptions). Could show net credit card rewards. |
| FEA-16 | **Add Splitwise Payment Type** | Feature | Low | Create a Splitwise payment type to explicitly track owed amounts. Investigate Splitwise API for automatic import of balances and settlements. |
| FEA-17 | **Recurring Transaction Templates** | Feature | Low | Auto-generate recurring expenses (rent, subscriptions) each month instead of manual entry. Would reduce data entry burden before Plaid is live. |
| FEA-23 | **Offline Caching / PWA** | Feature | Medium | Cache a snapshot of summary data (IS charts, balance sheet, tag totals, portfolio KPIs) so the app is viewable without internet. Use a Service Worker to serve cached `index.html` + Chart.js CDN assets. On each online load, refresh the cache with latest Supabase data. Offline mode would be read-only (no Entry/Export). Could evolve into a full PWA with `manifest.json` for Add to Home Screen. Key pieces: (1) Service Worker for asset caching, (2) IndexedDB or Cache API for pre-rendered summary data, (3) offline banner/indicator in UI. |

---

<details>
<summary><strong>✅ Completed</strong> (28 items)</summary>

| ID | Item | Type | Completed |
|----|------|------|-----------|
| FEA-05 | **Portfolio Tab** — New tab showing investment holdings across 10 accounts. Fetches from 3 Supabase tables (investment_accounts, investment_symbols, investment_lots). 5 KPI stat cards (Market Value, Cost Basis, Unrealized Gain, Total Return %, Ann. Return %). Two-panel overview: Asset Allocation doughnut chart with allocation bar legend (actual vs target %), Account Performance horizontal stacked bar chart with return summaries. Expandable holdings drill-down: account → symbol → lot level with active/sold separation, SOLD badges, color-coded gains. Cost-basis-weighted annualized returns at lot/symbol/account/portfolio levels. Schwab 401K hardcoded at 7.3%, Vanguard 401K excluded. Mobile-responsive with hide-m columns. | Feature → Done | Feb 21 |
| FEA-10 | **Authentication (Phase 1)** — Added Supabase Auth login gate with email/password. Login screen hides header/content/footer until authenticated. Session persists via localStorage (supabase-js). Sign-out button in tab bar. Replaced static `HDRS` with `authHeaders()` that uses session JWT. No RLS yet, no signup form. | Feature → Done | Feb 20 |
| TD-03 | **Savings Rate % right-align** — Added explicit `text-align:right` to savings rate percentage cells in monthly detail table. | To Do → Done | Feb 20 |
| TD-04 | **Furniture default duration = 2 years** — Added `furniture:730` to `ACCRUAL_D` so furniture transactions auto-fill a 2-year service period. | To Do → Done | Feb 20 |
| TD-05 | **Chart right y-axis alignment** — Switched savings rate % axis labels to monospace font (JetBrains Mono) with padded numbers so `%` signs align. Applied to both monthly and cross-year charts. | To Do → Done | Feb 20 |
| FEA-20 | **Monthly Cash Flow Waterfall** — Applied floating-bar waterfall style to both monthly and cross-year charts. Blue=income, red=expenses (floating from net to income level), green=net savings. Added savings rate % line (yellow) on right axis to monthly view. Added savings rate row to monthly detail table. Fixed legend to use pointStyle so line datasets render correctly. | Feature → Done | Feb 20 |
| DAT-02 | **szója boys encoding** — Verified encoding is correct: stored as proper Unicode `ó` (\u00f3) in both tags table and transactions (179 txns). Not mojibake. No fix needed. | Data → Resolved | Feb 19 |
| BUG-07 | **Tag totals: negative daily_cost + szója boys dates** — `daily_cost>0` filter silently dropped credits/reimbursements from tag totals. Changed to `daily_cost!=null` in both `renderTags` and `showTagDetail`. Also fixed szója boys tag dates in Supabase (start was 4/28 instead of 5/23, end year was 2024 instead of 2023). Validated against CSV SOT: Japan=$6,980, Szója=$6,765, Ski=$2,845. | Bug → Done | Feb 19 |
| BUG-04 | **Cross-Year Summary Fixed** — Two bugs: (1) referenced `r.total_amount` instead of `r.amount` from RPC, (2) included `investment` deposits in income total, inflating numbers (e.g. 2025 showed $344K instead of $260K). Fixed to skip investment category and use correct field name. | Bug → Done | Feb 19 |
| BUG-05 | **Accrual-based tag totals** — Tags now compute `daily_cost × overlap_days` (intersection of transaction service period with tag date window) instead of summing raw `amount_usd`. Applied to both tag cards and tag detail modal. Falls back to `amount_usd` when tag dates or service period missing. Second fix: changed `daily_cost>0` to `daily_cost!=null` so negative daily costs (credits/reimbursements) properly reduce tag totals. Also fixed szója boys dates in Supabase (end year was 2024 instead of 2023). Validated: Japan=$6,980, Szója=$6,765, Ski=$2,845 — all within $1 of CSV SOT. | Bug → Done | Feb 19 |
| BUG-06 | **Audit Accounts & Liabilities** — Full audit complete: all 39 payment types in transactions already exist in `import-accounts.sql` (including Chase United). Issue was PTS dropdown in code only had 15 entries — expanded to all 39. No missing accounts in Supabase. | Bug → Done | Feb 19 |
| FEA-04 | **Balance Sheet Snapshots** — Added "📸 Take Snapshot" button on balance sheet tab. Warning banner if last snapshot >30 days old. Modal form shows all active accounts grouped by type (checking, savings, credit, investment, liability) with balance inputs. Saves to `balance_snapshots` table via POST. | Feature → Done | Feb 19 |
| FEA-06 | **Ledger filter & sort** — Filter bar with description search (Enter to apply), category dropdown, payment type dropdown (all 39 types), date range (from/to), and Clear button. All filters map to Supabase PostgREST query params. | Feature → Done | Feb 19 |
| FEA-08 | **Ledger payment type column** — Added Payment column to ledger table (hidden on mobile via `hide-m` class). | Feature → Done | Feb 19 |
| TD-01 | **Show Full Digits in Tables** — Added `fmtT()` formatter showing `$12,345` instead of `$12.3K`. Applied to IS detail table, totals, avg column, and cross-year detail table. Charts and stat cards still use abbreviated `fmtN()`. | To Do → Done | Feb 19 |
| TD-02 | **Collapse Subcategories by Default** — Parent rows with subcategories (Food, Home, Personal) show a `▸` toggle. Click to expand/collapse. Subcategories hidden by default via `.hidden` CSS class. | To Do → Done | Feb 19 |
| FEA-15 | **Cross-year waterfall chart + savings rate** — Changed cross-year chart to waterfall style (income stacks up, expenses stack down, standalone net bar). Added savings rate line on right-side percentage axis. | Feature → Done | Feb 19 |
| TD-00 | **UI Theme & Readability Overhaul** — Larger fonts (10→12px), better contrast (0.3→0.5 alpha), wider spacing, alternating row stripes, hover states, table-layout:fixed for even columns | To Do → Done | Feb 18 |
| BUG-01 | **Fix Soja Boyz Tag Overlap** — Root cause: positive-only filter counted gross transfers ($30K) but ignored offsetting negatives. Fixed to sum net amounts. Also fixed 0-txn bug (Supabase 1000-row default limit) with paginated fetch. | Bug → Done | Feb 18 |
| FEA-01 | **Mobile Responsiveness** — hide-m class hides Service Period + Daily Cost columns on <700px. Tabs, fonts, stat cards scale down. Entry form stacks vertically. | Idea → Done | Feb 18 |
| BUG-02 | **Emoji/encoding fix** — Stat card emojis, · separators, ✓ checkmark were triple-encoded mojibake. All replaced with clean UTF-8. | Bug → Done | Feb 18 |
| FEA-02 | **Average column** — Added Avg column to IS monthly detail table (total ÷ active months). | Feature → Done | Feb 18 |
| BUG-03 | **Tag date ranges** — 20 tags had wrong start/end dates in Supabase. Parsed correct dates from original CSV filenames and ran SQL fix. | Bug → Done | Feb 18 |
| FEA-18 | **Cross-year summary** — "All" year tab on Income Statement showing annual income/expenses/savings 2017–2026 with bar chart and detail table. | Feature → Done | Feb 18 |
| FEA-19 | **Export tab** — All Transactions TSV, New Only TSV (since import, id > 12010), Full JSON Backup. TSV maps subcategories back to parent names for Numbers compatibility. | Feature → Done | Feb 18 |
| BUG-00 | **TD TFSA reclassification** — Was showing as credit card; reclassified to investment account type via SQL update. | Bug → Done | Feb 18 |

</details>
