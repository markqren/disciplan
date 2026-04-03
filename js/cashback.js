async function renderCashback(el){
  el.innerHTML='<div style="margin-bottom:16px"><h2>Cashback & Rewards</h2><p class="sub">Credit card rewards tracking · All time</p></div><div id="cbBody"><div style="text-align:center;padding:60px;color:rgba(255,255,255,0.3)">Loading...</div></div>';
  try{
    const rows=await sb('cashback_redemptions?order=date.desc');
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
    const totalFees=Object.values(CB_FEES).reduce((s,v)=>s+v,0);
    const netGain=totalRedeemed-totalFees;
    const numCards=Object.keys(byCard).length;

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
    let thtml='<h3>Per-Card Summary</h3><div style="overflow-x:auto"><table><thead><tr><th>Card</th><th class="r hide-m">Pts Balance</th><th class="r">Redemptions</th><th class="r">$ Redeemed</th><th class="r hide-m">Fees</th><th class="r">Net Gain</th></tr></thead><tbody>';
    let tTotalRedeem=0,tTotalFee=0,tTotalNet=0;
    for(const[card,d]of cardEntries){
      const fee=CB_FEES[card]||0;
      const net=d.dollarValue-fee;
      const ptsBal=CB_PTS_BAL[card];
      const color=CB_COLORS[card]||"#888";
      tTotalRedeem+=d.dollarValue;tTotalFee+=fee;tTotalNet+=net;
      thtml+='<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+color+';margin-right:6px"></span>'+card+'</td>';
      thtml+='<td class="r m hide-m" style="color:rgba(255,255,255,0.4)">'+(ptsBal?ptsBal.toLocaleString():"")+'</td>';
      thtml+='<td class="r m" style="color:rgba(255,255,255,0.5)">'+d.count+'</td>';
      thtml+='<td class="r m" style="color:var(--g)">'+fmtT(Math.round(d.dollarValue))+'</td>';
      thtml+='<td class="r m hide-m" style="color:var(--r)">'+(fee?fmtT(fee):"")+'</td>';
      thtml+='<td class="r m" style="color:var(--y)">'+fmtT(Math.round(net))+'</td></tr>';
    }
    thtml+='<tr style="border-top:2px solid rgba(255,255,255,0.1);font-weight:700"><td>Total</td><td class="r m hide-m"></td><td class="r m">'+rows.length+'</td><td class="r m" style="color:var(--g)">'+fmtT(Math.round(tTotalRedeem))+'</td><td class="r m hide-m" style="color:var(--r)">'+fmtT(tTotalFee)+'</td><td class="r m" style="color:var(--y)">'+fmtT(Math.round(tTotalNet))+'</td></tr>';
    thtml+='</tbody></table></div>';
    tblCard.innerHTML=thtml;
    body.append(tblCard);

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
    // Sort cards by total value desc for better chart stacking
    allCards.sort((a,b)=>(byCard[b]?.dollarValue||0)-(byCard[a]?.dollarValue||0));

    const chartCard=h("div",{class:"cd"});
    chartCard.innerHTML='<h3>Redemptions by Year</h3><div class="chrt"><canvas id="cbChart"></canvas></div>';
    body.append(chartCard);

    const datasets=allCards.map(card=>({
      label:card,
      data:years.map(y=>Math.round(byYearCard[y]?.[card]||0)),
      backgroundColor:(CB_COLORS[card]||"#888")+"CC",
      borderRadius:2
    }));

    setTimeout(()=>makeChart("cbChart",{type:"bar",data:{labels:years,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{color:"rgba(255,255,255,0.5)",font:{size:10},usePointStyle:true,pointStyleWidth:12,boxWidth:8}},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+": "+fmtT(ctx.raw)}}},scales:{x:{stacked:true,ticks:{color:"rgba(255,255,255,0.4)"},grid:{display:false}},y:{stacked:true,ticks:{color:"rgba(255,255,255,0.4)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}}}}}),50);

    // Recent redemptions table
    const recentCard=h("div",{class:"cd"});
    const showCount=Math.min(50,rows.length);
    let rhtml='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Recent Redemptions</h3><button id="cbAddBtn" class="btn" style="background:rgba(129,178,154,0.15);color:var(--g);padding:6px 14px;font-size:12px;width:auto">+ Add</button></div>';
    // Inline add-redemption form (hidden by default)
    rhtml+='<div id="cbAddForm" style="display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;margin-bottom:16px">';
    rhtml+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
    rhtml+='<div><label class="lbl">Date</label><input id="cbAddDate" class="inp" type="date" value="'+new Date().toISOString().slice(0,10)+'"></div>';
    rhtml+='<div><label class="lbl">Card</label><select id="cbAddCard" class="inp">'+Object.keys(CB_COLORS).map(c=>'<option value="'+c+'">'+c+'</option>').join("")+'</select></div>';
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
    rhtml+='<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Item</th><th class="hide-m">Card</th><th class="hide-m">Type</th><th class="r">Value</th></tr></thead><tbody>';
    for(let i=0;i<showCount;i++){
      const r=rows[i];
      const color=CB_COLORS[r.payment_type]||"#888";
      rhtml+='<tr class="cb-row" data-cb-idx="'+i+'" style="cursor:pointer"><td class="m" style="color:rgba(255,255,255,0.55);white-space:nowrap">'+fmtD(r.date)+'</td>';
      rhtml+='<td style="color:rgba(255,255,255,0.8);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+r.item+'</td>';
      rhtml+='<td class="hide-m"><span class="badge" style="background:'+color+'22;color:'+color+'">'+r.payment_type+'</span></td>';
      rhtml+='<td class="hide-m" style="color:rgba(255,255,255,0.4)">'+r.cashback_type+'</td>';
      if(r.cashback_type==="Points"&&r.redemption_rate){
        const cpp=Math.round(r.redemption_rate*10000)/100;
        const pts=Math.round(r.redemption_amount).toLocaleString();
        rhtml+='<td class="r m" style="color:var(--g);white-space:nowrap"><span style="font-size:10px;color:rgba(255,255,255,0.3);font-weight:400;margin-right:8px">'+pts+' pts \u00b7 '+cpp.toFixed(2)+'\u00a2/pt</span>'+fmtF(parseFloat(r.dollar_value))+'</td></tr>';
      }else{
        rhtml+='<td class="r m" style="color:var(--g)">'+fmtF(parseFloat(r.dollar_value))+'</td></tr>';
      }
    }
    rhtml+='</tbody></table></div>';
    if(rows.length>showCount)rhtml+='<div style="text-align:center;padding:8px;font-size:11px;color:rgba(255,255,255,0.3)">Showing '+showCount+' of '+rows.length+' redemptions</div>';
    else rhtml+='<div style="text-align:center;padding:8px;font-size:11px;color:rgba(255,255,255,0.3)">'+rows.length+' total redemptions</div>';
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
          renderCashback(document.getElementById("main"));
        });
        renderCashback(document.getElementById("main"));
      }catch(e){errEl.textContent="Failed: "+e.message;saveBtn.textContent="Save Redemption";saveBtn.disabled=false}
    };
    // Clickable redemption rows → edit modal
    recentCard.querySelectorAll(".cb-row").forEach(tr=>{
      tr.addEventListener("mouseenter",()=>tr.style.background="rgba(255,255,255,0.03)");
      tr.addEventListener("mouseleave",()=>tr.style.background="");
      tr.addEventListener("click",()=>{
        const r=rows[parseInt(tr.dataset.cbIdx)];if(!r)return;
        const existing=document.querySelector(".modal-bg");if(existing)existing.remove();
        const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
        const modal=h("div",{class:"modal",style:{maxWidth:"480px"}});
        const cardOpts=Object.keys(CB_COLORS).map(c=>`<option value="${c}"${c===r.payment_type?" selected":""}>${c}</option>`).join("");
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
            bg.remove();renderCashback(document.getElementById("content"));
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
                renderCashback(document.getElementById("content"));
              });
              renderCashback(document.getElementById("content"));
            }catch(e){delBtn.textContent="Delete";delBtn.disabled=false}
          }else{delBtn.dataset.confirm="1";delBtn.textContent="Confirm Delete";delBtn.style.background="rgba(224,122,95,0.3)"}
        };
        bg.append(modal);document.body.append(bg);
      });
    });
  }catch(e){document.getElementById("cbBody").innerHTML='<div class="cd" style="color:var(--r)">Error: '+e.message+'</div>'}
}
