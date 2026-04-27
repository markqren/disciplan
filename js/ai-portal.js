// ai-portal.js — AI Dev Portal (#ai tab)
// Sections: Newsletter | Decision Log | Performance | Feedback | Rules | Synthesis Agent

async function renderAIPortal(el){
  el.innerHTML=`<div style="max-width:900px;margin:0 auto;padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h2 style="margin:0;font-size:18px">AI Dev Portal</h2>
      <span style="font-size:11px;color:rgba(255,255,255,0.3)">dev only — #ai</span>
    </div>
    <div id="ap-tabs" style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap"></div>
    <div id="ap-content"></div>
  </div>`;

  const sections=[
    ["newsletter","Newsletter"],
    ["log","Import Decisions"],
    ["perf","Import Performance"],
    ["feedback","Feedback"],
    ["rules","Rules Engine"],
    ["synth","Synthesis Agent"]
  ];
  let activeSection=sections[0][0];

  function renderSectionTabs(){
    const bar=document.getElementById("ap-tabs");
    bar.innerHTML="";
    sections.forEach(([id,label])=>{
      const b=h("button",{
        class:"pg-btn",
        style:{padding:"6px 14px",fontSize:"12px",opacity:activeSection===id?"1":"0.4"},
        onClick:()=>{activeSection=id;renderSectionTabs();renderSection()}
      },label);
      bar.append(b);
    });
  }

  async function renderSection(){
    const c=document.getElementById("ap-content");
    c.innerHTML=`<div style="text-align:center;padding:32px;color:rgba(255,255,255,0.3);font-size:13px">Loading...</div>`;
    try{
      if(activeSection==="newsletter")await renderNewsletter(c);
      else if(activeSection==="log")await renderDecisionLog(c);
      else if(activeSection==="perf")await renderPerformance(c);
      else if(activeSection==="feedback")await renderFeedback(c);
      else if(activeSection==="rules")await renderRules(c);
      else if(activeSection==="synth")await renderSynthesis(c);
    }catch(e){
      c.innerHTML=`<div class="cd" style="color:var(--r);padding:24px">${e.message||String(e)}</div>`;
    }
  }

  renderSectionTabs();
  await renderSection();
}

// ── SECTION 0: Newsletter ────────────────────────────────────────────────────

async function renderNewsletter(el){
  const[allLogs,ctxRows,strategies,pending,selections]=await Promise.all([
    sb("insight_log?order=created_at.desc&limit=100&select=id,created_at,insight_type,subject,model_used,input_tokens,output_tokens,cost_usd,feedback_rating,feedback_comment,feedback_received_at,parse_fallback,dry_run"),
    sb("insight_context?select=id,content,updated_at"),
    sb("insight_strategy?order=priority_weight.desc&select=*"),
    sb("principles_pending?status=eq.pending&order=created_at.desc&select=*"),
    sb("insight_selection_log?order=insight_log_id.desc&limit=10&select=*")
  ]);
  const ctx=ctxRows[0]||null;
  // Real sends drive KPIs; dry-runs are shown separately and never affect averages.
  const logs=allLogs.filter(l=>!l.dry_run);
  const dryLogs=allLogs.filter(l=>l.dry_run);
  el.innerHTML="";

  // KPI row (real sends only)
  const rated=logs.filter(l=>l.feedback_rating!=null);
  const avgRating=rated.length?Math.round(rated.reduce((s,l)=>s+parseFloat(l.feedback_rating),0)/rated.length*10)/10:null;
  const totalCost=allLogs.reduce((s,l)=>s+parseFloat(l.cost_usd||0),0);
  const ratedPct=logs.length?Math.round(rated.length/logs.length*100):0;
  const fallbackCount=logs.filter(l=>l.parse_fallback).length;
  const statRow=h("div",{style:{display:"flex",gap:"12px",marginBottom:"20px",flexWrap:"wrap"}});
  statRow.append(
    statCard(null,"emails sent",logs.length,"var(--b)"),
    statCard(null,"rated",ratedPct+"% ("+rated.length+"/"+logs.length+")",ratedPct>=50?"var(--g)":"var(--y)"),
    statCard(null,"avg rating",avgRating!=null?avgRating+"/10":"n/a",avgRating>=7?"var(--g)":avgRating>=5?"var(--y)":"var(--r)"),
    statCard(null,"total AI cost","$"+totalCost.toFixed(3),"rgba(255,255,255,0.5)"),
    statCard(null,"parse fallbacks",fallbackCount,fallbackCount===0?"var(--g)":"var(--r)"),
    statCard(null,"dry-run replays",dryLogs.length,dryLogs.length>0?"var(--y)":"rgba(255,255,255,0.3)")
  );
  el.append(statRow);

  // Pending principles approval queue (Phase 0 guardrail)
  if(pending.length){
    const pendH=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px",color:"var(--y)"}},"Pending Principles Updates ("+pending.length+")");
    el.append(pendH);
    for(const p of pending){
      const card=h("div",{class:"cd",style:{padding:"14px",marginBottom:"10px",borderColor:"rgba(242,204,143,0.3)"}});
      const meta=h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.4)",marginBottom:"8px"}},
        (p.created_at||"").slice(0,16).replace("T"," ")+" UTC · triggered by log #"+(p.triggering_log_id||"?")+" · "+(p.proposed_length_delta>=0?"+":"")+p.proposed_length_delta+" chars");
      const diffWrap=h("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"10px"}});
      diffWrap.append(
        h("div",{style:{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"6px",padding:"10px",fontSize:"11px",fontFamily:"var(--mono)",lineHeight:"1.6",whiteSpace:"pre-wrap",maxHeight:"260px",overflow:"auto",color:"rgba(255,255,255,0.45)"}},(p.current_principles||"").slice(0,3000)),
        h("div",{style:{background:"rgba(129,178,154,0.05)",border:"1px solid rgba(129,178,154,0.2)",borderRadius:"6px",padding:"10px",fontSize:"11px",fontFamily:"var(--mono)",lineHeight:"1.6",whiteSpace:"pre-wrap",maxHeight:"260px",overflow:"auto",color:"rgba(255,255,255,0.85)"}},(p.proposed_principles||"").slice(0,3000))
      );
      card.append(meta,diffWrap);
      const btnRow=h("div",{style:{display:"flex",gap:"8px"}});
      const approveBtn=h("button",{class:"pg-btn",onClick:async()=>{
        approveBtn.disabled=true;approveBtn.textContent="Approving...";
        await sb("insight_context?id=eq.principles",{method:"PATCH",body:JSON.stringify({content:p.proposed_principles,updated_at:new Date().toISOString()})});
        await sb(`principles_pending?id=eq.${p.id}`,{method:"PATCH",body:JSON.stringify({status:"approved",reviewed_at:new Date().toISOString(),reviewed_by:"mark"})});
        await renderNewsletter(el);
      }},"Approve");
      const rejectBtn=h("button",{class:"pg-btn",style:{opacity:"0.6"},onClick:async()=>{
        rejectBtn.disabled=true;
        await sb(`principles_pending?id=eq.${p.id}`,{method:"PATCH",body:JSON.stringify({status:"rejected",reviewed_at:new Date().toISOString(),reviewed_by:"mark"})});
        await renderNewsletter(el);
      }},"Reject");
      btnRow.append(approveBtn,rejectBtn);
      card.append(btnRow);
      el.append(card);
    }
  }

  // Strategy operator table
  const stratH=h("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}});
  stratH.append(
    h("div",{style:{fontWeight:"600",fontSize:"13px"}},"Strategy & Performance by Insight Type"),
    h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.3)"}},"editable: enabled, cooldown, monthly cap")
  );
  el.append(stratH);
  el.append(renderStrategyTable(strategies,el));

  // Recent selection traces (last 5)
  if(selections.length){
    const selH=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px",marginTop:"20px"}},"Recent Selection Traces");
    el.append(selH);
    const logById=new Map(logs.map(l=>[l.id,l]));
    const selCard=h("div",{class:"cd",style:{padding:"0",overflow:"hidden",marginBottom:"20px"}});
    for(const s of selections.slice(0,5)){
      const log=logById.get(s.insight_log_id);
      const dateStr=log?(log.created_at||"").slice(0,10):"#"+s.insight_log_id;
      const row=h("div",{style:{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)"}});
      const top=h("div",{style:{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap",fontSize:"12px"}});
      top.append(
        h("span",{style:{color:"rgba(255,255,255,0.4)",width:"85px"}},dateStr),
        h("span",{style:{fontWeight:"600",color:"var(--g)"}},s.selected_type),
        s.exploration_taken?h("span",{style:{fontSize:"10px",padding:"1px 6px",background:"rgba(242,204,143,0.15)",color:"var(--y)",borderRadius:"3px"}},"exploration"):h("span",{}),
        h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.3)"}},s.policy)
      );
      row.append(top);
      const cands=Array.isArray(s.candidates)?s.candidates:[];
      const eligible=cands.filter(c=>c.passed_gate);
      const skipped=cands.filter(c=>!c.passed_gate);
      const candDetail=h("div",{style:{marginTop:"6px",paddingLeft:"95px",fontSize:"11px",color:"rgba(255,255,255,0.5)",lineHeight:"1.6",fontFamily:"var(--mono)"}});
      const eligList=eligible.map(c=>`${c.insight_type}=${c.score?.toFixed(2)}${c.selected?"*":""}`).join("  ");
      candDetail.append(h("div",{},"eligible: "+(eligList||"(none)")));
      if(skipped.length){
        const skipList=skipped.slice(0,4).map(c=>`${c.insight_type}: ${(c.reason||"").slice(0,40)}`).join(" · ");
        candDetail.append(h("div",{style:{color:"rgba(255,255,255,0.3)"}},"skipped: "+skipList+(skipped.length>4?` (+${skipped.length-4} more)`:"")));
      }
      row.append(candDetail);
      selCard.append(row);
    }
    el.append(selCard);
  }

  // Email log — toggle to show/hide dry-run replays.
  let showDry=false;
  const logH=h("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px",marginTop:"20px"}});
  const logTitle=h("div",{style:{fontWeight:"600",fontSize:"13px"}},"Email Log");
  const dryToggle=h("button",{class:"pg-btn",style:{fontSize:"10px",padding:"2px 8px",opacity:"0.6"},onClick:()=>{showDry=!showDry;dryToggle.textContent=showDry?"hide dry-runs":"show dry-runs ("+dryLogs.length+")";renderRows()}},"show dry-runs ("+dryLogs.length+")");
  logH.append(logTitle,dryLogs.length?dryToggle:h("span",{}));
  el.append(logH);
  const logTbl=h("div",{class:"cd",style:{padding:"0",overflow:"hidden",marginBottom:"20px"}});
  function renderRows(){
    logTbl.innerHTML="";
    const rows=showDry?allLogs:logs;
    for(const l of rows){
      const hasComment=!!(l.feedback_comment&&l.feedback_comment.trim());
      const row=h("div",{style:{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",background:l.dry_run?"rgba(242,204,143,0.04)":""}});
      const top=h("div",{style:{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}});
      const ratingColor=l.feedback_rating>=7?"var(--g)":l.feedback_rating>=5?"var(--y)":"var(--r)";
      top.append(
        h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.3)",width:"85px",flexShrink:"0"}},l.created_at.slice(0,10)),
        h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.4)",width:"130px",flexShrink:"0"}},l.insight_type.replace(/_/g," ")),
        h("span",{style:{flex:"1",fontSize:"12px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},title:l.subject},l.subject||""),
        l.dry_run?h("span",{style:{fontSize:"10px",padding:"1px 6px",background:"rgba(242,204,143,0.15)",color:"var(--y)",borderRadius:"3px",flexShrink:"0",fontFamily:"var(--mono)"}},"DRY-RUN"):h("span",{}),
        l.feedback_rating!=null
          ?h("span",{style:{fontSize:"13px",fontWeight:"600",color:ratingColor,flexShrink:"0"}},parseFloat(l.feedback_rating)+"/10")
          :h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.2)",flexShrink:"0"}},l.dry_run?"":"unrated"),
        h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.25)",flexShrink:"0"}},"$"+parseFloat(l.cost_usd||0).toFixed(4))
      );
      row.append(top);
      if(hasComment){
        const comment=h("div",{style:{marginTop:"6px",paddingLeft:"225px",fontSize:"12px",color:"rgba(255,255,255,0.55)",fontStyle:"italic",lineHeight:"1.5"}},"\u201C"+l.feedback_comment.trim()+"\u201D");
        row.append(comment);
      }
      logTbl.append(row);
    }
  }
  renderRows();
  el.append(logTbl);

  // Learned Principles (insight_context)
  const princH=h("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}});
  princH.append(
    h("div",{style:{fontWeight:"600",fontSize:"13px"}},"Learned Principles"),
    ctx?h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.3)"}},"last updated "+ctx.updated_at.slice(0,10)):h("span",{})
  );
  el.append(princH);

  const princCard=h("div",{class:"cd",style:{padding:"16px",marginBottom:"12px"}});
  if(ctx){
    // Parse and display principles cleanly (strip --- separators)
    const lines=ctx.content.split("\n").filter(l=>l.trim()&&l.trim()!=="---");
    const princText=h("div",{style:{fontSize:"12px",lineHeight:"1.8",fontFamily:"var(--mono)",whiteSpace:"pre-wrap",color:"rgba(255,255,255,0.75)"}},lines.join("\n"));
    princCard.append(princText);
  }else{
    princCard.innerHTML=`<div style="color:rgba(255,255,255,0.3);font-size:13px">No learned principles yet. Principles are built from your email reply feedback.</div>`;
  }

  // Edit principles button
  const editBtn=h("button",{class:"pg-btn",style:{fontSize:"11px",padding:"4px 12px",marginTop:"10px"},onClick:()=>openPrinciplesEditor(el,ctx)},"Edit Principles");
  princCard.append(editBtn);
  el.append(princCard);
}

// Strategy operator table — read+write to insight_strategy via PostgREST.
// Suggest-disable badge: avg < 4 with at least 3 ratings (Phase 4 — never auto-disables).
function renderStrategyTable(strategies,parentEl){
  const wrap=h("div",{class:"cd",style:{padding:"0",overflow:"auto",marginBottom:"16px"}});
  const tbl=h("table",{style:{width:"100%",borderCollapse:"collapse",fontSize:"12px",fontFamily:"var(--mono)"}});
  const cols=[
    {label:"On",width:"40px"},
    {label:"Type",width:"180px"},
    {label:"Avg",width:"60px"},
    {label:"Sent",width:"50px"},
    {label:"Rated",width:"50px"},
    {label:"Cooldown",width:"90px"},
    {label:"Mthly Cap",width:"80px"},
    {label:"Weight",width:"60px"},
    {label:"Last Used",width:"95px"},
    {label:"Skip",flex:true}
  ];
  const thead=h("tr");
  cols.forEach(c=>thead.append(h("th",{style:{padding:"8px 10px",textAlign:"left",color:"rgba(255,255,255,0.35)",fontWeight:"500",borderBottom:"1px solid rgba(255,255,255,0.1)",whiteSpace:"nowrap",width:c.flex?"auto":(c.width||"auto")}},c.label)));
  tbl.append(h("thead",{},thead));
  const tbody=h("tbody");

  for(const s of strategies){
    const avg=s.rated_count>0?Math.round(s.rating_sum/s.rated_count*10)/10:null;
    const suggestDisable=avg!=null&&avg<4&&s.rated_count>=3;
    const tr=h("tr",{style:{borderBottom:"1px solid rgba(255,255,255,0.04)",opacity:s.enabled?"1":"0.45"}});

    const enabledTd=h("td",{style:{padding:"6px 10px"}});
    const enabledBtn=h("button",{class:"pg-btn",style:{fontSize:"10px",padding:"2px 8px",minWidth:"32px",opacity:s.enabled?"1":"0.4",color:s.enabled?"var(--g)":"rgba(255,255,255,0.5)"},onClick:async()=>{
      enabledBtn.disabled=true;
      await sb(`insight_strategy?insight_type=eq.${encodeURIComponent(s.insight_type)}`,{method:"PATCH",body:JSON.stringify({enabled:!s.enabled,updated_at:new Date().toISOString()})});
      await renderNewsletter(parentEl);
    }},s.enabled?"on":"off");
    enabledTd.append(enabledBtn);

    const typeTd=h("td",{style:{padding:"6px 10px"}});
    typeTd.append(h("span",{},s.insight_type.replace(/_/g," ")));
    if(suggestDisable){
      typeTd.append(h("span",{style:{marginLeft:"6px",fontSize:"10px",padding:"1px 5px",background:"rgba(224,122,95,0.15)",color:"var(--r)",borderRadius:"3px",whiteSpace:"nowrap"},title:`Avg ${avg}/10 across ${s.rated_count} ratings`},"suggest disable"));
    }
    if(s.notes){
      typeTd.title=s.notes;
    }

    const avgTd=h("td",{style:{padding:"6px 10px",color:avg==null?"rgba(255,255,255,0.25)":(avg>=7?"var(--g)":avg>=5?"var(--y)":"var(--r)"),fontWeight:"600"}},avg==null?"—":(avg+"/10"));
    const sentTd=h("td",{style:{padding:"6px 10px",color:"rgba(255,255,255,0.7)"}},s.sent_count||0);
    const ratedTd=h("td",{style:{padding:"6px 10px",color:"rgba(255,255,255,0.7)"}},s.rated_count||0);

    const cooldownTd=h("td",{style:{padding:"4px 10px"}});
    const cooldownInput=h("input",{type:"number",min:"0",max:"60",value:String(s.cooldown_days??0),style:{width:"60px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"4px",color:"#fff",padding:"3px 6px",fontSize:"11px",fontFamily:"var(--mono)"}});
    cooldownInput.addEventListener("change",async()=>{
      const v=parseInt(cooldownInput.value,10);
      if(Number.isNaN(v)||v<0||v>60){cooldownInput.value=s.cooldown_days;return}
      await sb(`insight_strategy?insight_type=eq.${encodeURIComponent(s.insight_type)}`,{method:"PATCH",body:JSON.stringify({cooldown_days:v,updated_at:new Date().toISOString()})});
      s.cooldown_days=v;
    });
    cooldownTd.append(cooldownInput,h("span",{style:{fontSize:"10px",color:"rgba(255,255,255,0.3)",marginLeft:"4px"}},"d"));

    const monthlyTd=h("td",{style:{padding:"4px 10px"}});
    const monthlyInput=h("input",{type:"number",min:"0",max:"30",value:String(s.monthly_max??""),placeholder:"—",style:{width:"50px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"4px",color:"#fff",padding:"3px 6px",fontSize:"11px",fontFamily:"var(--mono)"}});
    monthlyInput.addEventListener("change",async()=>{
      const v=monthlyInput.value===""?null:parseInt(monthlyInput.value,10);
      if(v!=null&&(Number.isNaN(v)||v<0||v>30)){monthlyInput.value=s.monthly_max??"";return}
      await sb(`insight_strategy?insight_type=eq.${encodeURIComponent(s.insight_type)}`,{method:"PATCH",body:JSON.stringify({monthly_max:v,updated_at:new Date().toISOString()})});
      s.monthly_max=v;
    });
    monthlyTd.append(monthlyInput);

    const weightTd=h("td",{style:{padding:"6px 10px",color:"rgba(255,255,255,0.7)"},title:"Set by feedback policy. Bounded to [0.10, 2.00]."},(s.priority_weight??1).toFixed(2));
    const lastUsedTd=h("td",{style:{padding:"6px 10px",color:"rgba(255,255,255,0.4)",fontSize:"11px"}},s.last_used_at?s.last_used_at.slice(0,10):"never");
    const skipTd=h("td",{style:{padding:"6px 10px",color:"rgba(255,255,255,0.35)",fontSize:"11px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"260px"},title:s.last_skip_reason||""},(s.last_skip_reason||"").slice(0,40));

    tr.append(enabledTd,typeTd,avgTd,sentTd,ratedTd,cooldownTd,monthlyTd,weightTd,lastUsedTd,skipTd);
    tbody.append(tr);
  }

  tbl.append(tbody);
  wrap.append(tbl);
  return wrap;
}

async function openPrinciplesEditor(el,ctx){
  const existing=ctx?.content||"";
  const bg=h("div",{style:{position:"fixed",inset:"0",background:"rgba(0,0,0,0.7)",zIndex:"1000",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}});
  const modal=h("div",{class:"cd",style:{width:"100%",maxWidth:"700px",maxHeight:"80vh",display:"flex",flexDirection:"column",padding:"20px",gap:"12px"}});
  modal.innerHTML=`<div style="font-weight:600;font-size:14px">Edit Learned Principles</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.4)">These are injected into every newsletter generation prompt. Edit carefully — or use the Synthesis Agent to regenerate from feedback.</div>`;
  const ta=h("textarea",{style:{flex:"1",minHeight:"400px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:"6px",color:"#fff",padding:"12px",fontSize:"12px",fontFamily:"var(--mono)",resize:"vertical",lineHeight:"1.7"}});
  ta.value=existing;
  const btnRow=h("div",{style:{display:"flex",gap:"8px",justifyContent:"flex-end"}});
  const cancelBtn=h("button",{class:"pg-btn",style:{opacity:"0.5"},onClick:()=>bg.remove()},"Cancel");
  const saveBtn=h("button",{class:"pg-btn",onClick:async()=>{
    saveBtn.disabled=true;saveBtn.textContent="Saving...";
    const newContent=ta.value;
    if(ctx){
      await sb("insight_context?id=eq.principles",{method:"PATCH",body:JSON.stringify({content:newContent,updated_at:new Date().toISOString()})});
    }else{
      await sb("insight_context",{method:"POST",body:JSON.stringify({id:"principles",content:newContent})});
    }
    bg.remove();
    await renderNewsletter(el);
  }},"Save");
  btnRow.append(cancelBtn,saveBtn);
  modal.append(ta,btnRow);
  bg.append(modal);
  document.body.append(bg);
  bg.addEventListener("click",e=>{if(e.target===bg)bg.remove()});
}

// ── SECTION 1: Decision Log ──────────────────────────────────────────────────

async function renderDecisionLog(el){
  // Fetch CSV import decisions (transactions with ai_original)
  const txns=await sb("transactions?ai_original=not.is.null&order=id.desc&limit=200&select=id,date,bank_description,description,category_id,ai_original,import_batch");
  // Fetch email import decisions
  const emails=await sb("pending_imports?order=email_received_at.desc&limit=100&select=id,email_received_at,email_subject,source,ai_category,ai_description,ai_confidence,final_category_id,final_description,was_edited,status");

  el.innerHTML="";

  // Stat row
  const csvOverrides=txns.filter(t=>t.ai_original&&(t.ai_original.cat!==t.category_id||t.ai_original.desc!==t.description));
  const emailOverrides=emails.filter(e=>e.was_edited);
  const statRow=h("div",{style:{display:"flex",gap:"12px",marginBottom:"20px",flexWrap:"wrap"}});
  statRow.append(
    statCard(null,"CSV AI decisions",txns.length,"var(--b)"),
    statCard(null,"CSV overridden",csvOverrides.length,"var(--y)"),
    statCard(null,"Email decisions",emails.filter(e=>e.status==="committed").length,"var(--b)"),
    statCard(null,"Email edited",emailOverrides.length,"var(--y)")
  );
  el.append(statRow);

  // Email imports table
  const committedEmails=emails.filter(e=>e.status==="committed"||e.was_edited);
  if(committedEmails.length){
    const h2=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px",marginTop:"4px"}},"Email Import Decisions");
    el.append(h2);
    const tbl=apDecisionTable([
      {label:"Date",width:"90px"},{label:"Source",width:"70px"},{label:"Subject",flex:true},
      {label:"AI Category",width:"120px"},{label:"Final Category",width:"120px"},
      {label:"Conf",width:"50px"},{label:"Edited?",width:"60px"}
    ],committedEmails.map(e=>{
      const edited=e.was_edited;
      const catMismatch=e.final_category_id&&e.ai_category&&e.final_category_id!==e.ai_category;
      return[
        (e.email_received_at||"").slice(0,10),
        e.source||"—",
        h("span",{title:e.email_subject,style:{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}},(e.email_subject||"").slice(0,60)),
        h("span",{style:{color:catMismatch?"var(--r)":"inherit"}},e.ai_category||"—"),
        h("span",{style:{color:catMismatch?"var(--g)":"inherit"}},e.final_category_id||e.ai_category||"—"),
        apConfBadge(e.ai_confidence),
        h("span",{style:{color:edited?"var(--y)":"rgba(255,255,255,0.3)"}},edited?"yes":"—")
      ];
    }));
    el.append(tbl);
  }

  // CSV imports table
  if(txns.length){
    const h2=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px",marginTop:"20px"}},"CSV Import Decisions (recent 200)");
    el.append(h2);
    const tbl=apDecisionTable([
      {label:"Date",width:"90px"},{label:"Bank Description",flex:true},
      {label:"AI Description",flex:true},{label:"AI Cat",width:"110px"},
      {label:"Final Cat",width:"110px"},{label:"Conf",width:"50px"}
    ],txns.map(t=>{
      const aiCat=t.ai_original?.cat;
      const catChanged=aiCat&&aiCat!==t.category_id;
      const descChanged=t.ai_original?.desc&&t.ai_original.desc!==t.description;
      return[
        t.date,
        h("span",{title:t.bank_description,style:{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}},(t.bank_description||"").slice(0,50)),
        h("span",{style:{color:descChanged?"var(--y)":"inherit",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"},title:t.ai_original?.desc},(t.ai_original?.desc||"").slice(0,50)),
        h("span",{style:{color:catChanged?"var(--r)":"inherit"}},aiCat||"—"),
        h("span",{style:{color:catChanged?"var(--g)":"inherit"}},t.category_id||"—"),
        apConfBadge(t.ai_original?.conf)
      ];
    }));
    el.append(tbl);
  }
}

// ── SECTION 2: Performance Dashboard ────────────────────────────────────────

async function renderPerformance(el){
  const[txns,emails]=await Promise.all([
    sb("transactions?ai_original=not.is.null&order=id.desc&limit=500&select=date,category_id,ai_original"),
    sb("pending_imports?status=eq.committed&order=email_received_at.desc&limit=200&select=ai_category,ai_confidence,final_category_id,was_edited,source")
  ]);

  el.innerHTML="";

  // CSV accuracy
  const csvWithAI=txns.filter(t=>t.ai_original?.cat);
  const csvCatCorrect=csvWithAI.filter(t=>t.ai_original.cat===t.category_id).length;
  const csvDescAccepted=txns.filter(t=>t.ai_original?.desc&&t.ai_original.desc===t.description).length;
  const csvAccPct=csvWithAI.length?Math.round(csvCatCorrect/csvWithAI.length*100):0;
  const csvDescPct=csvWithAI.length?Math.round(csvDescAccepted/csvWithAI.length*100):0;

  // Email accuracy
  const emailWithFinal=emails.filter(e=>e.final_category_id);
  const emailCatCorrect=emailWithFinal.filter(e=>e.ai_category===e.final_category_id).length;
  const emailAccPct=emailWithFinal.length?Math.round(emailCatCorrect/emailWithFinal.length*100):0;

  const statRow=h("div",{style:{display:"flex",gap:"12px",marginBottom:"24px",flexWrap:"wrap"}});
  statRow.append(
    statCard(null,"CSV category accuracy",csvAccPct+"%",csvAccPct>=80?"var(--g)":"var(--y)"),
    statCard(null,"CSV description kept",csvDescPct+"%",csvDescPct>=70?"var(--g)":"var(--y)"),
    statCard(null,"Email category accuracy",emailAccPct+"%"+(emailWithFinal.length===0?" (no data)":""),emailAccPct>=80?"var(--g)":"var(--y)"),
    statCard(null,"Total AI decisions",csvWithAI.length+emails.length,"var(--b)")
  );
  el.append(statRow);

  // Confidence calibration for CSV
  if(csvWithAI.length){
    const byConf={high:[],medium:[],low:[]};
    for(const t of csvWithAI){
      const conf=t.ai_original.conf||"low";
      if(byConf[conf])byConf[conf].push(t.ai_original.cat===t.category_id?1:0);
    }
    const confTable=apDecisionTable([
      {label:"Confidence",width:"100px"},{label:"Count",width:"70px"},{label:"Accuracy",width:"100px"},{label:"Calibrated?",width:"100px"}
    ],[
      ...["high","medium","low"].filter(k=>byConf[k].length).map(k=>{
        const acc=Math.round(byConf[k].reduce((a,b)=>a+b,0)/byConf[k].length*100);
        const expected=k==="high"?85:k==="medium"?65:40;
        return[k,byConf[k].length,acc+"%",
          h("span",{style:{color:acc>=expected?"var(--g)":"var(--r)"}},acc>=expected?"yes":"under")];
      })
    ]);
    const confH=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px"}},"Confidence Calibration (CSV)");
    el.append(confH,confTable);
  }

  // Category-level accuracy for CSV
  if(csvWithAI.length){
    const byCat={};
    for(const t of csvWithAI){
      const cat=t.ai_original.cat;
      if(!byCat[cat])byCat[cat]={correct:0,total:0};
      byCat[cat].total++;
      if(t.ai_original.cat===t.category_id)byCat[cat].correct++;
    }
    const catRows=Object.entries(byCat).sort((a,b)=>b[1].total-a[1].total).map(([cat,s])=>{
      const pct=Math.round(s.correct/s.total*100);
      return[cat,s.total,pct+"%",
        h("div",{style:{background:"rgba(255,255,255,0.1)",borderRadius:"3px",overflow:"hidden",width:"80px",height:"10px"}},
          h("div",{style:{width:pct+"%",height:"100%",background:pct>=80?"var(--g)":pct>=60?"var(--y)":"var(--r)"}})
        )];
    });
    const catH=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px",marginTop:"20px"}},"Accuracy by Category (CSV)");
    const catTable=apDecisionTable([{label:"Category",width:"130px"},{label:"Decisions",width:"80px"},{label:"Accuracy",width:"80px"},{label:"",flex:true}],catRows);
    el.append(catH,catTable);
  }

  // Email accuracy by source
  if(emails.length){
    const bySrc={};
    for(const e of emails){
      const src=e.source||"unknown";
      if(!bySrc[src])bySrc[src]={edited:0,total:0,correct:0};
      bySrc[src].total++;
      if(e.was_edited)bySrc[src].edited++;
      if(e.final_category_id&&e.ai_category===e.final_category_id)bySrc[src].correct++;
    }
    const srcRows=Object.entries(bySrc).sort((a,b)=>b[1].total-a[1].total).map(([src,s])=>{
      const acc=s.final_category_id?Math.round(s.correct/s.total*100):null;
      return[src,s.total,s.edited,acc!=null?acc+"%":"n/a"];
    });
    const srcH=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px",marginTop:"20px"}},"Email Accuracy by Source");
    const srcTable=apDecisionTable([{label:"Source",width:"100px"},{label:"Total",width:"70px"},{label:"Edited",width:"70px"},{label:"Cat Accuracy",width:"100px"}],srcRows);
    el.append(srcH,srcTable);
  }
}

// ── SECTION 3: Feedback Interface ───────────────────────────────────────────

async function renderFeedback(el){
  const[existing,txns]=await Promise.all([
    sb("ai_feedback?order=created_at.desc&limit=100"),
    sb("transactions?ai_original=not.is.null&order=id.desc&limit=50&select=id,date,bank_description,description,category_id,ai_original")
  ]);

  el.innerHTML="";

  // Add note / freeform feedback area
  const noteCard=h("div",{class:"cd",style:{marginBottom:"20px",padding:"16px"}});
  noteCard.innerHTML=`<div style="font-weight:600;font-size:13px;margin-bottom:10px">Add Feedback Note</div>`;
  const textarea=h("textarea",{style:{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:"6px",color:"#fff",padding:"10px",fontSize:"13px",fontFamily:"var(--mono)",resize:"vertical",minHeight:"80px",boxSizing:"border-box"},placeholder:"e.g. 'Uber Eats should always be Restaurant, not Transportation' or 'Amazon purchases under $20 are usually personal, not tech'"});
  const saveNoteBtn=h("button",{class:"pg-btn",style:{marginTop:"8px"},onClick:async()=>{
    const note=textarea.value.trim();
    if(!note)return;
    saveNoteBtn.disabled=true;saveNoteBtn.textContent="Saving...";
    await sb("ai_feedback",{method:"POST",body:JSON.stringify({feedback_type:"note",note})});
    textarea.value="";saveNoteBtn.disabled=false;saveNoteBtn.textContent="Save Note";
    await renderFeedback(el);
  }},"Save Note");
  noteCard.append(textarea,saveNoteBtn);
  el.append(noteCard);

  // Rate recent AI decisions
  const overrides=txns.filter(t=>t.ai_original?.cat&&t.ai_original.cat!==t.category_id);
  if(overrides.length){
    const oh=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px"}},"Recent AI Overrides — Rate These");
    el.append(oh);
    const ovTable=h("div",{class:"cd",style:{padding:"0",overflow:"hidden"}});
    for(const t of overrides.slice(0,20)){
      const row=h("div",{style:{display:"flex",alignItems:"center",gap:"12px",padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",flexWrap:"wrap"}});
      row.append(
        h("span",{style:{color:"rgba(255,255,255,0.4)",fontSize:"11px",width:"85px",flexShrink:"0"}},t.date),
        h("span",{style:{flex:"1",minWidth:"120px",fontSize:"12px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},title:t.bank_description},t.bank_description||""),
        h("span",{style:{fontSize:"12px",color:"var(--r)",flexShrink:"0"}},"AI: "+t.ai_original.cat),
        h("span",{style:{fontSize:"12px",color:"var(--g)",flexShrink:"0"}},"→ "+t.category_id)
      );
      const createRuleBtn=h("button",{class:"pg-btn",style:{fontSize:"11px",padding:"4px 10px"},onClick:async()=>{
        const ruleText=`"${normalizeMerchant(t.bank_description||"")}" -> category: ${t.category_id}, description: "${t.description}"`;
        await sb("ai_rules",{method:"POST",body:JSON.stringify({rule_type:"category_override",merchant_pattern:normalizeMerchant(t.bank_description||""),rule_text:ruleText,category_id:t.category_id,source:"feedback"})});
        createRuleBtn.textContent="Rule created!";createRuleBtn.disabled=true;
      }},"Create Rule");
      row.append(createRuleBtn);
      ovTable.append(row);
    }
    el.append(ovTable);
  }

  // Existing feedback log
  if(existing.length){
    const fh=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px",marginTop:"20px"}},"Feedback Log ("+existing.length+")");
    el.append(fh);
    const fTable=apDecisionTable([
      {label:"Date",width:"90px"},{label:"Type",width:"100px"},{label:"Note / Value",flex:true}
    ],existing.map(f=>[
      (f.created_at||"").slice(0,10),
      f.feedback_type,
      f.note||(f.corrected_value?(f.suggested_value+" → "+f.corrected_value):f.suggested_value||"—")
    ]));
    el.append(fTable);
  }
}

// ── SECTION 4: Rules Engine ──────────────────────────────────────────────────

async function renderRules(el){
  const rules=await sb("ai_rules?order=created_at.desc");
  el.innerHTML="";

  // Add rule form
  const addCard=h("div",{class:"cd",style:{marginBottom:"20px",padding:"16px"}});
  addCard.innerHTML=`<div style="font-weight:600;font-size:13px;margin-bottom:10px">Add Rule</div>`;
  const typeSelect=h("select",{style:{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:"6px",color:"#fff",padding:"6px 10px",fontSize:"12px",marginRight:"8px"}});
  ["category_override","description_template","merchant_alias","general_instruction"].forEach(t=>{
    typeSelect.append(h("option",{value:t},t.replace(/_/g," ")));
  });
  const ruleInput=h("input",{type:"text",placeholder:'e.g. "uber eats" -> category: restaurant, description: "Restaurant - Uber Eats"',style:{flex:"1",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:"6px",color:"#fff",padding:"8px 10px",fontSize:"12px"}});
  const merchantInput=h("input",{type:"text",placeholder:"merchant pattern (optional)",style:{width:"160px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:"6px",color:"#fff",padding:"8px 10px",fontSize:"12px"}});
  const addRow=h("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}});
  const addBtn=h("button",{class:"pg-btn",onClick:async()=>{
    const text=ruleInput.value.trim();if(!text)return;
    addBtn.disabled=true;addBtn.textContent="Saving...";
    await sb("ai_rules",{method:"POST",body:JSON.stringify({rule_type:typeSelect.value,merchant_pattern:merchantInput.value.trim()||null,rule_text:text,source:"manual"})});
    ruleInput.value="";merchantInput.value="";addBtn.disabled=false;addBtn.textContent="Add Rule";
    await renderRules(el);
  }},"Add Rule");
  addRow.append(typeSelect,merchantInput,ruleInput,addBtn);
  addCard.append(addRow);
  el.append(addCard);

  if(!rules.length){
    el.append(h("div",{class:"cd",style:{padding:"24px",textAlign:"center",color:"rgba(255,255,255,0.3)",fontSize:"13px"}},"No rules yet. Add rules above or use the Synthesis Agent to generate suggestions."));
    return;
  }

  const tbl=h("div",{class:"cd",style:{padding:"0",overflow:"hidden"}});
  for(const r of rules){
    const row=h("div",{style:{display:"flex",alignItems:"flex-start",gap:"12px",padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)"}});
    const toggle=h("button",{class:"pg-btn",style:{fontSize:"11px",padding:"3px 8px",opacity:r.is_active?"1":"0.4"},onClick:async()=>{
      await sb(`ai_rules?id=eq.${r.id}`,{method:"PATCH",body:JSON.stringify({is_active:!r.is_active,updated_at:new Date().toISOString()})});
      await renderRules(el);
    }},r.is_active?"active":"off");
    const delBtn=h("button",{class:"pg-btn",style:{fontSize:"11px",padding:"3px 8px",color:"var(--r)"},onClick:async()=>{
      if(!confirm("Delete this rule?"))return;
      await sb(`ai_rules?id=eq.${r.id}`,{method:"DELETE"});
      await renderRules(el);
    }},"del");
    row.append(
      toggle,
      h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.3)",width:"120px",flexShrink:"0"}},r.rule_type.replace(/_/g," ")),
      h("span",{style:{flex:"1",fontSize:"12px",fontFamily:"var(--mono)"}},r.rule_text),
      h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.3)",width:"70px",flexShrink:"0"}},"src: "+r.source),
      delBtn
    );
    tbl.append(row);
  }
  el.append(h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"8px"}},"Active Rules ("+rules.filter(r=>r.is_active).length+"/"+rules.length+")"),tbl);
}

// ── SECTION 5: Synthesis Agent ───────────────────────────────────────────────

async function renderSynthesis(el){
  el.innerHTML="";

  const pastRuns=await sb("ai_synthesis_runs?order=created_at.desc&limit=5");

  const card=h("div",{class:"cd",style:{padding:"20px",marginBottom:"20px"}});
  card.innerHTML=`<div style="font-weight:600;font-size:14px;margin-bottom:8px">AI Synthesis Agent</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:16px;line-height:1.6">
      Analyzes your feedback, overrides, and group label corrections using claude-opus-4-6 to suggest new rules and prompt improvements.
    </div>`;

  const analyzeBtn=h("button",{class:"pg-btn",style:{padding:"10px 24px"},onClick:()=>runSynthesis(el)},"Analyze Feedback");
  card.append(analyzeBtn);
  el.append(card);

  if(pastRuns.length){
    const ph=h("div",{style:{fontWeight:"600",fontSize:"13px",marginBottom:"10px"}},"Past Runs");
    el.append(ph);
    for(const run of pastRuns){
      const rc=h("div",{class:"cd",style:{padding:"14px",marginBottom:"10px"}});
      rc.innerHTML=`<div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;color:rgba(255,255,255,0.5)">${(run.created_at||"").slice(0,16).replace("T"," ")} UTC</span>
        <span style="font-size:11px;color:rgba(255,255,255,0.3)">${run.feedback_count||0} feedback · ${run.override_count||0} overrides · ${run.tokens_used||0} tokens</span>
      </div>`;
      const suggs=run.suggestions||[];
      const accepted=new Set((run.accepted_suggestions||[]).map(s=>s.id||s.rule_text));
      suggs.forEach(s=>{
        const sRow=h("div",{style:{padding:"8px 0",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:"10px",alignItems:"flex-start"}});
        sRow.append(
          h("span",{style:{fontSize:"11px",color:"rgba(255,255,255,0.3)",width:"100px",flexShrink:"0"}},s.type||"suggestion"),
          h("span",{style:{flex:"1",fontSize:"12px",fontFamily:"var(--mono)"}},s.rule_text||s.details||""),
          h("span",{style:{fontSize:"11px",color:accepted.has(s.id||s.rule_text)?"var(--g)":"rgba(255,255,255,0.3)"}},accepted.has(s.id||s.rule_text)?"accepted":"—")
        );
        rc.append(sRow);
      });
      el.append(rc);
    }
  }
}

async function runSynthesis(el){
  const apiKey=getApiKey();
  if(!apiKey){alert("No Claude API key set. Add it in the Entry tab.");return}

  const statusEl=h("div",{style:{padding:"16px",fontSize:"13px",color:"rgba(255,255,255,0.5)"}});
  el.prepend(statusEl);
  statusEl.textContent="Gathering data...";

  const[feedback,overrides,groupOverrides,rules]=await Promise.all([
    sb("ai_feedback?order=created_at.desc&limit=100"),
    sb("transactions?ai_original=not.is.null&order=id.desc&limit=200&select=date,bank_description,description,category_id,ai_original"),
    sb("group_overrides?label=not.is.null&order=updated_at.desc&limit=50&select=group_id,label,category_id"),
    sb("ai_rules?is_active=eq.true&order=created_at.asc")
  ]);

  const csvOverrides=overrides.filter(t=>t.ai_original?.cat&&t.ai_original.cat!==t.category_id);

  statusEl.textContent="Calling claude-opus-4-6...";

  const prompt=`You are an AI improvement advisor for a personal finance categorization system. Analyze the following data and suggest specific, actionable improvements.

CURRENT ACTIVE RULES:
${rules.length?rules.map(r=>r.rule_text).join("\n"):"(none yet)"}

RECENT CATEGORY OVERRIDES (AI suggested → user chose):
${csvOverrides.slice(0,50).map(t=>`bank_desc="${t.bank_description}" ai_cat="${t.ai_original.cat}" final_cat="${t.category_id}" ai_desc="${t.ai_original.desc}" final_desc="${t.description}"`).join("\n")||"(none)"}

EXPLICIT FEEDBACK NOTES:
${feedback.filter(f=>f.feedback_type==="note"&&f.note).map(f=>`- ${f.note}`).join("\n")||"(none)"}

GROUP LABEL CORRECTIONS:
${groupOverrides.slice(0,20).map(g=>`group_id=${g.group_id} label="${g.label}"${g.category_id?" cat="+g.category_id:""}`).join("\n")||"(none)"}

Based on the above, suggest 3-8 specific rules to add or improve. Each rule should be actionable and directly address patterns you see.

Return a JSON array of suggestions:
[{"type":"category_override"|"description_template"|"general_instruction","merchant_pattern":"<normalized merchant or null>","rule_text":"<the exact rule text to inject into the AI prompt>","confidence":"high|medium","evidence":"<which data points support this>"}]

Return ONLY the JSON array.`;

  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"x-api-key":apiKey,"anthropic-version":"2023-06-01","Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:"claude-opus-4-6",max_tokens:2000,messages:[{role:"user",content:prompt}]})
    });
    if(!r.ok)throw new Error(`API error ${r.status}`);
    const data=await r.json();
    const txt=data.content?.[0]?.text||"";
    const m=txt.match(/\[[\s\S]*\]/);
    if(!m)throw new Error("No JSON in response");
    const suggestions=JSON.parse(m[0]);
    const tokensUsed=data.usage?.input_tokens+data.usage?.output_tokens||0;

    // Save run
    await sb("ai_synthesis_runs",{method:"POST",body:JSON.stringify({
      feedback_count:feedback.length,override_count:csvOverrides.length,
      suggestions,model_used:"claude-opus-4-6",tokens_used:tokensUsed
    })});

    statusEl.remove();
    // Show results inline for accepting
    await renderSynthesisResults(el,suggestions,tokensUsed);

  }catch(e){
    statusEl.textContent="Error: "+e.message;
  }
}

async function renderSynthesisResults(el,suggestions,tokensUsed){
  const resCard=h("div",{class:"cd",style:{padding:"20px",marginBottom:"20px",borderColor:"rgba(76,205,196,0.3)"}});
  resCard.innerHTML=`<div style="font-weight:600;font-size:14px;margin-bottom:4px;color:var(--b)">Synthesis Complete</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-bottom:16px">${suggestions.length} suggestions · ${tokensUsed.toLocaleString()} tokens</div>`;

  const accepted=[];

  suggestions.forEach((s,i)=>{
    const sRow=h("div",{style:{padding:"12px 0",borderTop:"1px solid rgba(255,255,255,0.06)"}});
    const confColor=s.confidence==="high"?"var(--g)":"var(--y)";
    sRow.innerHTML=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <span style="font-size:11px;color:rgba(255,255,255,0.3);width:120px">${(s.type||"suggestion").replace(/_/g," ")}</span>
      <span style="font-size:11px;color:${confColor}">${s.confidence}</span>
    </div>
    <div style="font-size:12px;font-family:var(--mono);margin-bottom:6px;line-height:1.5">${s.rule_text||s.details||""}</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px">${s.evidence||""}</div>`;
    const acceptBtn=h("button",{class:"pg-btn",style:{fontSize:"11px",padding:"4px 12px"},onClick:async()=>{
      await sb("ai_rules",{method:"POST",body:JSON.stringify({
        rule_type:s.type||"general_instruction",
        merchant_pattern:s.merchant_pattern||null,
        rule_text:s.rule_text||s.details,
        source:"ai_suggested"
      })});
      accepted.push(s);
      acceptBtn.textContent="Accepted!";acceptBtn.disabled=true;acceptBtn.style.color="var(--g)";
      // Update the run record
      const runs=await sb("ai_synthesis_runs?order=created_at.desc&limit=1");
      if(runs[0])await sb(`ai_synthesis_runs?id=eq.${runs[0].id}`,{method:"PATCH",body:JSON.stringify({accepted_suggestions:accepted})});
    }},"Accept → Add Rule");
    sRow.append(acceptBtn);
    resCard.append(sRow);
  });

  el.prepend(resCard);
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function apDecisionTable(cols,rows){
  const wrap=h("div",{class:"cd",style:{padding:"0",overflow:"auto",marginBottom:"16px"}});
  const tbl=h("table",{style:{width:"100%",borderCollapse:"collapse",fontSize:"12px",fontFamily:"var(--mono)"}});
  const thead=h("tr");
  cols.forEach(c=>{
    const th=h("th",{style:{padding:"8px 12px",textAlign:"left",color:"rgba(255,255,255,0.35)",fontWeight:"500",borderBottom:"1px solid rgba(255,255,255,0.1)",whiteSpace:"nowrap",width:c.flex?"auto":(c.width||"auto")}},c.label);
    thead.append(th);
  });
  tbl.append(h("thead",{},thead));
  const tbody=h("tbody");
  rows.forEach(row=>{
    const tr=h("tr",{style:{borderBottom:"1px solid rgba(255,255,255,0.04)"}});
    row.forEach((cell,i)=>{
      const td=h("td",{style:{padding:"8px 12px",maxWidth:cols[i]?.flex?"none":"200px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}});
      if(typeof cell==="string"||typeof cell==="number")td.textContent=cell;
      else td.append(cell);
      tr.append(td);
    });
    tbody.append(tr);
  });
  tbl.append(tbody);
  wrap.append(tbl);
  return wrap;
}

function apConfBadge(conf){
  const color=conf==="high"?"var(--g)":conf==="medium"?"var(--y)":"rgba(255,255,255,0.3)";
  return h("span",{style:{color,fontSize:"11px"}},conf||"—");
}
