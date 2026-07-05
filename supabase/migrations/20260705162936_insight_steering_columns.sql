-- Make the daily-insight newsletter steerable from data instead of code.
--
-- Until now the per-archetype writing/format guidance lived hardcoded in
-- buildArchetypePrompt() (edge function), so changing how any insight type is
-- written required a code change + redeploy. These two columns move that lever
-- into the operator-editable insight_strategy table:
--
--   prompt_guidance : free text injected into the LLM prompt for the CHOSEN
--                     archetype only. Edit it in the AI portal to change tone,
--                     structure, what to emphasise, chart requirements, etc.
--   accrual_basis   : 'accrual' (default) or 'cash'. Tells the writer whether
--                     this archetype's numbers are accrual (daily_cost spread
--                     over the service period) or cash/logged-date events, so it
--                     can describe them correctly. Addresses repeated feedback
--                     that large_transactions "notes transactions by logged date
--                     rather than service date."

ALTER TABLE disciplan.insight_strategy
  ADD COLUMN IF NOT EXISTS prompt_guidance text,
  ADD COLUMN IF NOT EXISTS accrual_basis   text NOT NULL DEFAULT 'accrual';

-- Seed each archetype's guidance. The four archetypes that had specific guidance
-- in code are ported verbatim; the rest are seeded from the learned principles +
-- recent feedback so the newsletter starts at least as good as before.

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$This is a *historical trip recap*, written in past tense ("you spent...", "the trip ran..."). Use days_since_end to anchor when the trip happened. Lead with total spend or daily burn. Surface 1-2 specific top transactions for color (facts.top_txns). Tone: nostalgic and observational, not analytical. NO recommendations.$g$ WHERE insight_type = 'tag_recap';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$If facts.anomalies[0].drill_down is present, lead with the drill-down's rationale (e.g. "single merchant Whole Foods drove 60% of the spike"). drill_down.method tells you whether to credit a merchant, tag, or set of descriptions. If drill_down is absent, fall back to child_breakdown. When the anomaly is in a broad parent (entertainment, home, etc.), always show the subcategory breakdown so it's clear WHICH child drove the spike.$g$ WHERE insight_type = 'category_anomaly';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$When facts.chart_hint.multi_chart is true you MUST emit "chart_configs" (array of TWO charts, NOT a single chart_config):
  [0] LINE chart of the parent's 12-month series (facts.parent_series, facts.months as labels). Title: "<Parent> · 12mo Trend".
  [1] STACKED BAR of facts.top_children, one dataset per child, stacked, facts.months on x-axis. Title: "<Parent> by Subcategory".
Call out which top_child(ren) drive the trend (top_children[*].slope_per_month vs total_12mo). State R^2 (facts.r_squared) only if >= 0.7, else describe qualitatively. Use the PARENT category and include ALL its children (e.g. entertainment includes accommodation and games) — do not report a bare "(other)" bucket as if it were the parent. Rotate the category across sends; do not focus on the same one (e.g. health) repeatedly.$g$ WHERE insight_type = 'category_trend';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Lead with "$X YTD vs $Y same-time-last-year (Z%)". Mention 3Y CAGR (facts.cagr_3y_pct) if non-null. Do NOT speculate on causes — present the comparison cleanly. Chart: bar of the 3 YTD values. Note: income is paid at the start and end of each month, so do not surface this when income simply follows its normal regular schedule — only when timing or magnitude is genuinely irregular.$g$ WHERE insight_type = 'income_breakdown';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Compare the same month across the last 3 years. Deep-dive 1-2 categories only. When a YoY change is material, explain WHY using the facts — cite the specific trip tag(s) active in the prior-year month (e.g. "April 2025 had the szoja2025 trip") rather than guessing. Add a YTD run-rate so seasonal spikes are distinguishable from real trend changes. These are accrual (net) figures — say so if it aids clarity. Do not be dramatic about absolute changes under ~$200.$g$ WHERE insight_type = 'category_yoy';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Most useful mid-month (days 8-22). Only flag categories meaningfully OVER their trajectory — never flag a category that is comfortably under budget. Separate tagged-trip (one-off, lumpy) spend from baseline recurring spend so the pace isn't distorted by travel. For predictable/fixed categories (home, health) project the likely month-end total.$g$ WHERE insight_type = 'budget_pace';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Surface upcoming renewals with their daily cost so a keep/cancel decision is easy. Most valuable for rare or easy-to-forget subscriptions. Validate the chart config fully before returning it (all referenced data objects must exist) — a prior send threw "Cannot read properties of undefined (reading 'options')".$g$ WHERE insight_type = 'service_expiry';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Evaluate at the transaction GROUP level (net amount of the group), never individual line items. Because these are accrual-tracked, describe large items by their SERVICE period, not just the logged date — a $2,400 annual charge is ~$6.6/day over the year, not a one-day event. Only call out what is genuinely notable; a routine large-but-expected item is not an insight.$g$ WHERE insight_type = 'large_transactions';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Project month-end total spend from month-to-date accrual plus locked-in remainder plus a variable forecast. Show the arithmetic so it reconciles: projected_total minus already-spent must equal the additional projected spend. Separate lumpy tagged-trip spend where relevant.$g$ WHERE insight_type = 'spend_projection';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Look for slow upward creep in recurring subscriptions over ~12 months. Use occasionally, not weekly. Lead with the dollar delta, not the percentage.$g$ WHERE insight_type = 'subscription_creep';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Report only genuine data-quality issues in the recipient's OWN ledger (accrual mismatches, orphaned groups, missing tags, duplicates). Be concise and actionable — say exactly which records need attention.$g$ WHERE insight_type = 'accrual_quality_alert';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Compare today's accrual-based daily cost against the same calendar day in prior years (facts.flashbackByYear). Nostalgic, observational tone. Note any trip/tag that was active on the historical day.$g$ WHERE insight_type = 'on_this_day_flashback';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Frame the current gap (or streak) against its trailing-12-month history and rank. Keep it light and motivating, not preachy.$g$ WHERE insight_type = 'streak_or_gap';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Show net-worth trajectory over recent months (liquid vs invested vs net). This is asset/cash data, not accrual. Lead with the month-over-month or trailing change in net worth.$g$ WHERE insight_type = 'net_worth_velocity';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Project the full month's burn: already-accrued MTD + locked-in remainder + variable forecast. Compare to the trailing-12mo monthly mean and the same month last year. Make the projection math reconcile.$g$ WHERE insight_type = 'monthly_burn_forecast';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Report YTD cashback and the effective rate by card. Cashback is a single-day event (cash basis), so transaction dates are correct here. Highlight the best/worst effective-rate card.$g$ WHERE insight_type = 'cashback_roi';

UPDATE disciplan.insight_strategy SET prompt_guidance = $g$Recap a year's completed trips by total accrual and daily burn. Celebratory, year-in-review tone. Lead with the year's total trip spend and the standout trip.$g$ WHERE insight_type = 'trip_year_in_review';

-- Cash-basis archetypes: mark them so the writer describes them as events, not accrual.
UPDATE disciplan.insight_strategy SET accrual_basis = 'cash'
 WHERE insight_type IN ('cashback_roi', 'net_worth_velocity');

COMMENT ON COLUMN disciplan.insight_strategy.prompt_guidance IS 'Operator-editable per-archetype instructions injected into the LLM prompt for the chosen insight only. Edit in the AI portal to steer the newsletter without a code change.';
COMMENT ON COLUMN disciplan.insight_strategy.accrual_basis IS 'accrual (daily_cost over service period) or cash (logged-date event). Injected into the prompt so figures are described on the correct basis.';

-- Consolidate the principles document to GENERAL cross-cutting guidance only.
-- Per-archetype guidance now lives in insight_strategy.prompt_guidance (above),
-- so keeping it here too would duplicate and drift. The live doc had also been
-- silently TRUNCATED mid-sentence by the old full-rewrite distill step (fixed in
-- the inbound-email function); this restores a complete, clean baseline and folds
-- in the recurring lessons from recent feedback. New feedback appends under the
-- "FEEDBACK-DERIVED LESSONS" section going forward.
UPDATE disciplan.insight_context SET
  content = $p$FOUNDATIONAL PRINCIPLES (general guidance — per-insight specifics live in each strategy's prompt_guidance):

DATA SCOPE:
- Use ONLY the recipient's own transactions. Never blend another household member's data into figures or narrative.

ACCURACY & THE "WHY":
- Lead write-ups with a specific dollar number, not a percentage alone.
- Explain WHY a number moved using real drivers from the data (a merchant, a trip tag, a subcategory). If the facts don't contain the driver, use the run_finance_query tool to find it. Do NOT guess or hand-wave.
- These are ACCRUAL figures: cost is spread as daily_cost across each transaction's service period. Describe spend as accrued over its service period, not as a one-day event on the logged date. Exceptions (cash/event basis) are flagged per-insight.
- Don't be dramatic about absolute changes under ~$100-200; present small swings factually.

CATEGORIES:
- Track at the parent level (food, home, personal, entertainment, ...) for summaries. When you name a parent, include ALL its children (e.g. entertainment includes accommodation and games); never present a bare "(other)" bucket as if it were the parent. Drill into children to explain a driver.

VARIETY:
- Never repeat the same insight type in back-to-back emails, and rotate themes so several consecutive sends don't fixate on one category or angle.
- Separate lumpy tagged-trip spend from baseline recurring spend so month-to-month comparisons aren't distorted by travel.

CHARTS:
- Clean and minimal, max 24 data points per dataset. Validate every chart config (all referenced fields must exist) before returning it. Charts are valued — a longer, multi-chart deep-dive is welcome when it is accurate and genuinely useful.$p$,
  updated_at = now()
 WHERE id = 'principles';
