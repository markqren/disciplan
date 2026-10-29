const IS_WEEK_PREF_KEY="dc_is_week_window";
let _isChartModes={};
let _isChartModeYear=null;

function getISWeekPref(){
  try{
    const p=JSON.parse(localStorage.getItem(IS_WEEK_PREF_KEY)||"{}");
    const before=Number.isFinite(+p.before)?+p.before:8,after=Number.isFinite(+p.after)?+p.after:8;
    return{before:Math.max(0,Math.min(26,Math.round(before))),after:Math.max(0,Math.min(26,Math.round(after)))};
  }catch(e){return{before:8,after:8}}
}
function saveISWeekPref(before,after){
  const p={before:Math.max(0,Math.min(26,parseInt(before,10)||0)),after:Math.max(0,Math.min(26,parseInt(after,10)||0))};
  try{localStorage.setItem(IS_WEEK_PREF_KEY,JSON.stringify(p))}catch(e){}
  return p;
}
function getISWeekRange(year,monthIndex){
  const pref=getISWeekPref();
  const monthStart=`${year}-${String(monthIndex+1).padStart(2,"0")}-01`;
  const monthEnd=endOfMonth(monthStart);
  const firstMonthWeek=startOfWeek(monthStart),lastMonthWeek=startOfWeek(monthEnd);
  const start=shiftDate(firstMonthWeek,-pref.before*7),end=shiftDate(lastMonthWeek,pref.after*7+6);
  const weeks=[];
  for(let d=start;d<=end;d=shiftDate(d,7))weeks.push({start:d,end:shiftDate(d,6),selected:overlapDays(d,shiftDate(d,6),monthStart,monthEnd)>0});
  return{...pref,start,end,monthStart,monthEnd,weeks,monthIndex,year};
}
async function fetchISWeekly(range){
  const key=`is_week_${range.start}_${range.end}_${state.view}`;
  let rows=dcGet(key);
  if(!rows){rows=await scopedRPC("get_income_statement_weekly",{p_start_date:range.start,p_end_date:range.end});dcSet(key,rows)}
  const byWeek={};range.weeks.forEach(w=>byWeek[w.start]={});
  for(const r of rows){
    const wk=(r.week_start||"").slice(0,10);
    if(byWeek[wk])byWeek[wk][r.category_id]=parseFloat(r.amount)||0;
  }
  for(const c of Object.values(byWeek))for(const[p,ch]of Object.entries(SUB_MAP)){
    let v=c[p]||0;for(const child of ch)v+=c[child]||0;c["_p_"+p]=v;
  }
  return range.weeks.map(w=>{
    const c=byWeek[w.start],totE=PARENT_CATS.reduce((s,cat)=>s+(c["_p_"+cat]??c[cat]??0),0),inc=Math.abs(c.income||0),inv=c.investment||0;
    return{...w,c,totE,inc,inv,net:inc-totE};
  });
}
function defaultISChartMonth(year){
  const now=new Date();
  return year===now.getFullYear()?now.getMonth():11;
}
function renderISTimeChart(card,opts){
  const st=_isChartModes[opts.key]||(_isChartModes[opts.key]={mode:"monthly",month:defaultISChartMonth(state.year)});
  const token=(card._isRenderToken||0)+1;card._isRenderToken=token;card.innerHTML="";
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"10px",flexWrap:"wrap",marginBottom:"8px"}});
  const title=h("h3",{style:{margin:0}},st.mode==="weekly"?`Weekly ${opts.title} · ${MONTH_NAMES[st.month]} ${state.year}`:`Monthly ${opts.title}`);
  const controls=h("div",{style:{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}});
  const rerender=()=>renderISTimeChart(card,opts);
  const openWeekly=month=>{st.mode="weekly";st.month=month;rerender()};
  if(st.mode==="monthly"){
    controls.append(h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.28)"}},window.matchMedia("(pointer:fine)").matches?"Double-click a month":""));
    const monthSel=h("select",{class:"inp",style:{width:"auto",padding:"5px 8px",fontSize:"11px"}});
    ML.forEach((m,i)=>{const o=h("option",{value:i},m);o.selected=i===st.month;monthSel.append(o)});
    controls.append(monthSel,h("button",{class:"pg-btn",onClick:()=>openWeekly(+monthSel.value)},"Weekly"));
  }else{
    const pref=getISWeekPref();
    const before=h("input",{class:"inp",type:"number",min:"0",max:"26",value:pref.before,style:{width:"54px",padding:"5px",fontSize:"11px"},title:"Weeks before"});
    const after=h("input",{class:"inp",type:"number",min:"0",max:"26",value:pref.after,style:{width:"54px",padding:"5px",fontSize:"11px"},title:"Weeks after"});
    const apply=()=>{saveISWeekPref(before.value,after.value);rerender()};
    before.addEventListener("change",apply);after.addEventListener("change",apply);
    controls.append(h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.35)"}},"Weeks before"),before,h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.35)"}},"after"),after,h("button",{class:"pg-btn",onClick:()=>{st.mode="monthly";rerender()}},"Monthly"));
  }
  hdr.append(title,controls);card.append(hdr);
  const chartWrap=h("div",{class:"chrt",style:{height:opts.height||"230px",position:"relative"}});
  chartWrap.append(h("canvas",{id:opts.id}));card.append(chartWrap);
  if(st.mode==="monthly"){
    setTimeout(()=>{if(card._isRenderToken!==token)return;makeChart(opts.id,opts.monthlyConfig());bindChartDoubleClick(opts.id,i=>openWeekly(i))},50);
    return;
  }
  chartWrap.insertAdjacentHTML("beforeend",'<div class="is-week-loading" style="position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,0.35);font-size:12px">Loading weekly view...</div>');
  const range=getISWeekRange(state.year,st.month);
  Promise.resolve(opts.weeklyData(range)).then(data=>{
    if(card._isRenderToken!==token||!card.isConnected)return;
    chartWrap.querySelector(".is-week-loading")?.remove();
    makeChart(opts.id,opts.weeklyConfig(data,range));
  }).catch(err=>{
    if(card._isRenderToken!==token||!card.isConnected)return;
    chartWrap.innerHTML=`<div style="display:grid;place-items:center;height:100%;color:var(--r);font-size:12px">Weekly view failed: ${err.message}</div>`;
  });
}

// Monthly category map for one year's get_income_statement rows, with "_p_<parent>"
// totals that include children.
function buildISMonths(data,year){
  const months={};
  for(let m=1;m<=12;m++)months[`${year}-${String(m).padStart(2,"0")}`]={};
  for(const r of data||[]){const mk=r.month?.slice(0,7);if(mk&&months[mk])months[mk][r.category_id]=(parseFloat(r.amount)||0)}
  for(const mk of Object.keys(months)){
    for(const[p,ch]of Object.entries(SUB_MAP)){
      let v=months[mk][p]||0;
      for(const c of ch)v+=months[mk][c]||0;
      months[mk]["_p_"+p]=v;
    }
  }
  return months;
}

async function isYearMonths(year){
  const cacheKey='is_'+year+'_'+state.view;
  let data=dcGet(cacheKey);
  if(!data){data=await scopedRPC("get_income_statement",{p_year:year});dcSet(cacheKey,data)}
  return buildISMonths(data,year);
}

function isDeltaEl(cur,prev,lbl){
  if(prev==null||Math.abs(prev)<1)return h("span",{class:"is-delta",style:{color:"rgba(255,255,255,0.25)"}},`\u2014 vs ${lbl}`);
  const d=cur-prev;
  if(Math.abs(d)<1)return h("span",{class:"is-delta",style:{color:"rgba(255,255,255,0.35)"}},`= vs ${lbl}`);
  const pct=Math.round(d/Math.abs(prev)*100);
  return h("span",{class:"is-delta "+(d>0?"up":"dn")},`${d>0?"\u25B2":"\u25BC"}${fmtT(Math.abs(Math.round(d)))} (${pct>0?"+":""}${pct}%) vs ${lbl}`);
}

function renderISMonthView(body,ctx){
  const{mData,expCats,totI,totE,completedMonths,isCurrentYear,year}=ctx;
  if(state.isMonthIdx==null||state.isMonthIdx===undefined)state.isMonthIdx=defaultISChartMonth(year);
  let mi=Math.max(0,Math.min(11,state.isMonthIdx));
  const card=h("div",{class:"cd"});
  const hdr=h("div",{class:"is-month-hdr"});
  const go=(d)=>{state.isMonthIdx=Math.max(0,Math.min(11,mi+d));renderContent()};
  hdr.append(h("button",{type:"button",class:"is-month-nav",onClick:()=>go(-1)},"\u2039"),h("div",{style:{textAlign:"center",flex:1}},h("div",{style:{fontSize:"18px",fontWeight:700}},ML[mi]+" "+year),h("div",{style:{fontSize:11,color:"rgba(255,255,255,0.4)"}},"Swipe or use arrows")),h("button",{type:"button",class:"is-month-nav",onClick:()=>go(1)},"\u203A"));
  card.append(hdr);
  let touchX=0;
  card.addEventListener("touchstart",e=>{touchX=e.touches[0].clientX},{passive:true});
  card.addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX;if(dx>60)go(-1);else if(dx<-60)go(1)},{passive:true});
  const md=mData[mi];
  const stats=h("div",{class:"g5"+(isWideMobile()?" g5-wide-m":"")});
  stats.append(statCard("💵","income",fmtN(md.inc),"var(--b)"));
  stats.append(statCard("📊","expenses",fmtN(md.totE),"var(--r)"));
  stats.append(statCard("✨","net",fmtN(md.net),"var(--g)"));
  stats.append(statCard("📈","rate",md.inc>0?((md.net/md.inc)*100).toFixed(1)+"%":"—","var(--y)"));
  card.append(stats);
  const rows=[];
  for(const p of expCats){
    const v=md.c["_p_"+p]??md.c[p]??0;
    if(Math.abs(v)<1)continue;
    rows.push({id:p,lbl:p[0].toUpperCase()+p.slice(1),val:v,par:true});
    if(SUB_MAP[p])for(const ch of SUB_MAP[p]){
      const cv=md.c[ch]||0;
      if(Math.abs(cv)<1)continue;
      rows.push({id:ch,lbl:ch[0].toUpperCase()+ch.slice(1),val:cv,par:false,parent:p});
    }
  }
  rows.sort((a,b)=>Math.abs(b.val)-Math.abs(a.val));
  const maxE=Math.max(...rows.filter(r=>r.par).map(r=>Math.abs(r.val)),1);
  const list=h("div",{style:{marginTop:"12px"}});
  list.append(h("h3",{style:{marginBottom:"8px"}},"Expenses by category"));
  list.append(h("div",{style:{fontSize:10,color:"rgba(255,255,255,0.3)",marginBottom:"6px"}},"Tap a name for subcategories, an amount for transactions, long-press for the yearly trend"));
  const deltaRows=[];
  rows.filter(r=>r.par).forEach(r=>{
    const bar=h("div",{class:"is-bar-row",style:{borderBottom:"none",paddingBottom:"2px"}});
    const lbl=h("span",{style:{width:100,fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.85)",cursor:"pointer"}},(state.isMonthExpanded===r.id?"▾ ":"▸ ")+r.lbl);
    lbl.onclick=e=>{e.stopPropagation();state.isMonthExpanded=state.isMonthExpanded===r.id?null:r.id;renderContent()};
    onLongPress(lbl,()=>showCatYoYForCat(r.id));
    bar.append(lbl);
    bar.append(h("div",{class:"is-bar-track"},h("div",{class:"is-bar-fill",style:{width:Math.round(Math.abs(r.val)/maxE*100)+"%",background:CC[r.id]||"#666"}})));
    const amt=h("span",{class:"m",style:{width:72,textAlign:"right",cursor:"pointer"}},fmtT(Math.round(r.val)));
    amt.onclick=()=>showISDrilldown(r.id,true,mi,year);
    bar.append(amt);
    list.append(bar);
    const dl=h("div",{style:{display:"flex",flexWrap:"wrap",justifyContent:"flex-end",gap:"10px",padding:"0 0 8px",borderBottom:"1px solid rgba(255,255,255,0.04)"}});
    list.append(dl);
    deltaRows.push({r,el:dl});
    if(state.isMonthExpanded===r.id){
      rows.filter(x=>x.parent===r.id).forEach(sub=>{
        const srow=h("div",{class:"is-bar-row",style:{paddingLeft:20},onClick:()=>showISDrilldown(sub.id,false,mi,year)});
        srow.append(h("span",{style:{flex:1,fontSize:11,color:"rgba(255,255,255,0.55)"}},sub.lbl));
        srow.append(h("span",{class:"m"},fmtT(Math.round(sub.val))));
        list.append(srow);
      });
    }
  });
  card.append(list);
  body.append(card);
  const yy="'"+String(year-1).slice(2);
  const lmLbl=mi>0?ML[mi-1]:ML[11]+" "+yy;
  const lyLbl=ML[mi]+" "+yy;
  const catVal=(c,id)=>c?(c["_p_"+id]??c[id]??0):null;
  const fillDeltas=prevYear=>{
    const lm=mi>0?mData[mi-1].c:prevYear?.[`${year-1}-12`];
    const ly=prevYear?.[`${year-1}-${String(mi+1).padStart(2,"0")}`];
    deltaRows.forEach(({r,el})=>{
      el.innerHTML="";
      el.append(isDeltaEl(r.val,catVal(lm,r.id),lmLbl),isDeltaEl(r.val,catVal(ly,r.id),lyLbl));
    });
  };
  fillDeltas(null);
  isYearMonths(year-1).then(fillDeltas).catch(()=>{});
}

// Category donut. Clicking a parent with children pulls that arc out of the ring,
// then splits it into subcategory slices that sum to the same total.
function renderCategoryDonut(card,months,mKeys,expCats){
  let focus=null,token=0;
  // Chart.js translates a doughnut arc by offset/4, and also insets short
  // slices by that same amount. 48 is about 12px: enough to leave the ring
  // without turning a thin subcategory into a detached blob.
  const POP=48;
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"8px",marginBottom:"16px"}});
  const title=h("h3",{style:{margin:0}},"Category Breakdown");
  const back=h("button",{type:"button",class:"pg-btn",style:{display:"none"},onClick:()=>openPie(null)},"All categories");
  hdr.append(title,back);
  const wrap=h("div",{class:"chrt",style:{height:"230px",marginTop:0}});
  wrap.append(h("canvas",{id:"pieChart"}));
  card.append(hdr,wrap);

  const yearTotal=id=>Math.round(mKeys.reduce((s,mk)=>s+(months[mk][id]||0),0));
  const parentTotal=id=>Math.round(mKeys.reduce((s,mk)=>s+(months[mk]["_p_"+id]??months[mk][id]??0),0));
  const cap=id=>id?id[0].toUpperCase()+id.slice(1):"";

  function partsOf(parent){
    const kids=SUB_MAP[parent];
    if(!kids)return [];
    const parts=[];
    for(const ch of kids){
      const val=yearTotal(ch);
      if(val>0)parts.push({id:ch,label:ch,val,color:CC[ch]||"#666",kind:"sub",parent,offset:POP});
    }
    if(!parts.length)return parts;
    const own=yearTotal(parent);
    if(own>0)parts.push({id:parent,label:parent+" (other)",val:own,color:CC[parent]||"#666",kind:"sub",parent,offset:POP});
    parts.sort((a,b)=>b.val-a.val);
    const drift=parentTotal(parent)-parts.reduce((s,p)=>s+p.val,0);
    parts[0].val=Math.max(0,parts[0].val+drift);
    return parts.filter(p=>p.val>0);
  }
  function parentSlices(popId){
    return expCats.map(id=>{
      const val=parentTotal(id);
      return{id,label:id,val,color:CC[id]||"#666",kind:"parent",expandable:partsOf(id).length>0,offset:id===popId?POP:0};
    }).filter(s=>s.val>0).sort((a,b)=>b.val-a.val);
  }
  function splitSlices(parent){
    const parts=partsOf(parent);
    const slices=[];
    for(const p of parentSlices(null)){if(p.id===parent)slices.push(...parts);else slices.push(p)}
    return slices;
  }
  function paint(slices){
    const chart=charts.pieChart;
    if(!chart||!card.isConnected)return;
    const split=slices.some(s=>s.kind==="sub");
    wrap.style.height=split?"272px":"230px";
    title.textContent=focus?cap(focus):"Category Breakdown";
    back.style.display=focus?"":"none";
    chart.$slices=slices;
    chart.data.labels=slices.map(s=>s.label);
    const ds=chart.data.datasets[0];
    ds.data=slices.map(s=>s.val);
    ds.backgroundColor=slices.map(s=>s.color);
    ds.offset=slices.map(s=>s.offset||0);
    ds.spacing=split?4:0;
    ds.borderWidth=split?2:0;
    ds.borderColor="#0a0a14";
    ds.borderRadius=split?4:0;
    chart.options.layout.padding=slices.some(s=>s.offset)?14:4;
    chart.update();
  }
  function openPie(next){
    const my=++token;
    if(next&&!partsOf(next).length)return;
    const chart=charts.pieChart;
    const subsOpen=chart?.$slices?.some(s=>s.kind==="sub");
    if(!next){
      const prev=focus;
      if(prev&&subsOpen){
        paint(parentSlices(prev));
        setTimeout(()=>{if(token!==my||!card.isConnected)return;focus=null;paint(parentSlices(null))},460);
        return;
      }
      focus=null;
      paint(parentSlices(null));
      return;
    }
    if(next===focus&&subsOpen)return;
    focus=next;
    const showingParents=!chart?.$slices||chart.$slices.every(s=>s.kind==="parent");
    if(showingParents){
      paint(parentSlices(next));
      setTimeout(()=>{if(token===my&&card.isConnected)paint(splitSlices(next))},460);
      return;
    }
    paint(splitSlices(next));
  }
  function onPick(index){
    const slice=charts.pieChart?.$slices?.[index];
    if(!slice)return;
    if(slice.expandable)openPie(slice.id);
  }

  setTimeout(()=>{
    const canvas=card.querySelector("canvas");
    if(!card.isConnected||!canvas)return;
    const slices=parentSlices(null);
    makeChart("pieChart",{type:"doughnut",data:{labels:slices.map(s=>s.label),datasets:[{data:slices.map(s=>s.val),backgroundColor:slices.map(s=>s.color),borderWidth:0,offset:slices.map(()=>0),spacing:0,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:"50%",layout:{padding:4},animation:{duration:420},onClick(e,els){if(els.length)onPick(els[0].index)},onHover(e,els){const c=e.native?.target;if(!c)return;const slice=els.length?charts.pieChart?.$slices?.[els[0].index]:null;c.style.cursor=slice&&slice.expandable?"pointer":"default"},plugins:{legend:{position:"bottom",labels:{color:"rgba(255,255,255,0.4)",font:{size:10},padding:8},onClick(e,item){onPick(item.index)},onHover(e,item){const slice=charts.pieChart?.$slices?.[item.index];e.native.target.style.cursor=slice&&slice.expandable?"pointer":"default"},onLeave(e){e.native.target.style.cursor="default"}},tooltip:{callbacks:{label(ctx){const slice=ctx.chart.$slices?.[ctx.dataIndex];const val=ctx.parsed;const all=(ctx.chart.$slices||[]).reduce((s,x)=>s+x.val,0);const pct=all?(val/all*100).toFixed(1):"0.0";if(slice?.kind==="sub"){const grp=ctx.chart.$slices.filter(s=>s.parent===slice.parent).reduce((s,x)=>s+x.val,0);const ofP=grp?Math.round(val/grp*100):0;return `${fmtT(val)} (${pct}%, ${ofP}% of ${slice.parent})`}return `${fmtT(val)} (${pct}%)`}}}}}});
    if(charts.pieChart)charts.pieChart.$slices=slices;
  },100);
}

async function renderIS(el){
  if(_isChartModeYear!==state.year){_isChartModeYear=state.year;_isChartModes={}}
  el.innerHTML=`<div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
    <div><h2>Income Statement</h2><p class="sub">Accrual basis · USD · ${state.year} · Live from Supabase</p></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><div class="tabs" id="yearTabs"></div><div id="isModeBar"></div></div></div><div id="isBody"><div style="text-align:center;padding:60px;color:rgba(255,255,255,0.3)">Loading...</div></div>`;

  const yt=document.getElementById("yearTabs");
  ["all",2023,2024,2025,2026].forEach(y=>{const b=h("button",{class:"tab"+(state.year===y?" on":""),onClick:()=>{state.year=y;history.replaceState(null,null,y==="all"?"#income-all":"#income");renderContent()}},y==="all"?"All":String(y));yt.append(b)});
  if(state.year!=="all"){
    document.getElementById("isModeBar").append(segmented([["month","Month"],["year","Year"]],getIsMode(),v=>{setIsMode(v);renderContent()}));
  }

  try{
    const cacheKey='is_'+state.year+'_'+state.view;
    let data=dcGet(cacheKey);
    if(!data){data=await scopedRPC("get_income_statement",{p_year:state.year});dcSet(cacheKey,data)}
    const body=document.getElementById("isBody");body.innerHTML="";

    const months=buildISMonths(data,state.year);

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
    const now=new Date();
    const isCurrentYear=state.year===now.getFullYear();
    const completedMonths=isCurrentYear?now.getMonth():12;

    // Stats
    const stats=h("div",{class:"g5"});
    stats.append(statCard("💵","income",fmtN(totI),"var(--b)"));
    stats.append(statCard("📊","expenses",fmtN(totE),"var(--r)"));
    stats.append(statCard("✨","net savings",fmtN(totI-totE),"var(--g)"));
    stats.append(statCard("📈","savings rate",totI>0?((totI-totE)/totI*100).toFixed(1)+"%":"—","var(--y)"));
    stats.append(statCard("📊","unrealized G/L",(totInv<0?"+":totInv>0?"-":"")+fmtN(totInv),totInv<=0?"var(--g)":"var(--r)"));
    if(getIsMode()==="month"){
      renderISMonthView(body,{mData,expCats,totI,totE,totInv,completedMonths,isCurrentYear,year:state.year});
      return;
    }
    body.append(stats);

    const chartsStack=h("div",{class:"stack"});
    const appendChart=child=>{isMobile()?chartsStack.append(child):body.append(child)};
    // Cash flow chart
    const cfCard=h("div",{class:"cd"});
    appendChart(cfCard);
    const cashFlowConfig=(rows,weekly)=>({type:"bar",data:{labels:rows.map(m=>weekly?weekLabel(m.start):m.month),datasets:[
      {label:"Income",data:rows.map(m=>Math.round(m.inc)),backgroundColor:"rgba(74,111,165,0.75)",borderColor:rows.map(m=>m.selected?"rgba(242,204,143,0.9)":"transparent"),borderWidth:rows.map(m=>m.selected?2:0),borderRadius:4},
      {label:"Expenses",data:rows.map(m=>[Math.round(m.net),Math.round(m.inc)]),backgroundColor:"rgba(224,122,95,0.75)",borderColor:rows.map(m=>m.selected?"rgba(242,204,143,0.9)":"transparent"),borderWidth:rows.map(m=>m.selected?2:0),borderRadius:4},
      {label:"Net Savings",data:rows.map(m=>Math.round(m.net)),backgroundColor:"rgba(129,178,154,0.7)",borderColor:rows.map(m=>m.selected?"rgba(242,204,143,0.9)":"transparent"),borderWidth:rows.map(m=>m.selected?2:0),borderRadius:4},
      {label:"Savings Rate",data:rows.map((m,i)=>(weekly?m.end<today():i<completedMonths)?(m.inc>0?Math.round(m.net/m.inc*100):0):null),type:"line",borderColor:"#F2CC8F",backgroundColor:"rgba(242,204,143,0.1)",borderWidth:2,pointRadius:weekly?1:3,pointBackgroundColor:"#F2CC8F",fill:false,yAxisID:"y1"}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"rgba(255,255,255,0.5)",font:{size:11},usePointStyle:true,pointStyleWidth:16}},tooltip:{callbacks:{title:items=>weekly&&items.length?`${fmtD(rows[items[0].dataIndex].start)}–${fmtD(rows[items[0].dataIndex].end)}`:items[0]?.label,label:ctx=>{const d=ctx.dataset.label;if(d==="Savings Rate")return d+": "+(ctx.parsed.y==null?"\u2014":Math.round(ctx.parsed.y)+"%");if(d==="Expenses"){const r=ctx.raw;return d+": "+fmtT(Array.isArray(r)?r[1]-r[0]:r);}return d+": "+fmtT(ctx.parsed.y);}}}},scales:{x:{ticks:{color:ctx=>weekly&&rows[ctx.index]?.selected?"rgba(242,204,143,0.9)":"rgba(255,255,255,0.3)",maxTicksLimit:weekly?(window.innerWidth<=700?7:14):12},grid:{display:false}},y:{ticks:{color:"rgba(255,255,255,0.3)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}},y1:{position:"right",ticks:{color:"rgba(242,204,143,0.6)",callback:v=>String(v).padStart(3)+"%",font:{size:10,family:"'JetBrains Mono',monospace"}},grid:{display:false}}}}});
    renderISTimeChart(cfCard,{key:"cashflow",title:"Cash Flow",id:"cfChart",height:"270px",monthlyConfig:()=>cashFlowConfig(mData,false),weeklyData:fetchISWeekly,weeklyConfig:rows=>cashFlowConfig(rows,true)});

    // Stacked expense chart + pie in 2-col
    const row2=h("div",{class:"g2"});

    const pieCard=h("div",{class:"cd"});
    row2.append(pieCard);
    renderCategoryDonut(pieCard,months,mKeys,expCats);

    const stackCard=h("div",{class:"cd"});
    row2.append(stackCard);
    appendChart(row2);
    if(isMobile()&&chartsStack.childNodes.length)body.append(uiCollapsible("Charts",chartsStack,false));
    const stackConfig=(rows,weekly)=>{
      const stackCats=expCats.filter(c=>rows.some(m=>(m.c["_p_"+c]??m.c[c]??0)>0));
      return{type:"bar",data:{labels:rows.map(m=>weekly?weekLabel(m.start):m.month),datasets:stackCats.map(c=>({label:c,data:rows.map(m=>Math.round(m.c["_p_"+c]??m.c[c]??0)),backgroundColor:CC[c]||"#666",borderColor:rows.map(m=>m.selected?"rgba(242,204,143,0.9)":"transparent"),borderWidth:rows.map(m=>m.selected?1:0)}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>weekly&&items.length?`${fmtD(rows[items[0].dataIndex].start)}–${fmtD(rows[items[0].dataIndex].end)}`:items[0]?.label}}},scales:{x:{stacked:true,ticks:{color:ctx=>weekly&&rows[ctx.index]?.selected?"rgba(242,204,143,0.9)":"rgba(255,255,255,0.3)",maxTicksLimit:weekly?(window.innerWidth<=700?7:14):12},grid:{color:"rgba(255,255,255,0.04)"}},y:{stacked:true,ticks:{color:"rgba(255,255,255,0.3)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}}}}};
    };
    renderISTimeChart(stackCard,{key:"expenses",title:"Expense Stack",id:"stackChart",height:"230px",monthlyConfig:()=>stackConfig(mData,false),weeklyData:fetchISWeekly,weeklyConfig:rows=>stackConfig(rows,true)});

    // Budget vs Actual chart (single-year only)
    const bgt=state.year!=="all"?await ensureBudgetTargets(state.year):null;
    if(bgt&&totI>0){
      const budgetCard=h("div",{class:"cd"});
      const bCats=expCats.filter(c=>(bgt[c]||0)>0);
      const bActual=bCats.map(c=>{const v=mKeys.reduce((s,mk)=>s+(months[mk]["_p_"+c]??months[mk][c]??0),0);return parseFloat((v/totI*100).toFixed(1))});
      const bTarget=bCats.map(c=>bgt[c]||0);
      budgetCard.innerHTML=`<h3>Budget vs Actual</h3><div class="chrt" style="height:${Math.max(200,bCats.length*32)}px"><canvas id="budgetChart"></canvas></div>`;
      appendChart(budgetCard);
      setTimeout(()=>makeChart("budgetChart",{type:"bar",data:{labels:bCats.map(c=>c[0].toUpperCase()+c.slice(1)),datasets:[
        {label:"Actual %",data:bActual,backgroundColor:bCats.map((c,i)=>bActual[i]>bTarget[i]?"rgba(224,122,95,0.7)":(CC[c]||"#666")+"B3"),borderRadius:3,barPercentage:0.6},
        {label:"Target %",data:bTarget,backgroundColor:"rgba(255,255,255,0.08)",borderColor:"rgba(255,255,255,0.25)",borderWidth:1,borderRadius:3,barPercentage:0.6}
      ]},options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"rgba(255,255,255,0.5)",font:{size:11}}},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+": "+ctx.parsed.x.toFixed(1)+"%"}}},scales:{x:{ticks:{color:"rgba(255,255,255,0.3)",callback:v=>v+"%"},grid:{color:"rgba(255,255,255,0.04)"}},y:{ticks:{color:"rgba(255,255,255,0.6)",font:{size:11}},grid:{display:false}}}}}),150);
    }

    // Detail table with subcategories
    const tblCard=h("div",{class:"cd"});
    const activeMonths=Math.max(1,Math.min(mData.filter(m=>m.totE>0||m.inc>0).length,completedMonths));
    const hasBgt=bgt&&totI>0;
    const curMoIdx=isCurrentYear?now.getMonth():11;
    const mobTbl=isMobile();
    let thtml=`<h3>Monthly Detail</h3><div style="overflow-x:auto"><table class="is-tbl"${mobTbl?"":" style=\"table-layout:fixed\""}><colgroup><col style="width:140px"><col style="width:70px"><col style="width:70px">`;
    if(mobTbl)thtml+=`<col style="width:64px">`;
    else for(let i=0;i<12;i++)thtml+=`<col class="is-mo">`;
    if(hasBgt&&!mobTbl)thtml+=`<col style="width:48px"><col style="width:48px">`;
    thtml+=`</colgroup><thead><tr><th>Category</th><th class="r" style="font-weight:700">Total</th><th class="r" style="font-weight:700">Avg</th>`;
    if(mobTbl)thtml+=`<th class="r">${ML[curMoIdx]}</th>`;
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
        thtml+=`<tr class="is-mo-row" data-cat="${r.id}" data-is-parent="true" data-sub="${r.id}" data-months='${mj}' style="cursor:${hasSubs?"pointer":"default"}"><td class="is-cat-cell" style="padding-left:4px;color:rgba(255,255,255,0.85);font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hasSubs?`<span class="toggl" style="display:inline-block;width:14px;font-size:10px;color:rgba(255,255,255,0.3)">▸</span>`:`<span style="display:inline-block;width:14px"></span>`}<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${CC[r.id]||"#555"};margin-right:6px;vertical-align:middle"></span>${r.lbl}</td>`;
      }else{
        const parentId=Object.entries(SUB_MAP).find(([,ch])=>ch.includes(r.id))?.[0]||"";
        thtml+=`<tr class="sub-${parentId} hidden is-mo-row" data-cat="${r.id}" data-is-parent="false" data-months='${mj}'><td class="is-cat-cell" style="padding-left:32px;color:rgba(255,255,255,0.5);font-weight:400;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${CC[r.id]||"#555"};margin-right:6px;vertical-align:middle"></span>${r.lbl}</td>`;
      }
      thtml+=`<td class="r m is-total-cell" style="font-weight:${r.par?700:500};color:${r.par?"rgba(255,255,255,0.85)":"rgba(255,255,255,0.6)"}">${fmtT(Math.round(r.t))}<span class="is-mob-chev">▸</span></td>`;
      thtml+=`<td class="r m" style="color:rgba(255,255,255,0.4)">${fmtT(Math.round(avg))}</td>`;
      if(mobTbl){const cv=Math.round(r.m[curMoIdx]||0);thtml+=`<td class="r m is-mo-cell" data-mi="${curMoIdx}" style="cursor:${Math.abs(cv)>0.5?"pointer":"default"};color:${cv<-0.5?"var(--g)":cv>0.5?"rgba(255,255,255,0.6)":"rgba(255,255,255,0.15)"}">${Math.abs(cv)>0.5?fmtT(cv):""}</td>`}
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

    thtml+=`<tr class="is-mo-row" data-months='${JSON.stringify(mData.map((m,i)=>i<completedMonths?(m.inc>0?parseFloat((m.net/m.inc*100).toFixed(1)):null):null))}' data-month-fmt="pct"><td style="font-weight:700;color:#F2CC8F">Savings Rate<span class="is-mob-chev">▸</span></td>`;
    thtml+=`<td class="r m" style="color:#F2CC8F;font-weight:700;text-align:right">${cI>0?((cN/cI)*100).toFixed(1)+"%":"—"}</td>`;
    thtml+=`<td class="r m" style="color:#F2CC8F;font-weight:600;text-align:right">${cI>0?((cN/cI)*100).toFixed(1)+"%":"—"}</td>`;
    mData.forEach((m,mi)=>thtml+=`<td class="r m hide-m" style="color:#F2CC8F;font-weight:600;text-align:right">${mi<completedMonths?(m.inc>0?(m.net/m.inc*100).toFixed(1)+"%":"—"):"—"}</td>`);
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
            void saveBudgetTargets(state.year,bgt);
          };
          inp.addEventListener("blur",commit);
          inp.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();inp.blur()}else if(ev.key==="Escape"){td.textContent=origText}});
        });
      });
    }

    function clearMobDetails(tr){
      let n=tr.nextElementSibling;
      while(n&&n.classList.contains("is-mob-detail")){const rm=n;n=n.nextElementSibling;rm.remove()}
    }
    function clearSubDetails(parentId){
      tblCard.querySelectorAll(`.sub-${parentId}.is-mo-row`).forEach(sub=>clearMobDetails(sub));
    }
    tblCard.addEventListener("click",e=>{
      if(window.innerWidth>700)return;
      const drill=e.target.closest(".is-mob-drill");
      if(drill){
        e.stopPropagation();
        const tr=drill.closest("tr.is-mo-row");
        showISDrilldown(tr.dataset.cat,tr.dataset.isParent==="true",parseInt(drill.dataset.mi),state.year);
        return;
      }
      const catCell=e.target.closest(".is-cat-cell");
      if(catCell){
        const tr=catCell.closest("tr.is-mo-row");
        if(!tr||!tr.dataset.sub)return;
        const pid=tr.dataset.sub;
        const togg=tr.querySelector(".toggl");
        tblCard.querySelectorAll(`.sub-${pid}`).forEach(el=>el.classList.toggle("hidden"));
        if(togg)togg.textContent=togg.textContent==="▸"?"▾":"▸";
        clearMobDetails(tr);
        clearSubDetails(pid);
        return;
      }
      const totalCell=e.target.closest(".is-total-cell");
      if(!totalCell)return;
      const tr=totalCell.closest("tr.is-mo-row");
      if(!tr||!tr.dataset.months)return;
      const nxt=tr.nextElementSibling;
      if(nxt&&nxt.classList.contains("is-mob-detail")){clearMobDetails(tr);return}
      const months=JSON.parse(tr.dataset.months);
      const isPct=tr.dataset.monthFmt==="pct";
      const cat=tr.dataset.cat;
      const isParent=tr.dataset.isParent==="true";
      const avg=months.filter(v=>v!=null&&!isPct&&Math.abs(v)>=1).reduce((s,v)=>s+Math.abs(v),0)/(months.filter(v=>v!=null&&!isPct&&Math.abs(v)>=1).length||1);
      let cells="";
      months.forEach((v,i)=>{
        if(v==null||(!isPct&&Math.abs(v)<1))return;
        const val=isPct?v.toFixed(1)+"%":fmtT(v);
        const clickable=cat&&!isPct&&Math.abs(v)>0.5;
        const hot=!isPct&&Math.abs(v)>avg*1.05;
        cells+=`<div class="is-mo-grid-cell${i===curMoIdx?" cur":""}" ${clickable?`data-mi="${i}"`:""}><span class="mo-lbl">${ML[i]}</span><span style="color:${hot?"var(--y)":"rgba(255,255,255,0.65)"}">${val}</span></div>`;
      });
      if(!cells)return;
      const dr=document.createElement("tr");
      dr.className="is-mob-detail";
      const cols=mobTbl?4:3;
      dr.innerHTML=`<td colspan="${cols}" style="padding:0;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.05)"><div class="is-mo-grid">${cells}</div></td>`;
      dr.querySelectorAll(".is-mo-grid-cell[data-mi]").forEach(cell=>{
        cell.classList.add("is-mob-drill");
        cell.addEventListener("click",ev=>{
          ev.stopPropagation();
          showISDrilldown(cat,isParent,parseInt(cell.dataset.mi),state.year);
        });
      });
      tr.after(dr);
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

    // Tax payments card (FEA-73)
    try{
      const allTax=await fetchAllTaxTxns();
      const yearTax=allTax.filter(t=>t.date.startsWith(String(state.year)));
      if(yearTax.length){
        const ytd=yearTax.reduce((s,t)=>s+parseFloat(t.amount_usd),0);
        const effRate=totI>0?(ytd/totI*100):0;

        // Monthly totals + running YTD
        const moAmts={};for(let m=1;m<=12;m++)moAmts[String(m).padStart(2,"0")]=0;
        for(const t of yearTax){moAmts[t.date.slice(5,7)]+=parseFloat(t.amount_usd)}
        let run=0;const ytdLine=Object.values(moAmts).map(v=>{run+=v;return Math.round(run)});

        const taxCard=h("div",{class:"cd"});
        let taxExp=false;
        const taxArrow=h("span",{style:{color:"rgba(255,255,255,0.3)",marginRight:"8px",fontSize:"12px"}},"\u25B8");
        const taxHdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"},onClick:()=>{
          taxExp=!taxExp;taxBody.style.display=taxExp?"block":"none";taxArrow.textContent=taxExp?"\u25BE":"\u25B8";
        }});
        taxHdr.append(h("h3",{style:{margin:0,display:"flex",alignItems:"center"}},[taxArrow,"Tax Payments"]));
        taxHdr.append(h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.35)"}},`${fmtN(ytd)} YTD \u00b7 ${effRate.toFixed(1)}% effective`));
        taxCard.append(taxHdr);

        const taxBody=h("div",{style:{display:"none",marginTop:"14px"}});

        // KPIs
        const kpis=h("div",{class:"g3",style:{marginBottom:"12px"}});
        kpis.append(statCard("\uD83D\uDCB8","YTD paid",fmtN(ytd),"var(--r)"));
        kpis.append(statCard("\uD83D\uDCCA","effective rate",effRate.toFixed(1)+"%","var(--y)"));
        kpis.append(statCard("\uD83D\uDD22","payments",String(yearTax.length),"rgba(255,255,255,0.5)"));
        taxBody.append(kpis);

        // Chart: monthly bar + YTD running total line
        const chartWrap=h("div",{style:{marginBottom:"14px"}});
        taxBody.append(chartWrap);
        const taxConfig=(rows,weekly)=>({type:"bar",data:{labels:weekly?rows.map(w=>weekLabel(w.start)):ML,datasets:[
          {label:weekly?"Weekly":"Monthly",data:weekly?rows.map(w=>Math.round(w.amount)):Object.values(moAmts).map(v=>Math.round(v)),backgroundColor:"rgba(224,122,95,0.65)",borderColor:weekly?rows.map(w=>w.selected?"rgba(242,204,143,0.9)":"transparent"):"transparent",borderWidth:weekly?rows.map(w=>w.selected?2:0):0,borderRadius:4},
          {label:"YTD Total",data:weekly?rows.map(w=>Math.round(w.ytd)):ytdLine,type:"line",borderColor:"#F2CC8F",backgroundColor:"transparent",borderWidth:2,pointRadius:weekly?1:2,pointBackgroundColor:"#F2CC8F",fill:false,yAxisID:"y1"}
        ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"rgba(255,255,255,0.5)",font:{size:10},usePointStyle:true,pointStyleWidth:12}},tooltip:{callbacks:{title:items=>weekly&&items.length?`${fmtD(rows[items[0].dataIndex].start)}–${fmtD(rows[items[0].dataIndex].end)}`:items[0]?.label}}},scales:{x:{ticks:{color:ctx=>weekly&&rows[ctx.index]?.selected?"rgba(242,204,143,0.9)":"rgba(255,255,255,0.3)",maxTicksLimit:weekly?(window.innerWidth<=700?7:14):12},grid:{display:false}},y:{ticks:{color:"rgba(255,255,255,0.3)",callback:v=>fmtN(v)},grid:{color:"rgba(255,255,255,0.04)"}},y1:{position:"right",ticks:{color:"rgba(242,204,143,0.5)",callback:v=>fmtN(v)},grid:{display:false}}}}});
        const taxWeeklyData=range=>range.weeks.map(w=>{
          const amount=allTax.reduce((s,t)=>s+(t.date>=w.start&&t.date<=w.end?parseFloat(t.amount_usd)||0:0),0);
          const y=+(w.end.slice(0,4)),yearStart=`${y}-01-01`;
          const ytd=allTax.reduce((s,t)=>s+(t.date>=yearStart&&t.date<=w.end?parseFloat(t.amount_usd)||0:0),0);
          return{...w,amount,ytd};
        });
        renderISTimeChart(chartWrap,{key:"tax",title:"Tax Payments",id:"taxChart",height:"200px",monthlyConfig:()=>taxConfig([],false),weeklyData:taxWeeklyData,weeklyConfig:rows=>taxConfig(rows,true)});

        // Drilldown table (date desc)
        const tWrap=h("div",{style:{overflowX:"auto"}});
        const tbl=h("table");
        tbl.innerHTML=`<thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th><th class="hide-m">Payment</th></tr></thead>`;
        const tbody=document.createElement("tbody");
        for(const t of [...yearTax].sort((a,b)=>b.date.localeCompare(a.date))){
          const tr=h("tr",{style:{cursor:"pointer"},onClick:async()=>{
            const full=await sb(`transactions?id=eq.${t.id}&select=*`);
            if(full.length)openLedgerEditModal(full[0],()=>{});
          }});
          tr.innerHTML=`<td class="m" style="color:rgba(255,255,255,0.5);white-space:nowrap">${fmtD(t.date)}</td>`
            +`<td style="color:rgba(255,255,255,0.8);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description}</td>`
            +`<td class="r m" style="color:rgba(255,255,255,0.75)">${fmtF(t.amount_usd)}</td>`
            +`<td class="hide-m" style="color:rgba(255,255,255,0.4);font-size:11px">${t.payment_type||""}</td>`;
          tbody.append(tr);
        }
        tbl.append(tbody);tWrap.append(tbl);taxBody.append(tWrap);
        taxCard.append(taxBody);body.append(taxCard);
      }
    }catch(taxErr){console.warn("Tax card error:",taxErr)}
  }catch(e){document.getElementById("isBody").innerHTML=`<div class="cd" style="border-color:rgba(224,122,95,0.3);color:var(--r)">Error loading: ${e.message}</div>`}
}

async function showISDrilldown(categoryId,isParent,monthIndex,year){
  const existing=document.querySelector(".modal-bg,.sheet-bg");if(existing)existing.remove();
  const mStart=`${year}-${String(monthIndex+1).padStart(2,"0")}-01`;
  const mEnd=endOfMonth(mStart);
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
  const txns=await sb(`transactions?select=*${catFilter}&service_start=lte.${mEnd}&service_end=gte.${mStart}&order=date.desc&limit=500`+ownerQS());
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
  const mobDrill=isMobile();
  let mhtml=mobDrill?`<p style="font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:12px"><span style="font-family:var(--mono);font-weight:700;color:var(--r);font-size:16px">${fmtF(total)}</span> accrued · ${txnAccruals.length} txns · ${daysInMonth>0?fmtF(total/daysInMonth)+"/d":"—"}</p>`:`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:24px">${[["Total Accrued",fmtF(total),"var(--r)"],["Transactions",txnAccruals.length,"var(--b)"],["Per Day",daysInMonth>0?fmtF(total/daysInMonth):"—","var(--g)"]].map(([l,v,c])=>`<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 14px;text-align:center"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase">${l}</div><div style="font-size:20px;font-weight:700;color:${c};font-family:var(--mono)">${v}</div></div>`).join("")}</div>`;
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
    if(mobDrill){
      mhtml+=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;margin-bottom:8px">${txnAccruals.length} Transactions</div><div class="stack">`;
      txnAccruals.forEach(t=>{
        const diff=Math.abs(t.amount_usd-t._accrual)>0.01;
        const sub=diff?` <span style="font-size:10px;color:rgba(255,255,255,0.35)">(${fmtF(t.amount_usd)}${t._oDays?`, ${t._oDays}d`:""})</span>`:"";
        mhtml+=`<div class="resp-card is-drill-row" data-tid="${t.id}"><div class="resp-card-line1"><div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${t.description}</div><div class="m" style="font-weight:600;color:${t._accrual<0?"var(--g)":"var(--r)"}">${fmtF(t._accrual)}${sub}</div></div><div class="resp-card-line2"><span>${fmtD(t.date)}</span>${showCat?`<span>${t.category_id}</span>`:""}</div></div>`;
      });
      mhtml+=`</div>`;
    }else{
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
    }
  }else{
    mhtml+=`<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.3)">No transactions found</div>`;
  }
  function wireDrillRows(root){
    root.querySelectorAll(".is-drill-row").forEach(row=>{
      row.addEventListener("click",e=>{
        e.stopPropagation();
        const tid=parseInt(row.dataset.tid);
        const txn=txnAccruals.find(t=>t.id===tid);
        if(txn){document.querySelector(".modal-bg,.sheet-bg")?.remove();openLedgerEditModal(txn,()=>showISDrilldown(categoryId,isParent,monthIndex,year))}
      });
    });
  }
  if(mobDrill){
    const wrap=h("div");wrap.innerHTML=mhtml;
    wireDrillRows(wrap);
    openSheet({title:`${catLabel} · ${mLabel}`,body:wrap,maxWidth:"700px"});
    return;
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
  wireDrillRows(modal);
  modal.querySelectorAll(".is-drill-row.is-grp-child").forEach(row=>{
    row.addEventListener("mouseenter",()=>row.style.background="rgba(74,111,165,0.06)");
    row.addEventListener("mouseleave",()=>row.style.background="transparent");
  });
  modal.querySelectorAll(".is-drill-row:not(.is-grp-child)").forEach(row=>{
    row.addEventListener("mouseenter",()=>row.style.background="rgba(255,255,255,0.04)");
    row.addEventListener("mouseleave",()=>row.style.background="transparent");
  });
  bg.append(modal);document.body.append(bg);
}
