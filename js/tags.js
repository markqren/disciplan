async function renderTags(el){
  el.innerHTML=`<div style="margin-bottom:16px"><h2>Tags</h2><p class="sub">Loading...</p></div><div id="tagsBody"></div>`;
  try{
    const [tagRows,summaries]=await Promise.all([
      sb("tags?order=start_date.desc"),
      sbRPC("get_tag_summaries")
    ]);
    const tm={};
    for(const s of summaries){
      tm[s.tag_name]={total:s.total_accrual,count:s.txn_count,cats:s.category_totals||{}};
    }

    const tags=tagRows.map(t=>({...t,...(tm[t.name]||{total:0,count:0,cats:{}})})).sort((a,b)=>b.total-a.total);
    el.querySelector(".sub").textContent=`Click any tag for breakdown · ${tags.length} tags`;
    const body=document.getElementById("tagsBody");body.innerHTML="";
    const grid=h("div",{class:"tag-grid"});

    tags.forEach((tag,i)=>{
      const card=h("div",{class:"tag-card",style:{borderLeftColor:TCOLS[i%TCOLS.length],cursor:tag.total>0?"pointer":"default"},onClick:()=>tag.total>0&&showTagDetail(tag)});
      let inner=`<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:14px;font-weight:600;color:#fff">${tag.name}</div>`;
      if(tag.start_date)inner+=`<div class="tag-date-edit" data-tag="${tag.name}" style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:2px;cursor:pointer" title="Click to edit dates">${fmtD(tag.start_date)} – ${fmtD(tag.end_date)}</div>`;
      inner+=`</div><span style="font-size:10px;color:rgba(255,255,255,0.2);background:rgba(255,255,255,0.04);padding:2px 6px;border-radius:4px">${tag.count||0} txns</span></div>`;
      if(tag.total>0){
        const days=tag.start_date&&tag.end_date?Math.max(1,Math.floor((new Date(tag.end_date)-new Date(tag.start_date))/864e5)+1):0;
        inner+=`<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px"><div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--r)">${fmtF(tag.total)}</div>`;
        if(days>0)inner+=`<div style="font-size:11px;color:rgba(255,255,255,0.25);font-family:var(--mono)">${fmtF(tag.total/days)}/day</div>`;
        inner+=`</div>`;
        if(Object.keys(tag.cats).length>0){
          const posCats=Object.entries(tag.cats).filter(([,v])=>v>0);
          if(posCats.length>0){const barTotal=posCats.reduce((s,[,v])=>s+v,0);
          inner+=`<div style="display:flex;gap:2px;margin-top:6px;height:4px;border-radius:2px;overflow:hidden">`;
          posCats.sort((a,b)=>b[1]-a[1]).forEach(([c,v])=>inner+=`<div style="width:${(v/barTotal)*100}%;background:${CC[c]||"#666"};min-width:2px"></div>`);
          inner+=`</div>`;}
        }
      }
      card.innerHTML=inner;
      grid.append(card);
    });
    body.append(grid);
    // Tag date editing — click date range to edit start/end
    grid.querySelectorAll(".tag-date-edit").forEach(dateEl=>{
      dateEl.addEventListener("click",e=>{
        e.stopPropagation();
        const tName=dateEl.dataset.tag;
        const tag=tags.find(t=>t.name===tName);if(!tag)return;
        const origHTML=dateEl.innerHTML;
        dateEl.innerHTML=`<input type="date" class="td-start" value="${tag.start_date}" style="font-size:11px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;padding:1px 4px;width:120px"> – <input type="date" class="td-end" value="${tag.end_date}" style="font-size:11px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;padding:1px 4px;width:120px">`;
        dateEl.style.cursor="default";
        const startIn=dateEl.querySelector(".td-start"),endIn=dateEl.querySelector(".td-end");
        startIn.addEventListener("click",e=>e.stopPropagation());
        endIn.addEventListener("click",e=>e.stopPropagation());
        let saving=false;
        const save=async()=>{
          if(saving)return;
          const ns=startIn.value,ne=endIn.value;
          if(!ns||!ne||ns>ne){dateEl.innerHTML=origHTML;dateEl.style.cursor="pointer";return}
          if(ns===tag.start_date&&ne===tag.end_date){dateEl.innerHTML=origHTML;dateEl.style.cursor="pointer";return}
          saving=true;
          try{
            await sb(`tags?name=eq.${encodeURIComponent(tName)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({start_date:ns,end_date:ne})});
            renderTags(el);
          }catch(err){saving=false;dateEl.innerHTML=origHTML;dateEl.style.cursor="pointer";alert("Failed to save: "+err.message)}
        };
        const cancel=()=>{if(!saving){dateEl.innerHTML=origHTML;dateEl.style.cursor="pointer"}};
        // Save on blur only when focus leaves both inputs
        const blurSave=()=>{setTimeout(()=>{if(!dateEl.contains(document.activeElement))save()},150)};
        startIn.addEventListener("blur",blurSave);
        endIn.addEventListener("blur",blurSave);
        startIn.addEventListener("keydown",e=>{if(e.key==="Escape")cancel();if(e.key==="Enter"){e.preventDefault();endIn.focus()}});
        endIn.addEventListener("keydown",e=>{if(e.key==="Escape")cancel();if(e.key==="Enter"){e.preventDefault();save()}});
        startIn.focus();
      });
    });
    // Auto-open tag detail if navigated from Ledger tab
    if(state.tagDetail){
      const t=tags.find(tg=>tg.name===state.tagDetail);
      state.tagDetail=null;
      if(t)showTagDetail(t);
    }
  }catch(e){document.getElementById("tagsBody").innerHTML=`<div class="cd" style="color:var(--r)">Error: ${e.message}</div>`}
}

async function showTagDetail(tag){
  const existing=document.querySelector(".modal-bg");if(existing)existing.remove();
  const txns=await sb(`transactions?tag=eq.${encodeURIComponent(tag.name)}&category_id=neq.income&category_id=neq.investment&category_id=neq.adjustment&order=date.desc`);
  const cats={};let total=0;
  const txnAccruals=[];
  for(const t of txns){
    let accrual=0,oDays=0;
    if(t.daily_cost!=null&&tag.start_date&&tag.end_date&&t.service_start&&t.service_end){
      const oStart=t.service_start>tag.start_date?t.service_start:tag.start_date;
      const oEnd=t.service_end<tag.end_date?t.service_end:tag.end_date;
      if(oStart<=oEnd){
        oDays=Math.floor((new Date(oEnd)-new Date(oStart))/864e5)+1;
        accrual=t.daily_cost*oDays;
        cats[t.category_id]=(cats[t.category_id]||0)+accrual;total+=accrual;
      }
    }else if(t.amount_usd>0){accrual=t.amount_usd;cats[t.category_id]=(cats[t.category_id]||0)+t.amount_usd;total+=t.amount_usd}
    const noOverlap=accrual===0&&tag.start_date&&tag.end_date&&t.service_start&&t.service_end&&(t.service_end<tag.start_date||t.service_start>tag.end_date);
    if(Math.abs(accrual)>=0.01||noOverlap)txnAccruals.push({...t,_accrual:accrual,_oDays:oDays,_noOverlap:noOverlap});
  }
  // Group by transaction_group_id, sort groups by |net accrual|
  const tagGrps=new Map();
  for(const t of txnAccruals){
    const gid=t.transaction_group_id||("_s"+t.id);
    if(!tagGrps.has(gid))tagGrps.set(gid,{items:[],net:0});
    const g=tagGrps.get(gid);g.items.push(t);g.net+=t._accrual;
  }
  const sortedGrps=[...tagGrps.values()].sort((a,b)=>Math.abs(b.net)-Math.abs(a.net));
  txnAccruals.length=0;
  for(const g of sortedGrps){g.items.sort((a,b)=>Math.abs(b._accrual)-Math.abs(a._accrual));txnAccruals.push(...g.items)}
  // Build group summaries for linked transactions
  const tagGroupMembers={};
  txnAccruals.forEach(t=>{if(t.transaction_group_id){const gid=t.transaction_group_id;if(!tagGroupMembers[gid])tagGroupMembers[gid]=[];tagGroupMembers[gid].push(t)}});
  const tagGroupSummaries={};
  for(const[gid,members]of Object.entries(tagGroupMembers)){
    if(members.length<2)continue;
    const netAmt=members.reduce((s,m)=>s+m.amount_usd,0);
    const netAccrual=members.reduce((s,m)=>s+m._accrual,0);
    const dates=members.map(m=>m.date).sort();
    const catF={};members.forEach(m=>{catF[m.category_id]=(catF[m.category_id]||0)+1});
    const catS=Object.entries(catF).sort((a,b)=>b[1]-a[1]);
    const hasNoOverlap=members.some(m=>m._noOverlap);
    const hasPartial=members.some(m=>!m._noOverlap&&tag.start_date&&tag.end_date&&m.service_start&&m.service_end&&(m.service_start<tag.start_date||m.service_end>tag.end_date));
    tagGroupSummaries[gid]={netAmt,netAccrual,dateMax:dates[dates.length-1],
      dominantCat:catS[0][0],mixedCat:catS.length>1,
      label:generateGroupLabel(members),memberCount:members.length,
      hasNoOverlap,hasPartial};
  }
  const days=tag.start_date&&tag.end_date?Math.max(1,Math.floor((new Date(tag.end_date)-new Date(tag.start_date))/864e5)+1):0;
  const mx=Math.max(...Object.values(cats).map(v=>Math.abs(v)),1);

  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  let mhtml=`<div style="display:flex;justify-content:space-between;margin-bottom:20px"><div><h2 style="font-size:22px">${tag.name}</h2>`;
  if(tag.start_date)mhtml+=`<p class="tag-modal-dates" style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:4px;cursor:pointer" title="Click to edit dates"><span class="tmd-text">${fmtD(tag.start_date)} – ${fmtD(tag.end_date)}</span></p>`;
  mhtml+=`</div><button onclick="this.closest('.modal-bg').remove()" style="background:rgba(255,255,255,0.06);border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;color:rgba(255,255,255,0.5);font-size:16px">✕</button></div>`;
  mhtml+=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:24px">`;
  [["Total",fmtF(total),"var(--r)"],["Days",days,"var(--b)"],["Per Day",days>0?fmtF(total/days):"—","var(--g)"]].forEach(([l,v,c])=>mhtml+=`<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 14px;text-align:center"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase">${l}</div><div style="font-size:20px;font-weight:700;color:${c};font-family:var(--mono)">${v}</div></div>`);
  mhtml+=`</div>`;

  Object.entries(cats).filter(([,v])=>Math.abs(v)>0.5).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).forEach(([cat,val])=>{
    const isNeg=val<0;
    mhtml+=`<div style="display:grid;grid-template-columns:90px 1fr 65px 40px;align-items:center;gap:8px;margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,0.6)"><span style="width:7px;height:7px;border-radius:2px;background:${CC[cat]||"#666"};flex-shrink:0"></span>${cat}</div>
      <div style="height:14px;background:rgba(255,255,255,0.04);border-radius:4px;overflow:hidden"><div style="height:100%;width:${(Math.abs(val)/mx)*100}%;background:${isNeg?"var(--g)":(CC[cat]||"#666")};border-radius:4px;opacity:0.7"></div></div>
      <div style="font-family:var(--mono);font-size:11px;color:${isNeg?"var(--g)":"rgba(255,255,255,0.5)"};text-align:right">${isNeg?"("+fmtF(Math.abs(val))+")":fmtF(val)}</div>
      <div style="font-family:var(--mono);font-size:10px;color:rgba(255,255,255,0.3);text-align:right">${total>0?((Math.abs(val)/total)*100).toFixed(0)+"%":""}</div></div>`;
  });

  // Transaction list
  if(txnAccruals.length){
    mhtml+=`<div style="margin-top:20px;border-top:1px solid rgba(255,255,255,0.06);padding-top:14px"><div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">${txnAccruals.length} Transactions</div>`;
    mhtml+=`<div style="overflow-x:auto"><table style="width:100%;font-size:11px"><thead><tr style="color:rgba(255,255,255,0.3);font-size:10px;text-transform:uppercase"><th style="text-align:left;padding:4px 6px">Date</th><th style="text-align:left;padding:4px 6px">Description</th><th style="text-align:left;padding:4px 6px" class="hide-m">Category</th><th style="text-align:right;padding:4px 6px">Amount</th><th style="text-align:right;padding:4px 6px" class="hide-m">Accrual</th><th style="text-align:right;padding:4px 6px" class="hide-m">Days</th></tr></thead><tbody>`;
    const renderedTagGroups=new Set();
    txnAccruals.forEach(t=>{
      const gid=t.transaction_group_id;
      const gMembers=gid?tagGroupMembers[gid]:null;
      const gSummary=gid?tagGroupSummaries[gid]:null;
      // Linked group with 2+ members: render summary + hidden children
      if(gid&&gMembers&&gMembers.length>=2&&gSummary&&!renderedTagGroups.has(gid)){
        renderedTagGroups.add(gid);
        const sNeg=gSummary.netAccrual<0;
        const owStyle=gSummary.hasNoOverlap?"outline:1px dashed rgba(255,70,70,0.5);outline-offset:-1px;background:rgba(255,70,70,0.06);":gSummary.hasPartial?"outline:1px dashed rgba(255,165,0,0.35);outline-offset:-1px;":"";
        mhtml+=`<tr class="tag-grp-row" data-tag-gid="${gid}" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03);border-left:3px solid var(--b);background:rgba(74,111,165,0.04);${owStyle}"><td style="padding:5px 6px;color:rgba(255,255,255,0.4);white-space:nowrap">${fmtD(gSummary.dateMax)}</td><td style="padding:5px 6px;color:rgba(255,255,255,0.9);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="tag-grp-chev" data-tag-grp-chev="${gid}" style="display:inline-block;font-size:10px;margin-right:4px;transition:transform 0.15s">&#9654;</span><span style="font-size:10px;margin-right:4px;color:var(--b)">\uD83D\uDD17${gSummary.memberCount}</span>${gSummary.label}</td><td style="padding:5px 6px" class="hide-m"><span style="background:${(CC[gSummary.dominantCat]||"#666")}22;color:${CC[gSummary.dominantCat]||"#888"};padding:1px 5px;border-radius:3px;font-size:10px">${gSummary.dominantCat}${gSummary.mixedCat?`<span style="margin-left:3px;font-size:9px;color:rgba(255,255,255,0.3)">+</span>`:""}</span></td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${sNeg?"var(--g)":"rgba(255,255,255,0.75)"};font-weight:600">${fmtF(Math.round(gSummary.netAmt*100)/100)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${sNeg?"var(--g)":"var(--r)"}" class="hide-m">${fmtF(Math.round(gSummary.netAccrual*100)/100)}</td><td style="padding:5px 6px" class="hide-m"></td></tr>`;
        // Child rows (hidden by default)
        gMembers.forEach(m=>{
          const mNeg=m._accrual<0;
          const partialOverlap=!m._noOverlap&&tag.start_date&&tag.end_date&&m.service_start&&m.service_end&&(m.service_start<tag.start_date||m.service_end>tag.end_date);
          const mOwStyle=m._noOverlap?"outline:1px dashed rgba(255,70,70,0.5);outline-offset:-1px;background:rgba(255,70,70,0.06);":partialOverlap?"outline:1px dashed rgba(255,165,0,0.35);outline-offset:-1px;":"";
          const mOwTip=m._noOverlap?` title="⚠ Service period ${fmtD(m.service_start)}\u2013${fmtD(m.service_end)} is completely outside tag window"`:partialOverlap?` title="Service period ${fmtD(m.service_start)}\u2013${fmtD(m.service_end)} extends outside tag window"`:""
          mhtml+=`<tr class="tag-txn-row tag-grp-child" data-tid="${m.id}" data-tag-grp-child="${gid}" style="display:none;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03);border-left:3px solid rgba(74,111,165,0.3);${mOwStyle}"${mOwTip}><td style="padding:5px 6px;padding-left:12px;color:rgba(255,255,255,0.3);white-space:nowrap">${fmtD(m.date)}</td><td style="padding:5px 6px;color:rgba(255,255,255,0.5);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.description}</td><td style="padding:5px 6px" class="hide-m"><span style="background:${(CC[m.category_id]||"#666")}22;color:${CC[m.category_id]||"#888"};padding:1px 5px;border-radius:3px;font-size:10px">${m.category_id}</span></td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.4)">${m.currency&&m.currency!=="USD"&&m.original_amount!=null?`<span style="color:rgba(255,255,255,0.2);font-size:10px;margin-right:5px">${m.currency==="CAD"?"CA$":m.currency+" "}${new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.abs(m.original_amount))}</span>`:""}${fmtF(m.amount_usd)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${mNeg?"var(--g)":"var(--r)"}" class="hide-m">${fmtF(m._accrual)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.25)" class="hide-m">${m._oDays||""}</td></tr>`;
        });
        return;// skip individual members processed above
      }
      // Skip members already rendered as children
      if(gid&&gMembers&&gMembers.length>=2&&renderedTagGroups.has(gid))return;
      // Normal ungrouped row
      const isNeg=t._accrual<0;
      const partialOverlap=!t._noOverlap&&tag.start_date&&tag.end_date&&t.service_start&&t.service_end&&(t.service_start<tag.start_date||t.service_end>tag.end_date);
      const owStyle=t._noOverlap?"outline:1px dashed rgba(255,70,70,0.5);outline-offset:-1px;background:rgba(255,70,70,0.06);":partialOverlap?"outline:1px dashed rgba(255,165,0,0.35);outline-offset:-1px;":"";
      const owTip=t._noOverlap?` title="⚠ Service period ${fmtD(t.service_start)}\u2013${fmtD(t.service_end)} is completely outside tag window — possible date error"`:partialOverlap?` title="Service period ${fmtD(t.service_start)}\u2013${fmtD(t.service_end)} extends outside tag window"`:""
      mhtml+=`<tr class="tag-txn-row" data-tid="${t.id}" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03);${owStyle}"${owTip}><td style="padding:5px 6px;color:rgba(255,255,255,0.4);white-space:nowrap">${fmtD(t.date)}</td><td style="padding:5px 6px;color:rgba(255,255,255,0.7);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description}</td><td style="padding:5px 6px" class="hide-m"><span style="background:${(CC[t.category_id]||"#666")}22;color:${CC[t.category_id]||"#888"};padding:1px 5px;border-radius:3px;font-size:10px">${t.category_id}</span></td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.5)">${t.currency&&t.currency!=="USD"&&t.original_amount!=null?`<span style="color:rgba(255,255,255,0.28);font-size:10px;margin-right:5px">${t.currency==="CAD"?"CA$":t.currency+" "}${new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.abs(t.original_amount))}</span>`:""}${fmtF(t.amount_usd)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${isNeg?"var(--g)":"var(--r)"}" class="hide-m">${fmtF(t._accrual)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:rgba(255,255,255,0.3)" class="hide-m">${t._oDays||""}</td></tr>`;
    });
    mhtml+=`</tbody></table></div></div>`;
  }

  const modal=h("div",{class:"modal",style:{maxWidth:"700px"}});
  modal.innerHTML=mhtml;
  // Expand/collapse for linked transaction groups
  const expandedTagGroups=new Set();
  modal.querySelectorAll(".tag-grp-row").forEach(row=>{
    row.addEventListener("click",()=>{
      const gid=row.dataset.tagGid;
      if(expandedTagGroups.has(gid)){expandedTagGroups.delete(gid)}else{expandedTagGroups.add(gid)}
      const exp=expandedTagGroups.has(gid);
      modal.querySelectorAll(`[data-tag-grp-child="${gid}"]`).forEach(r=>{r.style.display=exp?"table-row":"none"});
      const ch=modal.querySelector(`[data-tag-grp-chev="${gid}"]`);if(ch)ch.style.transform=exp?"rotate(90deg)":"";
    });
    row.addEventListener("mouseenter",()=>row.style.background="rgba(74,111,165,0.08)");
    row.addEventListener("mouseleave",()=>row.style.background="rgba(74,111,165,0.04)");
  });
  // Attach click handlers for transaction rows (individual + child rows)
  modal.querySelectorAll(".tag-txn-row").forEach(row=>{
    row.addEventListener("click",e=>{
      e.stopPropagation();
      const tid=parseInt(row.dataset.tid);
      const txn=txnAccruals.find(t=>t.id===tid);
      if(txn){bg.remove();openLedgerEditModal(txn,()=>showTagDetail(tag))}
    });
    const isChild=row.classList.contains("tag-grp-child");
    row.addEventListener("mouseenter",()=>row.style.background=isChild?"rgba(74,111,165,0.06)":"rgba(255,255,255,0.04)");
    row.addEventListener("mouseleave",()=>row.style.background=isChild?"transparent":"transparent");
  });
  // Modal date editing
  const mdEl=modal.querySelector(".tag-modal-dates");
  if(mdEl){
    mdEl.addEventListener("click",()=>{
      const txtEl=mdEl.querySelector(".tmd-text");if(!txtEl)return;
      const origText=txtEl.innerHTML;
      txtEl.innerHTML=`<input type="date" class="tmd-s" value="${tag.start_date}" style="font-size:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;padding:2px 4px;width:125px"> – <input type="date" class="tmd-e" value="${tag.end_date}" style="font-size:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;padding:2px 4px;width:125px">`;
      mdEl.style.cursor="default";
      const sI=txtEl.querySelector(".tmd-s"),eI=txtEl.querySelector(".tmd-e");
      sI.addEventListener("click",e=>e.stopPropagation());
      eI.addEventListener("click",e=>e.stopPropagation());
      let saving=false;
      const doSave=async()=>{
        if(saving)return;
        const ns=sI.value,ne=eI.value;
        if(!ns||!ne||ns>ne){txtEl.innerHTML=origText;mdEl.style.cursor="pointer";return}
        if(ns===tag.start_date&&ne===tag.end_date){txtEl.innerHTML=origText;mdEl.style.cursor="pointer";return}
        saving=true;
        try{
          await sb(`tags?name=eq.${encodeURIComponent(tag.name)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({start_date:ns,end_date:ne})});
          bg.remove();
          tag.start_date=ns;tag.end_date=ne;
          showTagDetail(tag);
          const contentEl=document.getElementById("content");
          if(contentEl)renderTags(contentEl);
        }catch(err){saving=false;txtEl.innerHTML=origText;mdEl.style.cursor="pointer";alert("Failed to save: "+err.message)}
      };
      const doCancel=()=>{if(!saving){txtEl.innerHTML=origText;mdEl.style.cursor="pointer"}};
      const blurSave=()=>{setTimeout(()=>{if(!txtEl.contains(document.activeElement))doSave()},150)};
      sI.addEventListener("blur",blurSave);
      eI.addEventListener("blur",blurSave);
      sI.addEventListener("keydown",e=>{if(e.key==="Escape")doCancel();if(e.key==="Enter"){e.preventDefault();eI.focus()}});
      eI.addEventListener("keydown",e=>{if(e.key==="Escape")doCancel();if(e.key==="Enter"){e.preventDefault();doSave()}});
      sI.focus();
    });
  }
  bg.append(modal);
  document.body.append(bg);
}
