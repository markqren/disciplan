function renderReviewTable(container,candidates){
  container.innerHTML="";
  const skipped=candidates.filter(c=>c._status==="skipped");
  const dupes=candidates.filter(c=>c._isDuplicate);
  const hi=candidates.filter(c=>c.ai_confidence==="high"&&c._status!=="skipped");
  const med=candidates.filter(c=>c.ai_confidence==="medium"&&c._status!=="skipped");
  const lo=candidates.filter(c=>c.ai_confidence==="low"&&c._status!=="skipped");

  const stats=h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.5)",marginBottom:"12px"}},
    `${candidates.length} parsed \u00b7 ${skipped.length} auto-skipped \u00b7 ${dupes.length} duplicates \u00b7 ${hi.length} high \u00b7 ${med.length} medium \u00b7 ${lo.length} low confidence`);
  container.append(stats);

  const bulkBar=h("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"12px"}});
  bulkBar.append(h("button",{class:"pg-btn",style:"color:var(--g);border-color:rgba(129,178,154,0.3)",onClick:()=>{
    candidates.forEach(c=>{if(c.ai_confidence==="high"&&c._status==="pending")c._status="approved"});
    renderReviewTable(container,candidates);
  }},"\u2713 Approve All High-Confidence"));
  bulkBar.append(h("button",{class:"pg-btn",style:"color:var(--b);border-color:rgba(74,111,165,0.3)",onClick:()=>{
    candidates.forEach(c=>{if(c._status==="pending")c._status="approved"});
    renderReviewTable(container,candidates);
  }},"\u2713 Approve All"));
  let saving=false;
  const saveBtn=h("button",{class:"pg-btn",style:"color:#fff;background:rgba(129,178,154,0.2);border-color:rgba(129,178,154,0.4);font-weight:600",onClick:async()=>{
    if(saving)return;
    const approved=candidates.filter(c=>c._status==="approved");
    if(!approved.length)return alert("No approved transactions to save.");
    saving=true;saveBtn.disabled=true;saveBtn.textContent="Saving...";
    try{
      const summary=await commitImport(candidates);
      renderReviewTable(container,candidates);
      showUndo(`\u2713 Imported ${summary.count} transactions`,async()=>{
        await sb(`transactions?import_batch=eq.${encodeURIComponent(summary.batchId)}`,{method:"DELETE"});
        state.txnCount-=summary.count;document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
      });
      const sumEl=h("div",{class:"preview",style:{marginTop:"12px"}});
      const dates=summary.imported.map(c=>c.date).sort();
      sumEl.innerHTML=`<div style="color:var(--g);font-weight:600;margin-bottom:6px">\u2713 Imported ${summary.count} transactions \u00b7 ${summary.skipped} skipped \u00b7 ${summary.dupes} duplicates</div>`;
      const viewBtn=h("button",{class:"pg-btn",style:"color:var(--b);border-color:rgba(74,111,165,0.3);margin-top:4px",onClick:()=>{
        dcInvalidateTxns();state.tab="ledger";state.lf={cat:"",pt:"",dfrom:dates[0]||"",dto:dates[dates.length-1]||"",q:""};state.page=0;renderTabs();renderContent();
      }},"View in Ledger \u2192");
      sumEl.append(viewBtn);
      container.append(sumEl);
      saveBtn.textContent="Saved";
    }catch(e){
      console.error("commitImport error:",e);
      alert("Error saving: "+e.message);
      saveBtn.disabled=false;saveBtn.textContent="Save Approved";
    }
  }},"Save Approved");
  bulkBar.append(saveBtn);
  container.append(bulkBar);

  const wrap=h("div",{style:{overflowX:"auto"}});
  const tbl=h("table");
  const thead=h("thead");
  thead.innerHTML=`<tr><th style="width:36px"></th><th>Date</th><th>Description</th><th class="r">Amount</th><th>Category</th><th class="hide-m">Svc Period</th><th class="hide-m">Tag</th><th class="hide-m">Bank Cat</th></tr>`;
  tbl.append(thead);
  const tbody=h("tbody");

  candidates.forEach((c,idx)=>{
    const tr=h("tr",{style:{borderLeft:c._status==="approved"?"3px solid var(--g)":c._isDuplicate?"3px solid var(--y)":"3px solid transparent",opacity:c._status==="skipped"?"0.4":"1"}});

    const statusIcon=c._status==="approved"?"\u2713":c._status==="skipped"?"\u2715":c._status==="committed"?"\u2713":"\u25CB";
    const statusColor=c._status==="approved"?"var(--g)":c._status==="skipped"?"var(--r)":c._status==="committed"?"var(--b)":"rgba(255,255,255,0.3)";
    tr.append(h("td",{style:{cursor:c._status==="committed"?"default":"pointer",textAlign:"center",fontSize:"14px",color:statusColor,userSelect:"none"},onClick:()=>{
      if(c._status==="committed")return;
      if(c._isDuplicate&&c._status==="skipped")c._status="pending";
      else if(c._status==="pending")c._status="approved";
      else if(c._status==="approved")c._status="skipped";
      else c._status="pending";
      renderReviewTable(container,candidates);
    }},statusIcon));

    tr.append(h("td",{class:"m",style:{color:"rgba(255,255,255,0.55)",whiteSpace:"nowrap",cursor:"pointer"},onClick:()=>{if(c._status!=="committed")openImportEditModal(candidates,idx,container)}},fmtD(c.date)));

    const descTd=h("td",{style:{maxWidth:"220px",cursor:"pointer"},onClick:()=>{if(c._status!=="committed")openImportEditModal(candidates,idx,container)}});
    const descText=(c._isCCPayment?"\uD83D\uDCB3 ":"")+(c.description||c._rawDescription)+((c._linkToTransactionId||c._linkToStagedIdx!=null)?" \uD83D\uDD17":"");
    const descMain=h("div",{style:{color:c._status==="skipped"?"rgba(255,255,255,0.35)":"rgba(255,255,255,0.85)",textDecoration:c._status==="skipped"?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}});
    descMain.textContent=descText;
    if(c._isCCPayment){const pairHint=h("span",{style:{color:"rgba(255,255,255,0.3)",fontSize:"11px"}}," \u2192 Chase Chequing");descMain.append(pairHint)}
    const descSub=h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}});
    descSub.textContent=c._skipReason?c._skipReason+(c._rawDescription?" \u00b7 "+c._rawDescription:""):c._rawDescription;
    descTd.append(descMain,descSub);
    tr.append(descTd);

    tr.append(h("td",{class:"r m",style:{color:c.amount_usd<0?"var(--g)":"rgba(255,255,255,0.75)"}},fmtF(c.amount_usd)));

    const catTd=h("td");
    catTd.append(h("span",{style:{display:"inline-block",width:"6px",height:"6px",borderRadius:"50%",marginRight:"4px",background:c.ai_confidence==="high"?"var(--g)":c.ai_confidence==="medium"?"var(--y)":"var(--r)"}}));
    const catSel2=h("select",{style:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"5px",padding:"3px 6px",color:"#e8e8e4",fontSize:"11px",fontFamily:"var(--sans)",cursor:"pointer",outline:"none"},onChange:e=>{
      c.category_id=e.target.value;
      c.service_start=getDefStart(c.category_id,c.date)||c.date;
      c.service_end=getDefEnd(c.category_id,c.service_start)||c.service_start;
      const ss=new Date(c.service_start+"T00:00:00"),se=new Date(c.service_end+"T00:00:00");
      c.service_days=Math.max(1,Math.floor((se-ss)/864e5)+1);
      c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
      propagateEdits(candidates,idx);
      renderReviewTable(container,candidates);
    }});
    CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===c.category_id)o.selected=true;catSel2.append(o)});
    catTd.append(catSel2);
    tr.append(catTd);

    tr.append(h("td",{class:"m hide-m",style:{color:"rgba(255,255,255,0.4)",whiteSpace:"nowrap",fontSize:"11px"}},
      c.service_start===c.service_end?fmtD(c.date):`${fmtD(c.service_start)}\u2013${fmtD(c.service_end)}`));

    const tagTd=h("td",{class:"hide-m"});
    tagTd.append(h("input",{type:"text",value:c.tag||"",style:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"5px",padding:"3px 6px",color:"#e8e8e4",fontSize:"11px",width:"70px",fontFamily:"var(--sans)",outline:"none"},onInput:e=>{c.tag=e.target.value}}));
    tr.append(tagTd);

    tr.append(h("td",{class:"hide-m",style:{color:"rgba(255,255,255,0.25)",fontSize:"11px"}},c._bankCategory));
    tbody.append(tr);
  });

  tbl.append(tbody);
  wrap.append(tbl);
  container.append(wrap);
}

function openImportEditModal(candidates,idx,reviewContainer){
  const c=candidates[idx];
  let seManual=false;
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal"});

  // Header with close button
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
  const hdrLeft=h("div");
  hdrLeft.append(h("h3",{style:{margin:"0"}},"Edit Transaction"));
  hdrLeft.append(h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",marginTop:"4px"}},c._rawDescription));
  const closeBtn=h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715");
  hdr.append(hdrLeft,closeBtn);
  modal.append(hdr);

  function mRow(...ch){const d=h("div",{style:{display:"grid",gridTemplateColumns:ch.length===3?"1fr 1fr 1fr":ch.length===2?"1fr 1fr":"1fr",gap:"12px",marginBottom:"14px"}});ch.forEach(x=>d.append(x));return d}
  function mField(lbl,inp){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(inp);return d}

  const mDate=h("input",{class:"inp",type:"date",value:c.date,onInput:updatePreview});
  const mDesc=h("input",{class:"inp",type:"text",value:c.description||c._rawDescription});
  const rawRef=h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.2)",marginTop:"2px"}},"Bank: "+c._rawDescription);
  const descField=h("div");
  descField.append(h("label",{class:"lbl"},"Description"));
  descField.append(mDesc);
  descField.append(rawRef);

  const mAmt=h("input",{class:"inp",type:"number",step:"0.01",value:c.amount_usd,onInput:updatePreview});

  const mCat=h("select",{class:"inp",onChange:()=>{
    if(!seManual){mSs.value=getDefStart(mCat.value,c.date)||mSs.value;mSe.value=getDefEnd(mCat.value,mSs.value)||mSs.value;updateHint()}
    updatePreview();
  }});
  CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===c.category_id)o.selected=true;mCat.append(o)});

  const mSs=h("input",{class:"inp",type:"date",value:c.service_start,onInput:()=>{
    if(!seManual){mSe.value=getDefEnd(mCat.value,mSs.value)||mSs.value}
    updatePreview();
  }});
  const mSe=h("input",{class:"inp",type:"date",value:c.service_end,onInput:()=>{
    seManual=true;mSe.style.borderColor="rgba(242,204,143,0.3)";updatePreview();
  }});
  const hintSpan=h("span",{style:{color:"rgba(129,178,154,0.6)",textTransform:"none",letterSpacing:"0",fontWeight:"400",fontSize:"10px"}});
  function updateHint(){const r=ACCRUAL_D[mCat.value];hintSpan.textContent=!seManual&&r?(r==="month"?"(Auto: full month)":`(Auto: ${r} days)`):""}
  updateHint();
  const seLbl=h("label",{class:"lbl"});seLbl.append("Service End ");seLbl.append(hintSpan);
  const seField=h("div");seField.append(seLbl);seField.append(mSe);

  const mPt=h("select",{class:"inp"});
  if(c.payment_type&&!PTS.includes(c.payment_type))mPt.append(h("option",{value:c.payment_type,selected:true},c.payment_type));
  PTS.forEach(p=>{const o=h("option",{value:p},p);if(p===c.payment_type)o.selected=true;mPt.append(o)});
  const mTag=h("input",{class:"inp",type:"text",value:c.tag||""});

  // Accrual preview
  const previewEl=h("div",{class:"preview hidden"});
  function updatePreview(){
    const a=parseFloat(mAmt.value);if(isNaN(a)||!mSs.value||!mSe.value){previewEl.classList.add("hidden");return}
    const ss=new Date(mSs.value+"T00:00:00"),se=new Date(mSe.value+"T00:00:00");
    if(se<ss){previewEl.classList.add("hidden");return}
    const days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    const daily=a/days;
    previewEl.classList.remove("hidden");
    previewEl.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Accrual Preview</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">USD Amount</div><div style="font-size:18px;font-weight:700;color:#fff;font-family:var(--mono)">${fmtF(a)}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Service Days</div><div style="font-size:18px;font-weight:700;color:var(--b);font-family:var(--mono)">${days}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Daily Cost</div><div style="font-size:18px;font-weight:700;color:var(--g);font-family:var(--mono)">${fmtF(daily)}/d</div></div>
    </div>`;
  }
  updatePreview();

  // Link to Transaction section
  const linkSection=h("div",{style:{marginTop:"12px",marginBottom:"4px"}});
  const linkBody=h("div");
  function renderImportLink(){
    linkBody.innerHTML="";
    const hasLink=c._linkToTransactionId||c._linkToStagedIdx!=null;
    if(hasLink){
      const info=c._linkDisplay||{};
      const isStaged=c._linkToStagedIdx!=null;
      const row=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",background:isStaged?"rgba(242,204,143,0.12)":"rgba(74,111,165,0.12)",borderRadius:"4px",marginTop:"6px"}});
      const left=h("div");
      left.innerHTML=`<div style="color:rgba(255,255,255,0.7)">${isStaged?`<span style="font-size:9px;background:rgba(242,204,143,0.25);color:#F2CC8F;padding:1px 5px;border-radius:3px;margin-right:4px">Staged</span>`:""} ${info.description||"Transaction #"+(c._linkToTransactionId||"staged")}</div><div style="color:rgba(255,255,255,0.35);font-size:10px">${info.date?fmtD(info.date):""} \u00b7 ${info.category_id||""} \u00b7 ${info.payment_type||""}</div>`;
      row.append(left);
      const right=h("div",{style:{display:"flex",alignItems:"center",gap:"8px"}});
      if(info.amount_usd!=null)right.append(h("span",{style:{fontFamily:"var(--mono)",color:info.amount_usd<0?"var(--g)":"rgba(255,255,255,0.6)",whiteSpace:"nowrap"}},fmtF(info.amount_usd)));
      right.append(h("button",{class:"pg-btn",style:{fontSize:"9px",color:"rgba(224,122,95,0.7)",padding:"2px 6px"},onClick:()=>{
        delete c._linkToTransactionId;delete c._linkToGroupId;delete c._linkDisplay;delete c._linkToStagedIdx;
        renderImportLink();
      }},"Unlink"));
      row.append(right);
      linkBody.append(row);
      const changeBtn=h("button",{class:"pg-btn",style:{fontSize:"10px",color:"var(--b)",marginTop:"6px"},onClick:()=>{changeBtn.style.display="none";buildImportLinkSearch(linkBody)}},"\u2026 Change Link");
      linkBody.append(changeBtn);
    }else{
      const linkToggle=h("button",{class:"pg-btn",style:{fontSize:"10px",color:"var(--b)"},onClick:()=>{linkToggle.style.display="none";buildImportLinkSearch(linkBody)}},"\uD83D\uDD17 Link to Transaction");
      linkBody.append(linkToggle);
    }
  }
  function buildImportLinkSearch(container){
    const lsWrap=h("div",{style:{marginTop:"6px"}});
    const lsRow=h("div",{style:{display:"flex",gap:"6px",marginBottom:"8px"}});
    const lsInput=h("input",{class:"inp",type:"text",placeholder:"Search description...",style:{flex:"1",fontSize:"11px",padding:"5px 8px"}});
    const lsBtn=h("button",{class:"pg-btn",style:{fontSize:"10px",padding:"5px 10px"}},"Search");
    lsRow.append(lsInput,lsBtn);lsWrap.append(lsRow);
    const lsResults=h("div",{style:{maxHeight:"250px",overflowY:"auto"}});lsWrap.append(lsResults);
    async function doSearch(){
      const q=lsInput.value.trim();if(!q){lsResults.innerHTML="<div style='color:rgba(255,255,255,0.3);padding:8px'>Type a description to search</div>";return}
      lsBtn.textContent="...";lsBtn.disabled=true;
      try{
        // Search staged candidates first
        const ql=q.toLowerCase();
        const staged=candidates.map((sc,si)=>({sc,si})).filter(({sc,si})=>si!==idx&&sc._status!=="skipped"&&sc._status!=="committed"&&(sc.description||sc._rawDescription||"").toLowerCase().includes(ql)).slice(0,10);
        lsResults.innerHTML="";
        if(staged.length){
          lsResults.append(h("div",{style:{fontSize:"9px",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.05em",padding:"4px 8px",borderBottom:"1px solid rgba(255,255,255,0.06)"}},"Staged in this import"));
          staged.forEach(({sc,si})=>{
            const row=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.04)",borderRadius:"4px"},onClick:()=>{
              delete c._linkToTransactionId;delete c._linkToGroupId;
              c._linkToStagedIdx=si;
              c._linkDisplay={description:sc.description||sc._rawDescription,date:sc.date,amount_usd:sc.amount_usd,category_id:sc.category_id,payment_type:sc.payment_type};
              lsWrap.remove();renderImportLink();
            }});
            row.innerHTML=`<div><div style="color:rgba(255,255,255,0.7)"><span style="font-size:9px;background:rgba(242,204,143,0.25);color:#F2CC8F;padding:1px 5px;border-radius:3px;margin-right:4px">Staged</span>${sc.description||sc._rawDescription}</div><div style="color:rgba(255,255,255,0.35);font-size:10px">${fmtD(sc.date)} \u00b7 ${sc.category_id||""} \u00b7 ${sc.payment_type||""}</div></div><div style="font-family:var(--mono);color:rgba(255,255,255,0.6);white-space:nowrap;margin-left:8px">${fmtF(sc.amount_usd)}</div>`;
            lsResults.append(row);
          });
        }
        // Then search DB
        const rows=await sb(`transactions?description=ilike.*${encodeURIComponent(q)}*&order=date.desc&limit=20&select=id,date,description,amount_usd,category_id,payment_type,transaction_group_id`);
        if(rows.length){
          if(staged.length)lsResults.append(h("div",{style:{fontSize:"9px",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.05em",padding:"4px 8px",borderBottom:"1px solid rgba(255,255,255,0.06)",marginTop:"4px"}},"Existing transactions"));
          rows.forEach(r=>{
            const row=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.04)",borderRadius:"4px"},onClick:()=>{
              delete c._linkToStagedIdx;
              c._linkToTransactionId=r.id;c._linkToGroupId=r.transaction_group_id||null;
              c._linkDisplay={description:r.description,date:r.date,amount_usd:r.amount_usd,category_id:r.category_id,payment_type:r.payment_type};
              lsWrap.remove();renderImportLink();
            }});
            const inGroup=!!r.transaction_group_id;
            row.innerHTML=`<div><div style="color:rgba(255,255,255,0.7)">${r.description}${inGroup?" <span style='font-size:9px;color:rgba(255,255,255,0.3)'>(in group)</span>":""}</div><div style="color:rgba(255,255,255,0.35);font-size:10px">${fmtD(r.date)} \u00b7 ${r.category_id} \u00b7 ${r.payment_type||""}</div></div><div style="font-family:var(--mono);color:rgba(255,255,255,0.6);white-space:nowrap;margin-left:8px">${fmtF(r.amount_usd)}</div>`;
            lsResults.append(row);
          });
        }
        if(!staged.length&&!rows.length)lsResults.innerHTML="<div style='color:rgba(255,255,255,0.3);padding:8px'>No transactions found</div>";
      }catch(e){lsResults.innerHTML=`<div style='color:var(--r);padding:8px'>Error: ${e.message}</div>`}
      finally{lsBtn.textContent="Search";lsBtn.disabled=false}
    }
    lsBtn.addEventListener("click",doSearch);
    lsInput.addEventListener("keydown",e=>{if(e.key==="Enter")doSearch()});
    container.append(lsWrap);
    lsInput.focus();
  }
  renderImportLink();
  linkSection.append(linkBody);

  // Action buttons
  const btnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto auto",gap:"8px",marginTop:"4px"}});
  const mSave=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:()=>{
    c.date=mDate.value;c.description=mDesc.value;c.amount_usd=parseFloat(mAmt.value);
    c.original_amount=c.amount_usd;c.category_id=mCat.value;
    c.service_start=mSs.value;c.service_end=mSe.value;
    c.payment_type=mPt.value;c.tag=mTag.value;
    const ss=new Date(c.service_start+"T00:00:00"),se=new Date(c.service_end+"T00:00:00");
    c.service_days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
    c._status="approved";
    propagateEdits(candidates,idx);
    bg.remove();
    renderReviewTable(reviewContainer,candidates);
  }},"Save & Approve");
  const mSkip=h("button",{class:"btn",style:{background:"rgba(224,122,95,0.15)",color:"var(--r)",width:"auto",padding:"12px 20px"},onClick:()=>{
    c._status="skipped";bg.remove();renderReviewTable(reviewContainer,candidates);
  }},"Skip");
  const mCancel=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>bg.remove()},"Cancel");
  btnRow.append(mSave,mSkip,mCancel);

  modal.append(mRow(mField("Date",mDate),descField));
  modal.append(mRow(mField("Category",mCat),mField("Amount (USD)",mAmt)));
  modal.append(mRow(mField("Service Start",mSs),seField));
  modal.append(mRow(mField("Payment Account",mPt),mField("Tag",mTag)));
  modal.append(previewEl);
  modal.append(linkSection);
  modal.append(btnRow);
  bg.append(modal);
  document.body.append(bg);
}

async function commitImport(candidates){
  const approved=candidates.filter(c=>c._status==="approved");
  if(!approved.length)throw new Error("No approved transactions to save.");
  const valid=approved.filter(c=>c.date&&c.service_start&&c.service_end);
  if(valid.length<approved.length)console.warn(`commitImport: dropped ${approved.length-valid.length} rows with missing dates`);
  if(!valid.length)throw new Error("All approved transactions have invalid dates.");
  const batchId="import-"+new Date().toISOString().slice(0,16);
  const rows=valid.map(c=>({
    date:c.date,service_start:c.service_start,service_end:c.service_end,
    description:c.description,category_id:c.category_id,
    original_amount:c.original_amount,currency:c.currency,fx_rate:c.fx_rate,
    amount_usd:Math.round(c.amount_usd*100)/100,
    payment_type:c.payment_type,tag:(c.tag||"").toLowerCase().trim(),
    daily_cost:c.daily_cost,service_days:c.service_days,credit:c.credit||"",
    import_batch:batchId,bank_description:c._rawDescription||null,bank_category:c._bankCategory||null,
    ai_original:c._aiOriginal||null
  }));
  // Generate Side B rows for CC payments and track pairs for linking
  const ccPairs=valid.filter(c=>c._isCCPayment&&c._ccPaymentPair);
  const ccLinkPairs=[];// [{sideAIdx, sideBIdx}] — indices into rows array
  if(ccPairs.length){
    const ccDates=ccPairs.map(c=>c.date).sort();
    const existingCQ=await sb(`transactions?payment_type=eq.${encodeURIComponent("Chase Chequing")}&date=gte.${ccDates[0]}&date=lte.${ccDates[ccDates.length-1]}&select=date,amount_usd`);
    for(const c of ccPairs){
      const p=c._ccPaymentPair;
      const isDupe=existingCQ.some(e=>e.date===c.date&&Math.abs(Math.abs(e.amount_usd)-p.amount)<0.02);
      if(!isDupe){
        const sideAIdx=valid.indexOf(c);
        const sideBIdx=rows.length;
        ccLinkPairs.push({sideAIdx,sideBIdx});
        rows.push({
          date:c.date,service_start:c.service_start,service_end:c.service_end,
          description:p.description,category_id:"financial",
          original_amount:p.amount,currency:c.currency,fx_rate:c.fx_rate,
          amount_usd:Math.round(p.amount*100)/100,
          payment_type:p.payment_type,tag:(c.tag||"").toLowerCase().trim(),
          daily_cost:p.amount,service_days:1,credit:"",
          import_batch:batchId,bank_description:null,bank_category:null,ai_original:null
        });
      }
    }
  }
  const uniqueTags=[...new Set(rows.map(r=>r.tag).filter(Boolean))];
  for(const t of uniqueTags)await ensureTagExists(t);
  const inserted=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(rows)});
  state.txnCount+=rows.length;
  document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
  // Link CC payment Side A ↔ Side B pairs
  for(const pair of ccLinkPairs){
    const sideA=inserted[pair.sideAIdx];
    const sideB=inserted[pair.sideBIdx];
    if(sideA?.id&&sideB?.id)await linkToGroup(sideA,sideB);
  }
  // Apply pre-set links from import edit modal (DB links)
  for(let i=0;i<valid.length;i++){
    const c=valid[i];
    if(!c._linkToTransactionId)continue;
    const ins=inserted[i];if(!ins||!ins.id)continue;
    const targetGroup=c._linkToGroupId||Math.min(ins.id,c._linkToTransactionId);
    await sb(`transactions?id=eq.${ins.id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:targetGroup})});
    if(!c._linkToGroupId){
      await sb(`transactions?id=eq.${c._linkToTransactionId}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:targetGroup})});
    }
  }
  // Apply staged-to-staged links
  const stagedLinked=new Set();
  for(let i=0;i<valid.length;i++){
    const c=valid[i];
    if(c._linkToStagedIdx==null)continue;
    const linkedCand=candidates[c._linkToStagedIdx];
    const linkedIdx=valid.indexOf(linkedCand);
    if(linkedIdx===-1)continue;// linked candidate was skipped
    const pairKey=[Math.min(i,linkedIdx),Math.max(i,linkedIdx)].join(",");
    if(stagedLinked.has(pairKey))continue;// avoid double-linking A→B and B→A
    stagedLinked.add(pairKey);
    const insA=inserted[i],insB=inserted[linkedIdx];
    if(insA?.id&&insB?.id)await linkToGroup(insA,insB);
  }
  // Auto-link AT&T internet charges to existing Connectivity Reimbursement Fund in same month
  const attCharges=valid.filter(c=>c.description&&/AT&T/i.test(c.description)&&c.category_id==="utilities"&&c.amount_usd>0&&c.service_start&&c.service_end);
  for(const att of attCharges){
    const attIdx=valid.indexOf(att);
    if(!inserted[attIdx])continue;
    try{
      const [attFresh,reimbMatches]=await Promise.all([
        sb(`transactions?id=eq.${inserted[attIdx].id}&select=id,transaction_group_id&limit=1`),
        sb(`transactions?description=ilike.*Connectivity+Reimbursement*&service_start=gte.${att.service_start.slice(0,8)}01&service_start=lte.${att.service_end}&amount_usd=lt.0&select=id,transaction_group_id,description&limit=1`)
      ]);
      if(attFresh.length&&reimbMatches.length){
        await linkToGroup(attFresh[0],reimbMatches[0]);
        console.log(`AT&T: auto-linked to "${reimbMatches[0].description}" (${att.service_start}–${att.service_end})`);
      }
    }catch(e){console.error("AT&T connectivity auto-link:",e)}
  }
  valid.forEach(c=>c._status="committed");
  return{
    count:valid.length,
    imported:valid,
    skipped:candidates.filter(c=>c._status==="skipped").length,
    dupes:candidates.filter(c=>c._isDuplicate).length,
    batchId
  };
}


// ---- EMAIL IMPORT REVIEW ----

function renderEmailReviewTable(container,candidates){
  container.innerHTML="";
  const pending=candidates.filter(c=>c._status==="pending").length;
  const approved=candidates.filter(c=>c._status==="approved").length;
  const venmo=candidates.filter(c=>c._source==="venmo").length;
  const unknown=candidates.filter(c=>c._source==="unknown").length;
  const dupes=candidates.filter(c=>c._isDuplicate).length;

  container.append(h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.5)",marginBottom:"12px"}},
    `${candidates.length} total \u00b7 ${pending} pending \u00b7 ${approved} approved${venmo?" \u00b7 "+venmo+" venmo":""}${unknown?" \u00b7 "+unknown+" unknown":""}${dupes?" \u00b7 "+dupes+" duplicates":""}`));

  const bulkBar=h("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"12px"}});
  bulkBar.append(h("button",{class:"pg-btn",style:"color:var(--g);border-color:rgba(129,178,154,0.3)",onClick:()=>{
    candidates.forEach(c=>{if(c._status==="pending")c._status="approved"});
    renderEmailReviewTable(container,candidates);
  }},"\u2713 Approve All"));

  let saving=false;
  const saveBtn=h("button",{class:"pg-btn",style:"color:#fff;background:rgba(129,178,154,0.2);border-color:rgba(129,178,154,0.4);font-weight:600",onClick:async()=>{
    if(saving)return;
    const appr=candidates.filter(c=>c._status==="approved");
    if(!appr.length)return alert("No approved transactions to save.");
    saving=true;saveBtn.disabled=true;saveBtn.textContent="Saving...";
    try{
      const summary=await commitEmailImports(candidates);
      renderEmailReviewTable(container,candidates);
      showUndo(`\u2713 Imported ${summary.count} transactions`,async()=>{
        await sb(`transactions?import_batch=eq.${encodeURIComponent(summary.batchId)}`,{method:"DELETE"});
        for(const pid of summary.pendingIds)await sb(`pending_imports?id=eq.${pid}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:"approved",committed_at:null})});
        state.txnCount-=summary.count;document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
      });
      const sumEl=h("div",{class:"preview",style:{marginTop:"12px"}});
      const dates=summary.imported.map(c=>c.date).sort();
      sumEl.innerHTML=`<div style="color:var(--g);font-weight:600;margin-bottom:6px">\u2713 Committed ${summary.count} transactions \u00b7 ${summary.skipped} skipped \u00b7 ${summary.dupes} duplicates</div>`;
      sumEl.append(h("button",{class:"pg-btn",style:"color:var(--b);border-color:rgba(74,111,165,0.3);margin-top:4px",onClick:()=>{
        dcInvalidateTxns();state.tab="ledger";state.lf={cat:"",pt:"",dfrom:dates[0]||"",dto:dates[dates.length-1]||"",q:""};state.page=0;renderTabs();renderContent();
      }},"View in Ledger \u2192"));
      container.append(sumEl);
      saveBtn.textContent="Saved";
    }catch(e){
      console.error("commitEmailImports error:",e);
      alert("Error saving: "+e.message);
      saveBtn.disabled=false;saveBtn.textContent="Save Approved";
    }
  }},"Save Approved");
  bulkBar.append(saveBtn);

  const skippedItems=candidates.filter(c=>c._status==="skipped");
  if(skippedItems.length){
    const dismissBtn=h("button",{class:"pg-btn",style:"color:var(--r);border-color:rgba(224,122,95,0.3)",onClick:async()=>{
      if(dismissBtn.dataset.confirm!=="1"){dismissBtn.dataset.confirm="1";dismissBtn.textContent="Confirm Dismiss";setTimeout(()=>{dismissBtn.dataset.confirm="0";dismissBtn.textContent="\u2715 Dismiss Skipped ("+skippedItems.length+")"},3000);return}
      dismissBtn.textContent="Dismissing...";dismissBtn.disabled=true;
      try{
        for(const c of skippedItems)await sb(`pending_imports?id=eq.${c._id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:"dismissed"})});
        const remaining=candidates.filter(c=>c._status!=="skipped");
        candidates.length=0;candidates.push(...remaining);
        renderEmailReviewTable(container,candidates);
      }catch(e){alert("Dismiss failed: "+e.message);dismissBtn.textContent="\u2715 Dismiss Skipped ("+skippedItems.length+")";dismissBtn.disabled=false}
    }},"\u2715 Dismiss Skipped ("+skippedItems.length+")");
    bulkBar.append(dismissBtn);
  }

  container.append(bulkBar);

  const wrap=h("div",{style:{overflowX:"auto"}});
  const tbl=h("table");
  const thead=h("thead");
  thead.innerHTML=`<tr><th style="width:36px"></th><th>Date</th><th class="hide-m">Source</th><th>Description</th><th class="r">Amount</th><th>Category</th><th class="hide-m">Payment</th><th class="hide-m">Tag</th></tr>`;
  tbl.append(thead);
  const tbody=h("tbody");

  const srcColors={venmo:"rgba(74,111,165,0.3)",rakuten:"rgba(129,178,154,0.3)",chase:"rgba(242,204,143,0.3)",unknown:"rgba(255,255,255,0.1)"};

  candidates.forEach((c,idx)=>{
    const tr=h("tr",{style:{borderLeft:c._status==="approved"?"3px solid var(--g)":c._isDuplicate?"3px solid var(--y)":"3px solid transparent",opacity:c._status==="skipped"?"0.4":"1"}});

    const statusIcon=c._status==="approved"?"\u2713":c._status==="skipped"?"\u2715":c._status==="committed"?"\u2713":"\u25CB";
    const statusColor=c._status==="approved"?"var(--g)":c._status==="skipped"?"var(--r)":c._status==="committed"?"var(--b)":"rgba(255,255,255,0.3)";
    tr.append(h("td",{style:{cursor:c._status==="committed"?"default":"pointer",textAlign:"center",fontSize:"14px",color:statusColor,userSelect:"none"},onClick:()=>{
      if(c._status==="committed")return;
      if(c._isDuplicate&&c._status==="skipped")c._status="pending";
      else if(c._status==="pending")c._status="approved";
      else if(c._status==="approved")c._status="skipped";
      else c._status="pending";
      renderEmailReviewTable(container,candidates);
    }},statusIcon));

    tr.append(h("td",{class:"m",style:{color:"rgba(255,255,255,0.55)",whiteSpace:"nowrap",cursor:"pointer"},onClick:()=>{if(c._status!=="committed")openEmailEditModal(candidates,idx,container)}},fmtD(c.date)));

    tr.append(h("td",{class:"hide-m"},[h("span",{style:{padding:"2px 6px",borderRadius:"4px",fontSize:"10px",fontWeight:"600",background:srcColors[c._source]||srcColors.unknown}},c._source||"unknown")]));

    const descTd=h("td",{style:{maxWidth:"220px",cursor:"pointer"},onClick:()=>{if(c._status!=="committed")openEmailEditModal(candidates,idx,container)}});
    const descMain=h("div",{style:{color:c._status==="skipped"?"rgba(255,255,255,0.35)":"rgba(255,255,255,0.85)",textDecoration:c._status==="skipped"?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}});
    descMain.textContent=c.description;
    const descSub=h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}});
    descSub.textContent=c._skipReason||c._emailSubject||"";
    descTd.append(descMain,descSub);
    tr.append(descTd);

    tr.append(h("td",{class:"r m",style:{color:c.amount_usd<0?"var(--g)":"rgba(255,255,255,0.75)"}},fmtF(c.amount_usd)));

    const catTd=h("td");
    catTd.append(h("span",{style:{display:"inline-block",width:"6px",height:"6px",borderRadius:"50%",marginRight:"4px",background:c.ai_confidence==="high"?"var(--g)":c.ai_confidence==="medium"?"var(--y)":"var(--r)"}}));
    const catSel=h("select",{style:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"5px",padding:"3px 6px",color:"#e8e8e4",fontSize:"11px",fontFamily:"var(--sans)",cursor:"pointer",outline:"none"},onChange:e=>{
      c.category_id=e.target.value;
      c.service_start=getDefStart(c.category_id,c.date)||c.date;
      c.service_end=getDefEnd(c.category_id,c.service_start)||c.service_start;
      const ss=new Date(c.service_start+"T00:00:00"),se=new Date(c.service_end+"T00:00:00");
      c.service_days=Math.max(1,Math.floor((se-ss)/864e5)+1);
      c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
      renderEmailReviewTable(container,candidates);
    }});
    CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===c.category_id)o.selected=true;catSel.append(o)});
    catTd.append(catSel);
    tr.append(catTd);

    tr.append(h("td",{class:"hide-m",style:{color:"rgba(255,255,255,0.4)",fontSize:"11px"}},c.payment_type));

    const tagTd=h("td",{class:"hide-m"});
    tagTd.append(h("input",{type:"text",value:c.tag||"",style:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"5px",padding:"3px 6px",color:"#e8e8e4",fontSize:"11px",width:"70px",fontFamily:"var(--sans)",outline:"none"},onInput:e=>{c.tag=e.target.value}}));
    tr.append(tagTd);
    tbody.append(tr);
  });

  tbl.append(tbody);
  wrap.append(tbl);
  container.append(wrap);
}


function renderPayslipReviewTable(container,candidates,skippedPages){
  container.innerHTML="";
  const pending=candidates.filter(c=>c._status==="pending").length;
  const approved=candidates.filter(c=>c._status==="approved").length;
  const dupes=candidates.filter(c=>c._isDuplicate).length;
  const committed=candidates.filter(c=>c._status==="committed").length;

  container.append(h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.5)",marginBottom:"12px"}},
    `${candidates.length} transactions \u00b7 ${pending} pending \u00b7 ${approved} approved \u00b7 ${dupes} duplicates${committed?" \u00b7 "+committed+" committed":""}`));

  const bulkBar=h("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"12px"}});
  bulkBar.append(h("button",{class:"pg-btn",style:"color:var(--g);border-color:rgba(129,178,154,0.3)",onClick:()=>{
    candidates.forEach(c=>{if(c._status==="pending")c._status="approved"});
    renderPayslipReviewTable(container,candidates,skippedPages);
  }},"\u2713 Approve All"));

  let saving=false;
  const saveBtn=h("button",{class:"pg-btn",style:"color:#fff;background:rgba(129,178,154,0.2);border-color:rgba(129,178,154,0.4);font-weight:600",onClick:async()=>{
    if(saving)return;
    const appr=candidates.filter(c=>c._status==="approved");
    if(!appr.length)return alert("No approved transactions to save.");
    saving=true;saveBtn.disabled=true;saveBtn.textContent="Saving...";
    try{
      const summary=await commitPayslipImport(candidates);
      renderPayslipReviewTable(container,candidates,skippedPages);
      showUndo(`\u2713 Imported ${summary.count} transactions`,async()=>{
        await sb(`transactions?import_batch=eq.${encodeURIComponent(summary.batchId)}`,{method:"DELETE"});
        state.txnCount-=summary.count;document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
      });
      const sumEl=h("div",{class:"preview",style:{marginTop:"12px"}});
      const dates=summary.imported.map(c=>c.date).sort();
      sumEl.innerHTML=`<div style="color:var(--g);font-weight:600;margin-bottom:6px">\u2713 Imported ${summary.count} transactions \u00b7 ${summary.skipped} skipped \u00b7 ${summary.dupes} duplicates</div>`;
      sumEl.append(h("button",{class:"pg-btn",style:"color:var(--b);border-color:rgba(74,111,165,0.3);margin-top:4px",onClick:()=>{
        dcInvalidateTxns();state.tab="ledger";state.lf={cat:"",pt:"",dfrom:dates[0]||"",dto:dates[dates.length-1]||"",q:""};state.page=0;renderTabs();renderContent();
      }},"View in Ledger \u2192"));
      container.append(sumEl);
      saveBtn.textContent="Saved";
    }catch(e){
      console.error("commitPayslipImport error:",e);
      alert("Error saving: "+e.message);
      saveBtn.disabled=false;saveBtn.textContent="Save Approved";
    }
  }},"Save Approved");
  bulkBar.append(saveBtn);
  container.append(bulkBar);

  // Group by _group
  const groups=[];const groupMap={};
  candidates.forEach(c=>{
    if(!groupMap[c._group]){groupMap[c._group]=[];groups.push(c._group)}
    groupMap[c._group].push(c);
  });

  const wrap=h("div",{style:{overflowX:"auto"}});
  const tbl=h("table");
  const thead=h("thead");
  thead.innerHTML=`<tr><th style="width:36px"></th><th>Description</th><th class="r">Amount</th><th>Category</th><th class="hide-m">Service Period</th><th class="hide-m">Payment</th></tr>`;
  tbl.append(thead);
  const tbody=h("tbody");

  groups.forEach(grp=>{
    const grpTxns=groupMap[grp];
    const pd=grpTxns[0]?._pageData;

    // Group header row
    const hdrTr=h("tr",{style:{background:"rgba(255,255,255,0.03)"}});
    const hdrTd=h("td",{style:{padding:"8px 10px",fontSize:"12px",fontWeight:"600",color:"rgba(255,255,255,0.6)",borderBottom:"1px solid rgba(255,255,255,0.06)"}});
    hdrTd.setAttribute("colspan","6");
    hdrTd.textContent="\u2500\u2500 "+grp+" ";
    if(pd&&!pd.isRSU&&!pd.isSkip){
      const expectedNet=Math.round((pd.earningsTotal-pd.gtl-pd.employeeTaxTotal-pd.preTaxTotal-pd.postTaxTotal)*100)/100;
      const diff=Math.abs(expectedNet-pd.netPay);
      const chk=h("span",{style:{fontSize:"10px",fontWeight:"400",color:diff>0.02?"var(--r)":"rgba(255,255,255,0.3)"}},
        ` \u00b7 Net Pay: ${fmtF(pd.netPay)}`+(diff>0.02?` \u26a0 (expected ${fmtF(expectedNet)})`:" \u2713"));
      hdrTd.append(chk);
    }
    hdrTr.append(hdrTd);
    tbody.append(hdrTr);

    // Transaction rows
    grpTxns.forEach(c=>{
      const idx=candidates.indexOf(c);
      const tr=h("tr",{style:{borderLeft:c._status==="approved"?"3px solid var(--g)":c._isDuplicate?"3px solid var(--y)":"3px solid transparent",opacity:c._status==="skipped"?"0.4":"1"}});

      const statusIcon=c._status==="approved"?"\u2713":c._status==="skipped"?"\u2715":c._status==="committed"?"\u2713":"\u25CB";
      const statusColor=c._status==="approved"?"var(--g)":c._status==="skipped"?"var(--r)":c._status==="committed"?"var(--b)":"rgba(255,255,255,0.3)";
      tr.append(h("td",{style:{cursor:c._status==="committed"?"default":"pointer",textAlign:"center",fontSize:"14px",color:statusColor,userSelect:"none"},onClick:()=>{
        if(c._status==="committed")return;
        if(c._isDuplicate&&c._status==="skipped")c._status="pending";
        else if(c._status==="pending")c._status="approved";
        else if(c._status==="approved")c._status="skipped";
        else c._status="pending";
        renderPayslipReviewTable(container,candidates,skippedPages);
      }},statusIcon));

      const descTd=h("td",{style:{maxWidth:"220px",cursor:"pointer"},onClick:()=>{if(c._status!=="committed")openPayslipEditModal(candidates,idx,container,skippedPages)}});
      const descMain=h("div",{style:{color:c._status==="skipped"?"rgba(255,255,255,0.35)":"rgba(255,255,255,0.85)",textDecoration:c._status==="skipped"?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}});
      descMain.textContent=c.description;
      const descSub=h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}});
      descSub.textContent=c._skipReason||"";
      descTd.append(descMain,descSub);
      tr.append(descTd);

      tr.append(h("td",{class:"r m",style:{color:c.amount_usd<0?"var(--g)":"rgba(255,255,255,0.75)"}},fmtF(c.amount_usd)));

      const catTd=h("td");
      const catSel=h("select",{style:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"5px",padding:"3px 6px",color:"#e8e8e4",fontSize:"11px",fontFamily:"var(--sans)",cursor:"pointer",outline:"none"},onChange:e=>{
        c.category_id=e.target.value;
        c.service_start=getDefStart(c.category_id,c.date||c.service_start)||c.service_start;
        c.service_end=getDefEnd(c.category_id,c.service_start)||c.service_end;
        const ss2=new Date(c.service_start+"T00:00:00"),se2=new Date(c.service_end+"T00:00:00");
        c.service_days=Math.max(1,Math.floor((se2-ss2)/864e5)+1);
        c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
        renderPayslipReviewTable(container,candidates,skippedPages);
      }});
      CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===c.category_id)o.selected=true;catSel.append(o)});
      catTd.append(catSel);
      tr.append(catTd);

      tr.append(h("td",{class:"m hide-m",style:{color:"rgba(255,255,255,0.4)",whiteSpace:"nowrap",fontSize:"11px"}},
        c.service_start===c.service_end?fmtD(c.service_start):`${fmtD(c.service_start)}\u2013${fmtD(c.service_end)}`));

      tr.append(h("td",{class:"hide-m",style:{color:"rgba(255,255,255,0.4)",fontSize:"11px"}},c.payment_type));

      tbody.append(tr);
    });
  });

  // Skipped periods
  if(skippedPages&&skippedPages.length){
    skippedPages.forEach(p=>{
      const tr=h("tr",{style:{opacity:"0.35"}});
      const td=h("td",{style:{padding:"6px 10px",fontSize:"11px",fontStyle:"italic",color:"rgba(255,255,255,0.3)"}});
      td.setAttribute("colspan","6");
      td.textContent=`\u26a0 ${fmtD(p.payPeriodBegin)} \u2013 ${fmtD(p.payPeriodEnd)}: Skipped (YTD-only stub, $0 current pay)`;
      tr.append(td);
      tbody.append(tr);
    });
  }

  tbl.append(tbody);
  wrap.append(tbl);
  container.append(wrap);
}

function openEmailEditModal(candidates,idx,reviewContainer){
  const c=candidates[idx];
  let seManual=false;
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal"});

  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
  const hdrLeft=h("div");
  hdrLeft.append(h("h3",{style:{margin:"0"}},"Edit Email Import"));
  hdrLeft.append(h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",marginTop:"4px"}},c._emailSubject||""));
  const closeBtn2=h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715");
  hdr.append(hdrLeft,closeBtn2);
  modal.append(hdr);

  function mRow(...ch){const d=h("div",{style:{display:"grid",gridTemplateColumns:ch.length===3?"1fr 1fr 1fr":ch.length===2?"1fr 1fr":"1fr",gap:"12px",marginBottom:"14px"}});ch.forEach(x=>d.append(x));return d}
  function mField(lbl,inp){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(inp);return d}

  const mDate=h("input",{class:"inp",type:"date",value:c.date,onInput:emUpdatePreview});
  const mDesc=h("input",{class:"inp",type:"text",value:c.description});

  const mAmt=h("input",{class:"inp",type:"number",step:"0.01",value:c.amount_usd,onInput:emUpdatePreview});

  const mCat=h("select",{class:"inp",onChange:()=>{
    if(!seManual){mSs.value=getDefStart(mCat.value,c.date)||mSs.value;mSe.value=getDefEnd(mCat.value,mSs.value)||mSs.value;emUpdateHint()}
    emUpdatePreview();
  }});
  CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===c.category_id)o.selected=true;mCat.append(o)});

  const mSs=h("input",{class:"inp",type:"date",value:c.service_start,onInput:()=>{
    if(!seManual){mSe.value=getDefEnd(mCat.value,mSs.value)||mSs.value}
    emUpdatePreview();
  }});
  const mSe=h("input",{class:"inp",type:"date",value:c.service_end,onInput:()=>{
    seManual=true;mSe.style.borderColor="rgba(242,204,143,0.3)";emUpdatePreview();
  }});
  const emHintSpan=h("span",{style:{color:"rgba(129,178,154,0.6)",textTransform:"none",letterSpacing:"0",fontWeight:"400",fontSize:"10px"}});
  function emUpdateHint(){const r=ACCRUAL_D[mCat.value];emHintSpan.textContent=!seManual&&r?(r==="month"?"(Auto: full month)":`(Auto: ${r} days)`):""}
  emUpdateHint();
  const emSeLbl=h("label",{class:"lbl"});emSeLbl.append("Service End ");emSeLbl.append(emHintSpan);
  const emSeField=h("div");emSeField.append(emSeLbl);emSeField.append(mSe);

  const mPt=h("select",{class:"inp"});
  if(c.payment_type&&!PTS.includes(c.payment_type))mPt.append(h("option",{value:c.payment_type,selected:true},c.payment_type));
  PTS.forEach(p=>{const o=h("option",{value:p},p);if(p===c.payment_type)o.selected=true;mPt.append(o)});
  const mTag=h("input",{class:"inp",type:"text",value:c.tag||""});

  const emPreviewEl=h("div",{class:"preview hidden"});
  function emUpdatePreview(){
    const a=parseFloat(mAmt.value);if(isNaN(a)||!mSs.value||!mSe.value){emPreviewEl.classList.add("hidden");return}
    const ss=new Date(mSs.value+"T00:00:00"),se=new Date(mSe.value+"T00:00:00");
    if(se<ss){emPreviewEl.classList.add("hidden");return}
    const days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    const daily=a/days;
    emPreviewEl.classList.remove("hidden");
    emPreviewEl.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Accrual Preview</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">USD Amount</div><div style="font-size:18px;font-weight:700;color:#fff;font-family:var(--mono)">${fmtF(a)}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Service Days</div><div style="font-size:18px;font-weight:700;color:var(--b);font-family:var(--mono)">${days}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Daily Cost</div><div style="font-size:18px;font-weight:700;color:var(--g);font-family:var(--mono)">${fmtF(daily)}/d</div></div>
    </div>`;
  }
  emUpdatePreview();

  // Email reference section
  const refSection=h("div",{style:{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:"rgba(255,255,255,0.35)"}});
  const refLines=[];
  if(c._emailSubject)refLines.push("Email: "+c._emailSubject);
  refLines.push("Source: "+(c._source||"unknown"));
  if(c._source==="venmo"&&c._parsedData){
    if(c._parsedData.counterparty)refLines.push("Counterparty: "+c._parsedData.counterparty);
    if(c._parsedData.note)refLines.push("Note: "+c._parsedData.note);
  }else if(c._source==="unknown"&&c._emailBodyText){
    refLines.push("Body: "+c._emailBodyText.slice(0,200));
  }
  if(c._parsedData.forwarding_note){
    refLines.push("Forwarding note: "+c._parsedData.forwarding_note);
  }
  refSection.innerHTML=refLines.map(l=>`<div style="margin-bottom:2px">${l.replace(/</g,"&lt;")}</div>`).join("");

  const btnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto auto",gap:"8px",marginTop:"4px"}});
  btnRow.append(h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:()=>{
    c.date=mDate.value;c.description=mDesc.value;c.amount_usd=parseFloat(mAmt.value);
    c.original_amount=c.amount_usd;c.category_id=mCat.value;
    c.service_start=mSs.value;c.service_end=mSe.value;
    c.payment_type=mPt.value;c.tag=mTag.value;
    const ss=new Date(c.service_start+"T00:00:00"),se=new Date(c.service_end+"T00:00:00");
    c.service_days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
    c._status="approved";
    bg.remove();
    renderEmailReviewTable(reviewContainer,candidates);
  }},"Save & Approve"));
  btnRow.append(h("button",{class:"btn",style:{background:"rgba(224,122,95,0.15)",color:"var(--r)",width:"auto",padding:"12px 20px"},onClick:()=>{
    c._status="skipped";bg.remove();renderEmailReviewTable(reviewContainer,candidates);
  }},"Skip"));
  btnRow.append(h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>bg.remove()},"Cancel"));

  modal.append(mRow(mField("Date",mDate),mField("Description",mDesc)));
  modal.append(mRow(mField("Category",mCat),mField("Amount (USD)",mAmt)));
  modal.append(mRow(mField("Service Start",mSs),emSeField));
  modal.append(mRow(mField("Payment Account",mPt),mField("Tag",mTag)));
  modal.append(emPreviewEl);
  modal.append(refSection);
  modal.append(btnRow);
  bg.append(modal);
  document.body.append(bg);
}


function openPayslipEditModal(candidates,idx,reviewContainer,skippedPages){
  const c=candidates[idx];
  let seManual=false;
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal"});

  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
  const hdrLeft=h("div");
  hdrLeft.append(h("h3",{style:{margin:"0"}},"Edit Payslip Transaction"));
  hdrLeft.append(h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",marginTop:"4px"}},c._group||""));
  const closeBtn3=h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715");
  hdr.append(hdrLeft,closeBtn3);
  modal.append(hdr);

  function mRow(...ch){const d=h("div",{style:{display:"grid",gridTemplateColumns:ch.length===3?"1fr 1fr 1fr":ch.length===2?"1fr 1fr":"1fr",gap:"12px",marginBottom:"14px"}});ch.forEach(x=>d.append(x));return d}
  function mField(lbl,inp){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(inp);return d}

  const mDate=h("input",{class:"inp",type:"date",value:c.date,onInput:psUpdatePreview});
  const mDesc=h("input",{class:"inp",type:"text",value:c.description});
  const mAmt=h("input",{class:"inp",type:"number",step:"0.01",value:c.amount_usd,onInput:psUpdatePreview});

  const mCat=h("select",{class:"inp",onChange:()=>{
    if(!seManual){mSs.value=getDefStart(mCat.value,c.date||c.service_start)||mSs.value;mSe.value=getDefEnd(mCat.value,mSs.value)||mSs.value;psUpdateHint()}
    psUpdatePreview();
  }});
  CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===c.category_id)o.selected=true;mCat.append(o)});

  const mSs=h("input",{class:"inp",type:"date",value:c.service_start,onInput:()=>{
    if(!seManual){mSe.value=getDefEnd(mCat.value,mSs.value)||mSs.value}
    psUpdatePreview();
  }});
  const mSe=h("input",{class:"inp",type:"date",value:c.service_end,onInput:()=>{
    seManual=true;mSe.style.borderColor="rgba(242,204,143,0.3)";psUpdatePreview();
  }});
  const psHintSpan=h("span",{style:{color:"rgba(129,178,154,0.6)",textTransform:"none",letterSpacing:"0",fontWeight:"400",fontSize:"10px"}});
  function psUpdateHint(){const r=ACCRUAL_D[mCat.value];psHintSpan.textContent=!seManual&&r?(r==="month"?"(Auto: full month)":`(Auto: ${r} days)`):""}
  psUpdateHint();
  const psSeLbl=h("label",{class:"lbl"});psSeLbl.append("Service End ");psSeLbl.append(psHintSpan);
  const psSeField=h("div");psSeField.append(psSeLbl);psSeField.append(mSe);

  const mPt=h("select",{class:"inp"});
  PTS.forEach(p=>{const o=h("option",{value:p},p);if(p===c.payment_type)o.selected=true;mPt.append(o)});
  const mTag=h("input",{class:"inp",type:"text",value:c.tag||""});

  const psPreviewEl=h("div",{class:"preview hidden"});
  function psUpdatePreview(){
    const a=parseFloat(mAmt.value);if(isNaN(a)||!mSs.value||!mSe.value){psPreviewEl.classList.add("hidden");return}
    const ss=new Date(mSs.value+"T00:00:00"),se=new Date(mSe.value+"T00:00:00");
    if(se<ss){psPreviewEl.classList.add("hidden");return}
    const days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    const daily=a/days;
    psPreviewEl.classList.remove("hidden");
    psPreviewEl.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Accrual Preview</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">USD Amount</div><div style="font-size:18px;font-weight:700;color:#fff;font-family:var(--mono)">${fmtF(a)}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Service Days</div><div style="font-size:18px;font-weight:700;color:var(--b);font-family:var(--mono)">${days}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Daily Cost</div><div style="font-size:18px;font-weight:700;color:var(--g);font-family:var(--mono)">${fmtF(daily)}/d</div></div>
    </div>`;
  }
  psUpdatePreview();

  // Payslip page data reference
  const pd=c._pageData;
  const refSection=h("div",{style:{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:"rgba(255,255,255,0.35)"}});
  const refLines=[];
  if(pd){
    refLines.push(`Period: ${fmtD(pd.payPeriodBegin)} \u2013 ${fmtD(pd.payPeriodEnd)}`);
    refLines.push(`Earnings: ${fmtF(pd.earningsTotal)} \u00b7 Taxes: ${fmtF(pd.employeeTaxTotal)}`);
    refLines.push(`Pre-Tax: ${fmtF(pd.preTaxTotal)} \u00b7 Post-Tax: ${fmtF(pd.postTaxTotal)}`);
    if(pd.gtl)refLines.push(`GTL: ${fmtF(pd.gtl)}`);
    if(pd.deferral401k)refLines.push(`401(k) Deferral: ${fmtF(pd.deferral401k)}`);
    if(pd.isRSU)refLines.push("Type: RSU Vesting");
    refLines.push(`Net Pay: ${fmtF(pd.netPay)} \u00b7 Gross Pay: ${fmtF(pd.grossPay)}`);
  }
  refSection.innerHTML=refLines.map(l=>`<div style="margin-bottom:2px">${l}</div>`).join("");

  const btnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto auto",gap:"8px",marginTop:"4px"}});
  btnRow.append(h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:()=>{
    c.date=mDate.value;c.description=mDesc.value;c.amount_usd=parseFloat(mAmt.value);
    c.original_amount=c.amount_usd;c.category_id=mCat.value;
    c.service_start=mSs.value;c.service_end=mSe.value;
    c.payment_type=mPt.value;c.tag=mTag.value;
    const ss=new Date(c.service_start+"T00:00:00"),se=new Date(c.service_end+"T00:00:00");
    c.service_days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
    c._status="approved";
    bg.remove();
    renderPayslipReviewTable(reviewContainer,candidates,skippedPages);
  }},"Save & Approve"));
  btnRow.append(h("button",{class:"btn",style:{background:"rgba(224,122,95,0.15)",color:"var(--r)",width:"auto",padding:"12px 20px"},onClick:()=>{
    c._status="skipped";bg.remove();renderPayslipReviewTable(reviewContainer,candidates,skippedPages);
  }},"Skip"));
  btnRow.append(h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>bg.remove()},"Cancel"));

  modal.append(mRow(mField("Date",mDate),mField("Description",mDesc)));
  modal.append(mRow(mField("Category",mCat),mField("Amount (USD)",mAmt)));
  modal.append(mRow(mField("Service Start",mSs),psSeField));
  modal.append(mRow(mField("Payment Account",mPt),mField("Tag",mTag)));
  modal.append(psPreviewEl);
  modal.append(refSection);
  modal.append(btnRow);
  bg.append(modal);
  document.body.append(bg);
}

async function commitEmailImports(candidates){
  const approved=candidates.filter(c=>c._status==="approved");
  if(!approved.length)throw new Error("No approved transactions to save.");
  const valid=approved.filter(c=>c.date&&c.service_start&&c.service_end);
  if(valid.length<approved.length)console.warn(`commitEmailImports: dropped ${approved.length-valid.length} rows with missing dates`);
  if(!valid.length)throw new Error("All approved transactions have invalid dates.");
  const batchId="email-"+new Date().toISOString().slice(0,16);
  const rows=valid.map(c=>({
    date:c.date,service_start:c.service_start,service_end:c.service_end,
    description:c.description,category_id:c.category_id,
    original_amount:c.original_amount||c.amount_usd,currency:c.currency||"USD",fx_rate:c.fx_rate||1,
    amount_usd:Math.round(c.amount_usd*100)/100,
    payment_type:c.payment_type,tag:(c.tag||"").toLowerCase().trim(),
    daily_cost:c.daily_cost,service_days:c.service_days,credit:c.credit||"",
    import_batch:batchId
  }));
  const uniqueTags=[...new Set(rows.map(r=>r.tag).filter(Boolean))];
  for(const t of uniqueTags)await ensureTagExists(t);
  const created=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(rows)});
  const now=new Date().toISOString();
  for(const c of valid){
    const wasEdited=!!(c.category_id!==c.ai_category||c.description!==c.ai_description);
    await sb(`pending_imports?id=eq.${c._id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:"committed",committed_at:now,final_category_id:c.category_id,final_description:c.description,was_edited:wasEdited})});
  }
  state.txnCount+=rows.length;
  document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
  valid.forEach(c=>c._status="committed");
  const banner=document.getElementById("emailImportBanner");
  if(banner)banner.remove();
  state.pendingEmails=0;
  // Trigger reimbursement auto-linking for newly committed Venmo reimbursements
  const newReimb=valid.filter(c=>c.amount_usd<0&&c.payment_type==="Venmo");
  if(newReimb.length)setTimeout(()=>scanForReimbursementLinks().catch(e=>console.error("Post-commit link scan:",e)),1000);
  // Auto-link Rakuten cashback to parent purchases and create cashback_redemptions
  const rakutenCB=valid.filter(c=>c._parsedData?.type==="cashback_earned"&&c._parsedData?.store_name);
  if(rakutenCB.length&&created?.length)setTimeout(()=>linkRakutenCashback(rakutenCB,valid,created).catch(e=>console.error("Rakuten cashback link:",e)),1000);
  return{
    count:valid.length,
    imported:valid,
    skipped:candidates.filter(c=>c._status==="skipped").length,
    dupes:candidates.filter(c=>c._isDuplicate).length,
    batchId,
    pendingIds:valid.map(c=>c._id)
  };
}


async function commitPayslipImport(candidates){
  const approved=candidates.filter(c=>c._status==="approved");
  if(!approved.length)throw new Error("No approved transactions to save.");
  const valid=approved.filter(c=>c.date&&c.service_start&&c.service_end);
  if(valid.length<approved.length)console.warn(`commitPayslipImport: dropped ${approved.length-valid.length} rows with missing dates`);
  if(!valid.length)throw new Error("All approved transactions have invalid dates.");
  const batchId="payslip-"+new Date().toISOString().slice(0,16);
  const rows=valid.map(c=>({
    date:c.date,service_start:c.service_start,service_end:c.service_end,
    description:c.description,category_id:c.category_id,
    original_amount:c.amount_usd,currency:"USD",fx_rate:1,
    amount_usd:Math.round(c.amount_usd*100)/100,
    payment_type:c.payment_type,tag:(c.tag||"").toLowerCase().trim(),
    daily_cost:c.daily_cost,service_days:c.service_days,credit:c.credit||"",
    import_batch:batchId
  }));
  const uniqueTags=[...new Set(rows.map(r=>r.tag).filter(Boolean))];
  for(const t of uniqueTags)await ensureTagExists(t);
  const created=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(rows)});
  // Auto-link payslip groups by _group
  const groupMap={};
  valid.forEach((c,i)=>{if(c._group&&created[i]){if(!groupMap[c._group])groupMap[c._group]=[];groupMap[c._group].push(created[i].id)}});
  for(const ids of Object.values(groupMap)){
    if(ids.length<2)continue;
    const gid=Math.min(...ids);
    await sb(`transactions?id=in.(${ids.join(",")})`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:gid})});
  }
  state.txnCount+=rows.length;
  document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
  valid.forEach(c=>c._status="committed");
  // Auto-link Connectivity Reimbursement Fund to AT&T internet charge in same calendar month
  const connIndices=valid.map((c,i)=>c._source==="connectivity_reimb"?i:-1).filter(i=>i>=0);
  for(const ci of connIndices){
    if(!created[ci])continue;
    const ss=valid[ci].service_start;
    const monthStart=ss.slice(0,8)+"01";
    const lastDay=new Date(new Date(monthStart+"T12:00:00Z").setMonth(new Date(monthStart+"T12:00:00Z").getMonth()+1,0));
    const monthEnd=lastDay.toISOString().slice(0,10);
    try{
      const [attMatches,connFresh]=await Promise.all([
        sb(`transactions?description=ilike.*AT%26T*&service_start=eq.${monthStart}&service_end=eq.${monthEnd}&category_id=eq.utilities&amount_usd=gt.0&select=id,transaction_group_id,description&limit=1`),
        sb(`transactions?id=eq.${created[ci].id}&select=id,transaction_group_id&limit=1`)
      ]);
      if(attMatches.length&&connFresh.length){
        // Stretch service period to match AT&T's full month, then link
        const connAmt=valid[ci].amount_usd;
        const sd=Math.round((new Date(monthEnd+"T12:00:00Z")-new Date(monthStart+"T12:00:00Z"))/864e5)+1;
        await sb(`transactions?id=eq.${connFresh[0].id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({service_start:monthStart,service_end:monthEnd,service_days:sd,daily_cost:Math.round(connAmt/sd*10000)/10000})});
        await linkToGroup(connFresh[0],attMatches[0]);
        console.log(`Connectivity: auto-linked to "${attMatches[0].description}" (${monthStart}–${monthEnd})`);
      }else{
        console.log(`Connectivity: no AT&T charge found for ${monthStart}–${monthEnd}, left unlinked`);
      }
    }catch(e){console.error("Connectivity auto-link:",e)}
  }
  return{
    count:valid.length,
    imported:valid,
    skipped:candidates.filter(c=>c._status==="skipped").length,
    dupes:candidates.filter(c=>c._isDuplicate).length,
    batchId
  };
}
