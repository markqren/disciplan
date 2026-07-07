# Disciplan — Roadmap & Feedback Tracker

**Last updated:** Jul 6, 2026 | [disciplan.netlify.app](https://disciplan.netlify.app) | Stack: index.html + js/*.js modules + Chart.js + Supabase

---



## 🚀 Releases

### v2.10 — Jul 5, 2026

#### v2.10.3
<sub>Bilt rent auto-detection + confirmed Splitwise split on import (FEA-114)</sub>

##### Features
- **Bilt rent auto-detected on import + one-click Shilpa split (FEA-114)** — The Bilt CSV posts each month's rent as two `$3,495` lines that both contain the word "Payment" (`Bilt Housing Payment`, the charge, and `Payment - Bilt Housing`, the card payoff), so the greedy `detectPayment:/payment/i` rule turned **both** into a `Bill Paid: Bilt → Chase Chequing` financial pair — the rent charge never became Rent. The only reliable charge-vs-payoff signal is the **sign** (charge = positive, payoff = negative), so `detectPayment` now requires a negative amount and a new `detectRent` (`/housing/i` + positive) classifies the charge. `transformCSVRow` emits it as `Rent - <Month YYYY>` (via `monthLabel`), category `rent`, payment `Bilt`, accrued across the whole month (`ACCRUAL_D.rent="month"`), and `applyAIResults` leaves `_isRent` rows untouched so the classification/description/accrual can't be clobbered. At commit the rent charge is auto-grouped with its same-month card-payoff pair (matching the prior-month manual grouping: Rent + Bill Paid + Bilt Card Payment). **Split with Shilpa is now confirm-during-import, not manual:** a "Split rent?" dialog appears before saving (per-charge checkbox, editable %, "Push to Splitwise" toggle — all default on), and on confirm `createRentSplit` writes the `Reimbursed - Rent - <Month> - Shilpa` credit into the same group (tagged with the import batch so Undo removes it) **and pushes a real 50/50 Splitwise expense via the API** (`pushRentSplitToSplitwise` reuses the saved friend/group mapping + `swCreateExpense`, non-fatal on failure). Partner name defaults to the other household member; ratio defaults to 50%. (~16,000 tokens)

#### v2.10.2
<sub>Splitwise multi-person group splits (FEA-29C) · newsletter archetype audit &amp; tuning (FEA-113) · income compensation breakdown (FEA-115)</sub>

##### Fixes
- **Cash-flow chart tooltip formatting** — The Expenses series on the Monthly Cash Flow chart (Income Statement tab) and the annual chart (cross-year "All" view) is drawn as a floating bar spanning `[net, income]`, so its tooltip dumped the raw range array (e.g. `Expenses: [17114, 29153]`) instead of the actual spend. Both charts now use a `tooltip.callbacks.label` that reports the real expense amount (`income − net`) and formats every money series with `fmtT` (full digits, comma separators, `()` for negatives), while Savings Rate renders as a clean `NN%` (or `—` for incomplete months). (~1,500 tokens)
- **Two never-firing newsletter archetypes fixed (FEA-113)** — `net_worth_velocity` required a 90-day snapshot window a full year back that the sparse snapshot cadence never populated (skip reason `yearago_window_only_1_points`), and `streak_or_gap` required `gap≥7` AND `rank≤3` simultaneously — neither had EVER fired. `net_worth_velocity` now fires on the recent window alone with the year-over-year comparison optional (omitted, not faked, when year-ago data is thin), and `streak_or_gap` adds a long-gap escape hatch (`gap≥14` qualifies regardless of rank). Validated live: `net_worth_velocity` fired for the first time on 2026-07-06 (7/10). (~3,000 tokens)
- **Newsletter chart rendering hardened (FEA-113)** — The 2026-07-06 `net_worth_velocity` chart uploaded to QuickChart but returned HTTP 400 on render, reaching the email as a broken error image; output had truncated against the `max_tokens: 2000` cap (1947 tokens). Raised generation `max_tokens` 2000→3500 (and the JSON-repair retry 1200→2500) so a 24-month multi-dataset chart config plus the write-up can't truncate mid-JSON, and added render-validation — each QuickChart short URL is GET-checked and a non-200 drops to the clean empty-state fallback instead of shipping a 400 image. Protects every archetype. (~1,500 tokens)

##### Features
- **Splitwise multi-person group splits (FEA-29C)** — The reimburse form's Splitwise push previously only created a two-person expense (you + one friend); picking a group filed it in that group but left everyone else owing $0. Now the group dropdown comes first, and selecting a group loads its full member list (the `groups` edge action returns each member's name plus your own `current_user_id` so you're excluded as the payer) and renders a **per-member checklist** — everyone pre-checked, each share editable, defaulting to an **equal split including yourself** (`cost ÷ N`) with a live "you owe / others owe / total" summary. On submit, `handleCreateExpense` accepts a `participants:[{user_id, owed}]` array and writes `users__0` (you: paid the whole cost, owe your share) + `users__1..N` (each member owes their share), with the payer absorbing any cent-rounding so all `owed_share`s sum exactly to `cost`. Members don't need to be your direct Splitwise friends — group membership is enough. The legacy single-friend "No group (direct split)" path and its `friend_user_id`/`friend_owed` payload are preserved as a fallback; the local reimbursement credit tracks the group split (what others owe you) regardless of the push checkbox. (~3,500 tokens)
- **Newsletter archetype tuning from feedback audit (FEA-113)** — Audited all 17 insight archetypes against logged ratings/feedback and retuned the worst offenders (all via the operator-editable `insight_strategy` columns — no deploy unless noted): **disabled** `spend_projection` (a naive linear projection that re-projected already-cleared fixed costs — the "math looks wrong" complaint — superseded by `monthly_burn_forecast`); **reframed** `large_transactions` (code) from a backward-looking logged-date charge list Mark rated 4/10 ("just noting transactions by the logged date… not novel") into a forward-looking **"new commitments & forward accrual"** view — charges whose service period began in the last 14 days, ranked by remaining `daily_cost × days left`; **rewrote** `category_yoy` guidance to REQUIRE a `run_finance_query` cross-year driver drill-down before naming any cause (fixing the 2/10 "you should be telling me exactly what's going on… if you're just guessing what is the point. Is this net accrual?") and to label figures as accrual + add a YTD run-rate; and raised `min_quality_score` floors on legacy archetypes so marginal days stay quiet. (~4,000 tokens)
- **Query-tool efficiency directive (FEA-113)** — After `net_worth_velocity` ran ~3 gratuitous `run_finance_query` calls on 2026-07-06 (20.1k input tokens, $0.089 — top of range) despite the facts already containing the series + annualized rate, strengthened the global tool prompt (each query is a full round-trip that re-bills the whole context; never query for a figure already in the facts; fold needs into 0-2 queries; derive simple arithmetic/projections directly) plus a per-archetype efficiency note. Grounded in real logged cost: baseline ~$0.022/send, ~$0.04–0.13 with 1–4 tool calls (hard-capped at 4). (~1,000 tokens)
- **More archetype audit fixes: category_trend, category_anomaly, budget_pace (FEA-113)** — Continued the one-by-one audit. `category_trend` (5.25/10) fired on noisy non-trends because its live `min_r2` floor was **0.10** while the code intended ≥0.35 — raised to 0.30 (and `min_relative_strength` 0.15→0.20, code defaults aligned) so it only fires on genuine, tight trends. `category_anomaly` (7.25/10) had **no** non-consumption guard and shipped an "Other Category Spike"; it now shares `category_trend`'s exclusion of `financial`/`other` (renamed `NON_CONSUMPTION_PARENTS`) so transfers and the catch-all bucket can't masquerade as a spending spike. `budget_pace` gained trip-tag separation guidance (query the tagged-trip portion of any over-pace category and report baseline-recurring vs trip spend separately, so a trip can't be mislabeled as overspending) and had its firing frequency cut (`monthly_max` 6→3, `cooldown` 4→7d, `min_quality_score` 0→0.15). (~2,500 tokens)
- **Income → compensation breakdown (FEA-115)** — Reworked the `income_breakdown` archetype from a bare "YTD income up N%" line (rated 5.5, and its total was inflated — the old `fetchYtdIncome` summed `abs(amount_usd)` over all income rows, counting **tax withholding, refunds, and Zelle self-transfers as income**) into a real owner-scoped compensation breakdown: equity (RSU vests) vs cash salary vs bonus/severance, effective tax rate, and 401K savings rate (employee deposits + employer match over gross), each YTD vs the same calendar day the prior 2 years. Classification is **word-boundary safe by construction** — the string "P·interest·Income" (and "interest income") had silently inflated an ad-hoc bucket ~400×, so both the TS `classifyIncomeDescription` helper and the reference SQL handed to the writer use `~* '\yinterest\y'` + an explicit deny-list, never bare substring matching; 401K "savings" nets only the deposit legs (rollovers excluded). Per Mark's steer, the AI keeps flexibility (approach C): the deterministic, validated `facts` are the ground-truth baseline, and the archetype's DB `prompt_guidance` now flips the old "don't speculate" rule into "call `run_finance_query` once to NAME the driver (which RSU grant / bonus / raise)" with two canonical reference queries, marks the archetype cash-basis, and raises the YoY firing gate 3%→6%. Validated live against your data (2025 gross $454k, eff-tax 33%, savings 10%; 2026 YTD cash correctly populated). Edge-function + migration `20260707005139_income_comp_guidance.sql` — committed, deploy pending. (~9,500 tokens)

#### v2.10.1
<sub>Adobe-style change history &amp; undo panel (FEA-112)</sub>

##### Features
- **Change history &amp; undo panel (FEA-112)** — A slide-out **History** panel (new `↺` button in the header, openable from any tab) turns the v2.9 `audit_log` backend (FEA-109) into an Adobe-style, user-facing undo. `js/history.js` reads the household's audit trail newest-first, groups rows by `txid` into one entry per action (a 300-row import shows as a single "Added 300 transactions · total $X" line), and renders human-readable labels built from the before/after JSONB — e.g. `Edited "Starbucks": amount $5.00 → $6.00`, `Deleted "Rent"`, `Added "Whole Foods" · $84.20 · 7/2/26` — color-coded by op (green add / yellow edit / red delete) with actor + relative time. Two revert actions per entry: **"Revert to here"** rolls back everything newer via a new atomic `disciplan.revert_to(p_id)` RPC (one transaction, one `txid` → redoable as a unit, disabled on the newest entry), and **"Revert just this"** undoes a single action via `revert_operation`, warning first when a newer un-reverted change touched the same row (the non-linear-history clobber case). Reverted actions render greyed + struck-through; each revert clears caches, re-renders the active tab, and reloads the list (the inverse change appears as a new entry — append-only trail). New migration `20260706004055_revert_to.sql` pushed to the live DB and verified in migration history; frontend-only deploy (v2.10.0 newsletter backend has since been deployed — 4 migrations pushed + both edge functions ACTIVE). (~6,500 tokens)

#### v2.10.0
<sub>Newsletter overhaul (FEA-110): per-recipient data isolation · self-tuning loop repair · DB-driven per-archetype guidance · agentic read-only query tool — plus follow-up Q&A (FEA-111)</sub>

##### Fixes
- **Newsletter data isolation (FEA-110)** — The `daily-insight` edge function ran as service-role and read the whole household's ledger (`get_income_statement`, `get_tag_summaries`, `run_data_health_check`, and every raw `transactions`/`tags`/`balance_snapshots`/`cashback_redemptions` query had **no owner filter**), so Shilpa's ~1,900 transactions were blended into Mark's newsletter — the top driver of recent 2-3/10 ratings ("this is pulling Shilpa's transaction data"). Every fetch is now scoped to a configurable `INSIGHT_OWNER` (default `mark`) via a `scopeToOwner()` helper + the existing `*_scoped` RPCs, plus a new owner-scoped `run_data_health_check_scoped`. Legacy whole-household mode preserved by unsetting the secret. (~4,000 tokens)
- **Self-tuning principles loop repaired (FEA-110)** — The inbound-email feedback distiller regenerated the *entire* principles document at `max_tokens: 800`; once the doc outgrew that budget it silently **truncated** — the live doc was cut off mid-sentence at `large_transactions`, dropping the whole GENERAL section. It now asks Haiku for ONE concise lesson (or `NONE`) and **appends** it under a `FEEDBACK-DERIVED LESSONS` section (bounded, never truncates), with a banned-prefix check on the lesson itself. The principles doc was reset to a clean GENERAL-only baseline (per-archetype specifics moved to `prompt_guidance`), and the AI portal gained a "Dismiss all" to clear a stalled pending queue. (~2,500 tokens)

##### Features
- **DB-driven per-archetype guidance (FEA-110)** — The per-insight writing/formatting guidance that was hardcoded in `buildArchetypePrompt` now lives in two operator-editable `insight_strategy` columns: `prompt_guidance` (free-text instructions injected into the prompt for the chosen insight) and `accrual_basis` (`accrual`/`cash`, so figures are described on the right basis — addressing repeated "this uses logged date not service date" feedback). Seeded for all 17 active archetypes and editable inline from the AI portal's strategy table, so tone/structure/emphasis can change with **no code deploy**. (~3,500 tokens)
- **Agentic read-only query tool (FEA-110)** — The newsletter writer can now fetch numbers the fixed archetype facts never computed (split spend by trip tag, verify a net-accrual figure, derive a YTD run-rate) via an Anthropic tool-use loop backed by a guarded `disciplan.insight_run_query()`. Safety: single read-only `SELECT`/`WITH` only, runs with `search_path = insight_ro` over owner-scoped views (base tables unreachable), schema-qualified/catalog references and comments rejected, statement timeout + 500-row cap, `EXECUTE` granted to `service_role` only. Owner is pinned via a GUC the views read (fail-closed) — the model can never see another member's data. Guardrails validated against the live DB (writes, schema-escape, catalog, comments all blocked; per-owner counts correct). (~4,500 tokens)
- **Follow-up Q&A in the next newsletter (FEA-111)** — When Mark replies to an insight with a question ("is this net accrual?", "what's the YoY rate?", "break entertainment into children"), `inbound-email` now queues it in a new `disciplan.insight_followups` table (only when the reply actually asks something — a "?" or an interrogative/imperative phrase — so pure praise/criticism doesn't create a dangling Q). The next day's `daily-insight` reads pending questions, answers them in a dedicated **"Following up on your question"** email block — using the read-only query tool to pull exact numbers — then marks them answered (only on a real, non-fallback send, so a bad day never swallows a question). The AI portal's Newsletter section surfaces pending/answered follow-ups with a "Dismiss all" escape hatch. Closes the loop so questions get real answers without a code change. (~4,000 tokens)

### v2.9 — Jun 28, 2026

#### v2.9.0
<sub>Change audit ledger with revert/undo · on-behalf-of onboarding · account-scoped Ledger payment filter</sub>

##### Features
- **Change audit ledger + revert/undo (FEA-109)** — New `disciplan.audit_log` records every INSERT/UPDATE/DELETE across all **18 owner-stamped tables** (transactions, accounts, balance_snapshots, tags, investment_*, cashback_*, splitwise_*, profiles, preferences, …) via one generic `SECURITY DEFINER` trigger (`fn_audit`). Each entry captures the full `old_data`/`new_data` JSONB, the columns that actually changed, the row's owner/household, **who** made the change (`actor` resolved from the JWT via `profiles`), and `txid_current()` so every row touched by a single REST request (a 300-row import, or an edit + its counter-leg) shares one undo group. No-op / `updated_at`-only writes are skipped so the log stays meaningful. Three `can_write`-gated RPCs reverse changes — `revert_audit_entry(id)`, `revert_operation(txid)` (undo a whole import/edit), and `undo_last()` — and because a revert issues normal DML it is itself audited, so undo is re-doable. RLS-scoped to the household; clients can read history but never write/tamper with it. Forward-looking (records from this deploy onward). Verified end-to-end on the live DB: insert → logged → `revert_operation` deleted the row, marked the original reverted, and captured the inverse DELETE attributed to the acting user. (~5,000 tokens)
- **On-behalf-of onboarding (FEA-107)** — A new `writeOwner()` helper (`js/config.js`) stamps newly-created rows to the active person-view when an admin is viewing another household member (e.g. Mark setting up Shilpa's books from his login), falling back to the signed-in user for Combined / own-view — mirroring the DB RLS `can_write()`. The Onboarding tab now computes an `acting` owner and scopes its account list, slug de-duplication, reconcile-balance RPC, and earliest-transaction lookup to that person (generalizing `importerQS` → `actQS`), and shows a read-only banner when you're viewing a member you can't write. Fixes accounts/imports/reconcile silently landing under the wrong owner when set up on someone else's behalf. (~2,500 tokens)
- **Ledger payment filter scoped to your accounts (FEA-108)** — The Ledger payment-type dropdown now lists only the payment types the viewer actually holds an account for (`accounts` scoped via `ownerQS()`) instead of the full 39-entry `PTS` list. Falls back to `PTS` before accounts load / when none exist, and always keeps the currently-selected payment type even if it has no account row. (~1,000 tokens)

### v2.8 — Jun 27, 2026

#### v2.8.2
<sub>Wells Fargo Checking/Savings CSV import with transfer pairing</sub>

##### Features
- **Wells Fargo import (FEA-106)** — Shilpa's Wells Fargo Checking & Savings statements (shared `DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS` header) now import through the existing CSV pipeline via a new `wells_fargo` bank profile; the account auto-defaults from the filename (`Wells Fargo Savings`/`Wells Fargo Checking`, the latter added to `PTS`). A profile-level `classifyRow` (plumbed into `transformCSVRow`, guarded so Mark's `chase_checking` path is untouched) routes every row: **skips** payroll already captured by the payslip flow (`TAV EMPLOYER`/`PRONTO …PAYROLL`) and CC payments owned by the card import (`CHASE CREDIT CRD EPAY`, `BILT CARD PMT`, `AMEX EPAYMENT`); books Google payroll / interest / IRS refunds as **income**; parks Zelle (either direction) in **other**; and treats account-to-account moves (`ONLINE TRANSFER`, `ATM WITHDRAWAL`, `SCHWAB BROKERAGE`, `VENMO`, `Splitwise`, wires, Morgan Stanley) as **transfers**. Inflows post negative `amount_usd` / outflows positive so `balance = −SUM(amount_usd)` stays correct. Transfers get a counter-account dropdown in the review table and commit as a linked net-$0 financial swap (can't approve until the account is chosen); `findTransferPairs()` flags transfers whose opposite leg is already in the ledger (±2 days, matching amount) so re-imports and the second statement dedup cleanly. Verified the real `parseCSV`+`transformCSVRow` over both statements (347 + 16 rows): classification correct, all transfer pairs net to $0. (~6,000 tokens)

#### v2.8.1
<sub>Per-owner duplicate accounts + Combined-view owner break-out · Balance Sheet onboarded opening balances + account rename</sub>

##### Fixes
- **Two members can hold the same account** — Adding an account whose label matched one another household member already owned (e.g. both have "Charles Schwab") failed: `accounts.id` is a household-wide text-slug primary key, but both the duplicate-name guard and the slug derivation only looked at the *current owner's* rows, so Shilpa's add derived the existing `charles_schwab` id and collided on the PK (and the Combined header view also falsely blocked the name). Onboarding's "My Accounts" is now scoped to the signed-in user (`importerQS`) so the name check is per-person, and the slug is de-duplicated against **every** household account id with a readable per-owner suffix (`charles_schwab` → `charles_schwab_shilpa`, numeric fallback if needed). The `id` is internal only — transactions reference accounts by `payment_type` label — so existing data is untouched. (~2,000 tokens)

##### Features
- **Combined Balance Sheet owner break-out** — When 2+ household members hold the same account, the Combined view still shows the household total but now renders a small per-owner chip row underneath it (e.g. `Mark $12,300 · Shilpa $4,800`), reusing the Tags view's owner-color chips. Powered by one cached `get_ledger_balances_scoped` call per member (no DB migration); single-person and legacy single-user views are unchanged. (~1,500 tokens)
- **Onboarded accounts appear on the Balance Sheet immediately (FEA-104)** — Adding an account in Onboarding with a "Current Balance" now writes a single `adjustment`-category opening-balance transaction so the account shows on the Balance Sheet right away at its stated amount, instead of being invisible until transactions are imported. Sign follows the ledger convention (`net_balance = -SUM(amount_usd)`, so `amount_usd = -target`): assets land positive, credit/liabilities negative. The `adjustment` category keeps it out of the income statement, and the existing import → reconcile flow still trues up idempotently. (~1,500 tokens)
- **Rename an account / payment type from the Balance Sheet (FEA-105)** — The account-row right-click menu gained a second action, "Rename Account". It opens a small modal that PATCHes `transactions.payment_type` on every matching row plus the `accounts.label`, scoped via `ownerQS()` to match the active household/owner view, with a one-click Undo toast that reverses the rename. (~1,500 tokens)

#### v2.8.0
<sub>Pronto/Rippling payslip import for Shilpa</sub>

##### Features
- **Pronto payslip import (FEA-103)** — Shilpa's paychecks (Rippling-generated PDFs from `PRONTO.AI, INC.` and its PEO `TAV EMPLOYER, LP`, treated as one "Pronto" source) now import through the existing Payslip Import flow. Rather than bending Mark's Pinterest/Workday parser, a profile dispatcher (`detectPayslipProfile`) routes Rippling stubs to a new `parseRipplingPayslipPage()` that reads the SUMMARY block (Gross Pay / Deductions / Taxes / Net Pay), rolls the employee `DEDUCTIONS` lines (Medical/Dental/Vision/Life/LTD) into one `Medical Insurance Benefits` (`health`) row, and posts `Pronto Income` (−gross) + `Income Taxes and Social Security` (+taxes) — mirroring Mark's recording style with the same net-pay checksum. `payment_type` values match her real account labels exactly (`Wells Fargo Checking`, `Fidelity`) so the Balance Sheet buckets them correctly. **401K intelligence (future-proofed and already live on her Jun stub):** detects `401K (Pre-tax) Deduction` (and Roth/after-tax) in the deductions section, splits it out of the medical roll-up, and generates the Vanguard-style double entry to **Fidelity** (`account_type: investment`), plus a `401K Match` income row from the employer `CURRENT CO. CONTRIBUTION` column. Verified against all 5 sample stubs with the real pdf.js — every period reconciles to Net Pay. Mark's Pinterest path is byte-for-byte unchanged. (~4,000 tokens)

### v2.7 — Jun 25, 2026

#### v2.7.8
<sub>Per-account Splitwise keys + cross-channel dedup; orphan-link cleanup; balance-transfer entry</sub>

##### Features
- **Balance transfer / withdrawal entry** — The New Transaction form now handles money moving between two accounts (cash withdrawals, card balance transfers, any account-to-account move). When **Financial** is the category, a "Balance transfer / withdrawal" checkbox appears; checking it relabels Payment Account → **From Account** and reveals a **To Account** dropdown (any two payment types can pair). Submitting writes two linked transactions that net to $0 — `+amount` on the From account and `−amount` on the To account, both single-day `financial` rows sharing a `transaction_group_id` (so the ledger renders the $0.00 group header) — with each leg's description auto-suffixed `(from …)` / `(to …)`. A live preview shows direction + net, FX/currency is respected, and undo removes both legs. (~3,000 tokens)
- **Per-person Splitwise accounts (FEA-29D)** — Each household member can now connect their **own** Splitwise account instead of everyone sharing one key. A new service-role-only `splitwise_accounts` table stores each owner's API key (granted to `service_role` only, REVOKEd from `authenticated`/`anon`, so the public anon key can never read it); keys are set via a new `set_key` edge action that validates against `get_current_user` and never returns the key to the browser. The edge function resolves the key per logged-in owner (personal account row, else the original shared `SPLITWISE_API_KEY` env secret as the default/Mark account). The Splitwise Sync card gained a "Connect Splitwise" flow + connection status, and the sync controls are gated until connected so no one syncs against someone else's account. New `account_status` / `disconnect` actions. (~5,000 tokens)
- **Splitwise dedup keyed on (owner, expense_id)** — A Splitwise expense shared by two members has the *same* `expense_id` on both accounts, which collided with the old global primary key. `splitwise_expenses` is re-keyed on **(owner, expense_id)** (owner backfilled, NOT NULL), and every reconcile read/write + the write-back upsert is now owner-scoped, so both members can sync the same shared expense without clobbering each other. The review queue and all status mutations are scoped to the logged-in user (`importerQS()`). (~3,500 tokens)
- **Deterministic mirror↔Splitwise dedup** — When a reimbursement is both mirrored to a household member and pushed to Splitwise, the mirror proposal records the new `sw_expense_id`. On approval the recipient's ledger pre-registers that expense as `imported` (via a new `register_imported` edge action that computes the correct content hash from *their* perspective), so when they later sync their own Splitwise the shared expense is recognized as unchanged and never re-imported — no double-count, no fuzzy guessing. (~2,500 tokens)

##### Fixes
- **Deleting a linked transaction's partners unlinks the survivor** — When a delete (single or batch) leaves a transaction group with only one member, that lone member is now cleared back to unlinked (no more stray 🔗 badge); undo restores the link. A render guard also treats any single-member group as unlinked, cleaning up pre-existing orphans on load. (~1,500 tokens)
- **Reimburse defaults to Splitwise payment type** — The reimburse form's Payment Method now defaults to Splitwise. (~250 tokens)

#### v2.7.7
<sub>Splitwise write-back: friend + group dropdowns</sub>

##### Features
- **Friend & group dropdowns in the reimburse push (FEA-29C)** — The reimburse form's Splitwise section now loads your Splitwise friends and groups up front and shows two dropdowns: pick who's reimbursing you and (optionally) which Splitwise group the expense belongs to, instead of relying on an exact name match. Both are remembered per person label (new `sw_group_id`/`sw_group_name` on `splitwise_friend_map`) so they pre-select next time. The group id flows into `create_expense` (`group_id`, defaulting to `0` for a direct friend split). New `groups` action on `splitwise-sync` (`get_groups`, with the synthetic id-0 bucket filtered out and member ids exposed). (~3,000 tokens)

#### v2.7.6
<sub>Migration history reconciliation</sub>

##### Infra
- **Reconciled the Supabase migration history** — `supabase db push` had been failing with "Remote migration versions not found in local migrations directory" and migrations kept showing as un-applied even though their objects were live. Root causes: migrations applied out-of-band (dashboard SQL editor / `db query`, which don't record history), eight legacy 8-digit `YYYYMMDD` version names the CLI can't parse, and two duplicate version numbers (`20260410`, `20260626000003`). Fixed by normalizing all version filenames to valid 14-digit timestamps, renaming the duplicate `splitwise_friend_map` to `…0004`, and repairing the remote history table to match (every object was verified already-applied, so it was bookkeeping only — no SQL re-ran). `migration list` is now fully aligned and `db push` reports "up to date". Also deployed two previously-orphaned migrations (`get_tag_summaries_by_owner`, `normalize_merchant`). Runbook + prevention rules in `tasks/migration-history-reconcile.md`. (~9,000 tokens)

#### v2.7.5
<sub>Splitwise write-back: push reimbursements as Splitwise expenses</sub>

##### Features
- **Push reimbursements to Splitwise (FEA-29C v1)** — When you create a reimbursement in the ledger and the person is linked to a Splitwise friend, an opt-in "Also create in Splitwise" box (pre-checked once mapped) creates the matching Splitwise expense via `create_expense`: you paid the full `cost`, the friend owes their share, and your share is derived as `cost − friendOwed` so the paid/owed sums always reconcile to the cent. A friend picker in the reimburse form resolves the free-text person label (e.g. "Shilpa") to a real Splitwise friend via `get_friends` and remembers it in a new `disciplan.splitwise_friend_map` table, so the picker only appears once per person. The edge function inserts the returned `expense_id` into `splitwise_expenses` as `imported` with a matching `content_hash` + linkage (`expense_txn_id`/`reimburse_txn_id`/`transaction_group_id`), so the next sync recognizes Disciplan's own write and never re-imports it. Two new `splitwise-sync` actions (`friends`, `create_expense`); Splitwise push is non-fatal — the local reimbursement always saves and a failed push only surfaces a warning. (~5,500 tokens)

#### v2.7.4
<sub>Multi-owner tags with per-person sums</sub>

##### Features
- **Tags now have derived multi-owner ownership** — A tag's owners are derived from who actually has transactions tagged with it, not the single `tags.owner` creator column. The Tags grid metadata fetch is no longer owner-scoped (`householdQS()` instead of `ownerQS()`), so a tag created by Shilpa but contributed to by Mark (e.g. `tahiti`) now appears in Mark's single-person view showing only his accrual ("my half"). The Combined view shows the household total plus separate per-owner sum chips on each tag card, and a per-owner subtotal panel in the tag detail modal — both colored with the same owner palette as the Ledger. Powered by a new additive `get_tag_summaries_by_owner(p_household_id)` RPC (`GROUP BY tag, owner`); the original `get_tag_summaries`/`_scoped` RPCs are untouched so `daily-insight` and Combined aggregates are unchanged. Single-person views also only list tags that person contributed to or created. (~7,000 tokens)


#### v2.7.3
<sub>Balance Adjustment sign fix</sub>

##### Fixes
- **Balance Adjustment no longer flips the sign on mis-classified accounts** — The modal previously normalized liability-type accounts via `target = -abs(entered)`, which mangled the plug for an account typed as a liability but holding a positive balance (e.g. Venmo at +$1,474.01 → a $2,922.11 adjustment instead of $25.91). The entered value is now taken literally as displayed on the Balance Sheet (assets positive, liabilities negative) with no sign flipping, so `delta = net − target` is always correct regardless of classification. Input prefills with the signed current balance and the label/hint were updated accordingly. (~1,000 tokens)

#### v2.7.2
<sub>Right-click balance adjustment on the Balance Sheet</sub>

##### Features
- **Balance Adjustment from the Balance Sheet** — Right-clicking any asset or liability account row now opens a context menu whose first action is "Balance Adjustment". It pulls the freshest scoped ledger balance (`scopedRPC("get_ledger_balances")`), lets you state the account's real current value with a live preview of the plug, and writes a single `category_id:"adjustment"` transaction (`amount_usd = net − target`) so the live ledger trues up to reality without touching the income statement. Liabilities normalize the entered "amount owed" via `-abs()`; the new txn is dated today, clears the cache, re-renders the Balance Sheet, and offers an Undo. Mirrors the existing onboarding "Reconcile to Current Balance" math. (~2,500 tokens)

#### v2.7.1
<sub>Splitwise import service periods + recency; Rakuten cashback linking in email import</sub>

##### Features
- **Estimated service periods on Splitwise import** — Imported expenses now derive their service window from the category's accrual default (`getDefStart`/`getDefEnd` + `ACCRUAL_D`, e.g. furniture = 2 years, clothes = 1 year, rent/utilities = full month) instead of a static single day — so a "Furniture - Rubber Tree Plant" accrues over 730 days like every other transaction. The review card now shows editable Service Start → End fields that auto-update with the category (with an "auto: Nd" hint), stay overridable, and inherit the linked card charge's window when a receivable is linked. (~1,500 tokens)
- **Recency ordering in the Splitwise review queue** — New, changed, and dismissed lists now sort by expense date (newest first) instead of last-synced order. (~500 tokens)
- **Manual link-to-transaction for Rakuten cashback** — The email-import edit modal now has a "Link to Transaction" section: search the ledger and attach a forwarded Rakuten cashback to its original purchase (or Unlink / Change Link) before approving, with a 🔗 indicator + link summary in the review table. `commitEmailImports` applies the chosen link, and the reviewer's choice takes precedence over the auto-matcher. (~2,500 tokens)

##### Changes
- **Header view defaults to your own account** — New sessions now open scoped to the signed-in member's own ledger instead of Combined. `state.view` initializes to `null` when nothing is stored, and `renderViewSwitch()` resolves an unset/invalid view to `currentOwner` (Combined only as a no-owner fallback). An explicit "Combined" pick is still persisted to `dc_view` and respected on reload. (~500 tokens)

##### Fixes
- **Smarter Rakuten parent-purchase matching** — `linkRakutenCashback` now uses the order *total* (new `order_amount` parsed from the email) to find the matching purchase: it `ilike`s the cleaned store name in a -45/+15-day window and prefers the row whose amount matches the order total (±2%), falling back to the closest-dated match. Cashback is now **always** recorded in the rewards ledger even when no parent is found, and an explicit Unlink suppresses the fallback search. (~2,000 tokens)
- **Rakuten email parsing hardened (`inbound-email`)** — Prefers the explicitly-labeled "$X Cash Back" amount (new layout) over positional guesses, parses the "Amount $X" order total, and cleans store names from subjects like "Good news! Cash Back at Chewy is confirmed" → "Chewy". (~1,500 tokens)

#### v2.7.0
<sub>Import AI: learns recurring-subscription categories, fixes stale subscription months</sub>

##### Fixes
- **AI now learns recurring-subscription categories** — `get_merchant_patterns` / `_scoped` grouped by the *full* description, so every monthly charge ("Amazon Prime - June 2026", "Claude AI Subscription (Feb 2026)") counted as a unique group of 1, got dropped by `HAVING COUNT(*) > 2`, and never reached the AI's `HISTORICAL MERCHANT PATTERNS` map. New migration `20260626000002_merchant_patterns_normalized.sql` adds `disciplan.normalize_merchant()` (mirrors `normalizeMerchant` in `js/helpers.js`) and groups by the normalized merchant key *before* counting, so subscriptions accumulate across months and expose their dominant category. Amazon Prime / Claude (filed as Utilities for years) now surface as Utilities to the parser instead of guessing Tech/Personal. (~3,500 tokens)
- **Prompt defers to history over hardcoded merchant rules** — The categorize prompt previously hardcoded "Subscriptions (CLAUDE.AI) -> tech" and "Amazon -> personal", actively overriding the user's own history. Those are now last-resort defaults; `HISTORICAL MERCHANT PATTERNS` is the authoritative signal (after user rules), with explicit instruction to use a merchant's dominant historical category even when it contradicts the generic defaults. (~1,000 tokens)
- **Stale subscription month corrected deterministically** — The AI tended to copy a month from the few-shot sample descriptions (e.g. "April 2026" on a June charge). New `fixMonthSuffix()` rewrites any trailing `(Month YYYY)` / `- Month YYYY` to match the transaction's service month, applied in `applyAIResults`, so the displayed month always matches the accrual period regardless of what the model emitted. (~1,500 tokens)

---

### v2.6 — Jun 20, 2026

#### v2.6.9
<sub>Splitwise import: editable labels, tags, duplicate flagging, dismissed memory</sub>

##### Features
- **Editable label + tags on Splitwise import** — Each new-expense card now has an editable description field (pre-filled with the AI suggestion) and an optional tag input backed by a datalist of existing tags (auto-creates the tag via `ensureTagExists` on import). Because the corrected label is written straight to `transactions`, it feeds the same merchant-pattern / sample-description learning the AI uses for every future import — so corrections refine the model over time. (~2,000 tokens)
- **Fuzzy duplicate flagging** — Before importing, each card cross-references existing **Splitwise-account** transactions (manually entered or imported another way) and flags a "Possible duplicate" if one matches on net amount (±2% / $0.50) and date (±7 days), listing the candidates so you can judge by label. This complements the exact `expense_id` dedup for rows that entered the ledger outside the sync. (~1,500 tokens)
- **Dismissed memory** — Dismissing an expense now records `dismissed_at` (migration `20260626000001_splitwise_dismissed_at.sql`). A dismissed expense is re-surfaced only when it materially changes in Splitwise (or is manually Restored), and whenever it reappears the card shows a "Previously dismissed" badge with the date — so you never silently re-review something you already decided on. (~2,000 tokens)

#### v2.6.8
<sub>Splitwise sync refinements: AI parsing, sync window, manual linking, dismissed queue</sub>

##### Features
- **AI parsing for Splitwise imports** — New expenses now run through the same Claude categorization + description-cleanup pipeline used for CSV/email imports (merchant patterns, sample-description style, detected subscriptions, user rules). On load the review cards pre-fill the cleaned merchant name and suggested category (still editable), and import writes the cleaned description (`Reimbursed - <merchant>` for receivables), so Splitwise rows read like the rest of the ledger instead of raw Splitwise text. (~2,500 tokens)
- **Choose the sync window** — Added a "Sync period" control to the card: New-since-last-sync (incremental default), Last 30/90 days, Last 6/12 months, All time, or a Custom From/To range. Explicit windows pass `dated_after`/`dated_before` to the Edge Function and force a date-range fetch (for backfills), overriding the incremental `updated_after`. (~1,500 tokens)
- **Link to any transaction (manual search)** — The card-charge linker now has a "Search for a different charge" box: free-text search the ledger (non-Splitwise, by description) and pick any result to link the receivable to — not just the auto-matched candidates. Selected matches are added to the dropdown and inherit category + service window like the auto matches. (~1,500 tokens)
- **Dismissed transactions, reviewable** — Dismissed Splitwise expenses now appear in a collapsible "Dismissed (N)" section at the bottom of the queue, each with a one-click Restore that flips the row back to `pending` so it can be re-imported. (~1,000 tokens)

#### v2.6.7
<sub>Splitwise sync foundation: dedup + update-detection via a mapping table</sub>

##### Features
- **Splitwise expense tracking + reconciliation** — New `disciplan.splitwise_expenses` mapping table (migration `20260625000001_splitwise_expenses.sql`) keyed on the stable Splitwise `expense_id` and storing `sw_updated_at`, `sw_deleted_at`, a `content_hash`, the raw payload + derived candidate, and links to the resulting transaction(s). A new auth-gated Edge Function `splitwise-sync` (uses the `SPLITWISE_API_KEY` secret, never the browser) fetches `get_expenses` since the last sync and classifies each: never-seen → `pending`, changed-after-import (newer `updated_at` AND different content hash) → `needs_review` with the new payload in `pending_raw`, soft-deleted → `needs_review`, unchanged → skip. This makes "already imported?" an `expense_id` lookup and "changed in Splitwise?" a hash compare. It never writes `transactions` directly — import is human-gated. (~7,000 tokens)
- **Imports only the Splitwise *part*, with card-charge linking** — Rather than duplicating the full expense, sync imports only the portion that flows through your Splitwise balance (net = your `paid_share − owed_share`): when you fronted the bill, a reimbursement *credit* for what you're owed; when someone else paid, your owed *share* as an expense under the `Splitwise` payment type; when you paid exactly your share, nothing. For the you-paid case the review card auto-searches the ledger for the matching card charge (≈ amount, ±14 days, non-Splitwise) and suggests a link — on import it groups the credit with that charge, inherits its category + service window, and sets `related_transaction_id`, so the full charge (from your bank CSV) nets down to your real share without double-counting. (~4,000 tokens)
- **Splitwise Sync review queue (Entry tab)** — New collapsible "Splitwise Sync" card with a "Sync now" button and two groups: New expenses (pick/inherit a category, optional card link, Import with one-click Undo) and Changed-in-Splitwise (old-vs-new diff for amount/date/description; Apply re-creates *only the rows we created* — never your external card charge — and re-links; Delete-imported handles Splitwise deletions; Keep-mine acknowledges the change without touching imported rows so it stops re-flagging). (~3,500 tokens)

---

#### v2.6.6
<sub>Household roles: admin read/write all, members read-only on others</sub>

##### Features
- **Database-enforced household access control** — Added a `role` to profiles (`admin` = Mark, `member` = Shilpa) and replaced the permissive `USING(true)` policies with real RLS: reads stay shared (Combined view unchanged), but `INSERT/UPDATE/DELETE` on every owner-stamped table (transactions, accounts, balance snapshots, tags, cashback, investments, preferences, pending imports, group overrides, ai_rules) now require `can_write(owner, household)` — admin of the household, or the row's owner. Members literally cannot edit another member's data, even via the API. Also closed a privilege-escalation hole: `profiles`/`households` writes are now admin-only, so a member can't promote themselves. Helpers (`my_household`, `is_admin`, `can_write`) are `SECURITY DEFINER` to avoid policy recursion. Edge Functions use `service_role` and bypass RLS. (migration `20260620000004_household_rls.sql`) (~6,000 tokens)
- **Read-only ledger UX for non-owners** — The ledger edit modal renders read-only with a "Read-only - owned by {Name}" banner (no Save/Delete/link controls) for rows the signed-in member can't write, and batch Edit/Link/Delete refuse selections that include another member's transactions (Copy still works). UI mirrors the RLS so members never hit confusing save failures. (~1,500 tokens)

---

#### v2.6.5
<sub>Batch AI categorization for large imports + drop redundant key field</sub>

##### Fixes
- **Large imports now categorize (the real onboarding bug)** — `aiCategorize` sent every row in one Claude request capped at `max_tokens: 4000`, so a ~1,500-row Chase onboard could never fit its output and the truncated JSON silently failed (descriptions left raw, everything low-confidence). It now batches 40 rows/call, runs 4 in parallel, raises `max_tokens` to 8000, and merges results by index, keeping partial success if a batch fails. Fixes both the Onboarding and Entry importers; onboarding shows live `AI categorizing N/M` progress. (~3,000 tokens)

##### Changes
- **Removed the Anthropic key field from Onboarding** — logged-in household members proxy through the auth-gated `ai-categorize` function automatically, so the field (and its prefill/help copy) is gone. A personal key in `localStorage` still takes the direct path if present. (~500 tokens)

---

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

---



## 🔧 Next Up

| ID | Item | Type | Priority | Details |
|----|------|------|----------|---------|
| FEA-29B | **Splitwise API Sync** | Feature | **Medium** | Splitwise has a free Self-Serve API (dev.splitwise.com) that supports OAuth2 and provides `getExpenses()` with date filters, plus `getFriends()` and `getGroups()`. Build a sync feature that: (1) authenticates with Splitwise via OAuth2 (register app at secure.splitwise.com/oauth_clients), (2) fetches expenses where the user owes or is owed money, (3) maps Splitwise expenses to Disciplan transactions — expenses you paid get the actual category + a Splitwise reimbursement credit for others' shares, expenses others paid show as your owed share under the "Splitwise" payment type, (4) maintains a "Splitwise" account in the balance sheet that tracks your net balance (what you're owed minus what you owe), which should stay in sync with your actual Splitwise balance. REST API called directly with fetch(). Rate limits are conservative so sync should be periodic (manual trigger or daily), not real-time. Supersedes FEA-16. **Depends on:** FEA-29A (done), FEA-38 (Working Capital reclassification). **Progress (v2.6.7–v2.6.9):** dedup + update-detection FOUNDATION done — `splitwise_expenses` mapping table, `splitwise-sync` Edge Function (API-key auth, not OAuth2 yet), Splitwise-part-only mapping (receivable credit / owed share) with card-charge match + link suggestion, the Entry-tab review queue (new + changed-in-Splitwise), AI parsing of imports, sync-period control, manual link search, editable label + tags, fuzzy duplicate flagging, and dismissed-memory (`dismissed_at` + re-surface-on-change). **Remaining:** OAuth2 (currently personal API key), the balance-sheet "Splitwise" net-balance account, scoring/auto-confidence on card-match suggestions, and optional daily-cron sync. |
| FEA-29C | **Push expenses TO Splitwise (write-back)** | Feature | Low | Reverse direction of FEA-29B: create a Splitwise expense from Disciplan via `POST /create_expense` (same `secure.splitwise.com/api/v3.0` base + existing `SPLITWISE_API_KEY` — no new auth). Supports equal split (`split_equally`+`group_id`) or exact shares (`users__N__user_id`/`paid_share`/`owed_share`, shares must sum to `cost` as a 2-decimal string). New edge action (e.g. `splitwise-create` or a `mode` branch in `splitwise-sync`) that posts the expense, then **inserts the returned `expense_id` into `splitwise_expenses` with `sync_status='imported'`** so the existing dedup stops the next sync from re-importing your own write. UI: a "Push to Splitwise" action on the Entry form / a ledger transaction — pick friend/group (add `get_friends`/`get_groups` fetches) + split, confirm, create. **Scope guardrails:** create-only v1 (no bidirectional edit/delete — conflict resolution is gnarly); explicit confirmation since writes create real shared records others are notified about; watch cent-rounding on share sums. **Depends on:** FEA-29B foundation (done). **Progress (v2.7.5):** v1 shipped — reimburse → `create_expense`. Reimburse form has a friend picker that maps the free-text person label to a Splitwise friend (new `splitwise_friend_map` table) and a pre-checked "Also create in Splitwise" opt-in box; on submit it posts exact shares (you paid `cost`, friend owes their share, `yourOwed = cost − friendOwed` to avoid drift) and inserts the returned `expense_id` into `splitwise_expenses` as `imported` so the next sync never re-imports the write. New `friends`/`create_expense` actions on `splitwise-sync`; Splitwise failure is non-fatal. **Progress (v2.7.7):** friend + group dropdowns (loads `get_friends`/`get_groups` up front, no more exact-name match), `group_id` flows into `create_expense`, friend+group remembered per label. **Progress (v2.10.2):** multi-person group splits shipped — select a group first, its members load as a per-member checklist (all pre-checked, equal split incl. yourself, each share editable); `create_expense` now takes a `participants:[{user_id, owed}]` array (`users__0..N`, payer absorbs cent-rounding), members needn't be direct friends. Single-friend path preserved as fallback. **Remaining:** Splitwise category mapping, bidirectional edit/delete, remember group-only selection across sessions (needs nullable `sw_user_id`). |
| FEA-29D | **Per-account Splitwise keys + cross-channel dedup** | Feature | Medium | Multi-user Splitwise: each household member connects their **own** Splitwise account instead of a single shared key. **Shipped (v2.7.8):** service-role-only `splitwise_accounts` table (api key REVOKEd from authenticated/anon; written via `set_key` edge action, never returned to browser); per-owner key resolution in the edge fn (personal row, else env fallback); `account_status`/`disconnect` actions; Connect-Splitwise UI + gating in the Sync card. `splitwise_expenses` re-keyed to **(owner, expense_id)** so two members can sync the same shared expense without collision; all reconcile + write-back ops owner-scoped. Deterministic mirror↔Splitwise dedup: reimburse push stamps `pending_shared_txns.sw_expense_id`, and approving the mirror pre-registers the shared expense as `imported` (new `register_imported` edge action computing the recipient-side content hash) so their own sync skips it. **Remaining/idea:** per-owner "Splitwise account" balance reconciliation, disconnect UI surface, optional silent-create. |

---

## 🔮 Future

| ID | Item | Type | Priority | Details |
|----|------|------|----------|---------|
| FEA-09 | **Plaid Integration** | Feature | High | Auto-sync bank account balances via Plaid API. Needs backend endpoint (Supabase Edge Function) for token management. Auth prerequisite done (FEA-10). |
| FEA-13 | **Income Tracking & Net Savings** | Feature | Medium | Already partially done (IS shows income + savings rate). Could integrate deeper with Investments tab for full financial picture. |
| FEA-17 | **Recurring Transaction Templates** | Feature | Low | Auto-generate recurring expenses (rent, subscriptions) each month instead of manual entry. Would reduce data entry burden before Plaid is live. |
| FEA-25 | **Live Stock Prices in Portfolio** | Feature | High | Fetch real-time (or daily-close) stock/ETF/crypto prices from a free API and display live market values on the Portfolio tab. Currently portfolio valuations are static snapshots — this would show up-to-date prices alongside cost basis for accurate unrealized gain/loss. API options: Yahoo Finance (unofficial), Alpha Vantage (free tier: 25 req/day), Finnhub, or Twelve Data. Implementation: (1) on Portfolio tab load, collect unique ticker symbols from `investment_lots`, (2) batch-fetch current prices, (3) compute live market value per lot/symbol/account (shares × current price), (4) update KPI cards (Market Value, Unrealized Gain, Total Return %) with live figures, (5) show "as of" timestamp and a manual refresh button. Considerations: API rate limits (cache prices for 15 min), handle market-hours vs after-hours, crypto tickers may need different API, Schwab 401K has no ticker (keep hardcoded or manual). |
| INF-05 | **Supabase RLS Policies** | Infra | Medium | Auth is Phase 1 only — no Row Level Security on transactions or other tables. The anon key is visible in source, meaning anyone inspecting the page can read/write all data via the REST API. Add RLS policies (`user_id = auth.uid()`) to: `transactions`, `tags`, `accounts`, `balance_snapshots`, `pending_imports`, `cashback_redemptions`, `investment_lots`, `investment_symbols`, `investment_accounts`, and `group_overrides`. Not urgent for single-user but becomes critical if sharing the URL or adding users. **Depends on:** FEA-10 (auth, done). |

---

<details>
<summary><strong>✅ Completed</strong> (166 items)</summary>



| ID | Item | Type | Completed |
|----|------|------|-----------|
| FEA-115 | **Income → compensation breakdown newsletter** — Reworked the `income_breakdown` archetype from a bare "YTD income up N%" line (5.5/10, and inflated — the old `fetchYtdIncome` summed `abs(amount_usd)` over all income rows, counting tax withholding, refunds, and Zelle self-transfers as income) into an owner-scoped compensation breakdown: equity (RSU vests) vs cash salary vs bonus/severance, effective tax rate, and 401K savings rate (employee deposits + employer match over gross), each YTD vs the same calendar day the prior 2 years. Classification is word-boundary safe by construction — "P·interest·Income"/"interest income" had inflated an ad-hoc bucket ~400×, so both the TS `classifyIncomeDescription` helper and the reference SQL use `~* '\yinterest\y'` + a deny-list, never bare substrings; 401K savings nets only deposit legs (rollovers excluded). Approach C: deterministic validated `facts` are ground truth, and the DB `prompt_guidance` flips "don't speculate" into "call `run_finance_query` once to NAME the driver" with two canonical reference queries, marks the archetype cash-basis, and raises the YoY gate 3%→6%. Validated live (2025 gross $454k, eff-tax 33%, savings 10%; 2026 YTD cash correctly populated). Edge-function + migration `20260707005139_income_comp_guidance.sql`; committed, deploy pending. | Feature → Done | Jul 6 |
| FEA-114 | **Bilt rent auto-detection + confirmed Splitwise split on import** — The Bilt CSV posts rent as two `$3,495` lines both containing "Payment" (`Bilt Housing Payment` charge + `Payment - Bilt Housing` payoff), so the greedy `detectPayment:/payment/i` turned both into a `Bill Paid: Bilt` financial pair and rent never registered. Sign is the only reliable signal: `detectPayment` now requires a negative amount; new `detectRent` (`/housing/i` + positive) classifies the charge as `Rent - <Month YYYY>`, category `rent`, payment `Bilt`, accrued over the whole month, and `_isRent` rows are shielded from AI re-categorization. At commit the rent charge is auto-grouped with its same-month card-payoff pair. Split with the partner (Shilpa) is confirm-during-import via a "Split rent?" dialog (per-charge checkbox, editable %, Splitwise-push toggle, all default on); on confirm `createRentSplit` writes the `Reimbursed - Rent - <Month> - Shilpa` credit into the same group (import-batch tagged for Undo) and pushes a real 50/50 Splitwise expense via `swCreateExpense`. Frontend-only deploy at v2.10.3. | Feature → Done | Jul 6 |
| FEA-112 | **Change history &amp; undo panel** — Slide-out History panel (header `↺`, any tab) over the FEA-109 `audit_log`: reads the household trail newest-first, groups rows by `txid` into one entry per action, and renders human-readable labels from the before/after JSONB (`Edited "Starbucks": amount $5.00 → $6.00`, `Deleted "Rent"`), color-coded by op with actor + relative time. **"Revert to here"** rolls back everything newer via a new atomic `disciplan.revert_to(p_id)` RPC (one txn/`txid`, redoable); **"Revert just this"** undoes one action via `revert_operation`, warning on the newer-change clobber case. Reverted entries greyed/struck-through; each revert re-renders the active tab + reloads the list. Migration `20260706004055_revert_to.sql` pushed and verified in remote history. Frontend-only deploy at v2.10.1. | Feature → Done | Jul 5 |
| FEA-113 | **Newsletter archetype audit & tuning** — Audited all 17 insight archetypes against logged ratings/feedback and retuned: fixed two never-firing archetypes (`net_worth_velocity` year-ago window made optional; `streak_or_gap` long-gap escape hatch — `net_worth_velocity` then fired for the first time on 2026-07-06), disabled the buggy `spend_projection` (superseded by `monthly_burn_forecast`), set `service_expiry` to monthly cadence, reframed `large_transactions` into forward-looking "new commitments & forward accrual", rewrote `category_yoy` guidance to require a query-tool cross-year driver drill-down + accrual labeling, hardened chart rendering (`max_tokens` 2000→3500 + QuickChart render-validation so a 400 never reaches the inbox), and added a query-tool efficiency directive (never re-query facts; 0-2 queries; derive arithmetic directly). Config/guidance changes live via operator-editable `insight_strategy` columns; code changes deployed to `daily-insight`. | Feature → Done | Jul 6 |
| FEA-111 | **Newsletter follow-up Q&A** — Replies that ask a question (detected by a `?` or an interrogative/imperative phrase) are queued in `disciplan.insight_followups` by `inbound-email`. The next `daily-insight` reads pending questions, answers them in a dedicated "Following up on your question" email block (using the read-only query tool for exact numbers), and marks them answered only on a real, non-fallback send. AI portal surfaces pending/answered follow-ups with a "Dismiss all" escape hatch. Closes the feedback loop so questions get answered without a code change. Migration validated against the live DB in a rolled-back transaction. | Feature → Done | Jul 5 |
| FEA-110 | **Newsletter: data isolation + steerability overhaul** — (1) Scoped the `daily-insight` edge function to a single `INSIGHT_OWNER` (default `mark`) via a `scopeToOwner()` helper + `*_scoped` RPCs + new `run_data_health_check_scoped`, ending the leak of other household members' transactions into the newsletter (top cause of recent 2-3/10 ratings). (2) Fixed the self-tuning loop: the inbound-email distiller no longer rewrites (and silently truncates) the whole principles doc — it appends one bounded lesson under `FEEDBACK-DERIVED LESSONS`; principles reset to a clean GENERAL-only baseline; portal "Dismiss all" for a stalled queue. (3) Moved hardcoded per-archetype prompt guidance into editable `insight_strategy.prompt_guidance` + `accrual_basis` columns (seeded for 17 archetypes, edited inline in the AI portal — no deploy). (4) Added a guarded, read-only, owner-scoped ad-hoc SQL tool (`insight_run_query` over `insight_ro` views, service_role-only, single SELECT, catalog/schema-escape blocked, GUC-pinned owner, row cap) wired to an Anthropic tool-use loop so the writer can fetch data the fixed facts lack. Migrations validated against the live DB in rolled-back transactions. | Feature → Done | Jul 5 |
| FEA-109 | **Change audit ledger + revert/undo** — `disciplan.audit_log` records every INSERT/UPDATE/DELETE on all 18 owner-stamped tables via one generic `SECURITY DEFINER` trigger (`fn_audit`): full `old_data`/`new_data` JSONB, changed columns, row owner/household, `actor` (resolved from JWT via `profiles`), and `txid_current()` to group an operation. Skips no-op/`updated_at`-only writes. `can_write`-gated RPCs `revert_audit_entry(id)`, `revert_operation(txid)`, `undo_last()` reverse changes (and are themselves audited → redoable). RLS-scoped reads, tamper-proof writes, forward-looking. Verified insert→revert round trip on the live DB. | Feature → Done | Jun 28 |
| FEA-108 | **Ledger payment filter scoped to accounts** — The Ledger payment-type dropdown lists only payment types the viewer holds an account for (`accounts` via `ownerQS()`) rather than the full `PTS` list; falls back to `PTS` before load/when empty and keeps the active selection. | Feature → Done | Jun 28 |
| FEA-107 | **On-behalf-of onboarding** — `writeOwner()` (`js/config.js`) stamps new rows to the active person-view when an admin views another member (else the signed-in user), mirroring RLS `can_write()`. Onboarding scopes its account list, slug dedup, reconcile RPC, and earliest-date lookup to the `acting` owner (`actQS`), with a read-only banner when viewing a member you can't write. Fixes accounts/imports landing under the wrong owner. | Feature → Done | Jun 28 |
| FEA-106 | **Wells Fargo Checking/Savings CSV import** — New `wells_fargo` bank profile imports Shilpa's WF statements through the existing CSV pipeline; account auto-defaults from filename (`Wells Fargo Savings`/`Wells Fargo Checking`). A profile `classifyRow` (plumbed into `transformCSVRow`, guarded so Mark's path is untouched) skips payslip-owned payroll and card-import-owned CC payments, books Google payroll/interest/IRS refunds as income, parks Zelle in `other`, and treats account-to-account moves (online transfer, ATM, Schwab, Venmo, Splitwise, wires) as transfers. Inflows post negative `amount_usd` to keep `balance = -SUM`. Transfers get a counter-account dropdown + commit as a linked net-$0 swap; `findTransferPairs()` dedups legs already in the ledger (±2 days). Verified over both statements (347+16 rows). | Feature → Done | Jun 27 |
| FEA-105 | **Rename account from Balance Sheet** — The account-row right-click menu gained a "Rename Account" action that PATCHes `transactions.payment_type` on every matching row plus the `accounts.label`, scoped via `ownerQS()` to match the active household/owner view. One-click Undo toast reverses the rename. | Feature → Done | Jun 27 |
| FEA-104 | **Onboarded accounts show on the Balance Sheet** — Adding an account in Onboarding with a "Current Balance" now writes a single `adjustment`-category opening-balance transaction (`amount_usd = -target`, target signed by account type) so the account appears on the Balance Sheet immediately at its stated amount. Excluded from the income statement; import → reconcile still trues up idempotently. | Feature → Done | Jun 27 |
| FEA-103 | **Pronto/Rippling payslip import** — Shilpa's Rippling paystubs (`PRONTO.AI` + PEO `TAV EMPLOYER, LP`, one "Pronto" source) import via the existing Payslip flow. New `detectPayslipProfile` dispatcher + `parseRipplingPayslipPage()` reads the SUMMARY block, rolls employee DEDUCTIONS into one `Medical Insurance Benefits` (`health`) row, and posts `Pronto Income`/`Income Taxes and Social Security` with the same net-pay checksum as Mark's. `payment_type` strings match her account labels (`Wells Fargo Checking`, `Fidelity`) for correct Balance Sheet bucketing. Detects `401K (Pre-tax)`/Roth deductions + employer match (CO. CONTRIBUTION column) → Fidelity double-entry + `401K Match` income. Verified on all 5 sample stubs with real pdf.js; Pinterest path untouched. | Feature → Done | Jun 27 |
| FEA-102 | **Onboarding import module** — New per-user Onboarding tab: add accounts (`accounts` rows, owner-stamped), import a CSV through the existing calibrated pipeline (Chase United Club auto-detected by the `chase` profile, `payment_type` = account label), and reconcile to a current balance via a single `adjustment` transaction dated before the earliest import (sign from account type; excluded from the income statement). AI personalization is now owner-scoped: `get_merchant_patterns_scoped` RPC + `importerQS()` scope `fetchMerchantPatterns`/`fetchSampleDescriptions`/`fetchAIRules` to the signed-in user, and `ai_rules` gained `owner`/`household_id`. | Feature → Done | Jun 20 |
| INF-06 | **Cache Version Key** — Persisted `localStorage` offline caches (FEA-32) are now namespaced by `CACHE_VERSION` (`dc_v2_` prefix in `js/config.js`). On load, a one-time purge removes any legacy `dc_`-prefixed keys that don't match the current version, so a stale RPC/response shape from a prior deploy can no longer mis-render — bumping `CACHE_VERSION` invalidates all persisted caches cleanly. In-memory `_dc` cache (FEA-89) unaffected. | Infra → Done | Jun 11 |
| UI-01 | **IS Unrealized G/L Card** — Income Statement shows investment as a standalone "Unrealized G/L" 5th KPI card on a `.g5` grid (separate from expenses/savings rate), with a dedicated detail-table row supporting per-month drilldown and a cross-year G/L column. The old "Show Inv" toggle (FEA-07) was removed entirely. Ledger-filter emoji-compaction sub-item dropped as not worthwhile (selects/date inputs can't be emoji-only; Clear/Subscriptions already iconified). | UI → Done | Jun 11 |
| FEA-101 | **Tag detail delete action** — Tags can be deleted directly from the open tag detail modal with a two-click `Delete Tag` → `Confirm Delete` flow. Deletion clears the tag from all matching transactions, deletes the `tags` row, invalidates transaction-derived caches, closes the modal, and refreshes the Tags tab. Also ships the in-progress Tags search/sort controls already present in `js/tags.js`. | Feature → Done | Jun 3 |
| BUG-32 | **Daily insight cron missing Supabase gateway auth** — `pg_cron` kept firing successfully, but `net._http_response` returned `401 UNAUTHORIZED_NO_AUTH_HEADER` because the `daily-insight` cron request only sent `X-Cron-Secret`; Supabase rejected it before the Edge Function's CRON_SECRET check ran. Live cron now sends `Authorization: Bearer <anon>` and `apikey: <anon>`, uses a `60000ms` pg_net timeout, and has a migration (`20260530000001_daily_insight_cron_auth.sql`) that preserves the existing cron secret by extracting it from `cron.job.command`. Verified with a pg_net dry-run producing `insight_log.id=108`, `dry_run=true`, `parse_fallback=false`, no Postmark send. | Bug → Done | May 30 |
| FEA-100 | **Newsletter engagement archetypes (Phase C)** — Six new accrual-aware archetypes added to `daily-insight`: `on_this_day_flashback` (storytelling — daily-cost overlap on this calendar day across prior 9 years; rent/trips/annual subs surface correctly), `streak_or_gap` (rhythm — longest current spending gap among commitment-based parents food/personal/entertainment/transportation, ranked vs trailing-12mo), `net_worth_velocity` (longhorizon — 90d net-worth delta vs same window 1y ago from `balance_snapshots`), `monthly_burn_forecast` (forward — projected total accrued cost for current month from already-accrued MTD + locked-in remainder + variable forecast), `cashback_roi` (health — YTD effective rate per card with drag-card detection), `trip_year_in_review` (trips — annual rollup from `get_tag_summaries`). Selection policy v2: `theme` column on `insight_strategy` backfilled across all 17 archetypes; soft 0.7× score multiplier when same theme appeared in last 3 sends; novelty bonus `0.3 × (1 − sent_count/5)` decays over first 5 sends. AI portal strategy table gains read-only `theme` column. Verified via 11-fixture replay; today's flashback fired with "FA Cup Final at Wembley, Airbnb $88/day of $1,406 total" — accrual-correctness demo (transaction-date semantics would have collapsed the Airbnb to a single booking-day hit). | Feature → Done | May 14 |
| FEA-98 | **Newsletter Admin Portal v2 + Inbound Feedback Guardrails** — `#ai/Newsletter` tab gains 6 KPI cards (sends, rated %, avg rating, total cost, parse fallbacks, dry-run replays), strategy table (priority weights, cooldowns, monthly caps, last-used reasons), pending principles approval queue (approve/reject inline), recent selection traces (top-N candidates with eligibility reasons), and a dry-run viewer separated from real sends. Inbound `inbound-email` function now (1) routes any Haiku-distilled principles update into `principles_pending` instead of writing `insight_context` directly, (2) auto-rejects updates with >30% length delta or banned override prefixes (`ignore`, `disregard`, `system:`, etc.) as prompt-injection defense, (3) calls `apply_strategy_feedback` RPC to feed the rating into the bandit (clamped to ±0.10 weight delta, bounded `[0.1, 2.0]`) so a single bad rating cannot zero out an archetype. | Feature → Done | Apr 27 |
| FEA-97 | **Newsletter Hybrid Insight Engine — Phase A/B archetype reworks** — Refactored `daily-insight` from a single mega-prompt into a deterministic candidate pipeline (`archetypes.ts` + `selection.ts` + `types.ts`) with ε-greedy stochastic selection (`epsilon=0.15`) over scored candidates. Phase A: fixed silent miscounts by reading `EXPENSE_CATS` / `PARENT_ROLLUP` dynamically from the `categories` table at runtime (was hardcoded). Phase B archetype reworks: `tag_recap` replaces `tag_burn_rate` (historical trip recap with 1y/2y/3y anniversary boost ±10 days, overrides recency decay), `category_anomaly` smart-combo drill-down (merchant > tag > description rollup based on concentration), `category_trend` deep-dive (12 *complete* months only, recent-parent exclusion, relative-strength gate `≥0.15` instead of absolute slope, `min_r2=0.10`, excludes `financial`/`other` parents, multi-chart `chart_configs[]` for parent + child stacked bar), `income_breakdown` YoY + 3Y CAGR pivot (requires `day_of_year ≥ 60` and `\|YoY\| ≥ 3%` to avoid partial-month timing). New tables: `insight_strategy` (per-archetype enabled/cooldown/monthly cap/quality score/last-used reason), `insight_selection_log` (full candidate trace), `principles_pending` (approval queue). New `subject_key` column on `insight_log` for structured deduplication (`tag:cozumel`, `parent:food`). Dry-run mode (`?fixture=YYYY-MM-DD`) filters history by fixture cutoff so cooldowns evaluate correctly during historical replay; dry-run responses include `candidates_trace` for debugging. `replay-newsletter.sh` helper for fixture-based testing. 8 migrations. | Feature → Done | Apr 27 |
| FEA-96 | **Automated Supabase Backup** — GitHub Actions runs weekly, backs up all 6 tables as CSVs (~2.5 MB), uploads 90-day artifact, emails Gmail via Postmark on success. Monthly Mac cron pulls artifact locally with native notification. | Infrastructure → Done | Apr 17 |
| FEA-95 | **Payslip — Connectivity Reimbursement Fund** — Pinterest payslips now parse the "Connectivity Reimbursement Fund" benefit line (PDF + XLSX, Employer Paid Benefits and Post Tax Deductions sections). Generates a `utilities` / Chase Chequing credit in the same payslip group. Auto-links to the AT&T internet charge in the same calendar month on commit. | Feature → Done | Apr 15 |
| BUG-31 | **Daily insight cron pg_net timeout** — `daily-insight` pg_cron job had `timeout_milliseconds:=1000`. Slow DNS (172ms) + SSL (115ms) + function response (711ms) = 1001ms caused pg_net to cut the connection before Postmark was reached. Updated to `timeout_milliseconds:=5000` via `cron.alter_job`. | Bug → Done | Apr 15 |
| FEA-94 | **AI Dev Portal** — Dev-only `#ai` tab (linked from footer) with Decision Log, Performance Dashboard, Feedback Interface, Rules Engine, and Synthesis Agent (`claude-opus-4-6`). Captures `ai_original` on transactions and feedback columns on email imports. Active `ai_rules` injected into every import prompt. | Feature → Done | Apr 10 |
| FEA-93 | **CAD/non-USD FX Rate Auto-Fill** — Selecting a non-USD currency in the Entry form auto-populates the FX Rate field with the live rate from `DFX`. Editable override. Hint updated to "Live rate · edit to override". | Feature → Done | Apr 11 |
| BUG-29 | **Import rows button visually faded when enabled** — Paste-import modal button had `rgba(42,157,143,0.25)` background that never updated on enable. `showPreview` now brightens to `0.7` on success, resets to `0.25` on no-rows. | Bug → Done | Apr 11 |
| FEA-91 | **Full-Text Transaction Search** — Added `credit.ilike.*q*` to Ledger search OR filter. Searching by credit sub-account (e.g. "Vanguard", "Chase Savings") now works alongside description, tag, and payment_type. | Feature → Done | Apr 10 |
| FEA-92 | **Data Integrity Health Check** — On-demand "Run Health Check" in Export tab. 4 server-side checks via RPC: orphaned groups, accrual math errors, missing tags, potential duplicates. Results show ✓ Clean or ⚠ N issues with expandable detail rows. | Feature → Done | Apr 10 |
| FEA-88 | **Import Merchant Patterns RPC** — Replaced paginated 12K+ row fetch with a single `get_merchant_patterns` RPC (server-side aggregation, top 200 patterns). Import startup time reduced from multi-second paginated loop to one fast RPC call. | Feature → Done | Apr 10 |
| BUG-27 | **Tags date picker focus reset** — Card and modal date editors both re-fired their container `click` listener when clicking an input, re-running setup and snapping focus back to the start date. Fixed by adding `stopPropagation` to both date inputs after creation. | Bug → Done | Apr 7 |
| BUG-26 | **Tags save stack overflow** — `openLedgerEditModal`/`openGroupEditModal` created a `_onSaved` closure over the `onSaved` parameter, then immediately reassigned the parameter to `_onSaved`, making the closure self-referential. Fixed by capturing the original callback as `_orig` before wrapping. | Bug → Done | Apr 7 |
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
