// FEA-39: Inbound Email → pending_imports Edge Function
// Receives Postmark webhook, parses email, writes to staging table.
// Postmark inbound address: 8e70a9e284a1705b967239e049a59b65@inbound.postmarkapp.com

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Environment ──
const WEBHOOK_SECRET = Deno.env.get("INBOUND_EMAIL_SECRET");
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Truncation limits (prevent oversized rows) ──
const MAX_TEXT_BODY = 10_000;
const MAX_HTML_BODY = 50_000;

// ── Insight feedback principles guardrails ─────────────────────────────────
// Inbound replies are untrusted. A user reply should never be allowed to rewrite
// the entire principles document for the daily-insight system. We:
//   - cap how much the document is allowed to grow or shrink in one pass
//   - reject prompts that look like "ignore previous, here are the new rules"
// All proposed updates land in principles_pending for operator approval.
const PRINCIPLES_MAX_DELTA_RATIO = 0.30;
const PRINCIPLES_BANNED_PREFIXES: RegExp[] = [
  /^\s*ignore\b/i,
  /^\s*disregard\b/i,
  /^\s*forget\b/i,
  /^\s*replace\s+all\b/i,
  /^\s*new\s+principles\s*:/i,
  /^\s*system\s*:/i,
];

function checkPrinciplesGuardrails(current: string, proposed: string): { ok: boolean; reason?: string } {
  if (!proposed || proposed.length < 50) {
    return { ok: false, reason: "proposed_too_short" };
  }
  const curLen = Math.max(current.length, 1);
  const delta = Math.abs(proposed.length - current.length) / curLen;
  if (delta > PRINCIPLES_MAX_DELTA_RATIO) {
    return { ok: false, reason: `length_delta_${Math.round(delta * 100)}pct_exceeds_${Math.round(PRINCIPLES_MAX_DELTA_RATIO * 100)}pct` };
  }
  const firstNonEmpty = proposed.split("\n").map(l => l.trim()).find(l => l.length > 0) || "";
  for (const re of PRINCIPLES_BANNED_PREFIXES) {
    if (re.test(firstNonEmpty)) {
      return { ok: false, reason: `banned_prefix_${re.source}` };
    }
  }
  return { ok: true };
}

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
  servicePeriodHint: string | null; // natural language service period from user note
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
    servicePeriodHint: null,
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

  // Extract service period hints (natural language)
  const servicePeriodPatterns = [
    /spread\s+over\s+[\w\s]+\d{0,4}/i,              // "spread over march 2026"
    /service\s+[\d/]+-[\d/]+/i,                      // "service 3/1-3/31"
    /service\s+[\d/]+\s+to\s+[\d/]+/i,              // "service 3/1 to 3/31"
    /\d+\s+days?(?:\s+from\s+(?:today|purchase))?/i, // "30 days" / "30 days from today"
    /(?:annual|yearly|monthly|quarterly|weekly)\s*(?:subscription|sub|plan|fee|charge)?/i,
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4}/i, // "march 2026"
    /q[1-4]\s+\d{4}/i,                              // "Q1 2026"
  ];
  for (const pat of servicePeriodPatterns) {
    const m = noteText.match(pat);
    if (m) {
      result.servicePeriodHint = m[0].trim();
      noteText = noteText.replace(m[0], "").trim();
      break;
    }
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
  detect: (from: string, subject: string, text: string, html: string) => boolean;
  parse: (email: { from: string; subject: string; text: string; html: string; forwardingNote: ForwardingNote | null }) => ParsedEmail;
}

const EMAIL_PARSERS: Record<string, EmailParser> = {
  venmo: {
    detect: (from, subject, _text, _html) =>
      from.toLowerCase().includes("venmo.com") ||
      /You paid .+\$[\d,.]+/.test(subject) ||
      /paid your \$[\d,.]+/.test(subject) ||
      /You received .+\$[\d,.]+/.test(subject) ||
      /.+ paid you \$[\d,.]+/.test(subject),
    parse: parseVenmoEmail,
  },
  rakuten: {
    detect: (from, subject, text, html) => {
      const f = from.toLowerCase();
      const s = subject.toLowerCase();
      const body = (text + html).toLowerCase();
      return f.includes("rakuten.com") || f.includes("ebates.com") ||
        (s.includes("cash back") && s.includes("rakuten")) ||
        // Forwarded emails: check body for original Rakuten sender
        (s.includes("cash back") && body.includes("rakuten.com")) ||
        body.includes("messages.rakuten.com");
    },
    parse: parseRakutenEmail,
  },
  splitwise: {
    detect: (from, _subject, text, html) => {
      const f = from.toLowerCase();
      const body = (text + html).toLowerCase();
      return f.includes("splitwise.com") || body.includes("splitwise.com");
    },
    parse: parseSplitwiseEmail,
  },
  // Future parsers: chase_alert, subscription, etc.
};

// ═══════════════════════════════════════════════════════
// Venmo Parser
// ═══════════════════════════════════════════════════════

function parseVenmoEmail({ subject: rawSubject, text, forwardingNote }: { from: string; subject: string; text: string; html: string; forwardingNote: ForwardingNote | null }): ParsedEmail {
  // Strip "Fwd: " prefix from forwarded emails
  const subject = rawSubject.replace(/^Fwd:\s*/i, "").trim();
  const isPaid = subject.includes("You paid");
  const isPaidRequest = subject.includes("paid your");
  const isReceived = subject.includes("You received") || subject.includes("paid you") || isPaidRequest;

  let counterparty = "";
  let amount = 0;

  if (isPaid) {
    const m = subject.match(/You paid (.+?) \$([0-9,.]+)/);
    if (m) { counterparty = m[1]; amount = parseFloat(m[2].replace(/,/g, "")); }
  } else if (isPaidRequest) {
    const m = subject.match(/(.+?) paid your \$([0-9,.]+)/);
    if (m) { counterparty = m[1]; amount = parseFloat(m[2].replace(/,/g, "")); }
  } else if (isReceived) {
    const m1 = subject.match(/received \$([0-9,.]+) from (.+)/);
    const m2 = subject.match(/(.+?) paid you \$([0-9,.]+)/);
    if (m1) { amount = parseFloat(m1[1].replace(/,/g, "")); counterparty = m1[2]; }
    else if (m2) { counterparty = m2[1]; amount = parseFloat(m2[2].replace(/,/g, "")); }
  }

  // Strip everything before the forwarding divider to get just the Venmo email body
  let venmoBody = text || "";
  if (text) {
    const fwdDividers = [
      /^-{5,}\s*Forwarded message\s*-{5,}/m,
      /^Begin forwarded message:/m,
      /^From:.*\nSent:.*\nTo:.*\nSubject:/m,
    ];
    for (const pat of fwdDividers) {
      const match = text.search(pat);
      if (match >= 0) {
        venmoBody = text.slice(match);
        break;
      }
    }
  }

  let note = "";
  if (venmoBody) {
    const noteMatch1 = venmoBody.match(/\n\n([^\n]+)\n\nSee transaction/);
    if (noteMatch1) note = noteMatch1[1].trim();
    if (!note) {
      const noteMatch2 = venmoBody.match(/\$[\d,.]+\s*\n\s*\n\s*(.+?)\s*\n/);
      if (noteMatch2) note = noteMatch2[1].trim();
    }
  }

  let txnDate: string | null = null;
  if (venmoBody) {
    const dateMatch = venmoBody.match(/Date\s*\n\s*(\w+ \d{1,2}, \d{4})/);
    if (dateMatch) {
      txnDate = new Date(dateMatch[1]).toISOString().slice(0, 10);
    }
  }

  let txnId: string | null = null;
  if (venmoBody) {
    const idMatch = venmoBody.match(/Transaction ID\s*\n\s*(\d+)/);
    if (idMatch) txnId = idMatch[1];
  }

  const direction = isPaid ? "paid" : "received";
  const amountUsd = isPaid ? amount : -amount;

  const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());
  let description: string;
  const fwdCat = forwardingNote?.category;
  const fwdHint = forwardingNote?.descriptionHint;
  const displayNote = note ? titleCase(note) : "";

  if (isPaid) {
    if (fwdCat) {
      const catLabel = fwdCat.charAt(0).toUpperCase() + fwdCat.slice(1);
      description = displayNote
        ? `${catLabel} - ${displayNote} - ${counterparty}`
        : `${catLabel} - ${counterparty}`;
      if (fwdHint) description += ` (${fwdHint})`;
    } else {
      description = `Venmo - ${counterparty}${displayNote ? ` (${displayNote})` : ""}`;
    }
  } else {
    const catLabel = fwdCat
      ? fwdCat.charAt(0).toUpperCase() + fwdCat.slice(1)
      : null;
    const firstName = counterparty.split(" ")[0];
    if (displayNote) {
      description = catLabel
        ? `Reimbursed - ${displayNote} (${catLabel}) - ${firstName}`
        : `Reimbursed - ${displayNote} - ${firstName}`;
    } else {
      description = `Reimbursed - ${counterparty}`;
    }
    // Reimbursements use the forwarding note category (not "income")
  }

  let categoryId: string | null = isPaid ? null : (fwdCat || null);
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
// Rakuten Parser
// ═══════════════════════════════════════════════════════

function parseRakutenEmail({ subject: rawSubject, text, html, forwardingNote }: { from: string; subject: string; text: string; html: string; forwardingNote: ForwardingNote | null }): ParsedEmail {
  const subject = rawSubject.replace(/^Fwd:\s*/i, "").trim();

  // Extract cashback amount from the email body
  // Rakuten emails prominently show the dollar amount at the top: "$147.00"
  // This appears as the cashback amount in the "Cash Back is now in your Pending balance" context
  let cashbackAmount: number | null = null;
  let storeName: string | null = null;
  let orderDate: string | null = null;
  let orderId: string | null = null;

  // Search both text AND html — forwarded Rakuten emails have useless text bodies
  // (zero-width spaces) but structured data in HTML table cells
  const bodyToSearch = (text || "") + "\n" + (html || "");

  // Strip HTML tags for cleaner regex matching on HTML content
  const stripped = bodyToSearch.replace(/<[^>]+>/g, " ").replace(/&\w+;/g, " ");

  // Amount: In the HTML, the cashback amount appears in a table cell right before
  // "Order number". Match the dollar amount closest to order data, not nav links like "Earn $50".
  // HTML structure: <td>$14.83</td> ... <td>Order number</td>
  // After stripping: "  $14.83   Order number  9731724334"
  const amtNearOrder = stripped.match(/\$([0-9]+(?:\.[0-9]{2})?)\s+Order number/i);
  if (amtNearOrder) {
    cashbackAmount = parseFloat(amtNearOrder[1]);
  } else {
    // Fallback: find dollar amount with cents (excludes round numbers like "$50")
    const amtWithCents = stripped.match(/\$([0-9]+\.[0-9]{2})/);
    if (amtWithCents) {
      cashbackAmount = parseFloat(amtWithCents[1]);
    }
  }

  // Order number: in HTML as "Order number</td>...<td>9731724334</td>"
  // After stripping: "Order number  9731724334"
  const orderMatch = stripped.match(/Order number\s+([a-f0-9-]+)/i);
  if (orderMatch) orderId = orderMatch[1];

  // Order date: "Online order date</td>...<td>3/13/26</td>"
  // After stripping: "Online order date  3/13/26"
  const dateMatch = stripped.match(/order date\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (dateMatch) {
    const parts = dateMatch[1].split("/");
    if (parts.length === 3) {
      const yr = parts[2].length === 2 ? "20" + parts[2] : parts[2];
      orderDate = `${yr}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
    }
  }

  // Try to extract store name from subject
  // Subject patterns: "You've earned Cash Back at Vrbo" or "Cash Back from Vrbo"
  const storeSubjMatch = subject.match(/(?:earned|from|at)\s+(?:Cash\s*Back\s+(?:at|from)\s+)?(.+?)(?:\s*[!.]|$)/i);
  if (storeSubjMatch) storeName = storeSubjMatch[1].trim();

  // Use forwarding note as store name hint (user types "Sixt" when forwarding)
  if (!storeName && forwardingNote?.descriptionHint) {
    storeName = forwardingNote.descriptionHint;
  }

  // The cashback amount is NEGATIVE because it's money owed to Mark (a credit)
  // Following the Rakuten Working Capital pattern from FEA-37:
  // Negative = credit on the Rakuten account (Rakuten owes Mark money)
  const amountUsd = cashbackAmount ? -cashbackAmount : 0;

  // Build description: "Rakuten - {Store}" matching historical pattern
  // If no store name extracted, use forwarding note or just "Rakuten"
  let merchantName = storeName || "Unknown Store";

  // Don't override merchantName with raw forwarding note — it's too unstructured.
  // The AI forwarding note interpreter will handle this and return a clean description.

  const description = `Rakuten - ${merchantName}`;

  // Category is null — will be inherited from the linked parent purchase by linkRakutenCashback.
  // If no parent is found, remains null for manual assignment.
  // payment_type = "Rakuten" (the Working Capital account)
  let tag: string | undefined;
  if (forwardingNote?.tag) tag = forwardingNote.tag;

  return {
    date: orderDate,
    description,
    amount_usd: amountUsd,
    category_id: null,  // Inherited from parent purchase on link
    payment_type: "Rakuten",  // Working Capital account
    tag,
    service_start: orderDate,
    service_end: orderDate,
    service_days: 1,
    daily_cost: amountUsd,
    parsed_data: {
      type: "cashback_earned",
      store_name: storeName,
      cashback_amount: cashbackAmount,
      order_id: orderId,
      order_date: orderDate,
      forwarding_note: forwardingNote?.raw || null,
    },
  };
}

// ═══════════════════════════════════════════════════════
// Splitwise Parser
// ═══════════════════════════════════════════════════════

function parseSplitwiseEmail({ subject: rawSubject, text, html, forwardingNote }: { from: string; subject: string; text: string; html: string; forwardingNote: ForwardingNote | null }): ParsedEmail {
  const subject = rawSubject.replace(/^Fwd:\s*/i, "").trim();
  const body = text || html || "";

  // Amount: look for "you owe $X" / "your share: $X" / standalone "$X" in subject then body
  let amount = 0;
  for (const pat of [
    /you owe[^$]*\$([\d,.]+)/i,
    /your share[^$]*\$([\d,.]+)/i,
    /\$([\d,.]+)/,
  ]) {
    const m = (subject + " " + body).match(pat);
    if (m) { amount = parseFloat(m[1].replace(/,/g, "")); break; }
  }

  // Description: prefer expense name in quotes, fall back to raw subject
  let description = subject;
  const quoted = subject.match(/['"\u201c\u201d](.+?)['"\u201c\u201d]/);
  if (quoted) description = quoted[1];

  let paymentType = "Splitwise";
  if (forwardingNote?.paymentType) paymentType = forwardingNote.paymentType;

  return {
    date: null,
    description,
    amount_usd: amount,
    category_id: null,
    payment_type: paymentType,
    service_start: null,
    service_end: null,
    service_days: 1,
    daily_cost: amount,
    parsed_data: { raw_subject: subject },
  };
}

// ═══════════════════════════════════════════════════════
// History Lookup
// ═══════════════════════════════════════════════════════

interface HistoricalMatch {
  description: string;
  category_id: string;
  payment_type: string;
  service_days: number;
  amount_usd: number;
}

async function lookupTransactionHistory(
  supabase: ReturnType<typeof createClient>,
  description: string,
): Promise<HistoricalMatch[]> {
  if (!description) return [];

  // Strip common source prefixes before matching
  const cleanDesc = description.replace(/^(venmo|rakuten)\s*[-–]\s*/i, "").trim();
  if (!cleanDesc) return [];

  // Anchor on first ~20 chars — avoids expensive full-table scan while giving good recall
  const anchor = cleanDesc.slice(0, 20).replace(/[%_]/g, "\\$&"); // escape ILIKE wildcards

  try {
    const { data } = await supabase
      .from("transactions")
      .select("description, category_id, payment_type, service_days, amount_usd")
      .ilike("description", `%${anchor}%`)
      .order("date", { ascending: false })
      .limit(5);

    return (data || []) as HistoricalMatch[];
  } catch {
    return []; // Non-blocking: history failure never stops the import
  }
}

function formatHistoryContext(history: HistoricalMatch[]): string {
  if (!history.length) return "No historical matches found.";
  return history.map((h, i) =>
    `${i + 1}. "${h.description}" | ${h.category_id} | ${h.payment_type} | ${h.service_days} day(s) | $${Math.abs(h.amount_usd)}`
  ).join("\n");
}

// ═══════════════════════════════════════════════════════
// Service Period Math
// ═══════════════════════════════════════════════════════

interface ServicePeriodFields {
  service_start: string;
  service_end: string;
  service_days: number;
  daily_cost: number | null;
}

function computeServicePeriod(
  start: string,
  end: string,
  amount_usd: number | null,
): ServicePeriodFields {
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T00:00:00Z");

  // Clamp: end must be >= start
  const effectiveEnd = endDate >= startDate ? endDate : startDate;
  const effectiveEndStr = effectiveEnd.toISOString().slice(0, 10);

  // Inclusive range: service_days = end - start + 1
  const msPerDay = 86_400_000;
  const days = Math.round((effectiveEnd.getTime() - startDate.getTime()) / msPerDay) + 1;

  const daily_cost = (amount_usd !== null && days > 0)
    ? Math.round((amount_usd / days) * 1_000_000) / 1_000_000
    : null;

  return {
    service_start: start,
    service_end: effectiveEndStr,
    service_days: days,
    daily_cost,
  };
}

// ═══════════════════════════════════════════════════════
// AI Categorization
// ═══════════════════════════════════════════════════════

interface AIServicePeriod {
  start: string | null;
  end: string | null;
  description: string; // audit trail, e.g. "spread over march → 2026-03-01 to 2026-03-31"
}

interface AIEnrichmentResult {
  cat?: string;
  conf?: string;
  desc?: string;
  tag?: string;
  payment_type?: string;
  amount_usd?: number;
  service_period?: AIServicePeriod;
  is_subscription?: boolean;
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
  tag?: string;
  service_period?: AIServicePeriod;
  is_subscription?: boolean;
}

type AIResult = AIEnrichmentResult & AIUnknownResult;

async function aiCategorize(
  source: string,
  parsed: ParsedEmail | null,
  subject: string,
  textBody: string,
  forwardingNote: ForwardingNote | null,
  supabaseClient?: ReturnType<typeof createClient>,
): Promise<AIResult | null> {
  if (!ANTHROPIC_KEY) return null;

  // Fetch transaction history for pattern matching
  let history: HistoricalMatch[] = [];
  if (supabaseClient && parsed?.description) {
    history = await lookupTransactionHistory(supabaseClient, parsed.description);
  }

  const servicePeriodHint = forwardingNote?.servicePeriodHint || null;

  // For Rakuten with a clear forwarding note, let AI interpret the full context
  if (source === "rakuten" && forwardingNote?.raw) {
    return await aiInterpretForwardingNote(source, parsed!, forwardingNote, subject, textBody, history, servicePeriodHint);
  }

  // If forwarding note already provides a high-confidence category, skip AI for categorization
  // but still run AI for service period / subscription detection if there are hints
  const needsServiceAnalysis = !!servicePeriodHint || source === "unknown";
  if (forwardingNote?.category && forwardingNote.categoryConfidence === "high" && !needsServiceAnalysis) {
    return { cat: forwardingNote.category, conf: "high", desc: null } as unknown as AIResult;
  }

  const prompt = source === "unknown"
    ? buildUnknownEmailPrompt(subject, textBody, forwardingNote, history, servicePeriodHint, parsed?.date || null)
    : buildEnrichmentPrompt(source, parsed!, forwardingNote, history, servicePeriodHint);

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

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("AI categorization failed:", e);
    return null;
  }
}

// AI interprets forwarding note in full context (used for Rakuten and complex notes)
async function aiInterpretForwardingNote(
  source: string,
  parsed: ParsedEmail,
  forwardingNote: ForwardingNote,
  subject: string,
  _textBody: string,
  history: HistoricalMatch[],
  servicePeriodHint: string | null,
): Promise<AIResult | null> {
  const refDate = parsed.date || new Date().toISOString().slice(0, 10);
  const historyBlock = formatHistoryContext(history);

  const prompt = `You are a personal finance assistant helping parse a forwarded financial email.

The user forwarded a ${source} email and added a note before forwarding. Your job is to interpret
the user's note to extract the best description, category, tag, service period, and subscription status.

EMAIL SOURCE: ${source}
EMAIL SUBJECT: ${subject}
REFERENCE DATE (transaction date or today): ${refDate}

PARSER-EXTRACTED DATA:
- Description: ${parsed.description}
- Amount: $${Math.abs(parsed.amount_usd || 0)}
- Payment Type: ${parsed.payment_type}
- Date: ${parsed.date || "unknown"}
${parsed.parsed_data.store_name ? `- Store: ${parsed.parsed_data.store_name}` : ""}

USER'S FORWARDING NOTE (text they typed before forwarding):
"${forwardingNote.raw}"
${servicePeriodHint ? `\nDETECTED SERVICE PERIOD HINT: "${servicePeriodHint}"` : ""}

HISTORICAL MATCHES (similar past transactions — use for category/payment_type/service_days patterns):
${historyBlock}

CONTEXT FOR ${source.toUpperCase()}:
${source === "rakuten" ? `This is a Rakuten cashback notification. The amount ($${Math.abs(parsed.amount_usd || 0)}) is cashback EARNED, not the purchase price. The payment_type should always be "Rakuten". The category should be "income" for cashback earned. The description format should be "Rakuten - {StoreName}" matching historical patterns like "Rakuten - Chewy", "Rakuten - Sur la Table", "Rakuten - Vrbo".` : ""}
${source === "splitwise" ? `This is a Splitwise expense notification. payment_type is always "Splitwise". Extract a clean description from the expense name (strip group names, "added an expense", etc.). Category based on the expense type.` : ""}

DESCRIPTION STYLE GUIDE:
- Rakuten cashback: "Rakuten - {StoreName}" (e.g., "Rakuten - Vrbo", "Rakuten - Chewy")
- Venmo: "Venmo - {Person} ({Note})"

CATEGORIES: entertainment, food, groceries, restaurant, home, rent, furniture, health, personal, clothes, tech, transportation, utilities, financial, other, income

SERVICE PERIOD RULES (user forwarding note takes priority over email content):
- "spread over march" → start=first day of March in the reference year, end=last day of March
- "annual subscription" or "yearly" → start=reference date, end=reference date + 365 days
- "monthly subscription" or "monthly" → start=first day of reference month, end=last day of reference month
- "service 3/1-3/31" → start=2026-03-01, end=2026-03-31 (use reference year if year omitted)
- "30 days from today" → start=reference date, end=reference date + 29 days
- "Q1 2026" → start=2026-01-01, end=2026-03-31
- Only set service_period if you are confident a non-single-day period was intended. Omit otherwise.

SUBSCRIPTION DETECTION:
- Set is_subscription=true if: user note contains "annual", "monthly", "yearly", "subscription", "sub", "recurring"
- OR if the merchant is a known subscription service (Netflix, Spotify, Apple, Amazon Prime, NYT, etc.)
- OR if historical matches show this merchant always appears with service_days > 1
- Otherwise set is_subscription=false

Return ONLY a JSON object:
{
  "desc": "<clean description matching style guide>",
  "cat": "<category_id>",
  "conf": "high|medium|low",
  "tag": "<tag if mentioned, null otherwise>",
  "service_period": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "description": "<reason>"},
  "is_subscription": false
}

Notes:
- Omit "service_period" key entirely if no service period was detected (do not set to null)
- Look for trip names, location references, or event names → those become tags
- For Rakuten, description should be "Rakuten - {Store}" not the full forwarding note
- Extract the actual store/merchant name from the note or email context`;

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
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(`AI forwarding note error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) return null;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("AI forwarding note interpretation failed:", e);
    return null;
  }
}

function buildEnrichmentPrompt(
  source: string,
  parsed: ParsedEmail,
  forwardingNote: ForwardingNote | null,
  history: HistoricalMatch[],
  servicePeriodHint: string | null,
): string {
  const refDate = parsed.date || new Date().toISOString().slice(0, 10);
  const historyBlock = formatHistoryContext(history);

  let prompt = `You are a personal finance assistant. Given this ${source} transaction, assign a category and detect subscription/service period.

CATEGORIES: entertainment, food, groceries, restaurant, home, rent, furniture, health, personal, clothes, tech, transportation, utilities, financial, other, income

REFERENCE DATE (transaction date): ${refDate}

Transaction:
- Description: ${parsed.description}
- Amount: $${Math.abs(parsed.amount_usd || 0)}
- Direction: ${parsed.parsed_data.direction}
- Note: "${parsed.parsed_data.note || ""}"
- Counterparty: ${parsed.parsed_data.counterparty}`;

  if (forwardingNote?.descriptionHint || forwardingNote?.raw) {
    prompt += `\n- User's forwarding note (STRONG hint): "${forwardingNote.descriptionHint || forwardingNote.raw}"`;
  }

  if (servicePeriodHint) {
    prompt += `\n- Service period hint from user: "${servicePeriodHint}"`;
  }

  prompt += `

HISTORICAL MATCHES (similar past transactions — use for pattern matching):
${historyBlock}

SERVICE PERIOD RULES (user forwarding note takes priority):
- "spread over march" → start=first day of March, end=last day of March (use reference year)
- "annual subscription" or "yearly" → start=reference date, end=reference date + 365 days
- "monthly subscription" or "monthly" → start=first day of reference month, end=last day of reference month
- "service 3/1-3/31" → start=YYYY-03-01, end=YYYY-03-31
- "30 days" → start=reference date, end=reference date + 29 days
- Omit service_period entirely if no non-single-day period was intended

SUBSCRIPTION DETECTION:
- Set is_subscription=true if user note contains "annual", "monthly", "yearly", "subscription"
- OR if counterparty/description is a known subscription service
- OR if historical matches show recurring service_days > 1 patterns
- Otherwise false

Return ONLY a JSON object:
{"cat": "<category_id>", "conf": "high|medium|low", "desc": "<optionally improved description>", "service_period": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "description": "<reason>"}, "is_subscription": false}

Rules:
- If the note clearly indicates a category (e.g. "groceries", "dinner"), use high confidence
- If the counterparty is a known business type, use medium confidence
- If ambiguous, use "other" with low confidence
- For "received" direction, always use "income" with high confidence
- Omit "service_period" key entirely if not applicable`;

  return prompt;
}

function buildUnknownEmailPrompt(
  subject: string,
  textBody: string,
  forwardingNote: ForwardingNote | null,
  history: HistoricalMatch[],
  servicePeriodHint: string | null,
  refDate: string | null,
): string {
  const dateRef = refDate || new Date().toISOString().slice(0, 10);
  const historyBlock = formatHistoryContext(history);

  let prompt = `You are a personal finance assistant. Extract a financial transaction from this email.

CATEGORIES: entertainment, food, groceries, restaurant, home, rent, furniture, health, personal, clothes, tech, transportation, utilities, financial, other, income

KNOWN PAYMENT TYPES: Chase Chequing, Chase Sapphire, Chase Freedom, AMEX Rose Gold, Bilt, Venmo, Rakuten, Apple, Capital One, Uber, and others.

REFERENCE DATE (use for resolving relative dates): ${dateRef}

Email subject: ${subject}
Email body (first 2000 chars): ${(textBody || "").slice(0, 2000)}`;

  if (forwardingNote?.descriptionHint || forwardingNote?.raw) {
    prompt += `\nUser's forwarding note (STRONG hint — often contains category, tag, or description context): "${forwardingNote.descriptionHint || forwardingNote.raw}"`;
  }

  if (servicePeriodHint) {
    prompt += `\nService period hint from user note: "${servicePeriodHint}"`;
  }

  prompt += `

HISTORICAL MATCHES (similar past transactions — use for pattern matching):
${historyBlock}

SERVICE PERIOD RULES:
- "spread over march" → start=first day of March in reference year, end=last day of March
- "annual subscription" or "yearly" → start=reference date, end=reference date + 365 days
- "monthly subscription" or "monthly" → start=first day of reference month, end=last day of reference month
- "service 3/1-3/31" → start=YYYY-03-01, end=YYYY-03-31 (use reference year if year omitted)
- "30 days from today" → start=reference date, end=reference date + 29 days
- "Q1 2026" → start=2026-01-01, end=2026-03-31
- For monthly subscription charges, spread over the full service month even without a user hint
- Only set service_period when confident. Omit the key entirely if not applicable.

SUBSCRIPTION DETECTION:
- Set is_subscription=true if:
  - User note contains "annual", "monthly", "yearly", "subscription", "sub", "recurring"
  - Email is from a known subscription service (Netflix, Spotify, Apple, Amazon Prime, Adobe, NYT, Hulu, Disney+, etc.)
  - Historical matches show this merchant with service_days > 1 regularly
  - Email subject/body mentions "renewal", "billing cycle", "next billing date"
- Otherwise set is_subscription=false

If this email contains a financial transaction, extract it.
If not a financial email, return {"is_transaction": false}.

IMPORTANT:
- If the user's forwarding note mentions a trip name or location (e.g., "cozumel", "japan"), extract it as a tag.
- If the email is from Rakuten about cashback, use payment_type "Rakuten" and category "income".
- The description should be clean and match patterns like "Rakuten - Vrbo" or "Venmo - PersonName".

Return ONLY a JSON object:
{
  "is_transaction": true,
  "date": "YYYY-MM-DD",
  "description": "Clean description",
  "amount_usd": 123.45,
  "category_id": "<category>",
  "confidence": "high|medium|low",
  "payment_type": "<best guess payment account>",
  "source_hint": "<what service sent this email>",
  "tag": "<trip/event tag if mentioned in forwarding note, null otherwise>",
  "service_period": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "description": "<reason>"},
  "is_subscription": false
}

Omit "service_period" key entirely if no service period was detected.`;

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

  // AI enrichment: description, category, tag improvements
  const ai_category = aiResult?.cat || (base.category_id as string) || null;
  const ai_confidence = aiResult?.conf || aiResult?.confidence || (base.category_id ? "medium" : "low");
  const ai_description = aiResult?.desc || (base.description as string) || null;

  // AI-extracted tag (from forwarding note interpretation)
  const ai_tag = aiResult?.tag || null;

  // Forwarding note overrides (highest priority for explicit structured hints)
  let finalPaymentType = base.payment_type || null;
  let finalTag = ai_tag || (base.tag as string) || "";

  // Forwarding note structured hints override AI
  if (forwardingNote?.paymentType) finalPaymentType = forwardingNote.paymentType;
  if (forwardingNote?.tag) finalTag = forwardingNote.tag;

  // Merge forwarding_note into parsed_data
  const parsedData = (base.parsed_data as Record<string, unknown>) || {};
  if (forwardingNote?.raw) parsedData.forwarding_note = forwardingNote.raw;

  // For Rakuten: AI forwarding note interpreter returns clean "Rakuten - {Store}" → prefer it.
  const finalDescription = (source === "rakuten")
    ? (ai_description || (base.description as string))
    : (ai_description || (base.description as string) || emailMeta.email_subject);

  // Apply AI-detected service period (highest priority — overrides parser defaults)
  if (aiResult?.service_period?.start && aiResult.service_period.end) {
    const amount = (base.amount_usd as number | null) ?? null;
    const sp = computeServicePeriod(aiResult.service_period.start, aiResult.service_period.end, amount);
    base.service_start = sp.service_start;
    base.service_end = sp.service_end;
    base.service_days = sp.service_days;
    base.daily_cost = sp.daily_cost;
    // Log the AI's reasoning into parsed_data for audit
    parsedData.ai_service_period = aiResult.service_period;
  }

  // Subscription flag
  const is_subscription = aiResult?.is_subscription ?? false;

  return {
    source,
    status: (source === "unknown" && !aiResult?.is_transaction) ? "skipped" : "pending",
    date: base.date || null,
    description: finalDescription,
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
    is_subscription,
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
    forwarding_note: forwardingNote?.raw || null,
    forwarding_category: forwardingNote?.category || null,
    forwarding_hint: forwardingNote?.descriptionHint || null,
  };
}

// ═══════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Validate webhook secret
  const reqSecret = req.headers.get("X-Webhook-Secret");
  if (WEBHOOK_SECRET && reqSecret && reqSecret !== WEBHOOK_SECRET) {
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

  // 3.5. Insight feedback reply handler
  // If this is a reply to a daily insight email, extract rating/comment,
  // update insight_log, and optionally distill learnings into insight_context.
  if (subject && /disciplan insight/i.test(subject)) {
    const headers: Array<{ Name: string; Value: string }> = payload.Headers || [];
    const inReplyToHeader = headers.find((h) => h.Name === "In-Reply-To");
    const rawInReplyTo = inReplyToHeader?.Value || payload.InReplyTo || "";
    // Strip angle brackets and @domain — Postmark sends Message-ID as <uuid@smtp.postmarkapp.com>
    // but stores just the uuid in insight_log.postmark_message_id
    const inReplyTo = rawInReplyTo.replace(/^<|>$/g, "").split("@")[0].trim();

    // Extract rating: match "8/10", "7.5/10", "9 /10", etc.
    const ratingMatch = (textBody || "").match(/(\d+(?:\.\d+)?)\s*\/\s*10/i);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Extract comment: everything after the rating on the same line, or all non-quoted lines
    let comment: string | null = null;
    if (textBody) {
      const lines = textBody.split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l && !l.startsWith(">") && !/^on .+wrote:/i.test(l));
      const commentLines = lines.filter((l: string) => !/^\d+(\.\d+)?\s*\/\s*10/.test(l));
      // Also grab trailing text on the rating line itself
      if (ratingMatch) {
        const ratingLine = lines.find((l: string) => /\d+(\.\d+)?\s*\/\s*10/.test(l)) || "";
        const afterRating = ratingLine.replace(/\d+(\.\d+)?\s*\/\s*10/i, "").replace(/^[\s\-–:]+/, "").trim();
        if (afterRating) commentLines.unshift(afterRating);
      }
      const joined = commentLines.join(" ").trim();
      if (joined) comment = joined.slice(0, 2000);
    }

    if (inReplyTo) {
      const { data: matchedLog } = await supabase
        .from("insight_log")
        .select("id, insight_type")
        .eq("postmark_message_id", inReplyTo)
        .limit(1);

      if (matchedLog?.length) {
        const logId = matchedLog[0].id;
        const insightType = matchedLog[0].insight_type;

        await supabase.from("insight_log").update({
          feedback_rating: rating,
          feedback_comment: comment,
          feedback_received_at: new Date().toISOString(),
        }).eq("id", logId);

        // Phase 4: feed the rating into the bandit's aggregates atomically.
        // RPC clamps weight delta to ±0.10 and bounds priority_weight to [0.1, 2.0]
        // so a single bad rating cannot zero out an archetype.
        if (rating != null && insightType && insightType !== "parse_fallback") {
          try {
            await supabase.rpc("apply_strategy_feedback", {
              p_insight_type: insightType,
              p_rating: rating,
            });
          } catch (e) {
            console.error("apply_strategy_feedback RPC error:", e);
          }
        }

        // Distill substantive feedback into a *pending* principles update.
        // Guardrails: the inbound reply is untrusted; never let a single email rewrite the
        // whole principles document. We:
        //   1. Run Haiku to draft an updated principles document.
        //   2. Auto-reject if length-delta vs current > 30% (prompt-injection / rewrite attempt).
        //   3. Auto-reject if the proposed text begins with banned override phrases.
        //   4. Otherwise queue into principles_pending for operator review (AI portal).
        if (ANTHROPIC_KEY && comment && comment.length > 20) {
          try {
            const { data: ctxRows } = await supabase
              .from("insight_context")
              .select("content")
              .eq("id", "principles")
              .limit(1);
            const currentPrinciples = ctxRows?.[0]?.content || "";

            const distillRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 800,
                messages: [{
                  role: "user",
                  content: `You maintain a principles document for an AI newsletter system.
A user just rated a "${insightType}" insight ${rating ?? "?"}/10 and left this comment:
"${comment}"

Current principles document:
---
${currentPrinciples}
---

If the feedback teaches something NEW or REFINES an existing principle, return an updated principles document.
If the feedback is trivial or already covered, return the document unchanged.
Return ONLY the updated document text, no explanation.`,
                }],
              }),
            });

            if (distillRes.ok) {
              const distillData = await distillRes.json();
              const proposed = (distillData.content?.[0]?.text || "").trim();
              if (proposed && proposed !== currentPrinciples) {
                const guardrails = checkPrinciplesGuardrails(currentPrinciples, proposed);
                if (guardrails.ok) {
                  await supabase.from("principles_pending").insert({
                    triggering_log_id: logId,
                    current_principles: currentPrinciples,
                    proposed_principles: proposed,
                    status: "pending",
                  });
                  console.log(`Principles update queued for review (log_id=${logId}, len delta=${proposed.length - currentPrinciples.length}).`);
                } else {
                  await supabase.from("principles_pending").insert({
                    triggering_log_id: logId,
                    current_principles: currentPrinciples,
                    proposed_principles: proposed,
                    rejection_reason: guardrails.reason,
                    status: "auto_rejected",
                  });
                  console.warn(`Principles update auto-rejected (log_id=${logId}): ${guardrails.reason}`);
                }
              }
            }
          } catch (e) {
            console.error("Principles distill error:", e);
          }
        }

        console.log(`Insight feedback recorded: log_id=${logId} rating=${rating} comment="${comment?.slice(0, 80)}"`);
        return new Response(JSON.stringify({ status: "feedback_recorded", log_id: logId, rating, comment }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } else {
        // Reply to a Disciplan Insight email but no matching log row — log and continue
        console.warn(`Insight feedback: no matching log for In-Reply-To: ${inReplyTo}`);
        return new Response(JSON.stringify({ status: "feedback_no_match", in_reply_to: inReplyTo }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

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

  // 4.5. Extract forwarding note
  const forwardingNote = extractForwardingNote(textBody);

  // 5. Detect source and parse
  let source = "unknown";
  let parsed: ParsedEmail | null = null;
  const parseErrors: string[] = [];

  for (const [name, parser] of Object.entries(EMAIL_PARSERS)) {
    if (parser.detect(fromAddr || "", subject || "", textBody || "", htmlBody || "")) {
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

  // 6. AI categorization (passes supabase for history lookup)
  let aiResult: AIResult | null = null;
  try {
    aiResult = await aiCategorize(source, parsed, subject || "", textBody || "", forwardingNote, supabase);
  } catch (e) {
    console.error("AI categorization error:", e);
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

  // 7.5. Fallback date from email received date
  if (!candidate.date && emailDate) {
    const fallbackDate = new Date(emailDate).toISOString().slice(0, 10);
    candidate.date = fallbackDate;
    candidate.service_start = fallbackDate;
    candidate.service_end = fallbackDate;
  }

  // 8. Insert into pending_imports
  const { error } = await supabase.from("pending_imports").insert(candidate);
  if (error) {
    console.error("DB insert error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 9. Success
  return new Response(JSON.stringify({
    status: "ok",
    source,
    forwarding_note: forwardingNote?.raw || null,
    is_subscription: candidate.is_subscription || false,
    service_period: aiResult?.service_period || null,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
