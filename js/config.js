
const SB_URL = "https://mjuannepfodstbsxweuc.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdWFubmVwZm9kc3Ric3h3ZXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzODcwMzksImV4cCI6MjA4Njk2MzAzOX0.6TqLUAhvWMjDunpird0_9FMnDiT4qRuYaH6XbXmKOnA";
const supabaseClient = window.supabase.createClient(SB_URL, SB_KEY);
let currentSession = null;
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function authHeaders(extra = {}) {
  const token = currentSession?.access_token || SB_KEY;
  return {"apikey":SB_KEY,"Authorization":`Bearer ${token}`,"Content-Type":"application/json",...extra};
}

// Cache helpers for offline fallback (FEA-32)
const CACHE_PREFIX="dc_";
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
