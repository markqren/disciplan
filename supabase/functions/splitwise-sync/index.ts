// splitwise-sync — fetch Splitwise expenses and reconcile them against the
// disciplan.splitwise_expenses mapping table (FEA-29B foundation).
//
// What it does NOT do: it never writes to `transactions`. Importing is gated by
// a human review step in the app (Entry tab → Splitwise Sync). This function
// only stages/updates rows in splitwise_expenses, classifying each expense as:
//   - new      -> sync_status='pending'      (raw = latest payload + candidates)
//   - changed  -> sync_status='needs_review' (raw = imported snapshot, pending_raw = new)
//   - deleted  -> sync_status='needs_review' (Splitwise soft-deleted it post-import)
//   - same     -> skip (bump last_synced_at)
//
// Auth: caller must present a valid Supabase *user* access token (same gating as
// the ai-categorize function). The Splitwise API key lives only as the
// SPLITWISE_API_KEY secret — never in the browser. Deploy with --no-verify-jwt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SPLITWISE_API_KEY = Deno.env.get("SPLITWISE_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// PostgREST schema. Must NOT silently fall back to "public" — all Disciplan
// tables live in "disciplan" (see 20260513000003_disciplan_schema.sql).
const DB_SCHEMA = Deno.env.get("DB_SCHEMA") || "disciplan";

const SW_BASE = "https://secure.splitwise.com/api/v3.0";
const DEFAULT_LOOKBACK_DAYS = 180; // initial window when there is no prior sync
const FETCH_LIMIT = 500;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Types (only the Splitwise fields we use) ──
interface SWUserShare {
  user_id?: number;
  user?: { id?: number; first_name?: string; last_name?: string };
  paid_share?: string;
  owed_share?: string;
}
interface SWExpense {
  id: number;
  group_id?: number | null;
  description?: string;
  cost?: string;
  currency_code?: string;
  date?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  payment?: boolean;
  users?: SWUserShare[];
}

// ── Mapping: Splitwise expense → the Disciplan "Splitwise part" candidate ──
// We import ONLY the portion that flows through your Splitwise balance — never
// the full expense (when you paid by card, that charge already arrives via the
// bank/CSV import). For each expense, your net Splitwise effect is paid - owed:
//   - net > 0 (you fronted money, others owe you): a reimbursement CREDIT
//     (negative) for what you're owed. It offsets the matching card charge so
//     the net cost = your own share. The UI suggests linking it to that charge.
//   - net < 0 (someone else paid, you owe your share): a single expense for what
//     you owe, under the "Splitwise" payment type. No card charge to link.
//   - net == 0 (you paid exactly your share / a settle-up): nothing to import.
// category_id is left null so the reviewer (or the linked card txn) sets it.
function shareFor(expense: SWExpense, currentUserId: number): SWUserShare | null {
  if (!Array.isArray(expense.users)) return null;
  return expense.users.find((u) => (u.user_id ?? u.user?.id) === currentUserId) || null;
}

function num(v: string | undefined): number {
  const n = parseFloat(v || "0");
  return isNaN(n) ? 0 : n;
}

function mapExpenseToCandidates(expense: SWExpense, currentUserId: number) {
  const date = (expense.date || expense.created_at || "").slice(0, 10);
  const desc = (expense.description || "Splitwise expense").trim();
  const currency = expense.currency_code || "USD";
  const me = shareFor(expense, currentUserId);
  const paid = num(me?.paid_share);
  const owed = num(me?.owed_share);
  const candidates: Array<Record<string, unknown>> = [];

  // Settle-up payments are balance transfers, not expenses — no candidates.
  if (expense.payment) return candidates;

  const net = Math.round((paid - owed) * 100) / 100; // + owed to me, - I owe
  if (Math.abs(net) < 0.005) return candidates; // no Splitwise effect

  if (net > 0) {
    // Receivable: a credit that offsets the card charge you already paid.
    candidates.push({
      role: "reimburse",
      date,
      description: `Reimbursed - ${desc}`,
      amount_usd: -net,
      category_id: null,
      payment_type: "Splitwise",
      tag: "",
      currency,
      service_start: date,
      service_end: date,
      match_amount: Math.round(paid * 100) / 100, // the card charge to link to
      match_date: date,
    });
  } else {
    // Payable: your owed share, funded via Splitwise (no card charge of yours).
    candidates.push({
      role: "expense",
      date,
      description: desc,
      amount_usd: -net, // owed - paid, positive
      category_id: null,
      payment_type: "Splitwise",
      tag: "",
      currency,
      service_start: date,
      service_end: date,
    });
  }
  return candidates;
}

// Stable hash of the fields that materially affect the imported transaction(s).
// Used as belt-and-suspenders so a cosmetic updated_at bump (no real change)
// does not flag an already-imported expense for review.
function contentHash(expense: SWExpense, currentUserId: number): string {
  const me = shareFor(expense, currentUserId);
  const canon = [
    expense.cost || "",
    (expense.date || "").slice(0, 10),
    (expense.description || "").trim(),
    expense.currency_code || "",
    me?.paid_share || "0",
    me?.owed_share || "0",
    expense.deleted_at ? "del" : "",
    expense.payment ? "pay" : "",
  ].join("|");
  let h = 5381;
  for (let i = 0; i < canon.length; i++) h = ((h << 5) + h + canon.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function rawSnapshot(expense: SWExpense, currentUserId: number) {
  return {
    expense,
    candidates: mapExpenseToCandidates(expense, currentUserId),
    current_user_id: currentUserId,
    content_hash: contentHash(expense, currentUserId),
    fetched_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SPLITWISE_API_KEY) return json({ error: "Server missing SPLITWISE_API_KEY" }, 500);

  // 1. Require a valid logged-in user.
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing auth token" }, 401);
  let user: { id?: string; aud?: string } = {};
  try {
    const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SB_ANON },
    });
    if (!userRes.ok) return json({ error: "Not authenticated" }, 401);
    user = await userRes.json();
  } catch {
    return json({ error: "Auth check failed" }, 401);
  }
  if (!user?.id || user?.aud !== "authenticated") {
    return json({ error: "Not an authenticated user" }, 403);
  }

  const supabase = createClient(SB_URL, SB_SERVICE_KEY, { db: { schema: DB_SCHEMA } });

  // 2. Resolve the importing user's owner/household for row stamping.
  let owner: string | null = null;
  let householdId: number | null = null;
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("owner, household_id")
      .eq("auth_uid", user.id)
      .limit(1);
    if (prof?.length) {
      owner = prof[0].owner ?? null;
      householdId = prof[0].household_id ?? null;
    }
  } catch (_) { /* legacy single-user mode: leave null, table default applies */ }

  // 3. Identify the Splitwise current user.
  let currentUserId: number;
  try {
    const r = await fetch(`${SW_BASE}/get_current_user`, {
      headers: { Authorization: `Bearer ${SPLITWISE_API_KEY}` },
    });
    if (!r.ok) return json({ error: "Splitwise auth failed", detail: await r.text() }, 502);
    const d = await r.json();
    currentUserId = d?.user?.id;
    if (!currentUserId) return json({ error: "Could not resolve Splitwise user id" }, 502);
  } catch (e) {
    return json({ error: "Splitwise request failed", detail: String(e) }, 502);
  }

  // 4. Determine the fetch window. Use the latest prior sync to fetch only
  //    expenses created/updated since then (catches edits to old expenses too).
  let updatedAfter: string | null = null;
  try {
    const { data: last } = await supabase
      .from("splitwise_expenses")
      .select("last_synced_at")
      .order("last_synced_at", { ascending: false })
      .limit(1);
    if (last?.length) {
      // 1-day buffer to be safe against clock skew / missed edits.
      updatedAfter = new Date(new Date(last[0].last_synced_at).getTime() - 864e5).toISOString();
    }
  } catch (_) { /* first sync */ }

  const body = await req.json().catch(() => ({}));
  const params = new URLSearchParams({ limit: String(FETCH_LIMIT) });
  if (body?.dated_after) {
    // Explicit user-chosen window forces a date-range fetch (backfill / re-scan),
    // overriding the incremental updated_after default.
    params.set("dated_after", String(body.dated_after));
    if (body?.dated_before) params.set("dated_before", String(body.dated_before));
  } else if (updatedAfter) {
    params.set("updated_after", updatedAfter);
  } else {
    params.set("dated_after", new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 864e5).toISOString());
  }

  // 5. Fetch expenses.
  let expenses: SWExpense[] = [];
  try {
    const r = await fetch(`${SW_BASE}/get_expenses?${params.toString()}`, {
      headers: { Authorization: `Bearer ${SPLITWISE_API_KEY}` },
    });
    if (!r.ok) return json({ error: "Splitwise get_expenses failed", detail: await r.text() }, 502);
    const d = await r.json();
    expenses = Array.isArray(d?.expenses) ? d.expenses : [];
  } catch (e) {
    return json({ error: "Splitwise request failed", detail: String(e) }, 502);
  }

  // 6. Look up existing rows for these expense ids.
  const ids = expenses.map((e) => e.id);
  const existingById = new Map<number, Record<string, unknown>>();
  if (ids.length) {
    try {
      const { data: rows } = await supabase
        .from("splitwise_expenses")
        .select("expense_id, sync_status, content_hash, sw_deleted_at")
        .in("expense_id", ids);
      for (const row of rows || []) existingById.set(row.expense_id as number, row);
    } catch (e) {
      return json({ error: "DB lookup failed", detail: String(e) }, 500);
    }
  }

  // 7. Reconcile.
  const nowIso = new Date().toISOString();
  const counts = { new: 0, changed: 0, deleted: 0, unchanged: 0, skipped: 0, refreshed: 0 };

  for (const expense of expenses) {
    const swUpdated = expense.updated_at || nowIso;
    const swDeleted = expense.deleted_at || null;
    const hash = contentHash(expense, currentUserId);
    const snapshot = rawSnapshot(expense, currentUserId);
    const existing = existingById.get(expense.id);

    if (!existing) {
      // Never seen. Ignore if already deleted, a settle-up payment, or not ours.
      if (swDeleted) { counts.skipped++; continue; }
      if (snapshot.candidates.length === 0) { counts.skipped++; continue; }
      const { error } = await supabase.from("splitwise_expenses").insert({
        expense_id: expense.id,
        owner,
        ...(householdId != null ? { household_id: householdId } : {}),
        sw_updated_at: swUpdated,
        sw_deleted_at: swDeleted,
        content_hash: hash,
        sync_status: "pending",
        raw: snapshot,
        last_synced_at: nowIso,
      });
      if (!error) counts.new++;
      continue;
    }

    const status = existing.sync_status as string;
    const contentChanged = hash !== existing.content_hash;

    if (status === "dismissed") {
      // Re-surface a dismissed expense only when it materially changed (and still
      // has a Splitwise effect). dismissed_at is kept so the card flags it as
      // "previously dismissed". Otherwise leave it dismissed (don't nag).
      if (contentChanged && !swDeleted && snapshot.candidates.length > 0) {
        await supabase.from("splitwise_expenses")
          .update({
            sync_status: "pending",
            sw_updated_at: swUpdated,
            sw_deleted_at: swDeleted,
            content_hash: hash,
            raw: snapshot,
            last_synced_at: nowIso,
          })
          .eq("expense_id", expense.id);
        counts.changed++;
      } else {
        await supabase.from("splitwise_expenses")
          .update({ last_synced_at: nowIso })
          .eq("expense_id", expense.id);
        counts.skipped++;
      }
      continue;
    }

    if (status === "pending") {
      // Not imported yet — just refresh the staged payload to the latest.
      await supabase.from("splitwise_expenses")
        .update({
          sw_updated_at: swUpdated,
          sw_deleted_at: swDeleted,
          content_hash: hash,
          raw: snapshot,
          last_synced_at: nowIso,
        })
        .eq("expense_id", expense.id);
      counts.refreshed++;
      continue;
    }

    if (status === "needs_review") {
      // Already flagged — keep the imported snapshot in raw, refresh pending_raw.
      await supabase.from("splitwise_expenses")
        .update({ pending_raw: snapshot, sw_deleted_at: swDeleted, last_synced_at: nowIso })
        .eq("expense_id", expense.id);
      counts.refreshed++;
      continue;
    }

    // status === 'imported'
    const becameDeleted = !!swDeleted && !existing.sw_deleted_at;
    if (becameDeleted || contentChanged) {
      await supabase.from("splitwise_expenses")
        .update({
          sync_status: "needs_review",
          pending_raw: snapshot,
          sw_deleted_at: swDeleted,
          last_synced_at: nowIso,
        })
        .eq("expense_id", expense.id);
      if (becameDeleted) counts.deleted++; else counts.changed++;
    } else {
      await supabase.from("splitwise_expenses")
        .update({ last_synced_at: nowIso })
        .eq("expense_id", expense.id);
      counts.unchanged++;
    }
  }

  return json({
    status: "ok",
    fetched: expenses.length,
    window: {
      updated_after: params.get("updated_after"),
      dated_after: params.get("dated_after"),
      dated_before: params.get("dated_before"),
    },
    counts,
  });
});
