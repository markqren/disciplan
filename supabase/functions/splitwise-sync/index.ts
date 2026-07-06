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

function round2(v: unknown): number {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// ── Write-back (FEA-29C): create a Splitwise expense from a Disciplan split ──
// The current user paid the full cost; each participant owes their share and the
// user owes the remainder. Supports two payload shapes:
//   - participants: [{ user_id, owed }]   → N-way group split (whole trip)
//   - friend_user_id + friend_owed        → legacy single-friend split
// After creating it, we record a splitwise_expenses mapping row (status='imported')
// so the very next sync recognizes our own write and never re-imports it.
// deno-lint-ignore no-explicit-any
async function handleCreateExpense(
  body: any,
  currentUserId: number,
  supabase: any,
  owner: string,
  householdId: number | null,
  swKey: string,
) {
  const cost = round2(body?.cost);
  if (!(cost > 0)) {
    return json({ error: "Invalid create_expense params (need cost > 0)" }, 400);
  }

  // Normalize both payload shapes into a single participants list (people who
  // owe you a share). "You" (the payer) is handled separately as users[0].
  const rawParts: Array<{ user_id: number; owed: number }> = [];
  if (Array.isArray(body?.participants) && body.participants.length) {
    for (const p of body.participants) {
      const uid = Number(p?.user_id);
      const owed = round2(p?.owed);
      if (uid && uid !== currentUserId && owed > 0) rawParts.push({ user_id: uid, owed });
    }
  } else if (body?.friend_user_id) {
    const uid = Number(body.friend_user_id);
    const owed = round2(body.friend_owed);
    if (uid && uid !== currentUserId && owed > 0) rawParts.push({ user_id: uid, owed });
  }
  if (!rawParts.length) {
    return json({ error: "Invalid create_expense params (need at least one participant with owed > 0)" }, 400);
  }
  // Collapse any duplicate user ids by summing their owed shares (defensive).
  const owedByUser = new Map<number, number>();
  for (const p of rawParts) owedByUser.set(p.user_id, round2((owedByUser.get(p.user_id) || 0) + p.owed));
  const participants = [...owedByUser.entries()].map(([user_id, owed]) => ({ user_id, owed }));

  const othersOwed = round2(participants.reduce((s, p) => s + p.owed, 0));
  if (othersOwed > cost + 0.005) {
    return json({ error: "Participant shares exceed cost" }, 400);
  }
  // The payer absorbs any rounding remainder so all owed_shares sum to cost.
  const yourOwed = round2(cost - othersOwed);

  const date = (body?.date || new Date().toISOString().slice(0, 10)).toString().slice(0, 10);
  const description = (body?.description || "Expense").toString().trim().slice(0, 250) || "Expense";
  const currency = (body?.currency_code || "USD").toString();
  const details = body?.details ? String(body.details).slice(0, 500) : "";
  // group_id 0 (or absent) = a non-group "direct" friend expense.
  const groupId = Number(body?.group_id) > 0 ? Math.trunc(Number(body.group_id)) : 0;

  const form = new URLSearchParams();
  form.set("cost", cost.toFixed(2));
  form.set("description", description);
  form.set("date", date);
  form.set("currency_code", currency);
  form.set("group_id", String(groupId));
  if (details) form.set("details", details);
  // users[0] = current user: paid the whole bill, owes their remaining share.
  form.set("users__0__user_id", String(currentUserId));
  form.set("users__0__paid_share", cost.toFixed(2));
  form.set("users__0__owed_share", yourOwed.toFixed(2));
  // users[1..N] = each participant: paid nothing, owes their share.
  participants.forEach((p, i) => {
    const idx = i + 1;
    form.set(`users__${idx}__user_id`, String(p.user_id));
    form.set(`users__${idx}__paid_share`, "0.00");
    form.set(`users__${idx}__owed_share`, p.owed.toFixed(2));
  });

  let created: SWExpense | null = null;
  try {
    const r = await fetch(`${SW_BASE}/create_expense`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${swKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "Splitwise create_expense failed", detail: d }, 502);
    // Splitwise returns 200 with a populated `errors` object on validation failure.
    if (d?.errors && Object.keys(d.errors).length) {
      return json({ error: "Splitwise rejected the expense", detail: d.errors }, 502);
    }
    created = Array.isArray(d?.expenses) ? d.expenses[0] : null;
    if (!created?.id) return json({ error: "create_expense returned no expense" }, 502);
  } catch (e) {
    return json({ error: "Splitwise request failed", detail: String(e) }, 502);
  }

  // Record the mapping so the next sync won't re-import our own write.
  try {
    await supabase.from("splitwise_expenses").upsert({
      expense_id: created.id,
      owner,
      ...(householdId != null ? { household_id: householdId } : {}),
      sw_updated_at: created.updated_at || new Date().toISOString(),
      sw_deleted_at: null,
      content_hash: contentHash(created, currentUserId),
      sync_status: "imported",
      raw: rawSnapshot(created, currentUserId),
      expense_txn_id: body?.expense_txn_id ?? null,
      reimburse_txn_id: body?.reimburse_txn_id ?? null,
      transaction_group_id: body?.transaction_group_id ?? null,
      first_imported_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "owner,expense_id" });
  } catch (e) {
    // The expense exists in Splitwise; only the dedup bookkeeping failed.
    return json({ status: "ok", expense_id: created.id, warning: "mapping insert failed: " + String(e) });
  }
  return json({ status: "ok", expense_id: created.id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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
  const ownerKey = owner ?? "mark";

  // 2b. Parse body + action up front. set_key must run before we require an
  //     existing key (the user is connecting one).
  const body = await req.json().catch(() => ({}));
  const action = (body && body.action) || "sync";

  // Connect / store this owner's personal Splitwise key (validated first).
  if (action === "set_key") {
    const apiKey = String(body?.api_key || "").trim();
    if (!apiKey) return json({ error: "Missing api_key" }, 400);
    // deno-lint-ignore no-explicit-any
    let swUser: any;
    try {
      const r = await fetch(`${SW_BASE}/get_current_user`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!r.ok) return json({ error: "Invalid Splitwise key", detail: await r.text() }, 400);
      swUser = (await r.json())?.user;
    } catch (e) {
      return json({ error: "Splitwise request failed", detail: String(e) }, 502);
    }
    if (!swUser?.id) return json({ error: "Could not resolve Splitwise user" }, 400);
    const swName = [swUser.first_name, swUser.last_name].filter(Boolean).join(" ") || swUser.email || `User ${swUser.id}`;
    const { error } = await supabase.from("splitwise_accounts").upsert({
      owner: ownerKey,
      ...(householdId != null ? { household_id: householdId } : {}),
      api_key: apiKey,
      sw_user_id: swUser.id,
      sw_name: swName,
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner" });
    if (error) return json({ error: "Failed to store key", detail: error.message }, 500);
    return json({ status: "ok", connected: true, name: swName, sw_user_id: swUser.id });
  }

  // Remove this owner's stored key.
  if (action === "disconnect") {
    try { await supabase.from("splitwise_accounts").delete().eq("owner", ownerKey); } catch (_) { /* ignore */ }
    return json({ status: "ok", connected: false });
  }

  // 3. Resolve this owner's Splitwise key: personal account row, else the
  //    shared env secret (the original default / Mark account).
  let swKey: string | null = null;
  let acctName: string | null = null;
  try {
    const { data } = await supabase.from("splitwise_accounts").select("api_key, sw_name").eq("owner", ownerKey).limit(1);
    if (data?.length && data[0].api_key) { swKey = data[0].api_key; acctName = data[0].sw_name ?? null; }
  } catch (_) { /* no row */ }
  let keySource = "account";
  if (!swKey && SPLITWISE_API_KEY) { swKey = SPLITWISE_API_KEY; keySource = "env"; }

  // Report whether this owner has a usable Splitwise connection (gates UI).
  if (action === "account_status") {
    return json({ status: "ok", connected: !!swKey, name: acctName, source: swKey ? keySource : null });
  }

  if (!swKey) return json({ error: "No Splitwise account connected for this user" }, 400);

  // 4. Identify the Splitwise current user (with the resolved key).
  let currentUserId: number;
  try {
    const r = await fetch(`${SW_BASE}/get_current_user`, {
      headers: { Authorization: `Bearer ${swKey}` },
    });
    if (!r.ok) return json({ error: "Splitwise auth failed", detail: await r.text() }, 502);
    const d = await r.json();
    currentUserId = d?.user?.id;
    if (!currentUserId) return json({ error: "Could not resolve Splitwise user id" }, 502);
  } catch (e) {
    return json({ error: "Splitwise request failed", detail: String(e) }, 502);
  }

  if (action === "friends") {
    try {
      const r = await fetch(`${SW_BASE}/get_friends`, {
        headers: { Authorization: `Bearer ${swKey}` },
      });
      if (!r.ok) return json({ error: "Splitwise get_friends failed", detail: await r.text() }, 502);
      const d = await r.json();
      // deno-lint-ignore no-explicit-any
      const friends = (Array.isArray(d?.friends) ? d.friends : []).map((f: any) => ({
        id: f.id,
        first_name: f.first_name || "",
        last_name: f.last_name || "",
        name: [f.first_name, f.last_name].filter(Boolean).join(" ") || f.email || `Friend ${f.id}`,
      }));
      return json({ status: "ok", friends });
    } catch (e) {
      return json({ error: "Splitwise request failed", detail: String(e) }, 502);
    }
  }

  if (action === "groups") {
    try {
      const r = await fetch(`${SW_BASE}/get_groups`, {
        headers: { Authorization: `Bearer ${swKey}` },
      });
      if (!r.ok) return json({ error: "Splitwise get_groups failed", detail: await r.text() }, 502);
      const d = await r.json();
      // Drop the synthetic id-0 "Non-group expenses" bucket — the UI models that
      // as "No group". Expose full member objects (id + name) so the client can
      // build a per-member split checklist for the whole trip, not just one friend.
      // deno-lint-ignore no-explicit-any
      const groups = (Array.isArray(d?.groups) ? d.groups : [])
        .filter((g: any) => Number(g?.id) > 0)
        .map((g: any) => {
          // deno-lint-ignore no-explicit-any
          const members = (Array.isArray(g.members) ? g.members : []).map((m: any) => ({
            id: m.id,
            first_name: m.first_name || "",
            last_name: m.last_name || "",
            name: [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email || `User ${m.id}`,
          }));
          return {
            id: g.id,
            name: g.name || `Group ${g.id}`,
            member_ids: members.map((m: { id: number }) => m.id),
            members,
          };
        });
      // current_user_id lets the client exclude "you" from the split checklist.
      return json({ status: "ok", groups, current_user_id: currentUserId });
    } catch (e) {
      return json({ error: "Splitwise request failed", detail: String(e) }, 502);
    }
  }

  if (action === "create_expense") {
    return await handleCreateExpense(body, currentUserId, supabase, ownerKey, householdId, swKey);
  }

  // Pre-register a shared Splitwise expense as already-imported for THIS owner,
  // computing the correct content_hash from their perspective so a later sync
  // recognizes it as unchanged and never re-imports it (FEA-29D cross-channel
  // dedup: used when a household-mirrored reimbursement is approved).
  if (action === "register_imported") {
    const expId = Number(body?.expense_id);
    const txnId = body?.txn_id ?? null;
    if (!expId) return json({ error: "Missing expense_id" }, 400);
    try {
      const r = await fetch(`${SW_BASE}/get_expense/${expId}`, { headers: { Authorization: `Bearer ${swKey}` } });
      if (!r.ok) return json({ error: "Splitwise get_expense failed", detail: await r.text() }, 502);
      const exp = (await r.json())?.expense as SWExpense | undefined;
      if (!exp?.id) return json({ error: "Expense not found" }, 404);
      const { error } = await supabase.from("splitwise_expenses").upsert({
        expense_id: exp.id,
        owner: ownerKey,
        ...(householdId != null ? { household_id: householdId } : {}),
        sw_updated_at: exp.updated_at || new Date().toISOString(),
        sw_deleted_at: exp.deleted_at || null,
        content_hash: contentHash(exp, currentUserId),
        sync_status: "imported",
        raw: rawSnapshot(exp, currentUserId),
        expense_txn_id: txnId,
        first_imported_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      }, { onConflict: "owner,expense_id" });
      if (error) return json({ error: "Register failed", detail: error.message }, 500);
      return json({ status: "ok", registered: true });
    } catch (e) {
      return json({ error: "Splitwise request failed", detail: String(e) }, 502);
    }
  }

  // 4. Determine the fetch window. Use the latest prior sync to fetch only
  //    expenses created/updated since then (catches edits to old expenses too).
  let updatedAfter: string | null = null;
  try {
    const { data: last } = await supabase
      .from("splitwise_expenses")
      .select("last_synced_at")
      .eq("owner", ownerKey)
      .order("last_synced_at", { ascending: false })
      .limit(1);
    if (last?.length) {
      // 1-day buffer to be safe against clock skew / missed edits.
      updatedAfter = new Date(new Date(last[0].last_synced_at).getTime() - 864e5).toISOString();
    }
  } catch (_) { /* first sync */ }

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
      headers: { Authorization: `Bearer ${swKey}` },
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
        .eq("owner", ownerKey)
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
        owner: ownerKey,
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
          .eq("owner", ownerKey)
        .eq("expense_id", expense.id);
        counts.changed++;
      } else {
        await supabase.from("splitwise_expenses")
          .update({ last_synced_at: nowIso })
          .eq("owner", ownerKey)
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
        .eq("owner", ownerKey)
        .eq("expense_id", expense.id);
      counts.refreshed++;
      continue;
    }

    if (status === "needs_review") {
      // Already flagged — keep the imported snapshot in raw, refresh pending_raw.
      await supabase.from("splitwise_expenses")
        .update({ pending_raw: snapshot, sw_deleted_at: swDeleted, last_synced_at: nowIso })
        .eq("owner", ownerKey)
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
        .eq("owner", ownerKey)
        .eq("expense_id", expense.id);
      if (becameDeleted) counts.deleted++; else counts.changed++;
    } else {
      await supabase.from("splitwise_expenses")
        .update({ last_synced_at: nowIso })
        .eq("owner", ownerKey)
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
