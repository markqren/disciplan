# Disciplan Schema Rollout — Runbook

Move all Disciplan tables/views/functions from `public` → `disciplan` schema,
namespacing them away from Nocturnal. Also locks in explicit Data API grants
ahead of the Oct 30, 2026 Supabase deadline.

## Prepared artifacts

- `supabase/migrations/20260513000002_data_api_grants.sql` — explicit grants + default privileges on `public`. Idempotent, safe to run anytime.
- `supabase/migrations/20260513000003_disciplan_schema.sql` — creates `disciplan` schema, moves all user-created tables/views/functions, grants + default privileges on `disciplan`. **Apply only after the verify deploy below succeeds.**
- `js/config.js` — `DB_SCHEMA` constant (currently `"public"`) + `Accept-Profile` / `Content-Profile` headers + `db: { schema: DB_SCHEMA }` on `createClient`.
- `supabase/functions/{daily-insight,inbound-email}/index.ts` — read `DB_SCHEMA` env var (defaults to `"public"`) and pass `db: { schema: DB_SCHEMA }` to `createClient`.

## Step-by-step

### Step 1 — Apply grants migration (zero risk)

```bash
supabase db push
```

The grants migration is idempotent. Existing grants stay; default privileges get set so any future table you create gets grants automatically. No code change required, no behavior change.

### Step 2 — Verify deploy of Profile headers (proves the routing mechanism)

With `DB_SCHEMA = "public"` still in `js/config.js`:

```bash
git add -A && git commit -m "chore: add Profile headers + grants migration"
git push
npx netlify-cli deploy --prod
```

Open https://disciplan.netlify.app, sign in, and verify:

- Income Statement loads
- Ledger loads
- Open DevTools → Network → confirm `Accept-Profile: public` is sent on `/rest/v1/*` requests

If anything broke, the headers themselves are the suspect — fix in `js/config.js` and redeploy. Don't proceed to Step 3 until this verify passes.

### Step 3 — Expose `disciplan` schema in Supabase Dashboard

Dashboard → Project Settings → API → **Exposed schemas** → add `disciplan` → Save.

Without this, PostgREST will return `PGRST106` ("schema must be one of the following: ...") for any request with `Accept-Profile: disciplan`.

### Step 4 — Set the Edge Function env var

```bash
supabase secrets set DB_SCHEMA=disciplan
```

(Both `daily-insight` and `inbound-email` read this on next invocation.)

### Step 5 — Cutover (tight sequence; ~30s window)

This window is the only point where the live site can break. Do steps 5a–5c back-to-back.

**5a — Apply schema-move migration:**

```bash
supabase db push
```

Tables instantly disappear from `public`, appear in `disciplan`. Site is now broken (still using `Accept-Profile: public`).

**5b — Flip `DB_SCHEMA` constant and deploy site:**

In `js/config.js`, change `const DB_SCHEMA = "public"` → `const DB_SCHEMA = "disciplan"`.

```bash
git add -A && git commit -m "chore: flip DB_SCHEMA to disciplan"
git push
npx netlify-cli deploy --prod
```

**5c — Redeploy Edge Functions:**

```bash
supabase functions deploy daily-insight
supabase functions deploy inbound-email
```

Site is back. Window closed.

### Step 6 — Smoke test

- Site: load Income Statement, Ledger, Tags, Balance Sheet, Portfolio. All should populate.
- DevTools Network → confirm `Accept-Profile: disciplan` is sent.
- Edge Function: trigger `daily-insight` in dry-run mode (`POST /functions/v1/daily-insight` with `dry_run: true`) and confirm it succeeds.
- `inbound-email`: forward yourself a test email; confirm a row lands in `disciplan.pending_imports`.

## Rollback

If Step 5 fails after the schema migration ran:

```sql
-- Rollback: move everything back to public.
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='disciplan' AND c.relkind='r'
  LOOP EXECUTE format('ALTER TABLE disciplan.%I SET SCHEMA public', r.relname); END LOOP;
  FOR r IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='disciplan' AND c.relkind IN ('v','m')
  LOOP EXECUTE format('ALTER VIEW disciplan.%I SET SCHEMA public', r.relname); END LOOP;
  FOR r IN SELECT proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='disciplan' AND p.prokind='f'
  LOOP EXECUTE format('ALTER FUNCTION disciplan.%I(%s) SET SCHEMA public', r.proname, r.args); END LOOP;
END $$;
```

Then revert `js/config.js` and Edge Function env (`supabase secrets unset DB_SCHEMA`), redeploy.

## Known follow-ups

- `supabase/functions/daily-insight/index.ts:990` (`html_preview_url`) still constructs `${SB_URL}/rest/v1/insight_log?...` for dry-run output. After the move, that URL needs an `Accept-Profile: disciplan` header to work — fine for `curl`, won't load directly in a browser. Low priority debug aid; either drop the field or document the curl command.
- All future migrations creating tables MUST use `disciplan.` qualified names and include explicit `GRANT` blocks. See updated CLAUDE.md template.
- The Supabase Dashboard's Table Editor will create tables in whichever schema you select — make sure to pick `disciplan`, not `public`.
