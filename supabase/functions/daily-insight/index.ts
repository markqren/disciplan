// FEA-11: Daily AI Finance Insight Newsletter
// Runs on a cron schedule. Fetches financial data, calls Claude to pick
// an insight type and write a newsletter, sends via Postmark, logs result.
//
// Required secrets (supabase secrets set):
//   ANTHROPIC_API_KEY        — Claude API key
//   POSTMARK_SERVER_TOKEN    — Postmark server API token
//   POSTMARK_FROM_EMAIL      — Verified sender address (e.g. insights@yourdomain.com)
//   SUPABASE_URL             — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase
//   CRON_SECRET              — shared secret passed by pg_cron; reject other callers
//
// Cron setup (Supabase dashboard → Database → Cron Jobs → New):
//   Name:     daily-insight
//   Schedule: 0 15 * * *  (8am PT = 15:00 UTC, adjust for DST)
//   Command:
//     select net.http_post(
//       url := 'https://mjuannepfodstbsxweuc.supabase.co/functions/v1/daily-insight',
//       headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret', '<CRON_SECRET>'),
//       body := '{}'::jsonb
//     );

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY")!;
const POSTMARK_TOKEN  = Deno.env.get("POSTMARK_SERVER_TOKEN")!;
const POSTMARK_FROM   = Deno.env.get("POSTMARK_FROM_EMAIL")!;
const SB_URL          = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET     = Deno.env.get("CRON_SECRET");

const TO_EMAIL    = "mark@disciplan.dev";
const REPLY_TO    = "8e70a9e284a1705b967239e049a59b65@inbound.postmarkapp.com";
const APP_URL     = "https://disciplan.netlify.app";
const MODEL       = "claude-sonnet-4-6";

// Pricing per million tokens (Sonnet 4.6)
const COST_INPUT  = 3.0;
const COST_OUTPUT = 15.0;

const BUDGET_TARGETS: Record<string, number> = {
  food: 800, groceries: 400, restaurant: 400,
  home: 2500, rent: 2250, furniture: 250,
  personal: 600, clothes: 300, tech: 300,
  transportation: 300, utilities: 150, health: 200,
  entertainment: 300, financial: 100, other: 200,
};

const EXPENSE_CATS = new Set([
  "food","groceries","restaurant","home","rent","furniture",
  "health","personal","clothes","tech","transportation",
  "utilities","financial","entertainment","other",
]);

// ── Types ────────────────────────────────────────────────────────────────────

interface Transaction {
  date: string;
  category_id: string;
  amount_usd: number;
  daily_cost: number | null;
  service_start: string | null;
  service_end: string | null;
  description?: string;
  transaction_group_id?: number | null;
}

interface InsightLogRow {
  insight_type: string;
  subject: string;
  created_at: string;
  feedback_rating: number | null;
  feedback_comment: string | null;
}

interface InsightContextRow {
  id: string;
  content: string;
}

interface ISRow {
  month: string;        // "2026-04-01"
  category_id: string;
  parent_id: string | null;
  category_label: string;
  amount: number;
}

interface InsightResponse {
  insight_type: string;
  subject: string;
  key_stat: string;
  key_stat_context: string;
  write_up: string;
  chart_config: object;
}

// ── Monthly maps from IS RPC rows ─────────────────────────────────────────────

type MonthlyMap = Record<string, Record<string, number>>; // month → category → accrual

function buildMonthlyMaps(rows: ISRow[]): { expenses: MonthlyMap; income: Record<string, number> } {
  const expenses: MonthlyMap = {};
  const income: Record<string, number> = {};

  for (const r of rows) {
    const mk = r.month.slice(0, 7); // "2026-04"
    const amt = Number(r.amount) || 0;
    if (r.category_id === "income") {
      income[mk] = (income[mk] || 0) + Math.abs(amt);
    } else if (EXPENSE_CATS.has(r.category_id) && amt > 0) {
      if (!expenses[mk]) expenses[mk] = {};
      expenses[mk][r.category_id] = (expenses[mk][r.category_id] || 0) + amt;
    }
  }

  return { expenses, income };
}

// ── Data formatting for prompt ────────────────────────────────────────────────

// Parent-level rollup matching the IS tab (food = food + groceries + restaurant, etc.)
const PARENT_ROLLUP: Record<string, string[]> = {
  food:           ["food", "groceries", "restaurant"],
  home:           ["home", "rent", "furniture"],
  personal:       ["personal", "clothes", "tech"],
  health:         ["health"],
  transportation: ["transportation"],
  utilities:      ["utilities"],
  financial:      ["financial"],
  entertainment:  ["entertainment"],
  other:          ["other"],
};

function fmtMonthlyExpenses(map: MonthlyMap): string {
  const months = Object.keys(map).sort().reverse();
  const parents = Object.keys(PARENT_ROLLUP);
  const header = ["Month", ...parents, "Total"].join(" | ");
  const rows = months.map(m => {
    const vals = parents.map(p => {
      const sum = PARENT_ROLLUP[p].reduce((s, c) => s + (map[m]?.[c] || 0), 0);
      return sum > 0 ? `$${Math.round(sum)}` : "—";
    });
    const total = parents.reduce((s, p) => s + PARENT_ROLLUP[p].reduce((ss, c) => ss + (map[m]?.[c] || 0), 0), 0);
    return [m, ...vals, `$${Math.round(total)}`].join(" | ");
  });
  return [header, ...rows].join("\n");
}

function fmtMonthlyIncome(map: Record<string, number>): string {
  return Object.keys(map).sort().reverse()
    .map(m => `${m}: $${Math.round(map[m])}`)
    .join(" | ");
}

function fmtInsightHistory(rows: InsightLogRow[]): string {
  if (!rows.length) return "No prior insights.";
  return rows.slice(0, 7).map(r => {
    const rating = r.feedback_rating != null ? ` [rated ${r.feedback_rating}/10]` : " [no feedback yet]";
    return `${r.created_at.slice(0, 10)} — ${r.insight_type}${rating}`;
  }).join("\n");
}

function fmtFeedback(rows: InsightLogRow[]): string {
  const withFeedback = rows.filter(r => r.feedback_rating != null).slice(0, 10);
  if (!withFeedback.length) return "No feedback received yet.";
  return withFeedback.map(r =>
    `${r.created_at.slice(0, 10)} ${r.insight_type}: ${r.feedback_rating}/10${r.feedback_comment ? ` — "${r.feedback_comment}"` : ""}`
  ).join("\n");
}

function fmtLargeTransactions(txns: Transaction[]): string {
  // Group by transaction_group_id, net the amounts
  const groups: Record<string, { net: number; descs: string[]; cat: string; date: string; service_start: string | null; service_end: string | null }> = {};
  for (const t of txns) {
    if (Math.abs(t.amount_usd) < 50) continue;
    const key = t.transaction_group_id ? `g${t.transaction_group_id}` : `s${t.date}${t.description}`;
    if (!groups[key]) groups[key] = { net: 0, descs: [], cat: t.category_id, date: t.date, service_start: t.service_start, service_end: t.service_end };
    groups[key].net += t.amount_usd;
    if (t.description) groups[key].descs.push(t.description);
  }
  const sorted = Object.values(groups)
    .filter(g => Math.abs(g.net) >= 50)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 8);
  if (!sorted.length) return "No large transactions this week.";
  return sorted.map(g => {
    const servicePeriod = g.service_start && g.service_end && g.service_start !== g.date
      ? ` | service: ${g.service_start} → ${g.service_end}`
      : "";
    return `$${Math.round(Math.abs(g.net))} | ${g.cat} | "${g.descs.slice(0, 2).join(" / ")}" | logged: ${g.date}${servicePeriod}`;
  }).join("\n");
}

function fmtExpiring(txns: Transaction[]): string {
  if (!txns.length) return "None in the next 30 days.";
  return txns.slice(0, 15).map(t =>
    `"${t.description}" | $${Math.abs(t.amount_usd).toFixed(2)} | ends ${t.service_end} | ${t.daily_cost != null ? `$${t.daily_cost.toFixed(2)}/day` : "lump sum"}`
  ).join("\n");
}

// ── Claude prompt ─────────────────────────────────────────────────────────────

function buildPrompt(
  today: string,
  expenses: MonthlyMap,
  income: Record<string, number>,
  largeTxns: Transaction[],
  expiring: Transaction[],
  history: InsightLogRow[],
  principles: string,
): string {
  return `You are a personal finance analyst writing a daily email newsletter for Mark, who tracks his finances with an accrual-based system called "the disciplan" (12,000+ transactions since 2017, now in 2026).

TODAY: ${today}

## FOUNDATIONAL PRINCIPLES (accumulated learnings — follow these carefully):
${principles}

## RECENTLY SENT INSIGHTS (avoid repeating same type within last 3):
${fmtInsightHistory(history)}

## RECENT FEEDBACK ON PAST INSIGHTS:
${fmtFeedback(history)}

## MONTHLY BUDGET TARGETS (reference):
food $800 (groceries $400 + restaurant $400) | home $2500 (rent $2250) | personal $600 | tech $300 | transportation $300 | health $200 | entertainment $300 | utilities $150 | other $200

## MONTHLY EXPENSE TOTALS (accrual basis, most recent first):
${fmtMonthlyExpenses(expenses)}

## MONTHLY INCOME:
${fmtMonthlyIncome(income)}

## LARGE TRANSACTIONS — LAST 7 DAYS (>$50, net by group):
${fmtLargeTransactions(largeTxns)}

## SERVICE PERIODS EXPIRING IN 30 DAYS:
${fmtExpiring(expiring)}

## INSTRUCTIONS:
1. Choose the most valuable insight type given today's date and the data. Prefer high-rated types. Don't repeat a type used in the last 3 insights.
   - budget_pace is great mid-month (days 8–22). At month-start, prefer income_breakdown or service_expiry.
   - category_yoy: compare the current month across 2024, 2025, 2026 for 1-2 most interesting categories.
   - category_anomaly: only trigger if data clearly shows a 2× spike vs 6-month average.
2. Write a tight 2-3 sentence narrative with specific numbers from the data.
3. Produce a Chart.js 4.x chart config (compact — max 24 data points per dataset). Use colors: #81B29A (green/positive), #E07A5F (red/negative/over-budget), #4A6FA5 (blue/neutral), #F2CC8F (yellow/income). Background transparent.

Return ONLY valid JSON (no markdown, no explanation):
{
  "insight_type": "<type>",
  "subject": "Disciplan Insight — <short title> · ${today}",
  "key_stat": "<one compelling number, e.g. '$2,847' or '−12%'>",
  "key_stat_context": "<one phrase of context, e.g. 'spent in April (83% of budget)'>",
  "write_up": "<2-3 sentences with specific numbers>",
  "chart_config": {<valid Chart.js 4.x config object>}
}`;
}

// ── Email HTML ────────────────────────────────────────────────────────────────

function buildEmail(r: InsightResponse, chartUrl: string, costLine: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="560" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1)">
  <tr>
    <td style="background:#0a0a14;padding:20px 28px">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.03em">the disciplan</span>
      <span style="color:#81B29A;font-size:11px;font-family:monospace;margin-left:10px;letter-spacing:0.05em">DAILY INSIGHT</span>
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
  </tr>
  <tr>
    <td style="padding:0 28px">
      <img src="${chartUrl}" width="504" style="display:block;border-radius:6px;max-width:100%" alt="Chart">
    </td>
  </tr>
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

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Validate cron secret
  const cronHeader = req.headers.get("X-Cron-Secret");
  if (CRON_SECRET && cronHeader !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const supabase = createClient(SB_URL, SB_SERVICE_KEY);

  // ── 1. Fetch foundational principles + recent insight history ────────────
  const { data: contextRows } = await supabase
    .from("insight_context")
    .select("content")
    .eq("id", "principles")
    .limit(1);
  const principles: string = (contextRows as InsightContextRow[] | null)?.[0]?.content || "No foundational principles yet.";

  const { data: history } = await supabase
    .from("insight_log")
    .select("insight_type, subject, created_at, feedback_rating, feedback_comment")
    .order("created_at", { ascending: false })
    .limit(20);

  // ── 2. Fetch IS data via RPC for last 2+ years (correct accrual, no pagination needed) ──
  const currentYear = new Date().getUTCFullYear();
  const isResults = await Promise.all(
    [currentYear, currentYear - 1, currentYear - 2].map(y =>
      supabase.rpc("get_income_statement", { p_year: y })
    )
  );
  const allISRows: ISRow[] = isResults.flatMap(r => (r.data || []) as ISRow[]);
  const { expenses, income } = buildMonthlyMaps(allISRows);

  // ── 3. Fetch large recent transactions (last 7 days) ─────────────────────
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  const { data: largeTxns } = await supabase
    .from("transactions")
    .select("date,description,amount_usd,category_id,transaction_group_id,service_start,service_end")
    .gte("date", sevenDaysAgoStr)
    .not("category_id", "in", "(income,investment,adjustment)")
    .order("amount_usd", { ascending: false });

  // ── 5. Fetch service periods expiring in 30 days ──────────────────────────
  const thirtyDaysOut = new Date();
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
  const thirtyDaysOutStr = thirtyDaysOut.toISOString().slice(0, 10);

  const { data: expiring } = await supabase
    .from("transactions")
    .select("description,amount_usd,service_start,service_end,service_days,category_id,daily_cost")
    .gte("service_end", today)
    .lte("service_end", thirtyDaysOutStr)
    .not("category_id", "in", "(income,investment,adjustment)")
    .gt("service_days", 1)
    .order("service_end", { ascending: true })
    .limit(20);

  // ── 5. Build and send Claude prompt ───────────────────────────────────────
  const prompt = buildPrompt(
    today,
    expenses,
    income,
    (largeTxns || []) as Transaction[],
    (expiring || []) as Transaction[],
    (history || []) as InsightLogRow[],
    principles,
  );

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

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    console.error("Claude error:", err);
    return new Response("Claude API error", { status: 500 });
  }

  const claudeData = await claudeRes.json();
  const rawText: string = claudeData.content?.[0]?.text || "";
  const inputTokens: number  = claudeData.usage?.input_tokens  || 0;
  const outputTokens: number = claudeData.usage?.output_tokens || 0;
  const costUsd = (inputTokens * COST_INPUT + outputTokens * COST_OUTPUT) / 1_000_000;
  const costLine = `This insight cost ~$${costUsd.toFixed(4)} to generate (${(inputTokens/1000).toFixed(1)}k input / ${(outputTokens/1000).toFixed(1)}k output tokens · ${MODEL})`;

  // Parse Claude JSON response
  let insight: InsightResponse;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    insight = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Failed to parse Claude response:", rawText, e);
    return new Response("Failed to parse Claude response", { status: 500 });
  }

  // ── 8. Create QuickChart short URL ─────────────────────────────────────────
  // Validate chart config has required top-level fields before sending
  const cfg = insight.chart_config as Record<string, unknown>;
  const validChart = cfg && typeof cfg.type === "string" && cfg.data != null;
  console.log("chart_config valid:", validChart, "type:", cfg?.type);

  let chartUrl = "";
  if (validChart) {
    try {
      const qcRes = await fetch("https://quickchart.io/chart/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chart: insight.chart_config,
          width: 504,
          height: 260,
          backgroundColor: "white",
        }),
      });
      if (qcRes.ok) {
        const qcData = await qcRes.json();
        chartUrl = qcData.url || "";
      } else {
        console.error("QuickChart HTTP error:", qcRes.status, await qcRes.text());
      }
    } catch (e) {
      console.error("QuickChart error:", e);
    }
  } else {
    console.error("Invalid chart_config from Claude:", JSON.stringify(cfg));
  }

  // Fallback: blank placeholder if chart fails
  if (!chartUrl) chartUrl = "https://quickchart.io/chart?c=%7B%22type%22%3A%22bar%22%2C%22data%22%3A%7B%22labels%22%3A%5B%5D%2C%22datasets%22%3A%5B%5D%7D%7D&w=504&h=260&bkg=white";

  // ── 9. Build and send email ────────────────────────────────────────────────
  const html = buildEmail(insight, chartUrl, costLine);

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
    const err = await pmRes.text();
    console.error("Postmark error:", err);
    return new Response("Postmark send error", { status: 500 });
  }

  const pmData = await pmRes.json();
  const postmarkMessageId: string = pmData.MessageID || "";

  // ── 10. Log to insight_log ─────────────────────────────────────────────────
  await supabase.from("insight_log").insert({
    insight_type:        insight.insight_type,
    subject:             insight.subject,
    html_body:           html,
    model_used:          MODEL,
    postmark_message_id: postmarkMessageId,
    input_tokens:        inputTokens,
    output_tokens:       outputTokens,
    cost_usd:            costUsd,
  });

  console.log(`Sent insight: ${insight.insight_type} | ${insight.subject} | cost: $${costUsd.toFixed(4)}`);

  return new Response(JSON.stringify({
    status: "sent",
    insight_type: insight.insight_type,
    subject: insight.subject,
    cost_usd: costUsd,
    postmark_message_id: postmarkMessageId,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
});
