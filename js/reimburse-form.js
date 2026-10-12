function isReimbursableTxn(t){
  return t&&t.amount_usd>0&&!["income","investment","financial","adjustment"].includes(t.category_id);
}
function reimburseHint(spec){
  if(!spec||!spec.person)return "";
  const first=(spec.person||"").split(" ")[0];
  const pct=spec.ratio!=null?Math.round(spec.ratio*100):null;
  const bits=["Split "+first];
  if(pct!=null)bits.push(pct+"%");
  if(spec.swPayload)bits.push("Splitwise");
  return bits.join(" \u00b7 ");
}
async function stampPendingSwExpense(sourceTxnId,expenseId){
  if(!sourceTxnId||!expenseId)return;
  try{await sb(`pending_shared_txns?source_txn_id=eq.${sourceTxnId}&sw_expense_id=is.null`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({sw_expense_id:expenseId})})}catch(e){}
}
async function pushSwPayload(swPayload){
  if(!swPayload)return;
  const res=await swCreateExpense(swPayload);
  if(res&&res.expense_id)await stampPendingSwExpense(swPayload.expense_txn_id,res.expense_id);
  return res;
}
async function applyStagedReimbursement(txn,spec,batchId){
  if(!txn||!spec||!spec.person)return null;
  const r=await createReimbursement(txn,spec.person,spec.ratio,spec.paymentType,spec.note||"",spec.credit||"",spec.householdShareAmt);
  if(r&&r.newId&&batchId){
    try{await sb(`transactions?id=eq.${r.newId}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({import_batch:batchId})})}catch(e){}
  }
  if(spec.swPayload){
    const payload=Object.assign({},spec.swPayload,{
      expense_txn_id:txn.id,
      reimburse_txn_id:r&&r.newId,
      transaction_group_id:r&&r.groupId
    });
    try{await pushSwPayload(payload)}catch(e){console.warn("Import Splitwise push failed:",e&&e.message)}
  }
  return r;
}

function openReimburseForm(txn,opts){
  opts=opts||{};
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal"});
  bg.append(modal);document.body.append(bg);
  fillReimburseForm(modal,txn,Object.assign({bg},opts));
  return bg;
}

// Shared Reimburse form (ledger edit + CSV import). collectOnly stages a spec
// instead of writing transactions, so import can apply it after the charge exists.
function fillReimburseForm(modal,txn,opts){
  opts=opts||{};
  const bg=opts.bg;
  function mRow(...ch){const d=h("div",{style:{display:"grid",gridTemplateColumns:ch.length===3?"1fr 1fr 1fr":ch.length===2?"1fr 1fr":"1fr",gap:"12px",marginBottom:"14px"}});ch.forEach(x=>d.append(x));return d}
  function mField(lbl,inp){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(inp);return d}
  let selectedPerson=opts.defaultPerson||"",selectedRatio=0.5,manualMode=false,manualAmt=0;

  const rHdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}});
  const rHdrLeft=h("div");
  rHdrLeft.append(h("h3",{style:{margin:"0"}},"\uD83D\uDCB8 Reimburse"));
  rHdrLeft.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.5)",marginTop:"4px"}},`${txn.description} \u00B7 ${fmtF(txn.amount_usd)}`));
  const rClose=h("span",{style:{cursor:"pointer",fontSize:"18px",color:"rgba(255,255,255,0.3)",lineHeight:"1"},onClick:()=>bg&&bg.remove()},"\u2715");
  rHdr.append(rHdrLeft,rClose);
  modal.append(rHdr);

  const personWrap=h("div",{style:{marginBottom:"14px"}});
  personWrap.append(h("label",{class:"lbl"},"Person"));
  const personSelect=h("select",{class:"inp",onChange:()=>{selectedPerson=personSelect.value;swMappedPersonId=null;if(personSelect.value)personFree.value="";updateRPreview()}});
  personSelect.append(h("option",{value:""},"Loading..."));
  personSelect.disabled=true;
  const personFree=h("input",{class:"inp",type:"text",placeholder:"or type a name",style:{marginTop:"6px"},onInput:()=>{selectedPerson=personFree.value.trim();swMappedPersonId=null;if(selectedPerson)personSelect.value="";updateRPreview()}});
  if(selectedPerson)personFree.value=selectedPerson;
  personWrap.append(personSelect,personFree);
  modal.append(personWrap);

  fetchReimburseFriends().then(friends=>{
    personSelect.innerHTML="";
    if(friends.length){
      personSelect.append(h("option",{value:""},"Select a person..."));
      friends.forEach(name=>{const o=h("option",{value:name},name);if(name===selectedPerson)o.selected=true;personSelect.append(o)});
      personSelect.disabled=false;
    }else{
      personSelect.classList.add("hidden");
    }
  }).catch(()=>{personSelect.classList.add("hidden")});

  let swFriends=[],swGroups=[],swMe=null,swLoaded=false,swLastLookup=null,swLookupTimer=null,swMappedPersonId=null;
  let swMemberRows=[];
  let swYouLine=null;
  const swWrap=h("div",{style:{marginBottom:"14px",padding:"10px 12px",background:"rgba(255,255,255,0.03)",borderRadius:"8px",display:"none"}});
  const swMsg=h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.5)",marginBottom:"6px"}});
  const swGroupSel=h("select",{class:"inp",onChange:()=>onSwGroupChange()});
  const swFriendSel=h("select",{class:"inp",style:{marginTop:"6px",display:"none"},onChange:()=>onSwFriendChange()});
  const swMembersWrap=h("div",{style:{marginTop:"8px",display:"none"}});
  const swCheckRow=h("label",{style:{display:"none",alignItems:"center",gap:"8px",fontSize:"12px",color:"#fff",cursor:"pointer",marginTop:"8px"}});
  const swCheck=h("input",{type:"checkbox",style:{width:"auto",margin:"0"},onChange:()=>updateRPreview()});
  swCheckRow.append(swCheck,h("span",{},"Also create this expense in Splitwise"));
  swWrap.append(swMsg,swGroupSel,swFriendSel,swMembersWrap,swCheckRow);
  modal.append(swWrap);

  function selectedSwFriend(){const id=Number(swFriendSel.value);return id?swFriends.find(f=>f.id===id):null}
  function selectedSwGroup(){const id=Number(swGroupSel.value);return id?swGroups.find(g=>g.id===id):null}
  function swGroupActive(){return !!selectedSwGroup()&&swMemberRows.length>0}
  function fillSwFriends(selId){
    swFriendSel.innerHTML="";
    swFriendSel.append(h("option",{value:""},"\u2014 Not on Splitwise \u2014"));
    swFriends.forEach(f=>{const o=h("option",{value:String(f.id)},f.name);if(selId&&f.id===selId)o.selected=true;swFriendSel.append(o)});
  }
  function fillSwGroups(selId){
    swGroupSel.innerHTML="";
    swGroupSel.append(h("option",{value:"0"},"No group (direct split)"));
    swGroups.slice().sort((a,b)=>(b.id||0)-(a.id||0)).forEach(g=>{const o=h("option",{value:String(g.id)},g.name);if(selId&&g.id===selId)o.selected=true;swGroupSel.append(o)});
  }
  function buildMemberChecklist(group){
    swMembersWrap.innerHTML="";swMemberRows=[];swYouLine=null;
    const others=(group.members||[]).filter(m=>m.id!==swMe);
    if(!others.length){swMembersWrap.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.4)"}},"No other members in this group."));return}
    swMembersWrap.append(h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:"6px"}},"Split with"));
    others.forEach(m=>{
      const row=h("div",{style:{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px"}});
      const cb=h("input",{type:"checkbox",style:{width:"auto",margin:"0"},onChange:()=>{recomputeEqualSplit();updateRPreview()}});
      cb.checked=true;
      const nm=h("span",{style:{flex:"1",fontSize:"12px",color:"#fff"}},m.name);
      const amt=h("input",{class:"inp",type:"number",step:"0.01",style:{width:"90px",margin:"0"},onInput:()=>updateRPreview()});
      row.append(cb,nm,amt);
      swMembersWrap.append(row);
      swMemberRows.push({member:m,cb,amt});
    });
    swYouLine=h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.5)",marginTop:"6px"}});
    swMembersWrap.append(swYouLine);
    recomputeEqualSplit();
  }
  function recomputeEqualSplit(){
    const cost=Math.round(txn.amount_usd*100)/100;
    const checked=swMemberRows.filter(r=>r.cb.checked);
    const n=checked.length+1;
    const share=Math.round(cost/n*100)/100;
    swMemberRows.forEach(r=>{r.amt.disabled=!r.cb.checked;r.amt.value=r.cb.checked?share.toFixed(2):""});
  }
  function computeGroupSplit(){
    const cost=Math.round(txn.amount_usd*100)/100;
    let othersOwed=0;const participants=[];
    swMemberRows.forEach(r=>{
      if(!r.cb.checked)return;
      const owed=Math.round((parseFloat(r.amt.value)||0)*100)/100;
      if(owed>0){othersOwed+=owed;participants.push({user_id:r.member.id,owed})}
    });
    othersOwed=Math.round(othersOwed*100)/100;
    return {othersOwed,yourShare:Math.round((cost-othersOwed)*100)/100,participants};
  }
  function currentReimbAmt(){
    if(swGroupActive())return computeGroupSplit().othersOwed;
    return manualMode?Math.round(manualAmt*100)/100:Math.round(txn.amount_usd*selectedRatio*100)/100;
  }
  function currentHouseholdShareAmt(){
    if(!swGroupActive())return currentReimbAmt();
    const personKey=selectedPerson.trim().toLowerCase();
    const personFirst=personKey.split(/\s+/)[0];
    const row=swMemberRows.find(r=>{
      if(swMappedPersonId&&Number(r.member.id)===swMappedPersonId)return true;
      const memberKey=(r.member.name||"").trim().toLowerCase();
      return memberKey===personKey||memberKey.split(/\s+/)[0]===personFirst;
    });
    if(!row||!row.cb.checked)return null;
    const amount=Math.round((parseFloat(row.amt.value)||0)*100)/100;
    return amount>0?amount:null;
  }
  function onSwGroupChange(){
    const g=selectedSwGroup();
    if(g){
      swFriendSel.style.display="none";
      buildMemberChecklist(g);
      swMembersWrap.style.display="block";
      swCheckRow.style.display="flex";
      swCheck.checked=true;
    }else{
      swMembersWrap.style.display="none";swMembersWrap.innerHTML="";swMemberRows=[];swYouLine=null;
      swFriendSel.style.display="block";
      syncSwControls();
    }
    updateRPreview();
  }
  function syncSwControls(){
    if(selectedSwGroup())return;
    const f=selectedSwFriend();
    swCheckRow.style.display=f?"flex":"none";
    if(!f)swCheck.checked=false;
  }
  function onSwFriendChange(){const f=selectedSwFriend();if(f)swCheck.checked=true;syncSwControls();persistSwMap();updateRPreview()}
  function persistSwMap(){
    const f=selectedSwFriend(),label=selectedPerson.trim();
    if(!label||!f)return;
    saveSwFriendMap(label,f,selectedSwGroup()).catch(()=>{});
  }
  async function ensureSwLoaded(){
    if(swLoaded)return;
    swMsg.textContent="Loading Splitwise\u2026";
    try{
      const [fr,gr]=await Promise.all([swFetchFriends(),swFetchGroups()]);
      swFriends=fr||[];swGroups=(gr&&gr.groups)||[];swMe=(gr&&gr.me)||null;swLoaded=true;
      swMsg.textContent=(swFriends.length||swGroups.length)?"":"No Splitwise friends or groups found (is the sync deployed?).";
    }catch(e){swFriends=[];swGroups=[];swMe=null;swMsg.textContent="Couldn't reach Splitwise: "+e.message}
    fillSwGroups();fillSwFriends();
  }
  function refreshSwSection(){
    const label=selectedPerson.trim();
    if(!label){swWrap.style.display="none";swLastLookup=null;swMappedPersonId=null;return}
    swWrap.style.display="block";
    const key=label.toLowerCase();
    if(key===swLastLookup)return;
    swLastLookup=key;
    swMappedPersonId=null;
    ensureSwLoaded().then(()=>getSwFriendMap(label)).then(m=>{
      if(selectedPerson.trim().toLowerCase()!==key)return;
      swMappedPersonId=m&&m.sw_user_id?Number(m.sw_user_id):null;
      const rememberGroup=m&&m.sw_group_id&&swGroups.some(g=>g.id===m.sw_group_id);
      fillSwGroups(rememberGroup?m.sw_group_id:null);
      fillSwFriends(m?m.sw_user_id:null);
      if(rememberGroup){onSwGroupChange();if(m)swCheck.checked=true}
      else{swMembersWrap.style.display="none";swFriendSel.style.display="block";if(m)swCheck.checked=true;syncSwControls()}
      if(swGroups.length&&!rememberGroup)swMsg.textContent="Pick a group to split with the whole trip \u2014 or a friend for a 1:1 split.";
      else if(!swGroups.length&&swFriends.length&&!m)swMsg.textContent=`Pick ${label}'s Splitwise friend to push this split.`;
      updateRPreview();
    }).catch(()=>{});
  }
  function scheduleSwRefresh(){clearTimeout(swLookupTimer);swLookupTimer=setTimeout(refreshSwSection,300)}

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

  const amtDisplay=h("div",{style:{marginBottom:"14px"}});
  amtDisplay.append(h("label",{class:"lbl"},"Reimbursement Amount"));
  const amtVal=h("div",{style:{fontSize:"20px",fontWeight:"700",color:"var(--g)",fontFamily:"var(--mono)"}});
  amtDisplay.append(amtVal);
  modal.append(amtDisplay);

  const rPt=h("select",{class:"inp",onChange:()=>{rCreditRow.style.display=rPt.value==="Transfer"?"grid":"none";updateRPreview()}});
  fillPtSelect(rPt,{prefer:["Splitwise"],keep:["Splitwise","Venmo","Transfer"]});
  acctLabelsReady().then(()=>fillPtSelect(rPt,{prefer:["Splitwise"],keep:["Splitwise","Venmo","Transfer"]}));
  modal.append(mRow(mField("Payment Method",rPt)));

  const rCredit=buildCreditSelect("");
  const rCreditRow=h("div",{style:{display:rPt.value==="Transfer"?"grid":"none",gridTemplateColumns:"1fr 2fr",gap:"6px",marginBottom:"14px"}});
  rCreditRow.append(mField("Credit Sub-Account",rCredit));
  modal.append(rCreditRow);

  const rNote=h("input",{class:"inp",type:"text",placeholder:"optional context"});
  modal.append(mRow(mField("Note",rNote)));

  const rPreview=h("div",{class:"preview",style:{marginBottom:"14px"}});
  modal.append(rPreview);

  const errEl=h("div",{style:{color:"var(--r)",fontSize:"11px",marginBottom:"8px",minHeight:"16px"}});
  modal.append(errEl);

  function collectSwPayload(reimbAmt){
    if(!swCheck.checked)return null;
    const base={
      group_id:Number(swGroupSel.value)||0,
      cost:Math.round(txn.amount_usd*100)/100,
      date:txn.date,
      description:(txn.description||"Expense").replace(/^Reimbursed\s*-\s*/i,""),
      currency_code:"USD",
      details:rNote.value||""
    };
    if(swGroupActive()){
      const g=computeGroupSplit();
      if(g.participants.length)return Object.assign({},base,{participants:g.participants});
      return null;
    }
    const swFriend=selectedSwFriend();
    if(swFriend)return Object.assign({},base,{friend_user_id:swFriend.id,friend_owed:reimbAmt});
    return null;
  }

  function updateRPreview(){
    const amt=currentReimbAmt();
    amtVal.textContent=fmtF(-amt);
    const pName=selectedPerson||"___";
    const firstName=pName.split(" ")[0];
    const desc=`Reimbursed - ${txn.description} - ${firstName}`;
    rPreview.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Preview</div>
      <div style="margin-bottom:4px;color:#fff;font-weight:600">${desc}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5)">${fmtF(-amt)} \u00B7 ${rPt.value} \u00B7 ${txn.category_id}</div>
      <div style="font-size:11px;color:rgba(74,111,165,0.7);margin-top:4px">\uD83D\uDD17 Linked to: ${txn.description}</div>`;
    if(swGroupActive()&&typeof resolveHouseholdOwner==="function"&&resolveHouseholdOwner(selectedPerson)){
      const householdShare=currentHouseholdShareAmt();
      rPreview.innerHTML+=`<div style="font-size:11px;color:rgba(129,178,154,0.8);margin-top:4px">\uD83E\uDD1D ${selectedPerson}'s ledger share: ${householdShare>0?fmtF(householdShare):"select their group row"}</div>`;
    }
    if(swGroupActive()&&swYouLine){
      const g=computeGroupSplit();
      const total=Math.round(txn.amount_usd*100)/100;
      swYouLine.textContent=`You owe ${fmtF(g.yourShare)} \u00B7 others owe ${fmtF(g.othersOwed)} \u00B7 total ${fmtF(total)}`;
      swYouLine.style.color=(g.yourShare<-0.005)?"var(--r)":"rgba(255,255,255,0.5)";
    }
    scheduleSwRefresh();
  }
  updateRPreview();

  const rBtnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto",gap:"8px",marginTop:"4px"}});
  const submitLabel=opts.submitLabel||(opts.collectOnly?"Set Split":"Create Reimbursement");
  const rCreate=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
    const person=selectedPerson.trim();
    if(!person){errEl.textContent="Please select or type a person name.";return}
    const reimbAmt=currentReimbAmt();
    if(reimbAmt<=0){errEl.textContent="Reimbursement amount must be greater than $0.";return}
    const householdShareAmt=currentHouseholdShareAmt();
    const mirrorsToHousehold=typeof resolveHouseholdOwner==="function"&&!!resolveHouseholdOwner(person);
    if(swGroupActive()&&mirrorsToHousehold&&!(householdShareAmt>0)){
      errEl.textContent=`Select ${person}'s row in the Splitwise group before creating the reimbursement.`;
      return;
    }
    errEl.textContent="";
    rCreate.textContent=opts.collectOnly?"Saving...":"Creating...";rCreate.disabled=true;
    const effectiveRatio=reimbAmt/txn.amount_usd;
    const spec={
      person,ratio:effectiveRatio,reimbAmt,paymentType:rPt.value,note:rNote.value,
      credit:rPt.value==="Transfer"?rCredit.getValue():"",
      householdShareAmt,swPayload:collectSwPayload(reimbAmt)
    };
    try{
      if(opts.collectOnly){
        if(typeof opts.onCollect==="function")opts.onCollect(spec);
        if(bg)bg.remove();
        return;
      }
      const r=await createReimbursement(txn,person,effectiveRatio,rPt.value,rNote.value,rPt.value==="Transfer"?rCredit.getValue():"",householdShareAmt);
      let swPayload=spec.swPayload;
      if(swPayload){
        swPayload=Object.assign({},swPayload,{
          expense_txn_id:r&&r.originalId,
          reimburse_txn_id:r&&r.newId,
          transaction_group_id:r&&r.groupId
        });
      }
      if(bg)bg.remove();
      const msg=document.getElementById("ledgerOkMsg");
      if(msg){msg.textContent="Reimbursement created";msg.classList.remove("hidden");setTimeout(()=>msg.classList.add("hidden"),2500)}
      const dbEl=document.getElementById("dbStatus");
      if(dbEl)dbEl.textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
      if(typeof opts.onCreated==="function")opts.onCreated();
      if(swPayload){
        pushSwPayload(swPayload).then(()=>{
          if(msg){msg.textContent="Reimbursement created \u00B7 pushed to Splitwise";msg.classList.remove("hidden");setTimeout(()=>msg.classList.add("hidden"),3000)}
        }).catch(e=>alert("Reimbursement saved, but Splitwise push failed: "+e.message));
      }
    }catch(e){alert("Failed: "+e.message);rCreate.textContent=submitLabel;rCreate.disabled=false}
  }},submitLabel);
  const rBack=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>{
    if(typeof opts.onBack==="function")opts.onBack();
    else if(bg)bg.remove();
  }},opts.onBack?"Back":"Cancel");
  rBtnRow.append(rCreate,rBack);
  modal.append(rBtnRow);
}
