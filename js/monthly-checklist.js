const MONTHLY_CHECKLIST_OWNER="shilpa";
const MONTHLY_CHECKLIST_TASKS=[
  {id:"paychecks",label:"Update paychecks"},
  {id:"balances",label:"Update account statement balances"},
  {id:"credit",label:"Update credit card transactions"},
  {id:"debit",label:"Update debit card transactions"}
];

let monthlyChecklistData=null;
let monthlyChecklistExists=false;
let monthlyChecklistRenderToken=0;
let monthlyChecklistCollapsed=false;

function monthlyChecklistMonth(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function monthlyChecklistKey(owner=MONTHLY_CHECKLIST_OWNER){
  return `monthly_checklist:${owner}:${monthlyChecklistMonth()}`;
}

async function withMonthlyChecklistLock(owner,fn){
  if(navigator.locks?.request)return navigator.locks.request(monthlyChecklistKey(owner),fn);
  return fn();
}

function emptyMonthlyChecklist(){
  return{
    month:monthlyChecklistMonth(),
    tasks:{paychecks:false,balances:false,credit:false,debit:false},
    balance_accounts:{},
    updated_at:null
  };
}

function normalizeMonthlyChecklist(value){
  let parsed=value;
  if(typeof parsed==="string"){
    try{parsed=JSON.parse(parsed)}catch(e){parsed={}}
  }
  const fresh=emptyMonthlyChecklist();
  if(!parsed||typeof parsed!=="object")return fresh;
  fresh.tasks={...fresh.tasks,...(parsed.tasks||{})};
  fresh.balance_accounts=parsed.balance_accounts&&typeof parsed.balance_accounts==="object"?parsed.balance_accounts:{};
  fresh.updated_at=parsed.updated_at||null;
  return fresh;
}

async function loadMonthlyChecklist(owner=MONTHLY_CHECKLIST_OWNER){
  const key=monthlyChecklistKey(owner);
  const rows=await sb(`preferences?key=eq.${encodeURIComponent(key)}&owner=eq.${encodeURIComponent(owner)}&select=value&limit=1${householdQS()}`);
  monthlyChecklistExists=!!rows?.length;
  monthlyChecklistData=normalizeMonthlyChecklist(rows?.[0]?.value);
  return monthlyChecklistData;
}

async function saveMonthlyChecklist(owner=MONTHLY_CHECKLIST_OWNER){
  if(!monthlyChecklistData)monthlyChecklistData=emptyMonthlyChecklist();
  monthlyChecklistData.updated_at=new Date().toISOString();
  const key=monthlyChecklistKey(owner);
  const value=JSON.stringify(monthlyChecklistData);
  const qs=`key=eq.${encodeURIComponent(key)}&owner=eq.${encodeURIComponent(owner)}${householdQS()}`;
  if(monthlyChecklistExists){
    await sb(`preferences?${qs}`,{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({value})});
  }else{
    await sb("preferences",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({key,value,owner})});
    monthlyChecklistExists=true;
  }
}

function monthlyChecklistVisible(){
  return currentHousehold!=null&&state.view===MONTHLY_CHECKLIST_OWNER;
}

function hideMonthlyChecklist(){
  monthlyChecklistRenderToken++;
  document.getElementById("monthlyChecklist")?.remove();
  document.querySelector(".monthly-balance-modal")?.remove();
}

function monthlyChecklistProgress(){
  const done=MONTHLY_CHECKLIST_TASKS.filter(t=>monthlyChecklistData?.tasks?.[t.id]).length;
  return{done,total:MONTHLY_CHECKLIST_TASKS.length};
}

async function setMonthlyChecklistTask(taskId,done,{owner=MONTHLY_CHECKLIST_OWNER,automatic=false}={}){
  if(owner!==MONTHLY_CHECKLIST_OWNER||!MONTHLY_CHECKLIST_TASKS.some(t=>t.id===taskId))return;
  let changed=false;
  await withMonthlyChecklistLock(owner,async()=>{
    await loadMonthlyChecklist(owner);
    if(monthlyChecklistData.tasks[taskId]===done)return;
    const previous=JSON.parse(JSON.stringify(monthlyChecklistData));
    if(taskId==="balances"&&!done)monthlyChecklistData.balance_accounts={};
    monthlyChecklistData.tasks[taskId]=done;
    try{
      await saveMonthlyChecklist(owner);
      changed=true;
    }catch(e){
      monthlyChecklistData=previous;
      throw e;
    }
  });
  if(monthlyChecklistVisible()){
    await renderMonthlyChecklist();
    if(automatic&&changed)celebrateMonthlyChecklistTask(taskId);
  }
}

async function completeMonthlyChecklistFromImport(taskId,owner){
  if(owner!==MONTHLY_CHECKLIST_OWNER)return;
  try{
    await setMonthlyChecklistTask(taskId,true,{owner,automatic:true});
  }catch(e){
    console.warn("Monthly checklist update failed:",e);
  }
}

function celebrateMonthlyChecklistTask(taskId){
  const widget=document.getElementById("monthlyChecklist");
  const row=widget?.querySelector(`[data-task="${taskId}"]`);
  if(!widget||!row)return;
  monthlyChecklistCollapsed=false;
  widget.classList.remove("collapsed");
  row.classList.add("just-completed");
  setTimeout(()=>row.classList.remove("just-completed"),2400);
}

async function renderMonthlyChecklist(){
  const token=++monthlyChecklistRenderToken;
  document.getElementById("monthlyChecklist")?.remove();
  if(!monthlyChecklistVisible()){
    document.querySelector(".monthly-balance-modal")?.remove();
    return;
  }
  try{
    await loadMonthlyChecklist();
  }catch(e){
    console.warn("Monthly checklist load failed:",e);
    return;
  }
  if(token!==monthlyChecklistRenderToken||!monthlyChecklistVisible())return;

  const progress=monthlyChecklistProgress();
  monthlyChecklistCollapsed=progress.done===progress.total;
  const widget=h("aside",{id:"monthlyChecklist",class:"monthly-checklist"+(monthlyChecklistCollapsed?" collapsed":"")});
  const header=h("button",{class:"monthly-checklist-head",type:"button",onClick:()=>{
    monthlyChecklistCollapsed=!monthlyChecklistCollapsed;
    widget.classList.toggle("collapsed",monthlyChecklistCollapsed);
    toggle.textContent=monthlyChecklistCollapsed?"▴":"▾";
  }});
  const titleWrap=h("span",{class:"monthly-checklist-title"});
  titleWrap.append(
    h("span",{},"Monthly checklist"),
    h("span",{class:"monthly-checklist-progress"},`${progress.done}/${progress.total}`)
  );
  const toggle=h("span",{class:"monthly-checklist-toggle"},monthlyChecklistCollapsed?"▴":"▾");
  header.append(titleWrap,toggle);

  const body=h("div",{class:"monthly-checklist-body"});
  MONTHLY_CHECKLIST_TASKS.forEach(task=>{
    const row=h("div",{class:"monthly-checklist-row","data-task":task.id});
    const label=h("label",{class:"monthly-checklist-label"});
    const cb=h("input",{type:"checkbox",class:"monthly-checklist-checkbox"});
    cb.checked=!!monthlyChecklistData.tasks[task.id];
    cb.disabled=!canWriteOwner(MONTHLY_CHECKLIST_OWNER);
    cb.addEventListener("change",async()=>{
      cb.disabled=true;
      try{await setMonthlyChecklistTask(task.id,cb.checked)}
      catch(e){cb.checked=!cb.checked;alert("Could not save checklist: "+e.message);cb.disabled=false}
    });
    label.append(cb,h("span",{},task.label));
    row.append(label);
    if(task.id==="balances"&&!monthlyChecklistData.tasks.balances){
      const accountCount=Object.keys(monthlyChecklistData.balance_accounts||{}).length;
      const btn=h("button",{class:"monthly-checklist-action",type:"button",onClick:()=>openMonthlyBalanceWizard()},accountCount?"Continue":"Update");
      btn.disabled=!canWriteOwner(MONTHLY_CHECKLIST_OWNER);
      row.append(btn);
    }
    body.append(row);
  });
  widget.append(header,body);
  document.body.append(widget);
}

function monthlyBalanceTarget(account,inputValue){
  const liabilityTypes=new Set(["credit","liability","working_capital"]);
  return liabilityTypes.has(account.account_type)?-Math.abs(inputValue):inputValue;
}

async function saveMonthlyAccountBalanceUnlocked(account,entered,currentBalance){
  const target=Math.round(monthlyBalanceTarget(account,entered)*100)/100;
  const date=today();
  const batchId=`monthly-balance:${MONTHLY_CHECKLIST_OWNER}:${monthlyChecklistMonth()}:${account.id}`;
  const fresh=await sbRPC("get_ledger_balances_scoped",{p_owner:MONTHLY_CHECKLIST_OWNER,p_household_id:currentHousehold});
  const row=(fresh||[]).find(b=>b.payment_type===account.label);
  currentBalance=row?parseFloat(row.net_balance)||0:0;
  const delta=Math.round((currentBalance-target)*100)/100;
  await sb("balance_snapshots",{
    method:"POST",
    headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify({
      account_id:account.id,snapshot_date:date,balance:target,balance_usd:target,
      owner:MONTHLY_CHECKLIST_OWNER,household_id:currentHousehold
    })
  });
  if(Math.abs(delta)>=0.01){
    await sb("transactions",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
      date,service_start:date,service_end:date,service_days:1,
      description:`Balance Adjustment - ${account.label}`,category_id:"adjustment",
      amount_usd:delta,original_amount:delta,currency:"USD",fx_rate:1,
      daily_cost:delta,payment_type:account.label,tag:"",credit:"",import_batch:batchId,
      owner:MONTHLY_CHECKLIST_OWNER,household_id:currentHousehold
    })});
    state.txnCount++;
    const ds=document.getElementById("dbStatus");
    if(ds)ds.textContent=`\u25CF ${state.txnCount.toLocaleString()} txns`;
  }
  dcClearAll();
  return{target,adjusted:Math.abs(delta)>=0.01};
}

async function saveMonthlyAccountBalance(account,entered,currentBalance){
  const lockName=`${monthlyChecklistKey()}:balance:${account.id}`;
  if(navigator.locks?.request)return navigator.locks.request(lockName,()=>saveMonthlyAccountBalanceUnlocked(account,entered,currentBalance));
  return saveMonthlyAccountBalanceUnlocked(account,entered,currentBalance);
}

async function openMonthlyBalanceWizard(){
  if(!canWriteOwner(MONTHLY_CHECKLIST_OWNER))return;
  const old=document.querySelector(".monthly-balance-modal");
  if(old)old.remove();
  const bg=h("div",{class:"modal-bg monthly-balance-modal"});
  const modal=h("div",{class:"modal",style:{maxWidth:"500px"}});
  bg.append(modal);
  document.body.append(bg);
  modal.innerHTML="<h2>Account balance check</h2><p class=\"sub\" style=\"margin-top:6px\">Loading Shilpa's accounts...</p>";
  try{
    if(!monthlyChecklistData||monthlyChecklistData.month!==monthlyChecklistMonth())await loadMonthlyChecklist();
    const [accounts,bals]=await Promise.all([
      sb(`accounts?is_active=eq.true&order=display_order&owner=eq.${MONTHLY_CHECKLIST_OWNER}${householdQS()}`),
      sbRPC("get_ledger_balances_scoped",{p_owner:MONTHLY_CHECKLIST_OWNER,p_household_id:currentHousehold})
    ]);
    const balanceByLabel={};
    (bals||[]).forEach(b=>{balanceByLabel[b.payment_type]=parseFloat(b.net_balance)||0});
    let activeIndex=0;

    function pendingAccounts(){
      return(accounts||[]).filter(a=>!monthlyChecklistData.balance_accounts?.[String(a.id)]);
    }

    async function finishIfDone(){
      if(pendingAccounts().length)return false;
      let finished=false;
      await withMonthlyChecklistLock(MONTHLY_CHECKLIST_OWNER,async()=>{
        await loadMonthlyChecklist();
        if(pendingAccounts().length)return;
        monthlyChecklistData.tasks.balances=true;
        await saveMonthlyChecklist();
        finished=true;
      });
      if(!finished)return false;
      bg.remove();
      if(state.tab==="balance")renderContent();
      await renderMonthlyChecklist();
      celebrateMonthlyChecklistTask("balances");
      return true;
    }

    async function recordAccount(account,status,details={}){
      await withMonthlyChecklistLock(MONTHLY_CHECKLIST_OWNER,async()=>{
        await loadMonthlyChecklist();
        monthlyChecklistData.balance_accounts[String(account.id)]={
          status,label:account.label,completed_at:new Date().toISOString(),...details
        };
        await saveMonthlyChecklist();
      });
      activeIndex=0;
      if(!await finishIfDone())renderStep();
    }

    function renderStep(){
      const pending=pendingAccounts();
      if(!pending.length){finishIfDone();return}
      if(activeIndex>=pending.length)activeIndex=0;
      const account=pending[activeIndex];
      let current=balanceByLabel[account.label]||0;
      const handled=(accounts||[]).length-pending.length;
      modal.innerHTML="";

      const top=h("div",{style:{display:"flex",justifyContent:"space-between",gap:"16px",marginBottom:"18px"}});
      const heading=h("div");
      heading.append(h("h2",{},"Account balance check"),h("p",{class:"sub",style:{marginTop:"4px"}},`${handled+1} of ${accounts.length} · ${account.label}`));
      const close=h("button",{class:"pg-btn",type:"button",onClick:()=>bg.remove()},"Close");
      top.append(heading,close);

      const currentRow=h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.55)",marginBottom:"14px"}},`Current ledger balance: ${fmtF(current)}`);
      const input=h("input",{class:"inp",type:"number",step:"0.01",value:Math.abs(current).toFixed(2),style:{fontFamily:"var(--mono)"}});
      const liability=["credit","liability","working_capital"].includes(account.account_type);
      const help=h("div",{style:{fontSize:"11px",color:"rgba(255,255,255,0.35)",marginTop:"7px",lineHeight:"1.5"}},
        liability?"Enter the positive amount currently owed. Disciplan records the liability as a negative balance.":"Enter the balance shown on the latest statement."
      );
      const status=h("div",{style:{fontSize:"11px",color:"var(--r)",minHeight:"18px",marginTop:"8px"}});
      const actions=h("div",{style:{display:"flex",gap:"10px",marginTop:"16px"}});
      const skip=h("button",{class:"btn",type:"button",style:{background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.55)"},onClick:async()=>{
        skip.disabled=true;update.disabled=true;
        try{await recordAccount(account,"skipped")}
        catch(e){status.textContent="Could not save: "+e.message;skip.disabled=false;update.disabled=false}
      }},"Skip");
      const update=h("button",{class:"btn",type:"button",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
        const entered=parseFloat(input.value);
        if(isNaN(entered)){status.textContent="Enter a balance or choose Skip.";return}
        skip.disabled=true;update.disabled=true;update.textContent="Saving...";
        try{
          const saved=await saveMonthlyAccountBalance(account,entered,current);
          current=saved.target;
          balanceByLabel[account.label]=saved.target;
          await recordAccount(account,"updated",{balance:saved.target,adjusted:saved.adjusted});
        }catch(e){
          status.textContent="Could not update balance: "+e.message;
          skip.disabled=false;update.disabled=false;update.textContent="Update";
        }
      }},"Update");
      actions.append(skip,update);
      modal.append(top,currentRow,h("label",{class:"lbl"},"Statement balance"),input,help,status,actions);
      setTimeout(()=>{input.focus();input.select()},0);
    }

    if(!accounts?.length){
      modal.innerHTML="";
      modal.append(
        h("h2",{},"Account balance check"),
        h("p",{class:"sub",style:{marginTop:"8px",marginBottom:"18px"}},"No active accounts found for Shilpa."),
        h("button",{class:"pg-btn",onClick:()=>bg.remove()},"Close")
      );
      return;
    }
    if(await finishIfDone())return;
    renderStep();
  }catch(e){
    modal.innerHTML="";
    modal.append(
      h("h2",{},"Account balance check"),
      h("p",{style:{fontSize:"12px",color:"var(--r)",margin:"10px 0 18px"}},"Could not load accounts: "+e.message),
      h("button",{class:"pg-btn",onClick:()=>bg.remove()},"Close")
    );
  }
}
