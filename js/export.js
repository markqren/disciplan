function renderExport(el){
  el.innerHTML=`<div style="margin-bottom:14px"><h2>Export & Backup</h2><p class="sub">Download data for backup or import to Numbers</p></div>
  <div class="cd"><h3>Export Transactions</h3><p style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:14px">TSV format compatible with your original Numbers spreadsheet.</p>
  <div style="display:flex;flex-wrap:wrap;gap:8px">
    <button onclick="exportTSV('all')" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--g);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)">📋 All Transactions (TSV)</button>
    <button onclick="exportTSV('new')" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--g);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)">🆕 New Only (since import)</button>
    <button onclick="exportTSV('since')" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--b);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)" id="sinceExportBtn">📤 Since Last Export</button>
    <button onclick="exportJSON()" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--g);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)">💾 Full JSON Backup</button>
  </div></div>
  <div class="cd"><h3>Import Status</h3><p style="font-size:12px;color:rgba(255,255,255,0.4)">${state.txnCount.toLocaleString()} transactions in Supabase. Original import: 12,010 rows (Jun 2017 – Feb 2026).</p></div>
  <div class="cd" id="healthCard"><h3>Data Health</h3><p style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:14px">Checks for orphaned groups, accrual math errors, missing tags, and potential duplicates.</p><button onclick="runDataHealthCheck()" id="healthRunBtn" style="display:inline-block;padding:10px 20px;border-radius:10px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--g);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans)">🔍 Run Health Check</button><div id="healthResults" style="margin-top:16px"></div></div>`;
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

async function runDataHealthCheck(){
  const btn=document.getElementById("healthRunBtn");
  const out=document.getElementById("healthResults");
  if(!btn||!out)return;
  btn.textContent="Running...";btn.disabled=true;
  try{
    const res=await sbRPC("run_data_health_check");
    const d=res[0]||res;
    const og=d.orphaned_groups||[];
    const am=d.accrual_mismatches||[];
    const mt=d.missing_tags||[];
    const dup=d.duplicates||[];

    function badge(n){
      return n===0
        ?`<span style="color:#81b29a;font-size:11px;font-weight:600">✓ Clean</span>`
        :`<span style="color:#e9c46a;font-size:11px;font-weight:600">⚠ ${n} issue${n===1?"":"s"}</span>`;
    }
    function row(label,items,renderFn){
      const id="hc_"+label.replace(/\s/g,"_");
      const hasIssues=items.length>0;
      return `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
        <div style="display:flex;align-items:center;gap:10px;cursor:${hasIssues?"pointer":"default"}" ${hasIssues?`onclick="document.getElementById('${id}').classList.toggle('hidden')"`:""}>
          <span style="font-size:12px;color:rgba(255,255,255,0.7);min-width:220px">${label}</span>
          ${badge(items.length)}
          ${hasIssues?`<span style="font-size:10px;color:rgba(255,255,255,0.3)">▼ details</span>`:""}
        </div>
        ${hasIssues?`<div id="${id}" class="hidden" style="margin-top:8px;font-size:11px;font-family:var(--mono);color:rgba(255,255,255,0.5);white-space:pre-wrap;max-height:200px;overflow-y:auto">${items.map(renderFn).join("\n")}</div>`:""}
      </div>`;
    }

    out.innerHTML=
      row("Orphaned groups (1 member)", og, r=>`group_id=${r.group_id}`)
      +row("Accrual mismatches (daily×days ≠ amount)", am, r=>`#${r.id} ${r.date} ${r.description} — amount=${r.amount_usd} computed=${r.computed} (Δ${r.delta})`)
      +row("Tags in transactions missing from tags table", mt, r=>`"${r}"`)
      +`<div style="padding:10px 0">
        <div style="display:flex;align-items:center;gap:10px;cursor:${dup.length?"pointer":"default"}" ${dup.length?`onclick="document.getElementById('hc_dup').classList.toggle('hidden')"`:""}>
          <span style="font-size:12px;color:rgba(255,255,255,0.7);min-width:220px">Potential duplicates</span>
          ${badge(dup.length)}
          ${dup.length?`<span style="font-size:10px;color:rgba(255,255,255,0.3)">▼ details (payslip rows may appear)</span>`:""}
        </div>
        ${dup.length?`<div id="hc_dup" class="hidden" style="margin-top:8px;font-size:11px;font-family:var(--mono);color:rgba(255,255,255,0.5);white-space:pre-wrap;max-height:200px;overflow-y:auto">${dup.map(r=>`×${r.count} ${r.date} ${r.description} ($${r.amount_usd}) [${r.payment_type}]`).join("\n")}</div>`:""}
      </div>`;
  }catch(e){out.innerHTML=`<p style="color:rgba(255,100,100,0.8);font-size:12px">Error: ${e.message}</p>`}
  finally{btn.textContent="🔍 Run Health Check";btn.disabled=false}
}

function dlFile(content,filename,type){
  const blob=new Blob([content],{type});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);
}
