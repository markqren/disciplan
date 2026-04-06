async function renderBS(el){
  el.innerHTML=`<div style="margin-bottom:16px"><h2>Balance Sheet</h2><p class="sub">Loading...</p></div><div id="bsBody"></div>`;
  try{
    // Fetch live ledger balances, accounts metadata, and snapshots in parallel
    let bsCache=dcGet('bs');
    if(!bsCache){
      const res=await Promise.all([
        sbRPC("get_ledger_balances"),
        sb("accounts?order=display_order"),
        sb("balance_snapshots?select=*,accounts!inner(label,account_type)&order=snapshot_date.desc"),
        sbRPC("get_credit_balances")
      ]);
      bsCache={ledgerBals:res[0],accts:res[1],snaps:res[2],creditBals:res[3]};
      dcSet('bs',bsCache);
    }
    const {ledgerBals,accts,snaps,creditBals}=bsCache;
    const body=document.getElementById("bsBody");body.innerHTML="";

    // Build account type lookup from accounts table
    const acctMap={};for(const a of accts)acctMap[a.label]=a;

    // Map ledger balances to account types
    const byType={checking:[],savings:[],credit:[],investment:[],liability:[],working_capital:[],other:[]};
    for(const lb of ledgerBals){
      const pt=lb.payment_type;
      if(pt==="Transfer")continue;
      const acct=acctMap[pt];
      const t=acct?.account_type||"other";
      const bal=parseFloat(lb.net_balance)||0;
      // Skip zero-balance retired/inactive accounts
      if(Math.abs(bal)<0.01)continue;
      (byType[t]||byType.other).push({name:pt,bal});
    }
    Object.values(byType).forEach(a=>a.sort((x,y)=>y.bal-x.bal));

    // Process credit sub-ledger balances
    const creditRows=creditBals
      .map(c=>({name:c.credit_name,bal:parseFloat(c.net_balance)||0,cnt:parseInt(c.txn_count)||0}))
      .filter(c=>Math.abs(c.bal)>=0.01);
    const creditTotal=creditRows.reduce((s,c)=>s+c.bal,0);

    // Compute totals — straight sums so KPI cards match group subtotals
    const assetAccts=[...byType.checking,...byType.savings,...byType.investment,...byType.other];
    const liabAccts=[...byType.credit,...byType.working_capital,...byType.liability];
    const totA=assetAccts.reduce((s,a)=>s+a.bal,0);
    const totL=liabAccts.reduce((s,a)=>s+a.bal,0);
    const nw=totA+totL+creditTotal;

    const txnCount=ledgerBals.reduce((s,b)=>s+parseInt(b.txn_count||0),0);
    const fxTag=DFX._live?`CA$1 = US$${DFX.CAD.toFixed(4)} · ${DFX._live}`:`CA$1 = US$${DFX.CAD.toFixed(2)} · default`;
    el.querySelector(".sub").textContent=`Live from ${txnCount.toLocaleString()} ledger transactions · USD · ${fxTag}`;

    const stats=h("div",{class:"g4"});
    stats.append(statCard("🏦","total assets",fmtN(totA),"var(--b)"));
    stats.append(statCard("💳","total liabilities",fmtN(totL),"var(--r)"));
    if(Math.abs(creditTotal)>=1)stats.append(statCard("🤝","credits & transfers",fmtN(creditTotal),"#9B59B6"));
    stats.append(statCard("💎","net worth",fmtN(nw),"var(--g)"));
    body.append(stats);

    // Snapshot bar (for NW over time chart + manual snapshots)
    const snapDates=[...new Set(snaps.map(s=>s.snapshot_date))].sort().reverse();
    const latestSnap=snapDates[0];
    const daysSinceSnap=latestSnap?Math.floor((new Date()-new Date(latestSnap))/864e5):999;
    if(daysSinceSnap>30){
      const banner=h("div",{class:"cd",style:{borderColor:"rgba(242,204,143,0.3)",marginBottom:"16px",padding:"14px 18px"}});
      banner.innerHTML=`<div style="display:flex;align-items:center;gap:10px"><span style="font-size:14px">⚠️</span><span style="font-size:12px;color:var(--y)">Last snapshot was ${daysSinceSnap} days ago. Consider taking a new one to keep your net worth chart current.</span></div>`;
      body.append(banner);
    }
    const snapBar=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px",padding:"10px 16px",background:"rgba(255,255,255,0.02)",borderRadius:"10px",border:"1px solid var(--bdr)"}});
    snapBar.innerHTML=`<div><span style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.6)">Snapshots</span><span style="font-size:11px;color:rgba(255,255,255,0.3);margin-left:8px">${snapDates.length} saved${latestSnap?` · Last: ${fmtD(latestSnap)} (${daysSinceSnap}d ago)`:""}</span></div>`;
    const snapBtn=h("button",{class:"pg-btn",style:{background:"rgba(129,178,154,0.12)",borderColor:"rgba(129,178,154,0.3)",color:"var(--g)",padding:"6px 14px"},onClick:async()=>{
      snapBtn.textContent="Loading...";snapBtn.disabled=true;
      try{const accounts=await sb("accounts?is_active=eq.true&order=display_order");showSnapshotForm(accounts,latestSnap,()=>renderContent(),ledgerBals)}
      catch(e){alert("Error: "+e.message);snapBtn.textContent="📸 Take Snapshot";snapBtn.disabled=false}
    }},"📸 Take Snapshot");
    snapBar.append(snapBtn);
    body.append(snapBar);

    // NW over time (from snapshots — historical data)
    if(snapDates.length>2){
      const nwData=snapDates.sort().map(d=>{
        let a=0,l=0;
        for(const s of snaps){if(s.snapshot_date!==d)continue;const t=s.accounts?.account_type||"other";const b=parseFloat(s.balance_usd||s.balance)||0;if(["checking","savings","investment"].includes(t))a+=b;else if(["credit","liability","working_capital"].includes(t))l+=Math.abs(b)}
        return{d,a,nw:a-l};
      });
      const nwCard=h("div",{class:"cd"});
      nwCard.innerHTML=`<h3>Net Worth Over Time</h3><div class="chrt"><canvas id="nwChart"></canvas></div>`;
      body.append(nwCard);
      setTimeout(()=>makeChart("nwChart",{type:"line",data:{datasets:[
        {label:"Assets",data:nwData.map(d=>({x:d.d,y:Math.round(d.a)})),backgroundColor:"rgba(74,111,165,0.2)",borderColor:"rgba(74,111,165,0.5)",fill:true,tension:0.3},
        {label:"Net Worth",data:nwData.map(d=>({x:d.d,y:Math.round(d.nw)})),borderColor:"#81B29A",backgroundColor:"rgba(129,178,154,0.1)",borderWidth:2.5,pointRadius:2,fill:false,tension:0.3}
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"rgba(255,255,255,0.5)",font:{size:11}}},tooltip:{callbacks:{title:ctx=>fmtD(ctx[0].raw.x),label:ctx=>`${ctx.dataset.label}: ${fmtN(ctx.raw.y)}`}}},scales:{x:{type:"time",time:{unit:"quarter",tooltipFormat:"MMM d, yyyy",displayFormats:{quarter:"MMM yyyy"}},ticks:{color:"rgba(255,255,255,0.3)",font:{size:9},maxTicksLimit:12},grid:{color:"rgba(255,255,255,0.04)"}},y:{ticks:{color:"rgba(255,255,255,0.3)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}}}}}),50);
    }

    // Live ledger account groups
    const row2=h("div",{class:"g2"});
    function acctGroup(title,accts,color){
      if(!accts.length)return"";
      const total=accts.reduce((s,a)=>s+a.bal,0);
      let html=`<div class="acct-grp"><div class="acct-hdr"><span style="font-size:12px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.05em">${title}</span><span style="font-size:13px;font-weight:700;color:${color};font-family:var(--mono)">${fmtF(total)}</span></div>`;
      accts.forEach(a=>{const isTD=a.name.startsWith("TD");const cadRate=DFX.CAD||0.73;const cadVal=isTD?`<span style="color:rgba(255,255,255,0.28);font-size:11px;margin-right:6px;font-family:var(--mono)">CA$${new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.abs(a.bal/cadRate))}</span>`:"";html+=`<div class="acct-row"><span style="color:rgba(255,255,255,0.6)">${a.name}</span><span${isTD?` title="CA$${(a.bal/cadRate).toFixed(2)}"`:""} style="color:rgba(255,255,255,0.7);font-family:var(--mono)">${cadVal}${fmtF(a.bal)}</span></div>`});
      return html+"</div>";
    }
    const assetsCard=h("div",{class:"cd"});
    assetsCard.innerHTML=`<h3 style="color:var(--b)">Assets</h3>`+acctGroup("Cash & Equivalents",[...byType.checking,...byType.savings,...byType.other],"var(--b)")+acctGroup("Investments",byType.investment,"#2A9D8F");
    row2.append(assetsCard);

    const liabCard=h("div",{class:"cd"});
    liabCard.innerHTML=`<h3 style="color:var(--r)">Liabilities</h3>`+acctGroup("Credit Cards",byType.credit,"var(--r)");
    const workCap=[...byType.working_capital,...byType.liability];
    if(workCap.length)liabCard.innerHTML+=acctGroup("Working Capital",workCap,"var(--y)");
    if(!byType.credit.length&&!workCap.length)liabCard.innerHTML+=`<div style="color:rgba(255,255,255,0.2);font-size:12px;padding:20px;text-align:center">No liabilities recorded</div>`
    row2.append(liabCard);
    body.append(row2);

    // Credits & Transfers — standalone expandable card
    if(creditRows.length){
      const ctCard=h("div",{class:"cd",style:{marginTop:"16px"}});
      let credHtml=`<div class="acct-grp"><div class="acct-hdr" style="cursor:pointer" onclick="this.querySelector('.pf-toggle').classList.toggle('open');this.parentElement.querySelectorAll('.credit-sub').forEach(r=>r.classList.toggle('hidden'))"><span style="font-size:12px;font-weight:600;color:#9B59B6;text-transform:uppercase;letter-spacing:0.05em"><span class="pf-toggle">▸</span> Credits & Transfers</span><span style="font-size:13px;font-weight:700;color:#9B59B6;font-family:var(--mono)">${fmtF(creditTotal)}</span></div>`;
      creditRows.forEach(c=>{const clr=c.bal>=0?"var(--g)":"var(--r)";credHtml+=`<div class="acct-row credit-sub hidden"><span style="color:rgba(255,255,255,0.6)" title="${c.cnt} transactions">${c.name}</span><span style="color:${clr};font-family:var(--mono)" title="${c.cnt} txns">${fmtF(c.bal)}</span></div>`});
      credHtml+="</div>";
      ctCard.innerHTML=`<h3 style="color:#9B59B6">Credits & Transfers</h3>`+credHtml;
      body.append(ctCard);
    }
  }catch(e){document.getElementById("bsBody").innerHTML=`<div class="cd" style="border-color:rgba(224,122,95,0.3);color:var(--r)">Error: ${e.message}</div>`}
}

function showSnapshotForm(accounts, lastDate, onSave, liveBals){
  const existing=document.querySelector(".modal-bg");if(existing)existing.remove();
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal",style:{maxWidth:"640px"}});

  // Build lookup: account label → live ledger balance
  const balByLabel={};
  if(liveBals)for(const lb of liveBals){const b=parseFloat(lb.net_balance)||0;if(Math.abs(b)>=0.01)balByLabel[lb.payment_type]=b}

  const groups={checking:[],savings:[],credit:[],investment:[],liability:[]};
  accounts.forEach(a=>(groups[a.account_type]||[]).push(a));
  const typeLabels={checking:"Checking",savings:"Savings",credit:"Credit Cards",investment:"Investments",liability:"Liabilities"};

  let mhtml=`<div style="display:flex;justify-content:space-between;margin-bottom:20px"><div><h2 style="font-size:20px">New Balance Snapshot</h2><p style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:4px">Pre-filled from live ledger balances · edit any values before saving</p></div><button onclick="this.closest('.modal-bg').remove()" style="background:rgba(255,255,255,0.06);border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;color:rgba(255,255,255,0.5);font-size:16px">\u2715</button></div>`;
  mhtml+=`<div style="margin-bottom:16px"><label class="lbl">Snapshot Date</label><input type="date" id="snapDate" class="inp" value="${today()}" style="max-width:200px"></div>`;

  for(const[type,accts]of Object.entries(groups)){
    if(!accts.length)continue;
    mhtml+=`<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">${typeLabels[type]||type}</div>`;
    accts.forEach(a=>{
      const live=balByLabel[a.label];
      const val=live!==undefined?live.toFixed(2):"";
      mhtml+=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:12px;color:rgba(255,255,255,0.6);min-width:160px">${a.label}</span><input type="number" step="0.01" class="inp snap-bal" data-id="${a.id}" value="${val}" placeholder="0.00" style="max-width:160px;font-family:var(--mono)"></div>`;
    });
    mhtml+=`</div>`;
  }
  mhtml+=`<button id="saveSnapBtn" class="btn" style="background:rgba(129,178,154,0.2);color:var(--g);margin-top:12px">Save Snapshot</button>`;

  modal.innerHTML=mhtml;
  bg.append(modal);
  document.body.append(bg);

  document.getElementById("saveSnapBtn").addEventListener("click",async()=>{
    const btn=document.getElementById("saveSnapBtn");
    btn.textContent="Saving...";btn.disabled=true;
    const date=document.getElementById("snapDate").value;
    const rows=[];
    document.querySelectorAll(".snap-bal").forEach(inp=>{
      const val=parseFloat(inp.value);
      if(!isNaN(val)&&val!==0)rows.push({account_id:inp.dataset.id,snapshot_date:date,balance:val,balance_usd:val});
    });
    if(!rows.length){alert("Enter at least one balance.");btn.textContent="Save Snapshot";btn.disabled=false;return}
    try{
      const resp=await fetch(`${SB_URL}/rest/v1/balance_snapshots`,{method:"POST",headers:authHeaders({Prefer:"resolution=merge-duplicates,return=representation"}),body:JSON.stringify(rows)});
      if(!resp.ok)throw new Error(await resp.text());
      bg.remove();
      if(onSave)onSave();
    }catch(e){alert("Error saving: "+e.message);btn.textContent="Save Snapshot";btn.disabled=false}
  });
}
