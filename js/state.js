let state={tab:"income",year:2026,txnCount:0,page:0,pendingEmails:0,expandedGroups:new Set()};


// Ensure a tag exists in the tags table; prompt user to create if new
async function ensureTagExists(tagName){
  if(!tagName)return;
  const existing=await sb("tags?select=name");
  if(existing.some(t=>t.name.toLowerCase()===tagName.toLowerCase()))return;
  return new Promise(resolve=>{
    const bg=h("div",{class:"modal-bg",onClick:e=>{if(e.target===bg){bg.remove();resolve()}}});
    const modal=h("div",{class:"modal"});
    const hdr=h("div",{style:{marginBottom:"20px"}});
    hdr.append(h("h3",{style:{margin:"0"}},"New Tag Detected"));
    hdr.append(h("div",{style:{fontSize:"12px",color:"rgba(255,255,255,0.5)",marginTop:"6px"}},`"${tagName}" doesn't exist in the tags table yet.`));
    modal.append(hdr);
    const tStart=h("input",{class:"inp",type:"date"});
    const tEnd=h("input",{class:"inp",type:"date"});
    const tType=h("select",{class:"inp"});
    ["trip","event","recurring"].forEach(v=>tType.append(h("option",{value:v},v)));
    function mF(lbl,inp){const d=h("div");d.append(h("label",{class:"lbl"},lbl));d.append(inp);return d}
    function mR(...ch){const d=h("div",{style:{display:"grid",gridTemplateColumns:ch.length===2?"1fr 1fr":"1fr",gap:"12px",marginBottom:"14px"}});ch.forEach(x=>d.append(x));return d}
    modal.append(mR(mF("Start Date",tStart),mF("End Date",tEnd)));
    modal.append(mR(mF("Tag Type",tType)));
    const errEl=h("div",{style:{color:"var(--r)",fontSize:"11px",marginBottom:"8px",minHeight:"16px"}});
    modal.append(errEl);
    const btnRow=h("div",{style:{display:"grid",gridTemplateColumns:"1fr auto",gap:"8px"}});
    const createBtn=h("button",{class:"btn",style:{background:"rgba(129,178,154,0.2)",color:"var(--g)"},onClick:async()=>{
      if(!tStart.value||!tEnd.value){errEl.textContent="Start and end dates are required.";return}
      if(tEnd.value<tStart.value){errEl.textContent="End date must be after start date.";return}
      createBtn.textContent="Creating...";createBtn.disabled=true;
      try{
        await sb("tags",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({name:tagName,start_date:tStart.value,end_date:tEnd.value,tag_type:tType.value})});
        bg.remove();resolve();
      }catch(e){errEl.textContent="Failed: "+e.message;createBtn.textContent="Create Tag";createBtn.disabled=false}
    }},"Create Tag");
    const skipBtn=h("button",{class:"btn",style:{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.4)",width:"auto",padding:"12px 20px"},onClick:()=>{bg.remove();resolve()}},"Skip");
    btnRow.append(createBtn,skipBtn);
    modal.append(btnRow);
    bg.append(modal);
    document.body.append(bg);
  });
}
