# CLAUDE.md — The Disciplan

## Project Overview

Accrual-based personal finance tracker. Single-page web app tracking 12,000+ transactions from June 2017 to present.

- **Live site**: https://disciplan.netlify.app
- **Repo**: https://github.com/markqren/disciplan
- **Backend**: Supabase (project: `mjuannepfodstbsxweuc`)
- **Stack**: Single `index.html` (vanilla JS + Chart.js CDN) → Supabase REST API
- **Deploy**: `git push` to `main` → Netlify auto-deploys

## Architecture

### File Structure
```
disciplan/
├── index.html          # The entire app (~871 lines)
├── CLAUDE.md           # This file
├── disciplan-roadmap.md # Feature/bug tracker (canonical)
├── tasks/
│   ├── todo.md         # Current session task tracking
│   └── lessons.md      # Accumulated learnings
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
```javascript
const CC = {
  entertainment:"#E07A5F", food:"#F2CC8F", groceries:"#E9C46A", restaurant:"#F4A261",
  home:"#4A6FA5", rent:"#5B8DB8", furniture:"#7FB3D8", health:"#D4A373",
  personal:"#3D405B", clothes:"#52556E", tech:"#6B6F82", transportation:"#81B29A",
  utilities:"#6B9AC4", financial:"#CB997E", other:"#9B8EA0", income:"#2A9D8F",
  investment:"#264653"
};
```

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

## Known Patterns & Gotchas

- **Pagination required**: Supabase 1000-row default limit caused silent data truncation. Always use paginated fetch for transactions.
- **Subcategory rollup**: When computing parent category totals, sum children into parent. Don't count both.
- **Cross-year view**: The "All" year tab aggregates by year. Must exclude `investment` and `financial` from expense totals to match single-year views.
- **Tag accruals**: Tags use `daily_cost × overlap_days` not raw `amount_usd`. Overlap = intersection of [service_start, service_end] with [tag_start, tag_end].
- **Service days**: `service_days = service_end - service_start + 1` (inclusive).
- **Number formatting**: Tables show full digits (right-justified, mono font). Charts use K/M abbreviations.
- **Subcategories**: Collapsed by default with toggle arrows.

## Current Payment Types (39 total)
Chase Chequing, Chase Savings, AMEX Chequing, Charles Schwab, Vanguard, eTrade, eTrade IRA, Kraken, HSA Invest, Apple, AMEX US, AMEX Rose Gold, Bilt, Uber, Capital One, Chase Sapphire, Chase Freedom, Chase Aeroplan, Chase United, Venmo Credit, TD Visa, Cash - USD, Cash - CAD, Poker Stars, Venmo, Tony, Kevin, Google, Delta, Bonus, Laundry, Wageworks, Poker, Rent, Basketball, HSA, FSA, Ski Lease, Credits, Transfer, Home Trust, Clipper, Presto, AMEX

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
- After ANY correction from Mark: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

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
- **Update `disciplan-roadmap.md`** when completing items — move to Completed section with date
- **Batch deploys** — Do NOT git push after every change. Accumulate changes locally and only commit+push once at the end of a session (or when Mark explicitly asks). Each push triggers a Netlify production deploy that consumes credits, and we're on the free tier with limited credits per month.

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plans**: Check in with Mark before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Data Accuracy**: Financial data must be correct. When in doubt, validate against the spreadsheet CSVs.
