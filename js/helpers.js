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
