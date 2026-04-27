// Policy gating, scoring, and stochastic selection over Candidates.
// All randomness lives here so it can be unit-tested by injecting a deterministic rng.

import type { Candidate, ScoredCandidate, Strategy } from "./types.ts";

export const POLICY_NAME = "epsilon_greedy_v1";
export const DEFAULT_POLICY_PARAMS = {
  epsilon: 0.15,                // exploration probability — see Opus 4.7 review notes for rationale
  recency_half_life_days: 6,    // how fast recency penalty decays
  rating_weight: 0.3,           // contribution of normalized feedback rating to score
  recency_weight: 0.5,          // contribution of recency penalty to score (subtracted)
  data_strength_weight: 0.2,    // contribution of data_strength to score
  rating_floor_unrated: 6.5,    // unrated archetypes are treated as "average minus a hair" so they're not over-explored
};

export interface PolicyParams {
  epsilon: number;
  recency_half_life_days: number;
  rating_weight: number;
  recency_weight: number;
  data_strength_weight: number;
  rating_floor_unrated: number;
}

export interface SelectionResult {
  selected: ScoredCandidate;
  exploration_taken: boolean;
  scored: ScoredCandidate[];
  policy_params: PolicyParams;
}

function daysBetween(aIso: string, bIso: string | null): number {
  if (!bIso) return Number.POSITIVE_INFINITY;
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

function monthlyCount(today: string, sentDates: string[]): number {
  const mk = today.slice(0, 7);
  return sentDates.filter(d => d.startsWith(mk)).length;
}

export interface PolicyGateInput {
  today: string;
  this_month_sent_count: Record<string, number>;
}

export function passesPolicyGate(
  candidate: Candidate,
  strategy: Strategy,
  input: PolicyGateInput,
): { ok: boolean; reason: string | null } {
  if (!candidate.eligible) return { ok: false, reason: candidate.ineligibility_reason || "ineligible" };
  if (!strategy.enabled) return { ok: false, reason: "strategy_disabled" };
  if (candidate.data_strength < strategy.min_quality_score) {
    return { ok: false, reason: `data_strength_${candidate.data_strength.toFixed(2)}_lt_min_${strategy.min_quality_score.toFixed(2)}` };
  }
  if (strategy.last_used_at) {
    const days = daysBetween(input.today, strategy.last_used_at);
    if (days < strategy.cooldown_days) {
      return { ok: false, reason: `cooldown_${days.toFixed(1)}d_lt_${strategy.cooldown_days}d` };
    }
  }
  if (strategy.monthly_max != null) {
    const used = input.this_month_sent_count[candidate.insight_type] || 0;
    if (used >= strategy.monthly_max) {
      return { ok: false, reason: `monthly_max_reached_${used}_of_${strategy.monthly_max}` };
    }
  }
  return { ok: true, reason: null };
}

export function scoreCandidate(
  candidate: Candidate,
  strategy: Strategy,
  today: string,
  params: PolicyParams,
): ScoredCandidate {
  const avgRating = strategy.rated_count > 0
    ? strategy.rating_sum / strategy.rated_count
    : params.rating_floor_unrated;
  const ratingSignal = Math.max(-1, Math.min(1, (avgRating - 5) / 5));

  const daysSinceUsed = strategy.last_used_at
    ? daysBetween(today, strategy.last_used_at)
    : 365;
  const recencyPenalty = Math.exp(-daysSinceUsed / Math.max(1, params.recency_half_life_days));

  const score =
      strategy.priority_weight
    + params.rating_weight        * ratingSignal
    - params.recency_weight       * recencyPenalty
    + params.data_strength_weight * candidate.data_strength;

  return {
    ...candidate,
    passes_policy_gate: false,           // filled in later by the selector caller
    policy_gate_reason: null,
    score,
    score_components: {
      priority_weight: strategy.priority_weight,
      rating_signal: ratingSignal,
      recency_penalty: recencyPenalty,
      data_strength: candidate.data_strength,
    },
  };
}

export type Rng = () => number;            // [0, 1)

function weightedRandomPick<T>(items: T[], weight: (t: T) => number, rng: Rng): T {
  const total = items.reduce((s, x) => s + Math.max(0, weight(x)), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export function selectCandidate(
  candidates: Candidate[],
  strategies: Map<string, Strategy>,
  today: string,
  thisMonthSentCount: Record<string, number>,
  params: PolicyParams = DEFAULT_POLICY_PARAMS,
  rng: Rng = Math.random,
): SelectionResult | null {
  const scored: ScoredCandidate[] = [];

  for (const c of candidates) {
    const strategy = strategies.get(c.insight_type);
    if (!strategy) continue;
    const gate = passesPolicyGate(c, strategy, { today, this_month_sent_count: thisMonthSentCount });
    const sc = scoreCandidate(c, strategy, today, params);
    sc.passes_policy_gate = gate.ok;
    sc.policy_gate_reason = gate.reason;
    scored.push(sc);
  }

  const pool = scored.filter(s => s.passes_policy_gate);
  if (pool.length === 0) return null;

  const exploration_taken = rng() < params.epsilon;
  const selected = exploration_taken
    ? weightedRandomPick(pool, s => s.score_components.priority_weight, rng)
    : pool.reduce((best, s) => (s.score > best.score ? s : best), pool[0]);

  return { selected, exploration_taken, scored, policy_params: params };
}

// Helper to build the per-type "sent this month" tally from insight_log rows.
export function tallyMonthlySent(today: string, history: Array<{ insight_type: string; created_at: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  const mk = today.slice(0, 7);
  for (const h of history) {
    if (h.created_at.startsWith(mk)) {
      out[h.insight_type] = (out[h.insight_type] || 0) + 1;
    }
  }
  return out;
}
