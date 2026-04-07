function showCatYoY(catId,yearData){
  const label=catId[0].toUpperCase()+catId.slice(1);
  const rows=yearData.filter(d=>(d.cats[catId]||0)>0);
  if(!rows.length)return;
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal",style:{maxWidth:"520px"}});
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}});
  hdr.append(h("div",{},[h("h3",{style:{margin:0}},label),h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.3)",marginTop:"4px",fontFamily:"var(--mono)"}},"Year-over-year spending")]));
  hdr.append(h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"✕"));
  modal.append(hdr);
  const total=rows.reduce((s,d)=>s+(d.cats[catId]||0),0);
  const avg=total/rows.length;
  const maxRow=rows.reduce((a,b)=>(b.cats[catId]||0)>(a.cats[catId]||0)?b:a);
  const kpis=h("div",{class:"g3",style:{marginBottom:"14px"}});
  kpis.append(statCard("💵","total",fmtN(total),"var(--b)"));
  kpis.append(statCard("📅","avg/year",fmtN(avg),"var(--y)"));
  kpis.append(statCard("📈","peak year",String(maxRow.year),"var(--r)"));
  modal.append(kpis);
  const chartWrap=h("div",{class:"chrt"});
  chartWrap.append(h("canvas",{id:"catYoY_"+catId}));
  modal.append(chartWrap);
  bg.append(modal);document.body.append(bg);
  const color=CC[catId]||"rgba(129,178,154,0.7)";
  setTimeout(()=>makeChart("catYoY_"+catId,{type:"bar",data:{labels:rows.map(d=>d.year),datasets:[{label,data:rows.map(d=>Math.round(d.cats[catId]||0)),backgroundColor:color,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"rgba(255,255,255,0.4)"},grid:{display:false}},y:{ticks:{color:"rgba(255,255,255,0.4)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}}}}}),50);
}

async function renderCrossYear(el){
  el.innerHTML=`<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px">
    <div><h2>Income Statement</h2><p class="sub">Cross-year summary · USD · All Years</p></div>
    <div class="tabs" id="yearTabs"></div></div><div id="isBody"><div style="text-align:center;padding:60px;color:rgba(255,255,255,0.3)">Loading...</div></div>`;
  const yt=document.getElementById("yearTabs");
  ["all",2023,2024,2025,2026].forEach(y=>{const b=h("button",{class:"tab"+(state.year===y?" on":""),onClick:()=>{state.year=y;history.replaceState(null,null,y==="all"?"#income-all":"#income");renderContent()}},y==="all"?"All":String(y));yt.append(b)});

  try{
    const years=[2017,2018,2019,2020,2021,2022,2023,2024,2025,2026];
    let results=dcGet('crossyear');
    if(!results){results=await Promise.all(years.map(y=>sbRPC("get_income_statement",{p_year:y})));dcSet('crossyear',results)}
    const allTax=await fetchAllTaxTxns();
    const taxByYear={};
    for(const t of allTax){const yr=parseInt(t.date.slice(0,4));taxByYear[yr]=(taxByYear[yr]||0)+parseFloat(t.amount_usd)}
    const body=document.getElementById("isBody");body.innerHTML="";

    const yearData=years.map((y,i)=>{
      const data=results[i];
      let inc=0,exp=0,inv=0;
      const cats={};
      for(const r of data){
        const amt=parseFloat(r.amount)||0;
        if(r.category_id==="income"){inc+=Math.abs(amt);continue}
        if(r.category_id==="adjustment")continue;
        if(r.category_id==="investment"){inv+=amt;continue}
        exp+=amt;
        const p=Object.entries(SUB_MAP).find(([,subs])=>subs.includes(r.category_id));
        const pid=p?p[0]:r.category_id;
        cats[pid]=(cats[pid]||0)+amt;
      }
      const tax=taxByYear[y]||0;
      return{year:y,inc,exp,inv,net:inc-exp,rate:inc>0?(inc-exp)/inc:0,cats,tax,taxRate:inc>0?tax/inc:0};
    }).filter(d=>d.inc>0||d.exp>0);
    const hasTax=yearData.some(d=>d.tax>0);

    const totI=yearData.reduce((s,d)=>s+d.inc,0);
    const totE=yearData.reduce((s,d)=>s+d.exp,0);
    const totInv=yearData.reduce((s,d)=>s+d.inv,0);
    const stats=h("div",{class:"g5"});
    stats.append(statCard("💵","total income",fmtN(totI),"var(--b)"));
    stats.append(statCard("📊","total expenses",fmtN(totE),"var(--r)"));
    stats.append(statCard("✨","total saved",fmtN(totI-totE),"var(--g)"));
    stats.append(statCard("📈","avg savings rate",totI>0?((totI-totE)/totI*100).toFixed(1)+"%":"—","var(--y)"));
    stats.append(statCard("📊","unrealized G/L",(totInv<0?"+":totInv>0?"-":"")+fmtN(totInv),totInv<=0?"var(--g)":"var(--r)"));
    body.append(stats);

    const chartCard=h("div",{class:"cd"});
    chartCard.innerHTML=`<h3>Annual Cash Flow</h3><div class="chrt"><canvas id="crossYearChart"></canvas></div>`;
    body.append(chartCard);
    // Waterfall: income goes up from 0, expenses float from net to income, net is the remainder
    setTimeout(()=>makeChart("crossYearChart",{type:"bar",data:{labels:yearData.map(d=>d.year),datasets:[
      {label:"Income",data:yearData.map(d=>Math.round(d.inc)),backgroundColor:"rgba(74,111,165,0.75)",borderRadius:4},
      {label:"Expenses",data:yearData.map(d=>[Math.round(d.net),Math.round(d.inc)]),backgroundColor:"rgba(224,122,95,0.75)",borderRadius:4},
      {label:"Net Savings",data:yearData.map(d=>Math.round(d.net)),backgroundColor:"rgba(129,178,154,0.7)",borderRadius:4,borderColor:"rgba(129,178,154,0.9)",borderWidth:1},
      {label:"Savings Rate",data:yearData.map(d=>d.rate*100),type:"line",borderColor:"#F2CC8F",backgroundColor:"rgba(242,204,143,0.1)",borderWidth:2,pointRadius:3,pointBackgroundColor:"#F2CC8F",fill:false,yAxisID:"y1"}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"rgba(255,255,255,0.6)",font:{size:11},usePointStyle:true,pointStyleWidth:16}}},scales:{x:{ticks:{color:"rgba(255,255,255,0.4)"},grid:{display:false}},y:{ticks:{color:"rgba(255,255,255,0.4)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}},y1:{position:"right",min:0,max:100,ticks:{color:"rgba(242,204,143,0.6)",callback:v=>String(v).padStart(3)+"%",font:{size:10,family:"'JetBrains Mono',monospace"}},grid:{display:false}}}}}),50);

    // Tax chart (only if tax data exists)
    if(hasTax){
      const taxCard=h("div",{class:"cd"});
      taxCard.innerHTML=`<h3>Income Tax</h3><div class="chrt"><canvas id="taxCrossChart"></canvas></div>`;
      body.append(taxCard);
      setTimeout(()=>makeChart("taxCrossChart",{type:"bar",data:{labels:yearData.map(d=>d.year),datasets:[
        {label:"Tax Paid",data:yearData.map(d=>Math.round(d.tax)),backgroundColor:"rgba(224,122,95,0.65)",borderRadius:4},
        {label:"Effective Rate",data:yearData.map(d=>parseFloat((d.taxRate*100).toFixed(1))),type:"line",borderColor:"#F2CC8F",backgroundColor:"transparent",borderWidth:2,pointRadius:3,pointBackgroundColor:"#F2CC8F",fill:false,yAxisID:"y1"}
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"rgba(255,255,255,0.6)",font:{size:11},usePointStyle:true,pointStyleWidth:16}}},scales:{x:{ticks:{color:"rgba(255,255,255,0.4)"},grid:{display:false}},y:{ticks:{color:"rgba(255,255,255,0.4)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}},y1:{position:"right",min:0,ticks:{color:"rgba(242,204,143,0.6)",callback:v=>v.toFixed(0)+"%"},grid:{display:false}}}}}),50);
    }

    const tblCard=h("div",{class:"cd"});
    const cyExpCats=PARENT_CATS;
    let thtml=`<h3>Annual Detail</h3><div style="overflow-x:auto"><table><thead><tr><th>Year</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Net</th><th class="r">Rate</th>`;
    cyExpCats.forEach(c=>thtml+=`<th class="r hide-m" data-cat="${c}" style="cursor:pointer" title="Year-over-year trend">${c[0].toUpperCase()+c.slice(1,5)}</th>`);
    thtml+=`<th class="r hide-m" style="color:#264653">G/L</th>`;
    if(hasTax)thtml+=`<th class="r hide-m" style="color:rgba(224,122,95,0.8)">Tax</th><th class="r hide-m" style="color:rgba(242,204,143,0.7)">Tax%</th>`;
    thtml+=`</tr></thead><tbody>`;
    yearData.forEach(d=>{
      thtml+=`<tr><td style="font-weight:600">${d.year}</td><td class="r m" style="color:var(--b)">${fmtT(Math.round(d.inc))}</td><td class="r m" style="color:var(--r)">${fmtT(Math.round(d.exp))}</td><td class="r m" style="color:var(--g)">${fmtT(Math.round(d.net))}</td><td class="r m" style="color:var(--y)">${(d.rate*100).toFixed(1)}%</td>`;
      cyExpCats.forEach(c=>thtml+=`<td class="r m hide-m" style="color:rgba(255,255,255,0.5)">${d.cats[c]?fmtT(Math.round(d.cats[c])):""}</td>`);
      thtml+=`<td class="r m hide-m" style="color:#264653;font-weight:600">${Math.abs(d.inv)>0.5?fmtT(Math.round(d.inv)):""}</td>`;
      if(hasTax)thtml+=`<td class="r m hide-m" style="color:rgba(224,122,95,0.8)">${d.tax>0.5?fmtT(Math.round(d.tax)):""}</td><td class="r m hide-m" style="color:rgba(242,204,143,0.7)">${d.tax>0.5?(d.taxRate*100).toFixed(1)+"%":""}</td>`;
      thtml+=`</tr>`;
    });
    thtml+=`</tbody></table></div>`;
    tblCard.innerHTML=thtml;
    body.append(tblCard);
    tblCard.querySelectorAll("th[data-cat]").forEach(th=>{
      th.addEventListener("click",()=>showCatYoY(th.dataset.cat,yearData));
    });
  }catch(e){document.getElementById("isBody").innerHTML=`<div class="cd" style="color:var(--r)">Error: ${e.message}</div>`}
}
