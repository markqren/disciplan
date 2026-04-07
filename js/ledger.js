function openLedgerEditModal(txn,onSaved){
  const _orig=onSaved;
  const _onSaved=()=>{dcInvalidateTxns();if(_orig)_orig()};
  onSaved=_onSaved;
  let seManual=false;
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal"});

  // Header
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
  const hdrLeft=h("div");
  hdrLeft.append(h("h3",{style:{margin:"0"}},"Edit Transaction"));
  if(txn.bank_description)hdrLeft.append(h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",marginTop:"4px"}},"Bank: "+txn.bank_description));
  const closeBtn=h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715");
  hdr.append(hdrLeft,closeBtn);
  modal.append(hdr);

  function mRow(...ch){const d=h("div",{style:{display:"grid",gridTemplateColumns:ch.length===3?"1fr 1fr 1fr":ch.length===2?"1fr 1fr":"1fr",gap:"12px",marginBottom:"14px"}});ch.forEach(x=>d.append(x));return d}
  function mField(lbl,inp){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(inp);return d}

  const mDate=h("input",{class:"inp",type:"date",value:txn.date,onInput:updatePreview});
  const mDesc=h("input",{class:"inp",type:"text",value:txn.description||""});
  const initCur=txn.currency||"USD";
  const initAmtVal=initCur!=="USD"&&txn.original_amount!=null?txn.original_amount:txn.amount_usd;
  const mAmt=h("input",{class:"inp",type:"number",step:"0.01",value:initAmtVal,onInput:updatePreview});
  const mCur=h("select",{class:"inp",style:{width:"80px"},onChange:()=>{
    const isUsd=mCur.value==="USD";
    mFxRow.style.display=isUsd?"none":"grid";
    if(!isUsd&&!mFx.value)mFx.value=DFX[mCur.value]||1;
    updatePreview();
  }});
  CURS.forEach(c=>{const o=h("option",{value:c},c);if(c===initCur)o.selected=true;mCur.append(o)});
  const mFx=h("input",{class:"inp",type:"number",step:"0.0001",value:txn.fx_rate&&initCur!=="USD"?txn.fx_rate:(DFX[initCur]||1),onInput:updatePreview});
  const mFxRow=h("div",{style:{display:initCur==="USD"?"none":"grid",gridTemplateColumns:"1fr",gap:"12px",marginBottom:"14px"}});
  mFxRow.append(mField("FX Rate (→ USD)",mFx));

  const mCat=h("select",{class:"inp",onChange:()=>{
    if(!seManual){mSs.value=getDefStart(mCat.value,txn.date)||mSs.value;mSe.value=getDefEnd(mCat.value,mSs.value)||mSs.value;updateHint()}
    updatePreview();
  }});
  CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===txn.category_id)o.selected=true;mCat.append(o)});

  const mSs=h("input",{class:"inp",type:"date",value:txn.service_start,onInput:()=>{
    if(!seManual){mSe.value=getDefEnd(mCat.value,mSs.value)||mSs.value}
    updatePreview();
  }});
  const mSe=h("input",{class:"inp",type:"date",value:txn.service_end,onInput:()=>{
    seManual=true;mSe.style.borderColor="rgba(242,204,143,0.3)";updatePreview();
  }});
  const hintSpan=h("span",{style:{color:"rgba(129,178,154,0.6)",textTransform:"none",letterSpacing:"0",fontWeight:"400",fontSize:"10px"}});
  function updateHint(){const r=ACCRUAL_D[mCat.value];hintSpan.textContent=!seManual&&r?(r==="month"?"(Auto: full month)":`(Auto: ${r} days)`):""}
  updateHint();
  const seLbl=h("label",{class:"lbl"});seLbl.append("Service End ");seLbl.append(hintSpan);
  const seField=h("div");seField.append(seLbl);seField.append(mSe);

  const mCredit=buildCreditSelect(txn.credit||"");
  const mCreditRow=h("div",{style:{display:txn.payment_type==="Transfer"?"grid":"none",gridTemplateColumns:"1fr 2fr",gap:"6px",marginBottom:"14px"}});
  mCreditRow.append(mField("Credit Sub-Account",mCredit));
  const mPt=h("select",{class:"inp",onChange:()=>{mCreditRow.style.display=mPt.value==="Transfer"?"grid":"none"}});
  if(txn.payment_type&&!PTS.includes(txn.payment_type))mPt.append(h("option",{value:txn.payment_type,selected:true},txn.payment_type));
  PTS.forEach(p=>{const o=h("option",{value:p},p);if(p===txn.payment_type)o.selected=true;mPt.append(o)});
  const mTag=h("input",{class:"inp",type:"text",value:txn.tag||""});

  // Accrual preview
  const previewEl=h("div",{class:"preview hidden"});
  function updatePreview(){
    const a=parseFloat(mAmt.value);if(isNaN(a)||!mSs.value||!mSe.value){previewEl.classList.add("hidden");return}
    const ss=new Date(mSs.value+"T00:00:00"),se=new Date(mSe.value+"T00:00:00");
    if(se<ss){previewEl.classList.add("hidden");return}
    const days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    const cur=mCur.value;
    const fx=cur==="USD"?1:(parseFloat(mFx.value)||DFX[cur]||1);
    const usd=cur==="USD"?a:a*fx;
    const daily=usd/days;
    previewEl.classList.remove("hidden");
    const cols=cur==="USD"?3:4;
    previewEl.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Accrual Preview</div>
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px">
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">USD Amount</div><div style="font-size:18px;font-weight:700;color:#fff;font-family:var(--mono)">${fmtF(usd)}</div></div>
      ${cur!=="USD"?`<div><div style="font-size:10px;color:rgba(255,255,255,0.25)">FX Rate</div><div style="font-size:18px;font-weight:700;color:rgba(255,255,255,0.5);font-family:var(--mono)">${fx}</div></div>`:""}
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Service Days</div><div style="font-size:18px;font-weight:700;color:var(--b);font-family:var(--mono)">${days}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Daily Cost</div><div style="font-size:18px;font-weight:700;color:var(--g);font-family:var(--mono)">${fmtF(daily)}/d</div></div>
    </div>`;
  }
  updatePreview();

  // Action buttons
  const isReimbursable=txn.amount_usd>0&&!["income","investment","financial","adjustment"].includes(txn.category_id);
  const isCashbackable=txn.amount_usd>0&&!["income","investment","adjustment"].includes(txn.category_id);
  const extraBtns=(isReimbursable?1:0)+(isCashbackable?1:0);
  const btnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr"+(" auto".repeat(extraBtns+2)),gap:"8px",marginTop:"4px"}});
  const mSave=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
    mSave.textContent="Saving...";mSave.disabled=true;
    const ss=new Date(mSs.value+"T00:00:00"),se=new Date(mSe.value+"T00:00:00");
    const sdays=Math.max(1,Math.floor((se-ss)/864e5)+1);
    const cur=mCur.value;
    const fx=cur==="USD"?1:(parseFloat(mFx.value)||DFX[cur]||1);
    const orig=Math.round(parseFloat(mAmt.value)*100)/100;
    const amt=cur==="USD"?orig:Math.round(orig*fx*100)/100;
    const dc=Math.round(amt/sdays*1e6)/1e6;
    const tagVal=(mTag.value||"").toLowerCase().trim();
    const prev={date:txn.date,description:txn.description,category_id:txn.category_id,
      amount_usd:txn.amount_usd,original_amount:txn.original_amount,
      currency:txn.currency,fx_rate:txn.fx_rate,
      service_start:txn.service_start,service_end:txn.service_end,
      service_days:txn.service_days,daily_cost:txn.daily_cost,
      payment_type:txn.payment_type,tag:txn.tag,is_subscription:txn.is_subscription||false,credit:txn.credit||""};
    try{
      if(tagVal)await ensureTagExists(tagVal);
      await sb(`transactions?id=eq.${txn.id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({
        date:mDate.value,description:mDesc.value,category_id:mCat.value,
        amount_usd:amt,original_amount:orig,currency:cur,fx_rate:fx,
        service_start:mSs.value,service_end:mSe.value,
        service_days:sdays,daily_cost:dc,
        payment_type:mPt.value,tag:tagVal,
        is_subscription:mSubChk.checked,
        credit:mPt.value==="Transfer"?mCredit.getValue():""
      })});
      // Prompt to update linked transactions' service dates
      const datesChanged=mSs.value!==txn.service_start||mSe.value!==txn.service_end;
      if(datesChanged&&txn.transaction_group_id){
        const others=await sb(`transactions?transaction_group_id=eq.${txn.transaction_group_id}&id=neq.${txn.id}&select=id,description,amount_usd,service_start,service_end,service_days,daily_cost`);
        if(others.length&&confirm(`Update service dates for ${others.length} other linked transaction${others.length>1?"s":""}?\n\n${others.map(o=>o.description+" ("+fmtF(o.amount_usd)+")").join("\n")}\n\n→ ${mSs.value} to ${mSe.value}`)){
          for(const o of others){
            const oDc=Math.round(o.amount_usd/sdays*1e6)/1e6;
            await sb(`transactions?id=eq.${o.id}`,{method:"PATCH",body:JSON.stringify({service_start:mSs.value,service_end:mSe.value,service_days:sdays,daily_cost:oDc})});
          }
        }
      }
      bg.remove();
      showUndo("\u2713 Edited: "+txn.description,async()=>{
        await sb(`transactions?id=eq.${txn.id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(prev)});
        onSaved();
      });
      onSaved();
    }catch(e){alert("Save failed: "+e.message);mSave.textContent="Save";mSave.disabled=false}
  }},"Save");

  let delTimer=null;
  const mDel=h("button",{class:"btn",style:{background:"rgba(224,122,95,0.15)",color:"var(--r)",width:"auto",padding:"12px 20px"},onClick:async()=>{
    if(mDel.dataset.confirm!=="1"){
      mDel.dataset.confirm="1";mDel.textContent="Confirm Delete";
      delTimer=setTimeout(()=>{mDel.dataset.confirm="0";mDel.textContent="Delete"},3000);
      return;
    }
    if(delTimer)clearTimeout(delTimer);
    mDel.textContent="Deleting...";mDel.disabled=true;
    const txnCopy={...txn};delete txnCopy.id;
    try{
      await sb(`transactions?id=eq.${txn.id}`,{method:"DELETE",headers:{"Prefer":"return=representation"}});
      state.txnCount--;
      document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
      bg.remove();
      showUndo("\u2713 Deleted: "+txn.description,async()=>{
        await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({id:txn.id,...txnCopy})});
        state.txnCount++;document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
        onSaved();
      });
      onSaved();
    }catch(e){alert("Delete failed: "+e.message);mDel.textContent="Delete";mDel.disabled=false;mDel.dataset.confirm="0"}
  }},"Delete");

  const mCancel=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>bg.remove()},"Cancel");

  // Reimburse button (only for reimbursable expenses)
  const mReimb=isReimbursable?h("button",{class:"btn",style:{background:"rgba(74,111,165,0.2)",color:"var(--b)",width:"auto",padding:"12px 20px"},onClick:()=>showReimburseForm()},"\uD83D\uDCB8 Reimburse"):null;

  // Cashback button (FEA-14)
  const mCashback=isCashbackable?h("button",{class:"btn",style:{background:"rgba(242,204,143,0.15)",color:"#F2CC8F",width:"auto",padding:"12px 20px"},onClick:()=>showCashbackForm()},"\uD83C\uDFC6 Cashback"):null;

  function showReimburseForm(){
    // Save edit form content and replace with reimburse form
    const editContent=Array.from(modal.children);
    modal.innerHTML="";
    let selectedPerson="",selectedRatio=0.5,manualMode=false,manualAmt=0;

    // Header
    const rHdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
    const rHdrLeft=h("div");
    rHdrLeft.append(h("h3",{style:{margin:"0"}},"\uD83D\uDCB8 Reimburse"));
    rHdrLeft.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.5)",marginTop:"4px"}},`${txn.description} \u00B7 ${fmtF(txn.amount_usd)}`));
    const rClose=h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715");
    rHdr.append(rHdrLeft,rClose);
    modal.append(rHdr);

    // Person selection
    const personWrap=h("div",{style:{marginBottom:"14px"}});
    personWrap.append(h("label",{class:"lbl"},"Person"));
    const personSelect=h("select",{class:"inp",onChange:()=>{selectedPerson=personSelect.value;if(personSelect.value)personFree.value="";updateRPreview()}});
    personSelect.append(h("option",{value:""},"Loading..."));
    personSelect.disabled=true;
    const personFree=h("input",{class:"inp",type:"text",placeholder:"or type a name",style:{marginTop:"6px"},onInput:()=>{selectedPerson=personFree.value.trim();if(selectedPerson)personSelect.value="";updateRPreview()}});
    personWrap.append(personSelect,personFree);
    modal.append(personWrap);

    // Load friends async
    fetchReimburseFriends().then(friends=>{
      personSelect.innerHTML="";
      if(friends.length){
        personSelect.append(h("option",{value:""},"Select a person..."));
        friends.forEach(name=>{personSelect.append(h("option",{value:name},name))});
        personSelect.disabled=false;
      }else{
        personSelect.classList.add("hidden");
      }
    }).catch(()=>{personSelect.classList.add("hidden")});

    // Split presets
    const splitWrap=h("div",{style:{marginBottom:"14px"}});
    splitWrap.append(h("label",{class:"lbl"},"Split"));
    const splitBtns=h("div",{style:{display:"flex",gap:"6px",flexWrap:"wrap"}});
    const customWrap=h("div",{class:"hidden",style:{marginTop:"6px"}});
    const customInp=h("input",{class:"inp",type:"text",placeholder:"e.g. 40% or $60",style:{width:"140px"},onInput:()=>{
      const v=customInp.value.trim();
      if(v.startsWith("$")){const d=parseFloat(v.slice(1));if(!isNaN(d)&&d>0){selectedRatio=d/txn.amount_usd}}
      else{const p=parseFloat(v.replace("%",""));if(!isNaN(p)&&p>0){selectedRatio=p/100}}
      updateRPreview();
    }});
    customWrap.append(customInp);
    const manualWrap=h("div",{class:"hidden",style:{marginTop:"6px"}});
    const manualInp=h("input",{class:"inp",type:"number",step:"0.01",placeholder:"e.g. 150.00",style:{width:"140px"},onInput:()=>{
      manualAmt=parseFloat(manualInp.value)||0;
      updateRPreview();
    }});
    manualWrap.append(manualInp);

    SPLIT_PRESETS.forEach(sp=>{
      const b=h("button",{class:"pg-btn",style:{padding:"6px 14px",fontSize:"11px",border:"1px solid rgba(255,255,255,0.1)"},onClick:()=>{
        splitBtns.querySelectorAll("button").forEach(x=>{x.style.background="";x.style.borderColor="rgba(255,255,255,0.1)"});
        b.style.background="rgba(74,111,165,0.3)";b.style.borderColor="var(--b)";
        if(sp.value==="manual"){manualMode=true;customWrap.classList.add("hidden");manualWrap.classList.remove("hidden");manualInp.focus()}
        else if(sp.value!==null){manualMode=false;selectedRatio=sp.value;customWrap.classList.add("hidden");manualWrap.classList.add("hidden")}
        else{manualMode=false;customWrap.classList.remove("hidden");manualWrap.classList.add("hidden");customInp.focus()}
        updateRPreview();
      }},sp.label);
      if(sp.value===0.5){b.style.background="rgba(74,111,165,0.3)";b.style.borderColor="var(--b)"}
      splitBtns.append(b);
    });
    splitWrap.append(splitBtns,customWrap,manualWrap);
    modal.append(splitWrap);

    // Amount display
    const amtDisplay=h("div",{style:{marginBottom:"14px"}});
    amtDisplay.append(h("label",{class:"lbl"},"Reimbursement Amount"));
    const amtVal=h("div",{style:{fontSize:"20px",fontWeight:"700",color:"var(--g)",fontFamily:"var(--mono)"}});
    amtDisplay.append(amtVal);
    modal.append(amtDisplay);

    // Payment method
    const rPt=h("select",{class:"inp",onChange:()=>updateRPreview()});
    PTS.forEach(p=>{const o=h("option",{value:p},p);if(p==="Venmo")o.selected=true;rPt.append(o)});
    modal.append(mRow(mField("Payment Method",rPt)));

    // Note
    const rNote=h("input",{class:"inp",type:"text",placeholder:"optional context"});
    modal.append(mRow(mField("Note",rNote)));

    // Preview
    const rPreview=h("div",{class:"preview",style:{marginBottom:"14px"}});
    modal.append(rPreview);

    // Validation error
    const errEl=h("div",{style:{color:"var(--r)",fontSize:"11px",marginBottom:"8px",minHeight:"16px"}});
    modal.append(errEl);

    function updateRPreview(){
      const amt=manualMode?Math.round(manualAmt*100)/100:Math.round(txn.amount_usd*selectedRatio*100)/100;
      amtVal.textContent=fmtF(-amt);
      const pName=selectedPerson||"___";
      const firstName=pName.split(" ")[0];
      const desc=`Reimbursed - ${txn.description} - ${firstName}`;
      rPreview.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Preview</div>
        <div style="margin-bottom:4px;color:#fff;font-weight:600">${desc}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.5)">${fmtF(-amt)} \u00B7 ${rPt.value} \u00B7 ${txn.category_id}</div>
        <div style="font-size:11px;color:rgba(74,111,165,0.7);margin-top:4px">\uD83D\uDD17 Linked to: ${txn.description}</div>`;
    }
    updateRPreview();

    // Action buttons
    const rBtnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto",gap:"8px",marginTop:"4px"}});
    const rCreate=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
      // Validate
      const person=selectedPerson.trim();
      if(!person){errEl.textContent="Please select or type a person name.";return}
      const reimbAmt=manualMode?Math.round(manualAmt*100)/100:Math.round(txn.amount_usd*selectedRatio*100)/100;
      if(reimbAmt<=0){errEl.textContent="Reimbursement amount must be greater than $0.";return}
      errEl.textContent="";
      rCreate.textContent="Creating...";rCreate.disabled=true;
      const effectiveRatio=manualMode?manualAmt/txn.amount_usd:selectedRatio;
      try{
        await createReimbursement(txn,person,effectiveRatio,rPt.value,rNote.value);
        bg.remove();
        const msg=document.getElementById("ledgerOkMsg");
        if(msg){msg.textContent="Reimbursement created";msg.classList.remove("hidden");setTimeout(()=>msg.classList.add("hidden"),2500)}
        document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
        onSaved();
      }catch(e){alert("Failed: "+e.message);rCreate.textContent="Create Reimbursement";rCreate.disabled=false}
    }},"Create Reimbursement");
    const rBack=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>{
      modal.innerHTML="";
      editContent.forEach(c=>modal.append(c));
    }},"Back");
    rBtnRow.append(rCreate,rBack);
    modal.append(rBtnRow);
  }

  // Cashback form (FEA-14)
  function showCashbackForm(){
    const editContent=Array.from(modal.children);
    modal.innerHTML="";
    let cbType="Dollar Value";

    const cHdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
    const cHdrLeft=h("div");
    cHdrLeft.append(h("h3",{style:{margin:"0"}},"\uD83C\uDFC6 Cashback"));
    cHdrLeft.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.5)",marginTop:"4px"}},`${txn.description} \u00B7 ${fmtF(txn.amount_usd)}`));
    cHdr.append(cHdrLeft,h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715"));
    modal.append(cHdr);

    // Type selector
    const typeWrap=h("div",{style:{marginBottom:"14px"}});
    typeWrap.append(h("label",{class:"lbl"},"Cashback Type"));
    const typeSelect=h("select",{class:"inp",onChange:()=>{cbType=typeSelect.value;ptsFields.style.display=cbType==="Points"?"grid":"none";updateCPreview()}});
    typeSelect.append(h("option",{value:"Dollar Value"},"Dollar Value"));
    typeSelect.append(h("option",{value:"Points"},"Points"));
    typeWrap.append(typeSelect);
    modal.append(typeWrap);

    // Dollar value input
    const dvWrap=h("div",{style:{marginBottom:"14px"}});
    dvWrap.append(h("label",{class:"lbl"},"Dollar Value"));
    const dvInp=h("input",{class:"inp",type:"number",step:"0.01",placeholder:"e.g. 10.00",onInput:updateCPreview});
    dvWrap.append(dvInp);
    modal.append(dvWrap);

    // Points fields (hidden by default)
    const ptsFields=h("div",{style:{display:"none",gridTemplateColumns:"1fr 1fr",gap:"12px",marginBottom:"14px"}});
    const ptsAmtWrap=h("div");ptsAmtWrap.append(h("label",{class:"lbl"},"Points Redeemed"));
    const ptsAmtInp=h("input",{class:"inp",type:"number",placeholder:"e.g. 30000",onInput:()=>{
      const pts=parseFloat(ptsAmtInp.value)||0;const rate=parseFloat(ptsRateInp.value)||0;
      if(pts>0&&rate>0)dvInp.value=(pts*rate/100).toFixed(2);
      updateCPreview();
    }});
    ptsAmtWrap.append(ptsAmtInp);ptsFields.append(ptsAmtWrap);
    const ptsRateWrap=h("div");ptsRateWrap.append(h("label",{class:"lbl"},"Rate (\u00A2/pt)"));
    const ptsRateInp=h("input",{class:"inp",type:"number",step:"0.01",placeholder:"e.g. 1.63",onInput:()=>{
      const pts=parseFloat(ptsAmtInp.value)||0;const rate=parseFloat(ptsRateInp.value)||0;
      if(pts>0&&rate>0)dvInp.value=(pts*rate/100).toFixed(2);
      updateCPreview();
    }});
    ptsRateWrap.append(ptsRateInp);ptsFields.append(ptsRateWrap);
    modal.append(ptsFields);

    // Description
    const descWrap=h("div",{style:{marginBottom:"14px"}});
    descWrap.append(h("label",{class:"lbl"},"Description"));
    const cDesc=h("input",{class:"inp",type:"text",value:"Cashback - "+txn.description});
    descWrap.append(cDesc);
    modal.append(descWrap);

    // Preview
    const cPreview=h("div",{class:"preview",style:{marginBottom:"14px"}});
    modal.append(cPreview);

    const errEl=h("div",{style:{color:"var(--r)",fontSize:"11px",marginBottom:"8px",minHeight:"16px"}});
    modal.append(errEl);

    function updateCPreview(){
      const dv=parseFloat(dvInp.value)||0;
      const desc=cDesc.value||"Cashback";
      cPreview.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Preview</div>
        <div style="margin-bottom:4px;color:#fff;font-weight:600">${desc}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.5)">${fmtF(-dv)} \u00B7 ${txn.payment_type} \u00B7 income</div>
        <div style="font-size:11px;color:rgba(242,204,143,0.7);margin-top:4px">\uD83C\uDFC6 Cashback record: ${fmtF(dv)} ${cbType==="Points"?"("+((parseFloat(ptsAmtInp.value)||0).toLocaleString())+" pts)":""}</div>`;
    }
    updateCPreview();

    const cBtnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto",gap:"8px",marginTop:"4px"}});
    const cCreate=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
      const dv=parseFloat(dvInp.value);
      if(!dv||dv<=0){errEl.textContent="Dollar value must be greater than $0.";return}
      errEl.textContent="";
      cCreate.textContent="Creating...";cCreate.disabled=true;

      try{
        // 1. Create negative income transaction (same pattern as reimbursement)
        const ss=txn.service_start||txn.date;
        const se=txn.service_end||txn.date;
        const serviceDays=Math.max(1,Math.round((new Date(se)-new Date(ss))/864e5)+1);
        const amt=-Math.abs(dv);
        const dc=Math.round(amt/serviceDays*1e6)/1e6;
        const newTxn={
          date:txn.date,service_start:ss,service_end:se,
          description:cDesc.value||"Cashback - "+txn.description,
          category_id:"income",original_amount:amt,currency:"USD",fx_rate:1,
          amount_usd:amt,payment_type:txn.payment_type,
          tag:(txn.tag||"").toLowerCase().trim(),
          daily_cost:dc,service_days:serviceDays,credit:""
        };
        const result=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(newTxn)});
        const newId=result[0]?.id;

        // Link to original transaction
        if(newId){
          const newTxnObj={id:newId,transaction_group_id:null};
          await linkToGroup(txn,newTxnObj);
        }
        state.txnCount++;

        // 2. Create cashback_redemptions record
        const redemptionAmount=cbType==="Points"?(parseFloat(ptsAmtInp.value)||dv):dv;
        const rate=cbType==="Points"?(parseFloat(ptsRateInp.value)||1)/100:1;
        await sb("cashback_redemptions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
          date:txn.date,item:cDesc.value||"Cashback - "+txn.description,
          redemption_amount:redemptionAmount,payment_type:txn.payment_type,
          cashback_type:cbType,redemption_rate:rate,dollar_value:dv,
          transaction_id:newId||null
        })});

        bg.remove();
        showUndo("\u2713 Cashback: "+fmtF(dv),async()=>{
          // Undo: delete both the transaction and cashback record
          if(newId){
            await sb(`transactions?id=eq.${newId}`,{method:"DELETE"});
            state.txnCount--;
          }
          await sb(`cashback_redemptions?transaction_id=eq.${newId}`,{method:"DELETE"});
          onSaved();
        });
        document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
        onSaved();
      }catch(e){alert("Failed: "+e.message);cCreate.textContent="Create Cashback";cCreate.disabled=false}
    }},"Create Cashback");
    const cBack=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>{
      modal.innerHTML="";editContent.forEach(c=>modal.append(c));
    }},"Back");
    cBtnRow.append(cCreate,cBack);
    modal.append(cBtnRow);
  }

  btnRow.append(mSave);
  if(mReimb)btnRow.append(mReimb);
  if(mCashback)btnRow.append(mCashback);
  btnRow.append(mDel,mCancel);

  modal.append(mRow(mField("Date",mDate),mField("Description",mDesc)));
  const amtWithCur=h("div",{style:{display:"grid",gridTemplateColumns:"1fr 80px",gap:"6px"}});
  amtWithCur.append(mAmt,mCur);
  modal.append(mRow(mField("Category",mCat),mField("Amount",amtWithCur)));
  modal.append(mFxRow);
  modal.append(mRow(mField("Service Start",mSs),seField));
  const mSubChk=h("input",{type:"checkbox",style:{accentColor:"var(--g)",cursor:"pointer"}});
  if(txn.is_subscription)mSubChk.checked=true;
  const mSubLabel=h("label",{style:{display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:"rgba(255,255,255,0.6)",cursor:"pointer"}});
  mSubLabel.append(mSubChk,document.createTextNode("Subscription"));
  const mSubWrap=h("div",{style:{display:"flex",alignItems:"flex-end",paddingBottom:"4px"}});
  mSubWrap.append(mSubLabel);
  modal.append(mRow(mField("Payment Account",mPt),mField("Tag",mTag),mSubWrap));
  modal.append(mCreditRow);
  modal.append(previewEl);

  // Linked transaction section
  const linkSection=h("div",{style:{background:"rgba(74,111,165,0.08)",border:"1px solid rgba(74,111,165,0.2)",borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px"}});
  const linkHeader=h("div",{style:{color:"rgba(255,255,255,0.4)",fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:"6px"}});
  const linkBody=h("div");
  linkSection.append(linkHeader,linkBody);

  function buildLinkSearchUI(container,onLinked){
    const lsWrap=h("div");
    const lsRow=h("div",{style:{display:"flex",gap:"6px",marginBottom:"8px"}});
    const lsInput=h("input",{class:"inp",type:"text",placeholder:"Search description...",style:{flex:"1",fontSize:"11px",padding:"5px 8px"}});
    const lsBtn=h("button",{class:"pg-btn",style:{fontSize:"10px",padding:"5px 10px"}},"Search");
    lsRow.append(lsInput,lsBtn);lsWrap.append(lsRow);
    const lsResults=h("div",{style:{maxHeight:"200px",overflowY:"auto"}});lsWrap.append(lsResults);
    let selectedLink=null;
    const lsConfirmRow=h("div",{style:{display:"none",marginTop:"8px"}});
    const lsConfirmBtn=h("button",{class:"btn",style:{background:"rgba(74,111,165,0.2)",color:"var(--b)",fontSize:"11px",padding:"6px 12px"}},"Confirm Link");
    lsConfirmRow.append(lsConfirmBtn);lsWrap.append(lsConfirmRow);
    async function doSearch(){
      const q=lsInput.value.trim();if(!q){lsResults.innerHTML="<div style='color:rgba(255,255,255,0.3);padding:8px'>Type a description to search</div>";return}
      lsBtn.textContent="...";lsBtn.disabled=true;selectedLink=null;lsConfirmRow.style.display="none";
      try{
        const rows=await sb(`transactions?description=ilike.*${encodeURIComponent(q)}*&id=neq.${txn.id}&order=date.desc&limit=20&select=id,date,description,amount_usd,category_id,payment_type,transaction_group_id`);
        lsResults.innerHTML="";
        if(!rows.length){lsResults.innerHTML="<div style='color:rgba(255,255,255,0.3);padding:8px'>No transactions found</div>";return}
        rows.forEach(r=>{
          const row=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.04)",borderRadius:"4px"},onClick:()=>{
            lsResults.querySelectorAll("div[data-rid]").forEach(d=>d.style.background="transparent");
            row.style.background="rgba(74,111,165,0.15)";selectedLink=r;lsConfirmRow.style.display="block";
          }});
          row.setAttribute("data-rid",r.id);
          const inGroup=!!r.transaction_group_id;
          row.innerHTML=`<div><div style="color:rgba(255,255,255,0.7)">${r.description}${inGroup?" <span style='font-size:9px;color:rgba(255,255,255,0.3)'>(in group)</span>":""}</div><div style="color:rgba(255,255,255,0.35);font-size:10px">${fmtD(r.date)} · ${r.category_id} · ${r.payment_type||""}</div></div><div style="font-family:var(--mono);color:rgba(255,255,255,0.6);white-space:nowrap;margin-left:8px">${fmtF(r.amount_usd)}</div>`;
          lsResults.append(row);
        });
      }catch(e){lsResults.innerHTML=`<div style='color:var(--r);padding:8px'>Error: ${e.message}</div>`}
      finally{lsBtn.textContent="Search";lsBtn.disabled=false}
    }
    lsBtn.addEventListener("click",doSearch);
    lsInput.addEventListener("keydown",e=>{if(e.key==="Enter")doSearch()});
    lsConfirmBtn.addEventListener("click",async()=>{
      if(!selectedLink)return;
      lsConfirmBtn.textContent="Linking...";lsConfirmBtn.disabled=true;
      try{
        await linkToGroup(txn,selectedLink);
        onLinked();
      }catch(e){alert("Link failed: "+e.message);lsConfirmBtn.textContent="Confirm Link";lsConfirmBtn.disabled=false}
    });
    container.append(lsWrap);
  }

  async function renderLinkGroup(){
    linkBody.innerHTML="";
    if(txn.transaction_group_id){
      linkHeader.textContent="";
      const members=await sb(`transactions?transaction_group_id=eq.${txn.transaction_group_id}&select=id,date,description,amount_usd,category_id,payment_type&order=date.asc,id.asc`);
      linkHeader.textContent=`\uD83D\uDD17 Linked Transactions (${members.length})`;
      let netTotal=0;
      members.forEach(m=>{
        netTotal+=m.amount_usd;
        const isThis=m.id===txn.id;
        const row=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 8px",borderRadius:"4px",marginBottom:"2px",cursor:isThis?"default":"pointer",...(isThis?{background:"rgba(74,111,165,0.12)"}:{})},
          ...(isThis?{}:{onClick:async()=>{const full=await sb(`transactions?id=eq.${m.id}&select=*`);if(full.length){bg.remove();openLedgerEditModal(full[0],onSaved)}}})});
        const left=h("div");
        left.innerHTML=`<div style="color:rgba(255,255,255,${isThis?0.9:0.7})">${m.description}${isThis?" <span style='font-size:9px;color:var(--b)'>&larr; this</span>":""}</div><div style="color:rgba(255,255,255,0.35);font-size:10px">${fmtD(m.date)} · ${m.category_id} · ${m.payment_type||""}</div>`;
        row.append(left);
        const right=h("div",{style:{display:"flex",alignItems:"center",gap:"8px"}});
        right.append(h("span",{style:{fontFamily:"var(--mono)",color:m.amount_usd<0?"var(--g)":"rgba(255,255,255,0.6)",whiteSpace:"nowrap"}},fmtF(m.amount_usd)));
        if(!isThis){
          const ub=h("button",{class:"pg-btn",style:{fontSize:"9px",color:"rgba(224,122,95,0.7)",padding:"2px 6px"},onClick:async(e)=>{
            e.stopPropagation();ub.textContent="...";ub.disabled=true;
            try{const gid=txn.transaction_group_id;await unlinkFromGroup(m.id,gid);const remaining=await sb(`transactions?transaction_group_id=eq.${gid}&select=id`);if(!remaining.some(r=>r.id===txn.id))txn.transaction_group_id=null;renderLinkGroup()}
            catch(err){alert("Unlink failed: "+err.message);ub.textContent="Unlink";ub.disabled=false}
          }},"Unlink");
          right.append(ub);
        }
        row.append(right);
        linkBody.append(row);
      });
      // Net amount footer
      const footer=h("div",{style:{borderTop:"1px solid rgba(255,255,255,0.1)",marginTop:"6px",paddingTop:"6px",display:"flex",justifyContent:"space-between",alignItems:"center"}});
      footer.append(h("span",{style:{color:"rgba(255,255,255,0.5)",fontWeight:"600"}},"Net Amount"));
      footer.append(h("span",{style:{fontFamily:"var(--mono)",fontWeight:"600",color:netTotal<0?"var(--g)":"rgba(255,255,255,0.8)"}},fmtF(netTotal)));
      linkBody.append(footer);
      // Link Another button
      const linkMoreWrap=h("div",{style:{marginTop:"8px"}});
      const linkMoreBtn=h("button",{class:"pg-btn",style:{fontSize:"10px",color:"var(--b)"},onClick:()=>{linkMoreBtn.style.display="none";buildLinkSearchUI(linkMoreWrap,renderLinkGroup)}},"+ Link Another Transaction");
      linkMoreWrap.append(linkMoreBtn);
      linkBody.append(linkMoreWrap);
    }else{
      linkHeader.textContent="\uD83D\uDD17 Link to Transaction";
      // Check remaining group after unlink — might have dissolved
      const linkToggle=h("button",{class:"pg-btn",style:{fontSize:"10px",color:"var(--b)"},onClick:()=>{linkToggle.style.display="none";buildLinkSearchUI(linkBody,renderLinkGroup)}},"\uD83D\uDD17 Link to Transaction");
      linkBody.append(linkToggle);
    }
  }
  renderLinkGroup();
  modal.append(linkSection);

  modal.append(btnRow);
  bg.append(modal);
  document.body.append(bg);
}

function openBatchEditModal(txns,onDone){
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal"});
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
  hdr.append(h("h3",{style:{margin:"0"}},`Batch Edit (${txns.length} items)`));
  hdr.append(h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715"));
  modal.append(hdr);
  modal.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.4)",marginBottom:"16px"}},"Only non-empty fields will be applied. Leave blank for no change."));

  function mRow(...ch){const d=h("div",{style:{display:"grid",gridTemplateColumns:ch.length===2?"1fr 1fr":"1fr",gap:"12px",marginBottom:"14px"}});ch.forEach(x=>d.append(x));return d}
  function mField(lbl,inp){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(inp);return d}

  const bCat=h("select",{class:"inp"});
  bCat.append(h("option",{value:""},"— no change —"));
  CATS_LIST.forEach(c=>bCat.append(h("option",{value:c.id},c.l)));

  const bPt=h("select",{class:"inp"});
  bPt.append(h("option",{value:""},"— no change —"));
  PTS.forEach(p=>bPt.append(h("option",{value:p},p)));

  const bTag=h("input",{class:"inp",type:"text",placeholder:"no change"});
  const bTagClear=h("label",{style:{fontSize:"11px",color:"rgba(255,255,255,0.4)",display:"flex",alignItems:"center",gap:"4px",marginTop:"4px"}});
  const bTagClearChk=h("input",{type:"checkbox"});
  bTagClear.append(bTagClearChk,document.createTextNode("Clear tag"));

  const bDate=h("input",{class:"inp",type:"date"});
  const bSs=h("input",{class:"inp",type:"date"});
  const bSe=h("input",{class:"inp",type:"date"});

  modal.append(mRow(mField("Category",bCat),mField("Payment Type",bPt)));
  const tagField=h("div");tagField.append(h("label",{class:"lbl"},"Tag"));tagField.append(bTag);tagField.append(bTagClear);
  modal.append(mRow(tagField,mField("Date",bDate)));
  modal.append(mRow(mField("Service Start",bSs),mField("Service End",bSe)));

  const errEl=h("div",{style:{color:"var(--r)",fontSize:"11px",marginBottom:"8px",minHeight:"16px"}});
  modal.append(errEl);

  const btnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto",gap:"8px",marginTop:"4px"}});
  const saveBtn=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
    saveBtn.textContent="Saving...";saveBtn.disabled=true;errEl.textContent="";
    try{
      const patch={};
      if(bCat.value)patch.category_id=bCat.value;
      if(bPt.value)patch.payment_type=bPt.value;
      if(bDate.value)patch.date=bDate.value;
      const tagVal=bTag.value.trim().toLowerCase();
      if(bTagClearChk.checked)patch.tag="";
      else if(tagVal){await ensureTagExists(tagVal);patch.tag=tagVal}

      const needsRecalc=bSs.value||bSe.value;
      const ids=txns.map(t=>t.id);
      const patchKeys=Object.keys(patch).concat(needsRecalc?["service_start","service_end","service_days","daily_cost"]:[]);
      const prevStates=txns.map(t=>{const p={id:t.id};patchKeys.forEach(k=>{if(t[k]!==undefined)p[k]=t[k]});return p});

      if(needsRecalc){
        for(const t of txns){
          const tPatch={...patch};
          const ss=bSs.value||t.service_start;
          const se=bSe.value||t.service_end;
          tPatch.service_start=ss;tPatch.service_end=se;
          const ssD=new Date(ss+"T00:00:00"),seD=new Date(se+"T00:00:00");
          const days=Math.max(1,Math.floor((seD-ssD)/864e5)+1);
          tPatch.service_days=days;
          tPatch.daily_cost=Math.round(t.amount_usd/days*1e6)/1e6;
          await sb(`transactions?id=eq.${t.id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(tPatch)});
        }
      }else if(Object.keys(patch).length>0){
        await sb(`transactions?id=in.(${ids.join(",")})`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(patch)});
      }else{errEl.textContent="No changes specified.";saveBtn.textContent="Apply Changes";saveBtn.disabled=false;return}

      bg.remove();
      showUndo(`\u2713 Updated ${txns.length} items`,async()=>{
        for(const ps of prevStates){const{id,...fields}=ps;await sb(`transactions?id=eq.${id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(fields)})}
        onDone();
      });
      onDone();
    }catch(e){errEl.textContent="Error: "+e.message;saveBtn.textContent="Apply Changes";saveBtn.disabled=false}
  }},"Apply Changes");
  const cancelBtn=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>bg.remove()},"Cancel");
  btnRow.append(saveBtn,cancelBtn);
  modal.append(btnRow);
  bg.append(modal);
  document.body.append(bg);
}

function openPasteModal(onDone){
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal",style:{maxWidth:"800px"}});
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
  hdr.append(h("h3",{style:{margin:"0"}},"Paste Transactions"));
  hdr.append(h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715"));
  modal.append(hdr);
  modal.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.4)",marginBottom:"12px"}},"Paste TSV rows (from Copy or a spreadsheet). Header row is optional."));

  const ta=h("textarea",{class:"inp",style:{width:"100%",height:"120px",fontFamily:"'JetBrains Mono',monospace",fontSize:"11px",resize:"vertical",boxSizing:"border-box"},placeholder:"Date\tService Start\tService End\tDescription\tCategory\t..."});
  modal.append(ta);

  const previewArea=h("div",{style:{marginTop:"12px"}});
  modal.append(previewArea);

  const btnRow=h("div",{style:{display:"flex",gap:"12px",marginTop:"16px"}});
  let parsed=[];

  // Reverse category map: display name -> category_id
  const catMap={};
  CATS_LIST.forEach(c=>{
    catMap[c.l.toLowerCase()]=c.id;
    // Also map without " (other)" suffix
    const plain=c.l.replace(/\s*\(other\)\s*/i,"").toLowerCase();
    catMap[plain]=c.id;
  });

  const HEADER_COLS=["date","service start","service end","description","category","original amount","currency","amount usd","payment type","credit","tags","daily cost"];

  function parseTSV(text){
    const lines=text.trim().split("\n").filter(l=>l.trim());
    if(!lines.length)return[];
    // Detect header row
    const first=lines[0].split("\t").map(c=>c.trim().toLowerCase());
    const hasHeader=first[0]==="date"&&first.length>=4;
    const dataLines=hasHeader?lines.slice(1):lines;
    return dataLines.map(line=>{
      const cols=line.split("\t");
      // Unquote description (TSV-quoted with "" escaping)
      const rawDesc=(cols[3]||"").trim();
      const desc=rawDesc.startsWith('"')&&rawDesc.endsWith('"')?rawDesc.slice(1,-1).replace(/""/g,'"'):rawDesc;
      const catStr=(cols[4]||"").trim().toLowerCase();
      const catId=catMap[catStr]||"other";
      const date=(cols[0]||"").trim();
      const ss=(cols[1]||"").trim()||date;
      const se=(cols[2]||"").trim()||date;
      const origAmt=parseFloat(cols[5])||0;
      const currency=(cols[6]||"").trim()||"USD";
      const amtUsd=parseFloat(cols[7])||origAmt;
      const pt=(cols[8]||"").trim()||"Chase Sapphire";
      const credit=(cols[9]||"").trim();
      const tag=(cols[10]||"").trim().toLowerCase();
      // Compute service_days and daily_cost
      const d0=new Date(ss),d1=new Date(se);
      const sDays=isNaN(d0)||isNaN(d1)?1:Math.max(1,Math.round((d1-d0)/(864e5))+1);
      const dc=amtUsd/sDays;
      return{date,service_start:ss,service_end:se,description:desc,category_id:catId,
        original_amount:origAmt,currency,amount_usd:Math.round(amtUsd*100)/100,
        payment_type:pt,credit,tag,daily_cost:Math.round(dc*1e6)/1e6,service_days:sDays,_catDisplay:cols[4]||""};
    }).filter(r=>r.date&&r.description&&r.amount_usd);
  }

  function showPreview(){
    previewArea.innerHTML="";
    parsed=parseTSV(ta.value);
    if(!parsed.length){previewArea.append(h("div",{style:{color:"rgba(255,255,255,0.4)",fontSize:"12px"}},"No valid rows found."));importBtn.disabled=true;return}
    previewArea.append(h("div",{style:{fontSize:"12px",marginBottom:"8px"}},`${parsed.length} row${parsed.length>1?"s":""} parsed`));
    const wrap=h("div",{style:{maxHeight:"240px",overflow:"auto"}});
    const tbl=h("table",{class:"tbl",style:{fontSize:"11px"}});
    tbl.innerHTML=`<thead><tr><th>Date</th><th>Description</th><th>Category</th><th style="text-align:right">Amount</th><th>Payment</th><th>Tag</th></tr></thead>`;
    const tbody=h("tbody");
    parsed.forEach(r=>{
      const tr=h("tr");
      tr.innerHTML=`<td>${r.date}</td><td>${r.description.length>40?r.description.slice(0,40)+"...":r.description}</td><td>${r._catDisplay}</td><td style="text-align:right">${fmtT(r.amount_usd)}</td><td>${r.payment_type}</td><td>${r.tag}</td>`;
      tbody.append(tr);
    });
    tbl.append(tbody);
    wrap.append(tbl);
    previewArea.append(wrap);
    importBtn.disabled=false;
    importBtn.textContent=`Import ${parsed.length} row${parsed.length>1?"s":""}`;
  }

  const parseBtn=h("button",{class:"btn",style:{width:"auto",padding:"10px 20px"},onClick:showPreview},"Parse");

  const importBtn=h("button",{class:"btn",style:{width:"auto",padding:"10px 20px",background:"rgba(42,157,143,0.25)"},disabled:true,onClick:async()=>{
    if(!parsed.length)return;
    importBtn.disabled=true;importBtn.textContent="Importing...";
    try{
      const batchId="paste-"+new Date().toISOString().slice(0,16);
      const rows=parsed.map(r=>({
        date:r.date,service_start:r.service_start,service_end:r.service_end,
        description:r.description,category_id:r.category_id,
        original_amount:r.original_amount,currency:r.currency,
        amount_usd:r.amount_usd,payment_type:r.payment_type,
        credit:r.credit,tag:r.tag,daily_cost:r.daily_cost,
        service_days:r.service_days,import_batch:batchId
      }));
      // Ensure tags exist
      const uniqueTags=[...new Set(rows.map(r=>r.tag).filter(Boolean))];
      for(const t of uniqueTags)await ensureTagExists(t);
      await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(rows)});
      state.txnCount+=rows.length;
      document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
      bg.remove();
      showUndo(`\u2713 Pasted ${rows.length} transaction${rows.length>1?"s":""}`,async()=>{
        await sb(`transactions?import_batch=eq.${encodeURIComponent(batchId)}`,{method:"DELETE"});
        state.txnCount-=rows.length;document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
        onDone();
      });
      onDone();
    }catch(e){
      importBtn.disabled=false;importBtn.textContent=`Import ${parsed.length} rows`;
      alert("Paste import failed: "+e.message);
    }
  }},`Import ${parsed.length||0} rows`);

  const cancelBtn=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"10px 20px"},onClick:()=>bg.remove()},"Cancel");
  btnRow.append(parseBtn,importBtn,cancelBtn);
  modal.append(btnRow);
  bg.append(modal);
  document.body.append(bg);
  // Auto-parse if textarea already has content (e.g. from paste event)
  ta.addEventListener("paste",()=>setTimeout(showPreview,50));
}

async function doBatchLink(txns,onDone){
  if(txns.length<2){alert("Select at least 2 transactions to link.");return}
  // Determine target group: use min ID, merge any existing groups
  const existingGroups=new Set(txns.filter(t=>t.transaction_group_id).map(t=>t.transaction_group_id));
  const allIds=txns.map(t=>t.id);
  const targetGroup=Math.min(...allIds,...(existingGroups.size?existingGroups:[]));

  try{
    // Merge any existing groups into target
    for(const gid of existingGroups){
      if(gid!==targetGroup){
        await sb(`transactions?transaction_group_id=eq.${gid}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:targetGroup})});
      }
    }
    // Set all selected to target group
    await sb(`transactions?id=in.(${allIds.join(",")})`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:targetGroup})});
    const msg=document.getElementById("ledgerOkMsg");
    if(msg){msg.textContent=`Linked ${txns.length} items`;msg.classList.remove("hidden");setTimeout(()=>msg.classList.add("hidden"),2500)}
    onDone();
  }catch(e){alert("Batch link failed: "+e.message)}
}

async function renderLedger(el){
  const PS=50;
  if(!state.lf)state.lf={cat:"",pt:"",tag:"",dfrom:"",dto:"",q:"",subsOnly:false};
  if(!_linkScanDone){_linkScanDone=true;scanForReimbursementLinks().catch(e=>console.error("Ledger link scan:",e))}
  const f=state.lf;
  const fS="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px;color:#e8e8e4;font-size:11px;font-family:var(--sans);outline:none";
  // Cache tags for cross-tab navigation + filter dropdown
  const tagMap={};let tagNames=[];
  const tagFetch=sb("tags?order=start_date.desc").then(rows=>{for(const r of rows){tagMap[r.name]=r};tagNames=rows.map(r=>r.name)});
  // Cache subscription merchants for badge + filter
  let subMerchants=new Set();
  const subFetch=fetchSubscriptions().then(subs=>{subMerchants=new Set(subs.map(s=>s.merchant))});
  fetchCreditNames();

  // Batch selection state
  const selected=new Set();
  let currentTxns=[];
  let selectMode=false;

  el.innerHTML=`<div class="cd"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">Transactions</h3><span id="ledgerOkMsg" class="ok-msg hidden"></span><div id="pgNav"></div></div><div id="filterBar" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"></div><div id="ledgerBody">Loading...</div></div>`;

  // Floating action bar for batch operations
  const batchBar=h("div",{class:"batch-bar hidden"});
  const bbCount=h("span",{class:"bb-count"});
  const bbEdit=h("button",{class:"bb-btn bb-edit",onClick:()=>openBatchEditModal(currentTxns.filter(t=>selected.has(t.id)),()=>{selected.clear();updateBatchBar();loadPage()})},"\u270F Edit");
  const bbLink=h("button",{class:"bb-btn bb-link",onClick:()=>doBatchLink(currentTxns.filter(t=>selected.has(t.id)),()=>{selected.clear();updateBatchBar();loadPage()})},"\uD83D\uDD17 Link");
  const bbCopy=h("button",{class:"bb-btn bb-copy",onClick:async()=>{
    const pMap={accommodation:"Entertainment",games:"Entertainment",groceries:"Food",restaurant:"Food",rent:"Home",furniture:"Home",clothes:"Personal",tech:"Personal"};
    const rows=currentTxns.filter(t=>selected.has(t.id));
    const lines=["Date\tService Start\tService End\tDescription\tCategory\tOriginal Amount\tCurrency\tAmount USD\tPayment Type\tCredit\tTags\tDaily Cost"];
    for(const t of rows){const cat=pMap[t.category_id]||(t.category_id?t.category_id[0].toUpperCase()+t.category_id.slice(1):"");lines.push([t.date,t.service_start,t.service_end,'"'+t.description.replace(/"/g,'""')+'"',cat,t.original_amount,t.currency,t.amount_usd,t.payment_type,t.credit||"",t.tag||"",t.daily_cost].join("\t"))}
    try{await navigator.clipboard.writeText(lines.join("\n"));bbCopy.textContent="Copied!";setTimeout(()=>{bbCopy.textContent="\uD83D\uDCCB Copy"},1500)}catch(e){alert("Copy failed: "+e.message)}
  }},"\uD83D\uDCCB Copy");
  let bbDelTimer=null;
  const bbDel=h("button",{class:"bb-btn bb-del",onClick:async()=>{
    if(bbDel.dataset.confirm!=="1"){bbDel.dataset.confirm="1";bbDel.textContent=`Confirm Delete (${selected.size})`;bbDelTimer=setTimeout(()=>{bbDel.dataset.confirm="0";bbDel.textContent="\uD83D\uDDD1 Delete"},3000);return}
    if(bbDelTimer)clearTimeout(bbDelTimer);
    bbDel.textContent="Deleting...";bbDel.disabled=true;
    try{
      const ids=[...selected];
      const delTxns=currentTxns.filter(t=>ids.includes(t.id)).map(t=>({...t}));
      await sb(`transactions?id=in.(${ids.join(",")})`,{method:"DELETE",headers:{"Prefer":"return=representation"}});
      state.txnCount-=ids.length;
      document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
      selected.clear();updateBatchBar();
      showUndo(`\u2713 Deleted ${ids.length} items`,async()=>{
        await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(delTxns)});
        state.txnCount+=delTxns.length;document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
        loadPage();
      });
      loadPage();
    }catch(e){alert("Batch delete failed: "+e.message);bbDel.textContent="\uD83D\uDDD1 Delete";bbDel.disabled=false;bbDel.dataset.confirm="0"}
  }},"\uD83D\uDDD1 Delete");
  const bbCancel=h("button",{class:"bb-btn bb-cancel",onClick:()=>exitSelectMode()},"\u2715 Cancel");
  batchBar.append(bbCount,bbEdit,bbLink,bbCopy,bbDel,bbCancel);
  document.body.append(batchBar);

  function exitSelectMode(){selectMode=false;selected.clear();updateBatchBar();document.querySelectorAll(".ldg-chk").forEach(c=>c.closest("th,td").style.display="none");selBtn.textContent="\u2610"}

  function updateBatchBar(){
    if(selectMode&&selected.size>0){batchBar.classList.remove("hidden");bbCount.textContent=`\u2611 ${selected.size} selected`}
    else{batchBar.classList.add("hidden")}
    bbDel.dataset.confirm="0";bbDel.textContent="\uD83D\uDDD1 Delete";bbDel.disabled=false;
    if(bbDelTimer){clearTimeout(bbDelTimer);bbDelTimer=null}
    const ha=document.getElementById("ldgChkAll");
    if(ha)ha.checked=currentTxns.length>0&&currentTxns.every(t=>selected.has(t.id));
  }

  const fb=document.getElementById("filterBar");

  // Search input (debounced auto-search + Enter for immediate)
  const si=h("input",{style:fS+";width:160px",placeholder:"Search...",value:f.q});
  let searchTimer;
  si.addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{f.q=si.value;state.page=0;loadPage()},300)});
  si.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();clearTimeout(searchTimer);f.q=si.value;state.page=0;loadPage()}});
  fb.append(si);

  // Category filter
  const cs=h("select",{style:fS+";cursor:pointer"});
  cs.innerHTML=`<option value="">All Categories</option>`+CATS_LIST.map(c=>`<option value="${c.id}"${c.id===f.cat?" selected":""}>${c.l}</option>`).join("");
  cs.addEventListener("change",()=>{f.cat=cs.value;state.page=0;loadPage()});
  fb.append(cs);

  // Payment type filter
  const ps=h("select",{style:fS+";cursor:pointer"});
  ps.innerHTML=`<option value="">All Payments</option>`+PTS.map(p=>`<option value="${p}"${p===f.pt?" selected":""}>${p}</option>`).join("");
  ps.addEventListener("change",()=>{f.pt=ps.value;state.page=0;loadPage()});
  fb.append(ps);

  // Tag filter
  const ts=h("select",{style:fS+";cursor:pointer"});
  ts.innerHTML='<option value="">All Tags</option>';
  tagFetch.then(()=>{ts.innerHTML='<option value="">All Tags</option>'+tagNames.map(t=>`<option value="${t}"${t===f.tag?" selected":""}>${t}</option>`).join("")});
  ts.addEventListener("change",()=>{f.tag=ts.value;state.page=0;loadPage()});
  fb.append(ts);

  // Date range
  fb.append(h("span",{style:"font-size:10px;color:rgba(255,255,255,0.3);align-self:center"},"From"));
  const df=h("input",{type:"date",style:fS+";width:130px",value:f.dfrom});
  df.addEventListener("change",()=>{f.dfrom=df.value;state.page=0;loadPage()});
  fb.append(df);
  fb.append(h("span",{style:"font-size:10px;color:rgba(255,255,255,0.3);align-self:center"},"To"));
  const dt=h("input",{type:"date",style:fS+";width:130px",value:f.dto});
  dt.addEventListener("change",()=>{f.dto=dt.value;state.page=0;loadPage()});
  fb.append(dt);

  // Clear button
  const clr=h("button",{class:"pg-btn",title:"Clear filters",style:"font-size:11px",onClick:()=>{state.lf={cat:"",pt:"",tag:"",dfrom:"",dto:"",q:"",subsOnly:false};state.page=0;selected.clear();selectMode=false;updateBatchBar();renderLedger(el)}},"\u2716");
  fb.append(clr);

  // Subscription filter toggle
  const subBtn=h("button",{class:"pg-btn",title:"Subscriptions only",style:`font-size:11px${f.subsOnly?";border-color:rgba(129,178,154,0.4);color:var(--g)":""}`,onClick:()=>{f.subsOnly=!f.subsOnly;state.page=0;loadPage();subBtn.style.borderColor=f.subsOnly?"rgba(129,178,154,0.4)":"";subBtn.style.color=f.subsOnly?"var(--g)":""}},"\uD83D\uDD04");
  fb.append(subBtn);

  // Select mode toggle
  const selBtn=h("button",{class:"pg-btn",style:"font-size:11px",onClick:()=>{
    if(selectMode){exitSelectMode()}
    else{selectMode=true;selBtn.textContent="\u2715";document.querySelectorAll(".ldg-chk").forEach(c=>c.closest("th,td").style.display="")}
  }},"\u2610");
  fb.append(selBtn);

  const pasteBtn=h("button",{class:"pg-btn",title:"Paste TSV",style:"font-size:11px",onClick:()=>openPasteModal(loadPage)},"\uD83D\uDCE5");
  fb.append(pasteBtn);

  async function loadPage(){
    selected.clear();updateBatchBar();
    document.getElementById("ledgerBody").innerHTML="Loading...";
    await subFetch;
    let q=`transactions?select=*&order=date.desc,id.desc&limit=${PS}&offset=${state.page*PS}`;
    if(f.cat)q+=`&category_id=eq.${f.cat}`;
    if(f.pt)q+=`&payment_type=eq.${encodeURIComponent(f.pt)}`;
    if(f.tag)q+=`&tag=eq.${encodeURIComponent(f.tag)}`;
    if(f.dfrom)q+=`&date=gte.${f.dfrom}`;
    if(f.dto)q+=`&date=lte.${f.dto}`;
    if(f.q){const eq=encodeURIComponent(f.q);let orParts=`description.ilike.*${eq}*,tag.ilike.*${eq}*,payment_type.ilike.*${eq}*`;const num=parseFloat(f.q);if(!isNaN(num)&&String(num)===f.q.trim())orParts+=`,amount_usd.eq.${num}`;q+=`&or=(${orParts})`}
    const txns=await sb(q);
    // Backfill missing linked group members from other pages
    const pageGroupIds=[...new Set(txns.filter(t=>t.transaction_group_id).map(t=>t.transaction_group_id))];
    if(pageGroupIds.length){
      const pageIds=new Set(txns.map(t=>t.id));
      const missing=await sb(`transactions?transaction_group_id=in.(${pageGroupIds.join(",")})`
        +`&id=not.in.(${[...pageIds].join(",")})&select=*&order=date.desc,id.desc`);
      for(const m of missing){
        const anchorIdx=txns.findIndex(t=>t.transaction_group_id===m.transaction_group_id);
        if(anchorIdx>=0)txns.splice(anchorIdx+1,0,m);else txns.push(m);
      }
    }
    // Group linked transactions adjacent by transaction_group_id
    const groupPositions={};
    txns.forEach((t,i)=>{if(t.transaction_group_id){if(!groupPositions[t.transaction_group_id])groupPositions[t.transaction_group_id]=[];groupPositions[t.transaction_group_id].push(i)}});
    for(const gid of Object.keys(groupPositions)){
      const indices=groupPositions[gid];if(indices.length<2)continue;
      const anchor=indices[0];let insertAt=anchor+1;
      for(let j=1;j<indices.length;j++){
        let curIdx=indices[j];if(curIdx===insertAt){insertAt++;continue}
        const[moved]=txns.splice(curIdx,1);txns.splice(insertAt,0,moved);
        for(let k=j+1;k<indices.length;k++){if(indices[k]>curIdx&&indices[k]<=insertAt)indices[k]--;else if(indices[k]<curIdx&&indices[k]>=insertAt)indices[k]++}
        insertAt++;
      }
    }
    // Count group sizes for display
    const groupCounts={};txns.forEach(t=>{if(t.transaction_group_id){groupCounts[t.transaction_group_id]=(groupCounts[t.transaction_group_id]||0)+1}});
    // Build group summaries for collapse/expand
    const groupMembers={};
    txns.forEach(t=>{if(t.transaction_group_id){const gid=t.transaction_group_id;if(!groupMembers[gid])groupMembers[gid]=[];groupMembers[gid].push(t)}});
    // Fetch group overrides
    const grpGids=Object.keys(groupMembers).filter(gid=>groupMembers[gid].length>=2);
    const grpOverrides=grpGids.length?await sb(`group_overrides?group_id=in.(${grpGids.join(",")})&select=*`):[];
    const overrideMap={};grpOverrides.forEach(o=>{overrideMap[o.group_id]=o});
    const groupSummaries={};
    for(const[gid,members]of Object.entries(groupMembers)){
      if(members.length<2)continue;
      const net=members.reduce((s,m)=>s+m.amount_usd,0);
      const dates=members.map(m=>m.date).sort();
      const sStarts=members.map(m=>m.service_start).filter(Boolean).sort();
      const sEnds=members.map(m=>m.service_end).filter(Boolean).sort();
      const catF={};members.forEach(m=>{catF[m.category_id]=(catF[m.category_id]||0)+1});
      const catS=Object.entries(catF).sort((a,b)=>b[1]-a[1]);
      const ptF={};members.forEach(m=>{if(m.payment_type)ptF[m.payment_type]=(ptF[m.payment_type]||0)+1});
      const ptS=Object.entries(ptF).sort((a,b)=>b[1]-a[1]);
      const tagF={};members.forEach(m=>{if(m.tag)tagF[m.tag]=(tagF[m.tag]||0)+1});
      const tagS=Object.entries(tagF).sort((a,b)=>b[1]-a[1]);
      const ov=overrideMap[gid];
      groupSummaries[gid]={net,dateMax:dates[dates.length-1],
        serviceStart:sStarts[0]||dates[0],serviceEnd:sEnds[sEnds.length-1]||dates[dates.length-1],
        dominantCat:ov?.category_id||catS[0][0],mixedCat:ov?.category_id?false:catS.length>1,
        dominantPt:ov?.payment_type||(ptS.length?ptS[0][0]:""),mixedPt:ov?.payment_type?false:ptS.length>1,
        dominantTag:ov?.tag||(tagS.length?tagS[0][0]:""),
        netDailyCost:members.reduce((s,m)=>s+(m.daily_cost||0),0),
        label:ov?.label||generateGroupLabel(members),memberCount:members.length,
        hasOverride:!!ov};
    }
    // Fire-and-forget AI labels (skip groups with manual label overrides)
    const grpsForAI=Object.entries(groupMembers).filter(([gid,m])=>m.length>=2&&!overrideMap[gid]?.label).map(([gid,members])=>({gid,members:members.map(m=>({description:m.description,amount_usd:m.amount_usd,category_id:m.category_id,date:m.date}))}));
    if(grpsForAI.length)aiGroupLabels(grpsForAI).then(labels=>{for(const[gid,label]of Object.entries(labels)){if(label){const el=document.querySelector(`[data-grp-label="${gid}"]`);if(el)el.textContent=label}}});
    // Subscription filter (client-side)
    if(f.subsOnly&&subMerchants.size){const before=txns.length;for(let i=txns.length-1;i>=0;i--){if(!subMerchants.has(normalizeMerchant(txns[i].description)))txns.splice(i,1)}}
    const nav=document.getElementById("pgNav");
    nav.innerHTML="";
    const prev=h("button",{class:"pg-btn",onClick:()=>{if(state.page>0){state.page--;loadPage()}}},"\u2190 Prev");
    if(state.page===0)prev.disabled=true;
    nav.append(prev);
    nav.append(h("span",{style:{padding:"4px 8px",fontSize:"11px",color:"rgba(255,255,255,0.3)"}},`Page ${state.page+1}`));
    const next=h("button",{class:"pg-btn",onClick:()=>{state.page++;loadPage()}},`Next \u2192`);
    if(txns.length<PS)next.disabled=true;
    nav.append(next);

    const wrap=h("div",{style:{overflowX:"auto"}});
    const tbl=h("table");
    tbl.innerHTML=`<thead><tr><th style="width:30px;padding:10px 4px;${selectMode?"":"display:none"}"><input type="checkbox" class="ldg-chk" id="ldgChkAll"></th><th>Date</th><th>Description</th><th>Category</th><th class="r">Amount</th><th class="hide-m">Payment</th><th class="hide-m">Service Period</th><th class="r hide-m">Daily Cost</th><th>Tag</th></tr></thead>`;
    // Highlight helper: wraps matching substrings in styled spans
    const hq=f.q&&f.q.length>=2?f.q.toLowerCase():"";
    function hilite(text,el){if(!text){el.append(document.createTextNode(""));return}if(!hq){el.append(document.createTextNode(text));return}const low=text.toLowerCase();const idx=low.indexOf(hq);if(idx===-1){el.append(document.createTextNode(text));return}el.append(document.createTextNode(text.slice(0,idx)));el.append(h("span",{style:"background:rgba(242,204,143,0.25);border-radius:2px;padding:0 1px"},text.slice(idx,idx+hq.length)));el.append(document.createTextNode(text.slice(idx+hq.length)))}
    currentTxns=txns;
    const tbody=document.createElement("tbody");
    let prevGroupId=null;
    const renderedGroups=new Set();
    function renderNormalRow(t,indent){
      const isLinked=!!t.transaction_group_id;
      const gSize=isLinked?groupCounts[t.transaction_group_id]:0;
      const tr=h("tr",{style:{cursor:"pointer",
        ...(indent?{borderLeft:"3px solid rgba(74,111,165,0.3)",background:"rgba(74,111,165,0.02)"}:isLinked?{borderLeft:"3px solid var(--b)"}:{}),
        ...(isLinked&&!indent&&prevGroupId&&prevGroupId!==t.transaction_group_id?{borderTop:"2px solid rgba(255,255,255,0.12)"}:{})}
      ,onClick:()=>openLedgerEditModal(t,loadPage)});
      if(!indent)prevGroupId=t.transaction_group_id||null;
      const chk=h("input",{type:"checkbox",class:"ldg-chk",onClick:e=>e.stopPropagation(),onChange:e=>{if(e.target.checked)selected.add(t.id);else selected.delete(t.id);updateBatchBar()}});
      tr.append(h("td",{style:{padding:"9px 4px",...(selectMode?{}:{display:"none"})}},[chk]));
      tr.append(h("td",{class:"m",style:{color:indent?"rgba(255,255,255,0.45)":"rgba(255,255,255,0.55)",whiteSpace:"nowrap",...(indent?{paddingLeft:"16px"}:{})}},fmtD(t.date)));
      const descTd=h("td",{style:{color:indent?"rgba(255,255,255,0.65)":"rgba(255,255,255,0.8)",maxWidth:"240px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",...(indent?{paddingLeft:"20px"}:{})}});
      if(!indent&&isLinked)descTd.append(h("span",{style:{fontSize:"10px",marginRight:"4px"},title:`Linked group of ${gSize}`},gSize>2?`\uD83D\uDD17${gSize}`:"\uD83D\uDD17"));
      if(subMerchants.size&&subMerchants.has(normalizeMerchant(t.description)))descTd.append(h("span",{style:{fontSize:"10px",marginRight:"4px",color:"rgba(129,178,154,0.6)",cursor:"pointer"},title:"View subscription history",onClick:e=>{e.stopPropagation();showSubHistory(normalizeMerchant(t.description),t.description)}},"\uD83D\uDD04"));
      hilite(t.description,descTd);
      tr.append(descTd);
      const catTd=h("td");const catBadge=h("span",{class:"badge",style:{background:(CC[t.category_id]||"#666")+(indent?"15":"22"),color:(CC[t.category_id]||"#888")+(indent?"aa":"")}});hilite(t.category_id,catBadge);catTd.append(catBadge);tr.append(catTd);
      const amtTd=h("td",{class:"r m",style:{color:t.amount_usd<0?"var(--g)":indent?"rgba(255,255,255,0.6)":"rgba(255,255,255,0.75)"}});if(t.currency&&t.currency!=="USD"&&t.original_amount!=null){const fxLabel=(t.currency==="CAD"?"CA$":t.currency+" ")+new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.abs(t.original_amount));amtTd.append(h("span",{style:{color:"rgba(255,255,255,0.28)",fontSize:"11px",marginRight:"6px",fontFamily:"var(--mono)"}},fxLabel))}const amtStr=fmtF(t.amount_usd);if(hq&&amtStr.replace(/[,$]/g,"").includes(hq))hilite(amtStr,amtTd);else amtTd.append(document.createTextNode(amtStr));tr.append(amtTd);
      const ptTd=h("td",{class:"hide-m",style:{color:indent?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.4)",fontSize:"11px",whiteSpace:"nowrap"}});hilite(t.payment_type||"",ptTd);tr.append(ptTd);
      const spTd=h("td",{class:"m hide-m",style:{color:indent?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.4)",whiteSpace:"nowrap"}});spTd.append(document.createTextNode(fmtD(t.service_start)+"\u2013"+fmtD(t.service_end)));if(t.service_days>1)spTd.append(h("span",{style:{marginLeft:"3px",color:"rgba(255,255,255,0.2)"}},`(${t.service_days}d)`));tr.append(spTd);
      tr.append(h("td",{class:"r m hide-m",style:{color:indent?"rgba(255,255,255,0.35)":"var(--g)"}},fmtF(t.daily_cost)));
      const tagTd=h("td",{style:{color:"rgba(255,255,255,0.35)",fontSize:"11px"}});if(t.tag){const tagSpan=h("span",{style:{background:"rgba(255,255,255,0.06)",padding:"2px 7px",borderRadius:"4px",cursor:"pointer"},onClick:e=>{e.stopPropagation();state.tagDetail=t.tag;state.tab="tags";history.replaceState(null,null,"#tags");renderTabs();renderContent()}});hilite(t.tag,tagSpan);tagSpan.addEventListener("mouseenter",()=>tagSpan.style.background="rgba(74,111,165,0.2)");tagSpan.addEventListener("mouseleave",()=>tagSpan.style.background="rgba(255,255,255,0.06)");tagTd.append(tagSpan)}tr.append(tagTd);
      return tr;
    }
    txns.forEach(t=>{
      const isLinked=!!t.transaction_group_id;
      const gid=t.transaction_group_id;
      const gSize=isLinked?groupCounts[gid]:0;
      const summary=gid?groupSummaries[gid]:null;
      const isExpanded=state.expandedGroups.has(gid);
      // Group with 2+ members: render summary + child rows
      if(isLinked&&gSize>=2&&summary&&!renderedGroups.has(gid)){
        renderedGroups.add(gid);
        // Summary row
        const str=h("tr",{class:"grp-summary",style:{cursor:"pointer",borderLeft:"3px solid var(--b)",background:"rgba(74,111,165,0.04)",
          ...(prevGroupId&&prevGroupId!==gid?{borderTop:"2px solid rgba(255,255,255,0.12)"}:{})},
          onClick:()=>openGroupEditModal(gid,groupMembers[gid]||[],summary,overrideMap[gid],loadPage)});
        prevGroupId=gid;
        // Checkbox (selects all members)
        const chk=h("input",{type:"checkbox",class:"ldg-chk",onClick:e=>e.stopPropagation(),onChange:e=>{
          const members=groupMembers[gid]||[];
          members.forEach(m=>{if(e.target.checked)selected.add(m.id);else selected.delete(m.id)});
          document.querySelectorAll(`[data-grp-child="${gid}"] .ldg-chk`).forEach(c=>{c.checked=e.target.checked});
          updateBatchBar();
        }});
        str.append(h("td",{style:{padding:"9px 4px",...(selectMode?{}:{display:"none"})}},[chk]));
        str.append(h("td",{class:"m",style:{color:"rgba(255,255,255,0.55)",whiteSpace:"nowrap"}},fmtD(summary.dateMax)));
        // Description: chevron + badge + label
        const descTd=h("td",{style:{color:"rgba(255,255,255,0.9)",maxWidth:"240px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}});
        descTd.append(h("span",{style:{display:"inline-block",fontSize:"10px",marginRight:"4px",transition:"transform 0.15s",transform:isExpanded?"rotate(90deg)":"",cursor:"pointer",padding:"2px"},"data-grp-chev":gid,onClick:e=>{
          e.stopPropagation();
          if(state.expandedGroups.has(gid))state.expandedGroups.delete(gid);else state.expandedGroups.add(gid);
          document.querySelectorAll(`[data-grp-child="${gid}"]`).forEach(r=>{r.style.display=state.expandedGroups.has(gid)?"table-row":"none"});
          const ch=document.querySelector(`[data-grp-chev="${gid}"]`);if(ch)ch.style.transform=state.expandedGroups.has(gid)?"rotate(90deg)":"";
        }},"\u25B6"));
        descTd.append(h("span",{style:{fontSize:"10px",marginRight:"4px",color:"var(--b)"}},`\uD83D\uDD17${summary.memberCount}`));
        descTd.append(h("span",{"data-grp-label":gid},sessionStorage.getItem(`grp_label_${gid}`)||summary.label));
        str.append(descTd);
        // Category
        const catTd=h("td");const catBadge=h("span",{class:"badge",style:{background:(CC[summary.dominantCat]||"#666")+"22",color:CC[summary.dominantCat]||"#888"}},summary.dominantCat);
        if(summary.mixedCat)catBadge.append(h("span",{style:{marginLeft:"3px",fontSize:"9px",color:"rgba(255,255,255,0.3)"}},"+"));
        catTd.append(catBadge);str.append(catTd);
        // Net amount
        str.append(h("td",{class:"r m",style:{color:summary.net<0?"var(--g)":"rgba(255,255,255,0.75)",fontWeight:"600"}},fmtF(Math.round(summary.net*100)/100)));
        // Payment type
        str.append(h("td",{class:"hide-m",style:{color:"rgba(255,255,255,0.4)",fontSize:"11px",whiteSpace:"nowrap"}},summary.dominantPt+(summary.mixedPt?" +":"")));
        // Service period (union)
        const spTd=h("td",{class:"m hide-m",style:{color:"rgba(255,255,255,0.4)",whiteSpace:"nowrap"}});
        spTd.append(document.createTextNode(fmtD(summary.serviceStart)+"\u2013"+fmtD(summary.serviceEnd)));str.append(spTd);
        // Daily cost (not meaningful for group)
        str.append(h("td",{class:"r m hide-m",style:{color:"var(--g)"}},fmtF(Math.round(summary.netDailyCost*1e6)/1e6)));
        // Tag
        const tagTd=h("td",{style:{color:"rgba(255,255,255,0.35)",fontSize:"11px"}});
        if(summary.dominantTag)tagTd.append(h("span",{style:{background:"rgba(255,255,255,0.06)",padding:"2px 7px",borderRadius:"4px"}},summary.dominantTag));
        str.append(tagTd);
        tbody.append(str);
        // Child rows
        const members=groupMembers[gid]||[];
        members.forEach(m=>{
          const childTr=renderNormalRow(m,true);
          childTr.setAttribute("data-grp-child",gid);
          childTr.style.display=isExpanded?"table-row":"none";
          tbody.append(childTr);
        });
      } else if(!isLinked||gSize<2){
        // Normal ungrouped row
        tbody.append(renderNormalRow(t,false));
      }
      // Skip individual group members that were already rendered as children
    });
    tbl.append(tbody);wrap.append(tbl);
    const body=document.getElementById("ledgerBody");body.innerHTML="";body.append(wrap);
    document.getElementById("ldgChkAll")?.addEventListener("change",e=>{
      const checked=e.target.checked;
      currentTxns.forEach(t=>{if(checked)selected.add(t.id);else selected.delete(t.id)});
      document.querySelectorAll(".ldg-chk:not(#ldgChkAll)").forEach(c=>c.checked=checked);
      updateBatchBar();
    });
  }
  loadPage();
}

function openGroupEditModal(gid,members,summary,override,onSaved){
  const _orig=onSaved;
  const _onSaved=()=>{dcInvalidateTxns();if(_orig)_orig()};
  onSaved=_onSaved;
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal",style:{maxWidth:"560px"}});
  // Header
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
  const hdrLeft=h("div");
  hdrLeft.append(h("h3",{style:{margin:"0"}},`Linked Group \uD83D\uDD17${members.length}`));
  hdrLeft.append(h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",marginTop:"4px"}},`Group ID: ${gid}`));
  hdr.append(hdrLeft,h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg.remove()},"\u2715"));
  modal.append(hdr);
  // Editable fields
  function gRow(...ch){const d=h("div",{style:{display:"grid",gridTemplateColumns:ch.length===2?"1fr 1fr":"1fr",gap:"12px",marginBottom:"14px"}});ch.forEach(x=>d.append(x));return d}
  function gField(lbl,inp){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(inp);return d}
  const autoLabel=sessionStorage.getItem(`grp_label_${gid}`)||summary.label;
  const gLabel=h("input",{class:"inp",type:"text",value:override?.label||"",placeholder:autoLabel});
  const gCat=h("select",{class:"inp"});
  gCat.append(h("option",{value:""},"Auto (dominant)"));
  CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===(override?.category_id||""))o.selected=true;gCat.append(o)});
  const gPt=h("select",{class:"inp"});
  gPt.append(h("option",{value:""},"Auto (dominant)"));
  PTS.forEach(p=>{const o=h("option",{value:p},p);if(p===(override?.payment_type||""))o.selected=true;gPt.append(o)});
  const gTag=h("input",{class:"inp",type:"text",value:override?.tag||"",placeholder:summary.dominantTag||""});
  modal.append(gRow(gField("Group Label",gLabel)));
  modal.append(gRow(gField("Category",gCat),gField("Payment Type",gPt)));
  modal.append(gRow(gField("Tag",gTag)));
  // Net summary KPIs
  const kpiRow=h("div",{style:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px",marginBottom:"16px",padding:"10px",background:"rgba(74,111,165,0.06)",borderRadius:"6px"}});
  kpiRow.append(h("div",{style:{textAlign:"center"}},[h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.3)"}},"Net Amount"),h("div",{style:{fontSize:"16px",fontWeight:"700",color:summary.net<0?"var(--g)":"#fff",fontFamily:"var(--mono)"}},fmtF(Math.round(summary.net*100)/100))]));
  kpiRow.append(h("div",{style:{textAlign:"center"}},[h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.3)"}},"Daily Cost"),h("div",{style:{fontSize:"16px",fontWeight:"700",color:"var(--g)",fontFamily:"var(--mono)"}},fmtF(Math.round(summary.netDailyCost*1e6)/1e6)+"/d")]));
  kpiRow.append(h("div",{style:{textAlign:"center"}},[h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.3)"}},"Service Period"),h("div",{style:{fontSize:"13px",fontWeight:"600",color:"rgba(255,255,255,0.6)"}},fmtD(summary.serviceStart)+"\u2013"+fmtD(summary.serviceEnd))]));
  modal.append(kpiRow);
  // Member table
  modal.append(h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:"8px"}},"Transactions"));
  const mtbl=h("table",{style:{width:"100%",fontSize:"12px"}});
  mtbl.innerHTML=`<thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Description</th><th style="text-align:left">Category</th><th style="text-align:right">Amount</th><th style="text-align:left" class="hide-m">Payment</th></tr></thead>`;
  const mtbody=document.createElement("tbody");
  members.forEach(m=>{
    const tr=h("tr",{style:{cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.04)"},onClick:()=>{bg.remove();openLedgerEditModal(m,onSaved)}});
    tr.append(h("td",{class:"m",style:{color:"rgba(255,255,255,0.5)",whiteSpace:"nowrap",padding:"6px 4px"}},fmtD(m.date)));
    tr.append(h("td",{style:{color:"rgba(255,255,255,0.75)",maxWidth:"180px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",padding:"6px 4px"}},m.description||""));
    const catTd=h("td",{style:{padding:"6px 4px"}});catTd.append(h("span",{class:"badge",style:{background:(CC[m.category_id]||"#666")+"22",color:CC[m.category_id]||"#888"}},m.category_id));tr.append(catTd);
    tr.append(h("td",{class:"r m",style:{color:m.amount_usd<0?"var(--g)":"rgba(255,255,255,0.7)",padding:"6px 4px"}},fmtF(m.amount_usd)));
    tr.append(h("td",{class:"hide-m",style:{color:"rgba(255,255,255,0.35)",fontSize:"11px",padding:"6px 4px"}},m.payment_type||""));
    tr.addEventListener("mouseenter",()=>tr.style.background="rgba(74,111,165,0.08)");
    tr.addEventListener("mouseleave",()=>tr.style.background="");
    mtbody.append(tr);
  });
  mtbl.append(mtbody);modal.append(h("div",{style:{maxHeight:"200px",overflowY:"auto",marginBottom:"16px"}},[mtbl]));
  // Buttons
  const btnRow=h("div",{style:{display:"flex",gap:"10px",justifyContent:"flex-end"}});
  const resetBtn=h("button",{class:"pg-btn",style:{background:"rgba(224,122,95,0.15)",color:"#E07A5F"},onClick:async()=>{
    if(!override&&!gLabel.value&&!gCat.value&&!gPt.value&&!gTag.value){bg.remove();return}
    await sb(`group_overrides?group_id=eq.${gid}`,{method:"DELETE",headers:{"Prefer":"return=minimal"}});
    sessionStorage.removeItem(`grp_label_${gid}`);
    sessionStorage.removeItem("grp_label_examples");
    bg.remove();if(onSaved)onSaved();
  }},"Reset to Auto");
  const saveBtn=h("button",{class:"pg-btn",style:{background:"var(--b)",color:"#fff"},onClick:async()=>{
    const body={group_id:parseInt(gid),updated_at:new Date().toISOString()};
    if(gLabel.value.trim())body.label=gLabel.value.trim();else body.label=null;
    if(gCat.value)body.category_id=gCat.value;else body.category_id=null;
    if(gPt.value)body.payment_type=gPt.value;else body.payment_type=null;
    if(gTag.value.trim())body.tag=gTag.value.trim();else body.tag=null;
    // Only save if at least one field is set
    const hasAny=body.label||body.category_id||body.payment_type||body.tag;
    if(!hasAny){
      await sb(`group_overrides?group_id=eq.${gid}`,{method:"DELETE",headers:{"Prefer":"return=minimal"}});
    }else{
      await sb("group_overrides",{method:"POST",headers:{"Prefer":"return=minimal,resolution=merge-duplicates"},body:JSON.stringify(body)});
    }
    // Update DOM immediately
    if(body.label){const el=document.querySelector(`[data-grp-label="${gid}"]`);if(el)el.textContent=body.label;sessionStorage.setItem(`grp_label_${gid}`,body.label)}
    sessionStorage.removeItem("grp_label_examples");
    bg.remove();if(onSaved)onSaved();
  }},"Save");
  btnRow.append(resetBtn,saveBtn);modal.append(btnRow);
  bg.append(modal);document.body.append(bg);
}
