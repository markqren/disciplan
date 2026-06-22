
const SB_URL = "https://mjuannepfodstbsxweuc.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdWFubmVwZm9kc3Ric3h3ZXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzODcwMzksImV4cCI6MjA4Njk2MzAzOX0.6TqLUAhvWMjDunpird0_9FMnDiT4qRuYaH6XbXmKOnA";
// PostgREST schema routing. Stays "public" until 20260513000003_disciplan_schema.sql
// is applied; flip to "disciplan" in the same deploy that runs the schema migration.
// See tasks/disciplan-schema-rollout.md.
const DB_SCHEMA = "disciplan";
const supabaseClient = window.supabase.createClient(SB_URL, SB_KEY, { db: { schema: DB_SCHEMA } });
let currentSession = null;

// ── Multi-user households (FEA: multi-user) ──────────────────────────────
// currentOwner/currentHousehold stay null until a profiles row is loaded for
// the signed-in user. While null, NO owner/household filtering happens and the
// app behaves exactly as the single-user version did (safe before the schema
// migration is applied).
let currentOwner = null;        // 'mark' | 'shilpa' | ...
let currentHousehold = null;    // household_id (bigint)
let currentDisplayName = null;
let householdMembers = [];      // [{owner, display_name}]

// Tables carrying owner + household_id columns (see migration 20260620000001).
const OWNED_TABLES = new Set([
  "transactions","accounts","balance_snapshots","tags",
  "cashback_redemptions","cashback_cards",
  "investment_accounts","investment_symbols","investment_lots",
  "investment_price_history","preferences","pending_imports","group_overrides",
  "ai_rules"
]);

// Active view owner: null = Combined (whole household), else a single owner.
// Returns null unless a household is actually loaded, so a stale persisted view
// can never apply an owner filter before the multi-user migration is in place.
function scopeOwner(){
  if(!state || !state.view || state.view === "combined") return null;
  if(currentHousehold == null) return null;
  return state.view;
}

// PostgREST filter fragment for REST list queries. Always starts with '&'.
function ownerQS(){
  const o = scopeOwner();
  let qs = "";
  if(currentHousehold != null) qs += `&household_id=eq.${currentHousehold}`;
  if(o != null) qs += `&owner=eq.${encodeURIComponent(o)}`;
  return qs;
}

// PostgREST filter scoped to the *importing* user (currentOwner), regardless of
// the active header view. Used for AI personalization inputs (merchant patterns,
// sample descriptions, rules) so an import learns from the person receiving it.
function importerQS(){
  let qs = "";
  if(currentHousehold != null) qs += `&household_id=eq.${currentHousehold}`;
  if(currentOwner != null) qs += `&owner=eq.${encodeURIComponent(currentOwner)}`;
  return qs;
}

// RPC dispatcher: Combined → original RPC (untouched, guaranteed-correct);
// single-person → the *_scoped variant with owner/household params.
async function scopedRPC(baseFn, params = {}){
  const o = scopeOwner();
  if(o == null) return sbRPC(baseFn, params);
  return sbRPC(baseFn + "_scoped", { ...params, p_owner: o, p_household_id: currentHousehold });
}

// Load the signed-in user's profile + household roster. Fails silently so the
// app still works if the schema migration has not been applied yet.
async function loadProfile(){
  currentOwner = currentHousehold = currentDisplayName = null;
  householdMembers = [];
  const uid = currentSession?.user?.id;
  if(!uid) return;
  try{
    const me = await sb(`profiles?auth_uid=eq.${uid}&select=owner,household_id,display_name&limit=1`);
    if(me && me.length){
      currentOwner = me[0].owner;
      currentHousehold = me[0].household_id;
      currentDisplayName = me[0].display_name;
      const roster = await sb(`profiles?household_id=eq.${currentHousehold}&select=owner,display_name&order=display_name`);
      householdMembers = roster || [];
    }
  }catch(e){ /* legacy single-user mode: no filtering */ }
}
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function authHeaders(extra = {}) {
  const token = currentSession?.access_token || SB_KEY;
  return {"apikey":SB_KEY,"Authorization":`Bearer ${token}`,"Content-Type":"application/json","Accept-Profile":DB_SCHEMA,"Content-Profile":DB_SCHEMA,...extra};
}

// Cache helpers for offline fallback (FEA-32)
// CACHE_VERSION namespaces persisted localStorage caches. Bump it whenever an RPC
// or response shape changes so stale entries are ignored instead of mis-rendered (INF-06).
const CACHE_VERSION="v2";
const CACHE_PREFIX="dc_"+CACHE_VERSION+"_";
// One-time purge of caches written by older CACHE_VERSIONs (iterate backwards: removeItem shifts indices).
(function purgeStaleCache(){try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k&&k.startsWith("dc_")&&!k.startsWith(CACHE_PREFIX))localStorage.removeItem(k)}}catch(e){}})();
function cacheSet(key,data){try{localStorage.setItem(CACHE_PREFIX+key,JSON.stringify({ts:Date.now(),data}))}catch(e){
  if(e.name==='QuotaExceededError'){const entries=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith(CACHE_PREFIX)){try{entries.push([k,JSON.parse(localStorage.getItem(k)).ts||0])}catch{}}}entries.sort((a,b)=>a[1]-b[1]);const n=Math.max(1,Math.floor(entries.length*0.25));for(let i=0;i<n;i++)localStorage.removeItem(entries[i][0]);try{localStorage.setItem(CACHE_PREFIX+key,JSON.stringify({ts:Date.now(),data}))}catch{}}
}}
function cacheGet(key){try{const raw=localStorage.getItem(CACHE_PREFIX+key);return raw?JSON.parse(raw):null}catch(e){return null}}
function showOfflineBanner(ts){
  const el=document.getElementById("offlineBanner");
  if(el){
    const ago=Math.round((Date.now()-ts)/60000);
    document.getElementById("offlineTs").textContent=ago<1?"just now":ago<60?`${ago}m ago`:`${Math.round(ago/60)}h ago`;
    el.classList.remove("hidden");
  }
}

async function sb(path,opts={}){
  const{headers:hd,...rest}=opts;
  const method=(rest.method||"GET").toUpperCase();
  // Auto-stamp owner/household_id on inserts into owner-bearing tables.
  if(method==="POST"&&rest.body&&currentOwner!=null){
    const table=path.split("?")[0];
    if(OWNED_TABLES.has(table)){
      try{
        let b=JSON.parse(rest.body);
        const stamp=o=>{if(o&&typeof o==="object"){if(o.owner===undefined)o.owner=currentOwner;if(o.household_id===undefined)o.household_id=currentHousehold}return o};
        b=Array.isArray(b)?b.map(stamp):stamp(b);
        rest.body=JSON.stringify(b);
      }catch(e){/* non-JSON body: leave as-is */}
    }
  }
  try{
    const r=await fetch(`${SB_URL}/rest/v1/${path}`,{...rest,headers:{...authHeaders(),...(hd||{})}});
    if(!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    const txt=await r.text();
    const data=txt?JSON.parse(txt):[];
    if(method==="GET") cacheSet(path,data);
    return data;
  }catch(e){
    if(method==="GET"){const cached=cacheGet(path);if(cached){showOfflineBanner(cached.ts);return cached.data;}}
    throw e;
  }
}
async function sbRPC(fn,params={}){
  const cacheKey=`rpc_${fn}_${JSON.stringify(params)}`;
  try{
    const r=await fetch(`${SB_URL}/rest/v1/rpc/${fn}`,{method:"POST",headers:authHeaders(),body:JSON.stringify(params)});
    if(!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    const data=await r.json();
    cacheSet(cacheKey,data);
    return data;
  }catch(e){
    const cached=cacheGet(cacheKey);
    if(cached){showOfflineBanner(cached.ts);return cached.data;}
    throw e;
  }
}


function getApiKey(){return localStorage.getItem("anthropic_api_key")}
function setApiKey(key){localStorage.setItem("anthropic_api_key",key)}
function clearApiKey(){localStorage.removeItem("anthropic_api_key")}
function getAIModel(){return localStorage.getItem("ai_model")||"claude-haiku-4-5-20251001"}
function setAIModel(m){localStorage.setItem("ai_model",m)}

// AI is available if the user set a personal key OR is logged in (then we proxy
// through the auth-gated ai-categorize Edge Function using the household's key).
function aiAvailable(){return !!(getApiKey()||currentSession?.access_token)}

// Single entry point for Claude calls. A personal key (if set) calls Anthropic
// directly; otherwise we route through the Edge Function so the shared key never
// reaches the browser. Returns a fetch Response with Anthropic's JSON shape.
async function callClaude(body){
  const key=getApiKey();
  if(key){
    return fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify(body)});
  }
  const token=currentSession?.access_token||SB_KEY;
  return fetch(`${SB_URL}/functions/v1/ai-categorize`,{method:"POST",headers:{"Authorization":`Bearer ${token}`,"apikey":SB_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
}
