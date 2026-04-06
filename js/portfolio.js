let pfState={expandedInst:null,expandedAcct:null,expandedSym:null};

async function renderPortfolio(el){
  el.innerHTML=`<div style="margin-bottom:16px"><h2>Portfolio</h2><p class="sub" id="pfSub">Loading...</p></div><div id="pfBody"><div style="text-align:center;padding:60px;color:rgba(255,255,255,0.3)">Loading...</div></div>`;
  try{
    let pfCache=dcGet('portfolio');
    if(!pfCache){
      const res=await Promise.all([
        sb("investment_accounts?order=label"),
        sb("investment_symbols?order=symbol"),
        sb("investment_lots?order=lot_date")
      ]);
      pfCache={accounts:res[0],symbols:res[1],lots:res[2]};
      dcSet('portfolio',pfCache);
    }
    const accounts=pfCache.accounts;
    const symbols=pfCache.symbols;
    // Shallow-copy lots so in-place mutations (market_value, ann_return) don't corrupt the cache
    const lots=pfCache.lots.map(l=>({...l}));
    const body=document.getElementById("pfBody");body.innerHTML="";

    // Build lookup maps
    const symInfo={};for(const s of symbols)symInfo[s.symbol]=s;
    const lotMap={};for(const l of lots){const k=`${l.account_id}|${l.symbol}`;if(!lotMap[k])lotMap[k]=[];lotMap[k].push(l)}

    // Compute lot market values (not stored in DB)
    for(const l of lots){
      const si=symInfo[l.symbol]||{};
      const price=parseFloat(si.latest_price||0);
      l.price_exec=parseFloat(l.price_exec||0);
      l.shares=parseFloat(l.shares||0);
      l.cost_basis=parseFloat(l.cost_basis||0);
      {const _p=parseFloat((symInfo[l.symbol]||{}).latest_price||0);const _d=l.lot_date?(Date.now()-new Date(l.lot_date).getTime())/864e5:0;const _mv=l.shares*_p;l.ann_return=(_p>0&&l.cost_basis>0&&_d>=7)?(Math.pow(_mv/l.cost_basis,365.25/_d)-1)*100:null;}
      l.market_value=l.sell_date?0:(price>0?l.shares*price:l.cost_basis);
    }

    // Price date from first symbol with one
    const priceDate=symbols.find(s=>s.price_as_of)?.price_as_of||null;
    document.getElementById("pfSub").textContent=priceDate?`Prices as of ${fmtD(priceDate)} · USD`:"Live from Supabase · USD";

    // Symbol-level ann return: cost-basis-weighted avg of lot ann_returns
    function symAnn(acctId,sym){
      const ls=lotMap[`${acctId}|${sym}`];
      if(!ls?.length)return null;
      const wl=ls.filter(l=>l.cost_basis>0&&l.ann_return!=null);if(!wl.length)return null;
      const tc=wl.reduce((s,l)=>s+l.cost_basis,0);
      return tc>0?wl.reduce((s,l)=>s+l.cost_basis*l.ann_return,0)/tc:null;
    }

    // Process accounts — derive holdings from lots, join symbol metadata
    const acctData=[];let portCost=0,portMarket=0;
    const allocBucket={};let totalLots=0;const totalSyms=new Set();

    for(const acct of accounts){
      const acctSymSet=new Set();
      for(const l of lots)if(l.account_id===acct.id)acctSymSet.add(l.symbol);
      let ac=0,am=0;const holdings=[];
      for(const symName of acctSymSet){
        const k=`${acct.id}|${symName}`;
        const sLots=lotMap[k]||[];
        const si=symInfo[symName]||{};
        const activeLots=sLots.filter(l=>!l.sell_date);
        const sold=sLots.length>0&&activeLots.length===0;
        const activeCost=activeLots.reduce((s,l)=>s+l.cost_basis,0);
        const activeMarket=activeLots.reduce((s,l)=>s+l.market_value,0);
        const activeShares=activeLots.reduce((s,l)=>s+l.shares,0);
        totalLots+=sLots.length;totalSyms.add(symName);
        holdings.push({symbol:symName,asset_class:si.asset_class||"unknown",latest_price:parseFloat(si.latest_price||0)||null,
          shares:activeShares,cost_basis:activeCost,market_value:activeMarket,
          sold,lots:sLots,annReturn:symAnn(acct.id,symName),name:si.name||symName});
        if(!sold){
          ac+=activeCost;am+=activeMarket;
          const cls=si.asset_class;
          if(cls){if(!allocBucket[cls])allocBucket[cls]={cost:0,market:0};allocBucket[cls].market+=activeMarket;allocBucket[cls].cost+=activeCost}
        }
      }
      const gain=am-ac,pctR=ac>0?(gain/ac)*100:0;
      let annR;
      if(PF_ACCT_ANN_OVERRIDE.hasOwnProperty(acct.id)){annR=PF_ACCT_ANN_OVERRIDE[acct.id]}
      else{const al=lots.filter(l=>l.account_id===acct.id&&l.cost_basis>0&&l.ann_return!=null);if(al.length){const tc=al.reduce((s,l)=>s+l.cost_basis,0);annR=tc>0?al.reduce((s,l)=>s+l.cost_basis*l.ann_return,0)/tc:null}else annR=null}
      portCost+=ac;portMarket+=am;
      acctData.push({...acct,holdings,totalCost:ac,totalMarket:am,gain,pctReturn:pctR,annReturn:annR});
    }

    // Portfolio ann return: cost-weighted avg of accounts with data (Vanguard 401K excluded via null)
    let paNum=0,paDen=0;
    for(const a of acctData){if(a.annReturn!=null&&a.totalCost>0){paNum+=a.totalCost*a.annReturn;paDen+=a.totalCost}}
    const portfolioAnn=paDen>0?paNum/paDen:null;
    const portGain=portMarket-portCost;
    const portPct=portCost>0?(portGain/portCost)*100:0;

    // Asset allocation
    const allocation=Object.entries(allocBucket).map(([ac,d])=>({asset_class:ac,...(PF_ACM[ac]||{label:ac,color:"#666",target:0}),value:d.market,pct:portMarket>0?(d.market/portMarket)*100:0})).sort((a,b)=>b.value-a.value);
    const displayAccts=acctData.filter(a=>a.totalMarket>0).sort((a,b)=>b.totalMarket-a.totalMarket);

    // Helper for formatting percent with sign
    const fPct=v=>v!=null?`${v>=0?"+":""}${v.toFixed(1)}%`:"—";
    const pCol=v=>v!=null?(v>=0?"var(--g)":"var(--r)"):"var(--dim)";

    // ── KPI Cards ──
    const kpi=h("div",{class:"pf-kpi"});
    [{l:"Market Value",v:fmtT(Math.round(portMarket)),c:"var(--g)"},
     {l:"Cost Basis",v:fmtT(Math.round(portCost)),c:"var(--b)"},
     {l:"Unrealized Gain",v:fmtT(Math.round(portGain)),c:portGain>=0?"var(--g)":"var(--r)"},
     {l:"Total Return",v:fPct(portPct),c:pCol(portPct)},
     {l:"Ann. Return",v:fPct(portfolioAnn),c:pCol(portfolioAnn),s:portfolioAnn!=null?"Excl. Vanguard 401K":null}
    ].forEach(k=>{
      const d=h("div",{class:"cd st"});
      d.innerHTML=`<div class="st-l">${k.l}</div><div class="st-v" style="color:${k.c}">${k.v}</div>${k.s?`<div style="font-size:9px;color:rgba(255,255,255,0.2);margin-top:2px">${k.s}</div>`:""}`;
      kpi.append(d);
    });
    body.append(kpi);

    // ── Two-panel overview ──
    const overview=h("div",{class:"g2"});

    // Left: Asset Allocation doughnut + legend
    const allocCard=h("div",{class:"cd"});
    allocCard.innerHTML=`<h3>Asset Allocation</h3><p id="pfAllocSub" style="font-size:11px;color:rgba(255,255,255,0.3);margin-bottom:12px">Target: ${Object.values(PF_ACM).map(v=>v.target+"% "+v.label).join(" / ")}</p><div class="chrt" style="height:200px"><canvas id="pfAllocChart"></canvas></div><div id="pfAllocLegend" style="margin-top:12px"></div>`;
    overview.append(allocCard);

    // Right: Account Performance bar + summary
    const perfCard=h("div",{class:"cd"});
    perfCard.innerHTML=`<h3>Account Performance</h3><div class="chrt" style="height:240px"><canvas id="pfPerfChart"></canvas></div><div id="pfPerfSummary" style="margin-top:8px"></div>`;
    overview.append(perfCard);
    body.append(overview);

    // Render allocation chart + legend
    setTimeout(()=>{
      makeChart("pfAllocChart",{type:"doughnut",data:{labels:allocation.map(a=>a.label),datasets:[{data:allocation.map(a=>Math.round(a.value)),backgroundColor:allocation.map(a=>a.color),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:"55%",plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${fmtT(ctx.raw)} (${allocation[ctx.dataIndex].pct.toFixed(1)}%)`}}}}});
      const leg=document.getElementById("pfAllocLegend");
      if(leg){
        function renderAllocLegend(){
          const tgtSum=Object.values(PF_ACM).reduce((s,v)=>s+v.target,0);
          const sub=document.getElementById("pfAllocSub");
          if(sub)sub.textContent=`Target: ${Object.values(PF_ACM).map(v=>v.target+"% "+v.label).join(" / ")}`;
          let lh="";allocation.forEach(a=>{
            lh+=`<div class="pf-alloc-row"><span style="display:flex;align-items:center;gap:6px;color:rgba(255,255,255,0.6)"><span style="width:8px;height:8px;border-radius:2px;background:${a.color};flex-shrink:0"></span>${a.label}</span><div class="pf-alloc-bar"><div style="height:100%;width:${Math.min(a.pct,100)}%;background:${a.color};border-radius:3px"></div></div><span style="font-family:var(--mono);font-size:10px;color:rgba(255,255,255,0.5);text-align:right">${a.pct.toFixed(1)}%</span><span class="pf-tgt" data-ac="${a.asset_class}" style="font-family:var(--mono);font-size:10px;color:rgba(255,255,255,0.25);text-align:right;cursor:pointer" title="Click to edit target">(${PF_ACM[a.asset_class].target}%)</span></div>`;
          });
          if(tgtSum!==100)lh+=`<div style="font-size:10px;color:var(--r);margin-top:4px">Targets sum to ${tgtSum}% (must be 100%)</div>`;
          leg.innerHTML=lh;
          leg.querySelectorAll(".pf-tgt").forEach(el=>{
            el.addEventListener("click",e=>{
              e.stopPropagation();
              const ac=el.dataset.ac;
              const cur=PF_ACM[ac].target;
              const inp=document.createElement("input");
              inp.type="number";inp.min="0";inp.max="100";inp.step="1";inp.value=cur;
              inp.style.cssText="width:38px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;color:#e8e8e4;font-family:var(--mono);font-size:10px;text-align:center;padding:1px 2px;outline:none";
              el.replaceWith(inp);inp.focus();inp.select();
              const commit=()=>{
                const v=Math.max(0,Math.round(parseFloat(inp.value)||0));
                PF_ACM[ac].target=v;
                // Update allocation data target field too
                const ai=allocation.find(x=>x.asset_class===ac);if(ai)ai.target=v;
                renderAllocLegend();
              };
              inp.addEventListener("blur",commit);
              inp.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();commit()}if(e.key==="Escape"){inp.removeEventListener("blur",commit);renderAllocLegend()}});
            });
          });
        }
        renderAllocLegend();
      }
    },50);

    // Render performance chart + summary
    setTimeout(()=>{
      const pd=displayAccts.map(a=>({name:a.label,cost:Math.round(a.totalCost),gain:Math.max(0,Math.round(a.gain))}));
      makeChart("pfPerfChart",{type:"bar",data:{labels:pd.map(d=>d.name),datasets:[
        {label:"Cost Basis",data:pd.map(d=>d.cost),backgroundColor:"rgba(74,111,165,0.6)"},
        {label:"Gain",data:pd.map(d=>d.gain),backgroundColor:"rgba(129,178,154,0.7)",borderRadius:{topRight:4,bottomRight:4}}
      ]},options:{responsive:true,maintainAspectRatio:false,indexAxis:"y",plugins:{legend:{labels:{color:"rgba(255,255,255,0.5)",font:{size:10}}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${fmtT(ctx.raw)}`}}},scales:{x:{stacked:true,ticks:{color:"rgba(255,255,255,0.3)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}},y:{stacked:true,ticks:{color:"rgba(255,255,255,0.5)",font:{size:10}},grid:{display:false}}}}});
      const sumEl=document.getElementById("pfPerfSummary");
      if(sumEl){let sh="";displayAccts.forEach(a=>{sh+=`<div class="pf-perf-row"><span style="color:rgba(255,255,255,0.45)">${a.label}</span><div style="display:flex;gap:12px"><span style="font-family:var(--mono);color:${pCol(a.pctReturn)}">${fPct(a.pctReturn)}</span><span style="font-family:var(--mono);min-width:50px;text-align:right;color:${pCol(a.annReturn)}">${fPct(a.annReturn)}</span></div></div>`});sumEl.innerHTML=sh}
    },100);


    // ── Market Prices Card ──
    const pricesCard=h("div",{class:"cd"});
    const activeSymKeys=new Set();
    acctData.forEach(a=>a.holdings.filter(hd=>!hd.sold&&hd.shares>0).forEach(hd=>activeSymKeys.add(hd.symbol)));
    const activePriceSyms=symbols.filter(s=>activeSymKeys.has(s.symbol));

    function renderPricesCard(){
      const srcBadge=src=>{const cfg={live:{label:"Live",color:"#2a9d8f"},csv:{label:"CSV",color:"#4A6FA5"},manual:{label:"Manual",color:"#9B8EA0"}};const c=cfg[src]||cfg.manual;return`<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:${c.color}22;color:${c.color};border:1px solid ${c.color}44">${c.label}</span>`};
      if(activePriceSyms.length===0){pricesCard.innerHTML=`<h3 style="margin-bottom:8px">Market Prices</h3><p style="font-size:12px;color:rgba(255,255,255,0.3)">No active holdings.</p>`;return}
      let ph=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h3>Market Prices</h3><span style="font-size:11px;color:rgba(255,255,255,0.3)">Click price to edit</span></div>`;
      ph+=`<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="color:rgba(255,255,255,0.3);font-size:10px;text-transform:uppercase;letter-spacing:0.05em"><th style="text-align:left;padding:4px 0 8px">Symbol</th><th style="text-align:left;padding:4px 8px 8px">Name</th><th style="text-align:left;padding:4px 8px 8px">Asset Class</th><th style="text-align:right;padding:4px 8px 8px">Source</th><th style="text-align:right;padding:4px 0 8px">Price</th><th style="text-align:right;padding:4px 0 8px 12px">As Of</th></tr></thead><tbody>`;
      activePriceSyms.forEach(s=>{
        const ac=PF_ACM[s.asset_class]||{label:s.asset_class||"—",color:"#9B8EA0"};
        const price=parseFloat(s.latest_price||0);
        const priceStr=price>0?`$${price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`:`<span style="color:rgba(255,255,255,0.25)">—</span>`;
        const asOf=s.price_as_of?s.price_as_of.slice(0,10):`<span style="color:rgba(255,255,255,0.2)">—</span>`;
        const src=srcBadge(s.price_source||"manual");
        ph+=`<tr style="border-top:1px solid rgba(255,255,255,0.05)"><td style="padding:9px 0;font-family:var(--mono);font-weight:600;color:rgba(255,255,255,0.9)">${s.symbol} <span class="pf-price-hist" data-hist-sym="${s.symbol}" title="Price history" style="cursor:pointer;font-size:10px;color:rgba(255,255,255,0.18);margin-left:2px">⦿</span></td><td style="padding:9px 8px;color:rgba(255,255,255,0.45);font-size:11px">${s.name||"—"}</td><td style="padding:9px 8px"><span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${ac.color}22;color:${ac.color};border:1px solid ${ac.color}44">${ac.label}</span></td><td style="padding:9px 8px;text-align:right">${src}</td><td style="padding:9px 0;text-align:right;font-family:var(--mono);cursor:pointer" data-price-sym="${s.symbol}">${priceStr}</td><td style="padding:9px 0 9px 12px;text-align:right;font-size:11px;color:rgba(255,255,255,0.35)">${asOf}</td></tr><tr class="pf-hist-row" id="pf-hist-${s.symbol}" style="display:none"><td colspan="6" style="padding:0 0 8px 0"><div class="pf-hist-body" style="background:rgba(255,255,255,0.03);border-radius:4px;padding:8px 10px;font-size:11px"><span style="color:rgba(255,255,255,0.25)">Loading…</span></div></td></tr>`;
      });
      ph+=`</tbody></table>`;
      pricesCard.innerHTML=ph;

      // Inline price + date editing
      pricesCard.querySelectorAll("[data-price-sym]").forEach(td=>{
        td.addEventListener("click",e=>{
          e.stopPropagation();
          if(td.querySelector("input"))return;
          const sym=td.dataset.priceSym;
          const symObj=activePriceSyms.find(s=>s.symbol===sym);if(!symObj)return;
          const oldPrice=parseFloat(symObj.latest_price||0);
          const today=new Date().toISOString().slice(0,10);
          const oldAsOf=symObj.price_as_of?symObj.price_as_of.slice(0,10):today;
          td.innerHTML=`<div style="display:flex;gap:4px;justify-content:flex-end;align-items:center"><input type="number" step="0.01" value="${oldPrice||""}" placeholder="Price" style="width:72px;background:rgba(255,255,255,0.08);border:1px solid rgba(74,111,165,0.5);border-radius:3px;color:#e8e8e4;font-family:var(--mono);font-size:11px;text-align:right;padding:2px 4px;outline:none" id="pfPrIn_${sym}"><input type="date" value="${oldAsOf}" style="width:108px;background:rgba(255,255,255,0.08);border:1px solid rgba(74,111,165,0.5);border-radius:3px;color:#e8e8e4;font-size:11px;padding:2px 4px;outline:none" id="pfDtIn_${sym}"><button id="pfPrApi_${sym}" title="Fetch from API" style="background:rgba(74,111,165,0.2);border:1px solid rgba(74,111,165,0.4);border-radius:3px;color:#4A6FA5;font-size:11px;padding:2px 6px;cursor:pointer;white-space:nowrap">↻ Live</button></div>`;
          const pi=document.getElementById(`pfPrIn_${sym}`);
          const di=document.getElementById(`pfDtIn_${sym}`);
          const apiBt=document.getElementById(`pfPrApi_${sym}`);
          pi.focus();pi.select();
          const commit=async(source="manual")=>{
            const nv=parseFloat(pi.value);
            const nd=di.value;
            if(isNaN(nv)||nv<=0){renderPricesCard();return}
            if(source==="manual"&&nv===oldPrice&&nd===oldAsOf){renderPricesCard();return}
            try{
              await applyPriceUpdate(sym,nv,source,oldPrice,oldAsOf);
              symObj.latest_price=nv;symObj.price_as_of=nd;symObj.price_source=source;
              dcInvalidatePortfolio();renderPortfolio(el);
            }catch(err){alert("Error saving price: "+err.message);renderPricesCard()}
          };
          apiBt.addEventListener("click",async e=>{
            e.stopPropagation();
            apiBt.textContent="…";apiBt.disabled=true;
            try{
              const ctrl=new AbortController();const tid=setTimeout(()=>ctrl.abort(),5000);
              const resp=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,{signal:ctrl.signal});
              clearTimeout(tid);
              if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
              const j=await resp.json();
              const p=j?.chart?.result?.[0]?.meta?.regularMarketPrice;
              if(!p||p<=0)throw new Error("No price returned");
              pi.value=Math.round(p*100)/100;
              di.value=new Date().toISOString().slice(0,10);
              await commit("live");
            }catch(err){
              apiBt.textContent="↻ Live";apiBt.disabled=false;
              apiBt.style.color="rgba(224,122,95,0.9)";apiBt.title=`API failed: ${err.message}`;
            }
          });
          const onBlur=()=>{setTimeout(()=>{if(!td.contains(document.activeElement))commit()},200)};
          pi.addEventListener("blur",onBlur);
          di.addEventListener("blur",onBlur);
          pi.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();commit()}if(ev.key==="Escape"){renderPricesCard()}});
          di.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();commit()}if(ev.key==="Escape"){renderPricesCard()}});
        });
      });
      // Price history toggle
      pricesCard.querySelectorAll(".pf-price-hist").forEach(btn=>{
        btn.addEventListener("click",async e=>{
          e.stopPropagation();
          const sym=btn.dataset.histSym;
          const row=document.getElementById(`pf-hist-${sym}`);
          const body=row?.querySelector(".pf-hist-body");
          if(!row||!body)return;
          if(row.style.display!=="none"){row.style.display="none";return}
          row.style.display="";
          try{
            const hist=await sb(`investment_price_history?symbol=eq.${encodeURIComponent(sym)}&order=recorded_at.desc&limit=20`);
            if(!hist.length){body.innerHTML=`<span style="color:rgba(255,255,255,0.25)">No history yet.</span>`;return}
            const cur=activePriceSyms.find(s=>s.symbol===sym);
            const curP=cur?parseFloat(cur.latest_price||0):0;
            let ph=`<table style="width:100%;border-collapse:collapse"><thead><tr style="color:rgba(255,255,255,0.25);font-size:10px;text-transform:uppercase;letter-spacing:0.05em"><th style="text-align:left;padding:2px 8px 4px 0">Date</th><th style="text-align:right;padding:2px 8px 4px">Price</th><th style="text-align:right;padding:2px 0 4px 8px">Δ from current</th></tr></thead><tbody>`;
            hist.forEach(h=>{
              const p=parseFloat(h.price);
              const d=curP>0?p-curP:null;
              const dStr=d!=null?`<span style="color:${d>=0?"#2a9d8f":"rgba(224,122,95,0.8)"}">${d>=0?"+":""}$${Math.abs(d).toFixed(2)} (${(d/curP*100).toFixed(1)}%)</span>`:"—";
              ph+=`<tr style="border-top:1px solid rgba(255,255,255,0.04)"><td style="padding:3px 8px 3px 0;color:rgba(255,255,255,0.35)">${(h.recorded_at||"").slice(0,10)}</td><td style="padding:3px 8px;text-align:right;font-family:var(--mono)">$${p.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td style="padding:3px 0 3px 8px;text-align:right">${dStr}</td></tr>`;
            });
            ph+=`</tbody></table>`;
            body.innerHTML=ph;
          }catch(err){body.innerHTML=`<span style="color:var(--r)">Error: ${err.message}</span>`}
        });
      });
    }
    renderPricesCard();
    body.append(pricesCard);

    // ── Holdings Card ──
    const holdCard=h("div",{class:"cd"});
    holdCard.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between"><h3>Holdings</h3><div style="display:flex;gap:8px"><button id="pfImportLotsBtn" class="btn" style="font-size:11px;padding:4px 12px;width:auto">&#x2191; Import Lots</button><button id="pfAddHoldBtn" class="btn" style="font-size:11px;padding:4px 12px;width:auto">+ Add Holdings</button></div></div><div id="pfImportLotsForm" style="display:none"></div><div id="pfAddHoldForm" style="display:none"></div><div id="pfHoldings"></div>`;
    body.append(holdCard);

    function renderHoldings(){
      const hEl=document.getElementById("pfHoldings");if(!hEl)return;
      let hh="";

      // Helper: render account header row
      function acctHdr(acct,indented){
        const vis=acct.holdings.filter(s=>s.market_value>0||s.cost_basis>0||s.sold);
        const isEx=pfState.expandedAcct===acct.id;
        const activeN=acct.holdings.filter(s=>!s.sold&&s.market_value>0).length;
        const soldN=acct.holdings.filter(s=>s.sold).length;
        let o=`<div class="pf-acct"${indented?' style="margin-left:20px"':''}><div class="pf-acct-hdr" data-acct="${acct.id}"><div><div style="font-size:${indented?"13":"14"}px;font-weight:600;display:flex;align-items:center;gap:8px"><span class="pf-toggle${isEx?" open":""}">▶</span>${acct.label} <span class="pf-badge">${PF_ATL[acct.account_type]||acct.account_type}</span></div><div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:2px">${indented?"":acct.institution+" · "}${activeN} active${soldN?" + "+soldN+" sold":""}</div></div>`;
        o+=`<div class="r hide-m"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Cost</div><div class="m" style="font-size:13px;color:rgba(255,255,255,0.5)">${fmtT(Math.round(acct.totalCost))}</div></div>`;
        o+=`<div class="r hide-m"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Market</div><div class="m" style="font-size:13px;color:var(--g)">${fmtT(Math.round(acct.totalMarket))}</div></div>`;
        o+=`<div class="r hide-m"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Gain</div><div class="m" style="font-size:13px;color:${pCol(acct.gain)}">${fmtT(Math.round(acct.gain))}</div></div>`;
        o+=`<div class="r"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Return</div><div class="m" style="font-size:13px;font-weight:600;color:${pCol(acct.pctReturn)}">${fPct(acct.pctReturn)}</div></div>`;
        o+=`<div class="r hide-m"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Ann.</div><div class="m" style="font-size:13px;color:${pCol(acct.annReturn)}">${fPct(acct.annReturn)}</div></div>`;
        o+=`</div>`;
        return {html:o,vis,isEx};
      }

      // Helper: render expanded symbol table for an account
      function symTable(acct,vis){
        let o=`<div style="border-top:1px solid rgba(255,255,255,0.04);padding:0 20px 14px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="color:rgba(255,255,255,0.3);font-size:10px;text-transform:uppercase;letter-spacing:0.05em">`;
        ["Symbol","Shares","Price","Cost","Market","Gain","Return","Ann."].forEach((col,i)=>o+=`<th class="${i>0?"r":""} ${[1,2,5,7].includes(i)?"hide-m":""}" style="padding:10px 0 6px;font-weight:500;text-align:${i===0?"left":"right"}">${col}</th>`);
        o+=`</tr></thead><tbody>`;
        for(const sd of vis){
          const g=sd.market_value-sd.cost_basis;
          const r=sd.cost_basis>0?(g/sd.cost_basis)*100:0;
          const lk=`${acct.id}|${sd.symbol}`;
          const isSE=pfState.expandedSym===lk;
          const activeLots=sd.lots.filter(l=>!l.sell_date);
          const soldLots=sd.lots.filter(l=>l.sell_date);
          o+=`<tr style="border-top:1px solid rgba(255,255,255,0.03);cursor:${sd.lots.length?"pointer":"default"};opacity:${sd.sold?0.55:1}" data-sym="${lk}">`;
          o+=`<td style="padding:8px 0;font-weight:600"><div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:2px;background:${PF_ACM[sd.asset_class]?.color||"#888"}"></span>`;
          if(sd.lots.length)o+=`<span style="font-size:8px;color:rgba(255,255,255,0.2);transform:${isSE?"rotate(90deg)":"rotate(0)"};transition:transform 0.15s;display:inline-block">▶</span>`;
          o+=`${sd.symbol}`;
          if(sd.sold)o+=`<span class="pf-sold-badge">SOLD</span>`;
          if(sd.lots.length)o+=` <span style="font-size:9px;color:rgba(255,255,255,0.2);font-family:var(--mono)">${sd.lots.length}</span>`;
          o+=`</div></td>`;
          o+=`<td class="r m hide-m" style="color:rgba(255,255,255,0.5);padding:8px 0">${sd.shares>0?sd.shares.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}</td>`;
          o+=`<td class="r m hide-m" style="color:rgba(255,255,255,0.5);padding:8px 0">${sd.latest_price?`$${sd.latest_price.toLocaleString("en-US",{minimumFractionDigits:2})}`:"—"}</td>`;
          o+=`<td class="r m" style="color:rgba(255,255,255,0.5);padding:8px 0">${fmtT(Math.round(sd.cost_basis))}</td>`;
          o+=`<td class="r m" style="color:${sd.sold?"rgba(255,255,255,0.5)":"var(--g)"};padding:8px 0">${fmtT(Math.round(sd.market_value))}</td>`;
          o+=`<td class="r m hide-m" style="color:${pCol(g)};padding:8px 0">${fmtT(Math.round(g))}</td>`;
          o+=`<td class="r m" style="color:${pCol(r)};font-weight:600;padding:8px 0">${fPct(r)}</td>`;
          o+=`<td class="r m hide-m" style="color:${pCol(sd.annReturn)};padding:8px 0">${fPct(sd.annReturn)}</td></tr>`;
          if(isSE){
            for(let li=0;li<activeLots.length;li++){
              const lot=activeLots[li];
              const lg=lot.market_value-lot.cost_basis,lr=lot.cost_basis>0?(lg/lot.cost_basis)*100:0;
              const lc=lg>=0?"rgba(129,178,154,0.6)":"rgba(224,122,95,0.6)";
              const lotKey=`${lk}|${li}`;
              o+=`<tr style="background:rgba(74,111,165,0.04)" data-lot-row="${lotKey}">`;
              o+=`<td style="padding:5px 0 5px 28px;font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.35)">${fmtD(lot.lot_date)}</td>`;
              o+=`<td class="r hide-m" data-lot-field="shares" data-lot-key="${lotKey}" style="font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.35);cursor:pointer" title="Click to edit">${lot.shares.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>`;
              o+=`<td class="r hide-m" data-lot-field="price_exec" data-lot-key="${lotKey}" style="font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.35);cursor:pointer" title="Click to edit">$${lot.price_exec.toLocaleString("en-US",{minimumFractionDigits:2})}</td>`;
              o+=`<td class="r" style="font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.35)">${fmtT(Math.round(lot.cost_basis))}</td>`;
              o+=`<td class="r" style="font-family:var(--mono);font-size:11px;color:${lc}">${fmtT(Math.round(lot.market_value))}</td>`;
              o+=`<td class="r hide-m" style="font-family:var(--mono);font-size:11px;color:${lc}">${fmtT(Math.round(lg))}</td>`;
              o+=`<td class="r" style="font-family:var(--mono);font-size:11px;color:${lc}">${fPct(lr)}</td>`;
              o+=`<td class="r hide-m" style="font-family:var(--mono);font-size:11px;position:relative"><span style="color:${lot.ann_return>=0?"rgba(129,178,154,0.6)":"rgba(224,122,95,0.6)"}">${lot.ann_return!=null?fPct(lot.ann_return):"—"}</span> <span class="pf-del-lot" data-lot-key="${lotKey}" title="Delete lot" style="cursor:pointer;color:rgba(255,255,255,0.15);font-size:13px;margin-left:6px">✕</span></td></tr>`;
            }
            // + Add Lot row
            o+=`<tr data-add-lot="${lk}" style="cursor:pointer"><td colspan="8" style="padding:5px 0 5px 28px;font-size:11px;color:rgba(74,111,165,0.5)">+ Add Lot</td></tr>`;
            if(soldLots.length){
              o+=`<tr><td colspan="8" style="padding:6px 0 2px 28px;font-size:9px;color:rgba(255,255,255,0.2);text-transform:uppercase;letter-spacing:0.08em">Sold</td></tr>`;
              for(const lot of soldLots){
                const lg=lot.market_value-lot.cost_basis,lr=lot.cost_basis>0?(lg/lot.cost_basis)*100:0;
                const sc=lg>=0?"rgba(129,178,154,0.5)":"rgba(224,122,95,0.5)";
                o+=`<tr style="background:rgba(224,122,95,0.03);opacity:0.6">`;
                o+=`<td style="padding:5px 0 5px 28px;font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.3)">${fmtD(lot.lot_date)} <span style="color:rgba(255,255,255,0.15)">→ ${fmtD(lot.sell_date)}</span></td>`;
                o+=`<td class="r hide-m" style="font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.3)">${lot.shares.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>`;
                o+=`<td class="r hide-m" style="font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.3)">$${lot.price_exec.toLocaleString("en-US",{minimumFractionDigits:2})}</td>`;
                o+=`<td class="r" style="font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.3)">${fmtT(Math.round(lot.cost_basis))}</td>`;
                o+=`<td class="r" style="font-family:var(--mono);font-size:11px;color:rgba(255,255,255,0.3)">${fmtT(Math.round(lot.market_value))}</td>`;
                o+=`<td class="r hide-m" style="font-family:var(--mono);font-size:11px;color:${sc}">${fmtT(Math.round(lg))}</td>`;
                o+=`<td class="r" style="font-family:var(--mono);font-size:11px;color:${sc}">${fPct(lr)}</td>`;
                o+=`<td class="r hide-m" style="font-family:var(--mono);font-size:11px;color:${sc}">${lot.ann_return!=null?fPct(lot.ann_return):"—"}</td></tr>`;
              }
            }
          }
        }
        o+=`</tbody></table></div>`;
        return o;
      }

      // Group accounts by institution
      const instGroups=[];const instSeen={};
      for(const acct of acctData){
        const inst=acct.institution||acct.label;
        if(!instSeen[inst]){instSeen[inst]={name:inst,members:[]};instGroups.push(instSeen[inst])}
        instSeen[inst].members.push(acct);
      }

      for(const group of instGroups){
        const visMembers=group.members.filter(a=>a.holdings.some(s=>s.market_value>0||s.cost_basis>0||s.sold));
        if(!visMembers.length)continue;

        if(visMembers.length===1){
          // Single account institution — render flat (unchanged behavior)
          const acct=visMembers[0];
          const {html,vis,isEx}=acctHdr(acct,false);
          hh+=html;
          if(isEx)hh+=symTable(acct,vis);
          hh+=`</div>`;
        }else{
          // Multi-account institution — render group header + nested accounts
          const gCost=visMembers.reduce((s,a)=>s+a.totalCost,0);
          const gMarket=visMembers.reduce((s,a)=>s+a.totalMarket,0);
          const gGain=gMarket-gCost;
          const gPct=gCost>0?(gGain/gCost)*100:0;
          let gAnn=null;
          const annAccts=visMembers.filter(a=>a.annReturn!=null&&a.totalCost>0);
          if(annAccts.length){const tc=annAccts.reduce((s,a)=>s+a.totalCost,0);gAnn=tc>0?annAccts.reduce((s,a)=>s+a.totalCost*a.annReturn,0)/tc:null}
          const isInstEx=pfState.expandedInst===group.name;

          hh+=`<div class="pf-acct" style="border-left:2px solid rgba(74,111,165,0.3)"><div class="pf-inst-hdr" data-inst="${group.name}"><div><div style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px"><span class="pf-toggle${isInstEx?" open":""}">▶</span>${group.name} <span style="font-size:11px;font-weight:400;color:rgba(255,255,255,0.3)">${visMembers.length} accounts</span></div></div>`;
          hh+=`<div class="r hide-m"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Cost</div><div class="m" style="font-size:13px;color:rgba(255,255,255,0.5)">${fmtT(Math.round(gCost))}</div></div>`;
          hh+=`<div class="r hide-m"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Market</div><div class="m" style="font-size:13px;color:var(--g)">${fmtT(Math.round(gMarket))}</div></div>`;
          hh+=`<div class="r hide-m"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Gain</div><div class="m" style="font-size:13px;color:${pCol(gGain)}">${fmtT(Math.round(gGain))}</div></div>`;
          hh+=`<div class="r"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Return</div><div class="m" style="font-size:13px;font-weight:600;color:${pCol(gPct)}">${fPct(gPct)}</div></div>`;
          hh+=`<div class="r hide-m"><div style="font-size:10px;color:rgba(255,255,255,0.3)">Ann.</div><div class="m" style="font-size:13px;color:${pCol(gAnn)}">${fPct(gAnn)}</div></div>`;
          hh+=`</div>`;

          if(isInstEx){
            for(const acct of visMembers){
              const {html,vis,isEx}=acctHdr(acct,true);
              hh+=html;
              if(isEx)hh+=symTable(acct,vis);
              hh+=`</div>`;
            }
          }
          hh+=`</div>`;
        }
      }
      hEl.innerHTML=hh;

      // Attach click handlers
      hEl.querySelectorAll(".pf-inst-hdr").forEach(el=>{
        el.addEventListener("click",()=>{
          const inst=el.dataset.inst;
          pfState.expandedInst=pfState.expandedInst===inst?null:inst;
          pfState.expandedAcct=null;pfState.expandedSym=null;
          renderHoldings();
        });
      });
      hEl.querySelectorAll(".pf-acct-hdr").forEach(el=>{
        el.addEventListener("click",()=>{
          const id=el.dataset.acct;
          pfState.expandedAcct=pfState.expandedAcct===id?null:id;
          pfState.expandedSym=null;
          renderHoldings();
        });
      });
      hEl.querySelectorAll("tr[data-sym]").forEach(el=>{
        el.addEventListener("click",e=>{
          e.stopPropagation();
          const k=el.dataset.sym;
          pfState.expandedSym=pfState.expandedSym===k?null:k;
          renderHoldings();
        });
      });

      // Inline lot editing (shares / price_exec)
      hEl.querySelectorAll("[data-lot-field]").forEach(td=>{
        td.addEventListener("click",e=>{
          e.stopPropagation();
          if(td.querySelector("input"))return;
          const field=td.dataset.lotField;
          const [acctId,sym,liStr]=td.dataset.lotKey.split("|");
          const li=parseInt(liStr);
          const sLots=(lotMap[`${acctId}|${sym}`]||[]).filter(l=>!l.sell_date);
          const lot=sLots[li];if(!lot)return;
          const oldVal=field==="shares"?lot.shares:lot.price_exec;
          const inp=document.createElement("input");
          inp.type="number";inp.step="any";inp.value=oldVal;
          inp.style.cssText="width:70px;background:rgba(255,255,255,0.08);border:1px solid rgba(74,111,165,0.5);border-radius:3px;color:#e8e8e4;font-family:var(--mono);font-size:11px;text-align:right;padding:2px 4px;outline:none";
          td.textContent="";td.append(inp);inp.focus();inp.select();
          const commit=async()=>{
            const nv=parseFloat(inp.value);
            if(isNaN(nv)||nv===oldVal){renderHoldings();return}
            const newShares=field==="shares"?nv:lot.shares;
            const newPrice=field==="price_exec"?nv:lot.price_exec;
            const newCost=Math.round(newShares*newPrice*100)/100;
            const filter=lot.id?`investment_lots?id=eq.${lot.id}`:`investment_lots?account_id=eq.${encodeURIComponent(acctId)}&symbol=eq.${encodeURIComponent(sym)}&lot_date=eq.${lot.lot_date}&shares=eq.${lot.shares}&price_exec=eq.${lot.price_exec}`;
            try{
              await sb(filter,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({shares:newShares,price_exec:newPrice,cost_basis:newCost})});
              lot.shares=newShares;lot.price_exec=newPrice;lot.cost_basis=newCost;
              const si=symInfo[sym]||{};const price=parseFloat(si.latest_price||0);
              lot.market_value=price>0?newShares*price:newCost;
              dcInvalidatePortfolio();renderPortfolio(el);
            }catch(err){alert("Error saving: "+err.message);renderHoldings()}
          };
          inp.addEventListener("blur",commit);
          inp.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();commit()}if(ev.key==="Escape"){inp.removeEventListener("blur",commit);renderHoldings()}});
        });
      });

      // Delete lot (two-click confirm)
      hEl.querySelectorAll(".pf-del-lot").forEach(btn=>{
        btn.addEventListener("click",e=>{
          e.stopPropagation();
          if(btn.dataset.confirm){
            // Second click — delete
            const [acctId,sym,liStr]=btn.dataset.lotKey.split("|");
            const li=parseInt(liStr);
            const sLots=(lotMap[`${acctId}|${sym}`]||[]).filter(l=>!l.sell_date);
            const lot=sLots[li];if(!lot)return;
            const filter=lot.id?`investment_lots?id=eq.${lot.id}`:`investment_lots?account_id=eq.${encodeURIComponent(acctId)}&symbol=eq.${encodeURIComponent(sym)}&lot_date=eq.${lot.lot_date}&shares=eq.${lot.shares}&price_exec=eq.${lot.price_exec}`;
            sb(filter,{method:"DELETE"}).then(()=>{dcInvalidatePortfolio();renderPortfolio(el)}).catch(err=>alert("Delete failed: "+err.message));
          }else{
            btn.dataset.confirm="1";btn.style.color="var(--r)";btn.textContent="Del?";
            setTimeout(()=>{if(btn.isConnected){delete btn.dataset.confirm;btn.style.color="rgba(255,255,255,0.15)";btn.textContent="✕"}},3000);
          }
        });
      });

      // Add Lot inline form
      hEl.querySelectorAll("tr[data-add-lot]").forEach(row=>{
        row.addEventListener("click",e=>{
          e.stopPropagation();
          const [acctId,sym]=row.dataset.addLot.split("|");
          const today=new Date().toISOString().slice(0,10);
          row.innerHTML=`<td colspan="8" style="padding:6px 0 6px 28px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="date" class="pf-al-date inp" value="${today}" style="width:120px;font-size:11px"><input type="number" class="pf-al-shares inp" placeholder="Shares" step="any" style="width:80px;font-size:11px"><input type="number" class="pf-al-price inp" placeholder="Price" step="any" style="width:80px;font-size:11px"><button class="pf-al-save btn" style="font-size:11px;padding:3px 10px">Save</button><button class="pf-al-cancel btn" style="font-size:11px;padding:3px 8px;background:rgba(255,255,255,0.06)">Cancel</button></div></td>`;
          row.querySelector(".pf-al-shares").focus();
          row.querySelector(".pf-al-cancel").addEventListener("click",ev=>{ev.stopPropagation();renderHoldings()});
          row.querySelector(".pf-al-save").addEventListener("click",async ev=>{
            ev.stopPropagation();
            const dt=row.querySelector(".pf-al-date").value;
            const sh=parseFloat(row.querySelector(".pf-al-shares").value);
            const pr=parseFloat(row.querySelector(".pf-al-price").value);
            if(!dt||isNaN(sh)||isNaN(pr)||sh<=0||pr<=0){alert("Fill all fields");return}
            const cb=Math.round(sh*pr*100)/100;
            try{
              await sb("investment_lots",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({account_id:acctId,symbol:sym,lot_date:dt,shares:sh,price_exec:pr,cost_basis:cb})});
              dcInvalidatePortfolio();renderPortfolio(el);
            }catch(err){alert("Error: "+err.message)}
          });
        });
      });
    }
    renderHoldings();

    // ── Add Holdings Form ──
    const addHoldBtn=document.getElementById("pfAddHoldBtn");
    const addHoldForm=document.getElementById("pfAddHoldForm");
    if(addHoldBtn&&addHoldForm){
      addHoldBtn.addEventListener("click",()=>{
        const isOpen=addHoldForm.style.display!=="none";
        if(isOpen){addHoldForm.style.display="none";addHoldBtn.textContent="+ Add Holdings";return}
        const acctOpts=accounts.map(a=>`<option value="${a.id}">${a.label} (${a.institution})</option>`).join("");
        const symList=symbols.map(s=>s.symbol);
        const acTypeOpts=Object.entries(PF_ATL).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
        const acOpts=Object.entries(PF_ACM).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join("");
        const today=new Date().toISOString().slice(0,10);
        addHoldForm.innerHTML=`<div style="border:1px solid rgba(74,111,165,0.2);border-radius:8px;padding:14px;margin:12px 0;background:rgba(74,111,165,0.04)">
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
            <div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Account</label><select id="pfAhAcct" class="inp" style="font-size:12px;min-width:140px"><option value="">Select…</option>${acctOpts}<option value="__new__">New Account…</option></select></div>
            <div id="pfAhNewAcct" style="display:none"><div style="display:flex;gap:6px;flex-wrap:wrap"><div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Label</label><input id="pfAhAcctLabel" class="inp" style="font-size:12px;width:110px" placeholder="e.g. Schwab"></div><div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Institution</label><input id="pfAhAcctInst" class="inp" style="font-size:12px;width:110px" placeholder="e.g. Charles Schwab"></div><div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Type</label><select id="pfAhAcctType" class="inp" style="font-size:12px">${acTypeOpts}</select></div></div></div>
            <div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Symbol</label><input id="pfAhSym" class="inp" list="pfAhSymList" style="font-size:12px;width:90px" placeholder="e.g. VOO"><datalist id="pfAhSymList">${symList.map(s=>`<option value="${s}">`).join("")}</datalist></div>
            <div id="pfAhNewSym" style="display:none"><div style="display:flex;gap:6px;flex-wrap:wrap"><div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Name</label><input id="pfAhSymName" class="inp" style="font-size:12px;width:130px" placeholder="e.g. Vanguard S&P 500"></div><div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Asset Class</label><select id="pfAhSymAc" class="inp" style="font-size:12px">${acOpts}</select></div></div></div>
            <div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Date</label><input id="pfAhDate" type="date" class="inp" style="font-size:12px;width:120px" value="${today}"></div>
            <div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Shares</label><input id="pfAhShares" type="number" class="inp" step="any" style="font-size:12px;width:80px"></div>
            <div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Price</label><input id="pfAhPrice" type="number" class="inp" step="any" style="font-size:12px;width:80px"></div>
            <div style="display:flex;gap:6px;align-items:end;padding-bottom:1px"><button id="pfAhSave" class="btn" style="font-size:11px;padding:5px 14px">Save</button><button id="pfAhCancel" class="btn" style="font-size:11px;padding:5px 10px;background:rgba(255,255,255,0.06)">Cancel</button></div>
          </div>
        </div>`;
        addHoldForm.style.display="block";
        addHoldBtn.textContent="Cancel";

        // Show/hide new account fields
        const acctSel=document.getElementById("pfAhAcct");
        acctSel.addEventListener("change",()=>{document.getElementById("pfAhNewAcct").style.display=acctSel.value==="__new__"?"block":"none"});

        // Show/hide new symbol fields
        const symInp=document.getElementById("pfAhSym");
        symInp.addEventListener("input",()=>{
          const isNew=symInp.value.trim()&&!symList.includes(symInp.value.trim().toUpperCase());
          document.getElementById("pfAhNewSym").style.display=isNew?"block":"none";
        });

        document.getElementById("pfAhCancel").addEventListener("click",()=>{addHoldForm.style.display="none";addHoldBtn.textContent="+ Add Holdings"});

        document.getElementById("pfAhSave").addEventListener("click",async()=>{
          let acctId=acctSel.value;
          const symVal=(symInp.value||"").trim().toUpperCase();
          const dt=document.getElementById("pfAhDate").value;
          const sh=parseFloat(document.getElementById("pfAhShares").value);
          const pr=parseFloat(document.getElementById("pfAhPrice").value);
          if(!acctId||!symVal||!dt||isNaN(sh)||isNaN(pr)||sh<=0||pr<=0){alert("Fill all required fields");return}
          try{
            // Create new account if needed
            if(acctId==="__new__"){
              const label=document.getElementById("pfAhAcctLabel").value.trim();
              const inst=document.getElementById("pfAhAcctInst").value.trim();
              const atype=document.getElementById("pfAhAcctType").value;
              if(!label||!inst){alert("Fill account label and institution");return}
              const newAcct=await sb("investment_accounts",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({id:label.toLowerCase().replace(/\s+/g,"_"),label,institution:inst,account_type:atype})});
              acctId=Array.isArray(newAcct)?newAcct[0].id:newAcct.id;
            }
            // Create new symbol if needed
            if(!symList.includes(symVal)){
              const sname=document.getElementById("pfAhSymName").value.trim();
              const sac=document.getElementById("pfAhSymAc").value;
              if(!sname){alert("Fill symbol name");return}
              await sb("investment_symbols",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({symbol:symVal,name:sname,asset_class:sac,latest_price:pr})});
            }
            const cb=Math.round(sh*pr*100)/100;
            await sb("investment_lots",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({account_id:acctId,symbol:symVal,lot_date:dt,shares:sh,price_exec:pr,cost_basis:cb})});
            addHoldForm.style.display="none";addHoldBtn.textContent="+ Add Holdings";
            dcInvalidatePortfolio();renderPortfolio(el);
          }catch(err){alert("Error: "+err.message)}
        });
      });
    }

    // ── Import Lots Form ──
    const importLotsBtn=document.getElementById("pfImportLotsBtn");
    const importLotsForm=document.getElementById("pfImportLotsForm");
    if(importLotsBtn&&importLotsForm){
      importLotsBtn.addEventListener("click",()=>{
        const isOpen=importLotsForm.style.display!=="none";
        if(isOpen){importLotsForm.style.display="none";importLotsBtn.innerHTML="&#x2191; Import Lots";return}
        const acctOpts=accounts.map(a=>`<option value="${a.id}">${a.label} (${a.institution})</option>`).join("");
        importLotsForm.innerHTML=`<div style="border:1px solid rgba(74,111,165,0.2);border-radius:8px;padding:14px;margin:12px 0;background:rgba(74,111,165,0.04)">
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px">
            <div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">Account</label><select id="pfIlAcct" class="inp" style="font-size:12px;min-width:140px"><option value="">Select…</option>${acctOpts}</select></div>
            <div><label style="font-size:10px;color:rgba(255,255,255,0.4);display:block;margin-bottom:3px">CSV or XLSX File</label><input type="file" id="pfIlFile" accept=".csv,.xlsx" style="font-size:11px;color:rgba(255,255,255,0.7)"></div>
            <div style="display:flex;gap:6px;align-items:end;padding-bottom:1px"><button id="pfIlParse" class="btn" style="font-size:11px;padding:5px 14px">Preview</button><button id="pfIlCancel" class="btn" style="font-size:11px;padding:5px 10px;background:rgba(255,255,255,0.06)">Cancel</button></div>
          </div>
          <div id="pfIlPreview"></div>
        </div>`;
        importLotsForm.style.display="block";
        importLotsBtn.textContent="Cancel Import";

        document.getElementById("pfIlCancel").addEventListener("click",()=>{importLotsForm.style.display="none";importLotsBtn.innerHTML="&#x2191; Import Lots"});

        document.getElementById("pfIlParse").addEventListener("click",async()=>{
          const acctId=document.getElementById("pfIlAcct").value;
          const file=document.getElementById("pfIlFile").files[0];
          const prev=document.getElementById("pfIlPreview");
          if(!acctId){prev.innerHTML=`<p style="color:var(--r);font-size:12px">Select an account.</p>`;return}
          if(!file){prev.innerHTML=`<p style="color:var(--r);font-size:12px">Select a file.</p>`;return}
          prev.innerHTML=`<p style="font-size:12px;color:rgba(255,255,255,0.4)">Parsing…</p>`;
          try{
            const parsed=await parsePortfolioFile(file);
            if(!parsed.length){prev.innerHTML=`<p style="color:var(--r);font-size:12px">No lots found in file.</p>`;return}
            // Fuzzy dedup: same symbol + same date + shares within 2% tolerance
            // Handles rounding, manual entry differences, and float drift without false positives
            // (Two genuine lots on same date with very different share counts won't collide)
            const existingLots=lots.filter(l=>l.account_id===acctId);
            const isDup=(p)=>existingLots.some(e=>{
              if(e.symbol!==p.symbol)return false;
              if(String(e.lot_date).slice(0,10)!==String(p.lot_date).slice(0,10))return false;
              const s1=parseFloat(e.shares),s2=parseFloat(p.shares);
              return Math.abs(s1-s2)/Math.max(s1,s2,0.0001)<0.02;
            });
            const rows=parsed.map((p,i)=>({...p,_idx:i,exists:isDup(p),rejected:!isDup(p)&&isLotRejected(p)}));
            const initialCount=rows.filter(r=>!r.exists&&!r.rejected).length;
            function updateLotImportBtn(){
              const n=prev.querySelectorAll(".pfIlChk:checked").length;
              document.getElementById("pfIlSelCount").textContent=n;
              const btn=document.getElementById("pfIlImport");
              if(btn)btn.textContent=`Import ${n} Lot${n===1?"":"s"}`;
            }
            let ph=`<div style="margin-top:8px"><div id="pfIlSummary" style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:8px">${rows.length} lots parsed · <span id="pfIlSelCount">${initialCount}</span> selected</div>`;
            ph+=`<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="color:rgba(255,255,255,0.3);font-size:10px;text-transform:uppercase;letter-spacing:0.05em"><th style="padding:4px 8px 6px 0;text-align:center"><input type="checkbox" id="pfIlChkAll" title="Select all"></th><th style="text-align:left;padding:4px 8px 6px 0">Date</th><th style="text-align:left;padding:4px 8px 6px">Symbol</th><th style="text-align:right;padding:4px 8px 6px">Shares</th><th style="text-align:right;padding:4px 8px 6px">Price</th><th style="text-align:right;padding:4px 0 6px">Cost</th><th style="text-align:center;padding:4px 0 6px 8px">Status</th></tr></thead><tbody>`;
            rows.forEach(r=>{
              const isNew=!r.exists;
              const isChecked=isNew&&!r.rejected;
              const badge=isNew?`<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(42,157,143,0.15);color:#2a9d8f">New</span>`:`<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(155,142,160,0.15);color:rgba(255,255,255,0.3)">Exists</span>`;
              ph+=`<tr data-idx="${r._idx}" style="border-top:1px solid rgba(255,255,255,0.05);opacity:${isChecked?"1":"0.3"}"><td style="padding:6px 8px 6px 0;text-align:center"><input type="checkbox" class="pfIlChk" data-idx="${r._idx}" ${isChecked?"checked":""}></td><td style="padding:6px 8px 6px 0;font-family:var(--mono)">${fmtD(r.lot_date)}</td><td style="padding:6px 8px;font-family:var(--mono);font-weight:600">${r.symbol}</td><td style="padding:6px 8px;text-align:right;font-family:var(--mono)">${parseFloat(r.shares).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td style="padding:6px 8px;text-align:right;font-family:var(--mono)">$${parseFloat(r.price_exec).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td style="padding:6px 0;text-align:right;font-family:var(--mono)">$${parseFloat(r.cost_basis).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td style="padding:6px 0 6px 8px;text-align:center">${badge}</td></tr>`;
            });
            ph+=`</tbody></table>`;
            ph+=`<div style="margin-top:12px;display:flex;gap:8px"><button id="pfIlImport" class="btn" style="font-size:11px;padding:5px 16px">Import ${initialCount} Lot${initialCount===1?"":"s"}</button></div>`;
            ph+=`</div>`;
            prev.innerHTML=ph;

            // Select-all toggle
            document.getElementById("pfIlChkAll").addEventListener("change",e=>{
              prev.querySelectorAll(".pfIlChk").forEach(c=>{
                c.checked=e.target.checked;
                c.closest("tr").style.opacity=c.checked?"1":"0.3";
                const r=rows.find(r=>r._idx===parseInt(c.dataset.idx));
                if(r&&!r.exists)persistLotRejection(r,!c.checked);
              });
              updateLotImportBtn();
            });
            // Per-row checkbox: update count + persist rejection
            prev.querySelectorAll(".pfIlChk").forEach(c=>c.addEventListener("change",()=>{
              c.closest("tr").style.opacity=c.checked?"1":"0.3";
              const r=rows.find(r=>r._idx===parseInt(c.dataset.idx));
              if(r&&!r.exists)persistLotRejection(r,!c.checked);
              updateLotImportBtn();
            }));

            document.getElementById("pfIlImport").addEventListener("click",async()=>{
              const selectedIdxs=new Set([...prev.querySelectorAll(".pfIlChk:checked")].map(c=>parseInt(c.dataset.idx)));
              const toImport=rows.filter(r=>selectedIdxs.has(r._idx));
              if(!toImport.length){alert("No lots selected.");return}
              const btn=document.getElementById("pfIlImport");
              btn.disabled=true;btn.textContent="Importing…";
              try{
                const symSet=new Set(toImport.map(r=>r.symbol));
                const existSyms=new Set(symbols.map(s=>s.symbol));
                for(const sym of symSet){
                  if(!existSyms.has(sym)){
                    const implP=toImport.find(r=>r.symbol===sym)?.implied_price||null;
                    await sb("investment_symbols",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({symbol:sym,name:sym,asset_class:"equity",latest_price:implP})});
                  }
                }
                for(const r of toImport){
                  await sb("investment_lots",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({account_id:acctId,symbol:r.symbol,lot_date:r.lot_date,shares:r.shares,price_exec:r.price_exec,cost_basis:r.cost_basis})});
                }
                // Fetch proposed prices and show confirmation before saving
                btn.textContent="Fetching prices…";
                const impliedPrices={};
                toImport.forEach(r=>{if(r.implied_price>0)impliedPrices[r.symbol]=r.implied_price});
                const proposals=await fetchProposedPrices([...symSet],impliedPrices,symbols);
                if(!proposals.length){
                  importLotsForm.style.display="none";importLotsBtn.innerHTML="&#x2191; Import Lots";
                  if(typeof pfState!=="undefined")pfState.expandedAcct=acctId;
                  dcInvalidatePortfolio();renderPortfolio(el);return;
                }
                // Show price confirmation UI
                const fmtP=p=>p>0?`$${p.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"—";
                const fmtDelta=(cur,nw)=>{if(!cur||!nw)return"";const d=nw-cur,pct=cur>0?d/cur*100:0;const col=d>=0?"#2a9d8f":"rgba(224,122,95,0.9)";return`<span style="color:${col};font-size:10px">${d>=0?"+":""}${fmtP(d)} (${pct>=0?"+":""}${pct.toFixed(1)}%)</span>`};
                let ph=`<div style="border-top:1px solid rgba(255,255,255,0.07);margin-top:14px;padding-top:12px"><div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:8px">Update market prices?</div>`;
                ph+=`<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="color:rgba(255,255,255,0.3);font-size:10px;text-transform:uppercase;letter-spacing:0.05em"><th style="text-align:left;padding:3px 8px 5px 0">Symbol</th><th style="text-align:right;padding:3px 8px 5px">Current</th><th style="text-align:right;padding:3px 8px 5px">New</th><th style="text-align:left;padding:3px 0 5px 8px">Change</th></tr></thead><tbody>`;
                proposals.forEach(p=>{
                  ph+=`<tr style="border-top:1px solid rgba(255,255,255,0.04)"><td style="padding:5px 8px 5px 0;font-family:var(--mono);font-weight:600">${p.symbol} <span style="font-size:9px;padding:1px 5px;border-radius:8px;background:${p.source==="live"?"rgba(42,157,143,0.15)":"rgba(74,111,165,0.15)"};color:${p.source==="live"?"#2a9d8f":"#4A6FA5"}">${p.source}</span></td><td style="padding:5px 8px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.4)">${fmtP(p.currentPrice)}</td><td style="padding:5px 8px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.9)">${fmtP(p.newPrice)}</td><td style="padding:5px 0 5px 8px">${fmtDelta(p.currentPrice,p.newPrice)}</td></tr>`;
                });
                ph+=`</tbody></table><div style="display:flex;gap:8px;margin-top:10px"><button id="pfIlConfirmPrices" class="btn" style="font-size:11px;padding:5px 14px">Confirm & Update</button><button id="pfIlSkipPrices" class="btn" style="font-size:11px;padding:5px 10px;background:rgba(255,255,255,0.06)">Skip</button></div></div>`;
                prev.insertAdjacentHTML("beforeend",ph);
                btn.disabled=false;btn.textContent="Lots imported ✓";

                const finishImport=async(applyPrices)=>{
                  if(applyPrices){
                    for(const p of proposals){
                      try{await applyPriceUpdate(p.symbol,p.newPrice,p.source,p.currentPrice,p.currentAsOf);}
                      catch(e){console.warn("price update failed",p.symbol,e)}
                    }
                  }
                  importLotsForm.style.display="none";importLotsBtn.innerHTML="&#x2191; Import Lots";
                  if(typeof pfState!=="undefined")pfState.expandedAcct=acctId;
                  dcInvalidatePortfolio();renderPortfolio(el);
                };
                document.getElementById("pfIlConfirmPrices").addEventListener("click",()=>finishImport(true));
                document.getElementById("pfIlSkipPrices").addEventListener("click",()=>finishImport(false));
              }catch(err){alert("Import error: "+err.message);btn.disabled=false;btn.textContent="Retry Import"}
            });
          }catch(err){prev.innerHTML=`<p style="color:var(--r);font-size:12px">Parse error: ${err.message}</p>`}
        });
      });
    }

    // ── Footer ──
    const foot=h("div",{class:"pf-foot"});
    foot.innerHTML=`<span>${totalLots} lots · ${accounts.length} accounts · ${totalSyms.size} symbols</span>${priceDate?`<span>Prices as of ${fmtD(priceDate)}</span>`:""}`;
    body.append(foot);

  }catch(e){document.getElementById("pfBody").innerHTML=`<div class="cd" style="border-color:rgba(224,122,95,0.3);color:var(--r)">Error loading portfolio: ${e.message}</div>`}
}

async function loadSheetJS(){
  if(window.XLSX)return;
  await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";s.onload=res;s.onerror=rej;document.head.append(s)});
}

function detectPortfolioFormat(rows){
  const flat=rows.map(r=>(r||[]).map(c=>String(c||"")).join("|")).join("\n").toLowerCase();
  // Schwab: "open date" header + "cost/share" column + dollar-sign values
  const hasSchwabHeaders=/open.?date/.test(flat)&&/cost.?share/.test(flat);
  const hasDollarVals=rows.some(r=>(r||[]).some(c=>/^\$[\d,]+/.test(String(c||""))));
  if(hasSchwabHeaders&&hasDollarVals)return"schwab";
  // eTrade: "account summary" + "net account value" in header block
  const hasAccountSummary=/account summary/.test(flat);
  const hasNetAccountValue=/net account value/.test(flat);
  if(hasAccountSummary&&hasNetAccountValue)return"etrade";
  // Health Equity: "health equity" + "fund name"
  const hasHE=/health.?equity/.test(flat);
  const hasFundName=/fund.?name/.test(flat);
  if(hasHE&&hasFundName)return"healthequity";
  return"unknown";
}

function parseSchwabLots(rows,symbol){
  const headerIdx=rows.findIndex(r=>(r||[]).some(c=>/open\s*date/i.test(String(c))));
  if(headerIdx<0)throw new Error("Schwab: header row not found");
  const hdr=rows[headerIdx];
  const col=n=>hdr.findIndex(c=>new RegExp(n,"i").test(String(c)));
  const iDate=col("open date"),iQty=col("quantity"),iCost=col("cost.?share"),iMkt=col("market value"),iCostBasis=col("cost basis");
  let sym=symbol;
  if(!sym){const title=(rows[0]||[]).join(" ");const m=title.match(/([A-Z]{1,5})\s+Lot/i);if(m)sym=m[1].toUpperCase();}
  if(!sym)sym="UNKNOWN";
  const lots=[];const impliedPrices=[];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r=rows[i]||[];
    const dateVal=String(r[iDate]||"").trim();
    if(!dateVal||/total/i.test(dateVal)||!/\d{2}\/\d{2}\/\d{4}/.test(dateVal))continue;
    const qty=parseFloat(String(r[iQty]||"").replace(/[^0-9.-]/g,""));
    const costShare=parseFloat(String(r[iCost]||"").replace(/[^0-9.-]/g,""));
    const mktVal=parseFloat(String(r[iMkt]||"").replace(/[^0-9.-]/g,""));
    const cbRaw=iCostBasis>=0?parseFloat(String(r[iCostBasis]||"").replace(/[^0-9.-]/g,"")):NaN;
    const cb=isNaN(cbRaw)?Math.round(qty*costShare*100)/100:cbRaw;
    if(isNaN(qty)||isNaN(costShare)||qty<=0||costShare<=0)continue;
    const[mm,dd,yyyy]=dateVal.split("/");
    const lot_date=`${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
    lots.push({symbol:sym,lot_date,shares:Math.round(qty*1e4)/1e4,price_exec:Math.round(costShare*100)/100,cost_basis:Math.round(Math.round(qty*1e4)/1e4*Math.round(costShare*100)/100*100)/100,implied_price:0});
    if(mktVal>0&&qty>0)impliedPrices.push(mktVal/qty);
  }
  const impliedPrice=impliedPrices.length?impliedPrices.reduce((a,b)=>a+b,0)/impliedPrices.length:0;
  lots.forEach(l=>l.implied_price=impliedPrice);
  return lots;
}

function parseEtradeLots(rows){
  const lots=[];let currentSym=null;let impliedPrice=0;
  for(let i=0;i<rows.length;i++){
    const r=rows[i]||[];
    const first=String(r[0]||"").trim();
    if(/^[A-Z]{1,5}$/.test(first)&&r.length>5){
      currentSym=first;
      const lp=parseFloat(String(r[1]||"").replace(/[^0-9.-]/g,""));
      if(lp>0)impliedPrice=lp;
      continue;
    }
    if(currentSym){
      const raw=String(r[0]||"");
      const dateM=raw.match(/(\d{2}\/\d{2}\/\d{4})/);
      if(dateM){
        const[mm,dd,yyyy]=dateM[1].split("/");
        const lot_date=`${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
        const qty=parseFloat(String(r[4]||"").replace(/[^0-9.-]/g,""));
        const pricePaid=parseFloat(String(r[5]||"").replace(/[^0-9.-]/g,""));
        if(isNaN(qty)||isNaN(pricePaid)||qty<=0||pricePaid<=0)continue;
        lots.push({symbol:currentSym,lot_date,shares:Math.round(qty*1e4)/1e4,price_exec:Math.round(pricePaid*100)/100,cost_basis:Math.round(Math.round(qty*1e4)/1e4*Math.round(pricePaid*100)/100*100)/100,implied_price:impliedPrice});
      }
    }
  }
  return lots;
}

function parseHealthEquityLots(rows){
  const headerIdx=rows.findIndex(r=>(r||[]).some(c=>/fund\s*name/i.test(String(c))));
  if(headerIdx<0)throw new Error("HealthEquity: header row not found");
  const hdr=rows[headerIdx];
  const col=n=>hdr.findIndex(c=>new RegExp(n,"i").test(String(c)));
  const iFund=col("fund"),iSym=col("symbol|ticker"),iShares=col("shares|units|qty"),iPrice=col("price|nav"),iDate=col("date|purchased");
  const today=new Date().toISOString().slice(0,10);
  const lots=[];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r=rows[i]||[];
    if(r.every(c=>!String(c||"").trim()))continue;
    const sym=iSym>=0&&String(r[iSym]||"").trim()?String(r[iSym]).trim().toUpperCase():String(r[iFund]||"").trim().substring(0,8).toUpperCase();
    if(!sym)continue;
    const qty=parseFloat(String(r[iShares]||"").replace(/[^0-9.-]/g,""));
    const price=parseFloat(String(r[iPrice]||"").replace(/[^0-9.-]/g,""));
    if(isNaN(qty)||isNaN(price)||qty<=0||price<=0)continue;
    const lotRaw=iDate>=0&&r[iDate]?String(r[iDate]).trim():"";
    let lot_date=today;
    const dm=lotRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if(dm){const yy=dm[3].length===2?"20"+dm[3]:dm[3];lot_date=`${yy}-${dm[1].padStart(2,"0")}-${dm[2].padStart(2,"0")}`;}
    else if(/\d{4}-\d{2}-\d{2}/.test(lotRaw))lot_date=lotRaw.slice(0,10);
    lots.push({symbol:sym,lot_date,shares:Math.round(qty*1e4)/1e4,price_exec:Math.round(price*100)/100,cost_basis:Math.round(Math.round(qty*1e4)/1e4*Math.round(price*100)/100*100)/100,implied_price:price});
  }
  return lots;
}

async function parsePortfolioFile(file){
  const ext=file.name.split(".").pop().toLowerCase();
  let rows=[];
  if(ext==="csv"){
    const text=await file.text();
    rows=text.split("\n").map(line=>{
      const out=[];let cur="";let inQ=false;
      for(const ch of line){if(ch==='"'){inQ=!inQ}else if(ch===","&&!inQ){out.push(cur.trim());cur=""}else cur+=ch}
      out.push(cur.trim());return out;
    });
  }else if(ext==="xlsx"||ext==="xls"){
    await loadSheetJS();
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
  }else throw new Error("Unsupported file type: ."+ext);
  const fmt=detectPortfolioFormat(rows);
  if(fmt==="schwab")return parseSchwabLots(rows,null);
  if(fmt==="etrade")return parseEtradeLots(rows);
  if(fmt==="healthequity")return parseHealthEquityLots(rows);
  throw new Error("Unrecognized file format. Supported: Schwab, eTrade, Health Equity.");
}

// Fetch proposed prices without saving — returns [{symbol, newPrice, source, currentPrice, currentAsOf}]
async function fetchProposedPrices(symbolList,impliedPrices={},symbolData=[]){
  const results=[];
  for(const sym of symbolList){
    try{
      let price=null,source="csv";
      try{
        const ctrl=new AbortController();const tid=setTimeout(()=>ctrl.abort(),5000);
        const resp=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,{signal:ctrl.signal});
        clearTimeout(tid);
        if(resp.ok){const j=await resp.json();const p=j?.chart?.result?.[0]?.meta?.regularMarketPrice;if(p>0){price=Math.round(p*100)/100;source="live";}}
      }catch(_){}
      if(!price&&impliedPrices[sym]>0){price=Math.round(impliedPrices[sym]*100)/100;source="csv";}
      if(!price)continue;
      const cur=symbolData.find(s=>s.symbol===sym);
      results.push({symbol:sym,newPrice:price,source,currentPrice:cur?parseFloat(cur.latest_price||0):0,currentAsOf:cur?.price_as_of||null});
    }catch(err){console.warn("fetchProposedPrices error for",sym,err)}
  }
  return results;
}

// Save old price to history, then apply new price
async function applyPriceUpdate(sym,newPrice,source,oldPrice,oldAsOf){
  const today=new Date().toISOString().slice(0,10);
  // Log old price to history if it exists
  if(oldPrice>0){
    try{await sb("investment_price_history",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({symbol:sym,price:oldPrice,price_as_of:oldAsOf||today,source:"archived"})});}
    catch(_){}
  }
  await sb(`investment_symbols?symbol=eq.${encodeURIComponent(sym)}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({latest_price:newPrice,price_as_of:today,price_source:source})});
}

// Legacy auto-apply (used outside import flow)
async function refreshPortfolioPrices(symbolList,impliedPrices={},symbolData=[]){
  const proposals=await fetchProposedPrices(symbolList,impliedPrices,symbolData);
  for(const p of proposals){
    try{await applyPriceUpdate(p.symbol,p.newPrice,p.source,p.currentPrice,p.currentAsOf);}
    catch(err){console.warn("refreshPortfolioPrices error for",p.symbol,err)}
  }
}
