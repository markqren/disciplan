// Strip Rakuten cruft from a store name so it matches the ledger description.
// "Rakuten - Chewy" / "Chewy is confirmed" / "Chewy!" → "Chewy"
function cleanRakutenStore(s){
  return String(s||"")
    .replace(/^rakuten\s*[-\u2013]\s*/i,"")
    .replace(/\s+is\s+(?:now\s+)?confirmed\b.*$/i,"")
    .replace(/\s+is\s+now\b.*$/i,"")
    .replace(/[!.].*$/,"")
    .trim();
}

// Find the original purchase a Rakuten cashback should attach to.
// Strategy: ilike the store name within a date window around the order date, then
// prefer the row whose amount matches the order total (the full purchase price),
// falling back to the closest-dated store match. Returns the txn row or null.
async function findRakutenParentMatch(storeName,orderAmount,searchDate){
  const clean=cleanRakutenStore(storeName);
  if(!clean)return null;
  const base=searchDate?new Date(searchDate+"T00:00:00"):new Date();
  if(isNaN(base))return null;
  const from=new Date(base.getTime()-45*864e5).toISOString().slice(0,10);
  const to=new Date(base.getTime()+15*864e5).toISOString().slice(0,10);
  const matches=await sb(`transactions?description=ilike.*${encodeURIComponent(clean)}*&date=gte.${from}&date=lte.${to}&amount_usd=gt.0&order=date.desc&limit=25&select=id,date,description,amount_usd,category_id,payment_type,transaction_group_id,service_start,service_end`+ownerQS());
  if(!matches.length)return null;
  const byDate=(a,b)=>Math.abs(new Date(a.date+"T00:00:00")-base)-Math.abs(new Date(b.date+"T00:00:00")-base);
  if(orderAmount>0){
    const tol=Math.max(0.5,orderAmount*0.02);
    const exact=matches.filter(m=>Math.abs(Math.abs(m.amount_usd)-orderAmount)<=tol);
    if(exact.length)return exact.sort(byDate)[0];
  }
  return matches.sort(byDate)[0];
}

async function linkRakutenCashback(rakutenCandidates,allValid,createdTxns){
  for(const c of rakutenCandidates){
    const idx=allValid.indexOf(c);
    const newTxn=createdTxns[idx];
    if(!newTxn?.id)continue;
    const store=c._parsedData.store_name||c.description;
    const orderAmt=parseFloat(c._parsedData.order_amount)||0;
    const searchDate=c._parsedData.order_date||c.date;
    try{
      // Use the link the reviewer saw/confirmed before approving; otherwise search.
      // An explicit unlink (_linkCleared) suppresses the fallback search.
      let parent=null;
      if(c._linkToTransactionId){
        const got=await sb(`transactions?id=eq.${c._linkToTransactionId}&limit=1&select=id,date,description,amount_usd,category_id,payment_type,transaction_group_id,service_start,service_end`);
        parent=got&&got[0];
      }
      if(!parent&&!c._linkCleared)parent=await findRakutenParentMatch(store,orderAmt,searchDate);
      if(parent){
        await linkToGroup(parent,{id:newTxn.id,transaction_group_id:newTxn.transaction_group_id||null});
        // Inherit category and service dates from the parent purchase.
        const patch={};
        if(parent.category_id)patch.category_id=parent.category_id;
        if(parent.service_start)patch.service_start=parent.service_start;
        if(parent.service_end)patch.service_end=parent.service_end;
        if(parent.service_start&&parent.service_end){
          const sd=Math.max(1,Math.round((new Date(parent.service_end)-new Date(parent.service_start))/864e5)+1);
          patch.service_days=sd;
          patch.daily_cost=Math.round(c.amount_usd/sd*1e6)/1e6;
        }
        if(Object.keys(patch).length)await sb(`transactions?id=eq.${newTxn.id}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify(patch)});
      }
      // Always record the cashback in the rewards ledger.
      const dv=Math.abs(c.amount_usd);
      await sb("cashback_redemptions",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
        date:c.date,item:c.description,payment_type:"Rakuten",
        cashback_type:"Dollar Value",redemption_amount:dv,redemption_rate:1,
        dollar_value:dv,transaction_id:newTxn.id
      })});
      console.log(parent
        ?`Rakuten: linked "${c.description}" to "${parent.description}" (cat: ${parent.category_id}) + cashback record`
        :`Rakuten: no parent found for "${store}" around ${searchDate} \u2014 cashback record only`);
    }catch(e){console.error(`Rakuten link error for "${store}":`,e)}
  }
}

async function scanForReimbursementLinks(){
  try{
    const cutoff=new Date(Date.now()-90*864e5).toISOString().slice(0,10);
    const reimbursements=await sb(
      `transactions?payment_type=eq.Venmo&amount_usd=lt.0`+
      `&transaction_group_id=is.null&date=gte.${cutoff}`+
      `&select=id,date,description,amount_usd,category_id,tag`
    );
    if(!reimbursements.length)return;
    const expandedCutoff=new Date(Date.now()-120*864e5).toISOString().slice(0,10);
    const expenses=await sb(
      `transactions?amount_usd=gt.0&transaction_group_id=is.null`+
      `&date=gte.${expandedCutoff}`+
      `&select=id,date,description,amount_usd,category_id,payment_type,tag,service_start,service_end,transaction_group_id`
    );
    const links=[];
    for(const reimb of reimbursements){
      const reimbAmt=Math.abs(reimb.amount_usd);
      const noteMatch=reimb.description.match(/Reimbursed - (.+?)(?:\s*\(.+?\))?\s*-\s*\w+$/);
      const reimbNote=noteMatch?noteMatch[1].toLowerCase().trim():"";
      let bestMatch=null,bestScore=0;
      for(const exp of expenses){
        let score=0;
        if(reimbAmt>exp.amount_usd*1.05)continue;
        const ratio=reimbAmt/exp.amount_usd;
        const CLEAN_FRACTIONS=[1,1/2,1/3,1/4,1/5,2/3,3/4,2/5,3/5,4/5];
        const isCleanFraction=CLEAN_FRACTIONS.some(f=>Math.abs(ratio-f)<0.03);
        if(Math.abs(reimbAmt-exp.amount_usd)<1.0)score+=40;
        else if(isCleanFraction)score+=35;
        else if(reimbAmt<exp.amount_usd)score+=10;
        const daysDiff=Math.abs((new Date(reimb.date)-new Date(exp.date))/864e5);
        if(daysDiff<=3)score+=25;
        else if(daysDiff<=14)score+=20;
        else if(daysDiff<=30)score+=10;
        else if(daysDiff<=90)score+=5;
        else continue;
        const expDesc=exp.description.toLowerCase();
        if(reimbNote&&expDesc.includes(reimbNote))score+=35;
        else if(reimbNote){
          const words=reimbNote.split(/\s+/).filter(w=>w.length>=3);
          const matches=words.filter(w=>expDesc.includes(w));
          if(matches.length>0)score+=15*(matches.length/words.length);
        }
        if(reimb.category_id&&reimb.category_id===exp.category_id)score+=10;
        if(reimb.tag&&reimb.tag===exp.tag)score+=10;
        if(score>bestScore){bestScore=score;bestMatch=exp}
      }
      if(bestMatch&&bestScore>=60){
        links.push({reimbursement:reimb,expense:bestMatch,score:bestScore});
        expenses.splice(expenses.indexOf(bestMatch),1);
      }
    }
    // Filter out previously rejected pairs
    const filtered=links.filter(l=>!isLinkRejected(l.reimbursement.id,l.expense.id));
    if(filtered.length>0)showLinkConfirmModal(filtered);
  }catch(e){console.error("Link scan error:",e)}
}

function rejectedLinkKey(idA,idB){return[idA,idB].sort((a,b)=>a-b).join(":")}
function isLinkRejected(idA,idB){
  try{const s=localStorage.getItem("rejected_links");if(!s)return false;return JSON.parse(s).includes(rejectedLinkKey(idA,idB))}
  catch(e){return false}
}
function rejectLinks(links){
  try{
    const s=localStorage.getItem("rejected_links");
    const existing=s?JSON.parse(s):[];
    links.forEach(l=>{const k=rejectedLinkKey(l.reimbursement.id,l.expense.id);if(!existing.includes(k))existing.push(k)});
    localStorage.setItem("rejected_links",JSON.stringify(existing));
  }catch(e){console.warn("Failed to save rejected links:",e)}
}
function lotRejKey(r){return`${r.symbol}:${String(r.lot_date).slice(0,10)}:${parseFloat(r.shares).toFixed(4)}`}
function isLotRejected(r){
  try{const s=localStorage.getItem("rejected_lots");if(!s)return false;return JSON.parse(s).includes(lotRejKey(r))}
  catch(e){return false}
}
function persistLotRejection(r,rejected){
  try{
    const s=localStorage.getItem("rejected_lots");const existing=s?JSON.parse(s):[];const k=lotRejKey(r);
    const idx=existing.indexOf(k);
    if(rejected&&idx<0)existing.push(k);
    else if(!rejected&&idx>=0)existing.splice(idx,1);
    localStorage.setItem("rejected_lots",JSON.stringify(existing));
  }catch(e){console.warn("Failed to save rejected lot:",e)}
}

async function applyReimbursementLinks(links){
  for(const link of links){
    const expDate=link.expense.date,expSS=link.expense.service_start||expDate,expSE=link.expense.service_end||expDate;
    const reimbSD=Math.round((new Date(expSE)-new Date(expSS))/864e5)+1;
    const reimbDC=link.reimbursement.amount_usd/reimbSD;
    const groupId=link.expense.transaction_group_id||Math.min(link.expense.id,link.reimbursement.id);
    await sb(`transactions?id=eq.${link.reimbursement.id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({
      transaction_group_id:groupId,
      date:expDate,service_start:expSS,service_end:expSE,
      service_days:reimbSD,daily_cost:reimbDC,
      ...(link.reimbursement.category_id==="other"?{category_id:link.expense.category_id}:{})
    })});
    if(!link.expense.transaction_group_id){
      await sb(`transactions?id=eq.${link.expense.id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:groupId})});
    }
  }
  console.log(`Linked ${links.length} reimbursement(s)`);
}

function showLinkConfirmModal(links){
  const bg=h("div",{class:"modal-bg"});
  const modal=h("div",{class:"modal",style:{maxWidth:"560px"}});
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px"}});
  const hdrText=h("div",{});
  hdrText.append(h("h3",{style:{margin:"0",fontSize:"18px"}},"Confirm Auto-Links"));
  hdrText.append(h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.4)",marginTop:"4px"}},`${links.length} suggested link${links.length>1?"s":""} — uncheck to reject permanently`));
  hdr.append(hdrText);
  const closeBtn=h("button",{style:{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",width:"32px",height:"32px",cursor:"pointer",color:"rgba(255,255,255,0.5)",fontSize:"16px"},onClick:()=>bg.remove()},"✕");
  hdr.append(closeBtn);
  modal.append(hdr);
  const checkboxes=[];
  links.forEach((link,i)=>{
    const row=h("div",{style:{background:"rgba(255,255,255,0.04)",borderRadius:"8px",padding:"12px 14px",marginBottom:"8px",display:"flex",gap:"12px",alignItems:"flex-start"}});
    const chk=h("input",{type:"checkbox",checked:true,style:{marginTop:"3px",flexShrink:"0"}});
    checkboxes.push(chk);
    const info=h("div",{style:{flex:"1",fontSize:"13px"}});
    const reimbColor=link.reimbursement.amount_usd<0?"#81B29A":"rgba(255,255,255,0.7)";
    const expRow=h("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:"4px"}});
    expRow.append(h("span",{style:{color:"rgba(255,255,255,0.7)"}},link.expense.description));
    expRow.append(h("span",{style:{fontFamily:"var(--mono)",color:"rgba(255,255,255,0.5)"}},fmtF(link.expense.amount_usd)));
    const reimbRow=h("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:"6px"}});
    reimbRow.append(h("span",{style:{color:reimbColor}},link.reimbursement.description));
    reimbRow.append(h("span",{style:{fontFamily:"var(--mono)",color:reimbColor}},fmtF(link.reimbursement.amount_usd)));
    const meta=h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.25)"}},`${fmtD(link.expense.date)} · ${link.expense.payment_type||""} · score ${link.score}`);
    info.append(expRow,reimbRow,meta);
    row.append(chk,info);
    modal.append(row);
  });
  const errEl=h("div",{style:{color:"var(--r)",fontSize:"11px",minHeight:"16px",marginBottom:"4px"}});
  modal.append(errEl);
  const btnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto",gap:"8px",marginTop:"8px"}});
  const confirmBtn=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
    const selected=links.filter((_,i)=>checkboxes[i].checked);
    const rejected=links.filter((_,i)=>!checkboxes[i].checked);
    if(rejected.length)rejectLinks(rejected);
    if(!selected.length){bg.remove();return}
    confirmBtn.textContent="Linking...";confirmBtn.disabled=true;
    try{await applyReimbursementLinks(selected);bg.remove()}
    catch(e){errEl.textContent="Failed: "+e.message;confirmBtn.textContent="Link Selected";confirmBtn.disabled=false}
  }},"Link Selected");
  const rejectAllBtn=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>{rejectLinks(links);bg.remove()}},"Reject All");
  btnRow.append(confirmBtn,rejectAllBtn);
  modal.append(btnRow);
  bg.append(modal);
  document.body.append(bg);
}

async function linkToGroup(txnA,txnB){
  const gA=txnA.transaction_group_id,gB=txnB.transaction_group_id;
  let targetGroup;
  if(gA&&gB&&gA!==gB){
    targetGroup=Math.min(gA,gB);const oldGroup=Math.max(gA,gB);
    await sb(`transactions?transaction_group_id=eq.${oldGroup}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:targetGroup})});
  }else if(gA){targetGroup=gA}
  else if(gB){targetGroup=gB}
  else{targetGroup=Math.min(txnA.id,txnB.id)}
  const ids=[txnA.id,txnB.id].filter(id=>{const t=id===txnA.id?txnA:txnB;return t.transaction_group_id!==targetGroup});
  if(ids.length){await sb(`transactions?id=in.(${ids.join(",")})`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:targetGroup})})}
  txnA.transaction_group_id=targetGroup;txnB.transaction_group_id=targetGroup;
  return targetGroup;
}

async function unlinkFromGroup(txnId,groupId){
  await sb(`transactions?id=eq.${txnId}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:null})});
  const remaining=await sb(`transactions?transaction_group_id=eq.${groupId}&select=id`);
  if(remaining.length<=1&&remaining.length>0){
    await sb(`transactions?id=eq.${remaining[0].id}`,{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({transaction_group_id:null})});
  }
}

async function fetchReimburseFriends(){
  const reimbRows=await sb("transactions?description=like.Reimbursed*&amount_usd=lt.0&select=description,date&order=date.desc&limit=5000");
  const seen={};const result=[];
  for(const r of reimbRows){const m=r.description.match(/-\s*(\w+)\s*$/);if(m){const name=m[1].trim();if(!seen[name]){seen[name]=true;result.push(name)}}}
  return result.slice(0,15);
}

async function createReimbursement(originalTxn,person,splitRatio,paymentType,note,credit){
  const reimbAmount=Math.round(-(originalTxn.amount_usd*splitRatio)*100)/100;
  const ss=originalTxn.service_start||originalTxn.date;
  const se=originalTxn.service_end||originalTxn.date;
  const serviceDays=Math.max(1,Math.round((new Date(se)-new Date(ss))/864e5)+1);
  const dailyCost=Math.round(reimbAmount/serviceDays*1e6)/1e6;
  const firstName=person.split(" ")[0];
  const description=`Reimbursed - ${originalTxn.description} - ${firstName}`;
  const newTxn={
    date:originalTxn.date,
    service_start:ss,
    service_end:se,
    description,
    category_id:originalTxn.category_id,
    original_amount:reimbAmount,
    currency:"USD",
    fx_rate:1,
    amount_usd:reimbAmount,
    payment_type:paymentType,
    tag:(originalTxn.tag||"").toLowerCase().trim(),
    daily_cost:dailyCost,
    service_days:serviceDays,
    credit:paymentType==="Transfer"?(credit||""):""
  };
  const result=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(newTxn)});
  const newId=result[0]?.id;
  let groupId=null;
  if(newId){
    const newTxnObj={id:newId,transaction_group_id:null};
    groupId=await linkToGroup(originalTxn,newTxnObj);
  }
  state.txnCount++;
  // Cross-person mirror: if the reimbursing party is a household member, queue
  // a pending expense in their ledger for approval (plan Phase 5).
  try{await mirrorReimbursementToHousehold(originalTxn,person,reimbAmount,paymentType,ss,se,serviceDays)}
  catch(e){console.warn("Household reimbursement mirror failed:",e)}
  // Return linkage so the caller can optionally push to Splitwise (FEA-29C).
  return{result,newId,groupId,originalId:originalTxn.id,reimbAmount};
}

// ── Splitwise write-back (FEA-29C) ──
// Call the auth-gated splitwise-sync Edge Function with a write action.
async function swCallEdge(payload){
  const token=(typeof currentSession!=="undefined"&&currentSession?.access_token)||SB_KEY;
  const r=await fetch(`${SB_URL}/functions/v1/splitwise-sync`,{
    method:"POST",
    headers:{"Authorization":`Bearer ${token}`,"apikey":SB_KEY,"Content-Type":"application/json"},
    body:JSON.stringify(payload||{})
  });
  const txt=await r.text();
  let data;try{data=txt?JSON.parse(txt):{}}catch(e){throw new Error(txt||"Bad response")}
  if(!r.ok)throw new Error(typeof data.error==="string"?data.error:(data.error?JSON.stringify(data.error):`${r.status}`));
  return data;
}
async function swFetchFriends(){const d=await swCallEdge({action:"friends"});return d.friends||[]}
async function swFetchGroups(){const d=await swCallEdge({action:"groups"});return d.groups||[]}
async function swCreateExpense(payload){return await swCallEdge({...(payload||{}),action:"create_expense"})}

// Persisted label -> Splitwise friend mapping, scoped to the logged-in user.
function normPersonLabel(s){return String(s||"").trim().toLowerCase()}
async function getSwFriendMap(label){
  const key=normPersonLabel(label);if(!key)return null;
  try{
    const rows=await sb(`splitwise_friend_map?person_label=eq.${encodeURIComponent(key)}&limit=1${importerQS()}`);
    return (rows&&rows[0])||null;
  }catch(e){console.warn("getSwFriendMap failed:",e);return null}
}
async function saveSwFriendMap(label,friend,group){
  const key=normPersonLabel(label);if(!key||!friend||!friend.id)return;
  // Replace any prior mapping for this label (scoped to the importing user).
  try{await sb(`splitwise_friend_map?person_label=eq.${encodeURIComponent(key)}${importerQS()}`,{method:"DELETE",headers:{"Prefer":"return=minimal"}});}catch(e){}
  const row={person_label:key,sw_user_id:friend.id,sw_name:friend.name||""};
  if(group&&group.id){row.sw_group_id=group.id;row.sw_group_name=group.name||""}
  await sb("splitwise_friend_map",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify(row)});
}

// Resolve a free-text person name to another household member's owner key.
function resolveHouseholdOwner(person){
  if(!person||!householdMembers||!householdMembers.length)return null;
  const p=person.trim().toLowerCase();
  if(!p)return null;
  for(const m of householdMembers){
    if(m.owner===currentOwner)continue;
    const dn=(m.display_name||"").toLowerCase();
    const fn=dn.split(" ")[0];
    if(dn===p||fn===p||m.owner.toLowerCase()===p||(fn&&p.startsWith(fn)))return m.owner;
  }
  return null;
}

// Queue the other person's share as a pending expense in their ledger.
async function mirrorReimbursementToHousehold(originalTxn,person,reimbAmount,paymentType,ss,se,serviceDays){
  if(currentOwner==null||currentHousehold==null)return;
  const toOwner=resolveHouseholdOwner(person);
  if(!toOwner)return;
  const shareAmt=Math.abs(reimbAmount);
  if(!(shareAmt>0))return;
  const proposed={
    date:originalTxn.date,
    service_start:ss,service_end:se,
    description:originalTxn.description,
    category_id:originalTxn.category_id,
    original_amount:shareAmt,currency:"USD",fx_rate:1,
    amount_usd:shareAmt,
    payment_type:paymentType,
    tag:(originalTxn.tag||"").toLowerCase().trim(),
    daily_cost:Math.round(shareAmt/serviceDays*1e6)/1e6,
    service_days:serviceDays,
    credit:"",
    owner:toOwner,
    household_id:currentHousehold
  };
  await sb("pending_shared_txns",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
    household_id:currentHousehold,
    from_owner:currentOwner,
    to_owner:toOwner,
    source_txn_id:originalTxn.id,
    proposed_txn:proposed,
    status:"pending"
  })});
}

// Inbox: surface pending shared transactions addressed to the signed-in user.
async function checkPendingSharedTxns(){
  if(currentOwner==null)return;
  try{
    const rows=await sb(`pending_shared_txns?to_owner=eq.${encodeURIComponent(currentOwner)}&status=eq.pending&order=created_at.desc`);
    const old=document.getElementById("sharedTxnBanner");if(old)old.remove();
    if(!rows||!rows.length)return;
    const banner=document.createElement("div");
    banner.id="sharedTxnBanner";
    banner.style.cssText="background:rgba(129,178,154,0.15);color:var(--g);text-align:center;padding:6px 12px;font-size:11px;border-bottom:1px solid rgba(129,178,154,0.2);cursor:pointer";
    banner.innerHTML=`\uD83E\uDD1D ${rows.length} shared transaction${rows.length>1?"s":""} to review \u2014 <b>Review</b>`;
    banner.onclick=()=>showSharedTxnApprovalModal(rows);
    const hdr=document.querySelector(".hdr");if(hdr)hdr.after(banner);
  }catch(e){console.warn("Shared txn check failed:",e)}
}

function showSharedTxnApprovalModal(rows){
  const existing=document.querySelector(".modal-bg");if(existing)existing.remove();
  const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg)bg.remove()}});
  const modal=h("div",{class:"modal",style:{maxWidth:"560px"}});
  const hdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px"}});
  const hdrText=h("div",{});
  hdrText.append(h("h3",{style:{margin:"0",fontSize:"18px"}},"Shared Transactions"));
  hdrText.append(h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.4)",marginTop:"4px"}},"Approve to add to your ledger, or reject"));
  hdr.append(hdrText);
  hdr.append(h("button",{style:{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",width:"32px",height:"32px",cursor:"pointer",color:"rgba(255,255,255,0.5)",fontSize:"16px"},onClick:()=>bg.remove()},"\u2715"));
  modal.append(hdr);
  const list=h("div",{});
  modal.append(list);

  function memberName(owner){const m=(householdMembers||[]).find(x=>x.owner===owner);return m?m.display_name:owner}

  function renderRows(){
    list.innerHTML="";
    const pend=rows.filter(r=>r.status==="pending");
    if(!pend.length){bg.remove();const b=document.getElementById("sharedTxnBanner");if(b)b.remove();return}
    pend.forEach(r=>{
      const p=r.proposed_txn||{};
      const row=h("div",{style:{background:"rgba(255,255,255,0.04)",borderRadius:"8px",padding:"12px 14px",marginBottom:"8px"}});
      const top=h("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:"6px"}});
      top.append(h("span",{style:{color:"rgba(255,255,255,0.85)",fontSize:"13px"}},p.description||"(no description)"));
      top.append(h("span",{style:{fontFamily:"var(--mono)",color:"var(--r)",fontSize:"13px"}},fmtF(p.amount_usd||0)));
      const meta=h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.35)",marginBottom:"8px"}},
        `${fmtD(p.date)} \u00B7 ${p.category_id||""} \u00B7 ${p.payment_type||""} \u00B7 from ${memberName(r.from_owner)}`);
      const btns=h("div",{style:{display:"flex",gap:"8px"}});
      const err=h("div",{style:{color:"var(--r)",fontSize:"11px",minHeight:"14px",marginTop:"6px"}});
      const approve=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)",padding:"8px 16px",width:"auto"},onClick:async()=>{
        approve.disabled=true;approve.textContent="Adding...";
        try{
          await sb("transactions",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify(p)});
          await sb(`pending_shared_txns?id=eq.${r.id}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({status:"approved",resolved_at:new Date().toISOString()})});
          r.status="approved";dcInvalidateTxns();state.txnCount++;
          document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
          renderRows();
        }catch(e){err.textContent="Failed: "+e.message;approve.disabled=false;approve.textContent="Approve"}
      }},"Approve");
      const reject=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",padding:"8px 16px",width:"auto"},onClick:async()=>{
        reject.disabled=true;reject.textContent="...";
        try{
          await sb(`pending_shared_txns?id=eq.${r.id}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({status:"rejected",resolved_at:new Date().toISOString()})});
          r.status="rejected";renderRows();
        }catch(e){err.textContent="Failed: "+e.message;reject.disabled=false;reject.textContent="Reject"}
      }},"Reject");
      btns.append(approve,reject);
      row.append(top,meta,btns,err);
      list.append(row);
    });
  }
  renderRows();
  bg.append(modal);document.body.append(bg);
}
