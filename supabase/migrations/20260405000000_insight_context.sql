-- FEA-11: Foundational AI context store for daily-insight newsletter
-- Single-row (keyed by id) store for accumulated principles/learnings.
-- The 'principles' row is read on every newsletter generation and updated
-- via the feedback loop when substantive learnings are distilled.

CREATE TABLE IF NOT EXISTS insight_context (
  id         TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO insight_context (id, content) VALUES (
  'principles',
  'FOUNDATIONAL PRINCIPLES (trained by Mark, updated via feedback loop):

INSIGHT TYPE GUIDANCE:
- category_yoy is the highest-value insight (8/10). Compare same month across 2024, 2025, 2026. Deep-dive 1-2 categories only — do not spread across many.
- budget_pace (7/10): most valuable mid-month (days 8-22). Avoid at month start/end.
- category_anomaly (7/10): only trigger on a clear 2× spike vs 6-month average. Do not use spurious triggers.
- service_expiry (7/10): useful monthly. Surface renewal decisions with daily cost.
- category_trend (7/10): use bi-weekly. Pick one category for a clean multi-month trendline.
- income_breakdown (6.5/10): best at month start or when income is irregular.
- subscription_creep (5/10): use occasionally, not weekly. Look for slow creep over 12 months.
- large_transactions (5/10): always evaluate at group level (net amount of the group), NOT individual transaction lines.
- spend_projection (5/10): useful daily but not very surprising — use sparingly.
- net_worth_velocity (6/10): useful monthly.

GENERAL:
- Never repeat the same insight type in back-to-back emails.
- Write-ups should lead with specific dollar numbers, not percentages alone.
- Charts should be clean and minimal — max 24 data points per dataset.
- Mark tracks finances at the parent-category level primarily (food, home, personal). Use parent level for summaries; child categories (groceries, restaurant) only for drilldowns.'
) ON CONFLICT DO NOTHING;
