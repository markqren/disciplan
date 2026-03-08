// FEA-39: Inbound Email → pending_imports Edge Function
// Receives Postmark webhook, parses email, writes to staging table.
// Postmark inbound address: 5ec68b0a35fa4f3784a22d2cdc5579cf@inbound.postmarkapp.com

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Environment ──
const WEBHOOK_SECRET = Deno.env.get("INBOUND_EMAIL_SECRET")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Truncation limits (prevent oversized rows) ──
const MAX_TEXT_BODY = 10_000;
const MAX_HTML_BODY = 50_000;

// ═══════════════════════════════════════════════════════
// Forwarding Note Extraction
// ═══════════════════════════════════════════════════════

// ── Category keyword map ──
const CATEGORY_KEYWORDS: Record<string, string> = {
  "entertainment": "entertainment", "ent": "entertainment",
  "food": "food",
  "groceries": "groceries", "grocery": "groceries",
  "restaurant": "restaurant", "rest": "restaurant", "dining": "restaurant",
  "dinner": "restaurant", "lunch": "restaurant", "brunch": "restaurant",
  "home": "home",
  "rent": "rent",
  "furniture": "furniture",
  "health": "health", "medical": "health", "pharmacy": "health", "gym": "health",
  "personal": "personal",
  "clothes": "clothes", "clothing": "clothes", "apparel": "clothes",
  "tech": "tech", "software": "tech", "subscription": "tech",
  "transportation": "transportation", "transport": "transportation",
  "flight": "transportation", "uber": "transportation", "lyft": "transportation",
  "gas": "transportation", "parking": "transportation",
  "utilities": "utilities", "utility": "utilities",
  "financial": "financial",
  "other": "other",
  "income": "income", "refund": "income",
};

interface ForwardingNote {
  raw: string;
  category: string | null;
  categoryConfidence: string | null;
  descriptionHint: string | null;
  tag: string | null;
  paymentType: string | null;
}

function extractForwardingNote(textBody: string | null): ForwardingNote | null {
  if (!textBody) return null;

  // Gmail forwarding divider patterns
  const dividers = [
    /^-{5,}\s*Forwarded message\s*-{5,}/m,
    /^From:.*\nSent:.*\nTo:.*\nSubject:/m,
    /^Begin forwarded message:/m,
  ];

  let noteText: string | null = null;
  for (const div of dividers) {
    const match = textBody.search(div);
    if (match > 0) {
      noteText = textBody.slice(0, match).trim();
      break;
    }
  }

  if (!noteText || noteText.length === 0) return null;

  const result: ForwardingNote = {
    raw: noteText,
    category: null,
    categoryConfidence: null,
    descriptionHint: null,
    tag: null,
    paymentType: null,
  };

  // Extract tag: #japan or tag:japan
  const tagMatch = noteText.match(/#(\w+)|tag:(\w+)/i);
  if (tagMatch) {
    result.tag = (tagMatch[1] || tagMatch[2]).toLowerCase();
    noteText = noteText.replace(tagMatch[0], "").trim();
  }

  // Extract payment type: pt:chase sapphire or card:bilt
  const ptMatch = noteText.match(/(?:pt|card|pay):(.+?)(?:\s+#|\s*$)/i);
  if (ptMatch) {
    result.paymentType = ptMatch[1].trim();
    noteText = noteText.replace(ptMatch[0], "").trim();
  }

  // Check remaining text for category keyword (first word)
  const words = noteText.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0 && CATEGORY_KEYWORDS[words[0]]) {
    result.category = CATEGORY_KEYWORDS[words[0]];
    result.categoryConfidence = "high";
    if (words.length > 1) {
      result.descriptionHint = words.slice(1).join(" ");
    }
  } else if (noteText.length > 0) {
    // No recognized category — whole thing is a description hint for AI
    result.descriptionHint = noteText;
  }

  return result;
}

// ═══════════════════════════════════════════════════════
// Parser Registry
// ═══════════════════════════════════════════════════════

interface ParsedEmail {
  date: string | null;
  description: string;
  amount_usd: number | null;
  category_id: string | null;
  payment_type: string;
  credit?: string;
  tag?: string;
  service_start: string | null;
  service_end: string | null;
  service_days: number;
  daily_cost: number | null;
  parsed_data: Record<string, unknown>;
}

interface EmailParser {
  detect: (from: string, subject: string) => boolean;
  parse: (email: { from: string; subject: string; text: string; html: string; forwardingNote: ForwardingNote | null }) => ParsedEmail;
}

const EMAIL_PARSERS: Record<string, EmailParser> = {
  venmo: {
    detect: (from, subject) =>
      from.toLowerCase().includes("venmo.com") &&
      (subject.includes("You paid") || subject.includes("You received") || subject.includes("paid you")),
    parse: parseVenmoEmail,
  },
  // Future parsers: rakuten, chase_alert, subscription, etc.
};

// ═══════════════════════════════════════════════════════
// Venmo Parser
// ═══════════════════════════════════════════════════════

function parseVenmoEmail({ subject, text, forwardingNote }: { from: string; subject: string; text: string; html: string; forwardingNote: ForwardingNote | null }): ParsedEmail {
  const isPaid = subject.includes("You paid");
  const isReceived = subject.includes("You received") || subject.includes("paid you");

  let counterparty = "";
  let amount = 0;

  if (isPaid) {
    // "You paid Aud Li $110.00"
    const m = subject.match(/You paid (.+?) \$([0-9,.]+)/);
    if (m) { counterparty = m[1]; amount = parseFloat(m[2].replace(/,/g, "")); }
  } else if (isReceived) {
    // "You received $50.00 from Kevin Chen" or "Kevin Chen paid you $50.00"
    const m1 = subject.match(/received \$([0-9,.]+) from (.+)/);
    const m2 = subject.match(/(.+?) paid you \$([0-9,.]+)/);
    if (m1) { amount = parseFloat(m1[1].replace(/,/g, "")); counterparty = m1[2]; }
    else if (m2) { counterparty = m2[1]; amount = parseFloat(m2[2].replace(/,/g, "")); }
  }

  // Parse note from text body (between amount and next section)
  let note = "";
  if (text) {
    const noteMatch = text.match(/\$[\d,.]+\s*\n\s*\n\s*(.+?)\s*\n/);
    if (noteMatch) note = noteMatch[1].trim();
  }

  // Parse date from text body: "Date\nMar 06, 2026"
  let txnDate: string | null = null;
  if (text) {
    const dateMatch = text.match(/Date\s*\n\s*(\w+ \d{1,2}, \d{4})/);
    if (dateMatch) {
      txnDate = new Date(dateMatch[1]).toISOString().slice(0, 10);
    }
  }

  // Parse Transaction ID
  let txnId: string | null = null;
  if (text) {
    const idMatch = text.match(/Transaction ID\s*\n\s*(\d+)/);
    if (idMatch) txnId = idMatch[1];
  }

  const direction = isPaid ? "paid" : "received";
  const amountUsd = isPaid ? amount : -amount; // positive = expense, negative = income

  // Build description — forwarding note category overrides the format
  let description: string;
  const fwdCat = forwardingNote?.category;
  const fwdHint = forwardingNote?.descriptionHint;

  if (fwdCat && isPaid) {
    // Category-aware description: "Restaurant - Buoy" instead of "Venmo - Aud Li (Buoy)"
    const catLabel = fwdCat.charAt(0).toUpperCase() + fwdCat.slice(1);
    const mainNote = note || counterparty;
    description = `${catLabel} - ${mainNote}`;
    if (fwdHint) description += ` (${fwdHint})`;
  } else if (isPaid) {
    description = `Venmo - ${counterparty}${note ? ` (${note})` : ""}`;
  } else {
    description = `Venmo from ${counterparty}${note ? ` (${note})` : ""}`;
  }

  // Apply forwarding note overrides
  let categoryId: string | null = isPaid ? null : "income";
  let tag: string | undefined;
  let paymentType = "Venmo";

  if (forwardingNote) {
    if (forwardingNote.category) categoryId = forwardingNote.category;
    if (forwardingNote.tag) tag = forwardingNote.tag;
    if (forwardingNote.paymentType) paymentType = forwardingNote.paymentType;
  }

  return {
    date: txnDate,
    description,
    amount_usd: amountUsd,
    category_id: categoryId,
    payment_type: paymentType,
    tag,
    service_start: txnDate,
    service_end: txnDate,
    service_days: 1,
    daily_cost: amountUsd,
    parsed_data: {
      direction,
      counterparty,
      note,
      txn_id: txnId,
      payment_method: "Venmo balance",
      raw_amount: amount,
      forwarding_note: forwardingNote?.raw || null,
    },
  };
}

// ═══════════════════════════════════════════════════════
// AI Categorization
// ═══════════════════════════════════════════════════════

interface AIEnrichmentResult {
  cat?: string;
  conf?: string;
  desc?: string;
}

interface AIUnknownResult {
  is_transaction: boolean;
  date?: string;
  description?: string;
  amount_usd?: number;
  category_id?: string;
  confidence?: string;
  payment_type?: string;
  source_hint?: string;
}

type AIResult = AIEnrichmentResult & AIUnknownResult;

async function aiCategorize(
  source: string,
  parsed: ParsedEmail | null,
  subject: string,
  textBody: string,
  forwardingNote: ForwardingNote | null,
): Promise<AIResult | null> {
  if (!ANTHROPIC_KEY) return null;

  // If forwarding note already provides a high-confidence category, skip AI
  if (forwardingNote?.category && forwardingNote.categoryConfidence === "high") {
    return { cat: forwardingNote.category, conf: "high", desc: null } as unknown as AIResult;
  }

  const prompt = source === "unknown"
    ? buildUnknownEmailPrompt(subject, textBody, forwardingNote)
    : buildEnrichmentPrompt(source, parsed!, forwardingNote);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(`AI API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) return null;

    // Extract JSON from response (handle markdown code fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("AI categorization failed:", e);
    return null;
  }
}

function buildEnrichmentPrompt(source: string, parsed: ParsedEmail, forwardingNote: ForwardingNote | null): string {
  let prompt = `You are a personal finance assistant. Given this ${source} transaction, assign a category.

CATEGORIES: entertainment, food, groceries, restaurant, home, rent, furniture, health, personal, clothes, tech, transportation, utilities, financial, other, income

Transaction:
- Description: ${parsed.description}
- Amount: $${Math.abs(parsed.amount_usd || 0)}
- Direction: ${parsed.parsed_data.direction}
- Note: "${parsed.parsed_data.note || ""}"
- Counterparty: ${parsed.parsed_data.counterparty}`;

  if (forwardingNote?.descriptionHint || forwardingNote?.raw) {
    prompt += `\n- User's forwarding note (STRONG hint): "${forwardingNote.descriptionHint || forwardingNote.raw}"`;
  }

  prompt += `

Return ONLY a JSON object: {"cat": "<category_id>", "conf": "high|medium|low", "desc": "<optionally improved description>"}

Rules:
- If the note clearly indicates a category (e.g. "groceries", "dinner"), use high confidence
- If the counterparty is a known business type, use medium confidence
- If ambiguous, use "other" with low confidence
- For "received" direction, always use "income" with high confidence`;

  return prompt;
}

function buildUnknownEmailPrompt(subject: string, textBody: string, forwardingNote: ForwardingNote | null): string {
  let prompt = `You are a personal finance assistant. Extract a financial transaction from this email.

CATEGORIES: entertainment, food, groceries, restaurant, home, rent, furniture, health, personal, clothes, tech, transportation, utilities, financial, other, income

Email subject: ${subject}
Email body (first 2000 chars): ${(textBody || "").slice(0, 2000)}`;

  if (forwardingNote?.descriptionHint || forwardingNote?.raw) {
    prompt += `\nUser's forwarding note (STRONG hint): "${forwardingNote.descriptionHint || forwardingNote.raw}"`;
  }

  prompt += `

If this email contains a financial transaction (purchase, payment, refund, cashback, subscription charge), extract it.
If not a financial email, return {"is_transaction": false}.

Return ONLY a JSON object:
{
  "is_transaction": true,
  "date": "YYYY-MM-DD",
  "description": "Clean description",
  "amount_usd": 123.45,
  "category_id": "<category>",
  "confidence": "high|medium|low",
  "payment_type": "<best guess payment account or 'unknown'>",
  "source_hint": "<what service sent this email>"
}`;

  return prompt;
}

// ═══════════════════════════════════════════════════════
// Candidate Builder
// ═══════════════════════════════════════════════════════

interface EmailMeta {
  email_subject: string;
  email_from: string;
  email_body_text: string;
  email_body_html: string;
  email_message_id: string;
  email_received_at: string;
  parse_errors: string[];
}

function buildCandidate(
  source: string,
  parsed: ParsedEmail | null,
  aiResult: AIResult | null,
  emailMeta: EmailMeta,
  forwardingNote: ForwardingNote | null,
): Record<string, unknown> {
  // Start with parsed fields (if parser succeeded)
  const base: Record<string, unknown> = parsed ? { ...parsed } : {};

  // If AI returned results for an unknown email, use those
  if (source === "unknown" && aiResult?.is_transaction) {
    base.date = aiResult.date;
    base.description = aiResult.description;
    base.amount_usd = aiResult.amount_usd;
    base.category_id = aiResult.category_id;
    base.payment_type = aiResult.payment_type || "unknown";
    base.service_start = aiResult.date;
    base.service_end = aiResult.date;
    base.service_days = 1;
    base.daily_cost = aiResult.amount_usd;
  }

  // AI enrichment for known sources (category + description polish)
  const ai_category = aiResult?.cat || (base.category_id as string) || null;
  const ai_confidence = aiResult?.conf || aiResult?.confidence || (base.category_id ? "medium" : "low");
  const ai_description = aiResult?.desc || (base.description as string) || null;

  // Forwarding note overrides (highest priority)
  let finalPaymentType = base.payment_type || null;
  let finalTag = (base.tag as string) || "";
  if (forwardingNote?.paymentType) finalPaymentType = forwardingNote.paymentType;
  if (forwardingNote?.tag) finalTag = forwardingNote.tag;

  // Merge forwarding_note into parsed_data
  const parsedData = (base.parsed_data as Record<string, unknown>) || {};
  if (forwardingNote?.raw) parsedData.forwarding_note = forwardingNote.raw;

  return {
    source,
    status: (source === "unknown" && !aiResult?.is_transaction) ? "skipped" : "pending",
    date: base.date || null,
    description: ai_description || (base.description as string) || emailMeta.email_subject,
    category_id: ai_category || "other",
    amount_usd: base.amount_usd ?? null,
    currency: "USD",
    payment_type: finalPaymentType,
    credit: (base.credit as string) || "",
    tag: finalTag,
    service_start: base.service_start || base.date || null,
    service_end: base.service_end || base.date || null,
    service_days: (base.service_days as number) || 1,
    daily_cost: base.daily_cost ?? base.amount_usd ?? null,
    ai_category,
    ai_confidence,
    ai_description,
    parsed_data: parsedData,
    parse_errors: emailMeta.parse_errors.length ? emailMeta.parse_errors : null,
    email_subject: emailMeta.email_subject,
    email_from: emailMeta.email_from,
    email_body_text: emailMeta.email_body_text?.slice(0, MAX_TEXT_BODY) || null,
    email_body_html: emailMeta.email_body_html?.slice(0, MAX_HTML_BODY) || null,
    email_message_id: emailMeta.email_message_id,
    email_received_at: emailMeta.email_received_at,
    // Forwarding note columns
    forwarding_note: forwardingNote?.raw || null,
    forwarding_category: forwardingNote?.category || null,
    forwarding_hint: forwardingNote?.descriptionHint || null,
  };
}

// ═══════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Validate webhook secret
  if (req.headers.get("X-Webhook-Secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse Postmark payload
  const payload = await req.json();
  const {
    From: fromAddr,
    Subject: subject,
    TextBody: textBody,
    HtmlBody: htmlBody,
    MessageID: messageId,
    Date: emailDate,
  } = payload;

  // 3. Init Supabase client (service role — bypasses RLS)
  const supabase = createClient(SB_URL, SB_SERVICE_KEY);

  // 4. Dedup: skip if email_message_id already exists
  if (messageId) {
    const { data: existing } = await supabase
      .from("pending_imports")
      .select("id")
      .eq("email_message_id", messageId)
      .limit(1);
    if (existing?.length) {
      return new Response(JSON.stringify({ status: "duplicate" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 4.5. Extract forwarding note from text above Gmail's forwarded message divider
  const forwardingNote = extractForwardingNote(textBody);

  // 5. Detect source and parse
  let source = "unknown";
  let parsed: ParsedEmail | null = null;
  const parseErrors: string[] = [];

  for (const [name, parser] of Object.entries(EMAIL_PARSERS)) {
    if (parser.detect(fromAddr || "", subject || "")) {
      source = name;
      try {
        parsed = parser.parse({
          from: fromAddr || "",
          subject: subject || "",
          text: textBody || "",
          html: htmlBody || "",
          forwardingNote,
        });
      } catch (e) {
        parseErrors.push(`${name} parser error: ${(e as Error).message}`);
      }
      break;
    }
  }

  // 6. AI categorization (enrichment for known sources, full extraction for unknown)
  let aiResult: AIResult | null = null;
  try {
    aiResult = await aiCategorize(source, parsed, subject || "", textBody || "", forwardingNote);
  } catch (e) {
    console.error("AI categorization error:", e);
    // Continue without AI — will default to ai_confidence="low"
  }

  // 7. Build candidate row
  const candidate = buildCandidate(source, parsed, aiResult, {
    email_subject: subject || "",
    email_from: fromAddr || "",
    email_body_text: textBody || "",
    email_body_html: htmlBody || "",
    email_message_id: messageId || "",
    email_received_at: emailDate || new Date().toISOString(),
    parse_errors: parseErrors,
  }, forwardingNote);

  // 8. Insert into pending_imports
  const { error } = await supabase.from("pending_imports").insert(candidate);
  if (error) {
    console.error("DB insert error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 9. Success — return 200 so Postmark doesn't retry
  return new Response(JSON.stringify({ status: "ok", source, forwarding_note: forwardingNote?.raw || null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
