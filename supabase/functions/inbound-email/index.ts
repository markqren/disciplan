// FEA-39: Inbound Email → pending_imports Edge Function
// Receives Postmark webhook, parses email, writes to staging table.
// Postmark inbound address: 5ec68b0a35fa4f3784a22d2cdc5579cf@inbound.postmarkapp.com

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Environment ──
const WEBHOOK_SECRET = Deno.env.get("INBOUND_EMAIL_SECRET");
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

  // Rakuten cashback is categorized as "income" (it's earned cash back)
  // payment_type = "Rakuten" (the Working Capital account)
  let tag: string | undefined;
  if (forwardingNote?.tag) tag = forwardingNote.tag;

  return {
    date: orderDate,
    description,
    amount_usd: amountUsd,
    category_id: "income",  // Cashback earned = income
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
// AI Categorization
// ═══════════════════════════════════════════════════════

interface AIEnrichmentResult {
  cat?: string;
  conf?: string;
  desc?: string;
  tag?: string;
  payment_type?: string;
  amount_usd?: number;
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

  // For Rakuten with a clear forwarding note, let AI interpret the full context
  // to extract merchant name, tag, and description
  if (source === "rakuten" && forwardingNote?.raw) {
    return await aiInterpretForwardingNote(source, parsed!, forwardingNote, subject, textBody);
  }

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

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("AI categorization failed:", e);
    return null;
  }
}

// New: AI interprets forwarding note in context of the email source
// This is the "smarter" approach — let AI read the full context and decide
async function aiInterpretForwardingNote(
  source: string,
  parsed: ParsedEmail,
  forwardingNote: ForwardingNote,
  subject: string,
  textBody: string,
): Promise<AIResult | null> {
  const prompt = `You are a personal finance assistant helping parse a forwarded financial email.

The user forwarded a ${source} email and added a note before forwarding. Your job is to interpret
the user's note to extract the best description, category, tag, and any other context.

EMAIL SOURCE: ${source}
EMAIL SUBJECT: ${subject}
PARSER-EXTRACTED DATA:
- Description: ${parsed.description}
- Amount: $${Math.abs(parsed.amount_usd || 0)}
- Payment Type: ${parsed.payment_type}
- Date: ${parsed.date || "unknown"}
${parsed.parsed_data.store_name ? `- Store: ${parsed.parsed_data.store_name}` : ""}

USER'S FORWARDING NOTE (text they typed before forwarding):
"${forwardingNote.raw}"

CONTEXT FOR ${source.toUpperCase()}:
${source === "rakuten" ? `This is a Rakuten cashback notification. The amount ($${Math.abs(parsed.amount_usd || 0)}) is cashback EARNED, not the purchase price. The payment_type should always be "Rakuten". The category should be "income" for cashback earned. The description format should be "Rakuten - {StoreName}" matching historical patterns like "Rakuten - Chewy", "Rakuten - Sur la Table", "Rakuten - Vrbo".` : ""}

DESCRIPTION STYLE GUIDE (match this format):
- Rakuten cashback: "Rakuten - {StoreName}" (e.g., "Rakuten - Vrbo", "Rakuten - Chewy")
- Venmo: "Venmo - {Person} ({Note})"

CATEGORIES: entertainment, food, groceries, restaurant, home, rent, furniture, health, personal, clothes, tech, transportation, utilities, financial, other, income

From the user's forwarding note, extract:
1. The best clean description (matching the style guide)
2. A tag (trip/event tag if mentioned, lowercase, e.g., "cozumel")
3. The correct category

Return ONLY a JSON object:
{
  "desc": "<clean description matching style guide>",
  "cat": "<category_id>",
  "conf": "high|medium|low",
  "tag": "<tag if mentioned, null otherwise>"
}

Rules:
- Look for trip names, location references, or event names → those become tags
- "cozumel trip" → tag: "cozumel"
- For Rakuten, the description should be "Rakuten - {Store}" not the full forwarding note
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

KNOWN PAYMENT TYPES: Chase Chequing, Chase Sapphire, Chase Freedom, AMEX Rose Gold, Bilt, Venmo, Rakuten, Apple, Capital One, Uber, and others.

Email subject: ${subject}
Email body (first 2000 chars): ${(textBody || "").slice(0, 2000)}`;

  if (forwardingNote?.descriptionHint || forwardingNote?.raw) {
    prompt += `\nUser's forwarding note (STRONG hint — the user typed this when forwarding, it often contains the category, tag, or description context): "${forwardingNote.descriptionHint || forwardingNote.raw}"`;
  }

  prompt += `

If this email contains a financial transaction (purchase, payment, refund, cashback, subscription charge), extract it.
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
  "tag": "<trip/event tag if mentioned in forwarding note, null otherwise>"
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
  // But fall back to parser description (not email subject) if AI didn't run or failed.
  // For others: AI description is usually better formatted.
  const finalDescription = (source === "rakuten")
    ? (ai_description || (base.description as string))
    : (ai_description || (base.description as string) || emailMeta.email_subject);

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

  // 6. AI categorization
  let aiResult: AIResult | null = null;
  try {
    aiResult = await aiCategorize(source, parsed, subject || "", textBody || "", forwardingNote);
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
  return new Response(JSON.stringify({ status: "ok", source, forwarding_note: forwardingNote?.raw || null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
