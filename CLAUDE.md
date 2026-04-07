# CLAUDE.md — The Disciplan

## Project Overview

Accrual-based personal finance tracker. Single-page web app tracking 12,000+ transactions from June 2017 to present.

- **Live site**: https://disciplan.netlify.app
- **Repo**: https://github.com/markqren/disciplan
- **Backend**: Supabase (project: `mjuannepfodstbsxweuc`)
- **Stack**: `index.html` (shell/CSS/routing/auth ~250 lines) + `js/*.js` modules (vanilla JS, no build step) → Supabase REST API
- **Deploy**: Manual only — `npx netlify-cli deploy --prod` (auto-deploy disabled via `netlify.toml`)

## Architecture

### Architecture

Single-page app: `index.html` (shell/CSS/routing/auth ~250 lines) + `js/*.js` modules + Supabase backend. No build step. Plain `<script>` tags. All functions are globals.

### File Map

```
js/config.js        — Supabase client, auth, sb(), sbRPC(), cache helpers
js/constants.js     — Categories, colors, payment types, bank profiles, budget targets
js/helpers.js       — Formatters (fmtF, fmtD, etc.), date utils, parseCSV, h() DOM helper
js/state.js         — Shared state object, ensureTagExists()
js/ai-categorize.js — Claude API categorization, merchant patterns
js/import-engine.js — CSV row transform, duplicate detection, AI result application
js/payslip-parser.js— Pinterest payslip PDF parsing via pdf.js
js/linking.js       — Transaction linking, reimbursement auto-scan, Rakuten cashback linking
js/entry.js         — Entry tab (new transaction form, import section shells)
js/import-review.js — CSV/email/payslip review tables, edit modals, commit functions
js/income-stmt.js   — Income Statement tab, IS drilldown modal
js/balance-sheet.js — Balance Sheet tab, snapshot form
js/portfolio.js     — Portfolio tab (accounts, symbols, lots drill-down)
js/tags.js          — Tags tab, tag detail modal
js/ledger.js        — Ledger tab, edit modal (with reimburse + cashback), batch modals
js/cashback.js      — Cashback & Rewards tab
js/cross-year.js    — Cross-year IS summary (All years view)
js/export.js        — Export tab (TSV, JSON backup)
```

### File Structure
```
disciplan/
├── index.html           # HTML shell, CSS, TABS/routing/auth/init (~250 lines)
├── js/                  # 18 JS modules (see File Map above)
├── sw.js                # Service Worker (caches all modules)
├── CLAUDE.md            # This file
├── ROADMAP.md           # Generated artifact — DO NOT edit directly (blocked by .claudeignore)
├── roadmap/             # Source of truth — edit these, then run build-roadmap.sh
│   ├── ACTIVE.md        # Next Up + Future (primary context for feature work)
│   ├── RELEASES.md      # v0.5–v2.1 release history (add notes here)
│   └── COMPLETED.md     # 133 completed items (grep FEA-NNN here)
├── scripts/
│   └── build-roadmap.sh # Regenerates ROADMAP.md from splits
├── tasks/
│   ├── todo.md          # Current session task tracking
│   └── lessons.md       # Accumulated learnings
└── README.md
```

### Supabase API Pattern
All data access uses the Supabase REST API with the public anon key. Pagination is required — Supabase defaults to 1000 rows max per request.

```javascript
const SB_URL = 'https://mjuannepfodstbsxweuc.supabase.co/rest/v1';
const SB_KEY = '...'; // anon key in index.html

// Paginated fetch pattern (MUST use for any table that could exceed 1000 rows)
async function sb(endpoint) {
  // Implementation paginates with Range headers
}
```

### The Accrual Engine (Core Concept)
Every transaction has a service period (`service_start` to `service_end`). The daily cost is:
```
daily_cost = amount_usd / (service_end - service_start + 1)
```
Income statements sum `daily_cost` for each day in a month, NOT raw `amount_usd`.
Tag views sum `daily_cost × overlap_days_with_tag_window`.

This is the secret sauce — don't break it.

### Category Hierarchy
```
Parent          → Children
Food            → Groceries, Restaurant
Home            → Rent, Furniture
Personal        → Clothes, Tech
```
Parent totals INCLUDE children. Total Expenses sums parents only (no double-counting).

### Category Color Map
See `js/constants.js:CC`. (entertainment, food, home, personal, transportation, utilities, financial, income, investment, and their subcategories.)

### Currency
All amounts stored and displayed in USD. Legacy CAD transactions converted at 0.73 rate during import.

## Database Schema (Key Tables)

- **transactions**: Core ledger. Fields: `date`, `service_start`, `service_end`, `description`, `category_id`, `amount_usd`, `daily_cost`, `service_days`, `payment_type`, `credit`, `tag`
- **categories**: Hierarchy with `parent_id`. Includes `is_expense` flag.
- **tags**: Trip/event metadata with `start_date`, `end_date`, `tag_type`
- **accounts**: Balance sheet accounts (checking, savings, credit, investment)
- **balance_snapshots**: Point-in-time account balances (`account_id`, `snapshot_date`, `balance_usd`)
- **portfolio_snapshots**: Investment allocation breakdown by account

## App Tabs
1. **Income Statement** — Monthly breakdown by category with cross-year "All" view
2. **Balance Sheet** — Net worth from latest snapshots, with snapshot reminder banner
3. **Tags** — Trip/event expense tracking with accrual-based totals
4. **Ledger** — Paginated transaction list with filters (search, category, payment type, date range)
5. **Entry** — Add new transactions
6. **Export** — TSV/JSON download (all, new-only since import)

## Conventions

- All functions are plain globals (no module system, no `window.app` prefix)
- Constants: `UPPER_CASE` (`PARENT_CATS`, `CC`, `PTS`, etc.)
- State: `state.tab`, `state.year`, `state.page`, `state.lf` (ledger filters)
- Never use `!` in JS strings (breaks execution)
- Deploy: `npx netlify-cli deploy --prod`
- Supabase default 1000-row limit — always paginate with offset loop

## Known Patterns & Gotchas

- **Pagination required**: Supabase 1000-row default limit caused silent data truncation. Always use paginated fetch for transactions.
- **Subcategory rollup**: When computing parent category totals, sum children into parent. Don't count both.
- **Cross-year view**: The "All" year tab aggregates by year. Must exclude `investment` and `financial` from expense totals to match single-year views.
- **Tag accruals**: Tags use `daily_cost × overlap_days` not raw `amount_usd`. Overlap = intersection of [service_start, service_end] with [tag_start, tag_end].
- **Service days**: `service_days = service_end - service_start + 1` (inclusive).
- **Number formatting**: Tables show full digits (right-justified, mono font). Charts use K/M abbreviations.
- **Subcategories**: Collapsed by default with toggle arrows.
- **Unicode in comment separators**: The `index.html` section headers use `●` (U+25CF, multi-byte UTF-8) in comment lines like `// ●●●●...`. The Edit tool's string matching can fail on these characters. **Workaround**: Use Python file manipulation or `sed` with line numbers to insert/edit near these separator lines. Never try to match separator lines directly with the Edit tool. Use `grep -n` to find exact line numbers first, then insert relative to ASCII-only anchor lines (e.g., `// INCOME STATEMENT`).

## Payment Types
See `js/constants.js:PTS` (39 total).

---

# Workflow Rules

## 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

## 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

## 3. Self-Improvement Loop
- After ANY correction from Mark: update memory (`/memory/`) with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops

## 4. Verification Before Done
- Never mark a task complete without proving it works
- For UI changes: describe what changed and how to verify on disciplan.netlify.app
- For data changes: run a validation query against known values
- Ask yourself: "Would a staff engineer approve this?"

## 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- This is a single-file app. Keep it that way unless there's a strong reason not to.

## 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from Mark
- Go fix failing CI tests without being told how

## 7. Disciplan-Specific Rules
- **Always pull latest `index.html` from git before editing** — the file changes frequently
- **Validate accrual math** against known values (e.g., Japan tag = ~$6,979)
- **Test mobile** — the app must work on phone. Use `hide-m` class for optional columns.
- **Update roadmap splits when completing items**: (1) add release note to `roadmap/RELEASES.md` under current version, (2) move item from `roadmap/ACTIVE.md` to `roadmap/COMPLETED.md`, (3) run `bash scripts/build-roadmap.sh` to regenerate `ROADMAP.md`. Never edit `ROADMAP.md` directly.
- **Token estimate in release notes** — every release note bullet must end with `(~X,XXX tokens)` estimating the implementation cost. Estimate: files read × lines × ~4 tokens/line + overhead. Round to nearest 500.
- **Deployment** — Netlify auto-deploys are disabled via `ignore = "exit 0"` in `netlify.toml`. Each push to `main` does NOT trigger a deploy. To deploy manually, run: `npx netlify-cli deploy --prod`. This conserves Netlify free tier credits — only deploy when Mark explicitly says "deploy" or "ship it". Continue to batch changes locally and only commit+push at session end.

## Task Management

1. **Plan First**: Use plan mode or outline steps before implementing
2. **Verify Plans**: Check in with Mark before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Capture Lessons**: Update memory (`/memory/`) after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Data Accuracy**: Financial data must be correct. When in doubt, validate against the spreadsheet CSVs.
