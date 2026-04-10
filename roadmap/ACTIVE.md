<!--
  ✅ SOURCE OF TRUTH — edit this file directly.
  After editing: run `bash scripts/build-roadmap.sh` to regenerate ROADMAP.md.
  ROADMAP.md is a generated artifact — never edit it directly.
  Usage: Primary context for feature work. ~2K tokens.
-->

# Active Roadmap

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
| INF-06 | **Cache Version Key** | Infra | Low | sessionStorage cache keys use prefix `dc_` without versioning. If RPC response shapes change (new columns, renamed fields), stale cached data causes rendering errors on next load. Add a version segment to the prefix (e.g., `dc_v2_`) and bump on schema changes. Trivial to implement. |
