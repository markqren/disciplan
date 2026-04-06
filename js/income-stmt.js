async function renderIS(el){
  el.innerHTML=`<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px">
    <div><h2>Income Statement</h2><p class="sub">Accrual basis · USD · ${state.year} · Live from Supabase</p></div>
    <div class="tabs" id="yearTabs"></div></div><div id="isBody"><div style="text-align:center;padding:60px;color:rgba(255,255,255,0.3)">Loading...</div></div>`;

  const yt=document.getElementById("yearTabs");
  ["all",2023,2024,2025,2026].forEach(y=>{const b=h("button",{class:"tab"+(state.year===y?" on":""),onClick:()=>{state.year=y;history.replaceState(null,null,y==="all"?"#income-all":"#income");renderContent()}},y==="all"?"All":String(y));yt.append(b)});

  try{
    const cacheKey='is_'+state.year;
    let data=dcGet(cacheKey);
    if(!data){data=await sbRPC("get_income_statement",{p_year:state.year});dcSet(cacheKey,data)}
    const body=document.getElementById("isBody");body.innerHTML="";

    // Process monthly data
    const months={};
    for(let m=1;m<=12;m++)months[`${state.year}-${String(m).padStart(2,"0")}`]={};
    for(const r of data){const mk=r.month?.slice(0,7);if(mk&&months[mk])months[mk][r.category_id]=(parseFloat(r.amount)||0)}

    // Compute parent totals
    for(const mk of Object.keys(months)){
      for(const[p,ch]of Object.entries(SUB_MAP)){
        let v=months[mk][p]||0;
        for(const c of ch)v+=months[mk][c]||0;
        months[mk]["_p_"+p]=v;
      }
    }

    const mKeys=Object.keys(months).sort();
    const expCats=PARENT_CATS;
    const mData=mKeys.map((k,i)=>{
      const c=months[k];
      const totE=expCats.reduce((s,cat)=>s+(c["_p_"+cat]??c[cat]??0),0);
      const inc=Math.abs(c.income||0);
      const inv=c.investment||0;
      return{month:ML[i],k,c,totE,inc,inv,net:inc-totE};
    });
    const totI=mData.reduce((s,m)=>s+m.inc,0);
    const totE=mData.reduce((s,m)=>s+m.totE,0);
    const totInv=mData.reduce((s,m)=>s+m.inv,0);

    // Stats
    const stats=h("div",{class:"g5"});
    stats.append(statCard("💵","income",fmtN(totI),"var(--b)"));
    stats.append(statCard("📊","expenses",fmtN(totE),"var(--r)"));
    stats.append(statCard("✨","net savings",fmtN(totI-totE),"var(--g)"));
    stats.append(statCard("📈","savings rate",totI>0?((totI-totE)/totI*100).toFixed(1)+"%":"—","var(--y)"));
    stats.append(statCard("📊","unrealized G/L",(totInv<0?"+":totInv>0?"-":"")+fmtN(totInv),totInv<=0?"var(--g)":"var(--r)"));
    body.append(stats);

    // Cash flow chart
    const cfCard=h("div",{class:"cd"});
    cfCard.innerHTML=`<h3>Monthly Cash Flow</h3><div class="chrt"><canvas id="cfChart"></canvas></div>`;
    body.append(cfCard);
    setTimeout(()=>makeChart("cfChart",{type:"bar",data:{labels:mData.map(m=>m.month),datasets:[
      {label:"Income",data:mData.map(m=>Math.round(m.inc)),backgroundColor:"rgba(74,111,165,0.75)",borderRadius:4},
      {label:"Expenses",data:mData.map(m=>[Math.round(m.net),Math.round(m.inc)]),backgroundColor:"rgba(224,122,95,0.75)",borderRadius:4},
      {label:"Net Savings",data:mData.map(m=>Math.round(m.net)),backgroundColor:"rgba(129,178,154,0.7)",borderRadius:4},
      {label:"Savings Rate",data:mData.map(m=>m.inc>0?Math.round(m.net/m.inc*100):0),type:"line",borderColor:"#F2CC8F",backgroundColor:"rgba(242,204,143,0.1)",borderWidth:2,pointRadius:3,pointBackgroundColor:"#F2CC8F",fill:false,yAxisID:"y1"}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"rgba(255,255,255,0.5)",font:{size:11},usePointStyle:true,pointStyleWidth:16}}},scales:{x:{ticks:{color:"rgba(255,255,255,0.3)"},grid:{display:false}},y:{ticks:{color:"rgba(255,255,255,0.3)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}},y1:{position:"right",ticks:{color:"rgba(242,204,143,0.6)",callback:v=>String(v).padStart(3)+"%",font:{size:10,family:"'JetBrains Mono',monospace"}},grid:{display:false}}}}}),50);

    // Stacked expense chart + pie in 2-col
    const row2=h("div",{class:"g2"});

    const pieCard=h("div",{class:"cd"});
    pieCard.innerHTML=`<h3>Category Breakdown</h3><div class="chrt" style="height:230px"><canvas id="pieChart"></canvas></div>`;
    const catTotals=expCats.map(c=>({name:c,val:Math.round(mKeys.reduce((s,mk)=>s+(months[mk]["_p_"+c]??months[mk][c]??0),0))})).filter(c=>c.val>0).sort((a,b)=>b.val-a.val);
    row2.append(pieCard);

    const stackCard=h("div",{class:"cd"});
    stackCard.innerHTML=`<h3>Monthly Expense Stack</h3><div class="chrt" style="height:230px"><canvas id="stackChart"></canvas></div>`;
    row2.append(stackCard);
    body.append(row2);

    // Budget vs Actual chart (single-year only)
    const bgt=state.year!=="all"?getBudgetTargets(state.year):null;
    if(bgt&&totI>0){
      const budgetCard=h("div",{class:"cd"});
      const bCats=expCats.filter(c=>(bgt[c]||0)>0);
      const bActual=bCats.map(c=>{const v=mKeys.reduce((s,mk)=>s+(months[mk]["_p_"+c]??months[mk][c]??0),0);return parseFloat((v/totI*100).toFixed(1))});
      const bTarget=bCats.map(c=>bgt[c]||0);
      budgetCard.innerHTML=`<h3>Budget vs Actual</h3><div class="chrt" style="height:${Math.max(200,bCats.length*32)}px"><canvas id="budgetChart"></canvas></div>`;
      body.append(budgetCard);
      setTimeout(()=>makeChart("budgetChart",{type:"bar",data:{labels:bCats.map(c=>c[0].toUpperCase()+c.slice(1)),datasets:[
        {label:"Actual %",data:bActual,backgroundColor:bCats.map((c,i)=>bActual[i]>bTarget[i]?"rgba(224,122,95,0.7)":(CC[c]||"#666")+"B3"),borderRadius:3,barPercentage:0.6},
        {label:"Target %",data:bTarget,backgroundColor:"rgba(255,255,255,0.08)",borderColor:"rgba(255,255,255,0.25)",borderWidth:1,borderRadius:3,barPercentage:0.6}
      ]},options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"rgba(255,255,255,0.5)",font:{size:11}}},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+": "+ctx.parsed.x.toFixed(1)+"%"}}},scales:{x:{ticks:{color:"rgba(255,255,255,0.3)",callback:v=>v+"%"},grid:{color:"rgba(255,255,255,0.04)"}},y:{ticks:{color:"rgba(255,255,255,0.6)",font:{size:11}},grid:{display:false}}}}}),150);
    }

    setTimeout(()=>{
      makeChart("pieChart",{type:"doughnut",data:{labels:catTotals.map(c=>c.name),datasets:[{data:catTotals.map(c=>c.val),backgroundColor:catTotals.map(c=>CC[c.name]||"#666"),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:"50%",plugins:{legend:{position:"bottom",labels:{color:"rgba(255,255,255,0.4)",font:{size:10},padding:8}}}}});

      const stackCats=expCats.filter(c=>mData.some(m=>(m.c["_p_"+c]??m.c[c]??0)>0));
      makeChart("stackChart",{type:"bar",data:{labels:mData.map(m=>m.month),datasets:stackCats.map(c=>({label:c,data:mData.map(m=>Math.round(m.c["_p_"+c]??m.c[c]??0)),backgroundColor:CC[c]||"#666"}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{stacked:true,ticks:{color:"rgba(255,255,255,0.3)"},grid:{color:"rgba(255,255,255,0.04)"}},y:{stacked:true,ticks:{color:"rgba(255,255,255,0.3)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}}}}});
    },100);

    // Detail table with subcategories
    const tblCard=h("div",{class:"cd"});
    const now=new Date();const isCurrentYear=state.year===now.getFullYear();
    const completedMonths=isCurrentYear?now.getMonth():12;
    const activeMonths=Math.max(1,Math.min(mData.filter(m=>m.totE>0||m.inc>0).length,completedMonths));
    const hasBgt=bgt&&totI>0;
    let thtml=`<h3>Monthly Detail</h3><div style="overflow-x:auto"><table class="is-tbl" style="table-layout:fixed"><colgroup><col style="width:140px"><col style="width:70px"><col style="width:70px">`;
    for(let i=0;i<12;i++)thtml+=`<col class="is-mo">`;
    if(hasBgt)thtml+=`<col style="width:48px"><col style="width:48px">`;
    thtml+=`</colgroup><thead><tr><th>Category</th><th class="r" style="font-weight:700">Total</th><th class="r" style="font-weight:700">Avg</th>`;
    ML.forEach(m=>thtml+=`<th class="r hide-m">${m}</th>`);
    if(hasBgt)thtml+=`<th class="r hide-m" style="font-weight:600;color:rgba(255,255,255,0.35)">Tgt</th><th class="r hide-m" style="font-weight:600;color:rgba(255,255,255,0.35)">\u0394</th>`;
    thtml+=`</tr></thead><tbody>`;

    const allRows=[];
    for(const p of expCats){
      const pm=mData.map(m=>m.c["_p_"+p]??m.c[p]??0);
      const pt=pm.reduce((s,v)=>s+v,0);
      if(Math.abs(pt)<1)continue;
      allRows.push({id:p,lbl:p[0].toUpperCase()+p.slice(1),m:pm,t:pt,par:true});
      if(SUB_MAP[p])for(const ch of SUB_MAP[p]){
        const cm=mData.map(m=>m.c[ch]||0);
        const ct=cm.reduce((s,v)=>s+v,0);
        if(Math.abs(ct)<1)continue;
        allRows.push({id:ch,lbl:ch[0].toUpperCase()+ch.slice(1),m:cm,t:ct,par:false});
      }
    }

    for(const r of allRows){
      const completedTotal=r.m.slice(0,completedMonths).reduce((s,v)=>s+v,0);
      const avg=completedMonths>0?completedTotal/completedMonths:0;
      const mj=JSON.stringify(r.m.map(v=>Math.round(v)));
      if(r.par){
        const hasSubs=SUB_MAP[r.id]&&allRows.some(x=>!x.par&&SUB_MAP[r.id].includes(x.id));
        thtml+=`<tr class="is-mo-row" data-cat="${r.id}" data-is-parent="true" data-months='${mj}' style="cursor:${hasSubs?"pointer":"default"}" ${hasSubs?`onclick="document.querySelectorAll('.sub-${r.id}').forEach(el=>el.classList.toggle('hidden'));this.querySelector('.toggl').textContent=this.querySelector('.toggl').textContent==='▸'?'▾':'▸'"`:""}><td style="padding-left:4px;color:rgba(255,255,255,0.85);font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hasSubs?`<span class="toggl" style="display:inline-block;width:14px;font-size:10px;color:rgba(255,255,255,0.3)">▸</span>`:`<span style="display:inline-block;width:14px"></span>`}<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${CC[r.id]||"#555"};margin-right:6px;vertical-align:middle"></span>${r.lbl}<span class="is-mob-chev">▸</span></td>`;
      }else{
        const parentId=Object.entries(SUB_MAP).find(([,ch])=>ch.includes(r.id))?.[0]||"";
        thtml+=`<tr class="sub-${parentId} hidden is-mo-row" data-cat="${r.id}" data-is-parent="false" data-months='${mj}'><td style="padding-left:32px;color:rgba(255,255,255,0.5);font-weight:400;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${CC[r.id]||"#555"};margin-right:6px;vertical-align:middle"></span>${r.lbl}<span class="is-mob-chev">▸</span></td>`;
      }
      thtml+=`<td class="r m" style="font-weight:${r.par?700:500};color:${r.par?"rgba(255,255,255,0.85)":"rgba(255,255,255,0.6)"}">${fmtT(Math.round(r.t))}</td>`;
      thtml+=`<td class="r m" style="color:rgba(255,255,255,0.4)">${fmtT(Math.round(avg))}</td>`;
      r.m.forEach((v,mi)=>thtml+=`<td class="r m hide-m is-mo-cell" data-mi="${mi}" style="cursor:${Math.abs(v)>0.5?"pointer":"default"};color:${v<-0.5?"var(--g)":v>0.5?"rgba(255,255,255,0.6)":"rgba(255,255,255,0.15)"}">${Math.abs(v)>0.5?fmtT(Math.round(v)):""}</td>`);
      if(hasBgt){const tgt=bgt[r.id]??null;if(tgt!=null&&tgt>0){const actPct=totI>0?r.t/totI*100:0;const delta=tgt-actPct;const dClr=delta>=0?"var(--g)":"var(--r)";thtml+=`<td class="r m hide-m bgt-tgt" data-bgt-key="${r.id}" style="color:rgba(255,255,255,0.3);font-size:10px;cursor:pointer" title="Click to edit target">${tgt.toFixed(1)}%</td><td class="r m hide-m bgt-delta" style="color:${dClr};font-size:10px;font-weight:600">${delta>=0?"+":""}${delta.toFixed(1)}%</td>`}else{thtml+=`<td class="hide-m"></td><td class="hide-m"></td>`}}
      thtml+=`</tr>`;
    }

    // Totals rows (averages use completed months only)
    const cE=mData.slice(0,completedMonths).reduce((s,m)=>s+m.totE,0);
    const cI=mData.slice(0,completedMonths).reduce((s,m)=>s+m.inc,0);
    const cN=cI-cE;
    const cM=Math.max(1,completedMonths);
    thtml+=`<tr class="is-mo-row" data-cat="_expenses" data-is-parent="false" data-months='${JSON.stringify(mData.map(m=>Math.round(m.totE)))}' style="border-top:2px solid rgba(255,255,255,0.1)"><td style="font-weight:700;color:var(--r)">Total Expenses<span class="is-mob-chev">▸</span></td>`;
    thtml+=`<td class="r m" style="color:var(--r);font-weight:700">${fmtT(Math.round(totE))}</td>`;
    thtml+=`<td class="r m" style="color:var(--r);font-weight:600">${fmtT(Math.round(cE/cM))}</td>`;
    mData.forEach((m,mi)=>thtml+=`<td class="r m hide-m is-mo-cell" data-mi="${mi}" style="cursor:${m.totE>0.5?"pointer":"default"};color:var(--r);font-weight:600">${fmtT(Math.round(m.totE))}</td>`);
    if(hasBgt){const eTgt=bgt._expenses||0;const eAct=totI>0?totE/totI*100:0;const eDelta=eTgt-eAct;const eClr=eDelta>=0?"var(--g)":"var(--r)";thtml+=`<td class="r m hide-m bgt-tgt" data-bgt-key="_expenses" style="color:rgba(255,255,255,0.3);font-size:10px;cursor:pointer" title="Click to edit target">${eTgt.toFixed(1)}%</td><td class="r m hide-m bgt-delta" style="color:${eClr};font-size:10px;font-weight:600">${eDelta>=0?"+":""}${eDelta.toFixed(1)}%</td>`}
    thtml+=`</tr>`;

    thtml+=`<tr class="is-mo-row" data-cat="income" data-is-parent="false" data-months='${JSON.stringify(mData.map(m=>Math.round(m.inc)))}'><td style="font-weight:700;color:var(--b)">Income<span class="is-mob-chev">▸</span></td>`;
    thtml+=`<td class="r m" style="color:var(--b);font-weight:700">${fmtT(Math.round(totI))}</td>`;
    thtml+=`<td class="r m" style="color:var(--b);font-weight:600">${fmtT(Math.round(cI/cM))}</td>`;
    mData.forEach((m,mi)=>thtml+=`<td class="r m hide-m is-mo-cell" data-mi="${mi}" style="cursor:${m.inc>0.5?"pointer":"default"};color:var(--b);font-weight:600">${fmtT(Math.round(m.inc))}</td>`);
    if(hasBgt)thtml+=`<td class="hide-m"></td><td class="hide-m"></td>`;
    thtml+=`</tr>`;

    thtml+=`<tr class="is-mo-row" data-months='${JSON.stringify(mData.map(m=>Math.round(m.net)))}' style="border-top:1px solid rgba(255,255,255,0.08)"><td style="font-weight:700;color:var(--g)">Net Savings<span class="is-mob-chev">▸</span></td>`;
    thtml+=`<td class="r m" style="color:var(--g);font-weight:700">${fmtT(Math.round(totI-totE))}</td>`;
    thtml+=`<td class="r m" style="color:var(--g);font-weight:600">${fmtT(Math.round(cN/cM))}</td>`;
    mData.forEach(m=>thtml+=`<td class="r m hide-m" style="color:var(--g);font-weight:600">${fmtT(Math.round(m.net))}</td>`);
    if(hasBgt)thtml+=`<td class="hide-m"></td><td class="hide-m"></td>`;
    thtml+=`</tr>`;

    thtml+=`<tr class="is-mo-row" data-months='${JSON.stringify(mData.map(m=>m.inc>0?parseFloat((m.net/m.inc*100).toFixed(1)):null))}' data-month-fmt="pct"><td style="font-weight:700;color:#F2CC8F">Savings Rate<span class="is-mob-chev">▸</span></td>`;
    thtml+=`<td class="r m" style="color:#F2CC8F;font-weight:700;text-align:right">${cI>0?((cN/cI)*100).toFixed(1)+"%":"—"}</td>`;
    thtml+=`<td class="r m" style="color:#F2CC8F;font-weight:600;text-align:right">${cI>0?((cN/cI)*100).toFixed(1)+"%":"—"}</td>`;
    mData.forEach(m=>thtml+=`<td class="r m hide-m" style="color:#F2CC8F;font-weight:600;text-align:right">${m.inc>0?(m.net/m.inc*100).toFixed(1)+"%":"—"}</td>`);
    if(hasBgt){const sTgt=bgt._savings||0;const sAct=totI>0?(totI-totE)/totI*100:0;const sDelta=sAct-sTgt;const sClr=sDelta>=0?"var(--g)":"var(--r)";thtml+=`<td class="r m hide-m bgt-tgt" data-bgt-key="_savings" style="color:rgba(255,255,255,0.3);font-size:10px;cursor:pointer" title="Click to edit target">${sTgt.toFixed(1)}%</td><td class="r m hide-m bgt-delta" style="color:${sClr};font-size:10px;font-weight:600">${sDelta>=0?"+":""}${sDelta.toFixed(1)}%</td>`}
    thtml+=`</tr>`;

    // Unrealized Gains/Losses row (investment)
    if(Math.abs(totInv)>0.5){
      const invAvg=totInv/activeMonths;
      thtml+=`<tr class="is-mo-row" data-cat="investment" data-is-parent="false" data-months='${JSON.stringify(mData.map(m=>Math.round(m.inv)))}' style="border-top:1px solid rgba(255,255,255,0.08)"><td style="font-weight:700;color:#264653">Unrealized G/L<span class="is-mob-chev">▸</span></td>`;
      thtml+=`<td class="r m" style="color:#264653;font-weight:700">${fmtT(Math.round(totInv))}</td>`;
      thtml+=`<td class="r m" style="color:#264653;font-weight:600">${fmtT(Math.round(invAvg))}</td>`;
      mData.forEach((m,mi)=>thtml+=`<td class="r m hide-m is-mo-cell" data-mi="${mi}" style="cursor:${Math.abs(m.inv)>0.5?"pointer":"default"};color:#264653;font-weight:600">${Math.abs(m.inv)>0.5?fmtT(Math.round(m.inv)):""}</td>`);
      if(hasBgt)thtml+=`<td class="hide-m"></td><td class="hide-m"></td>`;
      thtml+=`</tr>`;
    }

    thtml+=`</tbody></table></div>`;
    tblCard.innerHTML=thtml;
    body.append(tblCard);

    // Editable budget targets — click Tgt cell to inline-edit
    if(hasBgt){
      function updateTgtCell(key){
        const td=tblCard.querySelector(`.bgt-tgt[data-bgt-key="${key}"]`);
        if(!td)return;
        const nv=bgt[key]||0;
        td.textContent=nv.toFixed(1)+"%";
        const deltaTd=td.nextElementSibling;
        if(deltaTd&&deltaTd.classList.contains("bgt-delta")){
          let actPct=0;
          if(key==="_expenses")actPct=totI>0?totE/totI*100:0;
          else if(key==="_savings")actPct=totI>0?(totI-totE)/totI*100:0;
          else{const r=allRows.find(r=>r.id===key);actPct=r&&totI>0?r.t/totI*100:0}
          const delta=key==="_savings"?actPct-nv:nv-actPct;
          deltaTd.style.color=delta>=0?"var(--g)":"var(--r)";
          deltaTd.textContent=(delta>=0?"+":"")+delta.toFixed(1)+"%";
        }
      }
      function recomputeAll(editedKey){
        // If a subcategory was edited, recompute its parent
        const parentEntry=Object.entries(SUB_MAP).find(([,ch])=>ch.includes(editedKey));
        if(parentEntry){
          const[par,children]=parentEntry;
          bgt[par]=Math.round(children.reduce((s,c)=>s+(bgt[c]||0),0)*10)/10;
          updateTgtCell(par);
        }
        // Sum parent category targets into _expenses, derive _savings
        bgt._expenses=Math.round(PARENT_CATS.reduce((s,c)=>s+(bgt[c]||0),0)*10)/10;
        bgt._savings=Math.round((100-bgt._expenses)*10)/10;
        updateTgtCell("_expenses");
        updateTgtCell("_savings");
      }
      const autoKeys=new Set(["_expenses","_savings",...Object.keys(SUB_MAP)]);
      tblCard.querySelectorAll(".bgt-tgt").forEach(td=>{
        const key=td.dataset.bgtKey;
        // Auto-computed keys: _expenses, _savings, and parents with subcategories
        if(autoKeys.has(key)){td.style.cursor="default";td.title="Auto-calculated from sub-targets";return}
        td.addEventListener("click",e=>{
          e.stopPropagation();
          const cur=bgt[key]||0;
          const origText=td.textContent;
          const inp=document.createElement("input");
          inp.type="number";inp.step="0.1";inp.value=cur;
          Object.assign(inp.style,{width:"42px",fontSize:"10px",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"3px",color:"#fff",padding:"1px 3px",textAlign:"right"});
          td.textContent="";td.append(inp);inp.focus();inp.select();
          const commit=()=>{
            const nv=parseFloat(inp.value);
            if(isNaN(nv)||nv<0){td.textContent=origText;return}
            bgt[key]=nv;
            // Recompute delta in the adjacent cell
            const deltaTd=td.nextElementSibling;
            if(deltaTd&&deltaTd.classList.contains("bgt-delta")){
              const r=allRows.find(r=>r.id===key);
              const actPct=r&&totI>0?r.t/totI*100:0;
              const delta=nv-actPct;
              const dClr=delta>=0?"var(--g)":"var(--r)";
              deltaTd.style.color=dClr;
              deltaTd.textContent=(delta>=0?"+":"")+delta.toFixed(1)+"%";
            }
            td.textContent=nv.toFixed(1)+"%";
            // Auto-recompute parent → _expenses → _savings
            recomputeAll(key);
            saveBudgetTargets(state.year,bgt);
          };
          inp.addEventListener("blur",commit);
          inp.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();inp.blur()}else if(ev.key==="Escape"){td.textContent=origText}});
        });
      });
    }

    // Mobile tap-to-expand monthly detail
    tblCard.querySelectorAll('.is-mo-row').forEach(tr=>{
      tr.addEventListener('click',function(){
        if(window.innerWidth>700)return;
        const nxt=tr.nextElementSibling;
        if(nxt&&nxt.classList.contains('is-mob-detail')){
          nxt.remove();
          const ch=tr.querySelector('.is-mob-chev');if(ch)ch.textContent='▸';
          return;
        }
        const months=JSON.parse(tr.dataset.months);
        const isPct=tr.dataset.monthFmt==='pct';
        const cat=tr.dataset.cat;
        const isParent=tr.dataset.isParent==='true';
        let cells='';
        months.forEach((v,i)=>{
          if(v==null||(!isPct&&Math.abs(v)<1))return;
          const val=isPct?v.toFixed(1)+"%":fmtT(v);
          const clickable=cat&&!isPct&&Math.abs(v)>0.5;
          cells+=`<span ${clickable?`class="is-mob-drill" data-mi="${i}" `:""}style="display:inline-block;padding:2px 8px;margin:1px 0;font-size:11px;font-family:var(--mono);${clickable?"cursor:pointer;text-decoration:underline;text-decoration-color:rgba(255,255,255,0.15)":""}"><span style="color:rgba(255,255,255,0.35)">${ML[i]}</span> <span style="color:rgba(255,255,255,0.6)">${val}</span></span>`;
        });
        if(!cells)return;
        const dr=document.createElement('tr');
        dr.className='is-mob-detail';
        dr.innerHTML=`<td colspan="3" style="padding:4px 8px 8px 28px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.05)"><div style="display:flex;flex-wrap:wrap;gap:0">${cells}</div></td>`;
        if(cat){
          dr.querySelectorAll('.is-mob-drill').forEach(sp=>{
            sp.addEventListener('click',function(e){
              e.stopPropagation();
              showISDrilldown(cat,isParent,parseInt(sp.dataset.mi),state.year);
            });
          });
        }
        tr.after(dr);
        const ch=tr.querySelector('.is-mob-chev');if(ch)ch.textContent='▾';
      });
    });

    // Desktop IS drilldown click handlers on month cells
    tblCard.querySelectorAll('.is-mo-cell').forEach(td=>{
      td.addEventListener('click',function(e){
        e.stopPropagation();
        const mi=parseInt(td.dataset.mi);
        const tr=td.closest('tr');
        const cat=tr.dataset.cat;
        if(!cat)return;
        const isParent=tr.dataset.isParent==='true';
        showISDrilldown(cat,isParent,mi,state.year);
      });
    });

    // Subscriptions card (collapsed by default)
    try{
      const subs=await fetchSubscriptions();
      if(subs.length){
        const today=new Date();
        const sixtyAgo=new Date(today-60*864e5).toISOString().slice(0,10);
        const active=subs.filter(s=>s.last_date>=sixtyAgo);
        const stopped=subs.filter(s=>s.last_date<sixtyAgo);
        const moCost=active.reduce((s,x)=>s+parseFloat(x.typical_amount),0);
        const sorted=[...active.sort((a,b)=>b.typical_amount-a.typical_amount),...stopped.sort((a,b)=>b.typical_amount-a.typical_amount)];

        const subCard=h("div",{class:"cd"});
        let expanded=false;
        const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"},onClick:()=>{
          expanded=!expanded;
          subBody.style.display=expanded?"block":"none";
          arrow.textContent=expanded?"\u25BE":"\u25B8";
        }});
        const arrow=h("span",{style:{color:"rgba(255,255,255,0.3)",marginRight:"8px",fontSize:"12px"}},"\u25B8");
        hdr.append(h("h3",{style:{margin:0,display:"flex",alignItems:"center"}},[arrow,"Subscriptions"]));
        hdr.append(h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.35)"}},`${active.length} active \u00b7 ${fmtN(moCost)}/mo`));
        subCard.append(hdr);

        const subBody=h("div",{style:{display:"none",marginTop:"14px"}});

        // KPI row
        const kpis=h("div",{class:"g4",style:{marginBottom:"12px"}});
        kpis.append(statCard("\uD83D\uDD04","active",String(active.length),"var(--g)"));
        kpis.append(statCard("\uD83D\uDCB5","monthly",fmtN(moCost),"var(--b)"));
        kpis.append(statCard("\uD83D\uDCC5","annual",fmtN(moCost*12),"var(--y)"));
        kpis.append(statCard("\u23F9","stopped",String(stopped.length),"var(--r)"));
        subBody.append(kpis);

        // Table
        const tWrap=h("div",{style:{overflowX:"auto"}});
        const tbl=h("table",{class:"is-tbl"});
        tbl.innerHTML=`<thead><tr><th>Merchant</th><th class="r">Monthly</th><th>Category</th><th class="hide-m">Payment</th><th class="hide-m">Last Charged</th><th>Status</th></tr></thead>`;
        const tbody=document.createElement("tbody");
        for(const s of sorted){
          const isActive=s.last_date>=sixtyAgo;
          const badge=isActive
            ?`<span style="background:rgba(129,178,154,0.15);color:var(--g);padding:1px 6px;border-radius:3px;font-size:10px">Active</span>`
            :`<span style="background:rgba(224,122,95,0.15);color:var(--r);padding:1px 6px;border-radius:3px;font-size:10px">Stopped</span>`;
          const tr=document.createElement("tr");
          tr.style.opacity=isActive?"1":"0.5";
          tr.style.cursor="pointer";
          tr.addEventListener("click",()=>showSubHistory(s.merchant,s.sample_description));
          tr.innerHTML=`<td style="color:rgba(255,255,255,0.8);font-size:12px">${s.sample_description||s.merchant}</td>`
            +`<td class="r m">${fmtF(s.typical_amount)}</td>`
            +`<td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${CC[s.category_id]||"#555"};margin-right:4px;vertical-align:middle"></span><span style="font-size:11px;color:rgba(255,255,255,0.5)">${s.category_id}</span></td>`
            +`<td class="hide-m" style="color:rgba(255,255,255,0.4);font-size:11px">${s.payment_type}</td>`
            +`<td class="hide-m m" style="color:rgba(255,255,255,0.4)">${fmtD(s.last_date)}</td>`
            +`<td>${badge}</td>`;
          tbody.append(tr);
        }
        tbl.append(tbody);tWrap.append(tbl);subBody.append(tWrap);
        subCard.append(subBody);body.append(subCard);
      }
    }catch(subErr){console.warn("Subscription card error:",subErr)}
  }catch(e){document.getElementById("isBody").innerHTML=`<div class="cd" style="border-color:rgba(224,122,95,0.3);color:var(--r)">Error loading: ${e.message}</div>`}
}

async function showISDrilldown(categoryId,isParent,monthIndex,year){
  const existing=document.querySelector(".modal-bg");if(existing)existing.remove();
  const mStart=`${year}-${String(monthIndex+1).padStart(2,"0")}-01`;
  const mEnd=new Date(year,monthIndex+1,0).toISOString().slice(0,10);
  const mLabel=ML[monthIndex]+" "+year;
  let catFilter,catLabel;
  if(categoryId==="_expenses"){
    catFilter="&category_id=neq.income&category_id=neq.investment&category_id=neq.adjustment";
    catLabel="Total Expenses";
  }else if(categoryId==="income"){
    catFilter="&category_id=eq.income";
    catLabel="Income";
  }else if(isParent&&SUB_MAP[categoryId]){
    const cats=[categoryId,...SUB_MAP[categoryId]];
    catFilter=`&category_id=in.(${cats.join(",")})`;
    catLabel=categoryId[0].toUpperCase()+categoryId.slice(1);
  }else{
    catFilter=`&category_id=eq.${categoryId}`;
    catLabel=categoryId[0].toUpperCase()+categoryId.slice(1);
  }
  const txns=await sb(`transactions?select=*${catFilter}&service_start=lte.${mEnd}&service_end=gte.${mStart}&order=date.desc&limit=500`);
  const txnAccruals=[];let total=0;
  for(const t of txns){
    const oStart=t.service_start>mStart?t.service_start:mStart;
    const oEnd=t.service_end<mEnd?t.service_end:mEnd;
    if(oStart>oEnd)continue;
    const oDays=Math.floor((new Date(oEnd)-new Date(oStart))/864e5)+1;
    const accrual=(t.daily_cost||0)*oDays;
    if(Math.abs(accrual)<0.01)continue;
    total+=accrual;
    txnAccruals.push({...t,_accrual:accrual,_oDays:oDays});
  }
  // Sort by net group accrual: linked transactions netted, then sorted by |net|
  const grps=new Map();
  for(const t of txnAccruals){
    const gid=t.transaction_group_id||("_s"+t.id);
    if(!grps.has(gid))grps.set(gid,{items:[],net:0});
    const g=grps.get(gid);g.items.push(t);g.net+=t._accrual;
  }
  const sorted=[...grps.values()].sort((a,b)=>Math.abs(b.net)-Math.abs(a.net));
  txnAccruals.length=0;
  for(const g of sorted){g.items.sort((a,b)=>Math.abs(b._accrual)-Math.abs(a._accrual));txnAccruals.push(...g.items)}
  const daysInMonth=Math.floor((new Date(mEnd)-new Date(mStart))/864e5)+1;
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  let mhtml=`<div style="display:flex;justify-content:space-between;margin-bottom:20px"><div><h2 style="font-size:22px">${catLabel}</h2><p style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:4px">${mLabel}</p></div><button onclick="this.closest('.modal-bg').remove()" style="background:rgba(255,255,255,0.06);border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;color:rgba(255,255,255,0.5);font-size:16px">✕</button></div>`;
  mhtml+=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:24px">`;
  [["Total Accrued",fmtF(total),"var(--r)"],["Transactions",txnAccruals.length,"var(--b)"],["Per Day",daysInMonth>0?fmtF(total/daysInMonth):"—","var(--g)"]].forEach(([l,v,c])=>mhtml+=`<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 14px;text-align:center"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase">${l}</div><div style="font-size:20px;font-weight:700;color:${c};font-family:var(--mono)">${v}</div></div>`);
  mhtml+=`</div>`;
  // Build group summaries for parent row rendering
  const isSummaries=new Map();
  for(const g of sorted){
    if(g.items.length<2)continue;
    const gid=g.items[0].transaction_group_id;if(!gid)continue;
    const netAmt=g.items.reduce((s,t)=>s+t.amount_usd,0);
    const catCounts={};g.items.forEach(t=>{catCounts[t.category_id]=(catCounts[t.category_id]||0)+1});
    const dominantCat=Object.entries(catCounts).sort((a,b)=>b[1]-a[1])[0][0];
    const mixedCat=Object.keys(catCounts).length>1;
    const dateMax=g.items.reduce((mx,t)=>t.date>mx?t.date:mx,"");
    isSummaries.set(gid,{netAmt,netAccrual:g.net,dominantCat,mixedCat,dateMax,memberCount:g.items.length,label:generateGroupLabel(g.items),items:g.items});
  }

  if(txnAccruals.length){
    const showCat=categoryId==="_expenses"||(isParent&&SUB_MAP[categoryId]);
    const renderedIS=new Set();
    mhtml+=`<div style="margin-top:4px"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">${txnAccruals.length} Transactions</div>`;
    mhtml+=`<div style="overflow-x:auto"><table style="width:100%;font-size:11px"><thead><tr style="color:rgba(255,255,255,0.3);font-size:10px;text-transform:uppercase"><th style="text-align:left;padding:4px 6px">Date</th><th style="text-align:left;padding:4px 6px">Description</th>${showCat?`<th style="text-align:left;padding:4px 6px" class="hide-m">Category</th>`:""}<th style="text-align:right;padding:4px 6px">Amount</th><th style="text-align:right;padding:4px 6px" class="hide-m">Accrual</th><th style="text-align:right;padding:4px 6px" class="hide-m">Days</th></tr></thead><tbody>`;
    txnAccruals.forEach(t=>{
      const gid=t.transaction_group_id;
      const gSummary=gid?isSummaries.get(gid):null;
      if(gSummary&&!renderedIS.has(gid)){
        renderedIS.add(gid);
        const sNeg=gSummary.netAccrual<0;
        mhtml+=`<tr class="is-grp-row" data-is-gid="${gid}" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03);border-left:3px solid var(--b);background:rgba(74,111,165,0.04)"><td style="padding:5px 6px;color:rgba(255,255,255,0.4);white-space:nowrap">${fmtD(gSummary.dateMax)}</td><td style="padding:5px 6px;color:rgba(255,255,255,0.9);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="is-grp-chev" data-is-grp-chev="${gid}" style="display:inline-block;font-size:10px;margin-right:4px;transition:transform 0.15s">&#9654;</span><span style="font-size:10px;margin-right:4px;color:var(--b)">🔗${gSummary.memberCount}</span>${gSummary.label}</td>${showCat?`<td style="padding:5px 6px" class="hide-m"><span style="background:${(CC[gSummary.dominantCat]||"#666")}22;color:${CC[gSummary.dominantCat]||"#888"};padding:1px 5px;border-radius:3px;font-size:10px">${gSummary.dominantCat}${gSummary.mixedCat?`<span style="margin-left:3px;font-size:9px;color:rgba(255,255,255,0.3)">+</span>`:""}</span></td>`:""}<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${sNeg?"var(--g)":"rgba(255,255,255,0.75)"};font-weight:600">${fmtF(Math.round(gSummary.netAmt*100)/100)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${sNeg?"var(--g)":"var(--r)"}" class="hide-m">${fmtF(Math.round(gSummary.netAccrual*100)/100)}</td><td style="padding:5px 6px" class="hide-m"></td></tr>`;
        gSummary.items.forEach(m=>{
          const mNeg=m._accrual<0;
          mhtml+=`<tr class="is-drill-row is-grp-child" data-tid="${m.id}" data-is-grp-child="${gid}" style="display:none;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03);border-left:3px solid rgba(74,111,165,0.3)"><td style="padding:5px 6px;padding-left:12px;color:rgba(255,255,255,0.3);white-space:nowrap">${fmtD(m.date)}</td><td style="padding:5px 6px;color:rgba(255,255,255,0.5);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.description}</td>${showCat?`<td style="padding:5px 6px" class="hide-m"><span style="background:${(CC[m.category_id]||"#666")}22;color:${CC[m.category_id]||"#888"};padding:1px 5px;border-radius:3px;font-size:10px">${m.category_id}</span></td>`:""}<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.4)">${fmtF(m.amount_usd)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${mNeg?"var(--g)":"var(--r)"}" class="hide-m">${fmtF(m._accrual)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.25)" class="hide-m">${m._oDays||""}</td></tr>`;
        });
        return;
      }
      if(gSummary&&renderedIS.has(gid))return;
      const isNeg=t._accrual<0;
      mhtml+=`<tr class="is-drill-row" data-tid="${t.id}" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03)"><td style="padding:5px 6px;color:rgba(255,255,255,0.4);white-space:nowrap">${fmtD(t.date)}</td><td style="padding:5px 6px;color:rgba(255,255,255,0.7);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description}</td>${showCat?`<td style="padding:5px 6px" class="hide-m"><span style="background:${(CC[t.category_id]||"#666")}22;color:${CC[t.category_id]||"#888"};padding:1px 5px;border-radius:3px;font-size:10px">${t.category_id}</span></td>`:""}<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.5)">${fmtF(t.amount_usd)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${isNeg?"var(--g)":"var(--r)"}" class="hide-m">${fmtF(t._accrual)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.3)" class="hide-m">${t._oDays||""}</td></tr>`;
    });
    mhtml+=`</tbody></table></div></div>`;
  }else{
    mhtml+=`<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.3)">No transactions found</div>`;
  }
  const modal=h("div",{class:"modal",style:{maxWidth:"700px"}});
  modal.innerHTML=mhtml;
  // Expand/collapse for linked groups
  const expandedISGroups=new Set();
  modal.querySelectorAll(".is-grp-row").forEach(row=>{
    row.addEventListener("click",()=>{
      const gid=row.dataset.isGid;
      if(expandedISGroups.has(gid)){expandedISGroups.delete(gid)}else{expandedISGroups.add(gid)}
      const exp=expandedISGroups.has(gid);
      modal.querySelectorAll(`[data-is-grp-child="${gid}"]`).forEach(r=>{r.style.display=exp?"table-row":"none"});
      const ch=modal.querySelector(`[data-is-grp-chev="${gid}"]`);if(ch)ch.style.transform=exp?"rotate(90deg)":"";
    });
    row.addEventListener("mouseenter",()=>row.style.background="rgba(74,111,165,0.08)");
    row.addEventListener("mouseleave",()=>row.style.background="rgba(74,111,165,0.04)");
  });
  modal.querySelectorAll(".is-drill-row").forEach(row=>{
    row.addEventListener("click",e=>{
      e.stopPropagation();
      const tid=parseInt(row.dataset.tid);
      const txn=txnAccruals.find(t=>t.id===tid);
      if(txn){bg.remove();openLedgerEditModal(txn,()=>showISDrilldown(categoryId,isParent,monthIndex,year))}
    });
    const isChild=row.classList.contains("is-grp-child");
    row.addEventListener("mouseenter",()=>row.style.background=isChild?"rgba(74,111,165,0.06)":"rgba(255,255,255,0.04)");
    row.addEventListener("mouseleave",()=>row.style.background="transparent");
  });

}
