// Policy gating, scoring, and stochastic selection over Candidates.
// All randomness lives here so it can be unit-tested by injecting a deterministic rng.

import type { Candidate, ScoredCandidate, Strategy } from "./types.ts";

export const POLICY_NAME = "epsilon_greedy_v2";   // FEA-100: theme rotation + novelty bonus
export const DEFAULT_POLICY_PARAMS = {
  epsilon: 0.15,                // exploration probability — see Opus 4.7 review notes for rationale
  recency_half_life_days: 6,    // how fast recency penalty decays
  rating_weight: 0.3,           // contribution of normalized feedback rating to score
  recency_weight: 0.5,          // contribution of recency penalty to score (subtracted)
  data_strength_weight: 0.2,    // contribution of data_strength to score
  rating_floor_unrated: 6.5,    // unrated archetypes are treated as "average minus a hair" so they're not over-explored
  novelty_weight: 0.3,          // FEA-100: bonus for under-sampled archetypes; decays over first 5 sends
  novelty_decay_sends: 5,       // FEA-100: # of sends after which novelty bonus is fully decayed
  theme_rotation_lookback: 3,   // FEA-100: penalize candidates whose theme appeared in last N sends
  theme_rotation_penalty: 0.7,  // FEA-100: multiplier applied (1.0 = no penalty, 0.7 = soft 30% cut)
};

export interface PolicyParams {
  epsilon: number;
  recency_half_life_days: number;
  rating_weight: number;
  recency_weight: number;
  data_strength_weight: number;
  rating_floor_unrated: number;
  novelty_weight: number;
  novelty_decay_sends: number;
  theme_rotation_lookback: number;
  theme_rotation_penalty: number;
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
  recentThemes: Array<string | null> = [],   // FEA-100: themes of last N sends, oldest→newest
): ScoredCandidate {
  const avgRating = strategy.rated_count > 0
    ? strategy.rating_sum / strategy.rated_count
    : params.rating_floor_unrated;
  const ratingSignal = Math.max(-1, Math.min(1, (avgRating - 5) / 5));

  const daysSinceUsed = strategy.last_used_at
    ? daysBetween(today, strategy.last_used_at)
    : 365;
  const recencyPenalty = Math.exp(-daysSinceUsed / Math.max(1, params.recency_half_life_days));

  // FEA-100 novelty bonus: linearly decays over the first novelty_decay_sends.
  // Encourages exploration of newly-released archetypes without disabling old ones.
  const noveltyBonus = strategy.sent_count < params.novelty_decay_sends
    ? params.novelty_weight * (1 - strategy.sent_count / params.novelty_decay_sends)
    : 0;

  // FEA-100 theme rotation: if this candidate's theme appeared in the last N
  // sends, multiply the score by theme_rotation_penalty. Soft penalty — bandit
  // can still pick the candidate if it's clearly best on other dimensions.
  // Strategies without a theme (parse_fallback, anything not yet categorised)
  // get no rotation pressure.
  const themePenalty = strategy.theme && recentThemes.includes(strategy.theme)
    ? params.theme_rotation_penalty
    : 1.0;

  const baseScore =
      strategy.priority_weight
    + params.rating_weight        * ratingSignal
    - params.recency_weight       * recencyPenalty
    + params.data_strength_weight * candidate.data_strength
    + noveltyBonus;
  const score = baseScore * themePenalty;

  return {
    ...candidate,
    theme: strategy.theme,
    passes_policy_gate: false,           // filled in later by the selector caller
    policy_gate_reason: null,
    score,
    score_components: {
      priority_weight: strategy.priority_weight,
      rating_signal: ratingSignal,
      recency_penalty: recencyPenalty,
      data_strength: candidate.data_strength,
      novelty_bonus: noveltyBonus,
      theme_penalty: themePenalty,
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
  recentInsightTypes: string[] = [],   // FEA-100: insight_types of last N sends, newest→oldest
): SelectionResult | null {
  // Map recent insight_types → themes for the rotation penalty. Anything not in
  // the strategy map (deleted/disabled types) maps to null and contributes no pressure.
  const recentThemes = recentInsightTypes
    .slice(0, params.theme_rotation_lookback)
    .map(t => strategies.get(t)?.theme ?? null);

  const scored: ScoredCandidate[] = [];

  for (const c of candidates) {
    const strategy = strategies.get(c.insight_type);
    if (!strategy) continue;
    const gate = passesPolicyGate(c, strategy, { today, this_month_sent_count: thisMonthSentCount });
    const sc = scoreCandidate(c, strategy, today, params, recentThemes);
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
