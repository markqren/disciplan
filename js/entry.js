function renderEntry(el){
  fetchCreditNames();
  const card=h("div",{class:"cd"});
  card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><h3 style="margin:0">New Transaction</h3><span id="okMsg" class="ok-msg hidden">✓ Saved to Supabase</span></div>`;

  const t=today();
  let f={date:t,desc:"",cat:"groceries",amt:"",cur:"USD",pt:"Chase Sapphire",tag:"",fx:"",ss:t,se:getDefEnd("groceries",t),seManual:false};

  function row(...children){const d=h("div",{style:{display:"grid",gridTemplateColumns:children.length===3?"1fr 1fr 1fr":children.length===2?"1fr 1fr":"1fr 2fr",gap:"12px",marginBottom:"14px"}});children.forEach(c=>d.append(c));return d}
  function field(lbl,input){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(input);return d}

  const dateInp=h("input",{class:"inp",type:"date",value:f.date,onInput:e=>{f.date=e.target.value}});
  const descInp=h("input",{class:"inp",type:"text",placeholder:"e.g., Whole Foods groceries",onInput:e=>{f.desc=e.target.value}});

  const catSel=h("select",{class:"inp",onChange:e=>{f.cat=e.target.value;if(!f.seManual){f.ss=getDefStart(f.cat,f.date)||f.date;ssInp.value=f.ss;f.se=getDefEnd(f.cat,f.ss)||f.ss;seInp.value=f.se;updateHint()}updatePreview()}});
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
  const ptSel=h("select",{class:"inp",onChange:e=>{f.pt=e.target.value;creditRow.style.display=f.pt==="Transfer"?"grid":"none"}});
  PTS.forEach(p=>{const o=h("option",{value:p},p);if(p==="Chase Sapphire")o.selected=true;ptSel.append(o)});
  const tagInp=h("input",{class:"inp",type:"text",placeholder:"e.g., cozumel",onInput:e=>f.tag=e.target.value});

  const previewEl=h("div",{class:"preview hidden",id:"entryPreview"});
  function updatePreview(){
    const a=parseFloat(f.amt);if(isNaN(a)||!f.ss||!f.se){previewEl.classList.add("hidden");return}
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

  const submitBtn=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
    const a=parseFloat(f.amt);if(isNaN(a)||!f.desc)return;
    const fx=f.fx?parseFloat(f.fx):DFX[f.cur]||1;
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
  const subWrap=h("div",{style:{display:"flex",alignItems:"flex-end",paddingBottom:"4px"}});
  subWrap.append(subLabel);
  card.append(row(field("Payment Account",ptSel),field("Tag (optional)",tagInp),subWrap));
  card.append(creditRow);
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
  PTS.forEach(p=>{const o=h("option",{value:p},p);if(p==="Chase Sapphire")o.selected=true;impPtSel.append(o)});
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
    else if(!getApiKey()){
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
      if(!profile)throw new Error("Unrecognized bank format. Supported: Chase CC, Chase Chequing, AMEX, Bilt");
      if(profile.reparse)csv=profile.reparse(text);

      // Auto-detect payment type from filename (only if user hasn't manually changed it)
      if(!impPtManual){
        if(profile.name==="chase_checking")impPtSel.value="Chase Chequing";
        else if(profile.name==="chase")impPtSel.value="Chase Sapphire";
        else if(profile.name==="amex")impPtSel.value="AMEX Rose Gold";
        else if(profile.name==="bilt"||profile.name==="bilt_legacy")impPtSel.value="Bilt";
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
      if(!pages.length)throw new Error("No payslip data found. Is this a Pinterest payslip?");

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

}
