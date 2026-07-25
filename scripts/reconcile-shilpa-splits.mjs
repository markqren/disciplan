#!/usr/bin/env node
/**
 * reconcile-shilpa-splits.mjs — one-time (idempotent) migration to reconcile
 * shared expenses that Shilpa fronted (imported into her ledger) against Mark's
 * Splitwise/Venmo payments for his share.
 *
 * Model: Shilpa fronts an expense E (owner=shilpa, amount_usd>0). The check was
 * split N ways (N in 2..6), so Mark's share is a payment P (owner=mark,
 * payment_type in Splitwise/Venmo, amount_usd>0) with E ≈ N * P. For each matched
 * pair we:
 *   1. Rewrite Shilpa's expense E to inherit category_id / tag / service period
 *      from Mark's payment P (and recompute service_days + daily_cost).
 *   2. Insert a reimbursement on Shilpa's books: "Reimbursed - <E.desc> - Mark",
 *      payment_type=Splitwise, amount = -P.amount_usd (Mark's exact share).
 *   3. Link E, P and the new reimbursement into one transaction_group.
 * Other people's shares are left for a later Splitwise settle-up pass.
 *
 * Auth: Supabase Personal Access Token from .secrets/supabase-pat (same as
 * scripts/dbq.sh). Runs SQL as postgres via the Management API (bypasses RLS).
 *
 * Usage:
 *   node scripts/reconcile-shilpa-splits.mjs scan            # find + score pairs -> candidates file
 *   node scripts/reconcile-shilpa-splits.mjs show [batchNo]  # print a 15-row batch (default 1)
 *   node scripts/reconcile-shilpa-splits.mjs apply <ids...>  # apply approved candidate #s (comma/space)
 *   node scripts/reconcile-shilpa-splits.mjs undo <batchId>  # revert an applied batch
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REF = 'mjuannepfodstbsxweuc';
const OUT_DIR = join(ROOT, '.reconcile');           // gitignored working dir
const CAND_FILE = join(OUT_DIR, 'candidates.json');
const APPLIED_FILE = join(OUT_DIR, 'applied.json');
const BATCH_SIZE = 15;

// ── Auth ──
function getPat() {
  let pat = process.env.SUPABASE_PAT || '';
  const f = join(ROOT, '.secrets', 'supabase-pat');
  if (!pat && existsSync(f)) pat = readFileSync(f, 'utf8').trim();
  if (!pat) { console.error('No Supabase PAT (.secrets/supabase-pat or SUPABASE_PAT).'); process.exit(1); }
  return pat;
}
const PAT = getPat();

async function runSQL(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${txt}`);
  return txt ? JSON.parse(txt) : [];
}

// ── SQL literal helpers ──
const q = v => (v === null || v === undefined) ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const num = v => (v === null || v === undefined || v === '') ? 'null' : String(v);

// ── Text normalization + scoring ──
const STOP = new Set(['the', 'and', 'for', 'with', 'via', 'paid', 'splitwise', 'venmo', 'item', 'payment', 'inc', 'llc', 'co', 'the']);
// Leading "Category - " style prefixes Mark uses; strip so the merchant name compares cleanly.
const PREFIX_RE = /^(restaurant|accommodation|groceries|grocery|flight|flights|ferry|gas|furniture|drinks|drink|hotel|airbnb|uber|lyft|taxi|coffee|bar|tickets?|tour|rental|car rental)\s*[-:]\s*/i;

function normDesc(s) {
  let t = String(s || '').toLowerCase().trim();
  t = t.replace(PREFIX_RE, '');
  t = t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}
function tokens(s) {
  return normDesc(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w));
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const SKIP_CATS = new Set(['financial', 'adjustment', 'income', 'investment']);
const daydiff = (a, b) => Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 864e5);

// Score a (P, E) candidate. Returns null if not a plausible pair.
function scorePair(P, E) {
  const pAmt = Math.abs(+P.amount_usd), eAmt = Math.abs(+E.amount_usd);
  if (pAmt < 1 || eAmt < 1) return null;
  const ratio = eAmt / pAmt;
  const n = Math.round(ratio);
  if (n < 2 || n > 6) return null;
  const amtErr = Math.abs(eAmt - n * pAmt);
  if (amtErr > 0.03 * n + 0.03) return null;              // must be a clean integer multiple

  const dd = daydiff(E.date, P.date);
  const add = Math.abs(dd);

  // corroboration signals
  const tP = tokens(P.description), tE = tokens(E.description);
  const jac = jaccard(tP, tE);
  const sameNorm = normDesc(P.description) && normDesc(P.description) === normDesc(E.description);
  const tagMatch = P.tag && E.tag && P.tag.toLowerCase() === E.tag.toLowerCase();
  const catMatch = P.category_id && P.category_id === E.category_id;

  // Require SOME name/tag corroboration — pure amount+date is not enough.
  if (jac === 0 && !sameNorm && !tagMatch) return null;

  let score = 0;
  score += amtErr <= 0.005 ? 22 : amtErr <= 0.02 ? 16 : 10;           // amount cleanliness
  score += sameNorm ? 34 : Math.round(jac * 34);                       // description
  if (tagMatch) score += 26;
  if (catMatch) score += 12;
  score += add <= 1 ? 20 : add <= 7 ? 14 : add <= 21 ? 8 : add <= 45 ? 4 : 0;  // date proximity

  if (score < 46) return null;
  const confidence = score >= 78 ? 'high' : score >= 60 ? 'medium' : 'low';
  return { n, amtErr: +amtErr.toFixed(2), dd, jac: +jac.toFixed(2), sameNorm, tagMatch, catMatch, score, confidence };
}

// ── Data fetch ──
async function fetchRows(owner, extra) {
  const cols = 'id,date,description,amount_usd,category_id,tag,service_start,service_end,service_days,daily_cost,payment_type,transaction_group_id,household_id';
  let all = [], off = 0;
  while (true) {
    const rows = await runSQL(
      `select ${cols} from disciplan.transactions where owner=${q(owner)} ${extra} order by id limit 1000 offset ${off}`
    );
    all = all.concat(rows);
    if (rows.length < 1000) break;
    off += 1000;
  }
  return all;
}

async function scan() {
  console.log('Fetching Mark payments + Shilpa expenses...');
  const marks = await fetchRows('mark',
    `and payment_type in ('Splitwise','Venmo') and amount_usd>0 and description not ilike 'Reimbursed%'`);
  const shilpas = await fetchRows('shilpa',
    `and amount_usd>0 and description not ilike 'Reimbursed%'`);

  // Exclude Shilpa expenses already reconciled: any group that already holds a
  // "Reimbursed ... - Mark" row, OR any expense already tagged by a prior run.
  const doneReimb = await runSQL(
    `select distinct transaction_group_id from disciplan.transactions
     where owner='shilpa' and description ilike 'Reimbursed% - Mark' and transaction_group_id is not null`);
  const doneGroups = new Set(doneReimb.map(r => r.transaction_group_id));

  const markPool = marks.filter(m => !SKIP_CATS.has(m.category_id));
  const exp = shilpas.filter(e => !SKIP_CATS.has(e.category_id) &&
    !(e.transaction_group_id && doneGroups.has(e.transaction_group_id)));

  console.log(`  ${markPool.length} candidate Mark payments, ${exp.length} candidate Shilpa expenses`);

  // Build all plausible scored pairs.
  const pairs = [];
  for (const E of exp) {
    const eAmt = Math.abs(+E.amount_usd);
    for (const P of markPool) {
      const pAmt = Math.abs(+P.amount_usd);
      if (eAmt < pAmt * 1.9 || eAmt > pAmt * 6.2) continue;   // fast prefilter
      const s = scorePair(P, E);
      if (s) pairs.push({ P, E, ...s });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  // Greedy one-to-one assignment (each Mark payment and each expense used once).
  const usedP = new Set(), usedE = new Set(), chosen = [];
  for (const c of pairs) {
    if (usedP.has(c.P.id) || usedE.has(c.E.id)) continue;
    usedP.add(c.P.id); usedE.add(c.E.id);
    chosen.push(c);
  }

  const candidates = chosen.map((c, i) => ({
    idx: i + 1,
    confidence: c.confidence, score: c.score, n: c.n, daydiff: c.dd,
    amtErr: c.amtErr, jac: c.jac, sameNorm: c.sameNorm, tagMatch: c.tagMatch, catMatch: c.catMatch,
    mark: pick(c.P), shilpa: pick(c.E),
    reimbAmount: -Math.abs(+c.P.amount_usd)
  }));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(CAND_FILE, JSON.stringify(candidates, null, 2));

  const byConf = { high: 0, medium: 0, low: 0 };
  candidates.forEach(c => byConf[c.confidence]++);
  console.log(`\nFound ${candidates.length} one-to-one candidate pairs`);
  console.log(`  high: ${byConf.high}   medium: ${byConf.medium}   low: ${byConf.low}`);
  console.log(`  ${Math.ceil(candidates.length / BATCH_SIZE)} batches of ${BATCH_SIZE}`);
  console.log(`Saved to ${CAND_FILE}\n`);
  printBatch(candidates, 1);
}

function pick(t) {
  return {
    id: t.id, date: t.date, description: t.description, amount_usd: +t.amount_usd,
    category_id: t.category_id, tag: t.tag || '',
    service_start: t.service_start, service_end: t.service_end,
    transaction_group_id: t.transaction_group_id, household_id: t.household_id
  };
}

// ── Display ──
const money = v => (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2);
function printBatch(candidates, batchNo) {
  const start = (batchNo - 1) * BATCH_SIZE;
  const slice = candidates.slice(start, start + BATCH_SIZE);
  if (!slice.length) { console.log(`No candidates in batch ${batchNo}.`); return; }
  console.log(`===== BATCH ${batchNo} / ${Math.ceil(candidates.length / BATCH_SIZE)} (candidates ${start + 1}-${start + slice.length}) =====\n`);
  for (const c of slice) {
    const flag = Math.abs(c.daydiff) > 45 ? `  \u26A0 ${c.daydiff}d apart` : `  ${c.daydiff >= 0 ? '+' : ''}${c.daydiff}d`;
    console.log(`#${c.idx}  [${c.confidence.toUpperCase()} ${c.score}]  split 1/${c.n}${flag}`);
    console.log(`     MARK  ${c.mark.date}  ${money(c.mark.amount_usd)}  ${c.mark.category_id}${c.mark.tag ? '/' + c.mark.tag : ''}  "${c.mark.description}"`);
    console.log(`     SHILPA ${c.shilpa.date} ${money(c.shilpa.amount_usd)}  ${c.shilpa.category_id}${c.shilpa.tag ? '/' + c.shilpa.tag : ''}  "${c.shilpa.description}"`);
    console.log(`     => inherit cat=${c.mark.category_id} tag=${c.mark.tag || '(none)'} ; reimburse ${money(c.reimbAmount)} Splitwise\n`);
  }
}

function loadCandidates() {
  if (!existsSync(CAND_FILE)) { console.error('No candidates file. Run scan first.'); process.exit(1); }
  return JSON.parse(readFileSync(CAND_FILE, 'utf8'));
}
// Optional per-candidate description rewrites for Shilpa's expense: {"idx": "New desc"}
const RENAME_FILE = join(OUT_DIR, 'renames.json');
function loadRenames() {
  return existsSync(RENAME_FILE) ? JSON.parse(readFileSync(RENAME_FILE, 'utf8')) : {};
}

function show(batchNo) { printBatch(loadCandidates(), batchNo || 1); }

// ── Apply ──
function svcDays(ss, se) { return Math.max(1, Math.round((new Date(se + 'T00:00:00') - new Date(ss + 'T00:00:00')) / 864e5) + 1); }

// Compute the full change set for a candidate against live DB rows (no writes).
function computePlan(c, lP, lE, renames) {
  const ss = lP.service_start || lE.service_start || lE.date;
  const se = lP.service_end || lE.service_end || lE.date;
  const sd = svcDays(ss, se);
  const eAmt = +lE.amount_usd;
  const eDaily = +(eAmt / sd).toFixed(6);
  const tag = (lP.tag || '').toLowerCase().trim();
  // Reimburse everyone-else's share so Shilpa nets her own 1/N share (= Mark's
  // payment). For a 50/50 split this equals Mark's amount; for N>2 it bundles the
  // other participants' shares into one Splitwise reimbursement (granular later).
  const markShare = Math.abs(+lP.amount_usd);
  const reimbAmt = -(Math.round((eAmt - markShare) * 100) / 100);
  const reimbDaily = +(reimbAmt / sd).toFixed(6);
  const existing = [lE.transaction_group_id, lP.transaction_group_id].filter(x => x != null);
  const groupId = existing.length ? Math.min(...existing, lE.id, lP.id) : Math.min(lE.id, lP.id);
  const newExpDesc = (renames && renames[c.idx]) ? renames[c.idx] : lE.description;
  const suffix = c.n > 2 ? 'Split' : 'Mark';
  const reimbDesc = `Reimbursed - ${newExpDesc} - ${suffix}`;
  return {
    ss, se, sd, eAmt, eDaily, tag, reimbAmt, reimbDaily, groupId,
    newExpDesc, reimbDesc, catNew: lP.category_id,
    mergedGroups: existing.filter(g => g !== groupId)
  };
}

async function liveRows(ids) {
  const rows = await runSQL(
    `select id,transaction_group_id,category_id,tag,service_start,service_end,service_days,daily_cost,amount_usd,description,household_id,date
     from disciplan.transactions where id in (${ids.join(',')})`);
  return rows;
}

const svc = (a, b) => `${a}..${b} (${svcDays(a, b)}d)`;
const arrow = (o, n) => (String(o) === String(n)) ? `${o} (unchanged)` : `${o}  ->  ${n}`;

async function preview(ids) {
  const candidates = loadCandidates();
  const byIdx = new Map(candidates.map(c => [c.idx, c]));
  const renames = loadRenames();
  const list = ids.map(Number).filter(n => byIdx.has(n)).map(n => byIdx.get(n));
  if (!list.length) { console.error('No valid candidate #s given.'); process.exit(1); }
  for (const c of list) {
    const rows = await liveRows([c.mark.id, c.shilpa.id]);
    const lP = rows.find(r => r.id === c.mark.id), lE = rows.find(r => r.id === c.shilpa.id);
    if (!lP || !lE) { console.log(`#${c.idx}: SKIP (row missing)`); continue; }
    const p = computePlan(c, lP, lE, renames);
    console.log(`\n===== #${c.idx}  [${c.confidence} ${c.score}]  split 1/${c.n}  (${c.daydiff >= 0 ? '+' : ''}${c.daydiff}d)${Math.abs(c.daydiff) > 45 ? '  \u26A0 LARGE GAP' : ''} =====`);
    console.log(`  Mark  payment #${lP.id}: ${money(+lP.amount_usd)}  ${lP.category_id}${lP.tag ? '/' + lP.tag : ''}  svc ${svc(lP.service_start || lP.date, lP.service_end || lP.date)}  "${lP.description}"`);
    console.log(`\n  [1] EDIT Shilpa expense #${lE.id} (${money(+lE.amount_usd)}):`);
    console.log(`        description : ${arrow('"' + lE.description + '"', '"' + p.newExpDesc + '"')}`);
    console.log(`        category    : ${arrow(lE.category_id, p.catNew)}`);
    console.log(`        tag         : ${arrow(lE.tag || '(none)', p.tag || '(none)')}`);
    console.log(`        service     : ${arrow(svc(lE.service_start || lE.date, lE.service_end || lE.date), svc(p.ss, p.se))}`);
    console.log(`        daily_cost  : ${arrow(lE.daily_cost, p.eDaily)}`);
    console.log(`        group_id    : ${arrow(lE.transaction_group_id ?? 'null', p.groupId)}`);
    console.log(`\n  [2] NEW reimbursement on Shilpa's books:`);
    console.log(`        "${p.reimbDesc}"`);
    console.log(`        ${money(p.reimbAmt)}  Splitwise  ${p.catNew}${p.tag ? '/' + p.tag : ''}  date ${lE.date}  svc ${svc(p.ss, p.se)}  group ${p.groupId}  owner shilpa`);
    console.log(`        => Shilpa net after: ${money(+(p.eAmt + p.reimbAmt).toFixed(2))}  (her 1/${c.n} share; Mark's share $${(+lP.amount_usd).toFixed(2)})`);
    console.log(`\n  [3] LINK Mark payment #${lP.id} into group ${p.groupId} (group_id ${arrow(lP.transaction_group_id ?? 'null', p.groupId)}; no other change)`);
    if (p.mergedGroups.length) console.log(`      (also merges existing group(s) ${p.mergedGroups.join(',')} -> ${p.groupId})`);
  }
  console.log('');
}

async function apply(ids) {
  const candidates = loadCandidates();
  const byIdx = new Map(candidates.map(c => [c.idx, c]));
  const toApply = ids.map(Number).filter(n => byIdx.has(n)).map(n => byIdx.get(n));
  if (!toApply.length) { console.error('No valid candidate #s given.'); process.exit(1); }

  const renames = loadRenames();
  const batchId = 'recon-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const log = existsSync(APPLIED_FILE) ? JSON.parse(readFileSync(APPLIED_FILE, 'utf8')) : [];
  console.log(`Applying ${toApply.length} pair(s) as batch ${batchId}\n`);

  for (const c of toApply) {
    const P = c.mark, E = c.shilpa;
    // Re-read live rows to avoid acting on stale data.
    const live = await liveRows([P.id, E.id]);
    const lP = live.find(r => r.id === P.id), lE = live.find(r => r.id === E.id);
    if (!lP || !lE) { console.log(`#${c.idx}: SKIP (row missing)`); continue; }

    const p = computePlan(c, lP, lE, renames);

    // Snapshot before-state for undo (includes description in case of rename).
    const snap = {
      batchId, idx: c.idx, groupId: p.groupId,
      expenseId: lE.id, expenseBefore: {
        description: lE.description,
        category_id: lE.category_id, tag: lE.tag, service_start: lE.service_start,
        service_end: lE.service_end, service_days: lE.service_days, daily_cost: lE.daily_cost,
        transaction_group_id: lE.transaction_group_id
      },
      markId: lP.id, markGroupBefore: lP.transaction_group_id,
      mergedGroups: p.mergedGroups
    };

    // 1. Merge any pre-existing differing groups into groupId.
    for (const g of p.mergedGroups) {
      await runSQL(`update disciplan.transactions set transaction_group_id=${p.groupId} where transaction_group_id=${g}`);
    }
    // 2. Rewrite Shilpa's expense (inherit from Mark, optional rename) + join group.
    await runSQL(
      `update disciplan.transactions set
         description=${q(p.newExpDesc)}, category_id=${q(p.catNew)}, tag=${q(p.tag)},
         service_start=${q(p.ss)}, service_end=${q(p.se)}, service_days=${p.sd}, daily_cost=${p.eDaily},
         transaction_group_id=${p.groupId}, updated_at=now()
       where id=${lE.id}`);
    // 3. Join Mark's payment to the group (data otherwise untouched).
    await runSQL(`update disciplan.transactions set transaction_group_id=${p.groupId}, updated_at=now() where id=${lP.id}`);
    // 4. Insert the reimbursement on Shilpa's books.
    const ins = await runSQL(
      `insert into disciplan.transactions
        (date, service_start, service_end, description, category_id, original_amount, currency, fx_rate,
         amount_usd, payment_type, credit, tag, daily_cost, service_days, transaction_group_id,
         import_batch, owner, household_id)
       values
        (${q(lE.date)}, ${q(p.ss)}, ${q(p.se)}, ${q(p.reimbDesc)}, ${q(p.catNew)}, ${p.reimbAmt}, 'USD', 1,
         ${p.reimbAmt}, 'Splitwise', '', ${q(p.tag)}, ${p.reimbDaily}, ${p.sd}, ${p.groupId},
         ${q(batchId)}, 'shilpa', ${num(lE.household_id)})
       returning id`);
    snap.reimbId = ins[0]?.id;
    log.push(snap);
    console.log(`#${c.idx}: ok  expense ${lE.id} -> ${p.catNew}/${p.tag || '-'}, reimb ${snap.reimbId} ${money(p.reimbAmt)}, group ${p.groupId}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(APPLIED_FILE, JSON.stringify(log, null, 2));
  console.log(`\nDone. Batch ${batchId}. To undo: node scripts/reconcile-shilpa-splits.mjs undo ${batchId}`);
}

// ── Manual apply (special cases the auto-matcher can't score, e.g. flights) ──
// Reads .reconcile/manual.json: [{idx, markId, shilpaId, reimbMode:'full'|'share',
// n, inheritService?, rename?}]. 'full' = Shilpa's charge is entirely Mark's ticket
// (separate-billing duplicate) -> reimburse the whole amount, Shilpa nets 0.
// 'share' = combined bill -> reimburse everyone-else's share (E - one share).
const MANUAL_FILE = join(OUT_DIR, 'manual.json');
function loadManual() { return existsSync(MANUAL_FILE) ? JSON.parse(readFileSync(MANUAL_FILE, 'utf8')) : []; }

async function applyManual(ids) {
  const manual = loadManual();
  const byIdx = new Map(manual.map(m => [String(m.idx), m]));
  const sel = ids.map(String).filter(x => byIdx.has(x)).map(x => byIdx.get(x));
  if (!sel.length) { console.error('No valid manual idx given.'); process.exit(1); }
  const batchId = 'reconM-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const log = existsSync(APPLIED_FILE) ? JSON.parse(readFileSync(APPLIED_FILE, 'utf8')) : [];
  console.log(`Applying ${sel.length} manual pair(s) as batch ${batchId}\n`);
  for (const m of sel) {
    const live = await liveRows([m.markId, m.shilpaId]);
    const lP = live.find(r => r.id === m.markId), lE = live.find(r => r.id === m.shilpaId);
    if (!lP || !lE) { console.log(`#${m.idx}: SKIP (row missing)`); continue; }
    const eAmt = +lE.amount_usd, markShare = Math.abs(+lP.amount_usd);
    const inheritSvc = !!m.inheritService;
    const ss = inheritSvc ? (lP.service_start || lE.service_start || lE.date) : (lE.service_start || lE.date);
    const se = inheritSvc ? (lP.service_end || lE.service_end || lE.date) : (lE.service_end || lE.date);
    const sd = svcDays(ss, se);
    const tag = (lP.tag || lE.tag || '').toLowerCase().trim();
    const cat = lP.category_id;
    const reimbAmt = m.reimbMode === 'full' ? -Math.round(eAmt * 100) / 100 : -(Math.round((eAmt - markShare) * 100) / 100);
    const reimbDaily = +(reimbAmt / sd).toFixed(6);
    const eDaily = +(eAmt / sd).toFixed(6);
    const existing = [lE.transaction_group_id, lP.transaction_group_id].filter(x => x != null);
    const groupId = existing.length ? Math.min(...existing, lE.id, lP.id) : Math.min(lE.id, lP.id);
    const newExpDesc = m.rename || lE.description;
    const suffix = m.reimbMode === 'full' ? 'Mark' : (m.n > 2 ? 'Split' : 'Mark');
    const reimbDesc = `Reimbursed - ${newExpDesc} - ${suffix}`;
    const snap = {
      batchId, idx: m.idx, groupId, expenseId: lE.id,
      expenseBefore: {
        description: lE.description, category_id: lE.category_id, tag: lE.tag,
        service_start: lE.service_start, service_end: lE.service_end,
        service_days: lE.service_days, daily_cost: lE.daily_cost, transaction_group_id: lE.transaction_group_id
      },
      markId: lP.id, markGroupBefore: lP.transaction_group_id, mergedGroups: existing.filter(g => g !== groupId)
    };
    for (const g of snap.mergedGroups) await runSQL(`update disciplan.transactions set transaction_group_id=${groupId} where transaction_group_id=${g}`);
    await runSQL(`update disciplan.transactions set description=${q(newExpDesc)}, category_id=${q(cat)}, tag=${q(tag)}, service_start=${q(ss)}, service_end=${q(se)}, service_days=${sd}, daily_cost=${eDaily}, transaction_group_id=${groupId}, updated_at=now() where id=${lE.id}`);
    await runSQL(`update disciplan.transactions set transaction_group_id=${groupId}, updated_at=now() where id=${lP.id}`);
    const ins = await runSQL(
      `insert into disciplan.transactions
        (date, service_start, service_end, description, category_id, original_amount, currency, fx_rate,
         amount_usd, payment_type, credit, tag, daily_cost, service_days, transaction_group_id, import_batch, owner, household_id)
       values
        (${q(lE.date)}, ${q(ss)}, ${q(se)}, ${q(reimbDesc)}, ${q(cat)}, ${reimbAmt}, 'USD', 1,
         ${reimbAmt}, 'Splitwise', '', ${q(tag)}, ${reimbDaily}, ${sd}, ${groupId}, ${q(batchId)}, 'shilpa', ${num(lE.household_id)})
       returning id`);
    snap.reimbId = ins[0]?.id;
    log.push(snap);
    console.log(`#${m.idx}: ok  expense ${lE.id} (${m.reimbMode}) tag ${tag || '-'}, reimb ${snap.reimbId} ${money(reimbAmt)}, group ${groupId}, Shilpa net ${money(+(eAmt + reimbAmt).toFixed(2))}`);
  }
  writeFileSync(APPLIED_FILE, JSON.stringify(log, null, 2));
  console.log(`\nDone. Batch ${batchId}. Undo: node scripts/reconcile-shilpa-splits.mjs undo ${batchId}`);
}

async function undo(batchId) {
  if (!existsSync(APPLIED_FILE)) { console.error('No applied log.'); process.exit(1); }
  const log = JSON.parse(readFileSync(APPLIED_FILE, 'utf8'));
  const rows = log.filter(r => r.batchId === batchId);
  if (!rows.length) { console.error(`No applied rows for batch ${batchId}.`); process.exit(1); }
  console.log(`Reverting ${rows.length} pair(s) from ${batchId}\n`);
  for (const r of rows) {
    if (r.reimbId) await runSQL(`delete from disciplan.transactions where id=${r.reimbId} and import_batch=${q(batchId)}`);
    const b = r.expenseBefore;
    await runSQL(
      `update disciplan.transactions set
         ${b.description !== undefined ? `description=${q(b.description)},` : ''}
         category_id=${q(b.category_id)}, tag=${q(b.tag)},
         service_start=${b.service_start ? q(b.service_start) : 'null'}, service_end=${b.service_end ? q(b.service_end) : 'null'},
         service_days=${num(b.service_days)}, daily_cost=${num(b.daily_cost)},
         transaction_group_id=${b.transaction_group_id == null ? 'null' : b.transaction_group_id}
       where id=${r.expenseId}`);
    await runSQL(`update disciplan.transactions set transaction_group_id=${r.markGroupBefore == null ? 'null' : r.markGroupBefore} where id=${r.markId}`);
    console.log(`#${r.idx}: reverted expense ${r.expenseId}, deleted reimb ${r.reimbId || '-'}`);
  }
  const remaining = log.filter(r => r.batchId !== batchId);
  writeFileSync(APPLIED_FILE, JSON.stringify(remaining, null, 2));
  console.log(`\nUndo complete for ${batchId}.`);
}

// ── Entry ──
const [, , mode, ...rest] = process.argv;
const flat = rest.join(' ').split(/[\s,]+/).filter(Boolean);
(async () => {
  try {
    if (mode === 'scan') await scan();
    else if (mode === 'show') show(Number(rest[0]) || 1);
    else if (mode === 'preview') await preview(flat);
    else if (mode === 'apply') await apply(flat);
    else if (mode === 'applyManual') await applyManual(flat);
    else if (mode === 'undo') await undo(rest[0]);
    else console.log('Usage: scan | show [batchNo] | preview <ids> | apply <ids> | applyManual <ids> | undo <batchId>');
  } catch (e) { console.error('Error:', e.message); process.exit(1); }
})();
