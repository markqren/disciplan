<!--
  ✅ SOURCE OF TRUTH — edit this file directly.
  After editing: run `bash scripts/build-roadmap.sh` to regenerate ROADMAP.md.
  ROADMAP.md is a generated artifact — never edit it directly.
  Usage: Add release notes here. Browse full history on GitHub via ROADMAP.md.
-->

# Release History

## 🚀 Releases

### v2.6 — Jun 20, 2026

#### v2.6.4
<sub>Shared Claude key via auth-gated proxy + household pattern inheritance</sub>

##### Features
- **Shared Anthropic key (no per-user keys)** — Browser Claude calls now route through a new auth-gated Edge Function `ai-categorize` that holds the key server-side (`ANTHROPIC_API_KEY` secret) and only serves logged-in household members (verified via `/auth/v1/user`, `aud="authenticated"`). All AI calls go through a single `callClaude()` helper: a personal key (if set) still calls Anthropic directly, otherwise it proxies with the user's session token so the key never reaches the browser. `aiCategorize`, `aiGroupLabels`, and AI-portal synthesis were rewired; import gating now uses `aiAvailable()` (logged-in is enough). Deploy the function with Verify JWT off — auth is enforced in-code. (~3,000 tokens)
- **Household pattern inheritance** — A new member with no history now inherits the household's merchant patterns, sample descriptions, and AI rules (i.e. the established user's formatting) until they accumulate their own, so onboarding imports are cleaned in the existing house style. (~1,000 tokens)

##### Fixes
- **Onboarding status accuracy** — The import status line distinguishes "AI call failed" from "AI unavailable / no key" instead of always blaming a missing key, and turns amber when AI did not run. (~250 tokens)

---

#### v2.6.3
<sub>Fix onboarding add-account insert</sub>

##### Fixes
- **Onboarding: add-account failed with null id** — Adding an account in the Onboarding tab threw `null value in column "id" of relation "accounts" violates not-null constraint`, because `accounts.id` is a text slug primary key (e.g. `venmo`, `rakuten`) with no auto-generated default. Add-account now derives a unique slug `id` from the account name (`"Chase United Club"` -> `chase_united_club`, with numeric suffixes on collision) and includes it in the insert. Transactions still key off the account label via `payment_type`, so balance-sheet joins are unaffected. (~500 tokens)

---

#### v2.6.2
<sub>Ledger owner badges in Combined view</sub>

##### Features
- **Ledger: owner differentiation in Combined view** — When the header view is `Combined`, each ledger row now shows a colored owner pill (e.g. `Mark` / `Shilpa`) prepended to the description, including expanded linked-group members; collapsed group summary rows show a badge per distinct owner so cross-person reimbursement groups are obvious. The badge is gated to the Combined view of a multi-member household (`scopeOwner()==null && householdMembers.length>1`), so single-person views and the legacy single-user setup are unchanged. Owner was already in the ledger `select=*` fetch, so no query change was needed. (~1,500 tokens)

---

#### v2.6.1
<sub>Multi-file onboarding import</sub>

##### Features
- **Onboarding: multi-file CSV import** — The onboarding import accepts multiple CSV files at once, since Chase caps a single CSV download at ~1000 rows so an initial onboard spans several files. All selected files are parsed and merged into one candidate set (with a guard against mixing bank formats), rows repeated across overlapping date-range downloads are auto-skipped before AI/DB duplicate checks, and the merged set runs a single pass of AI categorization → duplicate detection → review. The status line reports file count, total rows, and cross-file duplicates skipped. (~1,500 tokens)

---

#### v2.6.0
<sub>Onboarding import module</sub>

##### Features
- **Onboarding tab** — A new per-user Onboarding tab lets a signed-in member add accounts, import their transactions, and reconcile to a current balance. "My Accounts" creates `accounts` rows (label / type / optional current balance, owner auto-stamped); the import card reuses the existing calibrated pipeline (`detectBankProfile` → `transformCSVRow` → `aiCategorize` → `renderReviewTable`/`commitImport`) with the chosen account as `payment_type`. A Chase United Club CSV is auto-detected by the existing `chase` bank profile — no new parser. (~3,500 tokens)
- **Per-user AI personalization** — The parser now learns from the importing user's own history: `fetchMerchantPatterns` calls a new owner-scoped RPC `get_merchant_patterns_scoped`, and `fetchSampleDescriptions` / `fetchAIRules` filter by the signed-in owner via a new `importerQS()` helper. `ai_rules` gained `owner` + `household_id` (backfilled to `mark`) so each member keeps their own description-formatting rules. (~2,000 tokens)
- **Opening-balance reconciliation** — After import, the Reconcile card reads the account's live ledger balance (`get_ledger_balances_scoped`), compares it to the stated current balance (sign derived from account type — asset vs credit/liability), and inserts a single `adjustment`-category transaction dated just before the earliest imported row to true up the Balance Sheet. The `adjustment` category is excluded from the income statement, so historical accruals are unaffected. (~1,500 tokens)

---

### v2.5 — Jun 20, 2026

#### v2.5.0
<sub>Multi-user households</sub>

##### Features
- **Multi-user households** — Disciplan is now multi-user. A new `households` + `profiles` schema maps each Supabase auth user to an `owner` (e.g. `mark`, `shilpa`) within a household, and every user-data table (`transactions`, `accounts`, `balance_snapshots`, `tags`, `cashback_*`, `investment_*`, `preferences`, `pending_imports`, `group_overrides`) gained `owner` + `household_id` columns (existing rows backfilled to `mark`). Writes are auto-stamped with the signed-in owner in `sb()`. (~6,000 tokens)
- **Mark | Shilpa | Combined view switcher** — A header segmented control scopes every tab at once. Combined uses the original aggregation RPCs untouched (guaranteed-identical numbers); single-person views call new owner/household-scoped RPC variants (`get_income_statement_scoped`, `get_ledger_balances_scoped`, `get_credit_balances_scoped`, `get_tag_summaries_scoped`, `detect_subscriptions_scoped`) and `&owner=`/`&household_id=` REST filters. In-session caches are namespaced by view. The switcher only appears once a household with 2+ profiles exists, so the app is unchanged until the migration is applied. (~7,000 tokens)
- **Cross-person reimbursement mirroring** — When you reimburse a household member, their share is queued as a pending expense in their ledger via a new `pending_shared_txns` table. The recipient sees a review banner on load and can Approve (inserts the expense into their ledger) or Reject each proposal. (~5,000 tokens)
- **Scoped for future RLS** — The schema is structured so per-household / per-owner Row Level Security (INF-05) becomes a policy-only change; policies remain permissive (`USING(true)`) for now. (~500 tokens)

---

### v2.4 — May 30, 2026

#### v2.4.4
<sub>Deployed 2026-06-11</sub>

##### Features
- **Tags tab: open empty tags** — Tags with zero matching transactions now remain clickable in the Tags grid and open the existing tag detail modal, making the two-step `Delete Tag` flow available for empty cleanup tags as well as tags with transaction history. (~500 tokens)

---

#### v2.4.3
<sub>Deployed 2026-06-11</sub>

##### Features
- **Reimburse flow: Transfer credit sub-account** — When the Reimburse modal's Payment Method is set to `Transfer`, a "Credit Sub-Account" selector now appears (reusing `buildCreditSelect`), offering a dropdown of recent credit account names plus an "Other…" option to add a new one. The selected credit is stored on the generated reimbursement transaction (`createReimbursement` now takes a `credit` arg, blanked for non-Transfer types), matching the entry form and ledger edit modal behavior. (~1,500 tokens)
- **Reimburse split: 100% preset** — Added a `100%` option as the first choice in the `SPLIT_PRESETS` row so a full reimbursement can be selected in one click; the default highlighted split remains 50%. (~500 tokens)

---

#### v2.4.2
<sub>Deployed 2026-06-11</sub>

##### Bug Fixes
- **Import service-period normalization** — CSV, email, and payslip import edit modals now clamp `service_end` so it can never precede `service_start` (`syncServiceStartToEnd`), and all three commit paths run `normalizeCandidateServicePeriod` to re-derive `service_days` and `daily_cost` from the final dates before insert. Prevents negative/zero service windows and stale accrual math from reaching the ledger. (~1,500 tokens)
- **Net-worth chart accuracy** — Balance Sheet "Net Worth Over Time" now counts `other`-type accounts as assets (matching the headline net-worth total), and pins the latest chart point to the live computed totals so the trend line ends exactly where the current net-worth figure sits. (~1,000 tokens)

##### Features
- **Tags tab search/sort state** — Added persistent `state.tagsView` (`{q, sort}`) backing the Tags tab search box and sort control so the chosen query/sort survives re-renders within a session. (~500 tokens)

##### Infrastructure
- **INF-06: Cache Version Key** — Persisted `localStorage` offline caches (FEA-32) are now namespaced by a `CACHE_VERSION` segment (`CACHE_PREFIX="dc_v2_"` in `js/config.js`). A one-time `purgeStaleCache()` runs on load and removes any legacy `dc_`-prefixed keys that don't match the current versioned prefix, so a stale RPC/response shape carried over from a prior deploy can no longer cause rendering errors — future schema/response changes just need a `CACHE_VERSION` bump to invalidate all persisted caches cleanly. The in-memory `_dc` tab cache (FEA-89) and unrelated keys (`anthropic_api_key`, `ai_model`, `sessionStorage` group labels) are untouched. (~3,500 tokens)

##### Docs
- **UI-01: IS Unrealized G/L card (roadmap reconciliation)** — Marked UI-01 complete after confirming the work already shipped in code: the Income Statement has a standalone "Unrealized G/L" 5th KPI card on a `.g5` grid (`js/income-stmt.js`), a dedicated detail-table row with per-month drilldown, a cross-year G/L column (`js/cross-year.js`), and the old "Show Inv" toggle (FEA-07) has been removed entirely. The ledger-filter emoji-compaction sub-item was dropped as not worth doing — the category/payment/tag selects and date inputs can't meaningfully become emoji-only, and Clear (✖) / Subscriptions (🔄) are already iconified. (~3,000 tokens)

---

#### v2.4.1
<sub>Pushed 2026-06-03</sub>

##### Features
- **FEA-101: Tag detail delete action** — Tags can now be deleted directly from the open tag detail modal via a two-click `Delete Tag` → `Confirm Delete` flow. The action clears the tag from all matching transactions before deleting the `tags` row, invalidates transaction-derived caches, closes the modal, and refreshes the Tags tab. Includes the in-progress Tags tab search/sort controls already present in `js/tags.js`. (~3,000 tokens)

---

#### v2.4.0
<sub>Deployed 2026-05-30</sub>

##### Bug Fixes
- **BUG-32: Daily insight cron missing Supabase gateway auth** — `pg_cron` continued to succeed after May 13, but `net._http_response` showed `401 UNAUTHORIZED_NO_AUTH_HEADER` because the `daily-insight` cron request only sent `X-Cron-Secret`; Supabase rejected the request before the Edge Function's own secret check could run. Patched the live cron command to include `Authorization: Bearer <anon>` and `apikey: <anon>`, increased `timeout_milliseconds` to `60000` for the heavier FEA-100 pipeline, and added migration `20260530000001_daily_insight_cron_auth.sql` that preserves the existing `X-Cron-Secret` by extracting it from `cron.job.command`. Verified with a `pg_net` dry-run: `insight_log.id=108`, `dry_run=true`, `parse_fallback=false`, no Postmark message ID. (~4,000 tokens)

---

### v2.3 — Apr 26, 2026

#### v2.3.6
<sub>Deployed 2026-05-14</sub>

##### Features
- **FEA-100: Newsletter engagement archetypes (Phase C)** — Six new accrual-aware archetypes added to the daily-insight pipeline plus selection-policy upgrades. Builders: `on_this_day_flashback` (storytelling — what your life *cost* on this calendar day in prior years, computed from `daily_cost` overlap not transaction-date amounts so rent/trips/annual subs surface correctly), `streak_or_gap` (rhythm — longest current spending gap among commitment-based parents `food`/`personal`/`entertainment`/`transportation`, ranked vs trailing-12mo distribution), `net_worth_velocity` (longhorizon — 90d net-worth delta vs same window 1y ago, monthly aggregates from `balance_snapshots`), `monthly_burn_forecast` (forward — projected total accrued cost for current month = already-accrued MTD + locked-in remainder + variable forecast, vs trailing-12mo monthly mean), `cashback_roi` (health — YTD effective rate per card with drag-card detection), `trip_year_in_review` (trips — annual rollup from `get_tag_summaries`, fires Jan 1-31 for prior year else YTD). Selection policy v2: `theme` column on `insight_strategy` (backfilled across all 17 archetypes); soft 0.7× score multiplier when same theme appeared in last 3 sends; novelty bonus of `0.3 × (1 − sent_count/5)` decays over first 5 sends so new archetypes get exploration head start. Migration `20260514000001_engagement_archetypes.sql` applied via `db query --linked --file`. Function deployed. Verified via 11-fixture dry-run replay (2025-08 through 2026-05): `on_this_day_flashback` fired 4× including today's "FA Cup Final at Wembley, Airbnb $88/day of $1,406 total" — perfect demo of accrual-correctness (transaction-date semantics would have collapsed the Airbnb to a single booking-day hit). `cashback_roi` fired with $1,742 YTD at 6.25% blended rate, per-card breakdown. AI portal strategy table gains read-only `theme` column. Mark's 2026-05-14 directive baked into design: every builder uses `daily_cost` accrual or has explicit cash-mechanics justification. Future-session tuning hook: query `insight_log` for per-archetype rating averages + comments after ~8-12 weeks of cron sends, recalibrate priority weights, deepen winners, retire bottom performers. (~12,500 impl+verify tokens / ~$0.55 session)

---

#### v2.3.5
<sub>Deployed 2026-05-13</sub>

##### Infrastructure
- **FEA-99: Disciplan schema namespace + explicit Data API grants** — Defensive prep ahead of Supabase's Oct 30, 2026 removal of auto-grants on `public`. Phase 1 (live): two new migrations — `20260513000002_data_api_grants.sql` adds explicit `GRANT SELECT/INSERT/UPDATE/DELETE` for `authenticated`, `GRANT ALL` for `service_role` on every existing object in `public`, plus `ALTER DEFAULT PRIVILEGES` so any future table auto-receives grants. `js/config.js` adds `DB_SCHEMA` constant (currently `"public"`), threads it into `createClient`, and sends `Accept-Profile`/`Content-Profile` headers on all Data API requests — functional no-op today, validates the PostgREST schema-routing mechanism for the upcoming move. Both Edge Functions (`daily-insight`, `inbound-email`) now read `DB_SCHEMA` env var (default `"public"`) and pass to `createClient`. Phase 2 (staged, not yet applied): `20260513000003_disciplan_schema.sql` is ready to move all 22 tables + functions/views from `public` → `disciplan` schema, namespacing them away from Nocturnal. Full 6-step rollout runbook + rollback SQL at `tasks/disciplan-schema-rollout.md`. CLAUDE.md updated with the new-table migration template requiring explicit GRANTs and `disciplan.`-qualified names. (~12,000 impl tokens / ~$0.60 session)

---

#### v2.3.1
<sub>Deployed 2026-04-27</sub>

##### Features
- **FEA-97: Newsletter Hybrid Insight Engine (Phase A/B)** — `daily-insight` Edge Function refactored from a single mega-prompt into a deterministic candidate pipeline (`archetypes.ts`, `selection.ts`, `types.ts`) with ε-greedy stochastic selection (`epsilon=0.15`) over scored candidates. Phase A fixes silent miscounts by reading `EXPENSE_CATS` / `PARENT_ROLLUP` dynamically from the `categories` table. Phase B reworks four archetypes: `tag_recap` (replaces `tag_burn_rate`; historical trip recaps with 1y/2y/3y anniversary boost ±10 days), `category_anomaly` smart-combo drill-down (merchant > tag > description by concentration), `category_trend` deep-dive (12 complete months only, relative-strength gate `≥0.15`, `min_r2=0.10`, excludes `financial`/`other`, multi-chart `chart_configs[]` for parent + child breakdown), `income_breakdown` YoY + 3Y CAGR pivot (requires `day_of_year ≥ 60` and `\|YoY\| ≥ 3%`). New tables: `insight_strategy`, `insight_selection_log`, `principles_pending`. New `insight_log.subject_key` column for structured dedup. Dry-run mode filters history by fixture cutoff so cooldowns evaluate correctly during historical replay; `scripts/replay-newsletter.sh` helper. 8 migrations. (~24,000 impl tokens / ~$1.20 session)
- **FEA-98: Newsletter Admin Portal v2 + Inbound Feedback Guardrails** — `#ai/Newsletter` tab gains 6 KPI cards (sends, rated %, avg rating, total cost, parse fallbacks, dry-run replays), strategy table (priority weights, cooldowns, monthly caps, last-used reasons), pending principles approval queue (approve/reject inline), recent selection traces, and a dry-run viewer separated from real sends. `inbound-email` function now routes Haiku-distilled principles updates through `principles_pending` (operator approval), auto-rejects updates with >30% length delta or banned override prefixes (`ignore`, `disregard`, `system:`) as prompt-injection defense, and calls `apply_strategy_feedback` RPC to feed ratings into the bandit (clamped to ±0.10 weight delta, bounded `[0.1, 2.0]`). (~6,000 impl tokens / ~$0.30 session)

---

#### v2.3
<sub>Deployed 2026-04-26</sub>

##### Bug Fixes
- **BUG-34: CSV import fails for Chase United (PGRST102 "All object keys must match")** — CC payment Side B rows were missing `ai_original` field, causing PostgREST to reject the bulk insert when both regular rows (with `ai_original`) and CC Side B rows (without) were batched together. Added `ai_original:null` to the Side B row object. (~500 impl tokens / ~$0.01 session)

---

### v2.2 — Apr 15, 2026

#### v2.2.3
<sub>Shipped 2026-04-17</sub>

##### Infrastructure
- **FEA-96: Automated Supabase Backup** — GitHub Actions workflow runs every Monday at 10am UTC, fetches all 6 tables (`transactions`, `categories`, `tags`, `accounts`, `balance_snapshots`, `portfolio_snapshots`) via paginated REST calls, uploads as a 90-day artifact (~2.5 MB/run). Sends Postmark success email to Gmail. Monthly cron job on Mac downloads the latest artifact to `data/backups/disciplan_backup_YYYYMMDD/` with a native Mac notification on completion. (~2,000 impl tokens / ~$0.08 session)

---

#### v2.2.2
<sub>Deployed 2026-04-15 (3)</sub>

##### Bug Fixes
- **BUG-33: GTL incorrectly inflated medical deduction** — GTL (Group Term Life) is IRS imputed income excluded from the Current row's Gross Pay and not reflected in Post Tax Deductions; it has zero cash impact. Removed GTL parsing from both PDF and XLSX parsers and dropped `+gtl` from the medical formula, which was overstating the Medical Insurance Benefits transaction by ~$16.96/payslip. (~300 impl tokens / ~$0.01 session)

---

#### v2.2.1
<sub>Deployed 2026-04-15 (2)</sub>

##### Bug Fixes
- **BUG-32: XLSX payslip — Connectivity Reimbursement and GTL not parsed** — Earnings rows in XLSX have 7 columns (`Description | Dates | Hours | Rate | Amount | YTD Hours | YTD Amount`); parser was reading `c[1]` (date string) instead of `c[4]` (amount), causing both Connectivity Reimbursement and GTL to parse as 0. Fixed by reading `earningsAmt = c[4]` for all Earnings section items. (~500 impl tokens / ~$0.02 session)

---

#### v2.2.0
<sub>Deployed 2026-04-15</sub>

##### Features
- **FEA-95: Payslip — Connectivity Reimbursement Fund** — Pinterest payslips now parse the "Connectivity Reimbursement Fund" benefit line from both PDF and XLSX formats (searched in Employer Paid Benefits and Post Tax Deductions sections, with fullText fallback for PDF). Generates a `utilities` / Chase Chequing credit transaction (negative amount) in the same payslip group. After commit, auto-links to the AT&T internet charge in the same calendar month: looks for `description ilike *AT&T*` with `service_start = first of month` and `service_end = last of month`; links via `linkToGroup` if found, leaves unlinked otherwise. (~2,500 impl tokens / ~$0.20 session)

##### Bug Fixes
- **BUG-31: Daily insight cron pg_net timeout** — The `daily-insight` pg_cron job had `timeout_milliseconds:=1000` (1 second). On April 15, slow DNS resolution (172ms) + SSL handshake (115ms) + function response (711ms) totalled 1001ms, causing pg_net to cut the connection mid-execution before Postmark was reached. Updated cron job to `timeout_milliseconds:=5000` via `cron.alter_job`. (<1K impl tokens / ~$0.05 session)

---

### v2.1 — Apr 4, 2026

#### v2.1.5
<sub>Deployed 2026-04-10</sub>

##### Features
- **FEA-94b: AI Portal — Newsletter tab** — Newsletter is now the first and primary section of the AI portal. Shows KPI row (emails sent, rated %, avg rating, total AI cost), performance breakdown by insight type (sorted by avg rating), full email log with inline feedback comments, and a live view of the current `insight_context` learned principles with an inline editor to curate them directly. (~1,500 impl tokens / ~$0.03 session)
- **FEA-94: AI Dev Portal** — New dev-only tab accessible at `#ai` (linked from footer). Five sections: (1) **Decision Log** — side-by-side table of AI suggestions vs committed values for CSV imports (`ai_original` jsonb column on `transactions`) and email imports (`final_category_id`, `was_edited` on `pending_imports`), color-coded for category changes (red/green) and description edits (yellow). (2) **Performance Dashboard** — category accuracy %, description acceptance rate, confidence calibration (high/medium/low vs actual accuracy), accuracy breakdown by email source. (3) **Feedback Interface** — freeform notes, one-click "Create Rule" from recent overrides, feedback log from new `ai_feedback` table. (4) **Rules Engine** — CRUD UI for persistent `ai_rules` table; active rules are injected as highest-priority prompt section into `aiCategorize()` on every import. (5) **Synthesis Agent** — "Analyze Feedback" button calls `claude-opus-4-6` with all feedback, overrides, and group label corrections; returns 3–8 structured rule suggestions; user accepts → `ai_rules`; runs logged to `ai_synthesis_runs` table. Covers all three AI features: CSV categorization, email import pipeline, and group label generation. (~8,000 impl tokens / ~$3.10 session)

##### Bug Fixes
- **BUG-30: AI portal footer link did nothing** — Footer `<a href="#ai">` changed the URL hash but didn't update `state.tab` or call `renderContent()`. Added `onclick` handler matching tab button pattern: sets `state.tab`, calls `history.replaceState`, `renderTabs()`, and `renderContent()`. (~50 impl tokens / ~$0.00 session)

---

#### v2.1.4
<sub>Deployed 2026-04-11</sub>

##### Features
- **FEA-93: CAD/non-USD FX rate auto-fill** — Selecting a non-USD currency in the Entry form now auto-populates the FX Rate field with the live rate from `DFX` (fetched from Frankfurter API at startup). Rate is editable. Hint updated to "Live rate · edit to override". Previously the field was blank, making it unclear what rate would be applied. (~500 impl tokens / ~$0.01 session)
- **FEA-88: Import Merchant Patterns RPC** — Replaced `fetchMerchantPatterns()` paginated loop (12K+ rows, ~13 round-trips) with a single `get_merchant_patterns` RPC call. Server aggregates `description + category_id` counts, returns top 200 patterns with count ≥ 3. Client normalizes via existing `normalizeMerchant()`. Import startup is now one fast RPC instead of a multi-second paginated fetch. (~500 impl tokens / ~$0.01 session)
- **FEA-91: Ledger search includes credit sub-accounts** — Added `credit.ilike.*q*` to the Ledger search OR filter alongside description, tag, and payment_type. Searching e.g. "Vanguard" or "Chase Savings" now matches transactions by their credit sub-account. (~100 impl tokens / ~$0.00 session)
- **FEA-92: Data Integrity Health Check** — New "Data Health" section in Export tab with an on-demand "Run Health Check" button. Runs 4 server-side checks via `run_data_health_check` RPC: (1) orphaned `transaction_group_id` groups with only 1 member, (2) `daily_cost × service_days` diverging from `amount_usd` by > $0.02, (3) tag values in transactions missing from the `tags` table, (4) potential duplicate transactions (same date + description + amount + payment_type). Results show ✓ Clean or ⚠ N issues with expandable detail rows. Duplicates check notes payslip rows may appear intentionally. (~1,500 impl tokens / ~$0.02 session)

##### Bug Fixes
- **BUG-29: Import rows button visually faded when enabled** — The paste-import modal's "Import N rows" button used `background: rgba(42,157,143,0.25)` and never updated it on enable, so the button looked dim/disabled even after a successful parse. `showPreview` now sets the background to `rgba(42,157,143,0.7)` on success and resets to `0.25` on no-rows. (~500 impl tokens / ~$0.00 session)

---

#### v2.1.3
<sub>Deployed 2026-04-09</sub>

##### Features
- **FEA-11 feedback loop end-to-end** — Reply-to-rate working: `In-Reply-To` header now correctly parsed (strips `@smtp.postmarkapp.com` domain suffix that Postmark appends to Message-IDs). Ratings and comments land in `insight_log`, and substantive comments are distilled into `insight_context` principles via Claude Haiku. First live feedback recorded: `income_breakdown` 7/10 — "Some of the insights could go deeper (i.e. what is the Y|Y rate, CAGR etc)". (~2,000 impl tokens / ~$0.03 session)

##### Bug Fixes
- **BUG-26b: Monthly expense totals under-counted vs IS tab** — `fmtMonthlyExpenses` showed only 11 categories, silently omitting `furniture`, `clothes`, `utilities`, `financial`. Switched to parent-level rollup (food = food+groceries+restaurant, home = home+rent+furniture, personal = personal+clothes+tech) matching IS tab logic exactly. Added Total column. (~1,000 tokens)
- **BUG-26c: Large-transaction service period not shown** — `fmtLargeTransactions` filtered by `date` (booking date) with no service period info, so Claude misattributed past-service transactions (e.g. Taiwan Airbnb logged Apr 7, service was 2025) to current month. Added `service_start → service_end` to display when service differs from log date. (~500 tokens)
- **BUG-26d: Data source switched to `get_income_statement` RPC** — Replaced TypeScript accrual reimplementation + paginated transaction loops with 3 RPC calls (one per year). RPC uses the same `daily_accruals` view the IS tab uses — correct by construction, no pagination risk. (~2,000 tokens)
- **BUG-28: IS Monthly Detail drilldown modal not appearing** — `showISDrilldown` built and wired the modal elements correctly but never appended them to the DOM — the final `bg.append(modal); document.body.append(bg)` lines were missing. Clicking any monthly cell now shows the drilldown popup. (~3,500 impl tokens / ~$0.05 session)

##### UI
- **FEA-11 — Outfit font in email header** — Added Google Fonts `@import` for Outfit + JetBrains Mono; applied to "the disciplan" header span and "DAILY INSIGHT" badge. Renders correctly in Apple Mail / iOS Mail; falls back to system sans-serif in Gmail. (~200 tokens)
- **FEA-11 — Email import inbound address updated to new Postmark account (disciplan.dev)** — Updated hardcoded fallback in `entry.js`, comment in `inbound-email/index.ts`, and `preferences` table row `inbound_email_address` in Supabase. The Entry tab now shows `8e70a9e284a1705b967239e049a59b65@inbound.postmarkapp.com` and `daily-insight` REPLY_TO matches. (~500 impl tokens / ~$0.01 session)

---

#### v2.1.2
<sub>Deployed 2026-04-07 22:43 UTC</sub>

##### Bug Fixes
- **BUG-26: Tags save — "Maximum call stack size exceeded"** — `openLedgerEditModal` and `openGroupEditModal` wrapped `onSaved` in a `_onSaved` closure, then immediately reassigned the parameter variable to `_onSaved`. The closure captured the variable (not the value), so `_onSaved` referenced itself, causing infinite recursion on every save from the Tags tab. Fixed by capturing the original callback as `_orig` before creating the wrapper. (~500 tokens)
- **BUG-27: Tags date picker — clicking end date snaps focus back to start** — Both the card inline editor and the modal date editor listened for `click` on their container. Clicking either date input bubbled up to the container, re-ran the setup code, and called `startIn.focus()` — resetting to the start date every time. Fixed by adding `e.stopPropagation()` on both date inputs after they are created. (~1,500 tokens)

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

##### Features
- **FEA-11: Daily AI Finance Insight Newsletter** — Supabase Edge Function (`daily-insight`) runs on a daily cron at 8am PT. Fetches 14 months of accrual expense/income data, calls Claude Sonnet 4.6 to pick the highest-value insight type for the day (trained preferences: `category_yoy` 8/10, `budget_pace` 7/10, etc.), writes a tight 2-3 sentence write-up with a Chart.js chart rendered via QuickChart.io, and sends via Postmark to mark.q.ren2020@gmail.com. Email includes key stat callout, chart image, CTA button to open the app, token cost in footer, and reply instructions.

  Feedback loop: replying with `8/10 comment text` is caught by the existing `inbound-email` Edge Function, matched to the original email via `In-Reply-To` → `postmark_message_id`, and stored in `insight_log`. If the comment is substantive (>20 chars), Claude Haiku distills it into an `insight_context` principles document that is prepended to every future prompt — foundational learnings accumulate over time. Recent feedback (last 10 rated insights) is also included in the prompt.

  Model strategy: start with Sonnet; switch to Haiku once average rating ≥ 7.5 over 20 samples.

---

<details>
<summary><strong>Previous Releases</strong> (v0.5.0–v2.0)</summary>

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
