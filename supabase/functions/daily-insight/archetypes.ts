// Per-archetype candidate builders.
// Each builder inspects pre-fetched Features and returns a Candidate with:
//   - eligible: whether archetype-specific data preconditions are met
//   - data_strength: [0..1] signal magnitude — used in scoring + min_quality_score gating
//   - facts: structured payload for the LLM narrative step
//   - summary: short human-readable diagnostic
//
// Adding a new archetype:
//   1. Add an entry to insight_strategy (migration) with sensible defaults.
//   2. Add a builder here and register it in ARCHETYPE_BUILDERS.
//   3. Cover any new data dependencies in buildFeatures (index.ts).

import type {
  Candidate,
  Features,
  Strategy,
  Transaction,
  MonthlyMap,
} from "./types.ts";

// Mark's parent-level monthly budget targets. Sourced from a static map because there's
// no DB table for budgets yet; if/when one is added, fold this into CategorySchema and
// query it alongside the parent rollup.
//
// IMPORTANT: parent IDs here MUST match expense parents in the categories table
// (parent_id IS NULL AND is_expense = true). Drift = silent miscount in budget_pace.
export const DEFAULT_BUDGET_TARGETS: Record<string, number> = {
  food: 800, groceries: 400, restaurant: 400,
  home: 2500, rent: 2250, furniture: 250,
  personal: 600, clothes: 300, tech: 300,
  transportation: 300, utilities: 150, health: 200,
  entertainment: 300, financial: 100, other: 200,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

// Compute parent-level totals for a given month using the runtime category schema.
// Pass features.schema.parentRollup so this stays in sync with the categories table.
function parentTotalsForMonth(
  expenses: MonthlyMap,
  mk: string,
  rollup: Record<string, string[]>,
): Record<string, number> {
  const monthMap = expenses[mk] || {};
  const out: Record<string, number> = {};
  for (const [parent, children] of Object.entries(rollup)) {
    const sum = children.reduce((s, c) => s + (monthMap[c] || 0), 0);
    if (sum > 0) out[parent] = sum;
  }
  return out;
}

function shiftMonth(mk: string, delta: number): string {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ineligible(insight_type: string, reason: string): Candidate {
  return {
    insight_type,
    eligible: false,
    ineligibility_reason: reason,
    data_strength: 0,
    facts: {},
    summary: `not eligible: ${reason}`,
  };
}

// ── Archetype: category_yoy ─────────────────────────────────────────────────

function buildCategoryYoy(features: Features, _strategy: Strategy): Candidate {
  const mk = features.monthKey;
  const rollup = features.schema.parentRollup;
  const thisYear = parentTotalsForMonth(features.expenses, mk, rollup);
  const lastYear = parentTotalsForMonth(features.expenses, shiftMonth(mk, -12), rollup);
  const twoYearsAgo = parentTotalsForMonth(features.expenses, shiftMonth(mk, -24), rollup);

  if (Object.keys(thisYear).length === 0) return ineligible("category_yoy", "no_current_month_data");
  if (Object.keys(lastYear).length === 0) return ineligible("category_yoy", "no_prior_year_data");

  // Pick top 1-2 categories with the largest YoY absolute change vs last year.
  const candidates = Object.keys(thisYear)
    .map(p => ({
      parent: p,
      current: thisYear[p],
      ly: lastYear[p] || 0,
      tya: twoYearsAgo[p] || 0,
      delta: thisYear[p] - (lastYear[p] || 0),
    }))
    .filter(x => Math.abs(x.delta) > 100)               // ignore tiny absolute changes per Mark's 2026-04-14 feedback
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2);

  if (candidates.length === 0) return ineligible("category_yoy", "no_meaningful_yoy_delta");

  const data_strength = Math.min(1, Math.abs(candidates[0].delta) / 500);

  return {
    insight_type: "category_yoy",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    facts: {
      month_key: mk,
      focus_categories: candidates,
      hint: "Lead with absolute dollars. Don't be dramatic about <$200 deltas. If a tag drove a prior-year spike (Features.tagSummaries), call it out.",
    },
    summary: `top YoY shift: ${candidates[0].parent} ${candidates[0].delta >= 0 ? "+" : ""}$${Math.round(candidates[0].delta)}`,
  };
}

// ── Archetype: budget_pace ──────────────────────────────────────────────────

function buildBudgetPace(features: Features, strategy: Strategy): Candidate {
  const mk = features.monthKey;
  const day = features.monthDay;
  const dayMin = (strategy.requires?.month_day_min as number | undefined) ?? 8;
  const dayMax = (strategy.requires?.month_day_max as number | undefined) ?? 24;
  if (day < dayMin || day > dayMax) return ineligible("budget_pace", `day_${day}_outside_${dayMin}_${dayMax}`);

  const parents = parentTotalsForMonth(features.expenses, mk, features.schema.parentRollup);
  if (Object.keys(parents).length === 0) return ineligible("budget_pace", "no_current_month_data");

  // Days in this month (UTC)
  const [y, m] = mk.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const fractionElapsed = day / daysInMonth;

  const rows = Object.entries(parents).map(([parent, sum]) => {
    const budget = features.schema.budgetTargets[parent] || 0;
    const expected = budget * fractionElapsed;
    return {
      parent,
      sum,
      budget,
      expected,
      pct_of_budget: budget > 0 ? sum / budget : null,
      pct_of_expected: expected > 0 ? sum / expected : null,
      projected_month_end: budget > 0 ? sum / Math.max(fractionElapsed, 0.05) : null,
    };
  }).filter(r => r.budget > 0);

  // Strongest signals: parents over expected pace (ratio > 1.15) and parents under (ratio < 0.7).
  const overPace = rows.filter(r => r.pct_of_expected != null && r.pct_of_expected > 1.15);
  const underPace = rows.filter(r => r.pct_of_expected != null && r.pct_of_expected < 0.7);
  const data_strength = Math.min(1, (overPace.length + underPace.length) / 4);

  return {
    insight_type: "budget_pace",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    facts: {
      month_key: mk,
      month_day: day,
      days_in_month: daysInMonth,
      fraction_elapsed: Number(fractionElapsed.toFixed(2)),
      categories: rows,
      over_pace: overPace,
      under_pace: underPace,
      hint: "Project month-end totals assuming fixed-cost categories (rent, health) hold flat. Include this projection in the write-up per Mark's 2026-04-17 feedback.",
    },
    summary: `${overPace.length} over pace, ${underPace.length} under pace, day ${day}/${daysInMonth}`,
  };
}

// ── Archetype: service_expiry ───────────────────────────────────────────────

function buildServiceExpiry(features: Features, strategy: Strategy): Candidate {
  const minExpiring = (strategy.requires?.min_expiring_30d as number | undefined) ?? 2;
  const expiring = features.expiring;
  if (expiring.length < minExpiring) return ineligible("service_expiry", `only_${expiring.length}_expiring`);

  const data_strength = Math.min(1, expiring.length / 8);
  return {
    insight_type: "service_expiry",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    facts: {
      expiring: expiring.slice(0, 12).map(t => ({
        description: t.description,
        amount_usd: t.amount_usd,
        service_start: t.service_start,
        service_end: t.service_end,
        daily_cost: t.daily_cost,
        category: t.category_id,
      })),
      hint: "Surface renewal decisions. Include daily cost and total. Useful monthly, not weekly.",
    },
    summary: `${expiring.length} services expiring in 30 days`,
  };
}

// ── Archetype: category_anomaly ─────────────────────────────────────────────
// 2× spike vs trailing 6-month average for any parent category.
// Phase 3 enhancement: when the parent has multiple child categories, surface the
// child breakdown so the LLM can explain "what drove the spike" — addresses
// Mark's 2026-04-26 feedback ("would be useful to know the breakdown within entertainment").

function buildCategoryAnomaly(features: Features, strategy: Strategy): Candidate {
  const mk = features.monthKey;
  const minZ = (strategy.requires?.min_zscore as number | undefined) ?? 2.0;
  const rollup = features.schema.parentRollup;

  const current = parentTotalsForMonth(features.expenses, mk, rollup);
  if (Object.keys(current).length === 0) return ineligible("category_anomaly", "no_current_month_data");

  const trailingMonths: string[] = [];
  for (let i = 1; i <= 6; i++) trailingMonths.push(shiftMonth(mk, -i));

  type ChildBreakdown = { child: string; current: number; trailing_mean: number; ratio: number | null };
  type SmartDrillDown = {
    method: "merchant" | "tag" | "description";
    rationale: string;
    items: Array<{ key: string; amount: number; share_of_parent: number; txn_count: number }>;
  };
  type Anomaly = {
    parent: string;
    current: number;
    mean: number;
    sd: number;
    ratio: number;
    z: number;
    child_breakdown?: ChildBreakdown[];
    drill_down?: SmartDrillDown;
  };
  const anomalies: Anomaly[] = [];

  for (const parent of Object.keys(current)) {
    const trail = trailingMonths.map(t => parentTotalsForMonth(features.expenses, t, rollup)[parent] || 0);
    const mean = trail.reduce((s, x) => s + x, 0) / trail.length;
    if (mean < 50) continue;
    const variance = trail.reduce((s, x) => s + (x - mean) ** 2, 0) / trail.length;
    const sd = Math.sqrt(variance);
    const ratio = current[parent] / mean;
    const z = sd > 0 ? (current[parent] - mean) / sd : 0;
    if (ratio >= 1.8 && z >= minZ) {
      const children = rollup[parent] || [parent];
      const breakdown = children.length > 1
        ? children.map(child => {
            const cur = features.expenses[mk]?.[child] || 0;
            const tmean = trailingMonths
              .map(t => features.expenses[t]?.[child] || 0)
              .reduce((s, x) => s + x, 0) / trailingMonths.length;
            const r = tmean > 0 ? cur / tmean : null;
            return { child, current: cur, trailing_mean: tmean, ratio: r };
          }).filter(x => x.current > 0 || x.trailing_mean > 0)
          : undefined;
      const drill_down = computeSmartDrillDown(features, parent);
      anomalies.push({ parent, current: current[parent], mean, sd, ratio, z, child_breakdown: breakdown, drill_down });
    }
  }

  if (anomalies.length === 0) return ineligible("category_anomaly", "no_2x_spike");
  anomalies.sort((a, b) => b.z - a.z);

  const data_strength = Math.min(1, anomalies[0].z / 4);
  return {
    insight_type: "category_anomaly",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    subject_key: `parent:${anomalies[0].parent}`,
    facts: {
      month_key: mk,
      anomalies,
      hint: "Only fire on real spikes. Discuss the top 1 anomaly. If a child_breakdown is provided, identify which child(ren) drove the spike. If a drill_down is provided, name the specific merchants/tags/transactions that account for the bulk of the spike — that's the actionable detail Mark wants (his 2026-04-26 feedback).",
    },
    summary: `${anomalies[0].parent} ${anomalies[0].ratio.toFixed(1)}× trailing 6mo avg`,
  };
}

// Smart-combo drill-down: when a parent category spikes this month, decide which
// rollup gives Mark the most actionable explanation. We try in order:
//   1. Merchant rollup (group by description) — wins if a single description
//      accounts for ≥50% of the spike-month parent total. Common case: a single
//      large vendor (concert ticket, hotel booking).
//   2. Tag rollup (group by tag) — wins if a single tag accounts for ≥40%.
//      Common case: a trip drove the spike (cozumel, japan).
//   3. Description top-N — fallback when no clear concentration. Surface the top
//      5 individual descriptions by amount so the LLM has something to point at.
// Concentration thresholds chosen so a 2/3-from-one-merchant case ranks merchant
// over tag, but a trip-tagged month still gets the trip rollup if no single
// merchant dominates.
function computeSmartDrillDown(
  features: Features,
  parent: string,
): { method: "merchant" | "tag" | "description"; rationale: string; items: Array<{ key: string; amount: number; share_of_parent: number; txn_count: number }> } | undefined {
  const children = features.schema.parentRollup[parent] || [parent];
  const childSet = new Set(children);
  const matching = features.currentMonthTxns.filter(t => childSet.has(t.category_id) && t.amount_usd > 0);
  if (matching.length === 0) return undefined;

  const parentTotal = matching.reduce((s, t) => s + t.amount_usd, 0);
  if (parentTotal <= 0) return undefined;

  function rollup<K extends string | null>(keyFn: (t: typeof matching[number]) => K): Map<string, { amount: number; txn_count: number }> {
    const m = new Map<string, { amount: number; txn_count: number }>();
    for (const t of matching) {
      const k = keyFn(t);
      if (k == null) continue;
      const cur = m.get(k) || { amount: 0, txn_count: 0 };
      cur.amount += t.amount_usd;
      cur.txn_count += 1;
      m.set(k, cur);
    }
    return m;
  }

  const byDescription = rollup(t => (t.description || "").trim() || null);
  const byTag         = rollup(t => (t.tag || "").trim() || null);

  function topN(m: Map<string, { amount: number; txn_count: number }>, n: number) {
    return Array.from(m.entries())
      .map(([key, v]) => ({ key, amount: v.amount, share_of_parent: v.amount / parentTotal, txn_count: v.txn_count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, n);
  }

  const topDesc = topN(byDescription, 5);
  const topTag  = topN(byTag, 5);

  const MERCHANT_THRESHOLD = 0.50;
  const TAG_THRESHOLD      = 0.40;

  if (topDesc.length > 0 && topDesc[0].share_of_parent >= MERCHANT_THRESHOLD) {
    return {
      method: "merchant",
      rationale: `single description "${topDesc[0].key}" = ${Math.round(topDesc[0].share_of_parent * 100)}% of ${parent} spend this month`,
      items: topDesc,
    };
  }
  if (topTag.length > 0 && topTag[0].share_of_parent >= TAG_THRESHOLD) {
    return {
      method: "tag",
      rationale: `tag "${topTag[0].key}" = ${Math.round(topTag[0].share_of_parent * 100)}% of ${parent} spend this month`,
      items: topTag,
    };
  }
  return {
    method: "description",
    rationale: `no single merchant or tag dominates; surfacing top descriptions by amount`,
    items: topDesc,
  };
}

// ── Archetype: large_transactions ───────────────────────────────────────────

function buildLargeTransactions(features: Features, strategy: Strategy): Candidate {
  const minGroups = (strategy.requires?.min_total_groups as number | undefined) ?? 3;
  const groups = groupLargeTxns(features.largeTxns);
  if (groups.length < minGroups) return ineligible("large_transactions", `only_${groups.length}_groups`);

  const data_strength = Math.min(1, groups.length / 8);
  return {
    insight_type: "large_transactions",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    facts: {
      window: "last_7_days",
      groups: groups.slice(0, 8),
      hint: "Always discuss net group amounts (transaction_group_id), never individual lines.",
    },
    summary: `${groups.length} groups, top: $${Math.round(Math.abs(groups[0].net))} ${groups[0].cat}`,
  };
}

function groupLargeTxns(txns: Transaction[]): Array<{ net: number; descs: string[]; cat: string; date: string; service_start: string | null; service_end: string | null }> {
  const groups: Record<string, { net: number; descs: string[]; cat: string; date: string; service_start: string | null; service_end: string | null }> = {};
  for (const t of txns) {
    if (Math.abs(t.amount_usd) < 50) continue;
    const key = t.transaction_group_id ? `g${t.transaction_group_id}` : `s${t.date}${t.description}`;
    if (!groups[key]) groups[key] = { net: 0, descs: [], cat: t.category_id, date: t.date, service_start: t.service_start, service_end: t.service_end };
    groups[key].net += t.amount_usd;
    if (t.description) groups[key].descs.push(t.description);
  }
  return Object.values(groups)
    .filter(g => Math.abs(g.net) >= 50)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

// ── Archetype: spend_projection ─────────────────────────────────────────────

function buildSpendProjection(features: Features, strategy: Strategy): Candidate {
  const mk = features.monthKey;
  const day = features.monthDay;
  const minDay = (strategy.requires?.month_day_min as number | undefined) ?? 5;
  if (day < minDay) return ineligible("spend_projection", `day_${day}_lt_${minDay}`);

  const parents = parentTotalsForMonth(features.expenses, mk, features.schema.parentRollup);
  const totalMtd = Object.values(parents).reduce((s, x) => s + x, 0);
  if (totalMtd < 200) return ineligible("spend_projection", "mtd_total_too_small");

  const [y, m] = mk.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const fraction = day / daysInMonth;
  const naiveProjection = totalMtd / fraction;

  const data_strength = Math.min(1, day / daysInMonth);
  return {
    insight_type: "spend_projection",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    facts: {
      month_key: mk,
      month_day: day,
      days_in_month: daysInMonth,
      mtd_total: totalMtd,
      naive_projection: naiveProjection,
      parents,
      hint: "A linear projection is naive. Adjust for fixed costs that already cleared (rent, subscriptions) — those don't scale.",
    },
    summary: `MTD $${Math.round(totalMtd)}, naive proj $${Math.round(naiveProjection)}`,
  };
}

// ── Archetype: subscription_creep ───────────────────────────────────────────
// Looks for category 'tech' or 'utilities' growing month-over-month for >= 4 months.

function buildSubscriptionCreep(features: Features, _strategy: Strategy): Candidate {
  const mk = features.monthKey;
  const months: string[] = [];
  for (let i = 0; i < 6; i++) months.push(shiftMonth(mk, -i));

  const techSeries = months.map(m => (features.expenses[m]?.tech || 0));
  const utilSeries = months.map(m => (features.expenses[m]?.utilities || 0));

  function isCreeping(series: number[]): boolean {
    let increases = 0;
    for (let i = 0; i < series.length - 1; i++) {
      if (series[i] > series[i + 1] && series[i] > 0) increases++;
    }
    return increases >= 4;
  }

  const techCreep = isCreeping(techSeries);
  const utilCreep = isCreeping(utilSeries);
  if (!techCreep && !utilCreep) return ineligible("subscription_creep", "no_consistent_creep");

  const series = techCreep ? techSeries : utilSeries;
  const subject = techCreep ? "tech" : "utilities";
  const data_strength = Math.min(1, (series[0] - series[series.length - 1]) / 100);

  return {
    insight_type: "subscription_creep",
    eligible: true,
    ineligibility_reason: null,
    data_strength: Math.max(0.1, data_strength),
    facts: {
      category: subject,
      months: months,
      series: series,
      hint: "Look for slow 12-month creep. Suggest specific subscriptions to audit if visible in service_periods.",
    },
    summary: `${subject} creep over ~6 months`,
  };
}

// ── Archetype: income_breakdown (Phase B rework: YTD YoY + 3Y CAGR) ─────────
// Mark's 2026-04-22 feedback flagged the previous "month-velocity" framing as
// noise — income posts biweekly + month-end so partial-month comparisons against
// trailing means are timing artifacts, not signal. The 2026-04-09 feedback
// asked for deeper YoY/CAGR analysis. This rework pivots to:
//   • YTD income through today's calendar day, current year + prior 2 years
//     (apples-to-apples regardless of pay schedule)
//   • 1-year delta % and 3-year CAGR
//   • Eligibility gates: at least 60 calendar days into the year, prior-year YTD
//     must be > 0 (so the YoY comparison is meaningful)
//
// Note: this still skips when YTD is essentially flat YoY (within ±3%) so we
// don't burn a slot on "income is exactly the same as last year" insights.

function buildIncomeBreakdown(features: Features, _strategy: Strategy): Candidate {
  const today = features.today;
  const [yyyy, mm, dd] = today.split("-");
  const cy = parseInt(yyyy, 10);
  const dayOfYear = Math.floor((Date.parse(today) - Date.parse(`${cy}-01-01`)) / 86_400_000) + 1;
  if (dayOfYear < 60) return ineligible("income_breakdown", `only_day_${dayOfYear}_of_year`);

  const ytd = features.ytdIncomeByYear || {};
  const cyYtd = ytd[String(cy)] ?? 0;
  const py1Ytd = ytd[String(cy - 1)] ?? 0;
  const py2Ytd = ytd[String(cy - 2)] ?? 0;

  if (cyYtd <= 0) return ineligible("income_breakdown", "no_current_year_ytd_income");
  if (py1Ytd <= 0) return ineligible("income_breakdown", "no_prior_year_ytd_income");

  const yoy_delta_abs = cyYtd - py1Ytd;
  const yoy_delta_pct = py1Ytd > 0 ? yoy_delta_abs / py1Ytd : 0;
  if (Math.abs(yoy_delta_pct) < 0.03) return ineligible("income_breakdown", "yoy_within_3pct_band");

  // CAGR over 3 years (cyYtd vs py2Ytd, 2 periods). Only compute if py2Ytd > 0.
  const cagr_3y_pct = py2Ytd > 0 ? Math.pow(cyYtd / py2Ytd, 1 / 2) - 1 : null;

  // data_strength: bigger YoY moves get more weight, but cap at 100% delta.
  const data_strength = Math.min(1, Math.abs(yoy_delta_pct));

  return {
    insight_type: "income_breakdown",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    facts: {
      today,
      day_of_year: dayOfYear,
      ytd_current_year: { year: cy, value: cyYtd, through: today },
      ytd_prior_year:   { year: cy - 1, value: py1Ytd, through: `${cy - 1}-${mm}-${dd}` },
      ytd_two_years_ago: { year: cy - 2, value: py2Ytd, through: py2Ytd > 0 ? `${cy - 2}-${mm}-${dd}` : null },
      yoy_delta_abs,
      yoy_delta_pct,
      cagr_3y_pct,
      hint: "Lead with YTD-vs-YTD (apples-to-apples through today's calendar day) — Mark explicitly disliked partial-month velocity comparisons. State the % delta plainly. If 3Y CAGR is available, mention it. Don't speculate on causes; just present the comparison.",
    },
    summary: `YTD ${(yoy_delta_pct >= 0 ? "+" : "")}${(yoy_delta_pct * 100).toFixed(1)}% YoY ($${Math.round(cyYtd).toLocaleString()} vs $${Math.round(py1Ytd).toLocaleString()})`,
  };
}

// ── Archetype: category_trend (Phase B rework: deep dive + recent exclusion) ─
// Old behavior: pick the steepest slope among parents over the last 6 months.
// Problem (Mark's 2026-04-22 feedback): "why only focus on health? Too many
// newsletters in a row" — the same parent kept winning week after week and the
// insight degenerated to one-line slope reporting.
//
// New behavior:
//   1. Compute slopes for every parent over the last 12 months (longer window
//      than 6 — short-term wobble was over-fitting to noise).
//   2. Exclude any parent already featured in a category_* insight within the
//      last 35 days (subject_key = "parent:<parent>"). Forces rotation.
//   3. Pick the parent with the strongest |slope|, but only if R² of the
//      regression is ≥ 0.35 — i.e. the trend is actually a trend, not a spike.
//   4. For the picked parent, compute child-level monthly series so the LLM
//      can render multiple charts (parent rollup + top 2-3 children).
//      Communicated via `chart_hint.multi_chart = true` — see InsightResponse.
//
// Goal: each fire teaches the user something *new* about *a different* parent,
// with enough child-level breakdown to answer "where is this coming from?".

// Parents that are NOT meaningful "spending categories" for trend analysis:
// - financial: credit-card bill payments, 401K transfers, etc. (transfers, not consumption)
// - other: catch-all bucket; trends here are uninformative
const TREND_EXCLUDED_PARENTS = new Set(["financial", "other"]);

function buildCategoryTrend(features: Features, strategy: Strategy): Candidate {
  const minMonths       = (strategy.requires?.min_months as number | undefined) ?? 6;
  const minSlope        = (strategy.requires?.min_slope as number | undefined) ?? 15;
  const minR2           = (strategy.requires?.min_r2 as number | undefined) ?? 0.10;
  const minRelStrength  = (strategy.requires?.min_relative_strength as number | undefined) ?? 0.15;
  const exclusionDays   = (strategy.requires?.recent_parent_exclusion_days as number | undefined) ?? 35;

  // Fit on 12 *complete* months only — drop the partial current month so mid-month
  // fixtures aren't biased by an incomplete bar (e.g. April 10 has only 10 days).
  // monthKey is the current (possibly partial) month, so we shift back 1 to start.
  const mk = features.monthKey;
  const completeMonths: string[] = [];
  for (let i = 1; i <= 12; i++) completeMonths.push(shiftMonth(mk, -i));
  completeMonths.reverse(); // chronological order

  const rollup = features.schema.parentRollup;

  // Build the recent-parent exclusion set from history.
  const todayMs = Date.parse(features.today);
  const cutoff  = new Date(todayMs - exclusionDays * 86_400_000).toISOString().slice(0, 10);
  const recentParents = new Set<string>();
  for (const h of features.history) {
    if (!h.subject_key || !h.subject_key.startsWith("parent:")) continue;
    if (h.created_at >= cutoff) recentParents.add(h.subject_key.slice("parent:".length));
  }

  type Cand = {
    parent: string;
    series: number[];
    slope: number;
    r2: number;
    nonZero: number;
    mean: number;
  };
  const cands: Cand[] = [];
  for (const parent of Object.keys(rollup)) {
    if (TREND_EXCLUDED_PARENTS.has(parent)) continue;
    const series = completeMonths.map(m => parentTotalsForMonth(features.expenses, m, rollup)[parent] || 0);
    const nonZero = series.filter(x => x > 0).length;
    if (nonZero < minMonths) continue;
    const { slope, r2 } = linearFit(series);
    const mean = series.reduce((s, x) => s + x, 0) / series.length;
    cands.push({ parent, series, slope, r2, nonZero, mean });
  }

  if (cands.length === 0) return ineligible("category_trend", "no_parents_with_enough_history");

  // Score each candidate by relative trend strength = |slope * 12| / mean monthly spend.
  // This is more robust than absolute slope because $30/mo means very different things
  // for utilities ($500 base) vs home ($4000 base).
  const eligible = cands
    .map(c => ({ ...c, relStrength: (Math.abs(c.slope) * 12) / Math.max(c.mean, 1) }))
    .filter(c =>
      Math.abs(c.slope) >= minSlope &&
      c.r2 >= minR2 &&
      c.relStrength >= minRelStrength &&
      !recentParents.has(c.parent),
    );
  if (eligible.length === 0) {
    const reason = recentParents.size > 0
      ? `all_strong_trends_recently_featured(${[...recentParents].join(",")})`
      : "no_strong_trend";
    return ineligible("category_trend", reason);
  }

  // Rank by combined score: relative_strength * sqrt(R²). This rewards both magnitude
  // of drift AND tightness of fit, so a noisy 50% drift loses to a clean 30% one.
  eligible.sort((a, b) => (b.relStrength * Math.sqrt(b.r2)) - (a.relStrength * Math.sqrt(a.r2)));
  const best = eligible[0];

  // For the chart, also fetch the partial current month so the visualisation can
  // optionally show "where we are in the current month" while the *fit* uses only
  // complete months. We expose both for the LLM/chart layer.
  const partialMonth = mk;
  const partialMonthValue = parentTotalsForMonth(features.expenses, partialMonth, rollup)[best.parent] || 0;

  // Build child-level series for the picked parent (over the same 12 complete months).
  const childIds = (rollup[best.parent] || []).filter(c => c !== best.parent);
  type ChildSeries = { child: string; series: number[]; total: number };
  const childSeries: ChildSeries[] = childIds.map(child => {
    const series = completeMonths.map(m => features.expenses[m]?.[child] || 0);
    const total = series.reduce((s, x) => s + x, 0);
    return { child, series, total };
  }).filter(c => c.total > 0);
  childSeries.sort((a, b) => b.total - a.total);
  const topChildren = childSeries.slice(0, 3); // up to 3 children

  // data_strength: combine relative drift with R²; capped at 1.
  const relStrength = best.relStrength;
  const data_strength = Math.min(1, relStrength * Math.max(0.5, best.r2 * 2));

  return {
    insight_type: "category_trend",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    subject_key: `parent:${best.parent}`,
    facts: {
      parent: best.parent,
      months: completeMonths,
      parent_series: best.series,
      slope_per_month: best.slope,
      r_squared: best.r2,
      mean_monthly: best.mean,
      relative_strength_pct: relStrength,
      direction: best.slope > 0 ? "rising" : "falling",
      partial_current_month: { month: partialMonth, value: partialMonthValue, note: "Excluded from regression fit; shown for chart context only." },
      top_children: topChildren.map(c => ({
        child: c.child,
        series: c.series,
        total_12mo: c.total,
        slope_per_month: linearFit(c.series).slope,
      })),
      recent_parents_excluded: [...recentParents],
      chart_hint: {
        multi_chart: topChildren.length >= 2,
        chart_count: 1 + Math.min(topChildren.length, 2),
      },
      hint: "Lead with the *parent* trend (12 complete months, line chart) — note R² is modest; this is monthly spending, not a stock chart. Then break down by top 2-3 children to show which sub-categories are driving it. If multi_chart=true, emit `chart_configs[]` with: [0] parent monthly line, [1] stacked-or-line of top children. Don't editorialise — show the data.",
    },
    summary: `${best.parent} ${best.slope > 0 ? "+" : ""}$${Math.round(best.slope)}/mo over 12mo (R²=${best.r2.toFixed(2)}, ${(relStrength * 100).toFixed(0)}% relative drift); excluded recent parents=${recentParents.size}`,
  };
}

// Linear least-squares fit. Returns slope per index step and R² of the fit.
function linearFit(y: number[]): { slope: number; r2: number } {
  const n = y.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const xs = Array.from({ length: n }, (_, i) => i);
  const xm = xs.reduce((s, x) => s + x, 0) / n;
  const ym = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xm) * (y[i] - ym);
    den += (xs[i] - xm) ** 2;
    ssTot += (y[i] - ym) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = ym - slope * xm;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yhat = slope * xs[i] + intercept;
    ssRes += (y[i] - yhat) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, r2 };
}

// ── Archetype: accrual_quality_alert (Phase 3, new) ─────────────────────────
// Surfaces real data-integrity bugs: orphaned groups (single-member groups),
// accrual mismatches, missing tags, and *recent* duplicate clusters.
// Old historical duplicates are noisy (e.g. 2017-2018 cleanup), so we only fire
// on issues that originated within the last 60 days unless the unaddressed
// orphan/mismatch backlog is non-empty.

function buildAccrualQualityAlert(features: Features, strategy: Strategy): Candidate {
  const hc = features.healthCheck;
  if (!hc) return ineligible("accrual_quality_alert", "no_health_check_data");

  const todayMs = Date.parse(features.today);
  const sixtyDaysAgoIso = new Date(todayMs - 60 * 86_400_000).toISOString().slice(0, 10);

  const recentDuplicates = (hc.duplicates || []).filter(d => d.date >= sixtyDaysAgoIso);
  const orphaned = (hc.orphaned_groups || []) as unknown[];
  const mismatches = (hc.accrual_mismatches || []) as unknown[];
  const missingTags = (hc.missing_tags || []) as unknown[];

  const minRecentDups   = (strategy.requires?.min_recent_duplicates as number | undefined) ?? 1;
  const minOrphaned     = (strategy.requires?.min_orphaned_groups as number | undefined) ?? 1;
  const minMismatches   = (strategy.requires?.min_accrual_mismatches as number | undefined) ?? 1;

  const fireOnRecentDups   = recentDuplicates.length >= minRecentDups;
  const fireOnOrphans      = orphaned.length >= minOrphaned;
  const fireOnMismatches   = mismatches.length >= minMismatches;
  if (!fireOnRecentDups && !fireOnOrphans && !fireOnMismatches) {
    return ineligible("accrual_quality_alert", "no_actionable_data_quality_issues");
  }

  const issueCount = recentDuplicates.length + orphaned.length + mismatches.length + missingTags.length;
  const data_strength = Math.min(1, issueCount / 10);

  return {
    insight_type: "accrual_quality_alert",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    facts: {
      recent_duplicates: recentDuplicates.slice(0, 6),
      orphaned_groups: orphaned.slice(0, 6),
      accrual_mismatches: mismatches.slice(0, 6),
      missing_tags: missingTags.slice(0, 6),
      cutoff_date: sixtyDaysAgoIso,
      hint: "This is a maintenance ping, not a financial insight. Lead with the count and call out the single most actionable item. Suggest where in the app Mark can fix it (transactions tab, group editor, tag editor).",
    },
    summary: `${recentDuplicates.length} recent dup clusters · ${orphaned.length} orphans · ${mismatches.length} accrual mismatches`,
  };
}

// ── Archetype: tag_recap (Phase B replacement for tag_burn_rate) ────────────
// Mark's 2026-04-27 feedback: active tags are mostly ongoing-cost lifestyle tags
// (pets, bf2025), so burn-rate framing is awkward. Instead, surface a fun
// rundown of a *completed* trip — total spend, daily burn, top-5 expenses, top
// spend days. We dedup via subject_key on insight_log so the same trip isn't
// recapped twice within the configured cooldown window.

function buildTagRecap(features: Features, strategy: Strategy): Candidate {
  const minTotalAccrual = (strategy.requires?.min_total_accrual as number | undefined) ?? 200;
  const minTxnCount     = (strategy.requires?.min_txn_count as number | undefined) ?? 5;
  const recapCooldown   = (strategy.requires?.recap_cooldown_days as number | undefined) ?? 90;
  const candidates = features.pastTagCandidates || [];
  if (candidates.length === 0) return ineligible("tag_recap", "no_past_tags_meeting_thresholds");

  // Tags recapped recently — gathered from insight_log.subject_key (history is
  // already filtered to non-dry-run rows in buildFeatures). Cutoff is rolling.
  const cutoffMs = Date.parse(features.today) - recapCooldown * 86_400_000;
  const recentlyRecapped = new Set<string>();
  for (const h of features.history || []) {
    if (h.insight_type !== "tag_recap") continue;
    if (!h.subject_key) continue;
    if (Date.parse(h.created_at) < cutoffMs) continue;
    if (h.subject_key.startsWith("tag:")) {
      recentlyRecapped.add(h.subject_key.slice(4));
    }
  }

  // Filter then weight: prefer recently-completed (sweet spot 30-180d since end)
  // and trips with rich data (more txns + higher spend).
  const eligible = candidates
    .filter(c => c.total_spend >= minTotalAccrual && c.txn_count >= minTxnCount)
    .filter(c => !recentlyRecapped.has(c.name));
  if (eligible.length === 0) return ineligible("tag_recap", "all_eligible_tags_recently_recapped");

  function recencyWeight(daysSince: number): number {
    if (daysSince < 30) return 0;            // belt-and-suspenders; fetcher already excludes
    if (daysSince <= 180) return 1.0;
    if (daysSince <= 365) return 0.8;
    return 0.5;
  }

  // Anniversary boost — Mark's 2026-04-27 feedback: surface trips on/near their
  // anniversary as a "one year ago today / two years ago today" recap. Window is
  // ±10 days off the integer-year mark; closer = stronger boost. Capped at 3y back
  // because beyond that the nostalgia ROI falls off (and trips >1110d ago are
  // already excluded by fetchPastTagCandidates).
  //
  // The boost overrides recencyWeight (so a 2y trip on its exact anniversary
  // doesn't get hit by the 0.5x "old trip" decay — the anniversary IS the
  // recency signal we want to surface).
  function anniversaryInfo(daysSince: number): { years: number; offsetDays: number; weightMultiplier: number } | null {
    for (const yr of [1, 2, 3]) {
      const target = yr * 365;
      const offset = Math.abs(daysSince - target);
      if (offset <= 10) {
        // Multiplier: 2.5x at exact anniversary, decays linearly to 1.5x at offset 10.
        const mult = 1.5 + (1.0 * (1 - offset / 10));
        return { years: yr, offsetDays: daysSince - target, weightMultiplier: mult };
      }
    }
    return null;
  }

  const scored = eligible.map(c => {
    const spendFactor = Math.min(1, c.total_spend / 2000);
    const txnFactor   = Math.min(1, c.txn_count / 20);
    const baseWeight  = recencyWeight(c.days_since_end) * spendFactor * txnFactor;
    const anniversary = anniversaryInfo(c.days_since_end);
    // For anniversary candidates: skip the recency decay (since the anniversary
    // is itself the recency signal) and multiply spend×txn factor by the boost.
    const weight = anniversary
      ? Math.max(baseWeight, spendFactor * txnFactor * anniversary.weightMultiplier)
      : baseWeight;
    return { cand: c, weight, anniversary };
  });
  scored.sort((a, b) => b.weight - a.weight);
  const topRow = scored[0];
  const top = topRow.cand;

  // data_strength: anniversary recaps get max strength because the anniversary
  // is itself the value (the LLM has a date hook to anchor the narrative on),
  // independent of how big the trip was. Non-anniversary recaps scale by spend
  // richness so the bandit's quality gate doesn't fire on $200 micro-trips.
  const data_strength = topRow.anniversary
    ? 1.0
    : Math.min(1, top.total_spend / 3000);
  const subject_key = `tag:${top.name}`;
  return {
    insight_type: "tag_recap",
    eligible: true,
    ineligibility_reason: null,
    data_strength,
    subject_key,
    facts: {
      tag: top,
      anniversary: topRow.anniversary
        ? { years_ago: topRow.anniversary.years, offset_days: topRow.anniversary.offsetDays }
        : null,
      other_eligible: scored.slice(1, 4).map(s => ({
        name: s.cand.name,
        days_since_end: s.cand.days_since_end,
        total_spend: s.cand.total_spend,
        anniversary_years: s.anniversary?.years ?? null,
      })),
      hint: topRow.anniversary
        ? `THIS IS AN ANNIVERSARY RECAP — the trip ended almost exactly ${topRow.anniversary.years} year${topRow.anniversary.years === 1 ? "" : "s"} ago (offset ${topRow.anniversary.offsetDays >= 0 ? "+" : ""}${topRow.anniversary.offsetDays} days). Lead with the anniversary framing ("one year ago today...", "two years ago this week..."), then the trip name, total spend, daily burn. Pull out 1-2 standout transactions from top_txns (use the description verbatim). Tone: warm nostalgia, no budget critique. Don't editorialise on whether the spend was 'good' or 'bad' — that's Mark's call.`
        : `Frame as a fun retrospective, not a budget critique. Lead with the trip name, dates, total spend, daily burn. Pull out 1-2 standout transactions from top_txns (use the description verbatim — it's evocative). Mention top spend days if they cluster on something meaningful (arrival, big dinner, etc.). Keep the tone curious and warm. Don't editorialise on whether the spend was 'good' or 'bad' — that's Mark's call.`,
    },
    summary: topRow.anniversary
      ? `${top.name} ${topRow.anniversary.years}y anniversary recap: $${Math.round(top.total_spend)} over ${top.duration_days}d`
      : `${top.name} recap: $${Math.round(top.total_spend)} over ${top.duration_days}d (ended ${top.days_since_end}d ago)`,
  };
}

// ── Registry ────────────────────────────────────────────────────────────────

export type ArchetypeBuilder = (features: Features, strategy: Strategy) => Candidate;

export const ARCHETYPE_BUILDERS: Record<string, ArchetypeBuilder> = {
  category_yoy:           buildCategoryYoy,
  budget_pace:            buildBudgetPace,
  service_expiry:         buildServiceExpiry,
  category_anomaly:       buildCategoryAnomaly,
  large_transactions:     buildLargeTransactions,
  spend_projection:       buildSpendProjection,
  subscription_creep:     buildSubscriptionCreep,
  income_breakdown:       buildIncomeBreakdown,
  category_trend:         buildCategoryTrend,
  accrual_quality_alert:  buildAccrualQualityAlert,
  // tag_burn_rate replaced by tag_recap in Phase B (2026-04-27).
  tag_recap:              buildTagRecap,
};

export function buildCandidates(features: Features, strategies: Map<string, Strategy>): Candidate[] {
  const out: Candidate[] = [];
  for (const [type, builder] of Object.entries(ARCHETYPE_BUILDERS)) {
    const strategy = strategies.get(type);
    if (!strategy) continue;                  // not in strategy table — skip silently
    if (!strategy.enabled) {
      out.push({
        insight_type: type,
        eligible: false,
        ineligibility_reason: "strategy_disabled",
        data_strength: 0,
        facts: {},
        summary: "disabled in insight_strategy",
      });
      continue;
    }
    try {
      out.push(builder(features, strategy));
    } catch (e) {
      console.error(`Archetype builder ${type} threw:`, e);
      out.push({
        insight_type: type,
        eligible: false,
        ineligibility_reason: `builder_error_${(e as Error).message?.slice(0, 60)}`,
        data_strength: 0,
        facts: {},
        summary: "builder error",
      });
    }
  }
  return out;
}
