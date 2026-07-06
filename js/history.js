// History & Undo panel (FEA: Adobe-style change history)
//
// Slide-out panel, openable from any tab, that lists every recorded change from
// disciplan.audit_log (see 20260629043949_audit_ledger.sql). Each user action is
// one group (all rows sharing a txid). Two revert actions per group:
//   • "Revert to here" — undo everything AFTER this action (atomic, server-side
//     revert_to). Returns the data to the state right after this action.
//   • "Revert just this" — undo only this action (revert_operation). Warns when a
//     newer change touched the same row, since that would be overwritten.
// Reverts are themselves audited, so undo is redoable and the log is append-only.

const OP_VERB = { INSERT: "Added", UPDATE: "Edited", DELETE: "Deleted" };
const OP_COLOR = { INSERT: "var(--g)", UPDATE: "var(--y)", DELETE: "var(--r)" };

const TABLE_NOUN = {
  transactions: "transaction", accounts: "account", tags: "tag",
  balance_snapshots: "balance snapshot", cashback_redemptions: "cashback redemption",
  cashback_cards: "cashback card", investment_accounts: "investment account",
  investment_symbols: "investment symbol", investment_lots: "investment lot",
  investment_price_history: "price record", preferences: "preference",
  group_overrides: "group override", ai_rules: "AI rule",
  pending_imports: "pending import", splitwise_friend_map: "Splitwise mapping"
};
const HIST_MONEY_COLS = new Set(["amount_usd", "balance_usd", "daily_cost"]);
const HIST_DATE_COLS = new Set(["date", "service_start", "service_end", "snapshot_date", "start_date", "end_date"]);
const HIST_SKIP_COLS = new Set(["updated_at", "daily_cost", "service_days", "owner", "household_id"]);

function histNoun(t, n) { const s = TABLE_NOUN[t] || t.replace(/_/g, " "); return n === 1 ? s : s + "s"; }
function histQuote(s) { return "\u201C" + s + "\u201D"; }
function histColLabel(c) { return c.replace(/_usd$/, "").replace(/_/g, " "); }

function histFmtVal(col, v) {
  if (v == null || v === "") return "\u2014";
  if (HIST_MONEY_COLS.has(col)) return fmtF(Number(v));
  if (HIST_DATE_COLS.has(col)) return fmtD(v);
  const s = String(v);
  return s.length > 20 ? s.slice(0, 20) + "\u2026" : s;
}

function histRowLabel(table, data) {
  if (!data) return histNoun(table, 1);
  if (table === "transactions") return histQuote(data.description || ("txn #" + data.id));
  if (table === "tags") return histQuote(data.name || data.tag || ("tag #" + data.id));
  if (table === "accounts") return histQuote(data.name || data.id);
  if (table === "cashback_cards") return histQuote(data.name || data.card_name || ("card #" + data.id));
  if (table === "cashback_redemptions") return "cashback " + (data.amount_usd != null ? fmtF(data.amount_usd) : "");
  if (table === "balance_snapshots") return histNoun(table, 1) + (data.account_id ? " (" + data.account_id + ")" : "");
  return histNoun(table, 1) + " #" + (data.id != null ? data.id : "?");
}

function histFieldChanges(e) {
  const cols = (e.changed_cols || []).filter(c => !HIST_SKIP_COLS.has(c));
  if (!cols.length) return "";
  const parts = cols.slice(0, 3).map(c => {
    const o = e.old_data ? e.old_data[c] : null;
    const n = e.new_data ? e.new_data[c] : null;
    return histColLabel(c) + ": " + histFmtVal(c, o) + " \u2192 " + histFmtVal(c, n);
  });
  return parts.join(" \u00b7 ") + (cols.length > 3 ? " +" + (cols.length - 3) + " more" : "");
}

function describeHistEntry(e) {
  const data = e.new_data || e.old_data;
  const label = histRowLabel(e.table_name, data);
  let detail = "";
  if (e.op === "UPDATE") detail = histFieldChanges(e);
  else if (e.table_name === "transactions" && data) detail = fmtF(data.amount_usd) + " \u00b7 " + fmtD(data.date);
  else if (e.table_name === "balance_snapshots" && data) detail = fmtF(data.balance_usd) + " \u00b7 " + fmtD(data.snapshot_date);
  return { title: OP_VERB[e.op] + " " + label, detail };
}

function histGroupDetail(entries) {
  if (entries[0].table_name === "transactions") {
    const sum = entries.reduce((s, e) => { const d = e.new_data || e.old_data; return s + (d && d.amount_usd != null ? Number(d.amount_usd) : 0); }, 0);
    return "total " + fmtF(sum);
  }
  return "";
}

function describeHistGroup(g) {
  const e = g.entries;
  if (e.length === 1) return describeHistEntry(e[0]);
  const tables = new Set(e.map(x => x.table_name));
  const ops = new Set(e.map(x => x.op));
  if (tables.size === 1 && ops.size === 1) {
    return { title: OP_VERB[[...ops][0]] + " " + e.length + " " + histNoun([...tables][0], e.length), detail: histGroupDetail(e) };
  }
  return { title: e.length + " changes", detail: [...tables].map(t => histNoun(t, 2)).join(", ") };
}

function histCommonOp(g) { const ops = new Set(g.entries.map(e => e.op)); return ops.size === 1 ? [...ops][0] : null; }

function histTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

async function loadAuditLog(limit) {
  const sel = "id,table_name,row_id,op,changed_cols,old_data,new_data,owner,actor,txid,reverted_at,created_at";
  return await sb("audit_log?select=" + sel + "&order=id.desc&limit=" + (limit || 300));
}

// Rows arrive newest-first (id desc); bucket contiguous rows by txid preserving order.
function groupHistByTxid(rows) {
  const groups = [];
  const idx = new Map();
  for (const r of rows) {
    let g = idx.get(r.txid);
    if (!g) { g = { txid: r.txid, entries: [], maxId: r.id }; idx.set(r.txid, g); groups.push(g); }
    g.entries.push(r);
  }
  return groups;
}

const _histState = { limit: 300 };

function histEsc(e) { if (e.key === "Escape") closeHistoryPanel(); }

function closeHistoryPanel() {
  document.removeEventListener("keydown", histEsc);
  const ov = document.querySelector(".hist-ov");
  if (!ov) return;
  ov.classList.remove("open");
  const p = ov.querySelector(".hist-panel");
  if (p) p.classList.remove("open");
  setTimeout(() => ov.remove(), 250);
}

async function openHistoryPanel() {
  closeHistoryPanel();
  const ov = h("div", { class: "hist-ov", onClick: e => { if (e.target === ov) closeHistoryPanel(); } });
  const panel = h("div", { class: "hist-panel" });
  const hd = h("div", { class: "hist-hd" });
  hd.append(h("div", {}, [
    h("div", { style: { fontSize: "15px", fontWeight: "700", color: "#fff" } }, "History"),
    h("div", { style: { fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "2px" } }, "Every change \u00b7 revert one or roll back to a point")
  ]));
  hd.append(h("button", { class: "ref-btn", style: { fontSize: "18px" }, onClick: closeHistoryPanel }, "\u2715"));
  panel.append(hd);
  const body = h("div", { class: "hist-body" });
  panel.append(body);
  ov.append(panel);
  document.body.append(ov);
  requestAnimationFrame(() => { ov.classList.add("open"); panel.classList.add("open"); });
  document.addEventListener("keydown", histEsc);
  await renderHistoryList(body);
}

async function renderHistoryList(body) {
  body.innerHTML = '<div class="hist-empty">Loading history\u2026</div>';
  let rows;
  try { rows = await loadAuditLog(_histState.limit); }
  catch (e) { body.innerHTML = '<div class="hist-empty" style="color:var(--r)">Could not load history: ' + (e.message || e) + '</div>'; return; }
  if (!rows || !rows.length) {
    body.innerHTML = '<div class="hist-empty">No changes recorded yet. Actions you take from now on show up here, newest first.</div>';
    return;
  }
  const groups = groupHistByTxid(rows);
  // Flag a group when a NEWER, not-yet-reverted change touched one of its rows —
  // reverting just that group would clobber the newer change (walk newest->oldest).
  const seen = new Set();
  for (const g of groups) {
    g.allReverted = g.entries.every(e => e.reverted_at != null);
    g.hasNewerConflict = g.entries.some(e => e.row_id != null && seen.has(e.table_name + "|" + e.row_id));
    g.entries.forEach(e => { if (e.reverted_at == null && e.row_id != null) seen.add(e.table_name + "|" + e.row_id); });
  }
  body.innerHTML = "";
  groups.forEach((g, i) => body.append(histItem(g, i === 0)));
  if (rows.length >= _histState.limit) {
    body.append(h("div", { class: "hist-empty", style: { fontSize: "11px" } }, "Showing the most recent " + _histState.limit + " changes."));
  }
}

function histItem(g, isNewest) {
  const { title, detail } = describeHistGroup(g);
  const item = h("div", { class: "hist-item" + (g.allReverted ? " reverted" : "") });
  item.style.borderLeftColor = g.allReverted ? "rgba(255,255,255,0.1)" : (OP_COLOR[histCommonOp(g)] || "rgba(255,255,255,0.2)");
  item.append(h("div", { class: "hist-title" }, title));
  if (detail) item.append(h("div", { class: "hist-detail" }, detail));
  const actor = g.entries[0].actor ? " \u00b7 " + g.entries[0].actor : "";
  item.append(h("div", { class: "hist-meta" }, histTime(g.entries[0].created_at) + actor + (g.allReverted ? " \u00b7 reverted" : "")));
  if (!g.allReverted) {
    const acts = h("div", { class: "hist-acts" });
    if (!isNewest) {
      const rt = h("button", { class: "pg-btn", style: { borderColor: "rgba(74,111,165,0.4)", color: "var(--b)" }, onClick: () => doRevertTo(g, rt) }, "\u21ba Revert to here");
      acts.append(rt);
    }
    const ro = h("button", { class: "pg-btn", onClick: () => doRevertOp(g, ro) }, "Revert just this");
    acts.append(ro);
    item.append(acts);
  }
  return item;
}

async function doRevertTo(g, btn) {
  if (!confirm("Revert every change made after this action, returning the data to the state right after it? Reverts are logged too, so you can undo this.")) return;
  await histRun(btn, () => sbRPC("revert_to", { p_id: g.maxId }));
}

async function doRevertOp(g, btn) {
  if (g.hasNewerConflict && !confirm("A newer change touched the same item, so reverting just this action may overwrite that newer change. Continue anyway?")) return;
  await histRun(btn, () => sbRPC("revert_operation", { p_txid: g.txid }));
}

async function histRun(btn, fn) {
  const orig = btn.textContent;
  const acts = btn.parentElement;
  if (acts) acts.querySelectorAll("button").forEach(b => b.disabled = true);
  btn.textContent = "Reverting\u2026";
  try {
    await fn();
    dcClearAll();
    renderContent();
    const body = document.querySelector(".hist-body");
    if (body) await renderHistoryList(body);
  } catch (e) {
    btn.textContent = "Failed";
    alert("Revert failed: " + (e.message || e));
    setTimeout(() => {
      btn.textContent = orig;
      if (acts) acts.querySelectorAll("button").forEach(b => b.disabled = false);
    }, 1500);
  }
}
