function renderEntry(el){
  fetchCreditNames();
  const acctReady=acctLabelsReady();
  const card=h("div",{class:"cd"});
  card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><h3 style="margin:0">New Transaction</h3><span id="okMsg" class="ok-msg hidden">✓ Saved to Supabase</span></div>`;

  const t=today();
  let f={date:t,desc:"",cat:"groceries",amt:"",cur:"USD",pt:"Chase Sapphire",tag:"",fx:"",ss:t,se:getDefEnd("groceries",t),seManual:false,transfer:false,toPt:"Cash"};

  function row(...children){const d=h("div",{style:{display:"grid",gridTemplateColumns:children.length===3?"1fr 1fr 1fr":children.length===2?"1fr 1fr":"1fr 2fr",gap:"12px",marginBottom:"14px"}});children.forEach(c=>d.append(c));return d}
  function field(lbl,input){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(input);return d}

  const dateInp=h("input",{class:"inp",type:"date",value:f.date,onInput:e=>{f.date=e.target.value}});
  const descInp=h("input",{class:"inp",type:"text",placeholder:"e.g., Whole Foods groceries",onInput:e=>{f.desc=e.target.value}});

  const catSel=h("select",{class:"inp",onChange:e=>{f.cat=e.target.value;if(!f.seManual){f.ss=getDefStart(f.cat,f.date)||f.date;ssInp.value=f.ss;f.se=getDefEnd(f.cat,f.ss)||f.ss;seInp.value=f.se;updateHint()}updateXferVisibility()}});
  CATS_LIST.forEach(c=>{const o=h("option",{value:c.id},c.l);if(c.id==="groceries")o.selected=true;catSel.append(o)});

  const amtInp=h("input",{class:"inp",type:"number",step:"0.01",placeholder:"0.00",onInput:e=>{f.amt=e.target.value;updatePreview()}});
  const curSel=h("select",{class:"inp",onChange:e=>{
    f.cur=e.target.value;
    fxRow.style.display=f.cur!=="USD"?"grid":"none";
    if(f.cur!=="USD"){const lr=DFX[f.cur]||1;fxInp.value=lr;f.fx=String(lr);}
    else{fxInp.value="";f.fx="";}
    updatePreview();
  }});
  CURS.forEach(c=>curSel.append(h("option",{value:c},c)));

  const ssInp=h("input",{class:"inp",type:"date",value:f.ss,onInput:e=>{f.ss=e.target.value;if(!f.seManual){f.se=getDefEnd(f.cat,f.ss)||f.ss;seInp.value=f.se}updatePreview()}});
  const seInp=h("input",{class:"inp",type:"date",value:f.se,onInput:e=>{f.se=e.target.value;f.seManual=true;seInp.style.borderColor="rgba(242,204,143,0.3)";updatePreview()}});
  const hintSpan=h("span",{style:{color:"rgba(129,178,154,0.6)",textTransform:"none",letterSpacing:"0",fontWeight:"400",fontSize:"10px"}});
  function updateHint(){const r=ACCRUAL_D[f.cat];hintSpan.textContent=!f.seManual&&r?(r==="month"?"(Auto: full month)":`(Auto: ${r} days)`):""}
  updateHint();
  const seLbl=h("label",{class:"lbl"});seLbl.append("Service End ");seLbl.append(hintSpan);

  const fxInp=h("input",{class:"inp",type:"number",step:"0.0001",onInput:e=>{f.fx=e.target.value;updatePreview()}});
  const fxRow=h("div",{style:{display:"none",gridTemplateColumns:"1fr 2fr",gap:"12px",marginBottom:"14px"}});
  fxRow.append(field("FX Rate",fxInp));
  fxRow.append(h("div",{style:{display:"flex",alignItems:"flex-end",paddingBottom:"4px"}},h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.25)"}},"Live rate · edit to override")));

  const creditSel=buildCreditSelect("");
  const creditRow=h("div",{style:{display:"none",gridTemplateColumns:"1fr 2fr",gap:"12px",marginBottom:"14px"}});
  creditRow.append(field("Credit Sub-Account",creditSel));
  const ptSel=h("select",{class:"inp",onChange:e=>{f.pt=e.target.value;creditRow.style.display=f.pt==="Transfer"?"grid":"none";updatePreview()}});
  f.pt=fillPtSelect(ptSel,{prefer:["Chase Sapphire"],keep:["Transfer"]});
  const ptLabel=h("label",{class:"lbl"},"Payment Account");
  const ptField=h("div");ptField.append(ptLabel,ptSel);
  const toPtSel=h("select",{class:"inp",onChange:e=>{f.toPt=e.target.value;updatePreview()}});
  f.toPt=fillPtSelect(toPtSel,{prefer:["Cash"],keep:["Transfer"]});
  acctReady.then(()=>{
    f.pt=fillPtSelect(ptSel,{prefer:["Chase Sapphire"],keep:["Transfer"]});
    f.toPt=fillPtSelect(toPtSel,{prefer:["Cash"],keep:["Transfer"]});
    creditRow.style.display=f.pt==="Transfer"?"grid":"none";
    updatePreview();
  });
  const toRow=h("div",{style:{display:"none",gridTemplateColumns:"1fr 2fr",gap:"12px",marginBottom:"14px"}});
  toRow.append(field("To Account",toPtSel));
  const tagInp=h("input",{class:"inp",type:"text",placeholder:"e.g., cozumel",onInput:e=>f.tag=e.target.value});

  const previewEl=h("div",{class:"preview hidden",id:"entryPreview"});
  function updatePreview(){
    const a=parseFloat(f.amt);
    if(f.transfer){
      if(isNaN(a)||a<=0){previewEl.classList.add("hidden");return}
      const fx=f.fx?parseFloat(f.fx):DFX[f.cur]||1;
      const usd=Math.round((f.cur==="USD"?Math.abs(a):Math.abs(a)*fx)*100)/100;
      const same=f.pt===f.toPt;
      previewEl.classList.remove("hidden");
      previewEl.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Balance Transfer</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.7)">Moves <b style="font-family:var(--mono)">${fmtF(usd)}</b> from <b>${f.pt}</b> \u2192 <b>${f.toPt}</b></div>
      <div style="font-size:11px;color:rgba(129,178,154,0.7);margin-top:4px">Creates 2 linked rows \u00b7 nets to ${fmtF(0)}</div>
      ${same?`<div style="font-size:11px;color:var(--r);margin-top:4px">Pick two different accounts.</div>`:""}`;
      return;
    }
    if(isNaN(a)||!f.ss||!f.se){previewEl.classList.add("hidden");return}
    const ss=new Date(f.ss+"T00:00:00"),se=new Date(f.se+"T00:00:00");
    if(se<ss){previewEl.classList.add("hidden");return}
    const days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    const fx=f.fx?parseFloat(f.fx):DFX[f.cur]||1;
    const usd=f.cur==="USD"?a:a*fx;
    const daily=usd/days;
    previewEl.classList.remove("hidden");
    previewEl.innerHTML=`<div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Accrual Preview</div>
    <div style="display:grid;grid-template-columns:${f.cur!=="USD"?"1fr 1fr 1fr 1fr":"1fr 1fr 1fr"};gap:12px">
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">USD Amount</div><div style="font-size:18px;font-weight:700;color:#fff;font-family:var(--mono)">${fmtF(usd)}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Service Days</div><div style="font-size:18px;font-weight:700;color:var(--b);font-family:var(--mono)">${days}</div></div>
      <div><div style="font-size:10px;color:rgba(255,255,255,0.25)">Daily Cost</div><div style="font-size:18px;font-weight:700;color:var(--g);font-family:var(--mono)">${fmtF(daily)}/d</div></div>
      ${f.cur!=="USD"?`<div><div style="font-size:10px;color:rgba(255,255,255,0.25)">FX Rate</div><div style="font-size:18px;font-weight:700;color:var(--y);font-family:var(--mono)">${fx}</div></div>`:""}
    </div>`;
  }

  function applyXferMode(){
    if(f.transfer){ptLabel.textContent="From Account";toRow.style.display="grid"}
    else{ptLabel.textContent="Payment Account";toRow.style.display="none"}
    submitBtn.textContent=f.transfer?"Add Transfer":"Add Transaction";
    updatePreview();
  }
  function updateXferVisibility(){
    const isFin=f.cat==="financial";
    xferWrap.classList.toggle("hidden",!isFin);
    if(!isFin&&f.transfer){f.transfer=false;xferChk.checked=false}
    applyXferMode();
  }

  const submitBtn=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
    const a=parseFloat(f.amt);if(isNaN(a)||!f.desc)return;
    const fx=f.fx?parseFloat(f.fx):DFX[f.cur]||1;
    if(f.transfer){
      if(f.pt===f.toPt){alert("Pick two different accounts for a transfer.");return}
      const orig=Math.abs(a);
      const usd=Math.round((f.cur==="USD"?orig:orig*fx)*100)/100;
      submitBtn.textContent="Saving...";
      try{
        const tagVal=f.tag.toLowerCase().trim();
        if(tagVal)await ensureTagExists(tagVal);
        const legs=[{pt:f.pt,usd:usd,oa:orig,sfx:`(from ${f.pt})`},{pt:f.toPt,usd:-usd,oa:-orig,sfx:`(to ${f.toPt})`}];
        const body=legs.map(l=>({date:f.date,service_start:f.date,service_end:f.date,description:`${f.desc} ${l.sfx}`,category_id:"financial",original_amount:l.oa,currency:f.cur,fx_rate:fx,amount_usd:l.usd,payment_type:l.pt,tag:tagVal,daily_cost:l.usd,service_days:1,credit:"",is_subscription:false}));
        const created=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(body)});
        dcInvalidateTxns();
        const ids=(created||[]).map(c=>c.id).filter(Boolean);
        if(ids.length===2)await linkToGroup({id:ids[0],transaction_group_id:null},{id:ids[1],transaction_group_id:null});
        const savedDesc=f.desc;
        descInp.value="";amtInp.value="";tagInp.value="";f.desc="";f.amt="";f.tag="";
        previewEl.classList.add("hidden");
        state.txnCount+=ids.length;
        document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
        if(ids.length)showUndo("\u2713 Transfer: "+savedDesc,async()=>{
          await sb(`transactions?id=in.(${ids.join(",")})`,{method:"DELETE"});
          state.txnCount-=ids.length;document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
        });
      }catch(e){alert("Error: "+e.message)}
      submitBtn.textContent=f.transfer?"Add Transfer":"Add Transaction";
      return;
    }
    const isInc=f.cat==="income";
    const orig=isInc?-Math.abs(a):a;
    const usd=f.cur==="USD"?orig:orig*fx;
    const ss=new Date(f.ss+"T00:00:00"),se=new Date(f.se+"T00:00:00");
    const days=Math.max(1,Math.floor((se-ss)/864e5)+1);
    submitBtn.textContent="Saving...";
    try{
      const tagVal=f.tag.toLowerCase().trim();
      if(tagVal)await ensureTagExists(tagVal);
      const created=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({date:f.date,service_start:f.ss,service_end:f.se,description:f.desc,category_id:f.cat,original_amount:orig,currency:f.cur,fx_rate:fx,amount_usd:Math.round(usd*100)/100,payment_type:f.pt,tag:tagVal,daily_cost:Math.round(usd/days*1e6)/1e6,service_days:days,credit:f.pt==="Transfer"?creditSel.getValue():"",is_subscription:subChk.checked})});
      dcInvalidateTxns();
      const newId=Array.isArray(created)?created[0]?.id:created?.id;
      const savedDesc=f.desc;
      descInp.value="";amtInp.value="";tagInp.value="";fxInp.value="";subChk.checked=false;creditSel.reset();creditRow.style.display="none";
      f.desc="";f.amt="";f.tag="";f.fx="";f.seManual=false;
      previewEl.classList.add("hidden");
      state.txnCount++;
      document.getElementById("dbStatus").textContent=`● ${state.txnCount.toLocaleString()} txns`;
      if(newId)showUndo("\u2713 Added: "+savedDesc,async()=>{
        await sb(`transactions?id=eq.${newId}`,{method:"DELETE"});
        state.txnCount--;document.getElementById("dbStatus").textContent=`● ${state.txnCount.toLocaleString()} txns`;
      });
    }catch(e){alert("Error: "+e.message)}
    submitBtn.textContent="Add Transaction";
  }},"Add Transaction");

  card.append(row(field("Date Entered",dateInp),field("Description",descInp)));
  card.append(row(field("Category",catSel),field("Amount (positive)",amtInp),field("Currency",curSel)));

  const seField=h("div");seField.append(seLbl);seField.append(seInp);
  card.append(row(field("Service Start",ssInp),seField));
  card.append(fxRow);
  const subChk=h("input",{type:"checkbox",style:{accentColor:"var(--g)",cursor:"pointer"}});
  const subLabel=h("label",{style:{display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:"rgba(255,255,255,0.6)",cursor:"pointer"}});
  subLabel.append(subChk,document.createTextNode("Subscription"));
  const xferChk=h("input",{type:"checkbox",style:{accentColor:"var(--b)",cursor:"pointer"},onChange:()=>{f.transfer=xferChk.checked;applyXferMode()}});
  const xferLabel=h("label",{style:{display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:"rgba(255,255,255,0.6)",cursor:"pointer"}});
  xferLabel.append(xferChk,document.createTextNode("Balance transfer / withdrawal"));
  const xferWrap=h("div",{class:f.cat==="financial"?"":"hidden"});
  xferWrap.append(xferLabel);
  const subWrap=h("div",{style:{display:"flex",flexDirection:"column",gap:"8px",justifyContent:"flex-end",paddingBottom:"4px"}});
  subWrap.append(subLabel,xferWrap);
  card.append(row(ptField,field("Tag (optional)",tagInp),subWrap));
  card.append(creditRow);
  card.append(toRow);
  card.append(previewEl);
  card.append(submitBtn);
  el.append(card);

  // ── Import CSV Section ──
  const impCard=h("div",{class:"cd"});
  let impOpen=false;
  const impHdr=h("div",{style:{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"},onClick:()=>{impOpen=!impOpen;impArrow.textContent=impOpen?"\u25BE":"\u25B8";impBody.classList.toggle("hidden")}});
  const impArrow=h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.4)"}},"\u25B8");
  impHdr.append(impArrow,h("h3",{style:{margin:"0"}},"Import CSV"));
  impCard.append(impHdr);

  const impBody=h("div",{class:"hidden",style:{marginTop:"16px"}});
  let impCandidates=null;

  // Upload bar
  const fileInp=h("input",{class:"inp",type:"file",accept:".csv"});
  let impPtManual=false;
  const impPtSel=h("select",{class:"inp",onChange:()=>{impPtManual=true}});
  fillPtSelect(impPtSel,{prefer:["Chase Sapphire"]});
  acctReady.then(()=>{if(!impPtManual)fillPtSelect(impPtSel,{prefer:["Chase Sapphire"]})});
  const impTagInp=h("input",{class:"inp",type:"text",placeholder:"Bulk tag for all rows"});
  const apiKeyInp=h("input",{class:"inp",type:"password",placeholder:"sk-ant-...",value:getApiKey()||""});
  const apiKeyHelp=h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)",marginTop:"2px"}},"Get one at console.anthropic.com \u00b7 Stored locally in your browser");
  const apiKeyField=h("div");
  apiKeyField.append(h("label",{class:"lbl"},"Anthropic API Key"));
  apiKeyField.append(apiKeyInp);
  apiKeyField.append(apiKeyHelp);

  const modelSel=h("select",{class:"inp",style:{maxWidth:"200px"},onChange:()=>setAIModel(modelSel.value)});
  [["claude-haiku-4-5-20251001","Haiku 4.5 (fast)"],["claude-sonnet-4-20250514","Sonnet 4 (quality)"]].forEach(([v,l])=>{const o=h("option",{value:v},l);if(v===getAIModel())o.selected=true;modelSel.append(o)});
  const modelField=h("div");
  modelField.append(h("label",{class:"lbl"},"AI Model"));
  modelField.append(modelSel);

  const impStatus=h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.4)",margin:"10px 0"},class:"hidden"});
  const impReview=h("div",{id:"importReview"});

  const impBtn=h("button",{class:"btn",style:{background:"rgba(74,111,165,0.2)",color:"var(--b)"},onClick:async()=>{
    const file=fileInp.files[0];
    if(!file)return alert("Choose a CSV file first.");

    // API key handling
    const keyVal=apiKeyInp.value.trim();
    if(keyVal)setApiKey(keyVal);
    else if(!aiAvailable()){
      if(!confirm("No API key set. Import with basic category mapping (no AI description cleanup)?"))return;
    }

    impBtn.disabled=true;impBtn.textContent="Processing...";
    impStatus.classList.remove("hidden");
    impStatus.style.color="rgba(255,255,255,0.4)";
    impStatus.textContent="Parsing CSV...";
    try{
      const text=await file.text();
      let csv=parseCSV(text);
      if(!csv.rows.length)throw new Error("No data rows found in CSV.");

      const profile=detectBankProfile(csv.headers);
      if(!profile)throw new Error("Unrecognized bank format. Supported: Chase CC, Chase Chequing, AMEX, Bilt, Wells Fargo");
      if(profile.reparse)csv=profile.reparse(text);

      // Auto-detect payment type from filename (only if user hasn't manually
      // changed it). Only apply when the guessed account is actually one of the
      // viewer's options — otherwise their explicit account choice stands.
      if(!impPtManual){
        let guess="";
        if(profile.name==="chase_checking")guess="Chase Chequing";
        else if(profile.name==="chase")guess="Chase Sapphire";
        else if(profile.name==="amex")guess="AMEX Rose Gold";
        else if(profile.name==="bilt"||profile.name==="bilt_legacy")guess="Bilt";
        else if(profile.name==="wells_fargo")guess=/sav/i.test(file.name)?"Wells Fargo Savings":"Wells Fargo Checking";
        if(guess&&[...impPtSel.options].some(o=>o.value===guess))impPtSel.value=guess;
      }
      const pt=impPtSel.value;
      const tag=impTagInp.value.trim();

      // Transform rows
      const candidates=csv.rows.map((r,i)=>transformCSVRow(r,profile,pt,tag,i));
      impCandidates=candidates;

      // AI categorization
      impStatus.textContent="AI categorizing...";
      const[patterns,samples,subs,rules]=await Promise.all([fetchMerchantPatterns(),fetchSampleDescriptions(),fetchSubscriptions(),fetchAIRules()]);
      const aiResults=await aiCategorize(candidates,patterns,samples,!!profile.isCheckingAccount,profile.name,subs,rules);
      applyAIResults(candidates,aiResults,subs);

      // Duplicate detection
      impStatus.textContent="Checking for duplicates...";
      await findDuplicates(candidates,pt);
      await findTransferPairs(candidates);

      const pending=candidates.filter(c=>c._status==="pending").length;
      if(!pending)impStatus.textContent="All transactions are duplicates or skipped.";
      else impStatus.textContent=aiResults?"AI categorization complete.":"Using default categories (no AI key).";
      renderReviewTable(impReview,candidates);
    }catch(e){
      impStatus.textContent="Error: "+e.message;
      impStatus.style.color="var(--r)";
    }
    impBtn.disabled=false;impBtn.textContent="Import";
  }},"Import");

  impBody.append(row(field("CSV File",fileInp),field("Payment Account",impPtSel)));
  impBody.append(row(field("Bulk Tag (optional)",impTagInp),apiKeyField));
  impBody.append(row(modelField));
  impBody.append(impBtn);
  impBody.append(impStatus);
  impBody.append(impReview);
  impCard.append(impBody);
  el.append(impCard);

  // ── Email Import Section ──
  const emailCard=h("div",{class:"cd",id:"emailImportSection"});
  let emailOpen=state.pendingEmails>0;
  const emailHdr=h("div",{style:{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"},onClick:()=>{
    emailOpen=!emailOpen;emailArrow.textContent=emailOpen?"\u25BE":"\u25B8";emailBody.classList.toggle("hidden");
    if(emailOpen&&!emailBody._loaded){emailBody._loaded=true;loadEmailImports()}
  }});
  const emailArrow=h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.4)"}},emailOpen?"\u25BE":"\u25B8");
  emailHdr.append(emailArrow,h("h3",{style:{margin:"0"}},"\uD83D\uDCE7 Email Imports"));
  emailCard.append(emailHdr);

  const emailBody=h("div",{class:emailOpen?"":"hidden",style:{marginTop:"16px"}});
  let inboundAddr="8e70a9e284a1705b967239e049a59b65@inbound.postmarkapp.com";
  const setupBar=h("div",{style:{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"8px",padding:"12px 14px",marginBottom:"14px"}});
  const addrSpan=h("span",{style:{fontFamily:"var(--mono)",fontSize:"11px",background:"rgba(255,255,255,0.06)",padding:"2px 8px",borderRadius:"4px",userSelect:"all"}},inboundAddr);
  const copyBtn=h("button",{class:"pg-btn",style:{marginLeft:"8px",fontSize:"10px"},onClick:()=>{navigator.clipboard.writeText(inboundAddr);copyBtn.textContent="Copied!";setTimeout(()=>copyBtn.textContent="Copy",1500)}},"Copy");
  const setupLine1=h("div",{style:{marginBottom:"4px",fontSize:"12px"}});
  setupLine1.append("Forward transaction emails to: ",addrSpan,copyBtn);
  setupBar.append(setupLine1,h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.25)"}},"Venmo, subscriptions, bank alerts \u2014 or any financial email"));
  emailBody.append(setupBar);
  // Fetch address from preferences (overwrite hardcoded fallback)
  sb("preferences?key=eq.inbound_email_address&select=value&limit=1").then(r=>{if(r?.[0]?.value){inboundAddr=r[0].value;addrSpan.textContent=inboundAddr}}).catch(()=>{});

  const emailReview=h("div");
  emailBody.append(emailReview);
  let emailCandidates=null;

  async function loadEmailImports(){
    emailReview.innerHTML="<div style='text-align:center;padding:20px;color:rgba(255,255,255,0.3)'>Loading...</div>";
    try{
      const rows=await sb("pending_imports?status=eq.pending&order=email_received_at.desc");
      if(!rows.length){emailReview.innerHTML="<div style='padding:16px;color:rgba(255,255,255,0.3);font-size:12px'>No pending imports</div>";return}
      emailCandidates=rows.map(r=>({
        _id:r.id,_status:"pending",_isDuplicate:false,_source:r.source,
        _emailSubject:r.email_subject,_emailBodyText:r.email_body_text,
        _parsedData:r.parsed_data||{},
        date:r.date,description:r.description||r.ai_description||r.email_subject,
        amount_usd:parseFloat(r.amount_usd)||0,category_id:r.category_id||r.ai_category||"other",
        ai_confidence:r.ai_confidence||"low",
        currency:r.currency||"USD",fx_rate:1,original_amount:parseFloat(r.amount_usd)||0,
        service_start:r.service_start||r.date,service_end:r.service_end||r.date,
        service_days:r.service_days||1,daily_cost:parseFloat(r.daily_cost)||parseFloat(r.amount_usd)||0,
        payment_type:r.payment_type||"Venmo",tag:r.tag||"",credit:r.credit||""
      }));
      const ptGroups={};
      for(const c of emailCandidates){const pt=c.payment_type;if(!ptGroups[pt])ptGroups[pt]=[];ptGroups[pt].push(c)}
      for(const[pt,group]of Object.entries(ptGroups)){await findDuplicates(group,pt)}
      // Pre-resolve Rakuten cashback → parent purchase so the reviewer sees (and can
      // adjust) the link target before approving. Matched on store + order total + date.
      await Promise.all(emailCandidates.map(async c=>{
        if(c._parsedData?.type!=="cashback_earned")return;
        try{
          const parent=await findRakutenParentMatch(
            c._parsedData.store_name||c.description,
            parseFloat(c._parsedData.order_amount)||0,
            c._parsedData.order_date||c.date
          );
          if(parent){
            c._linkToTransactionId=parent.id;
            c._linkToGroupId=parent.transaction_group_id||null;
            c._linkDisplay={description:parent.description,date:parent.date,amount_usd:parent.amount_usd,category_id:parent.category_id,payment_type:parent.payment_type};
          }
        }catch(e){console.warn("Rakuten parent lookup failed:",e)}
      }));
      renderEmailReviewTable(emailReview,emailCandidates);
    }catch(e){emailReview.innerHTML=`<div style="padding:16px;color:var(--r);font-size:12px">Error: ${e.message}</div>`}
  }

  emailCard.append(emailBody);
  el.append(emailCard);
  if(emailOpen){emailBody._loaded=true;loadEmailImports()}

  // ── Payslip Import Section (FEA-45) ──
  const psCard=h("div",{class:"cd"});
  let psOpen=false;
  const psHdr=h("div",{style:{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"},onClick:()=>{
    psOpen=!psOpen;psArrow.textContent=psOpen?"\u25BE":"\u25B8";psBody.classList.toggle("hidden");
  }});
  const psArrow=h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.4)"}},"\u25B8");
  psHdr.append(psArrow,h("h3",{style:{margin:"0"}},"\uD83D\uDCB0 Payslip Import"));
  psCard.append(psHdr);

  const psBody=h("div",{class:"hidden",style:{marginTop:"16px"}});
  let psCandidates=null;
  let psSkippedPages=[];

  const psFileInp=h("input",{class:"inp",type:"file",accept:".pdf,.xlsx"});
  const psDateInp=h("input",{class:"inp",type:"date",value:today()});
  const psStatus=h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.4)",margin:"10px 0"},class:"hidden"});
  const psReview=h("div");

  const psBtn=h("button",{class:"btn",style:{background:"rgba(74,111,165,0.2)",color:"var(--b)"},onClick:async()=>{
    const file=psFileInp.files[0];
    if(!file)return alert("Choose a payslip file first.");
    const ext=file.name.split(".").pop().toLowerCase();
    psBtn.disabled=true;psBtn.textContent="Processing...";
    psStatus.classList.remove("hidden");
    psStatus.style.color="rgba(255,255,255,0.4)";
    psStatus.textContent=ext==="xlsx"?"Parsing XLSX...":"Parsing PDF...";
    try{
      let pages;
      if(ext==="xlsx"){
        pages=await parsePayslipXLSX(file);
      }else{
        if(!window.pdfjsLib)throw new Error("PDF parser not available. Reload the page.");
        pages=await parsePayslipPDF(file);
      }
      if(!pages.length)throw new Error("No payslip data found. Is this a supported payslip (Pinterest or Pronto/Rippling)?");

      const active=pages.filter(p=>!p.isSkip);
      psSkippedPages=pages.filter(p=>p.isSkip);

      psStatus.textContent=`Found ${pages.length} payslip pages (${active.length} active, ${psSkippedPages.length} skipped)...`;

      const enteredDate=psDateInp.value||today();
      const txns=generatePayslipTransactions(pages,enteredDate);

      txns.forEach(c=>{
        c._status="pending";
        c._isDuplicate=false;
        c._rawDescription=c.description;
        c.currency="USD";c.fx_rate=1;
        c.original_amount=c.amount_usd;
        if(c.credit===undefined)c.credit="";
        const ss=new Date(c.service_start+"T00:00:00"),se=new Date(c.service_end+"T00:00:00");
        c.service_days=Math.max(1,Math.floor((se-ss)/864e5)+1);
        c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
      });

      psCandidates=txns;

      psStatus.textContent="Checking for duplicates...";
      const ptGroups={};
      for(const c of txns){const pt=c.payment_type;if(!ptGroups[pt])ptGroups[pt]=[];ptGroups[pt].push(c)}
      for(const[pt,group] of Object.entries(ptGroups)){await findDuplicates(group,pt)}

      const dupes=txns.filter(c=>c._isDuplicate).length;
      psStatus.textContent=`${txns.length} transactions generated \u00b7 ${dupes} duplicates`;

      renderPayslipReviewTable(psReview,psCandidates,psSkippedPages);
    }catch(e){
      psStatus.textContent="Error: "+e.message;
      psStatus.style.color="var(--r)";
    }
    psBtn.disabled=false;psBtn.textContent="Import";
  }},"Import");

  psBody.append(row(field("Payslip (PDF or XLSX)",psFileInp),field("Entered Date",psDateInp)));
  psBody.append(psBtn);
  psBody.append(psStatus);
  psBody.append(psReview);
  psCard.append(psBody);
  el.append(psCard);

  // ── Splitwise Sync Section (FEA-29B) ──
  const swCard=h("div",{class:"cd",id:"splitwiseSyncSection"});
  let swOpen=false;
  const swHdr=h("div",{style:{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"},onClick:()=>{
    swOpen=!swOpen;swArrow.textContent=swOpen?"\u25BE":"\u25B8";swBody.classList.toggle("hidden");
    if(swOpen&&!swBody._loaded){swBody._loaded=true;refreshSwAccount();loadSplitwiseSync(swReview)}
  }});
  const swArrow=h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.4)"}},"\u25B8");
  swHdr.append(swArrow,h("h3",{style:{margin:"0"}},"\uD83D\uDD17 Splitwise Sync"));
  swCard.append(swHdr);

  const swBody=h("div",{class:"hidden",style:{marginTop:"16px"}});

  // ── Sync period control ──
  const swPeriodSel=h("select",{class:"inp",style:{maxWidth:"220px"}});
  [["","New since last sync"],["30","Last 30 days"],["90","Last 90 days"],["180","Last 6 months"],["365","Last 12 months"],["all","All time"],["custom","Custom range\u2026"]]
    .forEach(([v,l])=>swPeriodSel.append(h("option",{value:v},l)));
  const swFrom=h("input",{class:"inp",type:"date"});
  const swTo=h("input",{class:"inp",type:"date",value:today()});
  const swCustom=h("div",{class:"hidden",style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginTop:"8px"}});
  swCustom.append(field("From",swFrom),field("To",swTo));
  swPeriodSel.addEventListener("change",()=>{swCustom.classList.toggle("hidden",swPeriodSel.value!=="custom")});
  function swSyncOpts(){
    const v=swPeriodSel.value;
    if(v==="")return{};
    if(v==="all")return{dated_after:"2015-01-01T00:00:00Z"};
    if(v==="custom"){const o={};if(swFrom.value)o.dated_after=swFrom.value+"T00:00:00Z";if(swTo.value)o.dated_before=swTo.value+"T23:59:59Z";return o}
    return{dated_after:new Date(Date.now()-parseInt(v)*864e5).toISOString()};
  }

  const swBtn=h("button",{class:"btn",style:{background:"rgba(74,111,165,0.2)",color:"var(--b)",marginTop:"10px"},onClick:async()=>{
    swBtn.disabled=true;swBtn.textContent="Syncing\u2026";
    try{
      const summary=await runSplitwiseSync(swSyncOpts());
      const c=summary.counts||{};
      swStatus.classList.remove("hidden");swStatus.style.color="rgba(255,255,255,0.5)";
      swStatus.textContent=`Synced ${summary.fetched} expenses \u00b7 ${c.new||0} new \u00b7 ${(c.changed||0)+(c.deleted||0)} changed \u00b7 ${c.unchanged||0} unchanged`;
      await loadSplitwiseSync(swReview);
    }catch(e){
      swStatus.classList.remove("hidden");swStatus.style.color="var(--r)";
      swStatus.textContent="Sync error: "+e.message;
    }
    swBtn.disabled=false;swBtn.textContent="Sync now";
  }},"Sync now");
  const swStatus=h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.4)",margin:"10px 0"},class:"hidden"});
  const swReview=h("div");

  // ── Per-account connection (FEA-29D) ──
  // Each logged-in user connects their OWN Splitwise key; the sync controls are
  // gated until a connection exists so no one syncs against another's account.
  const swAccountLine=h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.55)",marginBottom:"10px"}});
  const swKeyInp=h("input",{class:"inp",type:"password",placeholder:"Paste your Splitwise API key",style:{maxWidth:"320px"}});
  const swConnectBtn=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)",marginTop:"8px"}},"Connect Splitwise");
  const swConnectWrap=h("div",{class:"hidden",style:{marginBottom:"12px"}});
  swConnectWrap.append(
    h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}},"Get a key at secure.splitwise.com \u2192 Your account \u2192 API keys. Stored server-side only."),
    swKeyInp,h("div",{},swConnectBtn)
  );
  const swControls=h("div",{class:"hidden"});
  swControls.append(field("Sync period",swPeriodSel),swCustom,swBtn,swStatus,swReview);
  swBody.append(swAccountLine,swConnectWrap,swControls);

  async function refreshSwAccount(){
    swAccountLine.textContent="Checking Splitwise connection\u2026";
    try{
      const st=await swAccountStatus();
      if(st.connected){
        swAccountLine.innerHTML="";
        const who=st.name?`Connected as ${st.name}`:"Connected (shared key)";
        swAccountLine.append(h("span",{},`\u2705 ${who}`));
        swAccountLine.append(h("span",{style:{marginLeft:"10px",color:"var(--b)",cursor:"pointer",fontSize:"11px"},onClick:()=>swConnectWrap.classList.toggle("hidden")},"Change key"));
        swControls.classList.remove("hidden");
        swConnectWrap.classList.add("hidden");
      }else{
        swAccountLine.textContent="Not connected to Splitwise.";
        swConnectWrap.classList.remove("hidden");
        swControls.classList.add("hidden");
      }
    }catch(e){swAccountLine.textContent="Connection check failed: "+e.message}
  }
  swConnectBtn.onclick=async()=>{
    const key=swKeyInp.value.trim();
    if(!key){swKeyInp.focus();return}
    swConnectBtn.disabled=true;swConnectBtn.textContent="Connecting\u2026";
    try{await swSetKey(key);swKeyInp.value="";await refreshSwAccount();}
    catch(e){alert("Connect failed: "+e.message)}
    swConnectBtn.disabled=false;swConnectBtn.textContent="Connect Splitwise";
  };

  swCard.append(swBody);
  el.append(swCard);

}

// Call the auth-gated splitwise-sync Edge Function to fetch + reconcile expenses.
async function runSplitwiseSync(opts){
  const token=currentSession?.access_token||SB_KEY;
  const r=await fetch(`${SB_URL}/functions/v1/splitwise-sync`,{
    method:"POST",
    headers:{"Authorization":`Bearer ${token}`,"apikey":SB_KEY,"Content-Type":"application/json"},
    body:JSON.stringify(opts||{})
  });
  const txt=await r.text();
  let data;try{data=txt?JSON.parse(txt):{}}catch(e){throw new Error(txt||"Bad response")}
  if(!r.ok)throw new Error(data.error||`${r.status}`);
  return data;
}

async function loadSplitwiseSync(container){
  container.innerHTML="<div style='text-align:center;padding:20px;color:rgba(255,255,255,0.3)'>Loading\u2026</div>";
  try{
    const [active,dismissed]=await Promise.all([
      sb(`splitwise_expenses?sync_status=in.(pending,needs_review)&order=last_synced_at.desc${importerQS()}`),
      sb(`splitwise_expenses?sync_status=eq.dismissed&order=last_synced_at.desc&limit=100${importerQS()}`)
    ]);
    const pending=active.filter(r=>r.sync_status==="pending");
    if(pending.length&&aiAvailable()){
      container.innerHTML="<div style='text-align:center;padding:20px;color:rgba(255,255,255,0.3)'>AI categorizing\u2026</div>";
      await aiEnrichSplitwiseRows(pending);
    }
    renderSplitwiseReview(container,active,dismissed);
  }catch(e){container.innerHTML=`<div style="padding:16px;color:var(--r);font-size:12px">Error: ${e.message}</div>`}
}

// Run the same AI categorization/description cleanup used for CSV/email imports
// over the underlying Splitwise expense, stashing the suggestion on each row.
// Suggestions are cached per expense_id+content_hash for the session so repeated
// syncs don't re-categorize (and re-bill) the same unchanged pending backlog.
function swAiCacheKey(r){return `sw_ai_${r.expense_id}_${r.content_hash||""}`;}
async function aiEnrichSplitwiseRows(rows){
  if(!aiAvailable())return;
  // Restore cached suggestions; only send the uncached/changed rows to the model.
  const todo=[];
  rows.forEach(r=>{
    try{const c=sessionStorage.getItem(swAiCacheKey(r));if(c){r._ai=JSON.parse(c);return}}catch(_){}
    todo.push(r);
  });
  if(!todo.length)return;
  try{
    const cands=todo.map(r=>{
      const c=(r.raw?.candidates||[])[0]||{};
      const e=r.raw?.expense||{};
      return{_rawDescription:(e.description||c.description||"").replace(/^Reimbursed - /,""),amount_usd:Math.abs(parseFloat(c.amount_usd)||0),_bankCategory:""};
    });
    const[patterns,samples,subs,rules]=await Promise.all([fetchMerchantPatterns(),fetchSampleDescriptions(),fetchSubscriptions(),fetchAIRules()]);
    const res=await aiCategorize(cands,patterns,samples,false,"splitwise",subs,rules);
    if(!res)return;
    const byIdx={};res.forEach(x=>byIdx[x.i]=x);
    todo.forEach((r,i)=>{const a=byIdx[i];if(a){r._ai={cat:a.cat,conf:a.conf,desc:a.desc};try{sessionStorage.setItem(swAiCacheKey(r),JSON.stringify(r._ai))}catch(_){}}});
  }catch(e){console.warn("Splitwise AI enrich failed:",e)}
}

function swExpenseSummary(snap){
  const e=snap?.expense||{};
  return{date:(e.date||"").slice(0,10),description:e.description||"Splitwise expense",cost:e.cost||"",currency:e.currency_code||"USD"};
}
function swNetAmount(snap){
  const cands=snap?.candidates||[];
  return cands.reduce((s,c)=>s+(parseFloat(c.amount_usd)||0),0);
}

// Expense date for default recency ordering (newest first).
function swSortDate(row){const snap=row.raw||row.pending_raw||{};return (snap.expense&&snap.expense.date)||"";}
function swByRecency(a,b){return String(swSortDate(b)).localeCompare(String(swSortDate(a)));}

function renderSplitwiseReview(container,rows,dismissed){
  container.innerHTML="";
  dismissed=dismissed||[];
  const pending=rows.filter(r=>r.sync_status==="pending").sort(swByRecency);
  const changed=rows.filter(r=>r.sync_status==="needs_review").sort(swByRecency);
  if(!rows.length&&!dismissed.length){
    container.innerHTML="<div style='padding:16px;color:rgba(255,255,255,0.3);font-size:12px'>Nothing to review. Click Sync now to fetch Splitwise expenses.</div>";
    return;
  }
  container.append(h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.5)",marginBottom:"12px"}},
    `${pending.length} new \u00b7 ${changed.length} changed in Splitwise`));

  if(pending.length){
    const newHdr=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"8px 0 6px"}});
    newHdr.append(h("div",{style:{fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.05em",color:"rgba(255,255,255,0.35)"}},"New expenses"));
    const dismissRestBtn=h("button",{class:"pg-btn",style:{fontSize:"10px",padding:"3px 8px",color:"rgba(224,122,95,0.8)"},onClick:async()=>{
      if(!confirm(`Dismiss all ${pending.length} remaining new expense${pending.length===1?"":"s"}?`))return;
      dismissRestBtn.disabled=true;dismissRestBtn.textContent="Dismissing\u2026";
      try{await bulkDismissSplitwise(pending);await loadSplitwiseSync(container);}
      catch(e){alert("Failed: "+e.message);dismissRestBtn.disabled=false;dismissRestBtn.textContent=`Dismiss rest (${pending.length})`;}
    }},`Dismiss rest (${pending.length})`);
    newHdr.append(dismissRestBtn);
    container.append(newHdr);
    pending.forEach(row=>container.append(renderSwPendingCard(row,container)));
  }
  if(changed.length){
    container.append(h("div",{style:{fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.05em",color:"rgba(255,255,255,0.35)",margin:"14px 0 6px"}},"Changed in Splitwise"));
    changed.forEach(row=>container.append(renderSwChangedCard(row,container)));
  }
  if(dismissed.length)renderSwDismissedSection(container,dismissed);
}

// Collapsible list of dismissed Splitwise expenses with a one-click Restore.
function renderSwDismissedSection(container,dismissed){
  const wrap=h("div",{style:{marginTop:"16px",borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:"10px"}});
  let open=false;
  const list=h("div",{class:"hidden",style:{marginTop:"6px"}});
  const arrow=h("span",{style:{fontSize:"9px"}},"\u25B8");
  const hdr=h("div",{style:{cursor:"pointer",fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.05em",color:"rgba(255,255,255,0.35)",display:"flex",gap:"6px",alignItems:"center"},onClick:()=>{open=!open;arrow.textContent=open?"\u25BE":"\u25B8";list.classList.toggle("hidden")}});
  hdr.append(arrow,h("span",{},`Dismissed (${dismissed.length})`));
  wrap.append(hdr,list);
  dismissed.slice().sort(swByRecency).forEach(row=>{
    const snap=row.raw||row.pending_raw||{};
    const s=swExpenseSummary(snap);
    const net=swNetAmount(snap);
    const item=h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"8px",padding:"6px 8px",borderBottom:"1px solid rgba(255,255,255,0.04)",opacity:"0.7"}});
    const info=h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.5)",overflow:"hidden"}});
    info.append(h("div",{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}},s.description));
    info.append(h("div",{style:{fontSize:"10px",color:"rgba(255,255,255,0.3)"}},`${fmtD(s.date)} \u00b7 ${fmtF(net)}`));
    const restore=h("button",{class:"pg-btn",style:{fontSize:"10px",padding:"4px 8px",flexShrink:"0"},onClick:async()=>{
      restore.disabled=true;restore.textContent="\u2026";
      try{await sb(`splitwise_expenses?expense_id=eq.${row.expense_id}${importerQS()}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({sync_status:"pending"})});item.remove();}
      catch(e){alert("Failed: "+e.message);restore.disabled=false;restore.textContent="Restore"}
    }},"Restore");
    item.append(info,restore);
    list.append(item);
  });
  container.append(wrap);
}

function swCatSelect(initial){
  const sel=h("select",{style:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"5px",padding:"3px 6px",color:"#e8e8e4",fontSize:"11px",fontFamily:"var(--sans)",cursor:"pointer",outline:"none"}});
  CATS_LIST.forEach(cat=>{const o=h("option",{value:cat.id},cat.l);if(cat.id===(initial||"other"))o.selected=true;sel.append(o)});
  return sel;
}

// Find candidate card transactions for a receivable: the charge you fronted
// (≈ match_amount, a positive expense) near the expense date, not on Splitwise.
async function findSwCardMatches(cand){
  const amt=Math.abs(parseFloat(cand.match_amount)||0);
  if(!(amt>0))return[];
  const tol=Math.max(0.5,amt*0.02);
  const lo=Math.round((amt-tol)*100)/100,hi=Math.round((amt+tol)*100)/100;
  const d=cand.match_date||cand.date;
  const from=new Date(new Date(d+"T00:00:00").getTime()-14*864e5).toISOString().slice(0,10);
  const to=new Date(new Date(d+"T00:00:00").getTime()+14*864e5).toISOString().slice(0,10);
  const rows=await sb(`transactions?amount_usd=gte.${lo}&amount_usd=lte.${hi}&date=gte.${from}&date=lte.${to}&payment_type=neq.Splitwise&order=date.desc&limit=8&select=id,date,description,amount_usd,category_id,payment_type,transaction_group_id,service_start,service_end${ownerQS()}`);
  return rows.sort((a,b)=>Math.abs(new Date(a.date)-new Date(d+"T00:00:00"))-Math.abs(new Date(b.date)-new Date(d+"T00:00:00")));
}

// Lazily-cached list of existing tag names for the import tag datalist.
let _swTagsCache=null;
function swTagNames(){if(!_swTagsCache)_swTagsCache=sb("tags?select=name&order=name").then(r=>(r||[]).map(t=>t.name)).catch(()=>[]);return _swTagsCache;}

function renderSwPendingCard(row,container){
  const snap=row.raw||{};
  const s=swExpenseSummary(snap);
  const cand=(snap.candidates||[])[0];
  const net=swNetAmount(snap);
  const isReceivable=cand&&cand.role==="reimburse";
  // AI-cleaned description + suggested category (falls back to the raw expense).
  const cleanDesc=(row._ai&&row._ai.desc)||s.description;
  const defaultCat=(row._ai&&row._ai.cat)||"other";
  const finalDesc=isReceivable?`Reimbursed - ${cleanDesc}`:cleanDesc;

  const card=h("div",{style:{border:"1px solid rgba(255,255,255,0.07)",borderLeft:"3px solid var(--g)",borderRadius:"8px",padding:"10px 12px",marginBottom:"8px"}});
  const top=h("div",{style:{display:"flex",justifyContent:"space-between",gap:"8px",alignItems:"baseline"}});
  top.append(h("div",{style:{color:"rgba(255,255,255,0.55)",fontSize:"12px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},s.description));
  top.append(h("div",{class:"m",style:{color:net<0?"var(--g)":"rgba(255,255,255,0.75)",whiteSpace:"nowrap"}},fmtF(net)));
  card.append(top);
  card.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.4)",marginTop:"2px"}},
    `${fmtD(s.date)} \u00b7 total ${s.cost} ${s.currency} \u00b7 ${isReceivable?`you're owed ${fmtF(-net)} (you paid)`:`you owe ${fmtF(net)}`}`));
  if(row.dismissed_at)card.append(h("div",{style:{display:"inline-block",fontSize:"9px",textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--y)",background:"rgba(242,204,143,0.12)",border:"1px solid rgba(242,204,143,0.25)",borderRadius:"4px",padding:"1px 6px",marginTop:"6px"}},`Previously dismissed \u00b7 ${fmtD((row.dismissed_at||"").slice(0,10))}`));

  // ── Possible-duplicate flag (existing Splitwise-account transactions) ──
  const dupWrap=h("div");
  card.append(dupWrap);
  if(cand)findSwDuplicates(cand,row).then(dups=>{
    if(!dups.length)return;
    const box=h("div",{style:{marginTop:"8px",border:"1px solid rgba(224,122,95,0.3)",background:"rgba(224,122,95,0.08)",borderRadius:"6px",padding:"6px 8px"}});
    box.append(h("div",{style:{fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--r)",marginBottom:"3px"}},`Possible duplicate (${dups.length})`));
    dups.forEach(dp=>box.append(h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.55)"}},`${fmtD(dp.date)} \u00b7 ${(dp.description||"").slice(0,44)} \u00b7 ${fmtF(dp.amount_usd)}`)));
    dupWrap.append(box);
  }).catch(()=>{});

  // ── Editable label ──
  const descInp=h("input",{class:"inp",type:"text",value:finalDesc,style:{marginTop:"8px",fontSize:"12px",padding:"6px 8px"}});

  let selectedMatch=null;
  const linkWrap=h("div",{style:{marginTop:"8px"}});
  const catSel=swCatSelect(defaultCat);

  // ── Tag input (datalist of existing tags) ──
  const tagListId=`swtags-${row.expense_id}`;
  const tagList=h("datalist",{id:tagListId});
  swTagNames().then(names=>names.forEach(n=>tagList.append(h("option",{value:n}))));
  const tagInp=h("input",{class:"inp",type:"text",placeholder:"tag (optional)",list:tagListId,style:{fontSize:"11px",padding:"4px 8px",maxWidth:"160px"}});

  // ── Service period (estimated default by category, editable) ──
  let svcManual=false;
  const initSs=getDefStart(defaultCat,s.date)||s.date;
  const initSe=getDefEnd(defaultCat,initSs)||initSs;
  const ssInp=h("input",{class:"inp",type:"date",value:initSs,style:{fontSize:"11px",padding:"4px 8px",maxWidth:"150px"}});
  const seInp=h("input",{class:"inp",type:"date",value:initSe,style:{fontSize:"11px",padding:"4px 8px",maxWidth:"150px"}});
  const svcHint=h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.3)"}});
  function svcUpdateHint(){const r=ACCRUAL_D[catSel.value];svcHint.textContent=!svcManual&&!selectedMatch&&r?(r==="month"?"(auto: month)":`(auto: ${r}d)`):""}
  function syncSvcFromCat(){if(svcManual)return;const ss=getDefStart(catSel.value,s.date)||s.date;ssInp.value=ss;seInp.value=getDefEnd(catSel.value,ss)||ss}
  ssInp.addEventListener("input",()=>{if(!svcManual){seInp.value=getDefEnd(catSel.value,ssInp.value)||ssInp.value}});
  seInp.addEventListener("change",()=>{svcManual=true;svcUpdateHint()});
  catSel.addEventListener("change",()=>{if(!selectedMatch)syncSvcFromCat();svcUpdateHint()});
  svcUpdateHint();

  card.append(descInp);

  const svcRow=h("div",{style:{display:"flex",gap:"6px",alignItems:"center",marginTop:"8px",flexWrap:"wrap"}});
  svcRow.append(h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.35)"}},"Service"),ssInp,h("span",{style:{color:"rgba(255,255,255,0.3)",fontSize:"11px"}},"\u2192"),seInp,svcHint);
  card.append(svcRow);

  const ctrlRow=h("div",{style:{display:"flex",gap:"8px",alignItems:"center",marginTop:"8px",flexWrap:"wrap"}});
  ctrlRow.append(h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.35)"}},"Category"));
  ctrlRow.append(catSel,tagInp,tagList);
  const importBtn=h("button",{class:"pg-btn",style:{color:"var(--g)",borderColor:"rgba(129,178,154,0.3)"},onClick:async()=>{
    importBtn.disabled=true;importBtn.textContent="Importing\u2026";
    try{
      const finalLabel=(descInp.value||"").trim()||finalDesc;
      const svc=(ssInp.value&&seInp.value)?{start:ssInp.value,end:seInp.value}:null;
      const res=await importSplitwiseRow(row,catSel.value,selectedMatch,finalLabel,tagInp.value,svc);
      dcInvalidateTxns&&dcInvalidateTxns();
      showUndo(`\u2713 Imported ${res.count} transaction${res.count===1?"":"s"}${res.linked?" + linked":""}`,async()=>{
        await sb(`transactions?import_batch=eq.${encodeURIComponent(res.batchId)}`,{method:"DELETE"});
        if(res.matchId)await sb(`transactions?id=eq.${res.matchId}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({transaction_group_id:res.priorGroup||null})});
        await sb(`splitwise_expenses?expense_id=eq.${row.expense_id}${importerQS()}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({sync_status:"pending",expense_txn_id:null,reimburse_txn_id:null,transaction_group_id:null,first_imported_at:null})});
      });
      card.remove();
    }catch(e){alert("Import failed: "+e.message);importBtn.disabled=false;importBtn.textContent="Import";}
  }},"Import");
  const dismissBtn=h("button",{class:"pg-btn",style:{color:"rgba(255,255,255,0.4)"},onClick:async()=>{
    dismissBtn.disabled=true;
    try{await dismissSplitwiseRow(row);card.remove();}
    catch(e){alert("Failed: "+e.message);dismissBtn.disabled=false;}
  }},"Dismiss");
  ctrlRow.append(importBtn,dismissBtn);
  card.append(ctrlRow);

  if(isReceivable){
    card.append(linkWrap);
    linkWrap.innerHTML="<div style='font-size:11px;color:rgba(255,255,255,0.3)'>Searching for matching card charge\u2026</div>";
    findSwCardMatches(cand).then(matches=>{
      linkWrap.innerHTML="";
      const lbl=h("div",{style:{fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.05em",color:"rgba(255,255,255,0.35)",marginBottom:"4px"}},"Link to card charge");
      const sel=h("select",{style:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"5px",padding:"3px 6px",color:"#e8e8e4",fontSize:"11px",fontFamily:"var(--sans)",cursor:"pointer",outline:"none",maxWidth:"100%"}});
      // Track matches by a stable key so a manually-searched txn can be added.
      const opts=matches.slice();
      function rebuildOptions(selectIdx){
        sel.innerHTML="";
        sel.append(h("option",{value:""},opts.length?"\u2014 don't link \u2014":"\u2014 no match \u2014 (search below)"));
        opts.forEach((m,i)=>sel.append(h("option",{value:String(i)},`${fmtD(m.date)} \u00b7 ${(m.description||"").slice(0,40)} \u00b7 ${fmtF(m.amount_usd)} \u00b7 ${m.payment_type||""}`)));
        if(selectIdx!=null){sel.value=String(selectIdx);}
      }
      function applySelection(){
        selectedMatch=sel.value===""?null:opts[+sel.value];
        if(selectedMatch&&selectedMatch.category_id)catSel.value=selectedMatch.category_id;
        // Linked: inherit the charge's service window. Unlinked: category default.
        if(selectedMatch&&selectedMatch.service_start){ssInp.value=selectedMatch.service_start;seInp.value=selectedMatch.service_end||selectedMatch.service_start;}
        else syncSvcFromCat();
        svcUpdateHint();
        hint.textContent=selectedMatch?"Will link \u2192 net cost stays your share; category + dates inherited from the charge.":"Not linked \u2014 imported as a standalone Splitwise credit.";
      }
      sel.addEventListener("change",applySelection);
      const hint=h("div",{style:{fontSize:"10px",color:"rgba(129,178,154,0.7)",marginTop:"4px"}});
      rebuildOptions(matches.length?0:null);
      linkWrap.append(lbl,sel);

      // ── Manual search: link to a different transaction than the auto matches ──
      const searchToggle=h("button",{class:"pg-btn",style:{fontSize:"10px",padding:"3px 8px",marginTop:"6px"},onClick:()=>{searchBox.classList.toggle("hidden")}},"Search for a different charge\u2026");
      const searchBox=h("div",{class:"hidden",style:{marginTop:"6px"}});
      const sInp=h("input",{class:"inp",type:"text",placeholder:"Search description\u2026",style:{fontSize:"11px",padding:"4px 8px"}});
      const sBtn=h("button",{class:"pg-btn",style:{fontSize:"10px",padding:"4px 8px",marginTop:"4px"}},"Search");
      const sResults=h("div",{style:{marginTop:"4px",maxHeight:"160px",overflowY:"auto"}});
      async function doSearch(){
        const q=(sInp.value||"").trim();
        if(!q){sResults.innerHTML="<div style='font-size:10px;color:rgba(255,255,255,0.3);padding:4px'>Type a search term.</div>";return}
        sBtn.disabled=true;sBtn.textContent="\u2026";
        try{
          const found=await sb(`transactions?description=ilike.*${encodeURIComponent(q)}*&payment_type=neq.Splitwise&order=date.desc&limit=20&select=id,date,description,amount_usd,category_id,payment_type,transaction_group_id,service_start,service_end${ownerQS()}`);
          sResults.innerHTML="";
          if(!found.length){sResults.innerHTML="<div style='font-size:10px;color:rgba(255,255,255,0.3);padding:4px'>No matches.</div>"}
          found.forEach(m=>{
            const r=h("div",{style:{display:"flex",justifyContent:"space-between",gap:"8px",padding:"5px 6px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.04)",fontSize:"11px"},onClick:()=>{
              let idx=opts.findIndex(o=>o.id===m.id);
              if(idx<0){opts.push(m);idx=opts.length-1;}
              rebuildOptions(idx);applySelection();
              searchBox.classList.add("hidden");
            }});
            r.append(h("div",{style:{color:"rgba(255,255,255,0.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},`${fmtD(m.date)} \u00b7 ${m.description}`));
            r.append(h("div",{class:"m",style:{color:"rgba(255,255,255,0.55)",whiteSpace:"nowrap"}},`${fmtF(m.amount_usd)} \u00b7 ${m.payment_type||""}`));
            sResults.append(r);
          });
        }catch(e){sResults.innerHTML=`<div style='font-size:10px;color:var(--r);padding:4px'>Error: ${e.message}</div>`}
        sBtn.disabled=false;sBtn.textContent="Search";
      }
      sBtn.addEventListener("click",doSearch);
      sInp.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();doSearch()}});
      searchBox.append(sInp,sBtn,sResults);
      linkWrap.append(searchToggle,searchBox,hint);
      applySelection();
    }).catch(()=>{linkWrap.innerHTML="<div style='font-size:11px;color:rgba(255,255,255,0.3)'>Could not search for a match.</div>"});
  }
  return card;
}

function renderSwChangedCard(row,container){
  const oldSnap=row.raw||{};
  const newSnap=row.pending_raw||{};
  const oldS=swExpenseSummary(oldSnap),newS=swExpenseSummary(newSnap);
  const oldNet=swNetAmount(oldSnap),newNet=swNetAmount(newSnap);
  const isDeleted=!!(newSnap.expense&&newSnap.expense.deleted_at);
  const card=h("div",{style:{border:"1px solid rgba(255,255,255,0.07)",borderLeft:`3px solid ${isDeleted?"var(--r)":"var(--y)"}`,borderRadius:"8px",padding:"10px 12px",marginBottom:"8px"}});
  card.append(h("div",{style:{color:"rgba(255,255,255,0.85)",fontWeight:"600",fontSize:"13px"}},newS.description||oldS.description));
  card.append(h("div",{style:{fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.05em",color:isDeleted?"var(--r)":"var(--y)",margin:"4px 0 6px"}},
    isDeleted?"Deleted in Splitwise":"Updated in Splitwise"));
  if(row.dismissed_at)card.append(h("div",{style:{display:"inline-block",fontSize:"9px",textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--y)",background:"rgba(242,204,143,0.12)",border:"1px solid rgba(242,204,143,0.25)",borderRadius:"4px",padding:"1px 6px",marginBottom:"6px"}},`Previously dismissed \u00b7 ${fmtD((row.dismissed_at||"").slice(0,10))}`));

  function diffLine(label,oldV,newV){
    const changedV=String(oldV)!==String(newV);
    const d=h("div",{style:{display:"grid",gridTemplateColumns:"70px 1fr 14px 1fr",gap:"6px",alignItems:"baseline",fontSize:"11px",marginBottom:"2px"}});
    d.append(h("span",{style:{color:"rgba(255,255,255,0.35)"}},label));
    d.append(h("span",{style:{color:"rgba(255,255,255,0.4)",textDecoration:changedV?"line-through":"none"}},String(oldV)));
    d.append(h("span",{style:{color:"rgba(255,255,255,0.3)"}},changedV?"\u2192":""));
    d.append(h("span",{style:{color:changedV?"var(--y)":"rgba(255,255,255,0.5)"}},isDeleted?"\u2014":String(newV)));
    return d;
  }
  card.append(diffLine("Amount",fmtF(oldNet),isDeleted?"removed":fmtF(newNet)));
  card.append(diffLine("Date",fmtD(oldS.date),fmtD(newS.date)));
  card.append(diffLine("Desc",oldS.description,newS.description));

  const ctrlRow=h("div",{style:{display:"flex",gap:"8px",alignItems:"center",marginTop:"8px",flexWrap:"wrap"}});
  const applyBtn=h("button",{class:"pg-btn",style:{color:isDeleted?"var(--r)":"var(--y)",borderColor:isDeleted?"rgba(224,122,95,0.3)":"rgba(242,204,143,0.3)"},onClick:async()=>{
    applyBtn.disabled=true;applyBtn.textContent="Applying\u2026";
    try{
      await applySplitwiseUpdate(row);
      dcInvalidateTxns&&dcInvalidateTxns();
      card.remove();
    }catch(e){alert("Apply failed: "+e.message);applyBtn.disabled=false;applyBtn.textContent=isDeleted?"Delete imported":"Apply update";}
  }},isDeleted?"Delete imported":"Apply update");
  const keepBtn=h("button",{class:"pg-btn",style:{color:"rgba(255,255,255,0.4)"},onClick:async()=>{
    keepBtn.disabled=true;
    try{await keepSplitwiseVersion(row);card.remove();}
    catch(e){alert("Failed: "+e.message);keepBtn.disabled=false;}
  }},"Keep mine");
  ctrlRow.append(applyBtn,keepBtn);
  card.append(ctrlRow);
  return card;
}

// Build the single "Splitwise part" transaction row. When linked to a card
// charge (match), inherit its category + service window so the credit accrues
// per-day against the same period and the net cost lands on your share.
function swBuildRow(cand,categoryId,batchId,match,descOverride,tag,svc){
  let cat=categoryId||cand.category_id||"other";
  if(match&&match.category_id)cat=match.category_id;
  let ss,se;
  if(svc&&svc.start&&svc.end){
    ss=svc.start;se=svc.end; // explicit override from the review card
  }else if(match){
    ss=match.service_start||cand.date;se=match.service_end||match.service_start||cand.date;
  }else{
    // Default to the category's estimated accrual window (e.g. furniture = 2yr).
    ss=getDefStart(cat,cand.date)||cand.date;se=getDefEnd(cat,ss)||ss;
  }
  const d1=new Date(ss+"T00:00:00"),d2=new Date(se+"T00:00:00");
  const days=Math.max(1,Math.floor((d2-d1)/864e5)+1);
  const amt=Math.round((parseFloat(cand.amount_usd)||0)*100)/100;
  return{
    date:cand.date,service_start:ss,service_end:se,
    description:descOverride||cand.description,category_id:cat,
    amount_usd:amt,original_amount:amt,currency:cand.currency||"USD",fx_rate:1,
    payment_type:cand.payment_type||"Splitwise",tag:tag||"",
    service_days:days,daily_cost:Math.round(amt/days*1e6)/1e6,credit:"",
    import_batch:batchId
  };
}

async function importSplitwiseRow(row,categoryId,matchTxn,descOverride,tag,svc){
  const snap=row.raw||{};
  const cand=(snap.candidates||[])[0];
  if(!cand)throw new Error("No transaction to import.");
  const isReceivable=cand.role==="reimburse";
  const useMatch=isReceivable?(matchTxn||null):null;
  const cleanTag=(tag||"").toLowerCase().trim();
  if(cleanTag)await ensureTagExists(cleanTag);
  const batchId="splitwise-"+new Date().toISOString().slice(0,16)+"-"+row.expense_id;
  const txnRow=swBuildRow(cand,categoryId,batchId,useMatch,descOverride,cleanTag,svc);
  const inserted=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify([txnRow])});
  const created=inserted[0];
  state.txnCount+=1;
  document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
  let groupId=null,expenseTxnId=null,reimburseTxnId=null,linked=false,priorGroup=null,matchId=null;
  if(isReceivable){
    reimburseTxnId=created?.id||null;
    if(useMatch&&created?.id){
      matchId=useMatch.id;priorGroup=useMatch.transaction_group_id||null;
      groupId=await linkToGroup({id:useMatch.id,transaction_group_id:priorGroup},{id:created.id,transaction_group_id:null});
      await sb(`transactions?id=eq.${created.id}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({related_transaction_id:useMatch.id})});
      expenseTxnId=useMatch.id; // the external card charge is the "main" expense
      linked=true;
    }
  }else{
    expenseTxnId=created?.id||null;
  }
  await sb(`splitwise_expenses?expense_id=eq.${row.expense_id}${importerQS()}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
    sync_status:"imported",
    expense_txn_id:expenseTxnId,reimburse_txn_id:reimburseTxnId,transaction_group_id:groupId,
    first_imported_at:new Date().toISOString()
  })});
  return{count:1,batchId,linked,matchId,priorGroup};
}

async function applySplitwiseUpdate(row){
  const snap=row.pending_raw||{};
  // Only delete transactions WE created. For a receivable, expense_txn_id points
  // at the user's external card charge — never delete that.
  const wasReceivable=!!row.reimburse_txn_id;
  const ownedIds=wasReceivable?[row.reimburse_txn_id]:(row.expense_txn_id?[row.expense_txn_id]:[]);
  if(ownedIds.length){
    await sb(`transactions?id=in.(${ownedIds.join(",")})`,{method:"DELETE"});
    state.txnCount-=ownedIds.length;
  }
  const cand=(snap.candidates||[])[0];
  const isDeleted=!!(snap.expense&&snap.expense.deleted_at);
  if(isDeleted||!cand){
    document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
    await sb(`splitwise_expenses?expense_id=eq.${row.expense_id}${importerQS()}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
      sync_status:"dismissed",raw:snap,pending_raw:null,
      sw_updated_at:snap.expense?.updated_at||null,sw_deleted_at:snap.expense?.deleted_at||null,content_hash:snap.content_hash||null,
      expense_txn_id:null,reimburse_txn_id:null,transaction_group_id:null
    })});
    return;
  }
  const isReceivable=cand.role==="reimburse";
  // Re-link a receivable to the still-existing card charge, if any.
  let match=null;
  if(isReceivable&&row.expense_txn_id){
    try{const m=await sb(`transactions?id=eq.${row.expense_txn_id}&select=id,category_id,transaction_group_id,service_start,service_end&limit=1`);if(m.length)match=m[0]}catch(_){}
  }
  const prevCat=(row.raw?.candidates||[])[0]?.category_id||null;
  const batchId="splitwise-"+new Date().toISOString().slice(0,16)+"-"+row.expense_id;
  const txnRow=swBuildRow(cand,prevCat,batchId,match);
  const inserted=await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify([txnRow])});
  const created=inserted[0];
  state.txnCount+=1;
  document.getElementById("dbStatus").textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
  let groupId=null,expenseTxnId=null,reimburseTxnId=null;
  if(isReceivable){
    reimburseTxnId=created?.id||null;
    if(match&&created?.id){
      groupId=await linkToGroup({id:match.id,transaction_group_id:match.transaction_group_id||null},{id:created.id,transaction_group_id:null});
      await sb(`transactions?id=eq.${created.id}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({related_transaction_id:match.id})});
      expenseTxnId=match.id;
    }
  }else{
    expenseTxnId=created?.id||null;
  }
  await sb(`splitwise_expenses?expense_id=eq.${row.expense_id}${importerQS()}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
    sync_status:"imported",raw:snap,pending_raw:null,
    sw_updated_at:snap.expense?.updated_at||null,sw_deleted_at:null,content_hash:snap.content_hash||null,
    expense_txn_id:expenseTxnId,reimburse_txn_id:reimburseTxnId,transaction_group_id:groupId
  })});
}

// Acknowledge a Splitwise change but keep the already-imported transactions as-is.
// Advances the tracking pointers so the expense is not re-flagged next sync.
async function keepSplitwiseVersion(row){
  const snap=row.pending_raw||{};
  await sb(`splitwise_expenses?expense_id=eq.${row.expense_id}${importerQS()}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
    sync_status:"imported",pending_raw:null,
    sw_updated_at:snap.expense?.updated_at||null,sw_deleted_at:snap.expense?.deleted_at||null,content_hash:snap.content_hash||null
  })});
}

async function dismissSplitwiseRow(row){
  await sb(`splitwise_expenses?expense_id=eq.${row.expense_id}${importerQS()}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({sync_status:"dismissed",dismissed_at:new Date().toISOString()})});
}

// Bulk-dismiss a batch of pending rows in a single request.
async function bulkDismissSplitwise(rows){
  const ids=rows.map(r=>r.expense_id).filter(v=>v!=null);
  if(!ids.length)return;
  await sb(`splitwise_expenses?expense_id=in.(${ids.join(",")})${importerQS()}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({sync_status:"dismissed",dismissed_at:new Date().toISOString()})});
}

// Fuzzy duplicate check against transactions already on the Splitwise account
// (manually entered, or imported some other way). Matches on net amount (±2% or
// $0.50) and date (±7 days); the user judges the label. Excludes the rows this
// expense already created so re-renders don't self-flag.
async function findSwDuplicates(cand,row){
  const amt=Math.round((parseFloat(cand.amount_usd)||0)*100)/100;
  if(!amt)return[];
  const tol=Math.max(0.5,Math.abs(amt)*0.02);
  const lo=Math.round((amt-tol)*100)/100,hi=Math.round((amt+tol)*100)/100;
  const d=cand.date;
  const from=new Date(new Date(d+"T00:00:00").getTime()-7*864e5).toISOString().slice(0,10);
  const to=new Date(new Date(d+"T00:00:00").getTime()+7*864e5).toISOString().slice(0,10);
  const rows=await sb(`transactions?payment_type=eq.Splitwise&amount_usd=gte.${lo}&amount_usd=lte.${hi}&date=gte.${from}&date=lte.${to}&order=date.desc&limit=5&select=id,date,description,amount_usd${ownerQS()}`);
  const ownIds=new Set([row?.expense_txn_id,row?.reimburse_txn_id].filter(Boolean));
  return rows.filter(r=>!ownIds.has(r.id));
}
