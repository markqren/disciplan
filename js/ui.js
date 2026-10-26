/** Mobile / shared UI helpers — use for new layout (see CLAUDE.md UI conventions). */
function isMobile(){return window.matchMedia("(max-width:700px)").matches}
function isWideMobile(){return window.matchMedia("(min-width:420px) and (max-width:700px)").matches}

let _bpWasMobile=isMobile();
function onBreakpointChange(fn){
  window.matchMedia("(max-width:700px)").addEventListener("change",()=>{
    const now=isMobile();
    if(now!==_bpWasMobile){_bpWasMobile=now;if(typeof fn==="function")fn()}
  });
}

function formGrid(cols,...children){
  const cls="fgrid"+(cols===1?" cols1":cols===3?" cols3":cols==="amt"?" cols-amt":" cols2");
  const d=h("div",{class:cls});
  children.filter(Boolean).forEach(c=>d.append(c));
  return d;
}

function uiField(lbl,input,opts){
  opts=opts||{};
  const d=h("div");
  const lab=h("label",{class:"lbl"},lbl);
  if(opts.hint){lab.append(" ",h("span",{style:{textTransform:"none",letterSpacing:"0",fontWeight:"400",fontSize:"10px",color:"rgba(129,178,154,0.6)"}},opts.hint))}
  d.append(lab,input);
  return d;
}

function segmented(options,value,onChange){
  const wrap=h("div",{class:"seg"});
  options.forEach(([val,label])=>{
    wrap.append(h("button",{type:"button",class:"seg-btn"+(value===val?" on":""),onClick:()=>{
      if(value===val)return;
      onChange(val);
      wrap.querySelectorAll(".seg-btn").forEach(b=>b.classList.remove("on"));
      wrap.querySelector(`[data-seg-val="${val}"]`)?.classList.add("on");
    },dataset:{segVal:val}},label));
  });
  return wrap;
}

function openSheet(opts){
  const mobile=isMobile();
  const bg=h("div",{class:mobile?"sheet-bg modal-bg":"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const close=()=>bg.remove();
  if(mobile){
    const sheet=h("div",{class:"sheet"});
    const hd=h("div",{class:"sheet-hd"});
    hd.append(h("div",{},h("h2",{style:{fontSize:"18px",margin:0}},opts.title||"")),h("button",{type:"button",style:{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",width:"36px",height:"36px",cursor:"pointer",color:"rgba(255,255,255,0.5)",fontSize:"18px"},onClick:close},"✕"));
    const body=h("div",{class:"sheet-body"});
    if(typeof opts.body==="string")body.innerHTML=opts.body;
    else if(opts.body)body.append(opts.body);
    sheet.append(hd,body);
    if(opts.primary||opts.secondary||opts.overflow?.length){
      const ft=h("div",{class:"sheet-ft"});
      if(opts.overflow?.length){
        const menuBtn=h("button",{type:"button",class:"btn btn-ghost",style:{flex:"0 0 48px",width:"48px",padding:"12px",background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.6)"},onClick:()=>{
          const m=h("div",{class:"sheet-bg",style:{zIndex:110,alignItems:"flex-end"},onClick:ev=>{if(ev.target===m)m.remove()}});
          const p=h("div",{class:"cd",style:{margin:"0",borderRadius:"16px 16px 0 0",width:"100%",maxWidth:"100%"}});
          opts.overflow.forEach(item=>{
            p.append(h("button",{type:"button",class:"btn",style:{width:"100%",marginBottom:"8px",background:item.danger?"rgba(224,122,95,0.15)":"rgba(255,255,255,0.06)",color:item.danger?"var(--r)":"rgba(255,255,255,0.8)"},onClick:()=>{m.remove();item.onClick()}},item.label));
          });
          m.append(p);document.body.append(m);
        }},"…");
        ft.append(menuBtn);
      }
      if(opts.primary){
        const pb=h("button",{type:"button",class:"btn",style:{background:"rgba(129,178,154,0.25)",color:"var(--g)",flex:1},onClick:opts.primary.onClick},opts.primary.label);
        ft.append(pb);
      }
      sheet.append(ft);
    }
    bg.append(sheet);
  }else{
    const modal=h("div",{class:"modal",style:opts.maxWidth?{maxWidth:opts.maxWidth}:{}});
    let mhtml=`<div style="display:flex;justify-content:space-between;margin-bottom:16px"><h2 style="font-size:20px;margin:0">${opts.title||""}</h2><button type="button" class="modal-x" style="background:rgba(255,255,255,0.06);border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;color:rgba(255,255,255,0.5)">✕</button></div>`;
    modal.innerHTML=mhtml;
    modal.querySelector(".modal-x").onclick=close;
    if(typeof opts.body==="string"){
      const wrap=h("div");wrap.innerHTML=opts.body;modal.append(wrap);
    }else if(opts.body)modal.append(opts.body);
    if(opts.primary||opts.secondary||opts.overflow?.length){
      const br=h("div",{class:"btn-row",style:{marginTop:"16px"}});
      if(opts.primary)br.append(h("button",{type:"button",class:"btn btn-primary",style:{background:"rgba(129,178,154,0.25)",color:"var(--g)"},onClick:opts.primary.onClick},opts.primary.label));
      (opts.secondary||[]).forEach(s=>br.append(h("button",{type:"button",class:"btn btn-ghost",style:{width:"auto",padding:"12px 16px",background:s.bg||"rgba(255,255,255,0.06)",color:s.color||"rgba(255,255,255,0.7)"},onClick:s.onClick},s.label)));
      (opts.overflow||[]).forEach(item=>br.append(h("button",{type:"button",class:"btn btn-ghost",style:{width:"auto",padding:"12px 16px",background:item.danger?"rgba(224,122,95,0.15)":"rgba(255,255,255,0.06)",color:item.danger?"var(--r)":"rgba(255,255,255,0.7)"},onClick:item.onClick},item.label)));
      modal.append(br);
    }
    bg.append(modal);
  }
  document.body.append(bg);
  return {bg,close};
}

function respList(spec){
  const {columns,rows,onRowClick,rowKey="id"}=spec;
  if(isMobile()){
    const wrap=h("div",{class:"resp-list"});
    rows.forEach(row=>{
      const card=h("div",{class:"resp-card",onClick:()=>onRowClick&&onRowClick(row)});
      const line1=h("div",{class:"resp-card-line1"});
      const pri=columns.find(c=>c.priority===1)||columns[0];
      const amt=columns.find(c=>c.key==="amount"||c.priority===0);
      if(pri)line1.append(h("div",{style:{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:"13px",color:"rgba(255,255,255,0.85)"}},pri.render?pri.render(row):row[pri.key]));
      if(amt)line1.append(h("div",{style:{fontFamily:"var(--mono)",fontWeight:600,flexShrink:0}},amt.render?amt.render(row):row[amt.key]));
      card.append(line1);
      const line2=h("div",{class:"resp-card-line2"});
      columns.filter(c=>c!==pri&&c!==amt&&c.mobile!==false).forEach(c=>{
        if(c.render){const el=c.render(row);if(el)line2.append(el)}
        else if(row[c.key]!=null&&row[c.key]!=="")line2.append(h("span",{},String(row[c.key])));
      });
      if(line2.childNodes.length)card.append(line2);
      wrap.append(card);
    });
    return wrap;
  }
  const tbl=h("table");
  let thtml="<thead><tr>";
  columns.forEach(c=>{thtml+=`<th${c.align==="right"?' class="r"':""}${c.hideDesktop?" class=\"hide-m\"":""}${c.className?' class="'+c.className+'"':""}>${c.label}</th>`});
  thtml+="</tr></thead><tbody>";
  rows.forEach(row=>{
    thtml+=`<tr style="cursor:pointer" data-rk="${row[rowKey]}">`;
    columns.forEach(c=>{
      const hide=c.priority>=3?" hide-m":"";
      thtml+=`<td${c.align==="right"?' class="r m'+hide+'"':' class="m'+hide+'"'}>${c.render?c.render(row,true):row[c.key]??""}</td>`;
    });
    thtml+="</tr>";
  });
  thtml+="</tbody>";
  tbl.innerHTML=thtml;
  tbl.querySelectorAll("tbody tr").forEach((tr,i)=>{tr.onclick=()=>onRowClick&&onRowClick(rows[i])});
  return h("div",{style:{overflowX:"auto"}},tbl);
}

function uiCollapsible(title,bodyEl,openDefault){
  const card=h("div",{class:"cd",style:{padding:"14px 16px"}});
  const hd=h("div",{class:"collapsible-hd"+(openDefault?" open":"")});
  hd.append(h("h3",{style:{margin:0,fontSize:"13px"}},title),h("span",{class:"chev"},"▸"));
  const body=h("div",{style:{display:openDefault?"block":"none",marginTop:"12px"}});
  body.append(bodyEl);
  hd.onclick=()=>{
    const open=body.style.display!=="none";
    body.style.display=open?"none":"block";
    hd.classList.toggle("open",!open);
  };
  card.append(hd,body);
  return card;
}

function layoutDebugEnable(){
  if(!location.search.includes("debug=layout"))return;
  const run=()=>{
    document.querySelectorAll("[data-layout-bad]").forEach(e=>e.removeAttribute("data-layout-bad"));
    const W=innerWidth;
    document.querySelectorAll("body *").forEach(e=>{
      const r=e.getBoundingClientRect();
      if(r.right>W+2&&r.width>20){e.style.outline="2px solid var(--r)";e.dataset.layoutBad="1"}
    });
  };
  run();
  window.addEventListener("resize",run);
  setTimeout(run,500);
}

function pullToRefresh(el,onRefresh,enabled){
  if(!el)return;
  let sy=0,startY=0;
  const ind=h("div",{class:"ptr-ind"},"\u21BB Release to refresh");
  document.body.append(ind);
  const active=()=>isMobile()&&(!enabled||enabled())&&!document.querySelector(".modal-bg");
  el.addEventListener("touchstart",e=>{if(active()&&window.scrollY<=0){startY=e.touches[0].clientY;sy=0}},{passive:true});
  el.addEventListener("touchmove",e=>{
    if(!startY)return;
    sy=e.touches[0].clientY-startY;
    ind.classList.toggle("show",sy>40);
    ind.classList.toggle("ready",sy>80);
  },{passive:true});
  el.addEventListener("touchend",()=>{
    const fire=startY&&sy>80&&window.scrollY<=0;
    ind.classList.remove("show","ready");
    startY=0;sy=0;
    if(fire)onRefresh();
  });
}

function flashSaved(el){
  if(!el)return;
  el.classList.remove("flash-ok");
  void el.offsetWidth;
  el.classList.add("flash-ok");
  setTimeout(()=>el.classList.remove("flash-ok"),900);
}

// Long-press (touch) or right-click (desktop). Suppresses the click that follows a long-press.
function onLongPress(el,fn,ms){
  let timer=null,fired=false,sx=0,sy=0;
  const cancel=()=>{if(timer){clearTimeout(timer);timer=null}};
  el.addEventListener("touchstart",e=>{
    fired=false;sx=e.touches[0].clientX;sy=e.touches[0].clientY;
    timer=setTimeout(()=>{timer=null;fired=true;fn()},ms||500);
  },{passive:true});
  el.addEventListener("touchmove",e=>{if(Math.abs(e.touches[0].clientX-sx)>10||Math.abs(e.touches[0].clientY-sy)>10)cancel()},{passive:true});
  el.addEventListener("touchend",cancel);
  el.addEventListener("touchcancel",cancel);
  el.addEventListener("contextmenu",e=>{e.preventDefault();if(!fired)fn()});
  el.addEventListener("click",e=>{if(fired){fired=false;e.stopImmediatePropagation();e.preventDefault()}},true);
}

function dayLabel(d){
  const t=today();
  if(d===t)return "Today";
  if(d===shiftDate(t,-1))return "Yesterday";
  return fmtD(d);
}

// Swipe left on `content` to reveal action buttons. Returns the wrapper to insert.
// actions: [{label, danger, onClick}] — a danger action asks for a second tap.
function swipeActions(content,actions){
  const wrap=h("div",{class:"swipe-wrap"});
  const acts=h("div",{class:"swipe-acts"});
  actions.forEach(a=>{
    const b=h("button",{type:"button",class:"swipe-act"+(a.danger?" danger":""),onClick:e=>{
      e.stopPropagation();
      if(a.danger&&b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Confirm";setTimeout(()=>{b.dataset.confirm="0";b.textContent=a.label},3000);return}
      close();a.onClick();
    }},a.label);
    acts.append(b);
  });
  content.classList.add("swipe-content");
  wrap.append(acts,content);
  const W=actions.length*76;
  let sx=0,sy=0,dx=0,dragging=false,open=false,horizontal=null;
  function setX(x,anim){content.style.transition=anim?"transform .18s ease":"none";content.style.transform=x?`translateX(${x}px)`:""}
  function close(){open=false;setX(0,true)}
  content.addEventListener("touchstart",e=>{
    document.querySelectorAll(".swipe-content").forEach(c=>{if(c!==content&&c.style.transform){c.style.transition="transform .18s ease";c.style.transform=""}});
    sx=e.touches[0].clientX;sy=e.touches[0].clientY;dx=0;dragging=true;horizontal=null;
  },{passive:true});
  content.addEventListener("touchmove",e=>{
    if(!dragging)return;
    const mx=e.touches[0].clientX-sx,my=e.touches[0].clientY-sy;
    if(horizontal===null&&(Math.abs(mx)>8||Math.abs(my)>8))horizontal=Math.abs(mx)>Math.abs(my);
    if(!horizontal)return;
    dx=Math.min(0,Math.max(-W-20,(open?-W:0)+mx));
    setX(dx,false);
  },{passive:true});
  content.addEventListener("touchend",()=>{
    if(!dragging)return;dragging=false;
    if(!horizontal)return;
    open=dx<-W/2;setX(open?-W:0,true);
    content.dataset.swiped="1";setTimeout(()=>{delete content.dataset.swiped},50);
  });
  wrap.addEventListener("click",e=>{
    if(!content.contains(e.target))return;
    if(content.dataset.swiped||open){e.stopPropagation();e.preventDefault();if(open&&!content.dataset.swiped)close()}
  },true);
  return wrap;
}

function getIsMode(){
  try{
    const s=localStorage.getItem("dc_is_mode");
    if(s==="month"||s==="year")return s;
  }catch(e){}
  return isMobile()?"month":"year";
}
function setIsMode(m){try{localStorage.setItem("dc_is_mode",m)}catch(e){}state.isMode=m}

function topCategoriesFromCache(n){
  n=n||6;
  const fallback=["groceries","restaurant","home","transportation","entertainment","utilities"];
  try{
    const raw=localStorage.getItem("dc_top_cats");
    if(raw){const p=JSON.parse(raw);if(Array.isArray(p)&&p.length)return p.slice(0,n)}
  }catch(e){}
  return fallback.slice(0,n);
}
function rememberTopCategory(cat){
  try{
    let list=topCategoriesFromCache(20).filter(c=>c!==cat);
    list.unshift(cat);
    localStorage.setItem("dc_top_cats",JSON.stringify(list.slice(0,12)));
  }catch(e){}
}

function rememberPaymentAccount(pt){
  try{if(pt)localStorage.setItem("dc_last_pt",pt)}catch(e){}
}
function lastPaymentAccount(fallback){
  try{const v=localStorage.getItem("dc_last_pt");if(v)return v}catch(e){}
  return fallback||"Chase Sapphire";
}

function openQuickEntrySheet(){
  const wrap=h("div");
  let sheet=null;
  renderEntry(wrap,{quick:true,onSaved:()=>{
    setTimeout(()=>{
      if(sheet)sheet.close();
      if(typeof renderContent==="function")renderContent();
    },350);
  }});
  sheet=openSheet({title:"New transaction",body:wrap,maxWidth:"560px"});
}

function setupCollapsingHeader(){
  if(!isMobile())return;
  const hdr=document.querySelector(".hdr");
  if(!hdr||hdr.dataset.collapseSetup)return;
  hdr.dataset.collapseSetup="1";
  let lastY=0,ticking=false;
  window.addEventListener("scroll",()=>{
    if(ticking)return;
    ticking=true;
    requestAnimationFrame(()=>{
      const y=window.scrollY;
      if(y>80&&y>lastY)hdr.classList.add("hdr-hidden");
      else hdr.classList.remove("hdr-hidden");
      lastY=y;ticking=false;
    });
  },{passive:true});
}

document.addEventListener("DOMContentLoaded",layoutDebugEnable);
if(document.readyState!=="loading")layoutDebugEnable();
