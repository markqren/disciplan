// Shared types for the daily-insight pipeline.
// Imported by index.ts, archetypes.ts, and selection.ts.

export type MonthlyMap = Record<string, Record<string, number>>; // month → category → accrual

export interface Transaction {
  date: string;
  category_id: string;
  amount_usd: number;
  daily_cost: number | null;
  service_start: string | null;
  service_end: string | null;
  service_days?: number | null;
  description?: string;
  transaction_group_id?: number | null;
}

export interface InsightLogRow {
  id?: number;
  insight_type: string;
  subject: string;
  created_at: string;
  feedback_rating: number | null;
  feedback_comment: string | null;
  // Structured identity for archetype-level dedup. Conventions:
  //   tag_recap     → "tag:<tag_name>"
  //   category_*    → "parent:<parent_id>"   (used by category_trend recent-parent exclusion)
  // Null for archetypes that don't gate on identity.
  subject_key?: string | null;
}

export interface InsightContextRow {
  id: string;
  content: string;
}

export interface ISRow {
  month: string;
  category_id: string;
  parent_id: string | null;
  category_label: string;
  amount: number;
}

// One row from public.insight_strategy.
export interface Strategy {
  insight_type: string;
  enabled: boolean;
  cooldown_days: number;
  monthly_target: number | null;
  monthly_max: number | null;
  priority_weight: number;
  min_quality_score: number;
  requires: Record<string, unknown>;
  sent_count: number;
  rated_count: number;
  rating_sum: number;
  rating_sumsq: number;
  last_used_at: string | null;
  last_rated_at: string | null;
  last_skip_reason: string | null;
}

// Schema sourced from the public.categories table at runtime so the newsletter
// stays in sync when categories are added/renamed (see also js/constants.js for
// the frontend equivalent — drift here is a real bug, not a preference).
export interface CategorySchema {
  // Set of category_id strings that count as expenses (excludes income, investment, adjustment).
  expenseCategoryIds: Set<string>;
  // parent_id (top-level expense parent, parent_id IS NULL) → ordered list of [parent, ...children].
  // The parent itself is always the first entry so direct charges to the parent are counted too.
  parentRollup: Record<string, string[]>;
  // Mark's monthly budget targets, currently parent-level only. Sourced from a hardcoded map
  // (no DB table for budgets yet) — populated by buildCategorySchema for convenience.
  budgetTargets: Record<string, number>;
}

// Pre-fetched data the candidate engine consumes to evaluate every archetype.
// Each archetype's builder reads only the fields it cares about.
export interface Features {
  today: string;            // ISO date "2026-04-27"
  monthDay: number;         // 1-31, derived from today (UTC)
  monthKey: string;         // "2026-04"
  schema: CategorySchema;   // dynamic from `categories` table — never use module-level rollups
  expenses: MonthlyMap;
  income: Record<string, number>;
  // Phase B income_breakdown rework: YTD income through today's calendar day for
  // current year and prior 2 years. Apples-to-apples comparison; null entry means
  // no transactions for that year (year-old enough that no comparison is possible).
  ytdIncomeByYear: Record<string, number>;
  largeTxns: Transaction[];
  expiring: Transaction[];
  // Phase B category_anomaly drill-down: every txn dated within current calendar
  // month, restricted to expense categories. Used to pick merchant/tag/description
  // rollup for the spike-driver narrative when a parent anomaly fires.
  currentMonthTxns: TxnDetail[];
  history: InsightLogRow[];
  healthCheck: HealthCheckResult | null;
  activeTags: TagRow[];
  tagSummaries: TagSummary[];
  // Phase B tag_recap: completed tags eligible for recap (end_date < today - 30 days,
  // total spend ≥ threshold, txn_count ≥ threshold). Includes top-5 transactions
  // pre-fetched so the archetype builder doesn't need DB access.
  pastTagCandidates: PastTagCandidate[];
}

// A transaction detail with the extra fields we need for drill-downs (description,
// payment_type, tag). Distinct from `Transaction` only so we can keep `Transaction`
// minimal for the existing large-txn / expiring archetypes.
export interface TxnDetail {
  id: number;
  date: string;
  description: string;
  category_id: string;
  amount_usd: number;
  payment_type: string | null;
  tag: string | null;
}

// One eligible past tag for tag_recap, with pre-computed totals + top-5 txns.
export interface PastTagCandidate {
  name: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  days_since_end: number;
  tag_type: string | null;
  total_spend: number;
  txn_count: number;
  category_totals: Record<string, number>;        // {restaurant: 234.55, transportation: 100.00, ...}
  daily_burn: number;
  top_txns: Array<{ date: string; description: string; amount_usd: number; category_id: string }>;
  top_spend_days: Array<{ date: string; total: number; txn_count: number }>;
}

export interface HealthCheckResult {
  duplicates: Array<{ date: string; description: string; payment_type: string; amount_usd: number; count: number }>;
  missing_tags: unknown[];
  orphaned_groups: unknown[];
  accrual_mismatches: unknown[];
}

export interface TagRow {
  name: string;
  start_date: string;
  end_date: string | null;
  tag_type: string | null;
}

export interface TagSummary {
  tag_name: string;
  total_accrual: number;
  txn_count: number;
  category_totals: Record<string, number> | null;
}

// A candidate is one archetype evaluated against the current features.
// `facts` is the structured payload the LLM will consume — keep it tight and self-explanatory.
export interface Candidate {
  insight_type: string;
  eligible: boolean;            // archetype's data preconditions are met
  ineligibility_reason: string | null;
  data_strength: number;        // [0, 1] — how rich the signal is right now
  facts: Record<string, unknown>;
  summary: string;              // short human-readable summary for logging / diagnostics
  // Optional structured identity used for archetype-level dedup (see InsightLogRow.subject_key).
  // Not used for scoring; purely a write-time hint for what to persist on insight_log.
  subject_key?: string | null;
}

// A scored candidate also carries the deterministic score and the policy-gate decision.
export interface ScoredCandidate extends Candidate {
  passes_policy_gate: boolean;
  policy_gate_reason: string | null;
  score: number;
  score_components: {
    priority_weight: number;
    rating_signal: number;       // (avg_rating - 5)/5, clipped to [-1, 1]; 0 if unrated
    recency_penalty: number;     // 0..1, higher = more recently used
    data_strength: number;       // [0, 1]
  };
}

// Final output returned by the pipeline before email send.
//
// The LLM may emit either a single `chart_config` (most archetypes) OR an array
// `chart_configs` (currently only category_trend's deep-dive multi-chart). When
// both are present, `chart_configs` wins. The email renderer expands each chart
// to its own quickchart.io URL.
export interface InsightResponse {
  insight_type: string;
  subject: string;
  key_stat: string;
  key_stat_context: string;
  write_up: string;
  chart_config?: object;
  chart_configs?: object[];
}
