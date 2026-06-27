# Migration History Reconciliation — Runbook

`supabase db push` keeps failing with **"Remote migration versions not found in
local migrations directory"** and migrations keep showing as un-applied even
though their objects exist on the live DB. This runbook explains why and fixes
it once, then keeps it fixed.

## Why this keeps happening (3 root causes)

1. **Out-of-band applies (the big one).** Migrations get run through the
   Supabase **dashboard SQL editor** or `supabase db query`. Neither writes a row
   to `supabase_migrations.schema_migrations`, so the remote *history table*
   never learns the migration ran. The next `db push` sees the file as pending.
   (This is how `20260530000001`, all of `20260620000001‑4`, `20260625000001`,
   `20260626000001‑3` ended up "live but unrecorded".)

2. **Invalid 8-digit version names.** Supabase versions must be 14-digit
   `YYYYMMDDHHMMSS`. These eight are only 8-digit `YYYYMMDD`:
   `20260307 20260308 20260309 20260403 20260404 20260405 20260410 20260427`.
   The CLI can't parse them as timestamps (in `supabase migration list` their
   "Time" column prints the raw string, not a date), so it mis-sorts and
   mis-pairs them against the 14-digit remote rows — producing the phantom
   "missing on local" rows that hard-stop `db push`.

3. **Duplicate versions.** Two files share `20260410`
   (`data_health_check`, `merchant_patterns`) and — currently — two share
   `20260626000003` (`tag_summaries_by_owner`, `splitwise_friend_map`).
   Supabase requires every version to be unique.

## One-time cleanup — ✅ COMPLETED Jun 26, 2026

Done in commit that renamed the 8-digit migrations + `splitwise_friend_map`.
Every migration's objects were verified already-present on the remote DB (via
`information_schema` / live RPC probes), so the reconcile was **pure
bookkeeping** — `supabase migration repair` only edited the history *table*; no
migration SQL was re-executed. Afterwards `supabase migration list --linked`
shows every row aligned (Local == Remote) and `supabase db push` reports
"Remote database is up to date." The steps below are kept as the procedure to
re-run if drift ever recurs.

Run from repo root. Steps 1–2 only rename files and edit the history *table*
(bookkeeping) — **no migration SQL is re-executed**, so there is zero risk to
data.

### Step 0 — start from a clean tree

```bash
git status            # commit or stash all WIP first
```

Resolve the live duplicate `20260626000003`. `tag_summaries_by_owner` is already
committed + applied, so bump the newer, un-applied one:

```bash
git mv supabase/migrations/20260626000003_splitwise_friend_map.sql \
       supabase/migrations/20260626000004_splitwise_friend_map.sql
```

### Step 1 — normalize the 8-digit filenames to 14-digit (rename only)

Appending `000000` keeps the same date and ordering. The second `20260410`
file gets `000001` so the pair stays unique and in its original order.

```bash
cd supabase/migrations
git mv 20260307_pending_imports.sql      20260307000000_pending_imports.sql
git mv 20260308_forwarding_note.sql      20260308000000_forwarding_note.sql
git mv 20260309_working_capital.sql      20260309000000_working_capital.sql
git mv 20260403_get_tag_summaries.sql    20260403000000_get_tag_summaries.sql
git mv 20260404_insight_log.sql          20260404000000_insight_log.sql
git mv 20260405_insight_context.sql      20260405000000_insight_context.sql
git mv 20260410_data_health_check.sql    20260410000000_data_health_check.sql
git mv 20260410_merchant_patterns.sql    20260410000001_merchant_patterns.sql
git mv 20260427_phase0_hardening.sql     20260427000000_phase0_hardening.sql
cd ../..
```

### Step 2 — make the history table match the files

First drop the stale 8-digit rows from remote history (they don't drop any
objects — just the bookkeeping rows):

```bash
npx supabase migration repair --status reverted \
  20260307 20260308 20260309 20260403 20260404 20260405 20260410 20260427
```

Then mark every version that is **actually applied on the DB** as applied. The
renamed-but-already-applied ones are certain; the previously out-of-band ones
were verified live (their tables/functions exist).

```bash
npx supabase migration repair --status applied \
  20260307000000 20260308000000 20260309000000 20260403000000 20260404000000 \
  20260405000000 20260410000000 20260410000001 20260427000000 \
  20260530000001 20260620000001 20260620000002 20260620000003 20260620000004 \
  20260625000001 20260626000001 20260626000002 20260626000003
```

> Only mark a version `applied` once you've confirmed its objects exist on the
> DB. The cheapest check is a `db query --linked` against `information_schema`,
> e.g. `SELECT count(*) FROM information_schema.columns WHERE table_schema='disciplan' AND table_name='splitwise_expenses' AND column_name='dismissed_at';`
> or probing the REST API (`404`/`PGRST202` = missing, `401` = exists but
> auth-gated). If an object is genuinely missing, apply that migration via
> `db push` (after this repair) or `db query --linked --file <migration>` first,
> then it's recorded. (In the Jun 26 run, all objects already existed, so every
> version above — including `20260626000004_splitwise_friend_map` — was marked
> applied and the verification push was a clean no-op.)

### Step 3 — verify

```bash
npx supabase migration list --linked   # every row: Local == Remote, no blanks
npx supabase db push                    # applies any still-pending migration; else "up to date"
```

After this, `migration list` is fully aligned and `db push` is a clean no-op
going forward.

## Going forward — stop the drift (do these, every time)

- **Create** migrations only with `supabase migration new <name>` — it stamps a
  correct, unique 14-digit version. Never hand-type an 8-digit date or reuse a
  number.
- **Apply** migrations only with `supabase db push` — it records history. This
  is the single rule that prevents recurrence.
- If you *must* hotfix through the dashboard SQL editor or `supabase db query`,
  immediately record it: `supabase migration repair --status applied <version>`.
- Before any release that touches the DB: `supabase migration list --linked`
  should show no blank cells. If it does, something was applied out-of-band —
  repair it before pushing.
