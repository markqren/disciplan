# Disciplan — Roadmap & Feedback Tracker

**Last updated:** Feb 18, 2026 | [disciplan.netlify.app](https://disciplan.netlify.app) | Stack: index.html + Chart.js + Supabase

---

## ✅ Completed

| # | Item | Type | Completed |
|---|------|------|-----------|
| 1 | **UI Theme & Readability Overhaul** — Larger fonts (10→12px), better contrast (0.3→0.5 alpha), wider spacing, alternating row stripes, hover states, table-layout:fixed for even columns | To Do → Done | Feb 18 |
| 2 | **Fix Soja Boyz Tag Overlap** — Root cause: positive-only filter counted gross transfers ($30K) but ignored offsetting negatives. Fixed to sum net amounts. Also fixed 0-txn bug (Supabase 1000-row default limit) with paginated fetch. | Bug → Done | Feb 18 |
| 10 | **Mobile Responsiveness** — hide-m class hides Service Period + Daily Cost columns on <700px. Tabs, fonts, stat cards scale down. Entry form stacks vertically. | Idea → Done | Feb 18 |
| — | **Emoji/encoding fix** — Stat card emojis, · separators, ✓ checkmark were triple-encoded mojibake. All replaced with clean UTF-8. | Bug → Done | Feb 18 |
| — | **Average column** — Added Avg column to IS monthly detail table (total ÷ active months). | Feature → Done | Feb 18 |
| — | **Tag date ranges** — 20 tags had wrong start/end dates in Supabase. Parsed correct dates from original CSV filenames and ran SQL fix. | Bug → Done | Feb 18 |
| — | **Cross-year summary** — "All" year tab on Income Statement showing annual income/expenses/savings 2017–2026 with bar chart and detail table. | Feature → Done | Feb 18 |
| — | **Export tab** — All Transactions TSV, New Only TSV (since import, id > 12010), Full JSON Backup. TSV maps subcategories back to parent names for Numbers compatibility. | Feature → Done | Feb 18 |
| — | **TD TFSA reclassification** — Was showing as credit card; reclassified to investment account type via SQL update. | Bug → Done | Feb 18 |

---

## 🔧 Next Up

| # | Item | Type | Priority | Details |
|---|------|------|----------|---------|
| 3 | **Travel / Accommodation Category** | Feature | **High** | Hotels are currently lumped under Entertainment, which is misleading. Options: (a) add "accommodation" as a new subcategory under Entertainment, (b) create a top-level "Travel" category with subcategories (flights, hotels, activities). Either way, retroactively re-tag historical hotel transactions. Needs: update PARENT_CATS, SUB_MAP, CC color map, category dropdown, and batch-update existing transactions in Supabase. |
| — | **Accrual-based tag totals** | Bug | **High** | Current tag view sums net amount_usd per tagged transaction. Should use daily_cost × overlap_days_with_tag_window to match the original spreadsheet's accrual method. Validated: Japan $6,980 app vs $6,979 expected. Biggest impact on tags with long-duration transactions (ski lease, rent) that span beyond the tag window. |
| — | **Ledger filter & sort** | Feature | **Medium** | Add ability to filter ledger by category, tag, date range, payment type. Add sort toggles on column headers. |
| — | **Ledger payment type column** | Feature | **Low** | Show payment type (Chase Sapphire, AMEX, etc.) as a visible column in the ledger table. |
| 4 | **Investments Tab** | Feature | **High** | Portfolio view showing all holdings with current values and allocation. Entry point to log buy/sell transactions. Needs its own data model beyond accrual engine. Data exists in InvestmentsInvestments.csv and InvestmentsLatest_Price.csv. |

---

## 🔮 Future

| # | Item | Type | Priority | Details |
|---|------|------|----------|---------|
| 5 | **Plaid Integration** | Feature | High | Auto-sync bank account balances via Plaid API. Needs backend endpoint (Supabase Edge Function) for token management. Blocked by auth. |
| 6 | **Authentication** | Feature | High | Supabase Auth for user login. Currently open/single-user with public API key. Required before Plaid or any multi-user features. |
| 7 | **AI Analysis Bot** | Feature | Medium | Claude API-powered insights: spending pattern analysis, anomaly detection, natural-language summaries. "Where am I overspending?" / "How does this month compare to last quarter?" |
| 8 | **Budgeting / Targets** | Feature | Medium | Set monthly or per-category budget targets with visual progress bars. Data exists: original spreadsheet has % Desired and % Delta columns. |
| 9 | **Income Tracking & Net Savings** | Feature | Medium | Already partially done (IS shows income + savings rate). Could integrate deeper with Investments tab for full financial picture. |
| — | **Reconcile missing transactions** | Data | Low | ~73 transactions in original CSV not in SQL import. Most are 1-2 per tag (FX rounding). India missing $1,184 flight. "lacma" tag (3 txns) missing from tags table. |
| — | **szója boys encoding** | Data | Low | Stored as "szÃ³ja boys" in Supabase. Normalize to "szoja boys" across tags table + transactions. |
| — | **Cashback tracking** | Feature | Low | Data exists in CashbackSummary.csv and CashbackTRANSACTIONS.csv (219 redemptions). Could show net credit card rewards. |
| — | **Balance sheet time series** | Feature | Low | Net worth over time chart using balance_snapshots data. |
| — | **Git CI/CD** | Infra | Medium | Set up GitHub repo + Netlify auto-deploy from main branch. Xcode ready. |
