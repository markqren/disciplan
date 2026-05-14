async function renderCashback(el){
  el.innerHTML='<div style="margin-bottom:16px"><h2>Cashback & Rewards</h2><p class="sub">Credit card rewards tracking · All time</p></div><div id="cbBody"><div style="text-align:center;padding:60px;color:rgba(255,255,255,0.3)">Loading...</div></div>';
  try{
    const cardMetaRows=await sb("cashback_cards?select=name,color,annual_fee_usd,points_balance,is_active,sort_order&order=sort_order.asc,name.asc");
    const cardColor={};const cardFee={};const cardPtsBal={};
    const inactiveCards=new Set();
    const knownCardNames=[];
    cardMetaRows.forEach(r=>{
      knownCardNames.push(r.name);
      cardColor[r.name]=r.color||"#888";
      cardFee[r.name]=parseFloat(r.annual_fee_usd)||0;
      cardPtsBal[r.name]=parseFloat(r.points_balance)||0;
      if(r.is_active===false)inactiveCards.add(r.name);
    });
    const rows=await sb('cashback_redemptions?order=date.desc');
    const getPtsRatioX=r=>{
      const pts=parseFloat(r.redemption_amount)||0;
      const dv=parseFloat(r.dollar_value)||0;
      if(!(pts>0&&dv>0))return null;
      return dv/pts*100;
    };
    const body=document.getElementById("cbBody");body.innerHTML="";

    // Aggregate per-card
    const byCard={};
    for(const r of rows){
      const c=r.payment_type;
      if(!byCard[c])byCard[c]={count:0,dollarValue:0,ptsRedeemed:0};
      byCard[c].count++;
      byCard[c].dollarValue+=parseFloat(r.dollar_value)||0;
      if(r.cashback_type==="Points")byCard[c].ptsRedeemed+=parseFloat(r.redemption_amount)||0;
    }
    const totalRedeemed=Object.values(byCard).reduce((s,c)=>s+c.dollarValue,0);
    const totalFees=Object.values(cardFee).reduce((s,v)=>s+(parseFloat(v)||0),0);
    const netGain=totalRedeemed-totalFees;
    const numCards=cardMetaRows.filter(r=>r.is_active!==false).length||Object.keys(byCard).length;

    // KPI cards
    const stats=h("div",{class:"g4"});
    stats.append(statCard("\uD83C\uDFC6","Total Redeemed",fmtN(totalRedeemed),"var(--g)"));
    stats.append(statCard("\uD83D\uDCB3","Annual Fees",fmtN(totalFees),"var(--r)"));
    stats.append(statCard("\u2728","Net CC Gain",fmtN(netGain),"var(--y)"));
    stats.append(statCard("\uD83C\uDFB4","Active Cards",String(numCards),"var(--b)"));
    body.append(stats);

    // Per-card summary table
    const tblCard=h("div",{class:"cd"});
    const cardEntries=Object.entries(byCard).sort((a,b)=>b[1].dollarValue-a[1].dollarValue);
    const activeEntries=cardEntries.filter(([card])=>!inactiveCards.has(card));
    const inactiveEntries=cardEntries.filter(([card])=>inactiveCards.has(card));
    let thtml='<h3>Per-Card Summary</h3><div style="overflow-x:auto"><table><thead><tr><th>Card</th><th class="r hide-m">Pts Balance</th><th class="r">Redemptions</th><th class="r">$ Redeemed</th><th class="r hide-m">Fees</th><th class="r">Net Gain</th></tr></thead><tbody>';
    let tTotalRedeem=0,tTotalFee=0,tTotalNet=0;
    let iTotalRedeem=0,iTotalFee=0,iTotalNet=0;
    const activeCount=activeEntries.reduce((s,[,d])=>s+d.count,0);
    const inactiveCount=inactiveEntries.reduce((s,[,d])=>s+d.count,0);
    for(const[card,d]of activeEntries){
      const fee=cardFee[card]||0;
      const net=d.dollarValue-fee;
      const ptsBal=cardPtsBal[card];
      const color=cardColor[card]||"#888";
      tTotalRedeem+=d.dollarValue;tTotalFee+=fee;tTotalNet+=net;
      thtml+='<tr class="cb-card-row" data-card="'+card.replace(/"/g,"&quot;")+'" style="cursor:pointer"><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+color+';margin-right:6px"></span>'+card+'</td>';
      thtml+='<td class="r m hide-m" style="color:rgba(255,255,255,0.4)">'+(ptsBal?ptsBal.toLocaleString():"")+'</td>';
      thtml+='<td class="r m" style="color:rgba(255,255,255,0.5)">'+d.count+'</td>';
      thtml+='<td class="r m" style="color:var(--g)">'+fmtT(Math.round(d.dollarValue))+'</td>';
      thtml+='<td class="r m hide-m" style="color:var(--r)">'+(fee?fmtT(fee):"")+'</td>';
      thtml+='<td class="r m" style="color:var(--y)">'+fmtT(Math.round(net))+'</td></tr>';
    }
    thtml+='<tr style="border-top:2px solid rgba(255,255,255,0.1);font-weight:700"><td>Active Total</td><td class="r m hide-m"></td><td class="r m">'+activeCount+'</td><td class="r m" style="color:var(--g)">'+fmtT(Math.round(tTotalRedeem))+'</td><td class="r m hide-m" style="color:var(--r)">'+fmtT(tTotalFee)+'</td><td class="r m" style="color:var(--y)">'+fmtT(Math.round(tTotalNet))+'</td></tr>';

    if(inactiveEntries.length){
      for(const[card,d]of inactiveEntries){
        const fee=cardFee[card]||0;
        iTotalRedeem+=d.dollarValue;iTotalFee+=fee;iTotalNet+=d.dollarValue-fee;
      }
      thtml+='<tr class="cb-inactive-toggle" style="cursor:pointer;border-top:1px solid rgba(255,255,255,0.08)"><td style="color:rgba(255,255,255,0.6)"><span class="cb-inactive-arrow" style="display:inline-block;width:14px;color:rgba(255,255,255,0.4)">▸</span>Inactive Total ('+inactiveEntries.length+' cards)</td><td class="r m hide-m"></td><td class="r m" style="color:rgba(255,255,255,0.6)">'+inactiveCount+'</td><td class="r m" style="color:var(--g)">'+fmtT(Math.round(iTotalRedeem))+'</td><td class="r m hide-m" style="color:var(--r)">'+fmtT(iTotalFee)+'</td><td class="r m" style="color:var(--y)">'+fmtT(Math.round(iTotalNet))+'</td></tr>';
      for(const[card,d]of inactiveEntries){
        const fee=cardFee[card]||0;
        const net=d.dollarValue-fee;
        const ptsBal=cardPtsBal[card];
        const color=cardColor[card]||"#888";
        thtml+='<tr class="cb-card-row cb-inactive-row" data-card="'+card.replace(/"/g,"&quot;")+'" style="cursor:pointer;display:none;opacity:0.8"><td style="padding-left:18px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+color+';margin-right:6px"></span>'+card+'</td>';
        thtml+='<td class="r m hide-m" style="color:rgba(255,255,255,0.4)">'+(ptsBal?ptsBal.toLocaleString():"")+'</td>';
        thtml+='<td class="r m" style="color:rgba(255,255,255,0.5)">'+d.count+'</td>';
        thtml+='<td class="r m" style="color:var(--g)">'+fmtT(Math.round(d.dollarValue))+'</td>';
        thtml+='<td class="r m hide-m" style="color:var(--r)">'+(fee?fmtT(fee):"")+'</td>';
        thtml+='<td class="r m" style="color:var(--y)">'+fmtT(Math.round(net))+'</td></tr>';
      }
    }
    thtml+='<tr style="border-top:2px solid rgba(255,255,255,0.1);font-weight:700"><td>Overall Total</td><td class="r m hide-m"></td><td class="r m">'+(activeCount+inactiveCount)+'</td><td class="r m" style="color:var(--g)">'+fmtT(Math.round(tTotalRedeem+iTotalRedeem))+'</td><td class="r m hide-m" style="color:var(--r)">'+fmtT(tTotalFee+iTotalFee)+'</td><td class="r m" style="color:var(--y)">'+fmtT(Math.round(tTotalNet+iTotalNet))+'</td></tr>';
    // Deduped Total: strip "Convert to Aeroplan" transfers (double-counted with downstream Aeroplan redemptions).
    const convertRe=/convert to aeroplan/i;
    const convertRows=rows.filter(r=>convertRe.test(r.item||""));
    const convertCount=convertRows.length;
    const convertValue=convertRows.reduce((s,r)=>s+(parseFloat(r.dollar_value)||0),0);
    const dedupRedeem=tTotalRedeem+iTotalRedeem-convertValue;
    const dedupFee=tTotalFee+iTotalFee;
    const dedupNet=dedupRedeem-dedupFee;
    const dedupCount=activeCount+inactiveCount-convertCount;
    thtml+='<tr style="font-weight:700;color:rgba(255,255,255,0.85)" title="Excludes '+convertCount+' Convert to Aeroplan transfer(s) totaling '+fmtT(Math.round(convertValue))+' — already counted via downstream Aeroplan redemptions"><td>Deduped Total <span style="font-weight:400;color:rgba(255,255,255,0.4);font-size:11px">(excl. Aeroplan transfers)</span></td><td class="r m hide-m"></td><td class="r m">'+dedupCount+'</td><td class="r m" style="color:var(--g)">'+fmtT(Math.round(dedupRedeem))+'</td><td class="r m hide-m" style="color:var(--r)">'+fmtT(dedupFee)+'</td><td class="r m" style="color:var(--y)">'+fmtT(Math.round(dedupNet))+'</td></tr>';
    thtml+='</tbody></table></div>';
    tblCard.innerHTML=thtml;
    body.append(tblCard);

    function normalizeCBItem(s){
      return String(s||"")
        .replace(/\s*\([^)]*\)\s*$/,"")
        .replace(/\s*-\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}.*$/i,"")
        .replace(/\s+/g," ")
        .trim();
    }

    async function openCardDetail(card){
      const existing=document.querySelector(".modal-bg");if(existing)existing.remove();
      const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
      const modal=h("div",{class:"modal",style:{maxWidth:"900px"}});
      const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px"}});
      hdr.append(h("div",{},[
        h("h3",{style:{margin:"0"}},`💳 ${card}`),
        h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.45)",marginTop:"4px"}},"Cashback card details")
      ]));
      hdr.append(h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715"));
      modal.append(hdr);
      const content=h("div",{style:{color:"rgba(255,255,255,0.45)",fontSize:"12px",padding:"20px 0",textAlign:"center"}},"Loading...");
      modal.append(content);
      bg.append(modal);
      document.body.append(bg);

      try{
        const cardRows=rows.filter(r=>r.payment_type===card).sort((a,b)=>b.date.localeCompare(a.date));
        const fee=cardFee[card]||0;
        const ptsRows=cardRows.filter(r=>r.cashback_type==="Points");
        const usdRows=cardRows.filter(r=>r.cashback_type!=="Points");
        const ptsValue=ptsRows.reduce((s,r)=>s+(parseFloat(r.dollar_value)||0),0);
        const usdValue=usdRows.reduce((s,r)=>s+(parseFloat(r.dollar_value)||0),0);
        const totalValue=ptsValue+usdValue;
        const ptsCount=ptsRows.length;
        const usdCount=usdRows.length;
        const totalPts=ptsRows.reduce((s,r)=>s+(parseFloat(r.redemption_amount)||0),0);

        // Infer annual-fee payments from ledger transactions for this card.
        // Use annual-specific wording (not generic "membership fee"), then keep the dominant
        // recurring amount bucket to avoid one-off non-card subscriptions (e.g. Splitwise).
        const cardTxns=await sb(`transactions?payment_type=eq.${encodeURIComponent(card)}&order=date.desc&select=id,date,description,amount_usd,category_id`);
        const feeRe=/(annual\s*(?:fee|membership)|(?:fee|membership)\s*annual|cardmember\s*fee)/i;
        const nonAnnualFeeRe=/(late fee|foreign(?:\s+transaction)? fee|cash advance fee|balance transfer fee|overlimit fee|returned payment fee|interest charge|finance charge)/i;
        const annualCandidates=cardTxns.filter(t=>{
          const raw=parseFloat(t.amount_usd)||0;
          if(raw<=0)return false;
          const desc=t.description||"";
          const byText=feeRe.test(desc);
          if(!byText)return false;
          if(nonAnnualFeeRe.test(desc))return false;
          return true;
        });
        let feeMatches=annualCandidates;
        if(annualCandidates.length>1){
          const amountBuckets={};
          annualCandidates.forEach(t=>{
            const amt=Math.round(parseFloat(t.amount_usd)||0);
            if(!amountBuckets[amt])amountBuckets[amt]=[];
            amountBuckets[amt].push(t);
          });
          const dominantAmt=Object.entries(amountBuckets)
            .sort((a,b)=>b[1].length-a[1].length||parseFloat(b[0])-parseFloat(a[0]))[0][0];
          const tol=Math.max(3,Math.round(parseFloat(dominantAmt)*0.05));
          feeMatches=annualCandidates.filter(t=>Math.abs((parseFloat(t.amount_usd)||0)-parseFloat(dominantAmt))<=tol);
        }

        const itemGroups={};
        for(const r of cardRows){
          const k=normalizeCBItem(r.item)||"(unspecified)";
          if(!itemGroups[k])itemGroups[k]={count:0,value:0,latest:r.date};
          itemGroups[k].count++;
          itemGroups[k].value+=(parseFloat(r.dollar_value)||0);
          if(r.date>itemGroups[k].latest)itemGroups[k].latest=r.date;
        }
        const topItems=Object.entries(itemGroups)
          .map(([item,d])=>({item,count:d.count,value:d.value,latest:d.latest}))
          .sort((a,b)=>b.value-a.value);

        let html='';
        html+='<div class="g5" style="margin-bottom:12px">';
        html+=`<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase">redeemed</div><div style="font-size:22px;color:var(--g);font-family:var(--mono);font-weight:700">${fmtN(totalValue)}</div></div>`;
        html+=`<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase">redemptions</div><div style="font-size:22px;color:var(--b);font-family:var(--mono);font-weight:700">${cardRows.length}</div></div>`;
        html+=`<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase">annual fee</div><div style="font-size:22px;color:var(--r);font-family:var(--mono);font-weight:700">${fee?fmtN(fee):"n/a"}</div></div>`;
        html+=`<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase">fee payments</div><div style="font-size:22px;color:var(--y);font-family:var(--mono);font-weight:700">${feeMatches.length}</div></div>`;
        html+=`<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase">net gain</div><div style="font-size:22px;color:var(--g);font-family:var(--mono);font-weight:700">${fmtN(totalValue-feeMatches.length*fee)}</div></div>`;
        html+='</div>';

        html+='<div class="g2" style="margin-bottom:12px">';
        html+='<div class="cd" style="margin:0"><h3 style="margin-bottom:8px">Redemption Split</h3><table><tbody>';
        html+=`<tr><td style="color:rgba(255,255,255,0.6)">Points</td><td class="r m">${ptsCount}</td><td class="r m" style="color:var(--g)">${fmtF(ptsValue)}</td></tr>`;
        html+=`<tr><td style="color:rgba(255,255,255,0.6)">Dollar Value</td><td class="r m">${usdCount}</td><td class="r m" style="color:var(--g)">${fmtF(usdValue)}</td></tr>`;
        html+=`<tr style="border-top:1px solid rgba(255,255,255,0.08)"><td style="color:rgba(255,255,255,0.6)">Points redeemed</td><td class="r m" colspan="2">${Math.round(totalPts).toLocaleString()}</td></tr>`;
        html+='</tbody></table></div>';

        html+='<div class="cd" style="margin:0"><h3 style="margin-bottom:8px">Top Items (Inferred)</h3><div style="max-height:180px;overflow:auto">';
        if(topItems.length){
          html+='<table><thead><tr><th>Item</th><th class="r">Count</th><th class="r">Value</th><th class="hide-m">Latest</th></tr></thead><tbody>';
          topItems.slice(0,30).forEach(it=>{
            html+=`<tr><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.item}</td><td class="r m">${it.count}</td><td class="r m" style="color:var(--g)">${fmtF(it.value)}</td><td class="hide-m m" style="color:rgba(255,255,255,0.4)">${fmtD(it.latest)}</td></tr>`;
          });
          html+='</tbody></table>';
        }else{
          html+='<div style="padding:10px;color:rgba(255,255,255,0.35);font-size:11px">No item history.</div>';
        }
        html+='</div></div>';
        html+='</div>';

        html+='<div class="cd" style="margin:0"><h3 style="margin-bottom:8px">All Redemptions</h3><div style="overflow:auto;max-height:260px"><table><thead><tr><th>Date</th><th>Item</th><th class="hide-m">Type</th><th class="r">Value</th></tr></thead><tbody>';
        cardRows.forEach(r=>{
          html+=`<tr><td class="m" style="color:rgba(255,255,255,0.5)">${fmtD(r.date)}</td><td style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.item||""}</td><td class="hide-m" style="color:rgba(255,255,255,0.4)">${r.cashback_type}</td><td class="r m" style="color:var(--g)">${fmtF(parseFloat(r.dollar_value)||0)}</td></tr>`;
        });
        html+='</tbody></table></div>';
        if(feeMatches.length){
          html+='<div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,0.35)">Inferred annual-fee payments from ledger:</div>';
          html+='<div style="overflow:auto;max-height:140px;margin-top:4px"><table><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>';
          feeMatches.slice(0,20).forEach(t=>{
            html+=`<tr><td class="m" style="color:rgba(255,255,255,0.5)">${fmtD(t.date)}</td><td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description||""}</td><td class="r m" style="color:var(--r)">${fmtF(parseFloat(t.amount_usd)||0)}</td></tr>`;
          });
          html+='</tbody></table></div>';
        }
        html+='</div>';
        content.innerHTML=html;
      }catch(e){
        content.innerHTML=`<div style="color:var(--r);padding:16px 0;text-align:center">Error: ${e.message}</div>`;
      }
    }

    tblCard.querySelectorAll(".cb-card-row").forEach(tr=>{
      tr.addEventListener("mouseenter",()=>tr.style.background="rgba(255,255,255,0.03)");
      tr.addEventListener("mouseleave",()=>tr.style.background="");
      tr.addEventListener("click",()=>openCardDetail(tr.dataset.card));
    });
    const inactToggle=tblCard.querySelector(".cb-inactive-toggle");
    if(inactToggle){
      let inactOpen=false;
      const inactRows=tblCard.querySelectorAll(".cb-inactive-row");
      const arrow=inactToggle.querySelector(".cb-inactive-arrow");
      inactToggle.addEventListener("click",()=>{
        inactOpen=!inactOpen;
        inactRows.forEach(r=>r.style.display=inactOpen?"":"none");
        if(arrow)arrow.textContent=inactOpen?"▾":"▸";
      });
    }

    // Stacked bar chart by year
    const byYearCard={};
    for(const r of rows){
      const y=r.date.slice(0,4);
      if(!byYearCard[y])byYearCard[y]={};
      const c=r.payment_type;
      byYearCard[y][c]=(byYearCard[y][c]||0)+(parseFloat(r.dollar_value)||0);
    }
    const years=Object.keys(byYearCard).sort();
    const allCards=[...new Set(rows.map(r=>r.payment_type))];
    const chartCards=allCards.filter(c=>!inactiveCards.has(c));
    // Sort cards by total value desc for better chart stacking
    allCards.sort((a,b)=>(byCard[b]?.dollarValue||0)-(byCard[a]?.dollarValue||0));
    chartCards.sort((a,b)=>(byCard[b]?.dollarValue||0)-(byCard[a]?.dollarValue||0));

    const chartCard=h("div",{class:"cd"});
    chartCard.innerHTML='<h3>Redemptions by Year</h3><div class="chrt"><canvas id="cbChart"></canvas></div>';
    body.append(chartCard);

    const datasets=(chartCards.length?chartCards:allCards).map(card=>({
      label:card,
      data:years.map(y=>Math.round(byYearCard[y]?.[card]||0)),
      backgroundColor:(cardColor[card]||"#888")+"CC",
      borderRadius:2
    }));

    setTimeout(()=>makeChart("cbChart",{type:"bar",data:{labels:years,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{color:"rgba(255,255,255,0.5)",font:{size:10},usePointStyle:true,pointStyleWidth:12,boxWidth:8}},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+": "+fmtT(ctx.raw)}}},scales:{x:{stacked:true,ticks:{color:"rgba(255,255,255,0.4)"},grid:{display:false}},y:{stacked:true,ticks:{color:"rgba(255,255,255,0.4)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}}}}}),50);

    // Best redemption rates (points only), shown as x ratio
    const pointsRates=rows
      .filter(r=>r.cashback_type==="Points")
      .map(r=>({row:r,ratioX:getPtsRatioX(r)}))
      .filter(x=>x.ratioX!=null)
      .sort((a,b)=>b.ratioX-a.ratioX);
    if(pointsRates.length){
      const ratioCard=h("div",{class:"cd"});
      const topRates=pointsRates.slice(0,25);
      const best=pointsRates[0].ratioX;
      const avg=pointsRates.reduce((s,x)=>s+x.ratioX,0)/pointsRates.length;
      const mid=Math.floor(pointsRates.length/2);
      const median=pointsRates.length%2?pointsRates[mid].ratioX:(pointsRates[mid-1].ratioX+pointsRates[mid].ratioX)/2;
      let rr='<h3>Best Redemption Rates</h3>';
      rr+='<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;font-size:11px;color:rgba(255,255,255,0.45)">';
      rr+='<span>Best: <span style="color:var(--g);font-family:var(--mono)">'+best.toFixed(2)+'x</span></span>';
      rr+='<span>Avg: <span style="color:var(--b);font-family:var(--mono)">'+avg.toFixed(2)+'x</span></span>';
      rr+='<span>Median: <span style="color:var(--y);font-family:var(--mono)">'+median.toFixed(2)+'x</span></span>';
      rr+='</div>';
      rr+='<div style="font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:8px">Ratio formula: (Dollar Value / Points Redeemed) x 100</div>';
      rr+='<div style="overflow:auto;max-height:280px"><table><thead><tr><th>Date</th><th>Item</th><th class="hide-m">Card</th><th class="r hide-m">Points</th><th class="r">Value</th><th class="r">Ratio</th></tr></thead><tbody>';
      topRates.forEach(({row,ratioX})=>{
        rr+='<tr><td class="m" style="color:rgba(255,255,255,0.5)">'+fmtD(row.date)+'</td>';
        rr+='<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(row.item||"")+'</td>';
        rr+='<td class="hide-m" style="color:rgba(255,255,255,0.45)">'+(row.payment_type||"")+'</td>';
        rr+='<td class="r m hide-m" style="color:rgba(255,255,255,0.45)">'+Math.round(parseFloat(row.redemption_amount)||0).toLocaleString()+'</td>';
        rr+='<td class="r m" style="color:var(--g)">'+fmtF(parseFloat(row.dollar_value)||0)+'</td>';
        rr+='<td class="r m" style="color:var(--y);font-family:var(--mono);font-weight:700">'+ratioX.toFixed(2)+'x</td></tr>';
      });
      rr+='</tbody></table></div>';
      ratioCard.innerHTML=rr;
      body.append(ratioCard);
    }

    // Recent redemptions table
    const recentCard=h("div",{class:"cd"});
    const allKnownCards=[...new Set([...knownCardNames,...allCards])];
    const cardFilterOpts=["all",...allKnownCards];
    const addCardOpts=allKnownCards.filter(c=>!inactiveCards.has(c));
    let rhtml='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Redemptions</h3><button id="cbAddBtn" class="btn" style="background:rgba(129,178,154,0.15);color:var(--g);padding:6px 14px;font-size:12px;width:auto">+ Add</button></div>';
    // Inline add-redemption form (hidden by default)
    rhtml+='<div id="cbAddForm" style="display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;margin-bottom:16px">';
    rhtml+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
    rhtml+='<div><label class="lbl">Date</label><input id="cbAddDate" class="inp" type="date" value="'+new Date().toISOString().slice(0,10)+'"></div>';
    rhtml+='<div><label class="lbl">Card</label><select id="cbAddCard" class="inp">'+addCardOpts.map(c=>'<option value="'+c+'">'+c+'</option>').join("")+'</select></div>';
    rhtml+='</div>';
    rhtml+='<div style="margin-bottom:12px"><label class="lbl">Item</label><input id="cbAddItem" class="inp" type="text" placeholder="e.g. Hilton Points Transfer"></div>';
    rhtml+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
    rhtml+='<div><label class="lbl">Type</label><select id="cbAddType" class="inp"><option value="Dollar Value">Dollar Value</option><option value="Points">Points</option></select></div>';
    rhtml+='<div><label class="lbl">Dollar Value</label><input id="cbAddAmt" class="inp" type="number" step="0.01" placeholder="e.g. 10.00"></div>';
    rhtml+='</div>';
    rhtml+='<div id="cbAddPtsRow" style="display:none;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
    rhtml+='<div><label class="lbl">Points Redeemed</label><input id="cbAddPts" class="inp" type="number" placeholder="e.g. 30000"></div>';
    rhtml+='<div><label class="lbl">Rate (\u00A2/pt)</label><input id="cbAddRate" class="inp" type="number" step="0.01" value="1.0" placeholder="e.g. 1.63"></div>';
    rhtml+='</div>';
    rhtml+='<div id="cbAddErr" style="color:var(--r);font-size:11px;margin-bottom:8px;min-height:16px"></div>';
    rhtml+='<div style="display:flex;gap:8px"><button id="cbAddSave" class="btn" style="background:rgba(129,178,154,0.2);color:var(--g);padding:10px 20px;width:auto">Save Redemption</button><button id="cbAddCancel" class="btn" style="background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);padding:10px 20px;width:auto">Cancel</button></div>';
    rhtml+='</div>';
    rhtml+='<div style="display:grid;grid-template-columns:minmax(220px,1fr) 180px 140px;gap:8px;margin-bottom:10px">';
    rhtml+='<input id="cbSearch" class="inp" type="text" placeholder="Search item...">';
    rhtml+='<select id="cbFilterCard" class="inp">'+cardFilterOpts.map(c=>'<option value="'+c+'">'+(c==="all"?"All cards":(inactiveCards.has(c)?c+" (inactive)":c))+'</option>').join("")+'</select>';
    rhtml+='<select id="cbFilterType" class="inp"><option value="all">All types</option><option value="Dollar Value">Dollar Value</option><option value="Points">Points</option></select>';
    rhtml+='</div>';
    rhtml+='<div id="cbTableWrap" style="overflow-x:auto"></div>';
    rhtml+='<div id="cbPager" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:11px;color:rgba(255,255,255,0.35)"></div>';
    recentCard.innerHTML=rhtml;
    body.append(recentCard);

    // Wire up add-redemption form
    const cbAddForm=document.getElementById("cbAddForm");
    const cbAddType=document.getElementById("cbAddType");
    const cbAddPtsRow=document.getElementById("cbAddPtsRow");
    const cbAddPts=document.getElementById("cbAddPts");
    const cbAddRate=document.getElementById("cbAddRate");
    const cbAddAmt=document.getElementById("cbAddAmt");
    document.getElementById("cbAddBtn").onclick=()=>{cbAddForm.style.display=cbAddForm.style.display==="none"?"block":"none"};
    document.getElementById("cbAddCancel").onclick=()=>{cbAddForm.style.display="none"};
    cbAddType.onchange=()=>{cbAddPtsRow.style.display=cbAddType.value==="Points"?"grid":"none"};
    // Auto-compute dollar value from points
    const cbPtsCalc=()=>{
      const pts=parseFloat(cbAddPts.value)||0;const rate=parseFloat(cbAddRate.value)||0;
      if(pts>0&&rate>0)cbAddAmt.value=(pts*rate/100).toFixed(2);
    };
    cbAddPts.oninput=cbPtsCalc;cbAddRate.oninput=cbPtsCalc;
    document.getElementById("cbAddSave").onclick=async()=>{
      const errEl=document.getElementById("cbAddErr");
      const date=document.getElementById("cbAddDate").value;
      const item=document.getElementById("cbAddItem").value.trim();
      const card=document.getElementById("cbAddCard").value;
      const type=cbAddType.value;
      const dv=parseFloat(cbAddAmt.value);
      if(!date){errEl.textContent="Date is required.";return}
      if(!item){errEl.textContent="Item is required.";return}
      if(!dv||dv<=0){errEl.textContent="Dollar value must be greater than $0.";return}
      errEl.textContent="";
      const saveBtn=document.getElementById("cbAddSave");
      saveBtn.textContent="Saving...";saveBtn.disabled=true;
      try{
        const redemptionAmount=type==="Points"?(parseFloat(cbAddPts.value)||dv):dv;
        const rate=type==="Points"?(parseFloat(cbAddRate.value)||1)/100:1;
        const result=await sb("cashback_redemptions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
          date,item,payment_type:card,cashback_type:type,
          redemption_amount:redemptionAmount,redemption_rate:rate,
          dollar_value:dv,transaction_id:null
        })});
        const newId=result[0]?.id;
        showUndo("\u2713 Redemption: "+fmtF(dv),async()=>{
          if(newId)await sb(`cashback_redemptions?id=eq.${newId}`,{method:"DELETE"});
          const root=document.getElementById("content");
          if(root)renderCashback(root);
        });
        const root=document.getElementById("content");
        if(root)renderCashback(root);
      }catch(e){errEl.textContent="Failed: "+e.message;saveBtn.textContent="Save Redemption";saveBtn.disabled=false}
    };
    const cbState={q:"",card:"all",type:"all",page:1,pageSize:50};
    const rowMap=new Map(rows.map(r=>[String(r.id),r]));
    const searchInp=document.getElementById("cbSearch");
    const cardSel=document.getElementById("cbFilterCard");
    const typeSel=document.getElementById("cbFilterType");
    const tableWrap=document.getElementById("cbTableWrap");
    const pager=document.getElementById("cbPager");

    function filteredRows(){
      const q=cbState.q.toLowerCase();
      return rows.filter(r=>{
        if(cbState.card!=="all"&&r.payment_type!==cbState.card)return false;
        if(cbState.type!=="all"&&r.cashback_type!==cbState.type)return false;
        if(q&&!String(r.item||"").toLowerCase().includes(q))return false;
        return true;
      });
    }

    function openEditModal(r){
        const existing=document.querySelector(".modal-bg");if(existing)existing.remove();
        const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
        const modal=h("div",{class:"modal",style:{maxWidth:"480px"}});
        const cardOpts=allKnownCards.map(c=>`<option value="${c}"${c===r.payment_type?" selected":""}>${c}</option>`).join("");
        modal.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px"><h3 style="margin:0">Edit Redemption</h3><span class="cb-edit-close" style="cursor:pointer;font-size:18px;color:rgba(255,255,255,0.3);line-height:1">\u2715</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px"><div><label class="lbl">Date</label><input id="cbEdDate" class="inp" type="date" value="${r.date}"></div><div><label class="lbl">Card</label><select id="cbEdCard" class="inp">${cardOpts}</select></div></div>
          <div style="margin-bottom:12px"><label class="lbl">Item</label><input id="cbEdItem" class="inp" type="text" value="${(r.item||"").replace(/"/g,"&quot;")}"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px"><div><label class="lbl">Type</label><select id="cbEdType" class="inp"><option value="Dollar Value"${r.cashback_type==="Dollar Value"?" selected":""}>Dollar Value</option><option value="Points"${r.cashback_type==="Points"?" selected":""}>Points</option></select></div><div><label class="lbl">Dollar Value</label><input id="cbEdAmt" class="inp" type="number" step="0.01" value="${parseFloat(r.dollar_value)||0}"></div></div>
          <div id="cbEdPtsRow" style="display:${r.cashback_type==="Points"?"grid":"none"};grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px"><div><label class="lbl">Points Redeemed</label><input id="cbEdPts" class="inp" type="number" value="${r.redemption_amount||""}"></div><div><label class="lbl">Rate (\u00A2/pt)</label><input id="cbEdRate" class="inp" type="number" step="0.01" value="${r.redemption_rate?Math.round(r.redemption_rate*10000)/100:""}"></div></div>
          <div id="cbEdErr" style="color:var(--r);font-size:11px;margin-bottom:8px;min-height:16px"></div>
          <div style="display:flex;gap:8px"><button id="cbEdSave" class="btn" style="background:rgba(129,178,154,0.2);color:var(--g);padding:10px 20px;width:auto">Save</button><button id="cbEdDel" class="btn" style="background:rgba(224,122,95,0.15);color:var(--r);padding:10px 20px;width:auto">Delete</button><button class="btn cb-edit-close" style="background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);padding:10px 20px;width:auto">Cancel</button></div>`;
        modal.querySelectorAll(".cb-edit-close").forEach(el=>el.addEventListener("click",()=>bg.remove()));
        const edType=modal.querySelector("#cbEdType");
        const edPtsRow=modal.querySelector("#cbEdPtsRow");
        const edPts=modal.querySelector("#cbEdPts");
        const edRate=modal.querySelector("#cbEdRate");
        const edAmt=modal.querySelector("#cbEdAmt");
        edType.onchange=()=>{edPtsRow.style.display=edType.value==="Points"?"grid":"none"};
        const ptsCalc=()=>{const p=parseFloat(edPts.value)||0;const rt=parseFloat(edRate.value)||0;if(p>0&&rt>0)edAmt.value=(p*rt/100).toFixed(2)};
        edPts.oninput=ptsCalc;edRate.oninput=ptsCalc;
        modal.querySelector("#cbEdSave").onclick=async()=>{
          const errEl=modal.querySelector("#cbEdErr");
          const date=modal.querySelector("#cbEdDate").value;
          const item=modal.querySelector("#cbEdItem").value.trim();
          const card=modal.querySelector("#cbEdCard").value;
          const type=edType.value;
          const dv=parseFloat(edAmt.value);
          if(!date){errEl.textContent="Date required";return}
          if(!item){errEl.textContent="Item required";return}
          if(!dv||dv<=0){errEl.textContent="Dollar value must be > $0";return}
          const saveBtn=modal.querySelector("#cbEdSave");
          saveBtn.textContent="Saving...";saveBtn.disabled=true;
          try{
            const redemptionAmount=type==="Points"?(parseFloat(edPts.value)||dv):dv;
            const rate=type==="Points"?(parseFloat(edRate.value)||1)/100:1;
            await sb(`cashback_redemptions?id=eq.${r.id}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({date,item,payment_type:card,cashback_type:type,redemption_amount:redemptionAmount,redemption_rate:rate,dollar_value:dv})});
            bg.remove();
            const root=document.getElementById("content");
            if(root)renderCashback(root);
          }catch(e){errEl.textContent="Failed: "+e.message;saveBtn.textContent="Save";saveBtn.disabled=false}
        };
        modal.querySelector("#cbEdDel").onclick=async()=>{
          const delBtn=modal.querySelector("#cbEdDel");
          if(delBtn.dataset.confirm){
            delBtn.textContent="Deleting...";delBtn.disabled=true;
            try{
              await sb(`cashback_redemptions?id=eq.${r.id}`,{method:"DELETE"});
              bg.remove();
              showUndo("Deleted: "+r.item,async()=>{
                await sb("cashback_redemptions",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({date:r.date,item:r.item,payment_type:r.payment_type,cashback_type:r.cashback_type,redemption_amount:r.redemption_amount,redemption_rate:r.redemption_rate,dollar_value:r.dollar_value,transaction_id:r.transaction_id})});
                const root=document.getElementById("content");
                if(root)renderCashback(root);
              });
              const root=document.getElementById("content");
              if(root)renderCashback(root);
            }catch(e){delBtn.textContent="Delete";delBtn.disabled=false}
          }else{delBtn.dataset.confirm="1";delBtn.textContent="Confirm Delete";delBtn.style.background="rgba(224,122,95,0.3)"}
        };
        bg.append(modal);document.body.append(bg);
    }

    function renderTable(){
      const filtered=filteredRows();
      const total=filtered.length;
      const totalPages=Math.max(1,Math.ceil(total/cbState.pageSize));
      if(cbState.page>totalPages)cbState.page=totalPages;
      const start=(cbState.page-1)*cbState.pageSize;
      const pageRows=filtered.slice(start,start+cbState.pageSize);

      let th='<table><thead><tr><th>Date</th><th>Item</th><th class="hide-m">Card</th><th class="hide-m">Type</th><th class="r">Value</th></tr></thead><tbody>';
      for(const r of pageRows){
        const color=cardColor[r.payment_type]||"#888";
        th+='<tr class="cb-row" data-cb-id="'+r.id+'" style="cursor:pointer"><td class="m" style="color:rgba(255,255,255,0.55);white-space:nowrap">'+fmtD(r.date)+'</td>';
        th+='<td style="color:rgba(255,255,255,0.8);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+r.item+'</td>';
        th+='<td class="hide-m"><span class="badge" style="background:'+color+'22;color:'+color+'">'+r.payment_type+'</span></td>';
        th+='<td class="hide-m" style="color:rgba(255,255,255,0.4)">'+r.cashback_type+'</td>';
        if(r.cashback_type==="Points"&&(parseFloat(r.redemption_amount)||0)>0){
          const ratioX=getPtsRatioX(r);
          const pts=Math.round(r.redemption_amount).toLocaleString();
          th+='<td class="r m" style="color:var(--g);white-space:nowrap"><span style="font-size:10px;color:rgba(255,255,255,0.3);font-weight:400;margin-right:8px">'+pts+' pts \u00b7 '+(ratioX!=null?ratioX.toFixed(2):"0.00")+'x</span>'+fmtF(parseFloat(r.dollar_value))+'</td></tr>';
        }else{
          th+='<td class="r m" style="color:var(--g)">'+fmtF(parseFloat(r.dollar_value))+'</td></tr>';
        }
      }
      if(!pageRows.length)th+='<tr><td colspan="5" style="text-align:center;color:rgba(255,255,255,0.35);padding:16px">No matching redemptions.</td></tr>';
      th+='</tbody></table>';
      tableWrap.innerHTML=th;

      tableWrap.querySelectorAll(".cb-row").forEach(tr=>{
        tr.addEventListener("mouseenter",()=>tr.style.background="rgba(255,255,255,0.03)");
        tr.addEventListener("mouseleave",()=>tr.style.background="");
        tr.addEventListener("click",()=>{
          const r=rowMap.get(tr.dataset.cbId);
          if(r)openEditModal(r);
        });
      });

      pager.innerHTML="";
      const left=h("div",{},`Showing ${total?start+1:0}-${Math.min(start+pageRows.length,total)} of ${total} filtered (${rows.length} total)`);
      const right=h("div",{style:{display:"flex",alignItems:"center",gap:"8px"}});
      const prev=h("button",{class:"pg-btn",disabled:cbState.page<=1,onClick:()=>{if(cbState.page>1){cbState.page--;renderTable()}}},"Prev");
      const ptxt=h("span",{style:{minWidth:"72px",textAlign:"center"}},`Page ${cbState.page}/${totalPages}`);
      const next=h("button",{class:"pg-btn",disabled:cbState.page>=totalPages,onClick:()=>{if(cbState.page<totalPages){cbState.page++;renderTable()}}},"Next");
      right.append(prev,ptxt,next);
      pager.append(left,right);
    }

    searchInp.addEventListener("input",()=>{cbState.q=searchInp.value.trim();cbState.page=1;renderTable()});
    cardSel.addEventListener("change",()=>{cbState.card=cardSel.value;cbState.page=1;renderTable()});
    typeSel.addEventListener("change",()=>{cbState.type=typeSel.value;cbState.page=1;renderTable()});
    renderTable();
  }catch(e){document.getElementById("cbBody").innerHTML='<div class="cd" style="color:var(--r)">Error: '+e.message+'</div>'}
}
