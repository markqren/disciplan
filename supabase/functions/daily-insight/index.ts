// FEA-11: Daily AI Finance Insight Newsletter
// Hybrid pipeline:
//   1. Idempotency guard (avoid duplicate sends on cron retry)
//   2. Fetch features (IS data, large txns, expiring services, tags, health check, history)
//   3. Run archetype builders → Candidate[]   (see archetypes.ts)
//   4. Policy gate + score + epsilon-greedy → ScoredCandidate (see selection.ts)
//   5. Ask Claude to write the narrative + chart for THAT chosen archetype only
//   6. Send via Postmark, log to insight_log + insight_selection_log
//
// Required secrets (supabase secrets set):
//   ANTHROPIC_API_KEY        — Claude API key
//   POSTMARK_SERVER_TOKEN    — Postmark server API token
//   POSTMARK_FROM_EMAIL      — Verified sender address
//   SUPABASE_URL             — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase
//   CRON_SECRET              — shared secret passed by pg_cron; reject other callers
//
// Optional secrets / query params (Phase 6 — fixture replay):
//   INSIGHT_DRY_RUN=1        — When set, skip Postmark send, skip strategy aggregate
//                              updates, and write rows with insight_log.dry_run=true.
//                              Multiple dry-runs per day are allowed.
//   ?fixture=YYYY-MM-DD      — Override "today" with a historical date. Only honored
//                              when INSIGHT_DRY_RUN=1. Must be ≤ real today.
//
// Cron setup (Supabase dashboard → Database → Cron Jobs):
//   Schedule: 0 15 * * *  (8am PT = 15:00 UTC, adjust for DST)
//   POST    https://<ref>.supabase.co/functions/v1/daily-insight
//   Header  X-Cron-Secret: <CRON_SECRET>

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import type {
  Candidate,
  CategorySchema,
  Features,
  HealthCheckResult,
  ISRow,
  InsightContextRow,
  InsightLogRow,
  InsightResponse,
  MonthlyMap,
  PastTagCandidate,
  ScoredCandidate,
  Strategy,
  TagRow,
  TagSummary,
  Transaction,
  TxnDetail,
} from "./types.ts";
import { DEFAULT_BUDGET_TARGETS, buildCandidates } from "./archetypes.ts";
import {
  DEFAULT_POLICY_PARAMS,
  POLICY_NAME,
  selectCandidate,
  tallyMonthlySent,
} from "./selection.ts";

const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY")!;
const POSTMARK_TOKEN  = Deno.env.get("POSTMARK_SERVER_TOKEN")!;
const POSTMARK_FROM   = Deno.env.get("POSTMARK_FROM_EMAIL")!;
const SB_URL          = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET     = Deno.env.get("CRON_SECRET");
const DRY_RUN_GLOBAL  = (Deno.env.get("INSIGHT_DRY_RUN") || "").trim() === "1";

const FIXTURE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TO_EMAIL    = "mark@disciplan.dev";
const REPLY_TO    = "8e70a9e284a1705b967239e049a59b65@inbound.postmarkapp.com";
const APP_URL     = "https://disciplan.netlify.app";
const MODEL       = "claude-sonnet-4-6";

// Pricing per million tokens (Sonnet 4.6)
const COST_INPUT  = 3.0;
const COST_OUTPUT = 15.0;

// ── Category schema (loaded from public.categories at request time) ─────────
// Hardcoded category lists are a known foot-gun: when Mark added 'accommodation'
// and 'games' as children of 'entertainment' (2026-03-15), the previous static
// EXPENSE_CATS set silently ignored both, under-reporting trip-heavy months by
// ~$13k of accommodation. This loader is the single source of truth — anything
// that needs to know the parent/child shape goes through here.

interface CategoryRow {
  id: string;
  parent_id: string | null;
  is_expense: boolean;
}

const NON_EXPENSE_IDS = new Set(["income", "investment", "adjustment"]);

async function fetchCategorySchema(supabase: SupabaseClient): Promise<CategorySchema> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, parent_id, is_expense");
  if (error) {
    console.error("fetchCategorySchema error — falling back to empty schema:", error);
    return { expenseCategoryIds: new Set(), parentRollup: {}, budgetTargets: { ...DEFAULT_BUDGET_TARGETS } };
  }

  const rows = (data || []) as CategoryRow[];
  const expenseCategoryIds = new Set<string>();
  const parentRollup: Record<string, string[]> = {};

  for (const r of rows) {
    if (!r.is_expense) continue;
    if (NON_EXPENSE_IDS.has(r.id)) continue;
    expenseCategoryIds.add(r.id);
  }

  for (const r of rows) {
    if (!r.is_expense || NON_EXPENSE_IDS.has(r.id)) continue;
    if (r.parent_id == null) {
      if (!parentRollup[r.id]) parentRollup[r.id] = [r.id];
    }
  }
  for (const r of rows) {
    if (!r.is_expense || NON_EXPENSE_IDS.has(r.id)) continue;
    if (r.parent_id != null && parentRollup[r.parent_id]) {
      parentRollup[r.parent_id].push(r.id);
    }
  }

  return { expenseCategoryIds, parentRollup, budgetTargets: { ...DEFAULT_BUDGET_TARGETS } };
}

// ── Build monthly maps from IS RPC rows ─────────────────────────────────────
function buildMonthlyMaps(
  rows: ISRow[],
  schema: CategorySchema,
): { expenses: MonthlyMap; income: Record<string, number>; unknownCategoryIds: Set<string> } {
  const expenses: MonthlyMap = {};
  const income: Record<string, number> = {};
  const unknownCategoryIds = new Set<string>();
  for (const r of rows) {
    const mk = r.month.slice(0, 7);
    const amt = Number(r.amount) || 0;
    if (r.category_id === "income") {
      income[mk] = (income[mk] || 0) + Math.abs(amt);
      continue;
    }
    if (NON_EXPENSE_IDS.has(r.category_id)) continue;            // investment, adjustment
    if (!schema.expenseCategoryIds.has(r.category_id)) {
      unknownCategoryIds.add(r.category_id);                     // surfaced via console.warn below
      continue;
    }
    if (amt > 0) {
      if (!expenses[mk]) expenses[mk] = {};
      expenses[mk][r.category_id] = (expenses[mk][r.category_id] || 0) + amt;
    }
  }
  return { expenses, income, unknownCategoryIds };
}

// ── Feature fetcher: every data source the candidate engine might need ─────
async function buildFeatures(supabase: SupabaseClient, today: string): Promise<{ features: Features; history: InsightLogRow[]; principles: string }> {
  const monthDay = parseInt(today.slice(8, 10), 10);
  const monthKey = today.slice(0, 7);

  // Principles (single row)
  const { data: contextRows } = await supabase
    .from("insight_context")
    .select("content")
    .eq("id", "principles")
    .limit(1);
  const principles: string = (contextRows as InsightContextRow[] | null)?.[0]?.content || "No foundational principles yet.";

  // History (last 30 real sends — used for monthly count tally and prompt context).
  // Dry-run rows are excluded so fixture replays don't burn through monthly_max
  // budgets or pollute the "recent insight history" snippet sent to Claude.
  // For fixture replays we *also* exclude insights that were sent AFTER the fixture
  // date — otherwise replaying an old date would falsely see "future" insights as
  // already-used and trip cooldown / monthly_max gates.
  // subject_key is loaded for archetype-level dedup (tag_recap, category_trend).
  const fixtureCutoffIso = `${today}T23:59:59.999Z`;
  const { data: historyRaw } = await supabase
    .from("insight_log")
    .select("id, insight_type, subject, created_at, feedback_rating, feedback_comment, subject_key")
    .eq("dry_run", false)
    .lte("created_at", fixtureCutoffIso)
    .order("created_at", { ascending: false })
    .limit(30);
  const history = (historyRaw || []) as InsightLogRow[];

  // Category schema MUST be loaded before buildMonthlyMaps so we know which IDs
  // count as expenses (instead of relying on a stale hardcoded list).
  const schema = await fetchCategorySchema(supabase);

  // Income statement RPC for current + previous 2 years (3 calls in parallel)
  const currentYear = parseInt(today.slice(0, 4), 10);
  const isResults = await Promise.all(
    [currentYear, currentYear - 1, currentYear - 2].map(y =>
      supabase.rpc("get_income_statement", { p_year: y })
    )
  );
  const allISRows: ISRow[] = isResults.flatMap(r => (r.data || []) as ISRow[]);
  const { expenses, income, unknownCategoryIds } = buildMonthlyMaps(allISRows, schema);
  if (unknownCategoryIds.size > 0) {
    // Surface drift between transactions and the categories table loudly so we catch
    // future schema additions before they silently drop spend out of aggregates.
    console.warn(
      `[schema-audit] transactions reference category_id values not present in public.categories: ${[...unknownCategoryIds].sort().join(", ")} — newsletter aggregates will EXCLUDE these. Add them to public.categories or rename the transactions.`
    );
  }

  // Large transactions in last 7 days
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const { data: largeTxns } = await supabase
    .from("transactions")
    .select("date,description,amount_usd,category_id,transaction_group_id,service_start,service_end")
    .gte("date", sevenDaysAgo.toISOString().slice(0, 10))
    .not("category_id", "in", "(income,investment,adjustment)")
    .order("amount_usd", { ascending: false });

  // Service periods expiring in next 30 days
  const thirtyDaysOut = new Date(today);
  thirtyDaysOut.setUTCDate(thirtyDaysOut.getUTCDate() + 30);
  const { data: expiring } = await supabase
    .from("transactions")
    .select("description,amount_usd,service_start,service_end,service_days,category_id,daily_cost")
    .gte("service_end", today)
    .lte("service_end", thirtyDaysOut.toISOString().slice(0, 10))
    .not("category_id", "in", "(income,investment,adjustment)")
    .gt("service_days", 1)
    .order("service_end", { ascending: true })
    .limit(20);

  // Tags currently active (overlap with today)
  const { data: activeTags } = await supabase
    .from("tags")
    .select("name,start_date,end_date,tag_type")
    .lte("start_date", today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order("start_date", { ascending: true });

  // Tag summaries (RPC) for active and recent tags
  const { data: tagSummaries } = await supabase.rpc("get_tag_summaries");

  // Data health check (RPC) — used by accrual_quality_alert in Phase 3
  const { data: healthRaw } = await supabase.rpc("run_data_health_check");
  const healthCheck = (healthRaw && typeof healthRaw === "object")
    ? (healthRaw as HealthCheckResult)
    : null;

  // Phase B: current-month txn detail for category_anomaly drill-down.
  // We only need expense-side fields. Using `today` (which may be a fixture date)
  // ensures dry-runs against historical dates see the right month-to-date slice.
  const monthStart = `${monthKey}-01`;
  const { data: currentMonthTxnsRaw } = await supabase
    .from("transactions")
    .select("id,date,description,category_id,amount_usd,payment_type,tag")
    .gte("date", monthStart)
    .lte("date", today)
    .not("category_id", "in", "(income,investment,adjustment)")
    .order("amount_usd", { ascending: false })
    .limit(500);
  const currentMonthTxns = (currentMonthTxnsRaw || []) as TxnDetail[];

  // Phase B: YTD income series for income_breakdown YoY+CAGR rework. Compares
  // this year's YTD income through `today` against the same calendar-day range
  // for prior years — apples-to-apples regardless of biweekly/month-end timing.
  const ytdIncomeByYear = await fetchYtdIncome(supabase, today);

  // Phase B: past-tag candidates for tag_recap. Filters by trip-style criteria
  // and pre-computes top-5 txns + top-3 spend days per candidate so the archetype
  // builder doesn't need DB access. Caps at the most-recently-completed 12 to
  // bound query cost (each tag adds ~1 query).
  const pastTagCandidates = await fetchPastTagCandidates(supabase, today);

  const features: Features = {
    today,
    monthDay,
    monthKey,
    schema,
    expenses,
    income,
    ytdIncomeByYear,
    largeTxns: (largeTxns || []) as Transaction[],
    expiring: (expiring || []) as Transaction[],
    currentMonthTxns,
    history,
    healthCheck,
    activeTags: (activeTags || []) as TagRow[],
    tagSummaries: (tagSummaries || []) as TagSummary[],
    pastTagCandidates,
  };
  return { features, history, principles };
}

// ── Phase B helpers ──────────────────────────────────────────────────────────

// YTD income for current and prior 2 years, through today's calendar day. Income
// rows live in transactions (category_id='income') with negative amounts (per
// accounting convention), so we abs() the sum for downstream display.
async function fetchYtdIncome(supabase: SupabaseClient, today: string): Promise<Record<string, number>> {
  const [yyyy, mm, dd] = today.split("-");
  const currentYear = parseInt(yyyy, 10);
  const out: Record<string, number> = {};
  const queries = [currentYear, currentYear - 1, currentYear - 2].map(async (y) => {
    const yearStart = `${y}-01-01`;
    const yearTodayEquiv = `${y}-${mm}-${dd}`;
    const { data, error } = await supabase
      .from("transactions")
      .select("amount_usd")
      .eq("category_id", "income")
      .gte("date", yearStart)
      .lte("date", yearTodayEquiv);
    if (error) {
      console.error(`fetchYtdIncome ${y} error:`, error);
      return [String(y), 0] as [string, number];
    }
    const total = (data || []).reduce((s, r) => s + Math.abs(Number(r.amount_usd) || 0), 0);
    return [String(y), total] as [string, number];
  });
  const results = await Promise.all(queries);
  for (const [yr, tot] of results) out[yr] = tot;
  return out;
}

// Past-tag candidates for tag_recap. Joins `tags` to `get_tag_summaries()` and
// filters to trip-style completed tags with sufficient spend + recency window.
// Then enriches the most-recent 12 with top-5 txns and top-3 spend days.
async function fetchPastTagCandidates(supabase: SupabaseClient, today: string): Promise<PastTagCandidate[]> {
  const todayMs = Date.parse(today);
  const minDaysSinceEnd = 30;     // need emotional distance — too-recent trips aren't nostalgia yet
  const maxDaysSinceEnd = 1110;   // ~3yr — wide enough that 1y/2y/3y anniversaries are reachable;
                                  // beyond that nostalgia ROI tapers off (and most data is in pre-2024 chaos)
  const minTotalSpend  = 200;
  const minTxnCount    = 5;

  const { data: tagsRaw, error: tagsErr } = await supabase
    .from("tags")
    .select("name,start_date,end_date,tag_type")
    .not("end_date", "is", null);
  if (tagsErr) {
    console.error("fetchPastTagCandidates tags error:", tagsErr);
    return [];
  }
  const { data: summariesRaw } = await supabase.rpc("get_tag_summaries");
  const summaries = new Map<string, { total: number; txn_count: number; categories: Record<string, number> | null }>();
  for (const s of (summariesRaw || []) as Array<{ tag_name: string; total_accrual: number; txn_count: number; category_totals: Record<string, number> | null }>) {
    summaries.set(s.tag_name, { total: Number(s.total_accrual) || 0, txn_count: Number(s.txn_count) || 0, categories: s.category_totals });
  }

  // First pass: filter to eligible tags by metadata only.
  type Eligible = {
    name: string;
    start_date: string;
    end_date: string;
    days_since_end: number;
    duration_days: number;
    tag_type: string | null;
    total_spend: number;
    txn_count: number;
    category_totals: Record<string, number>;
    daily_burn: number;
  };
  const eligible: Eligible[] = [];
  for (const t of (tagsRaw || []) as TagRow[]) {
    if (!t.end_date) continue;
    const endMs = Date.parse(t.end_date);
    const startMs = Date.parse(t.start_date);
    if (Number.isNaN(endMs) || Number.isNaN(startMs)) continue;
    const days_since_end = Math.round((todayMs - endMs) / 86_400_000);
    if (days_since_end < minDaysSinceEnd || days_since_end > maxDaysSinceEnd) continue;
    const duration_days = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
    const sum = summaries.get(t.name);
    if (!sum || sum.total < minTotalSpend || sum.txn_count < minTxnCount) continue;
    const daily_burn = sum.total / duration_days;
    eligible.push({
      name: t.name,
      start_date: t.start_date,
      end_date: t.end_date,
      days_since_end,
      duration_days,
      tag_type: t.tag_type,
      total_spend: sum.total,
      txn_count: sum.txn_count,
      category_totals: sum.categories || {},
      daily_burn,
    });
  }

  // Cap eligible tags at ~12 to keep DB fan-out bounded. Two-pass selection so
  // the cap doesn't silently exclude anniversary candidates: always retain trips
  // within ±10 days of an integer-year anniversary (1y/2y/3y), then fill the
  // remaining slots with the most-recently-completed trips.
  eligible.sort((a, b) => Date.parse(b.end_date) - Date.parse(a.end_date));
  const ANNIV_TARGETS = [365, 730, 1095];
  const ANNIV_WINDOW = 10;
  const isAnniversary = (e: Eligible) => ANNIV_TARGETS.some(t => Math.abs(e.days_since_end - t) <= ANNIV_WINDOW);
  const anniv = eligible.filter(isAnniversary);
  const recent = eligible.filter(e => !isAnniversary(e));
  const RECENT_BUDGET = Math.max(0, 12 - anniv.length);
  const trimmed = [...anniv, ...recent.slice(0, RECENT_BUDGET)];
  if (trimmed.length === 0) return [];

  // Top txns + spend days, in parallel per tag.
  const enriched = await Promise.all(trimmed.map(async (e) => {
    const [{ data: topRaw }, { data: dayRaw }] = await Promise.all([
      supabase
        .from("transactions")
        .select("date,description,amount_usd,category_id")
        .eq("tag", e.name)
        .gt("amount_usd", 0)
        .order("amount_usd", { ascending: false })
        .limit(5),
      supabase
        .from("transactions")
        .select("date,amount_usd")
        .eq("tag", e.name)
        .gt("amount_usd", 0),
    ]);
    const top_txns = ((topRaw || []) as Array<{ date: string; description: string; amount_usd: number; category_id: string }>)
      .map(r => ({ date: r.date, description: r.description || "", amount_usd: Number(r.amount_usd) || 0, category_id: r.category_id }));

    // Aggregate per-day in JS (simpler than another RPC); skip the negative-amount
    // refunds the .gt() filter already excluded.
    const dayMap = new Map<string, { total: number; count: number }>();
    for (const r of (dayRaw || []) as Array<{ date: string; amount_usd: number }>) {
      const d = r.date;
      const cur = dayMap.get(d) || { total: 0, count: 0 };
      cur.total += Number(r.amount_usd) || 0;
      cur.count += 1;
      dayMap.set(d, cur);
    }
    const top_spend_days = Array.from(dayMap.entries())
      .map(([date, v]) => ({ date, total: v.total, txn_count: v.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    return { ...e, top_txns, top_spend_days };
  }));

  return enriched;
}

async function fetchStrategies(supabase: SupabaseClient): Promise<Map<string, Strategy>> {
  const { data, error } = await supabase
    .from("insight_strategy")
    .select("*");
  if (error) {
    console.error("fetchStrategies error:", error);
    return new Map();
  }
  const map = new Map<string, Strategy>();
  for (const row of (data || []) as Strategy[]) {
    // Coerce numeric defaults so policy gate logic doesn't crash on null fields.
    const r: Strategy = {
      ...row,
      cooldown_days:     row.cooldown_days ?? 0,
      priority_weight:   row.priority_weight ?? 1.0,
      min_quality_score: row.min_quality_score ?? 0,
      sent_count:        row.sent_count ?? 0,
      rated_count:       row.rated_count ?? 0,
      rating_sum:        row.rating_sum ?? 0,
      rating_sumsq:      row.rating_sumsq ?? 0,
      requires:          (row.requires as Record<string, unknown> | null) ?? {},
    };
    map.set(row.insight_type, r);
  }
  return map;
}

// ── LLM prompt: the LLM only writes the narrative + chart for the chosen archetype.
function buildArchetypePrompt(today: string, principles: string, history: InsightLogRow[], selected: ScoredCandidate): string {
  const recentTypes = history.slice(0, 7).map(h => `${h.created_at.slice(0, 10)}: ${h.insight_type}${h.feedback_rating != null ? ` (rated ${h.feedback_rating}/10)` : ""}`).join("\n");
  const recentFeedback = history
    .filter(h => h.feedback_rating != null && h.feedback_comment)
    .slice(0, 6)
    .map(h => `${h.created_at.slice(0, 10)} [${h.insight_type} ${h.feedback_rating}/10]: "${h.feedback_comment}"`)
    .join("\n");

  return `You are writing a daily personal-finance newsletter for Mark, who tracks 12,000+ transactions on an accrual basis since 2017 (now in 2026).

TODAY: ${today}
INSIGHT TYPE TO WRITE (chosen by selector — do NOT change this): ${selected.insight_type}

## FOUNDATIONAL PRINCIPLES (follow these):
${principles}

## RECENT INSIGHT HISTORY (for tone/variety, not type choice):
${recentTypes || "none"}

## RECENT FEEDBACK COMMENTS:
${recentFeedback || "none"}

## STRUCTURED FACTS (your only source of numbers — do not invent):
${JSON.stringify(selected.facts, null, 2)}

## WRITING INSTRUCTIONS:
1. Write a tight 2-3 sentence narrative. Lead with a specific dollar number from the facts above.
2. Don't be dramatic about absolute deltas under $200. Don't editorialise small swings.
3. Use parent categories (food, home, personal, etc.) for summaries; only drill into children when relevant.
4. Produce a Chart.js 4.x config (max 24 data points per dataset). Colors: #81B29A (positive/green), #E07A5F (over-budget/red), #4A6FA5 (neutral/blue), #F2CC8F (income/yellow). Background transparent.

## ARCHETYPE-SPECIFIC GUIDANCE:
- tag_recap → This is a *historical trip recap*, written in past tense ("you spent...", "the trip ran..."). Use the days_since_end to anchor when the trip happened. Lead with total spend or daily burn. Surface 1-2 specific top transactions for color (use facts.top_txns). Tone: nostalgic and observational, not analytical. NO recommendations.
- category_anomaly → If facts.anomalies[0].drill_down is present, lead with the drill-down's rationale (e.g. "single merchant Whole Foods drove 60% of the spike"). The drill_down.method tells you whether to credit a merchant, tag, or set of descriptions. If drill_down is absent, fall back to the child_breakdown.
- category_trend → When facts.chart_hint.multi_chart is true, you MUST emit "chart_configs" (array of TWO charts, NOT a single chart_config) — this is the deep-dive that justifies firing this insight type. Required structure:
    [0] LINE chart of the parent's 12-month series (facts.parent_series with facts.months as labels). Title: "<Parent> · 12mo Trend".
    [1] STACKED BAR chart of facts.top_children — one dataset per child, stacked, using facts.months as x-axis. Title: "<Parent> by Subcategory". This shows WHICH sub-categories are driving the parent trend.
  The narrative MUST call out which top_child(ren) are driving the trend (look at top_children[*].slope_per_month vs total_12mo to identify the driver). State the R² (facts.r_squared) only if it's notably high (≥0.7) — otherwise describe the trend qualitatively.
- income_breakdown → Lead with "$X YTD vs $Y same-time-last-year (Z%)". Mention 3Y CAGR (facts.cagr_3y_pct) if non-null. Do NOT speculate on causes — just present the comparison cleanly. Chart should be a bar chart of the 3 YTD values.

## CHART CONTRACT (single vs multi):
- If you emit "chart_config" (object): one chart will be rendered.
- If you emit "chart_configs" (array of objects): each becomes its own chart, stacked vertically. Use this for archetype-specific deep-dives that genuinely need 2+ charts (per the guidance above). Don't pad — single chart is the default.

Return ONLY a single valid JSON object — no markdown, no prose around it:
{
  "insight_type": "${selected.insight_type}",
  "subject": "Disciplan Insight — <short title> · ${today}",
  "key_stat": "<one compelling number, e.g. '$2,847' or '−12%'>",
  "key_stat_context": "<short phrase, e.g. 'spent in April (83% of budget)'>",
  "write_up": "<2-3 sentences>",
  "chart_config": {<valid Chart.js 4.x config>}        // OR "chart_configs": [{...}, {...}]
}`;
}

// ── Email HTML ────────────────────────────────────────────────────────────────
function buildEmail(r: InsightResponse, chartUrls: string[], costLine: string): string {
  // Multi-chart support: each URL becomes its own <img> stacked vertically.
  // Single-chart insights still pass a 1-element array, so the rendering stays uniform.
  const chartRows = chartUrls.map((url, idx) => `
  <tr>
    <td style="padding:${idx === 0 ? "0" : "10px"} 28px 0">
      <img src="${url}" width="504" style="display:block;border-radius:6px;max-width:100%" alt="Chart ${idx + 1}">
    </td>
  </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');</style>
</head>
<body style="margin:0;padding:20px;background:#f0f0f0;font-family:'Outfit','Helvetica Neue',Arial,sans-serif">
<table width="560" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1)">
  <tr>
    <td style="background:#0a0a14;padding:20px 28px">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.03em;font-family:'Outfit','Helvetica Neue',Arial,sans-serif">the disciplan</span>
      <span style="color:#81B29A;font-size:11px;font-family:'JetBrains Mono',monospace;margin-left:10px;letter-spacing:0.05em">DAILY INSIGHT</span>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 28px 0;color:#999999;font-size:12px;font-family:monospace">${r.subject.split(' · ').pop() || ''}</td>
  </tr>
  <tr>
    <td style="padding:16px 28px">
      <div style="background:#f8f9fa;border-left:3px solid #81B29A;border-radius:0 6px 6px 0;padding:14px 18px">
        <div style="font-size:30px;font-weight:700;font-family:monospace;color:#0a0a14;letter-spacing:-0.02em">${r.key_stat}</div>
        <div style="font-size:13px;color:#666666;margin-top:5px">${r.key_stat_context}</div>
      </div>
    </td>
  </tr>${chartRows}
  <tr>
    <td style="padding:18px 28px;font-size:14px;color:#333333;line-height:1.65">
      ${r.write_up}
    </td>
  </tr>
  <tr>
    <td style="padding:4px 28px 24px;text-align:center">
      <a href="${APP_URL}" style="display:inline-block;background:#81B29A;color:#ffffff;padding:11px 28px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.01em">Open Disciplan →</a>
    </td>
  </tr>
  <tr>
    <td style="background:#f8f9fa;padding:16px 28px;border-top:1px solid #eeeeee">
      <p style="font-size:12px;color:#888888;margin:0 0 6px">Reply with a rating (e.g. <strong>8/10</strong>) and any comments to improve future insights.</p>
      <p style="font-size:10px;color:#bbbbbb;margin:0;font-family:monospace">${costLine}</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ── Deterministic email fallback ────────────────────────────────────────────
// Used when no archetype is eligible OR Claude JSON parse fails twice.
// Always factually correct against the IS data we already have.
function buildFallbackInsight(
  today: string,
  expenses: MonthlyMap,
  income: Record<string, number>,
  schema: CategorySchema,
): InsightResponse {
  const mk = today.slice(0, 7);
  const monthMap = expenses[mk] || {};
  const parents = Object.keys(schema.parentRollup);
  const parentTotals = parents
    .map(p => ({
      p,
      sum: schema.parentRollup[p].reduce((s, c) => s + (monthMap[c] || 0), 0),
      budget: schema.budgetTargets[p] || 0,
    }))
    .filter(x => x.sum > 0)
    .sort((a, b) => b.sum - a.sum);

  const totalSpend = parentTotals.reduce((s, x) => s + x.sum, 0);
  const totalIncome = income[mk] || 0;
  const monthLabel = new Date(mk + "-01").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const writeUp = parentTotals.length
    ? `Through ${today}, total ${monthLabel} spend is $${Math.round(totalSpend).toLocaleString()} across ${parentTotals.length} parent categories. Top driver: ${parentTotals[0].p} at $${Math.round(parentTotals[0].sum).toLocaleString()}${parentTotals[0].budget ? ` (${Math.round(100 * parentTotals[0].sum / parentTotals[0].budget)}% of $${parentTotals[0].budget} budget)` : ""}. Income recorded so far: $${Math.round(totalIncome).toLocaleString()}.`
    : `Limited data to summarise for ${monthLabel} as of ${today}.`;

  return {
    insight_type: "parse_fallback",
    subject: `Disciplan Insight — ${monthLabel} Summary (fallback) · ${today}`,
    key_stat: `$${Math.round(totalSpend).toLocaleString()}`,
    key_stat_context: `total ${monthLabel} spend through ${today}`,
    write_up: writeUp,
    chart_config: {
      type: "bar",
      data: {
        labels: parentTotals.slice(0, 8).map(x => x.p),
        datasets: [{
          label: monthLabel,
          data: parentTotals.slice(0, 8).map(x => Math.round(x.sum)),
          backgroundColor: "#4A6FA5",
        }],
      },
      options: { plugins: { legend: { display: false } } },
    },
  };
}

function tryParseInsight(text: string): InsightResponse | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]) as InsightResponse;
  } catch {
    return null;
  }
}

// Compact summary of the candidate set for insight_selection_log.candidates JSONB.
function summarizeCandidatesForLog(scored: ScoredCandidate[], selected: ScoredCandidate): unknown[] {
  return scored.map(s => ({
    insight_type: s.insight_type,
    eligible: s.eligible,
    passed_gate: s.passes_policy_gate,
    score: Number(s.score.toFixed(4)),
    components: {
      pw: Number(s.score_components.priority_weight.toFixed(3)),
      rs: Number(s.score_components.rating_signal.toFixed(3)),
      rp: Number(s.score_components.recency_penalty.toFixed(3)),
      ds: Number(s.score_components.data_strength.toFixed(3)),
    },
    reason: s.policy_gate_reason || s.ineligibility_reason || null,
    summary: s.summary,
    selected: s.insight_type === selected.insight_type,
  }));
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Validate cron secret
  const cronHeader = req.headers.get("X-Cron-Secret");
  if (CRON_SECRET && cronHeader !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const realToday = new Date().toISOString().slice(0, 10);

  // ── Parse dry-run / fixture controls ──────────────────────────────────────
  // Per-request `?dry_run=1` only takes effect when CRON_SECRET is configured
  // (the auth check above already gates that). The global env flag short-circuits
  // any production send unconditionally — leave INSIGHT_DRY_RUN unset in prod.
  const url = new URL(req.url);
  const dryRunQuery = (url.searchParams.get("dry_run") || "").trim() === "1";
  const dryRun = DRY_RUN_GLOBAL || dryRunQuery;

  const fixtureRaw = url.searchParams.get("fixture");
  if (fixtureRaw && !dryRun) {
    return new Response(JSON.stringify({ error: "fixture_requires_dry_run" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (fixtureRaw && !FIXTURE_DATE_RE.test(fixtureRaw)) {
    return new Response(JSON.stringify({ error: "fixture_must_be_YYYY-MM-DD" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (fixtureRaw && fixtureRaw > realToday) {
    return new Response(JSON.stringify({ error: "fixture_must_not_be_in_future" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const today = fixtureRaw || realToday;
  if (dryRun) console.log(`Dry-run mode (today=${today}${fixtureRaw ? `, fixture=${fixtureRaw}` : ""}); Postmark + strategy aggregates will be skipped.`);

  const supabase = createClient(SB_URL, SB_SERVICE_KEY);

  // ── 0. Idempotency guard ──────────────────────────────────────────────────
  // Dry-runs are explicitly allowed to repeat; we only short-circuit on real sends.
  if (!dryRun) {
    const { data: existingToday } = await supabase
      .from("insight_log")
      .select("id, insight_type, subject")
      .gte("created_at", `${today}T00:00:00Z`)
      .lte("created_at", `${today}T23:59:59Z`)
      .eq("dry_run", false)
      .order("created_at", { ascending: false })
      .limit(1);
    if (existingToday && existingToday.length > 0) {
      const row = existingToday[0];
      console.log(`Idempotency short-circuit: insight already sent today (id=${row.id}, type=${row.insight_type})`);
      return new Response(JSON.stringify({
        status: "already_sent_today",
        insight_log_id: row.id,
        insight_type: row.insight_type,
        subject: row.subject,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }

  // ── 1. Fetch features and strategies in parallel ──────────────────────────
  const [{ features, history, principles }, strategies] = await Promise.all([
    buildFeatures(supabase, today),
    fetchStrategies(supabase),
  ]);

  if (strategies.size === 0) {
    console.warn("insight_strategy is empty — returning fallback email.");
  }

  // For fixture replays: derive each strategy's last_used_at from the (already
  // fixture-cutoff-filtered) history rather than the column value. This avoids
  // false cooldown blocks when replaying historical dates whose "future" insights
  // would otherwise look like they've already happened.
  const lastUsedFromHistory = new Map<string, string>();
  for (const h of history) {
    if (!lastUsedFromHistory.has(h.insight_type)) {
      lastUsedFromHistory.set(h.insight_type, h.created_at);
    }
  }
  for (const [type, strategy] of strategies) {
    const histLast = lastUsedFromHistory.get(type);
    if (histLast) {
      strategy.last_used_at = histLast;
    } else {
      strategy.last_used_at = null;
    }
  }

  // ── 2. Build candidates ───────────────────────────────────────────────────
  const candidates: Candidate[] = strategies.size > 0
    ? buildCandidates(features, strategies)
    : [];

  // ── 3. Select via policy gate + scoring + epsilon-greedy ──────────────────
  const monthlySent = tallyMonthlySent(today, history.map(h => ({ insight_type: h.insight_type, created_at: h.created_at })));
  const selection = candidates.length
    ? selectCandidate(candidates, strategies, today, monthlySent)
    : null;

  let chosen: ScoredCandidate | null = selection?.selected ?? null;
  let parseFallback = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let insight: InsightResponse | null = null;

  if (chosen) {
    // ── 4. Ask Claude to write the narrative + chart for the chosen archetype.
    const prompt = buildArchetypePrompt(today, principles, history, chosen);
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (claudeRes.ok) {
      const claudeData = await claudeRes.json();
      const rawText: string = claudeData.content?.[0]?.text || "";
      inputTokens  += claudeData.usage?.input_tokens  || 0;
      outputTokens += claudeData.usage?.output_tokens || 0;
      insight = tryParseInsight(rawText);

      if (!insight) {
        console.warn("First parse failed; retrying with stricter JSON-only reminder.");
        const retryRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1200,
            messages: [
              { role: "user", content: prompt },
              { role: "assistant", content: rawText || "{}" },
              { role: "user", content: "Your previous reply could not be parsed as JSON. Resend the same insight as a SINGLE valid JSON object only. No prose, no markdown fences. Begin with { and end with }." },
            ],
          }),
        });
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          inputTokens  += retryData.usage?.input_tokens  || 0;
          outputTokens += retryData.usage?.output_tokens || 0;
          insight = tryParseInsight(retryData.content?.[0]?.text || "");
        } else {
          console.error("Retry HTTP error:", retryRes.status, await retryRes.text());
        }
      }
    } else {
      console.error("Claude HTTP error:", claudeRes.status, await claudeRes.text());
    }

    // Force the insight_type to match what the selector chose — Claude is not allowed to override.
    if (insight) insight.insight_type = chosen.insight_type;
  }

  if (!insight) {
    console.error(chosen
      ? "Both Claude attempts failed to parse — using deterministic fallback."
      : "No eligible candidate — using deterministic fallback.");
    insight = buildFallbackInsight(today, features.expenses, features.income, features.schema);
    parseFallback = true;
  }

  const costUsd = (inputTokens * COST_INPUT + outputTokens * COST_OUTPUT) / 1_000_000;
  const costLine = parseFallback
    ? `Fallback insight (no eligible archetype or LLM JSON parse failed). API cost ~$${costUsd.toFixed(4)}.`
    : `This insight cost ~$${costUsd.toFixed(4)} to generate (${(inputTokens/1000).toFixed(1)}k input / ${(outputTokens/1000).toFixed(1)}k output tokens · ${MODEL})`;

  // ── 5. Build chart URL(s) ─────────────────────────────────────────────────
  // Most archetypes emit a single `chart_config`. category_trend's deep-dive can
  // emit `chart_configs[]` (parent line + child breakdown). When both are present
  // chart_configs wins. Each config is uploaded to QuickChart separately so we
  // get one URL per chart in the email.
  const FALLBACK_CHART = "https://quickchart.io/chart?c=%7B%22type%22%3A%22bar%22%2C%22data%22%3A%7B%22labels%22%3A%5B%5D%2C%22datasets%22%3A%5B%5D%7D%7D&w=504&h=260&bkg=white";

  function isValidChartCfg(cfg: unknown): cfg is Record<string, unknown> {
    if (!cfg || typeof cfg !== "object") return false;
    const c = cfg as Record<string, unknown>;
    return typeof c.type === "string" && c.data != null;
  }

  async function uploadChart(cfg: object): Promise<string> {
    try {
      const qcRes = await fetch("https://quickchart.io/chart/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chart: cfg, width: 504, height: 260, backgroundColor: "white" }),
      });
      if (!qcRes.ok) {
        console.error("QuickChart HTTP error:", qcRes.status, await qcRes.text());
        return "";
      }
      const qcData = await qcRes.json();
      return qcData.url || "";
    } catch (e) {
      console.error("QuickChart error:", e);
      return "";
    }
  }

  const rawConfigs: unknown[] = Array.isArray(insight.chart_configs) && insight.chart_configs.length > 0
    ? insight.chart_configs
    : (insight.chart_config ? [insight.chart_config] : []);
  const validConfigs = rawConfigs.filter(isValidChartCfg) as object[];

  let chartUrls: string[] = [];
  if (validConfigs.length > 0) {
    chartUrls = await Promise.all(validConfigs.map(uploadChart));
    chartUrls = chartUrls.filter(u => u.length > 0);
  } else {
    console.warn("No valid chart_config(s) — falling back to placeholder image.");
  }
  if (chartUrls.length === 0) chartUrls = [FALLBACK_CHART];

  // ── 6. Send via Postmark (skipped in dry-run) ─────────────────────────────
  const html = buildEmail(insight, chartUrls, costLine);
  let postmarkMessageId = "";
  if (!dryRun) {
    const pmRes = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": POSTMARK_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From:    POSTMARK_FROM,
        To:      TO_EMAIL,
        ReplyTo: REPLY_TO,
        Subject: insight.subject,
        HtmlBody: html,
        TextBody: `${insight.key_stat} — ${insight.key_stat_context}\n\n${insight.write_up}\n\nOpen Disciplan: ${APP_URL}\n\n---\nReply with a rating (e.g. 8/10) and comments.\n${costLine}`,
        MessageStream: "outbound",
      }),
    });

    if (!pmRes.ok) {
      console.error("Postmark error:", await pmRes.text());
      return new Response("Postmark send error", { status: 500 });
    }
    const pmData = await pmRes.json();
    postmarkMessageId = pmData.MessageID || "";
  }

  // ── 7. Log insight + selection trace ──────────────────────────────────────
  // subject_key (when the chosen candidate set one) is critical for archetype-level
  // dedup — tag_recap uses it to skip recapping the same trip within 90 days, and
  // category_trend/category_anomaly use it to enforce recent-parent exclusion. If
  // we forget to write it here, those rotations silently break.
  const { data: logRow } = await supabase
    .from("insight_log")
    .insert({
      insight_type:        insight.insight_type,
      subject:             insight.subject,
      subject_key:         chosen?.subject_key ?? null,
      html_body:           html,
      model_used:          MODEL,
      postmark_message_id: postmarkMessageId,
      input_tokens:        inputTokens,
      output_tokens:       outputTokens,
      cost_usd:            costUsd,
      parse_fallback:      parseFallback,
      dry_run:             dryRun,
    })
    .select("id")
    .single();
  const logId = logRow?.id;

  if (logId && selection && chosen) {
    await supabase.from("insight_selection_log").insert({
      insight_log_id:    logId,
      candidates:        summarizeCandidatesForLog(selection.scored, selection.selected),
      policy:            POLICY_NAME,
      policy_params:     selection.policy_params,
      exploration_taken: selection.exploration_taken,
      selected_type:     chosen.insight_type,
    });

    // Strategy aggregate updates only happen for real sends — dry-runs must not
    // pollute the bandit's last_used_at, sent_count, or skip-reason history.
    if (!dryRun) {
      await supabase
        .from("insight_strategy")
        .update({
          sent_count:       (strategies.get(chosen.insight_type)?.sent_count ?? 0) + 1,
          last_used_at:     new Date().toISOString(),
          last_skip_reason: null,
          updated_at:       new Date().toISOString(),
        })
        .eq("insight_type", chosen.insight_type);

      const skipUpdates = selection.scored
        .filter(s => !s.passes_policy_gate && s.insight_type !== chosen.insight_type)
        .map(s => ({ type: s.insight_type, reason: s.policy_gate_reason || s.ineligibility_reason || "skipped" }));
      for (const u of skipUpdates) {
        await supabase
          .from("insight_strategy")
          .update({ last_skip_reason: u.reason, updated_at: new Date().toISOString() })
          .eq("insight_type", u.type);
      }
    }
  }

  console.log(`${dryRun ? "Dry-run" : "Sent"} insight: ${insight.insight_type} | ${insight.subject} | cost: $${costUsd.toFixed(4)}${parseFallback ? " | parse_fallback=true" : ""}${selection?.exploration_taken ? " | exploration=true" : ""}`);

  return new Response(JSON.stringify({
    status: dryRun ? "dry_run" : "sent",
    today,
    fixture: fixtureRaw || null,
    dry_run: dryRun,
    insight_type: insight.insight_type,
    subject: insight.subject,
    key_stat: insight.key_stat,
    key_stat_context: insight.key_stat_context,
    write_up: insight.write_up,
    cost_usd: costUsd,
    parse_fallback: parseFallback,
    exploration_taken: selection?.exploration_taken ?? false,
    eligible_count: selection?.scored.filter(s => s.passes_policy_gate).length ?? 0,
    insight_log_id: logId ?? null,
    postmark_message_id: postmarkMessageId,
    html_preview_url: dryRun && logId ? `${SB_URL}/rest/v1/insight_log?id=eq.${logId}&select=html_body` : null,
    // Dry-run only: expose per-candidate diagnostics so we can see *why* archetypes
    // were ruled ineligible without needing console-log access.
    candidates_trace: dryRun ? candidates.map(c => ({
      type: c.insight_type,
      eligible: c.eligible,
      reason: c.ineligibility_reason,
      data_strength: c.data_strength,
      summary: c.summary,
    })) : undefined,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
});
