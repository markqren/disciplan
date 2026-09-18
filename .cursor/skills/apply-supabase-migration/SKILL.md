---
name: apply-supabase-migration
description: Applies Disciplan Postgres migrations via the Supabase Management API and records supabase_migrations.schema_migrations in the same transaction. Use whenever applying schema, db push, supabase migration new/list, edge-function SQL, or when npx supabase exits 137. Never invoke the Supabase CLI on this laptop.
---

# Apply a Disciplan migration (no CLI)

Santa SIGKILLs `npx supabase` / `supabase` on this machine (exit 137, no output). Do not retry.

## Steps

1. Write `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql` (unique 14-digit version). Qualify `disciplan.` tables. Include GRANTs + RLS. Identity columns also need `GRANT USAGE, SELECT ON SEQUENCE ..._id_seq TO authenticated`.
2. Fetch PAT without printing it:
   `security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d`
3. `POST https://api.supabase.com/v1/projects/mjuannepfodstbsxweuc/database/query`
   Header: `Authorization: Bearer <pat>`, `Content-Type: application/json`
4. Body query, one transaction:

```sql
BEGIN;
-- <file contents>
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('YYYYMMDDHHMMSS', '<name>', ARRAY[$mig$<file contents>$mig$])
ON CONFLICT (version) DO NOTHING;
COMMIT;
```

5. Verify: `to_regclass`, row counts, `pg_policies`, and `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3`.
6. For authenticated-path checks: `BEGIN; SET LOCAL ROLE authenticated; ...; ROLLBACK;`
7. Anon-key `42501 permission denied for schema disciplan` is expected.

Recording the `schema_migrations` row is what `db push` does. Skipping it is the old dashboard-SQL-editor drift bug (`tasks/migration-history-reconcile.md`).
