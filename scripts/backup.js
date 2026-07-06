#!/usr/bin/env node
// Disciplan weekly backup — fetches all key tables from Supabase, writes CSVs to BACKUP_DIR
// Requires the service_role key (bypasses RLS, has access to the disciplan schema).
// Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/backup.js
//        SUPABASE_SERVICE_ROLE_KEY=<key> BACKUP_DIR=/path/to/output node scripts/backup.js

const { writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const SB_URL = 'https://mjuannepfodstbsxweuc.supabase.co/rest/v1';

// The disciplan schema grants access only to the authenticated and service_role
// roles (see 20260513000003_disciplan_schema.sql), so the anon key cannot read it.
// A backup should also bypass RLS to capture every user's rows, which requires the
// service_role key — supplied via the SUPABASE_SERVICE_ROLE_KEY env var, never hardcoded.
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_KEY) {
  console.error('Backup failed: SUPABASE_SERVICE_ROLE_KEY environment variable is not set.');
  process.exit(1);
}

// Tables live in the "disciplan" schema, so PostgREST must be told to read from it via
// Accept-Profile. Without this, requests resolve against "public" and 404 with PGRST205.
const DB_SCHEMA = 'disciplan';

const HEADERS = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
  'Accept-Profile': DB_SCHEMA
};

const TABLES = [
  { name: 'transactions',       order: 'date.asc'            },
  { name: 'categories',         order: 'id'                  },
  { name: 'tags',               order: 'start_date.desc'     },
  { name: 'accounts',           order: 'id'                  },
  { name: 'balance_snapshots',  order: 'snapshot_date.desc'  },
  { name: 'portfolio_snapshots',order: 'snapshot_date.desc'  },
];

async function fetchAll(table, order) {
  let rows = [];
  let offset = 0;
  while (true) {
    const url = `${SB_URL}/${table}?order=${order}&limit=1000&offset=${offset}`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`${table} fetch failed: ${r.status} ${await r.text()}`);
    const batch = await r.json();
    rows = rows.concat(batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return rows;
}

function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const escape = v => {
    if (v == null) return '';
    const s = String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = keys.join(',');
  const body = rows.map(r => keys.map(k => escape(r[k])).join(','));
  return [header, ...body].join('\n');
}

async function main() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outDir = process.env.BACKUP_DIR || join(process.cwd(), `disciplan_backup_${date}`);
  mkdirSync(outDir, { recursive: true });

  console.log(`Backing up to: ${outDir}\n`);

  let totalRows = 0;
  for (const { name, order } of TABLES) {
    process.stdout.write(`  ${name.padEnd(22)}`);
    const rows = await fetchAll(name, order);
    writeFileSync(join(outDir, `${name}.csv`), toCSV(rows), 'utf8');
    console.log(`${String(rows.length).padStart(6)} rows`);
    totalRows += rows.length;
  }

  console.log(`\nDone. ${totalRows.toLocaleString()} total rows backed up.`);
}

main().catch(e => { console.error('\nBackup failed:', e.message); process.exit(1); });
