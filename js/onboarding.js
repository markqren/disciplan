// Onboarding module — per-user account setup, CSV import, and opening-balance
// reconciliation. Imports run through the existing calibrated pipeline; AI
// personalization is scoped to the signed-in user (see importerQS / fetch* in
// ai-categorize.js). All writes auto-stamp owner via sb().

const OB_ACCT_TYPES=[["checking","Checking"],["savings","Savings"],["credit","Credit Card"],["investment","Investment"],["liability","Liability"],["working_capital","Working Capital"]];
const OB_ASSET_TYPES=new Set(["checking","savings","investment","other"]);
function obIsAsset(t){return OB_ASSET_TYPES.has(t)}
// Stated current balances captured at account-add time, keyed by account label.
const obStatedBalance={};

async function renderOnboarding(el){
  el.innerHTML="";

  // On-behalf-of setup: writes follow the active person-view. The "acting" owner is
  // the viewed member when you may write them (admin), else the signed-in user. So
  // Mark viewing Shilpa sets up Shilpa's books; Combined/own-view acts as yourself.
  const viewOwner=scopeOwner();                               // null = Combined/legacy
  const acting=(viewOwner!=null&&canWriteOwner(viewOwner))?viewOwner:currentOwner;
  const actingName=(householdMembers.find(m=>m.owner===acting)||{}).display_name||currentDisplayName||"you";
  const readOnly=viewOwner!=null&&!canWriteOwner(viewOwner); // viewing a member you cannot write
  // PostgREST scope for the acting owner (generalizes importerQS to the viewed person).
  const actQS=currentHousehold!=null?`&household_id=eq.${currentHousehold}`+(acting!=null?`&owner=eq.${encodeURIComponent(acting)}`:""):"";

  const intro=h("div",{class:"cd"});
  intro.innerHTML=`<h2 style="margin:0 0 6px">Onboarding</h2><p class="sub" style="margin:0">Set up accounts, import their transactions, then reconcile each account to its current balance${currentOwner?` — for ${actingName}`:""}.</p>`;
  el.append(intro);

  if(currentOwner==null){
    const warn=h("div",{class:"cd",style:{borderColor:"rgba(242,204,143,0.3)",color:"var(--y)",fontSize:"12px"}},
      "Multi-user profile not loaded. New accounts and imports will not be owner-stamped until you are signed in with a household profile.");
    el.append(warn);
  }

  if(readOnly){
    const note=h("div",{class:"cd",style:{borderColor:"rgba(242,204,143,0.3)",color:"var(--y)",fontSize:"12px"}},
      `You're viewing ${actingName}'s setup. Only ${actingName} (or a household admin) can add or import accounts here — switch to your own view or Combined to set up your own.`);
    el.append(note);
    return;
  }

  let accts=[];
  // "My Accounts" is the acting owner's set — the signed-in user normally, or the
  // viewed member when an admin is setting them up. Scoping the list to one person
  // keeps the duplicate-name check per-person and never falsely blocks adding an
  // account another household member already owns.
  try{accts=await sb("accounts?order=display_order"+actQS)}catch(e){accts=[]}

  // ── Card 1: My Accounts ─────────────────────────────────────────────────
  const acctCard=h("div",{class:"cd"});
  acctCard.append(h("h3",{style:{marginTop:"0"}},"My Accounts"));
  const acctList=h("div",{style:{marginBottom:"16px"}});
  function renderAcctList(){
    acctList.innerHTML="";
    if(!accts.length){acctList.append(h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.3)",padding:"8px 0"}},"No accounts yet. Add one below to start importing."));return}
    accts.forEach(a=>{
      const r=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",borderRadius:"8px",background:"rgba(255,255,255,0.02)",marginBottom:"6px"}});
      const typeLbl=(OB_ACCT_TYPES.find(t=>t[0]===a.account_type)||[a.account_type,a.account_type])[1];
      r.innerHTML=`<span style="color:rgba(255,255,255,0.75);font-weight:500">${a.label}</span><span style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.04em">${typeLbl}${a.is_active===false?" · inactive":""}</span>`;
      acctList.append(r);
    });
  }
  renderAcctList();
  acctCard.append(acctList);

  const labelInp=h("input",{class:"inp",type:"text",placeholder:"e.g., Chase United Club"});
  const typeSel=h("select",{class:"inp"});
  OB_ACCT_TYPES.forEach(([v,l])=>{const o=h("option",{value:v},l);if(v==="credit")o.selected=true;typeSel.append(o)});
  const balInp=h("input",{class:"inp",type:"number",step:"0.01",placeholder:"e.g., 1234.56"});
  function obField(lbl,input){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(input);return d}
  function obRow(...kids){const d=h("div",{style:{display:"grid",gridTemplateColumns:`repeat(${kids.length},1fr)`,gap:"12px",marginBottom:"12px"}});kids.forEach(k=>d.append(k));return d}
  const addStatus=h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.4)",marginTop:"6px"},class:"hidden"});
  const addBtn=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
    const label=labelInp.value.trim();
    if(!label)return alert("Enter an account name.");
    if(accts.some(a=>a.label.toLowerCase()===label.toLowerCase()))return alert("An account with that name already exists.");
    addBtn.disabled=true;addBtn.textContent="Adding...";
    try{
      const maxOrder=accts.reduce((m,a)=>Math.max(m,a.display_order||0),0);
      // accounts.id is a text slug PK (e.g. "venmo"), not auto-generated — derive one.
      // The PK is shared across the WHOLE household, so two members adding the same
      // institution (both "Charles Schwab") would collide. De-dup against every
      // household account id and suffix the owner so each gets a readable, unique slug.
      let existingIds;
      try{existingIds=new Set((await sb("accounts?select=id"+householdQS())).map(a=>a.id).filter(Boolean))}
      catch(e){existingIds=new Set(accts.map(a=>a.id).filter(Boolean))}
      const base=label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")||"account";
      let id=base;
      if(existingIds.has(id)&&acting)id=`${base}_${acting}`;
      let n=2;while(existingIds.has(id))id=`${base}_${n++}`;
      const acctType=typeSel.value;
      const created=await sb("accounts",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({id,label,account_type:acctType,display_order:maxOrder+1,is_active:true})});
      const row=Array.isArray(created)?created[0]:created;
      accts.push(row||{id,label,account_type:acctType,display_order:maxOrder+1,is_active:true});
      const balVal=parseFloat(balInp.value);
      let openMsg="";
      if(!isNaN(balVal)){
        obStatedBalance[label]=balVal;
        // Show the account on the Balance Sheet immediately at its stated amount.
        // net_balance = -SUM(amount_usd), so amount_usd = -target (target signed
        // by account type). category "adjustment" keeps it out of the income stmt.
        const isAsset=obIsAsset(acctType);
        const target=isAsset?balVal:-Math.abs(balVal);
        if(Math.abs(target)>=0.01){
          const d=today();
          await sb("transactions",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
            date:d,service_start:d,service_end:d,service_days:1,
            description:`Opening Balance - ${label}`,category_id:"adjustment",
            amount_usd:-target,original_amount:-target,currency:"USD",fx_rate:1,
            daily_cost:-target,payment_type:label,tag:"",credit:""
          })});
          state.txnCount++;
          const ds=document.getElementById("dbStatus");if(ds)ds.textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
          dcClearAll();
          openMsg=` with opening balance ${fmtF(target)}`;
        }
      }
      labelInp.value="";balInp.value="";
      invalidateAcctLabels();
      renderAcctList();refreshAccountPickers(label);
      addStatus.classList.remove("hidden");addStatus.style.color="var(--g)";addStatus.textContent=`\u2713 Added ${label}${openMsg}`;
    }catch(e){addStatus.classList.remove("hidden");addStatus.style.color="var(--r)";addStatus.textContent="Error: "+e.message}
    addBtn.disabled=false;addBtn.textContent="Add Account";
  }},"Add Account");

  acctCard.append(obRow(obField("Account Name",labelInp),obField("Type",typeSel),obField("Current Balance (optional)",balInp)));
  acctCard.append(addBtn);
  acctCard.append(addStatus);
  el.append(acctCard);

  // ── Card 2: Import transactions ─────────────────────────────────────────
  const impCard=h("div",{class:"cd"});
  impCard.append(h("h3",{style:{marginTop:"0"}},"Import Transactions"));

  const impAcctSel=h("select",{class:"inp"});
  const fileInp=h("input",{class:"inp",type:"file",accept:".csv",multiple:true});
  const tagInp=h("input",{class:"inp",type:"text",placeholder:"Bulk tag for all rows"});
  const modelSel=h("select",{class:"inp",style:{maxWidth:"200px"},onChange:()=>setAIModel(modelSel.value)});
  [["claude-haiku-4-5-20251001","Haiku 4.5 (fast)"],["claude-sonnet-4-20250514","Sonnet 4 (quality)"]].forEach(([v,l])=>{const o=h("option",{value:v},l);if(v===getAIModel())o.selected=true;modelSel.append(o)});
  const modelField=h("div");
  modelField.append(h("label",{class:"lbl"},"AI Model"));
  modelField.append(modelSel);

  const impStatus=h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.4)",margin:"10px 0"},class:"hidden"});
  const impReview=h("div");

  const impBtn=h("button",{class:"btn",style:{background:"rgba(74,111,165,0.2)",color:"var(--b)"},onClick:async()=>{
    const pt=impAcctSel.value;
    if(!pt)return alert("Add and select an account first.");
    const files=Array.from(fileInp.files||[]);
    if(!files.length)return alert("Choose one or more CSV files first.");
    if(!aiAvailable()&&!confirm("AI unavailable (not signed in). Import with basic category mapping only?"))return;
    impBtn.disabled=true;impBtn.textContent="Processing...";
    impStatus.classList.remove("hidden");impStatus.style.color="rgba(255,255,255,0.4)";
    try{
      const tag=tagInp.value.trim();
      // Parse every selected file (Chase caps CSV downloads at ~1000 rows, so an
      // initial onboard can span several files) and merge into one candidate set.
      let candidates=[];
      let profile=null;
      for(let fi=0;fi<files.length;fi++){
        const file=files[fi];
        impStatus.textContent=`Parsing ${file.name} (${fi+1}/${files.length})...`;
        const text=await file.text();
        let csv=parseCSV(text);
        if(!csv.rows.length)continue;
        const fp=detectBankProfile(csv.headers);
        if(!fp)throw new Error(`Unrecognized bank format in ${file.name}. Supported: Chase CC, Chase Chequing, AMEX, Bilt`);
        if(profile&&fp.name!==profile.name)throw new Error(`Mixed bank formats: ${file.name} is ${fp.name} but earlier files are ${profile.name}. Import one account format at a time.`);
        profile=fp;
        if(fp.reparse)csv=fp.reparse(text);
        for(const r of csv.rows)candidates.push(transformCSVRow(r,fp,pt,tag,candidates.length));
      }
      if(!candidates.length)throw new Error("No data rows found in the selected file(s).");
      // De-duplicate rows that repeat across overlapping file ranges before any
      // DB checks, so overlapping downloads do not double-import.
      let intraDupes=0;
      const seen=new Set();
      for(const c of candidates){
        if(c._status==="skipped")continue;
        const key=`${c.date}|${Math.abs(Math.round((c.amount_usd||0)*100))}|${(c._rawDescription||c.description||"").trim().toLowerCase()}`;
        if(seen.has(key)){c._status="skipped";c._isDuplicate=true;c._skipReason="Duplicate (within upload)";intraDupes++}
        else seen.add(key);
      }
      impStatus.textContent="AI categorizing (personalized to your history)...";
      const[patterns,samples,subs,rules]=await Promise.all([fetchMerchantPatterns(),fetchSampleDescriptions(),fetchSubscriptions(),fetchAIRules()]);
      const aiResults=await aiCategorize(candidates,patterns,samples,!!profile.isCheckingAccount,profile.name,subs,rules,(n,t)=>{impStatus.textContent=`AI categorizing ${n}/${t} (personalized to your history)...`});
      applyAIResults(candidates,aiResults,subs);
      impStatus.textContent="Checking for duplicates...";
      await findDuplicates(candidates,pt);
      const pending=candidates.filter(c=>c._status==="pending").length;
      const fileNote=files.length>1?`${files.length} files \u00b7 ${candidates.length} rows${intraDupes?` \u00b7 ${intraDupes} cross-file duplicates skipped`:""} \u00b7 `:"";
      const aiMsg=aiResults?"AI categorization complete. Review and approve below, then reconcile the balance.":aiAvailable()?"AI call failed \u2014 descriptions left raw. Check connection/credits and re-import.":"AI unavailable \u2014 descriptions left raw. Sign in and re-import.";
      impStatus.textContent=fileNote+(!pending?"All transactions are duplicates or skipped.":aiMsg);
      if(!aiResults){impStatus.style.color="var(--y)"}
      renderReviewTable(impReview,candidates);
    }catch(e){impStatus.textContent="Error: "+e.message;impStatus.style.color="var(--r)"}
    impBtn.disabled=false;impBtn.textContent="Import";
  }},"Import");

  impCard.append(obRow(obField("Account",impAcctSel),obField("CSV File(s) \u2014 select multiple",fileInp)));
  impCard.append(obRow(obField("Bulk Tag (optional)",tagInp),modelField));
  impCard.append(impBtn);
  impCard.append(impStatus);
  impCard.append(impReview);
  el.append(impCard);

  // ── Card 3: Reconcile balance ───────────────────────────────────────────
  const recCard=h("div",{class:"cd"});
  recCard.append(h("h3",{style:{marginTop:"0"}},"Reconcile to Current Balance"));
  recCard.append(h("p",{class:"sub",style:{marginTop:"0"}},"After importing, set the account's real current balance. A single adjustment transaction trues up the ledger without affecting your income statement."));
  const recAcctSel=h("select",{class:"inp"});
  const recBalInp=h("input",{class:"inp",type:"number",step:"0.01",placeholder:"Current balance"});
  recAcctSel.addEventListener("change",()=>{const v=obStatedBalance[recAcctSel.value];recBalInp.value=v!=null?v:""});
  const recOut=h("div",{style:{fontSize:"12px",margin:"10px 0",lineHeight:"1.7"},class:"hidden"});
  const recApplyBtn=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)",display:"none"}},"Create Adjustment");
  let recDelta=0,recLabel="";

  const recCheckBtn=h("button",{class:"btn",style:{background:"rgba(74,111,165,0.2)",color:"var(--b)"},onClick:async()=>{
    const label=recAcctSel.value;
    if(!label)return alert("Select an account.");
    const stated=parseFloat(recBalInp.value);
    if(isNaN(stated))return alert("Enter the current balance.");
    obStatedBalance[label]=stated;
    recCheckBtn.disabled=true;recCheckBtn.textContent="Checking...";
    try{
      const acct=accts.find(a=>a.label===label);
      const isAsset=obIsAsset(acct?.account_type);
      const target=isAsset?stated:-Math.abs(stated);
      const bals=await sbRPC("get_ledger_balances_scoped",{p_owner:acting,p_household_id:currentHousehold});
      const found=(bals||[]).find(b=>b.payment_type===label);
      const net=found?parseFloat(found.net_balance)||0:0;
      recDelta=Math.round((net-target)*100)/100;
      recLabel=label;
      recOut.classList.remove("hidden");
      recOut.innerHTML=`<div>Current ledger balance: <b style="font-family:var(--mono)">${fmtF(net)}</b></div>`+
        `<div>Target (stated) balance: <b style="font-family:var(--mono)">${fmtF(target)}</b></div>`+
        `<div>Adjustment to add: <b style="font-family:var(--mono);color:${Math.abs(recDelta)<0.01?"var(--g)":"var(--y)"}">${fmtF(recDelta)}</b></div>`;
      recApplyBtn.style.display=Math.abs(recDelta)<0.01?"none":"block";
      if(Math.abs(recDelta)<0.01)recOut.innerHTML+=`<div style="color:var(--g);margin-top:4px">\u2713 Already reconciled \u2014 no adjustment needed.</div>`;
    }catch(e){recOut.classList.remove("hidden");recOut.style.color="var(--r)";recOut.textContent="Error: "+e.message}
    recCheckBtn.disabled=false;recCheckBtn.textContent="Check Difference";
  }},"Check Difference");

  recApplyBtn.addEventListener("click",async()=>{
    if(!recLabel||Math.abs(recDelta)<0.01)return;
    recApplyBtn.disabled=true;recApplyBtn.textContent="Creating...";
    try{
      const earliest=await sb(`transactions?payment_type=eq.${encodeURIComponent(recLabel)}&select=date&order=date.asc&limit=1`+actQS);
      let d=earliest&&earliest.length?earliest[0].date:today();
      const dt=new Date(d+"T00:00:00");dt.setDate(dt.getDate()-1);
      const adjDate=dt.toISOString().slice(0,10);
      await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
        date:adjDate,service_start:adjDate,service_end:adjDate,service_days:1,
        description:`Opening Balance Adjustment - ${recLabel}`,category_id:"adjustment",
        amount_usd:recDelta,original_amount:recDelta,currency:"USD",fx_rate:1,
        daily_cost:recDelta,payment_type:recLabel,tag:"",credit:""
      })});
      state.txnCount++;
      const ds=document.getElementById("dbStatus");if(ds)ds.textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
      dcClearAll();
      recApplyBtn.style.display="none";
      recOut.innerHTML+=`<div style="color:var(--g);margin-top:6px">\u2713 Adjustment created on ${fmtD(adjDate)}. ${recLabel} now reconciles to ${fmtF(obIsAsset(accts.find(a=>a.label===recLabel)?.account_type)?obStatedBalance[recLabel]:-Math.abs(obStatedBalance[recLabel]))}.</div>`;
    }catch(e){alert("Error creating adjustment: "+e.message);recApplyBtn.disabled=false;recApplyBtn.textContent="Create Adjustment"}
  });

  recCard.append(obRow(obField("Account",recAcctSel),obField("Current Balance",recBalInp)));
  const recBtns=h("div",{style:{display:"flex",gap:"10px"}});
  recBtns.append(recCheckBtn,recApplyBtn);
  recCard.append(recBtns);
  recCard.append(recOut);
  el.append(recCard);

  // Populate the account dropdowns (import + reconcile) and keep them in sync.
  function refreshAccountPickers(selectLabel){
    for(const sel of [impAcctSel,recAcctSel]){
      const prev=selectLabel||sel.value;
      sel.innerHTML="";
      if(!accts.length){sel.append(h("option",{value:""},"No accounts yet"));continue}
      accts.forEach(a=>sel.append(h("option",{value:a.label},a.label)));
      if(prev&&accts.some(a=>a.label===prev))sel.value=prev;
    }
    const v=obStatedBalance[recAcctSel.value];recBalInp.value=v!=null?v:"";
  }
  refreshAccountPickers();
}
