# Disciplan — Roadmap & Feedback Tracker

**Last updated:** Feb 18, 2026 | [disciplan.netlify.app](https://disciplan.netlify.app) | Stack: index.html + Chart.js + Supabase

---

## 🔧 Next Up

| ID | Item | Type | Priority | Details |
|----|------|------|----------|---------|
| BUG-04 | **Cross-Year Summary Broken** | Bug | **High** | "All" year tab on Income Statement shows $0 for all stat cards and empty chart (Y-axis labels $0/$1). Data fetch or aggregation logic is failing—likely the cross-year query returns no rows or sums to zero. Was previously marked complete but has regressed. |
| FEA-03 | **Travel / Accommodation Category** | Feature | **High** | Hotels are currently lumped under Entertainment, which is misleading. Options: (a) add "accommodation" as a new subcategory under Entertainment, (b) create a top-level "Travel" category with subcategories (flights, hotels, activities). Either way, retroactively re-tag historical hotel transactions. Needs: update PARENT_CATS, SUB_MAP, CC color map, category dropdown, and batch-update existing transactions in Supabase. |
| BUG-05 | **Accrual-based tag totals** | Bug | **High** | Current tag view sums net amount_usd per tagged transaction. Should use daily_cost × overlap_days_with_tag_window to match the original spreadsheet's accrual method. Validated: Japan $6,980 app vs $6,979 expected. Biggest impact on tags with long-duration transactions (ski lease, rent) that span beyond the tag window. |
| FEA-04 | **Balance Sheet Auto-Snapshots** | Feature | **High** | Balance sheet should automatically take snapshots at a regular frequency (or on major updates) and persist them so the historical chart continues over time. Need to decide on frequency (weekly? monthly? on manual update?) and storage format. Could use a dedicated Supabase table with timestamp + account balances as JSON. Currently chart data is lost between sessions. |
| FEA-05 | **Investments Tab** | Feature | **High** | Portfolio view showing all holdings with current values and allocation. Entry point to log buy/sell transactions. Needs its own data model beyond accrual engine. Data exists in InvestmentsInvestments.csv and InvestmentsLatest_Price.csv. |
| BUG-06 | **Audit Accounts & Liabilities** | Bug | **Medium** | Verify all accounts and liabilities are present in the balance sheet. Known missing: Chase United credit card, Venmo account. Do a full reconciliation pass against the Transactions payment types list. |
| FEA-06 | **Ledger filter & sort** | Feature | **Medium** | Add ability to filter ledger by category, tag, date range, payment type. Add sort toggles on column headers. |
| TD-01 | **Show Full Digits in Tables** | To Do | **Medium** | Switch number formatting from abbreviated (K/M) to full digits in tables. Aligned digit columns (right-justified, mono font) make it easier to compare values at a glance. Keep K/M abbreviations for charts only. |
| TD-02 | **Collapse Subcategories by Default** | To Do | **Medium** | Subcategories (e.g., Food→Groceries/Restaurant) should be collapsed by default in the income statement table. Add expand/collapse toggles for a cleaner initial view. |
| FEA-07 | **Handle "Investments" Category** | Feature | **Medium** | Some transactions are tagged as category "Investments" for unrealized gains. These need special treatment when the Investments tab is built—should not be double-counted as both income and portfolio value. Route into portfolio view instead of income statement. |
| FEA-08 | **Ledger payment type column** | Feature | **Low** | Show payment type (Chase Sapphire, AMEX, etc.) as a visible column in the ledger table. |

---

## 🔮 Future

| ID | Item | Type | Priority | Details |
|----|------|------|----------|---------|
| FEA-09 | **Plaid Integration** | Feature | High | Auto-sync bank account balances via Plaid API. Needs backend endpoint (Supabase Edge Function) for token management. Blocked by auth. |
| FEA-10 | **Authentication** | Feature | High | Supabase Auth for user login. Currently open/single-user with public API key. Required before Plaid or any multi-user features. |
| FEA-11 | **AI Analysis Bot** | Feature | Medium | Claude API-powered insights: spending pattern analysis, anomaly detection, natural-language summaries. "Where am I overspending?" / "How does this month compare to last quarter?" |
| FEA-12 | **Budgeting / Targets** | Feature | Medium | Set monthly or per-category budget targets with visual progress bars. Data exists: original spreadsheet has % Desired and % Delta columns. |
| FEA-13 | **Income Tracking & Net Savings** | Feature | Medium | Already partially done (IS shows income + savings rate). Could integrate deeper with Investments tab for full financial picture. |
| INF-01 | **Git CI/CD** | Infra | Medium | Set up GitHub repo + Netlify auto-deploy from main branch. Xcode ready. |
| DAT-01 | **Reconcile missing transactions** | Data | Low | ~73 transactions in original CSV not in SQL import. Most are 1-2 per tag (FX rounding). India missing $1,184 flight. "lacma" tag (3 txns) missing from tags table. |
| DAT-02 | **szója boys encoding** | Data | Low | Stored as "szÃ³ja boys" in Supabase. Normalize to "szoja boys" across tags table + transactions. |
| FEA-14 | **Cashback tracking** | Feature | Low | Data exists in CashbackSummary.csv and CashbackTRANSACTIONS.csv (219 redemptions). Could show net credit card rewards. |
| FEA-15 | **Balance sheet time series** | Feature | Low | Net worth over time chart using balance_snapshots data. Depends on auto-snapshot mechanism (FEA-04) being built first. |
| FEA-16 | **Add Splitwise Payment Type** | Feature | Low | Create a Splitwise payment type to explicitly track owed amounts. Investigate Splitwise API for automatic import of balances and settlements. |
| FEA-17 | **Recurring Transaction Templates** | Feature | Low | Auto-generate recurring expenses (rent, subscriptions) each month instead of manual entry. Would reduce data entry burden before Plaid is live. |

---

<details>
<summary><strong>✅ Completed</strong> (9 items)</summary>

| ID | Item | Type | Completed |
|----|------|------|-----------|
| TD-00 | **UI Theme & Readability Overhaul** — Larger fonts (10→12px), better contrast (0.3→0.5 alpha), wider spacing, alternating row stripes, hover states, table-layout:fixed for even columns | To Do → Done | Feb 18 |
| BUG-01 | **Fix Soja Boyz Tag Overlap** — Root cause: positive-only filter counted gross transfers ($30K) but ignored offsetting negatives. Fixed to sum net amounts. Also fixed 0-txn bug (Supabase 1000-row default limit) with paginated fetch. | Bug → Done | Feb 18 |
| FEA-01 | **Mobile Responsiveness** — hide-m class hides Service Period + Daily Cost columns on <700px. Tabs, fonts, stat cards scale down. Entry form stacks vertically. | Idea → Done | Feb 18 |
| BUG-02 | **Emoji/encoding fix** — Stat card emojis, · separators, ✓ checkmark were triple-encoded mojibake. All replaced with clean UTF-8. | Bug → Done | Feb 18 |
| FEA-02 | **Average column** — Added Avg column to IS monthly detail table (total ÷ active months). | Feature → Done | Feb 18 |
| BUG-03 | **Tag date ranges** — 20 tags had wrong start/end dates in Supabase. Parsed correct dates from original CSV filenames and ran SQL fix. | Bug → Done | Feb 18 |
| FEA-18 | **Cross-year summary** — "All" year tab on Income Statement showing annual income/expenses/savings 2017–2026 with bar chart and detail table. ⚠️ Regressed — see BUG-04. | Feature → Done | Feb 18 |
| FEA-19 | **Export tab** — All Transactions TSV, New Only TSV (since import, id > 12010), Full JSON Backup. TSV maps subcategories back to parent names for Numbers compatibility. | Feature → Done | Feb 18 |
| BUG-00 | **TD TFSA reclassification** — Was showing as credit card; reclassified to investment account type via SQL update. | Bug → Done | Feb 18 |

</details>
