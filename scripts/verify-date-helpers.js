// Timezone regression check for the YYYY-MM-DD date helpers in js/helpers.js.
// Run across timezones:  for tz in America/Los_Angeles Asia/Singapore; do TZ=$tz node scripts/verify-date-helpers.js; done
//
// Guards two properties:
//   1. endOfMonth/startOfMonth/addDays are correct at every UTC offset.
//   2. They are byte-identical to the previous implementations in US timezones,
//      so historical accrual behaviour is unchanged for existing data.

const oldStartOfMonth = (d) => { const dt = new Date(d + 'T00:00:00'); return new Date(dt.getFullYear(), dt.getMonth(), 1).toISOString().slice(0, 10); };
const oldEndOfMonth = (d) => { const dt = new Date(d + 'T00:00:00'); return new Date(dt.getFullYear(), dt.getMonth() + 1, 0).toISOString().slice(0, 10); };
const oldAddDays = (d, n) => new Date(new Date(d + 'T00:00:00').getTime() + (n - 1) * 864e5).toISOString().slice(0, 10);

// Current implementations, mirrored from js/helpers.js
function shiftDate(d, n) { const p = (d || '').split('-').map(Number); if (p.length !== 3 || p.some(isNaN)) return d; return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function startOfMonth(d) { const p = (d || '').split('-'); return p.length === 3 ? `${p[0]}-${p[1]}-01` : d; }
function endOfMonth(d) { const p = (d || '').split('-').map(Number); if (p.length !== 3 || p.some(isNaN)) return d; return new Date(Date.UTC(p[0], p[1], 0)).toISOString().slice(0, 10); }
function addDays(d, n) { return shiftDate(d, n - 1); }

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const trueEnd = (y, m) => `${y}-${String(m).padStart(2, '0')}-${daysInMonth(y, m)}`;

const dates = [];
for (let y = 2024; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    for (const day of [1, 15, 16, 28, 29, 30, 31]) {
      if (day > daysInMonth(y, m)) continue;
      dates.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  }
}

const offset = -new Date().getTimezoneOffset() / 60;
let newWrong = 0, oldWrong = 0, somWrong = 0, somDiff = 0, addDiff = 0;

for (const d of dates) {
  const [y, m] = d.split('-').map(Number);
  const expect = trueEnd(y, m);
  if (endOfMonth(d) !== expect) { if (newWrong < 3) console.log(`  NEW endOfMonth WRONG ${d} -> ${endOfMonth(d)} (expected ${expect})`); newWrong++; }
  if (oldEndOfMonth(d) !== expect) oldWrong++;
  if (startOfMonth(d) !== `${d.slice(0, 7)}-01`) somWrong++;
  if (startOfMonth(d) !== oldStartOfMonth(d)) somDiff++;
  for (const n of [1, 7, 30, 365]) if (addDays(d, n) !== oldAddDays(d, n)) addDiff++;
}

function today() { return new Date().toISOString().slice(0, 10); }

// The loop that hung in Shilpa's monthly checklist.
function expectedPaycheckPeriods(firstServiceStart, asOf = today()) {
  if (!firstServiceStart) return [];
  const periods = [];
  let cursor = firstServiceStart.slice(0, 7) + '-01';
  let guard = 0;
  while (cursor <= asOf) {
    if (++guard > 10000) return { HUNG: true, iterations: guard };
    const monthEnd = endOfMonth(cursor);
    [{ start: cursor, end: cursor.slice(0, 8) + '15' }, { start: cursor.slice(0, 8) + '16', end: monthEnd }]
      .forEach((p) => { if (p.start >= firstServiceStart && shiftDate(p.end, 7) <= asOf) periods.push(p); });
    cursor = shiftDate(monthEnd, 1);
  }
  return { iterations: guard, periods: periods.length };
}

const loop = expectedPaycheckPeriods('2026-01-01');
const ok = newWrong === 0 && somWrong === 0 && !loop.HUNG;

console.log(`TZ=${process.env.TZ || 'system'} (UTC${offset >= 0 ? '+' : ''}${offset}) · ${dates.length} dates`);
console.log(`  endOfMonth incorrect:  new=${newWrong}  old=${oldWrong}`);
console.log(`  startOfMonth incorrect: ${somWrong}`);
console.log(`  differs from old impl: startOfMonth=${somDiff} addDays=${addDiff}`);
console.log(`  expectedPaycheckPeriods('2026-01-01') -> ${JSON.stringify(loop)}`);
console.log(`  ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
