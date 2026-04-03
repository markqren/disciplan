function renderExport(el){
  el.innerHTML=`<div style="margin-bottom:14px"><h2>Export & Backup</h2><p class="sub">Download data for backup or import to Numbers</p></div>
  <div class="cd"><h3>Export Transactions</h3><p style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:14px">TSV format compatible with your original Numbers spreadsheet.</p>
  <div style="display:flex;flex-wrap:wrap;gap:8px">
    <button onclick="exportTSV('all')" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--g);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)">📋 All Transactions (TSV)</button>
    <button onclick="exportTSV('new')" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--g);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)">🆕 New Only (since import)</button>
    <button onclick="exportTSV('since')" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--b);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)" id="sinceExportBtn">📤 Since Last Export</button>
    <button onclick="exportJSON()" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--g);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)">💾 Full JSON Backup</button>
  </div></div>
  <div class="cd"><h3>Import Status</h3><p style="font-size:12px;color:rgba(255,255,255,0.4)">${state.txnCount.toLocaleString()} transactions in Supabase. Original import: 12,010 rows (Jun 2017 – Feb 2026).</p></div>`;
  const lastId=localStorage.getItem("disciplan_last_export_id");
  const lastDate=localStorage.getItem("disciplan_last_export_date");
  const sinceBtn=document.getElementById("sinceExportBtn");
  if(sinceBtn)sinceBtn.textContent=lastDate?`📤 Since Last Export (${lastDate})`:"📤 Since Last Export (first run)";
}

async function exportTSV(mode){
  try{
    let all=[];let off=0;
    let filter="";
    if(mode==="new")filter="&id=gt.12010";
    else if(mode==="since"){const lastId=localStorage.getItem("disciplan_last_export_id");if(lastId)filter="&id=gt."+lastId}
    const base="transactions?order=date.asc"+filter;
    while(true){const b=await sb(`${base}&limit=1000&offset=${off}`);all=all.concat(b);if(b.length<1000)break;off+=1000}
    if(mode==="since"&&!all.length){alert("No new transactions since last export.");return}
    const pMap={accommodation:"Entertainment",games:"Entertainment",groceries:"Food",restaurant:"Food",rent:"Home",furniture:"Home",clothes:"Personal",tech:"Personal"};
    const lines=["Date\tService Start\tService End\tDescription\tCategory\tOriginal Amount\tCurrency\tAmount USD\tPayment Type\tCredit\tTags\tDaily Cost"];
    for(const t of all){
      const cat=pMap[t.category_id]||(t.category_id?t.category_id[0].toUpperCase()+t.category_id.slice(1):"");
      lines.push([t.date,t.service_start,t.service_end,'"'+t.description.replace(/"/g,'""')+'"',cat,t.original_amount,t.currency,t.amount_usd,t.payment_type,t.credit||"",t.tag||"",t.daily_cost].join("\t"));
    }
    const label=mode==="new"?"new_":mode==="since"?"since_":"";
    dlFile(lines.join("\n"),"disciplan_"+label+"export_"+new Date().toISOString().slice(0,10)+".tsv","text/tab-separated-values");
    // Track last export high-water mark (only for "since" mode)
    if(mode==="since"&&all.length){
      const maxId=Math.max(...all.map(t=>t.id));
      const prev=parseInt(localStorage.getItem("disciplan_last_export_id")||"0");
      if(maxId>prev){localStorage.setItem("disciplan_last_export_id",String(maxId));localStorage.setItem("disciplan_last_export_date",today())}
    }
  }catch(e){alert("Export error: "+e.message)}
}

async function exportJSON(){
  try{
    const [txns,accts,tags,snaps]=await Promise.all([
      sb("transactions?order=date.asc&limit=50000"),sb("accounts?order=id"),sb("tags?order=start_date.desc"),sb("balance_snapshots?order=snapshot_date.desc&limit=500")
    ]);
    dlFile(JSON.stringify({exported:today(),transactions:txns,accounts:accts,tags,balance_snapshots:snaps},null,2),"disciplan_backup_"+new Date().toISOString().slice(0,10)+".json","application/json");
  }catch(e){alert("Export error: "+e.message)}
}

function dlFile(content,filename,type){
  const blob=new Blob([content],{type});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);
}
