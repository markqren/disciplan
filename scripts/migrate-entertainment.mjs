#!/usr/bin/env node
/**
 * FEA-03: One-time migration script to reclassify entertainment transactions
 * into accommodation / games subcategories using Claude API.
 *
 * Usage:
 *   node scripts/migrate-entertainment.mjs --classify    # Step 1: classify & save results
 *   node scripts/migrate-entertainment.mjs --apply       # Step 2: apply approved changes
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const SB_URL = 'https://mjuannepfodstbsxweuc.supabase.co/rest/v1';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdWFubmVwZm9kc3Ric3h3ZXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzODcwMzksImV4cCI6MjA4Njk2MzAzOX0.6TqLUAhvWMjDunpird0_9FMnDiT4qRuYaH6XbXmKOnA';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESULTS_FILE = 'scripts/migration-results.json';

// ── Supabase helpers ──

async function sbFetch(endpoint) {
  const res = await fetch(`${SB_URL}/${endpoint}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase GET ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(endpoint, body) {
  const res = await fetch(`${SB_URL}/${endpoint}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchAllEntertainment() {
  let all = [], off = 0;
  while (true) {
    const batch = await sbFetch(`transactions?category_id=eq.entertainment&order=date.asc&limit=1000&offset=${off}`);
    all = all.concat(batch);
    if (batch.length < 1000) break;
    off += 1000;
  }
  return all;
}

// ── Claude API ──

async function classifyBatch(transactions) {
  const items = transactions.map(t => ({
    id: t.id,
    date: t.date,
    description: t.description,
    amount: t.amount_usd,
    payment_type: t.payment_type
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Classify each transaction into exactly one category: "entertainment", "accommodation", or "games".

Rules:
- accommodation: Hotels, Airbnb, hostels, lodging, camping reservations, resort stays
- games: Video games, board games, Steam, PlayStation, Xbox, Nintendo, poker buy-ins, gaming subscriptions (but NOT streaming services like Netflix)
- entertainment: Everything else (concerts, movies, events, sports, activities, tickets, streaming services, theme parks)

Return ONLY a JSON array of objects with "id" (number) and "category" (string). No explanation.

Transactions:
${JSON.stringify(items, null, 2)}`
      }]
    })
  });

  if (!res.ok) throw new Error(`Claude API: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.content[0].text;

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Could not parse Claude response: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

// ── Grouping ──

function groupByPattern(transactions, classifications) {
  const classMap = new Map(classifications.map(c => [c.id, c.category]));

  function normalize(desc) {
    return desc.replace(/\s*[-–—]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}/gi, '')
               .replace(/\s*\(.*?\)/g, '')
               .replace(/\s*#\d+/g, '')
               .replace(/\s+/g, ' ')
               .trim()
               .toLowerCase();
  }

  const groups = new Map();

  for (const t of transactions) {
    const cat = classMap.get(t.id) || 'entertainment';
    if (cat === 'entertainment') continue;

    const norm = normalize(t.description);
    if (!groups.has(norm)) {
      groups.set(norm, { pattern: t.description, category: cat, transactions: [] });
    }
    groups.get(norm).transactions.push({ id: t.id, date: t.date, description: t.description, amount_usd: t.amount_usd });
  }

  const grouped = [];
  const ungrouped = [];

  for (const [, g] of groups) {
    if (g.transactions.length >= 2) {
      grouped.push({ pattern: g.pattern, category: g.category, count: g.transactions.length, total: g.transactions.reduce((s, t) => s + Math.abs(t.amount_usd), 0), ids: g.transactions.map(t => t.id), transactions: g.transactions });
    } else {
      ungrouped.push({ ...g.transactions[0], category: g.category });
    }
  }

  grouped.sort((a, b) => b.count - a.count);
  return { grouped, ungrouped };
}

// ── Commands ──

async function classify() {
  if (!ANTHROPIC_KEY) { console.error('Error: Set ANTHROPIC_API_KEY environment variable'); process.exit(1); }

  console.log('\nFetching entertainment transactions...');
  const txns = await fetchAllEntertainment();
  console.log(`Found ${txns.length} transactions\n`);

  if (txns.length === 0) { console.log('Nothing to classify.'); return; }

  console.log('Classifying with Claude Haiku...');
  const BATCH_SIZE = 100;
  let allClassifications = [];

  for (let i = 0; i < txns.length; i += BATCH_SIZE) {
    const batch = txns.slice(i, i + BATCH_SIZE);
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(txns.length / BATCH_SIZE)} (${batch.length} txns)...`);
    const results = await classifyBatch(batch);
    allClassifications = allClassifications.concat(results);
  }

  const { grouped, ungrouped } = groupByPattern(txns, allClassifications);
  const total = allClassifications.filter(c => c.category !== 'entertainment').length;

  const results = { totalTransactions: txns.length, totalReclassified: total, grouped, ungrouped };
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  console.log(`\nResults: ${total} of ${txns.length} proposed for reclassification`);
  console.log(`  ${grouped.length} grouped patterns, ${ungrouped.length} ungrouped`);
  console.log(`Saved to ${RESULTS_FILE}\n`);

  // Print summary
  console.log('GROUPED PATTERNS:');
  grouped.forEach((g, i) => {
    console.log(`  [${i + 1}] "${g.pattern}" => ${g.category} (${g.count} txns, $${g.total.toFixed(0)})`);
  });
  if (ungrouped.length) {
    console.log('\nUNGROUPED:');
    ungrouped.forEach((t, i) => {
      console.log(`  [${i + 1}] ${t.date} $${Math.abs(t.amount_usd).toFixed(2)} "${t.description}" => ${t.category}`);
    });
  }
}

async function apply() {
  if (!existsSync(RESULTS_FILE)) { console.error(`No results file found. Run --classify first.`); process.exit(1); }

  const results = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
  const updates = new Map(); // id → category

  // Collect all approved IDs (edit migration-results.json to remove rejected groups/items before running)
  for (const g of results.grouped) {
    for (const id of g.ids) updates.set(id, g.category);
  }
  for (const t of results.ungrouped) {
    updates.set(t.id, t.category);
  }

  console.log(`\nApplying ${updates.size} updates...`);

  const byCategory = new Map();
  for (const [id, cat] of updates) {
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(id);
  }

  let done = 0;
  for (const [cat, ids] of byCategory) {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const filter = `id=in.(${chunk.join(',')})`;
      await sbPatch(`transactions?${filter}`, { category_id: cat });
      done += chunk.length;
      console.log(`  ${done}/${updates.size} updated`);
    }
  }

  console.log(`\nDone! ${done} transactions updated.`);
}

// ── Entry point ──

const mode = process.argv[2];
if (mode === '--classify') classify().catch(e => { console.error(e); process.exit(1); });
else if (mode === '--apply') apply().catch(e => { console.error(e); process.exit(1); });
else console.log('Usage:\n  node scripts/migrate-entertainment.mjs --classify\n  node scripts/migrate-entertainment.mjs --apply');
