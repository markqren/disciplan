function fmtN(n){if(n==null||isNaN(n))return"$0";const a=Math.abs(n);let r;if(a>=1e6)r=`$${(a/1e6).toFixed(1)}M`;else if(a>=1e4)r=`$${(a/1e3).toFixed(0)}K`;else if(a>=1e3)r=`$${(a/1e3).toFixed(1)}K`;else r=`$${a.toLocaleString(undefined,{maximumFractionDigits:0})}`;return n<0?`(${r})`:r}
function fmtT(n){if(n==null||isNaN(n))return"$0";const a=Math.abs(n);const r=`$${a.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}`;return n<0?`(${r})`:r}
function fmtF(n){if(n==null||isNaN(n))return"$0.00";const r=`$${Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;return n<0?`(${r})`:r}
function fmtD(d){if(!d)return"";const p=d.split("-");return`${+p[1]}/${+p[2]}/${p[0].slice(2)}`}
function today(){return new Date().toISOString().slice(0,10)}
function startOfMonth(d){const dt=new Date(d+"T00:00:00");return new Date(dt.getFullYear(),dt.getMonth(),1).toISOString().slice(0,10)}
function endOfMonth(d){const dt=new Date(d+"T00:00:00");return new Date(dt.getFullYear(),dt.getMonth()+1,0).toISOString().slice(0,10)}
function addDays(d,n){return new Date(new Date(d+"T00:00:00").getTime()+(n-1)*864e5).toISOString().slice(0,10)}
function getDefStart(cat,d){const r=ACCRUAL_D[cat];if(!r||!d)return d;if(r==="month")return startOfMonth(d);return d}
function getDefEnd(cat,ss){const r=ACCRUAL_D[cat];if(!r||!ss)return ss;if(r==="month")return endOfMonth(ss);return addDays(ss,r)}
function getQuarterlyVestingPeriod(d){const dt=new Date(d+"T00:00:00"),y=dt.getFullYear(),m=dt.getMonth();if(m<3)return{start:`${y}-01-01`,end:`${y}-03-31`};if(m<6)return{start:`${y}-04-01`,end:`${y}-06-30`};if(m<9)return{start:`${y}-07-01`,end:`${y}-09-30`};return{start:`${y}-10-01`,end:`${y}-12-31`}}
function convertMMDDYYYY(s){const p=s.split("/");return`${p[2]}-${p[0].padStart(2,"0")}-${p[1].padStart(2,"0")}`}

function parseCSV(text){
  const s=text.charCodeAt(0)===0xFEFF?text.slice(1):text;
  const lines=[];let cur="",inQ=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='"'){if(inQ&&s[i+1]==='"'){cur+='"';i++}else inQ=!inQ}
    else if(c===","&&!inQ){lines.length?lines[lines.length-1].push(cur):lines.push([cur]);cur=""}
    else if((c==="\n"||(c==="\r"&&s[i+1]==="\n"))&&!inQ){
      if(c==="\r")i++;
      if(lines.length)lines[lines.length-1].push(cur);else lines.push([cur]);
      cur="";lines.push([])
    }else cur+=c;
  }
  if(cur||lines.length&&lines[lines.length-1].length)
    {if(lines.length)lines[lines.length-1].push(cur);else lines.push([cur])}
  const filtered=lines.filter(r=>r.length>1||r[0]!=="");
  if(!filtered.length)return{headers:[],rows:[]};
  const headers=filtered[0].map(v=>v.trim());
  const rows=filtered.slice(1).map(r=>{const o={};headers.forEach((hd,i)=>o[hd]=r[i]?r[i].trim():"");return o})
    .filter(r=>{const vals=Object.values(r);return vals.some(v=>v!=="")&&vals.some(v=>/\d/.test(v))});
  return{headers,rows};
}

function detectBankProfile(headers){
  for(const[k,p]of Object.entries(BANK_PROFILES))if(p.detect(headers))return{name:k,...p};
  return null;
}


function generateGroupLabel(members){
  if(!members.length)return"Linked group";
  // Prefer the primary (non-reimbursement/adjustment) transaction's description
  const secondary=/^(reimburs|cashback|reimb|bill paid|payment)/i;
  const primary=members.find(m=>!secondary.test(m.description)&&m.amount_usd>0)||members.find(m=>!secondary.test(m.description))||members[0];
  if(members.length===2)return primary.description;
  // For 3+ members, check if descriptions are similar
  const descs=members.map(m=>m.description);
  const roots=descs.map(d=>d.split(/\s+/).slice(0,3).join(" ").replace(/\d{1,2}\/\d{1,2}|\d{4}|#\d+/g,"").trim());
  const freq={};roots.forEach(r=>{const k=r.toLowerCase();freq[k]=(freq[k]||0)+1});
  const sorted=Object.entries(freq).sort((a,b)=>b[1]-a[1]);
  const top=sorted[0];
  if(top[1]===members.length)return`${primary.description} x${members.length}`;
  if(top[1]>members.length/2)return`${primary.description} +${members.length-1}`;
  return primary.description+` +${members.length-1}`;
}

function normalizeMerchant(desc){
  return desc.replace(/\s*\([^)]*\)\s*$/,"").replace(/\s*-\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2}.*$/i,"").replace(/^(SQ \*|TST\*|CLIP MX\*|TCB\*)/i,"").trim().toLowerCase().split(/\s+/).slice(0,2).join(" ");
}

// Subscription history drilldown modal (FEA-78)
async function showSubHistory(merchantKey, sampleDesc){
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal",style:{maxWidth:"640px"}});
  // Strip trailing (Month Year) / date suffix from display title
  const title=(sampleDesc||merchantKey).replace(/\s*\([^)]*\)\s*$/,"").replace(/\s*-\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}.*$/i,"").trim();
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px"}});
  hdr.append(h("div",{},[h("h3",{style:{margin:0}},title),h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.3)",marginTop:"4px",fontFamily:"var(--mono)"}},"\uD83D\uDD04 "+merchantKey)]));
  hdr.append(h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715"));
  modal.append(hdr);
  const body=h("div",{},[h("div",{style:{color:"rgba(255,255,255,0.3)",fontSize:"12px",textAlign:"center",padding:"32px"}},"Loading...")]);
  modal.append(body);
  bg.append(modal);
  document.body.append(bg);

  try{
    const firstWord=merchantKey.split(" ")[0];
    const all=await sb(`transactions?description=ilike.*${encodeURIComponent(firstWord)}*&order=date.desc&limit=5000&select=id,date,description,amount_usd,category_id,payment_type,service_start,service_end,service_days,daily_cost`);
    const txns=all.filter(t=>normalizeMerchant(t.description)===merchantKey);
    body.innerHTML="";
    if(!txns.length){body.append(h("p",{style:{color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"24px"}},"No matching transactions found."));return}

    // KPIs
    const totalSpend=txns.reduce((s,t)=>s+parseFloat(t.amount_usd),0);
    const firstDate=txns[txns.length-1].date;
    const lastDate=txns[0].date;
    const months=((new Date(lastDate)-new Date(firstDate))/(1000*60*60*24*30.44))+1;
    const monthlyAvg=totalSpend/Math.max(1,months);
    const kpis=h("div",{class:"g4",style:{marginBottom:"14px"}});
    kpis.append(statCard("\uD83D\uDCB5","total spend",fmtN(totalSpend),"var(--b)"));
    kpis.append(statCard("\uD83D\uDD22","occurrences",String(txns.length),"var(--g)"));
    kpis.append(statCard("\uD83D\uDCC5","monthly avg",fmtN(monthlyAvg),"var(--y)"));
    kpis.append(statCard("\uD83D\uDDD3","since",fmtD(firstDate),"rgba(255,255,255,0.5)"));
    body.append(kpis);

    // Table
    const tWrap=h("div",{style:{overflowX:"auto",maxHeight:"360px",overflowY:"auto",borderRadius:"8px",border:"1px solid rgba(255,255,255,0.06)"}});
    const tbl=h("table");
    tbl.innerHTML=`<thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th><th class="hide-m">Payment</th></tr></thead>`;
    const tbody=document.createElement("tbody");
    for(const t of txns){
      const tr=h("tr",{style:{cursor:"pointer"},onClick:async()=>{
        bg.remove();
        const full=await sb(`transactions?id=eq.${t.id}&select=*`);
        if(full.length)openLedgerEditModal(full[0],()=>{});
      }});
      tr.innerHTML=`<td class="m" style="color:rgba(255,255,255,0.5);white-space:nowrap">${fmtD(t.date)}</td>`
        +`<td style="color:rgba(255,255,255,0.8);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description}</td>`
        +`<td class="r m" style="color:${t.amount_usd<0?"var(--g)":"rgba(255,255,255,0.75)"}">${fmtF(t.amount_usd)}</td>`
        +`<td class="hide-m" style="color:rgba(255,255,255,0.4);font-size:11px">${t.payment_type||""}</td>`;
      tbody.append(tr);
    }
    tbl.append(tbody);tWrap.append(tbl);body.append(tWrap);
    body.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.25)",marginTop:"10px",textAlign:"right"}},`${txns.length} transaction${txns.length===1?"":"s"} \u00b7 last charged ${fmtD(lastDate)}`));
  }catch(e){body.innerHTML=`<p style="color:var(--r);text-align:center;padding:24px">Error: ${e.message}</p>`}
}

// Tax transaction detection (FEA-73)
const TAX_RE=/\btax\b|\birs\b|\bftb\b/i;
async function fetchAllTaxTxns(){
  let rows=dcGet('tax_all');
  if(!rows){
    // Fetch all financial-category transactions; filter client-side by description
    rows=await sb("transactions?category_id=eq.financial&order=date.asc&select=id,date,description,amount_usd,payment_type");
    rows=rows.filter(t=>TAX_RE.test(t.description));
    dcSet('tax_all',rows);
  }
  return rows;
}

let creditNames=[];
let _linkScanDone=false;
async function fetchCreditNames(){
  if(creditNames.length)return;
  const rows=await sb("transactions?select=credit&credit=neq.&limit=5000");
  creditNames=[...new Set(rows.map(r=>r.credit).filter(Boolean))].sort();
}

function buildCreditSelect(currentVal){
  const wrap=h("div");
  const sel=h("select",{class:"inp"});
  sel.append(h("option",{value:""},"\u2014 none \u2014"));
  creditNames.forEach(n=>{const o=h("option",{value:n},n);if(n===currentVal)o.selected=true;sel.append(o)});
  sel.append(h("option",{value:"__other__"},"Other\u2026"));
  const txtInp=h("input",{class:"inp",type:"text",placeholder:"Type credit name",style:{display:"none"}});
  sel.addEventListener("change",()=>{
    if(sel.value==="__other__"){sel.style.display="none";txtInp.style.display="";txtInp.focus()}
  });
  wrap.append(sel,txtInp);
  wrap.getValue=()=>{
    if(txtInp.style.display!=="none")return txtInp.value.trim();
    return sel.value==="__other__"?"":sel.value;
  };
  wrap.reset=()=>{sel.value="";sel.style.display="";txtInp.style.display="none";txtInp.value=""};
  return wrap;
}

function h(tag,attrs,children){
  const el=document.createElement(tag);
  if(attrs)for(const[k,v]of Object.entries(attrs)){if(k==="style"&&typeof v==="object")Object.assign(el.style,v);else if(k.startsWith("on"))el.addEventListener(k.slice(2).toLowerCase(),v);else el.setAttribute(k,v)}
  if(children!=null){if(Array.isArray(children))children.forEach(c=>{if(c!=null)el.append(typeof c==="string"?document.createTextNode(c):c)});else if(typeof children==="string")el.textContent=children;else el.append(children)}
  return el;
}

// Global undo toast
let _undoTimer=null;
function showUndo(label,undoFn){
  document.querySelector('.undo-toast')?.remove();
  if(_undoTimer)clearTimeout(_undoTimer);
  const toast=h("div",{class:"undo-toast"});
  toast.append(h("span",{},label));
  const btn=h("button",{onClick:async()=>{
    btn.disabled=true;btn.textContent="Undoing...";
    try{await undoFn();toast.remove()}
    catch(e){btn.textContent="Failed";setTimeout(()=>toast.remove(),2000)}
  }},"Undo");
  const dismiss=h("button",{class:"undo-dismiss",onClick:()=>{if(_undoTimer)clearTimeout(_undoTimer);toast.remove()}},"\u2715");
  toast.append(btn,dismiss);
  document.body.append(toast);
  _undoTimer=setTimeout(()=>toast.remove(),10000);
}

// Chart instances to destroy before recreating
let charts={};
function makeChart(id,cfg){if(charts[id]){charts[id].destroy()}const ctx=document.getElementById(id);if(!ctx)return;charts[id]=new Chart(ctx,cfg)}

// Payslip PDF parsing (FEA-45)
