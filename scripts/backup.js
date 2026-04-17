#!/usr/bin/env node
// Disciplan weekly backup — fetches all key tables from Supabase, writes CSVs to BACKUP_DIR
// Usage: node scripts/backup.js
//        BACKUP_DIR=/path/to/output node scripts/backup.js

const { writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const SB_URL = 'https://mjuannepfodstbsxweuc.supabase.co/rest/v1';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdWFubmVwZm9kc3Ric3h3ZXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzODcwMzksImV4cCI6MjA4Njk2MzAzOX0.6TqLUAhvWMjDunpird0_9FMnDiT4qRuYaH6XbXmKOnA';

const HEADERS = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json'
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
