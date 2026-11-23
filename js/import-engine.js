function transformCSVRow(row,profile,paymentType,bulkTag,index){
  const cols=profile.columns;
  const rawDate=row[cols.date]||"";
  const dp=rawDate.split("/");
  const date=dp.length===3?`${dp[2]}-${dp[0].padStart(2,"0")}-${dp[1].padStart(2,"0")}`:rawDate;
  const badDate=!date||!/^\d{4}-\d{2}-\d{2}$/.test(date);
  const rawAmt=parseFloat(row[cols.amount])||0;
  const typeVal=cols.type!=="_none_"?(row[cols.type]||""):"";
  const isReturn=typeVal.toLowerCase()==="return";
  const isCCPay=typeVal==="Payment"||(profile.detectPayment&&profile.detectPayment(row));
  const isSkip=badDate||(typeVal&&profile.skipTypes.includes(typeVal));
  let amt=profile.transformAmount(rawAmt);
  if(isReturn)amt=-Math.abs(amt);
  const baseFields={date,description:row[cols.description]||"",amount_usd:amt,currency:profile.currency||"USD",fx_rate:1,original_amount:amt,service_start:date,service_end:date,payment_type:paymentType,tag:bulkTag||"",credit:"",_rawDescription:row[cols.description]||"",_bankCategory:row[cols.bankCategory]||"",_rowIndex:index};
  if(profile.isCheckingAccount&&!badDate){
    if(profile.classifyRow){
      // Profile-driven classification (Wells Fargo, Chase checking). Inflows use
      // NEGATIVE amount_usd (income/credit) and outflows POSITIVE (debit), matching
      // balance = -sum(amount_usd).
      const cl=profile.classifyRow(row,rawAmt);
      if(cl){
        if(cl._desc)baseFields.description=cl._desc;
        if(cl._skip)return{...baseFields,amount_usd:amt,category_id:"financial",ai_confidence:"high",service_days:1,daily_cost:amt,_status:"skipped",_isDuplicate:false,_skipReason:cl._skip,_isBillPay:true};
        if(cl._payrollSkip){const inc=Math.round(-Math.abs(rawAmt)*100)/100;return{...baseFields,amount_usd:inc,category_id:"income",ai_confidence:"high",service_days:1,daily_cost:inc,_status:"skipped",_isDuplicate:false,_skipReason:"Payroll (payslip imported)",_isPayroll:true,_payrollAmount:Math.abs(rawAmt)};}
        if(cl._transfer){const impAmt=Math.round(-rawAmt*100)/100;return{...baseFields,amount_usd:impAmt,category_id:"financial",ai_confidence:"high",service_days:1,daily_cost:impAmt,_status:"pending",_isDuplicate:false,_skipReason:null,_isTransfer:true,_transferTo:cl._transferTo||"",_transferRaw:rawAmt};}
        if(cl._income){const inc=Math.round(-Math.abs(rawAmt)*100)/100;return{...baseFields,amount_usd:inc,category_id:"income",ai_confidence:"medium",service_days:1,daily_cost:inc,_status:"pending",_isDuplicate:false,_skipReason:null,_isCredit:true};}
        if(cl._zelle){const za=Math.round(-rawAmt*100)/100;return{...baseFields,amount_usd:za,category_id:"other",ai_confidence:"low",service_days:1,daily_cost:za,_status:"pending",_isDuplicate:false,_skipReason:null};}
      }
      // null → fall through to the default AI-categorized expense path below
    }else{
      const billName=profile.detectBillPay&&profile.detectBillPay(row);
      if(billName)return{...baseFields,amount_usd:amt,category_id:"financial",ai_confidence:"high",service_days:1,daily_cost:amt,_status:"skipped",_isDuplicate:false,_skipReason:"Bill Payment: "+billName,_isBillPay:true};
      if(profile.detectPayroll&&profile.detectPayroll(row))return{...baseFields,amount_usd:amt,category_id:"income",ai_confidence:"high",service_days:1,daily_cost:amt,_status:"skipped",_isDuplicate:false,_skipReason:"Payroll (payslip imported)",_isPayroll:true,_payrollAmount:amt};
      if(rawAmt>0)return{...baseFields,amount_usd:amt,category_id:"income",ai_confidence:"medium",service_days:1,daily_cost:amt,_status:"pending",_isDuplicate:false,_skipReason:null,_isCredit:true};
    }
  }
  // Bilt rent charge (positive "Bilt Housing Payment") -> Rent, accrued across the
  // whole month. The card payoff ("Payment - Bilt Housing", negative) is a distinct
  // row that still flows through the CC-payment path below and is auto-grouped with
  // this rent charge at commit. The only reliable charge-vs-payoff signal is sign.
  if(!badDate&&profile.detectRent&&profile.detectRent(row)){
    const rss=startOfMonth(date),rse=endOfMonth(rss);
    const rsd=daysInclusive(rss,rse);
    return{...baseFields,description:`Rent - ${monthLabel(date)}`,amount_usd:amt,category_id:"rent",ai_confidence:"high",service_start:rss,service_end:rse,service_days:rsd,daily_cost:Math.round(amt/rsd*1e6)/1e6,_status:"pending",_isDuplicate:false,_skipReason:null,_isRent:true};
  }
  if(isCCPay){
    const names=CC_PAY_NAMES[paymentType]||["Bill Paid: "+paymentType,paymentType+" Bill Payment"];
    return{
      date,description:names[0],amount_usd:amt,category_id:"financial",ai_confidence:"high",
      currency:profile.currency||"USD",fx_rate:1,original_amount:amt,
      service_start:date,service_end:date,service_days:1,daily_cost:amt,
      payment_type:paymentType,tag:bulkTag||"",credit:"",
      _status:"approved",_isDuplicate:false,_isCCPayment:true,
      _rawDescription:row[cols.description]||"",_bankCategory:row[cols.bankCategory]||"",
      _rowIndex:index,_skipReason:null,
      _ccPaymentPair:{description:names[1],payment_type:"",amount:Math.abs(amt)}
    };
  }
  return{
    date,description:row[cols.description]||"",amount_usd:amt,category_id:null,ai_confidence:null,
    currency:profile.currency||"USD",fx_rate:1,original_amount:amt,
    service_start:date,service_end:date,payment_type:paymentType,tag:bulkTag||"",credit:"",
    _status:isSkip?"skipped":"pending",_isDuplicate:false,
    _rawDescription:row[cols.description]||"",_bankCategory:row[cols.bankCategory]||"",
    _rowIndex:index,_skipReason:badDate?"Invalid date":isSkip?"CC Payment":null
  };
}

// A detected profile whose date/amount columns mostly don't parse (e.g. the bank
// kept its headers but changed the date format) is treated as unrecognized.
function csvMostlyUnreadable(csv,profile){
  const c=profile.columns;
  const ok=csv.rows.filter(r=>/^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test((r[c.date]||"").trim())&&!isNaN(parseFloat(r[c.amount]))).length;
  return ok<csv.rows.length/2;
}

const CSV_AI_PROMPT=`You identify the column layout of a bank or credit card CSV export so it can be imported. You get the file name, its first lines, the known layouts, and the user's account names.

Return ONLY a JSON object:
{"has_header":true,"base_profile":"generic","account_kind":"credit_card","columns":{"date":"","description":"","amount":"","debit":null,"credit":null,"type":null,"category":null},"date_format":"MDY","charges_are":"positive","currency":"USD","institution":"","account":null}

Rules:
- columns values are header names exactly as written in the first line, or null. If has_header is false, refer to columns by position as col1, col2, ...
- date: the transaction date (prefer it over a posted date).
- amount: a single signed amount column. If the file has separate debit/withdrawal and credit/deposit columns instead, set amount to null and fill debit and credit.
- charges_are: the sign of purchases / withdrawals in the amount column, "positive" or "negative". Decide from the rows: refunds, card payments and deposits have the opposite sign.
- account_kind: "credit_card" or "checking" (checking also covers savings).
- base_profile: a known layout key only when the file is clearly the same institution and account kind with renamed or reordered columns; otherwise "generic".
- date_format: MDY, DMY or YMD as used in the date column.
- account: the best match from the user's account names, or null if none clearly fits.`;

function csvNum(s){
  let t=String(s??"").trim();
  if(!t)return NaN;
  const neg=/^\(.*\)$/.test(t)||/^-/.test(t.replace(/[$\s]/g,""))||/-$/.test(t);
  const v=parseFloat(t.replace(/[^0-9.]/g,""));
  return isNaN(v)?NaN:neg?-v:v;
}
function csvDateISO(s,fmt){
  const t=String(s||"").trim();
  const m=t.match(/^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})/);
  if(m){
    let[y,mo,d]=fmt==="YMD"?[m[1],m[2],m[3]]:fmt==="DMY"?[m[3],m[2],m[1]]:[m[3],m[1],m[2]];
    if(y.length===2)y="20"+y;
    if(+mo>=1&&+mo<=12&&+d>=1&&+d<=31)return`${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`;
    return"";
  }
  const dt=new Date(t);
  return t&&!isNaN(dt)?`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`:"";
}

// Claude maps an unrecognized CSV's columns; rows are then rewritten into a known
// profile's column names and sign convention (so its classifyRow / payment rules
// still apply) or into a generic profile. Claude never sees or decides amounts.
async function aiMapCSV(text,fileName,accountNames){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length)throw new Error("No data rows found in CSV.");
  const known=Object.entries(BANK_PROFILES).map(([k,p])=>`${k} (${p.isCheckingAccount?"checking":"credit_card"}): ${Object.values(p.columns).filter(c=>c!=="_none_").join(", ")}`).join("\n");
  const{json:f,usage}=await callClaudeJSON({model:getAIModel(),max_tokens:600,system:CSV_AI_PROMPT,messages:[{role:"user",content:
    `File name: ${fileName}\n\nKnown layouts:\n${known}\n\nUser's account names: ${accountNames.join(", ")}\n\nFirst lines:\n${lines.slice(0,12).join("\n")}`}]});
  if(f.currency&&f.currency!=="USD")throw new Error(`Claude says this CSV is in ${f.currency}; only USD imports are supported.`);

  let csv=parseCSV(text);
  if(!f.has_header){
    const n=csv.headers.length;
    csv=parseCSV(Array.from({length:n},(_,i)=>"col"+(i+1)).join(",")+"\n"+text);
  }
  const col=f.columns||{};
  const has=k=>col[k]&&csv.headers.includes(col[k]);
  if(!has("date")||!has("description")||!(has("amount")||has("debit")||has("credit")))
    throw new Error("Claude could not map this CSV's date, description and amount columns.");

  const base=BANK_PROFILES[f.base_profile];
  const checking=base?!!base.isCheckingAccount:f.account_kind==="checking";
  const profile=base?{name:f.base_profile,...base}:{name:"ai_generic",
    columns:{date:"Date",description:"Description",amount:"Amount",bankCategory:has("category")?"Category":"_none_",type:"_none_"},
    transformAmount:checking?a=>Math.abs(a):a=>a,skipTypes:[],currency:"USD",isCheckingAccount:checking,
    ...(checking?{classifyRow:(row,rawAmt)=>{
      const d=(row.Description||"").toUpperCase();
      if(/ATM WITHDRAW/.test(d)&&!/FEE/.test(d))return{_transfer:true,_transferTo:"Cash",_desc:"ATM Withdrawal"};
      return rawAmt>0?{_income:true}:null;
    }}
      :{detectPayment:row=>parseFloat(row.Amount)<0&&/payment|autopay/i.test(row.Description||"")})};
  delete profile.reparse;
  // Raw sign of a charge in the target profile: checking rows are outflow-negative;
  // card profiles store charges positive, so transformAmount(1)>0 means charges are raw-positive.
  const chargeSign=checking?-1:profile.transformAmount(1)>0?1:-1;
  const pc=profile.columns;
  const rows=[];
  for(const r of csv.rows){
    let v;
    if(has("amount"))v=csvNum(r[col.amount])*(f.charges_are==="positive"?-1:1);
    else v=Math.abs(csvNum(r[col.credit])||0)-Math.abs(csvNum(r[col.debit])||0);
    const date=csvDateISO(r[col.date],f.date_format);
    if(isNaN(v)&&!date)continue;
    const out={...r,[pc.date]:date,[pc.description]:r[col.description]||"",[pc.amount]:String(isNaN(v)?0:Math.round(v*chargeSign*-100)/100)};
    if(pc.type!=="_none_")out[pc.type]=has("type")?r[col.type]:"";
    if(pc.bankCategory!=="_none_")out[pc.bankCategory]=has("category")?r[col.category]:"";
    rows.push(out);
  }
  if(!rows.length)throw new Error("No data rows found in CSV.");
  const readable=rows.filter(r=>r[pc.date]).length;
  if(readable<rows.length*0.8)throw new Error("Claude's column mapping left most dates unreadable; this CSV needs a dedicated profile.");

  const label=base?`${f.base_profile} layout`:`${f.institution||"generic"} ${checking?"checking":"card"}`;
  const signNote=has("amount")?`charges ${f.charges_are}`:"separate debit/credit columns";
  return{csv:{headers:csv.headers,rows},profile,account:f.account||"",
    note:`Unrecognized format \u2014 Claude mapped it as ${label} (date: ${col.date}, amount: ${has("amount")?col.amount:col.debit+"/"+col.credit}, ${signNote}, ${claudeTokens(usage).toLocaleString()} tokens). Check amounts and signs before approving.`};
}

async function findDuplicates(candidates,paymentType){
  const dates=candidates.filter(c=>c._status!=="skipped").map(c=>c.date).sort();
  if(!dates.length)return;
  const minD=dates[0],maxD=dates[dates.length-1];
  const existing=await sb(`transactions?payment_type=eq.${encodeURIComponent(paymentType)}&date=gte.${minD}&date=lte.${maxD}&select=date,amount_usd,description,service_start,service_end`);
  for(const c of candidates){
    if(c._status==="skipped")continue;
    c._isDuplicate=existing.some(e=>e.date===c.date&&Math.abs(Math.abs(e.amount_usd)-Math.abs(c.amount_usd))<0.02
      &&(!c.service_start||!e.service_start||c.service_start===e.service_start)
      &&(!c.service_end||!e.service_end||c.service_end===e.service_end));
    if(c._isDuplicate){c._status="skipped";c._skipReason="Duplicate"}
  }
}

// Payslip rows used to be dated by import day, so a re-imported stub is matched on
// account, description, pay period and amount rather than the posting date.
async function findPayslipDuplicates(candidates){
  const live=candidates.filter(c=>c._status!=="skipped");
  if(!live.length)return;
  const starts=live.map(c=>c.service_start).sort();
  const pts=[...new Set(live.map(c=>c.payment_type))];
  const existing=await sb(`transactions?payment_type=in.(${pts.map(p=>encodeURIComponent(`"${p}"`)).join(",")})&service_start=gte.${starts[0]}&service_start=lte.${starts[starts.length-1]}&select=description,amount_usd,payment_type,service_start,service_end${writeOwnerQS()}`);
  for(const c of live){
    c._isDuplicate=existing.some(e=>e.payment_type===c.payment_type&&e.description===c.description
      &&e.service_start===c.service_start&&e.service_end===c.service_end&&Math.abs(e.amount_usd-c.amount_usd)<0.02);
    if(c._isDuplicate){c._status="skipped";c._skipReason="Duplicate"}
  }
}

// Flags transfer rows whose paired leg is already in the ledger (e.g. the other
// side of an internal Wells Fargo Checking<->Savings move imported earlier, or a
// withdrawal already logged on the counter-account). The counter-leg posts
// +_transferRaw on _transferTo; match on |amount| within +/-2 days.
async function findTransferPairs(candidates){
  const xfers=candidates.filter(c=>c._isTransfer&&c._status==="pending"&&c._transferTo);
  if(!xfers.length)return;
  const toD=s=>new Date(s+"T00:00:00");
  const shift=(s,n)=>{const d=toD(s);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
  const dayDiff=(a,b)=>Math.abs((toD(a)-toD(b))/864e5);
  const byAcct={};
  for(const c of xfers){(byAcct[c._transferTo]||(byAcct[c._transferTo]=[])).push(c)}
  for(const[acct,group] of Object.entries(byAcct)){
    const dates=group.map(c=>c.date).sort();
    const minD=shift(dates[0],-3),maxD=shift(dates[dates.length-1],3);
    let existing=[];
    try{existing=await sb(`transactions?payment_type=eq.${encodeURIComponent(acct)}&date=gte.${minD}&date=lte.${maxD}&select=date,amount_usd${ownerQS()}`)}catch(e){continue}
    for(const c of group){
      const hit=existing.find(e=>Math.abs(Math.abs(e.amount_usd)-Math.abs(c._transferRaw))<0.02&&dayDiff(e.date,c.date)<=2);
      if(hit){c._isDuplicate=true;c._status="skipped";c._skipReason="Transfer already paired ("+acct+")"}
    }
  }
}

// A Zelle between household members is one movement seen from both ledgers.
// Each imported Zelle naming another member is matched to that member's
// opposite-signed Zelle (same amount, within 4 days) and joins its linked group.
// If the group already holds a share addressed to the importer (approved, or
// pending in the shared-transactions inbox), that share is the Splitwise leg:
// the import posts only the cash leg and approves a pending share at commit.
// Otherwise the row is a transfer against Splitwise when the other side used
// Splitwise, or waits for an account pick.
async function findHouseholdZelleMatches(candidates){
  if(currentHousehold==null||!householdMembers||householdMembers.length<2)return;
  const me=typeof writeOwner==="function"?writeOwner():currentOwner;
  const others=householdMembers.filter(m=>m.owner!==me);
  if(me==null||!others.length)return;
  const zelles=candidates.filter(c=>c._status==="pending"&&!c._isDuplicate&&c.amount_usd&&/zelle/i.test(c._rawDescription||""));
  if(!zelles.length)return;
  const toD=s=>new Date(s+"T00:00:00");
  const shift=(s,n)=>{const d=toD(s);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
  const dayDiff=(a,b)=>Math.abs((toD(a)-toD(b))/864e5);
  const names=c=>((c._rawDescription||"")+" "+(c.description||"")).toLowerCase();
  const memberNamed=(c,owner)=>{
    const m=others.find(x=>x.owner===owner);if(!m)return false;
    const first=(m.display_name||"").split(/\s+/)[0].toLowerCase();
    const t=names(c);
    return (first&&t.includes(first))||t.includes(m.owner.toLowerCase());
  };
  const dates=zelles.map(c=>c.date).sort();
  let theirs=[];
  try{
    theirs=await sb(`transactions?household_id=eq.${currentHousehold}&owner=in.(${others.map(m=>encodeURIComponent(m.owner)).join(",")})&date=gte.${shift(dates[0],-4)}&date=lte.${shift(dates[dates.length-1],4)}&payment_type=neq.Splitwise&or=(description.ilike.*zelle*,bank_description.ilike.*zelle*)&select=id,owner,date,description,amount_usd,payment_type,transaction_group_id`);
  }catch(e){return}
  const used=new Set(),matches=[];
  for(const c of zelles){
    const hits=theirs.filter(t=>!used.has(t.id)&&Math.abs(parseFloat(t.amount_usd)+c.amount_usd)<0.02&&dayDiff(t.date,c.date)<=4&&memberNamed(c,t.owner));
    if(!hits.length)continue;
    hits.sort((a,b)=>dayDiff(a.date,c.date)-dayDiff(b.date,c.date));
    used.add(hits[0].id);matches.push({c,hit:hits[0]});
  }
  if(!matches.length)return;
  const gids=[...new Set(matches.map(x=>x.hit.transaction_group_id).filter(Boolean))];
  let members=[],pending=[];
  if(gids.length){try{members=await sb(`transactions?transaction_group_id=in.(${gids.join(",")})&select=id,owner,payment_type,amount_usd,transaction_group_id`)}catch(e){}}
  const srcIds=[...new Set([...members.map(r=>r.id),...matches.map(x=>x.hit.id)])];
  try{pending=await sb(`pending_shared_txns?to_owner=eq.${encodeURIComponent(me)}&status=eq.pending&source_txn_id=in.(${srcIds.join(",")})`)}catch(e){}
  for(const{c,hit}of matches){
    const g=hit.transaction_group_id;
    const group=g?members.filter(r=>r.transaction_group_id===g):[];
    const who=(others.find(m=>m.owner===hit.owner)||{}).display_name||hit.owner;
    if(group.some(r=>r.owner===me&&r.payment_type===c.payment_type&&Math.abs(Math.abs(parseFloat(r.amount_usd))-Math.abs(c.amount_usd))<0.02)){
      c._isDuplicate=true;c._status="skipped";c._skipReason=`Zelle already linked to ${who}'s side`;continue;
    }
    const ids=new Set([hit.id,...group.map(r=>r.id)]);
    const share=group.find(r=>r.owner===me&&r.payment_type==="Splitwise");
    const pend=pending.find(p=>ids.has(p.source_txn_id));
    c.category_id="financial";c.ai_confidence="high";
    c.service_start=c.service_end=c.date;c.service_days=1;c.daily_cost=c.amount_usd;
    c._linkToTransactionId=hit.id;c._linkToGroupId=g||null;
    c._linkDisplay={description:hit.description,date:hit.date,amount_usd:parseFloat(hit.amount_usd),category_id:"financial",payment_type:hit.payment_type};
    c._hhZelle={who,date:hit.date,share:!!(share||pend)};
    if(share||pend){
      c._isTransfer=false;delete c._transferTo;
      if(pend)c._hhSharedTxn=pend;
    }else{
      c._isTransfer=true;c._transferRaw=-c.amount_usd;
      if(group.some(r=>r.owner!==me&&r.payment_type==="Splitwise"))c._transferTo="Splitwise";
      else if(!c._transferTo)c._transferTo="";
    }
  }
}

// Checking-account CC bill pays are skipped (the card import owns them). If a
// matching "Bill Paid: <card>" (or checking-side "… Bill Payment") is not in the
// ledger yet, flag the skipped row so the reviewer knows to import the card.
async function findCCImportMatches(candidates){
  const pays=candidates.filter(c=>c._isBillPay);
  if(!pays.length)return;
  const toD=s=>new Date(s+"T00:00:00");
  const shift=(s,n)=>{const d=toD(s);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
  const dayDiff=(a,b)=>Math.abs((toD(a)-toD(b))/864e5);
  const dates=pays.map(c=>c.date).filter(Boolean).sort();
  if(!dates.length)return;
  const minD=shift(dates[0],-3),maxD=shift(dates[dates.length-1],3);
  const cards=new Set(Object.keys(CC_PAY_NAMES||{}));
  let existing=[];
  try{existing=await sb(`transactions?category_id=eq.financial&date=gte.${minD}&date=lte.${maxD}&select=date,amount_usd,description,payment_type${ownerQS()}`)}catch(e){existing=[]}
  const isPair=e=>cards.has(e.payment_type)||/^Bill Paid:/i.test(e.description||"")||/Bill Payment$/i.test(e.description||"");
  for(const c of pays){
    const amt=Math.abs(parseFloat(c.amount_usd)||0);
    const hit=existing.find(e=>isPair(e)&&Math.abs(Math.abs(e.amount_usd)-amt)<0.02&&dayDiff(e.date,c.date)<=3);
    if(hit){
      c._ccMissing=false;
      c._ccMatchedPt=hit.payment_type||"";
      c._skipReason="CC payment (logged via card import)";
    }else{
      c._ccMissing=true;
      c._skipReason="CC payment not yet on a card import \u2014 skipped here";
    }
  }
}

function fallbackCatMap(bankCat){return AMEX_CAT_MAP[bankCat]||CHASE_CAT_MAP[bankCat]||"other"}

// Where cash is going for a bank row that is money moving, not a purchase.
// "Cash" for an ATM withdrawal. Null when the row is not that kind of movement.
function flowDestination(text,amount){
  const d=(text||"").toUpperCase();
  if(/PAYPAL/.test(d)&&!/PURCHASE/.test(d)&&(/RAKUTEN/.test(d)||(/TRANSFER|INST XFER/.test(d)&&(parseFloat(amount)||0)<0)))return "Rakuten";
  if(!d||/FEE|INTEREST/.test(d))return null;
  if(/ATM/.test(d)&&/WITHDRAW|CASH/.test(d))return "Cash";
  if(/CASH\s*(WITHDRAW|ADVANCE)/.test(d))return "Cash";
  return null;
}

// Catch ATM cash that a profile or the categorizer filed as an ordinary expense,
// so the review offers an output account (Cash) instead of only a category.
function promoteMoneyFlows(candidates){
  for(const c of candidates){
    if(c._status==="skipped"||c._isTransfer||c._isCCPayment||c._isBillPay||c._isPayroll||c._isRent||c._reimburse)continue;
    const to=flowDestination((c._rawDescription||"")+" "+(c.description||""),c.amount_usd);
    if(!to)continue;
    c._isTransfer=true;
    c._transferTo=to;
    c._transferRaw=-(parseFloat(c.amount_usd)||0);
    c.category_id="financial";
    c.ai_confidence="high";
    c.description=to==="Rakuten"?"Rakuten Payout":(c.description&&!/ATM/i.test(c._rawDescription||"")?c.description:"ATM Withdrawal");
    c.service_start=c.service_end=c.date;
    c.service_days=1;
    c.daily_cost=c.amount_usd;
  }
}

function applyAIResults(candidates,aiResults,detectedSubs){
  if(!aiResults){
    for(const c of candidates){
      if(c._status==="skipped")continue;
      if(c._isCCPayment||c._isRent||c._isTransfer)continue;
      if(!c.category_id)c.category_id=fallbackCatMap(c._bankCategory);
      if(!c.ai_confidence)c.ai_confidence="low";
      c.service_start=getDefStart(c.category_id,c.date)||c.date;
      c.service_end=getDefEnd(c.category_id,c.service_start)||c.service_start;
      c.service_days=daysInclusive(c.service_start,c.service_end);
      c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
    }
    promoteMoneyFlows(candidates);
    return;
  }
  const byIdx={};for(const r of aiResults)byIdx[r.i]=r;
  for(let i=0;i<candidates.length;i++){
    const c=candidates[i];
    if(c._status==="skipped")continue;
    if(c._isCCPayment||c._isRent||c._isTransfer)continue;
    const ai=byIdx[i];
    if(ai){c.category_id=ai.cat;c.ai_confidence=ai.conf;c.description=ai.desc;c._aiOriginal={cat:ai.cat,conf:ai.conf,desc:ai.desc}}
    else{if(!c.category_id)c.category_id=fallbackCatMap(c._bankCategory);if(!c.ai_confidence)c.ai_confidence="low"}
    c.service_start=getDefStart(c.category_id,c.date)||c.date;
    c.service_end=getDefEnd(c.category_id,c.service_start)||c.service_start;
    c.service_days=daysInclusive(c.service_start,c.service_end);
    c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
    // The AI often copies a stale month from the few-shot examples; force any
    // trailing "(Month YYYY)"/"- Month YYYY" to match the service month.
    if(c.description)c.description=fixMonthSuffix(c.description,c.service_start);
  }
  // Auto-apply month accrual for detected subscriptions
  if(detectedSubs&&detectedSubs.length){
    const subMerchants=new Set(detectedSubs.map(s=>s.merchant));
    for(const c of candidates){
      if(c._status==="skipped"||c._isCCPayment||c._isRent||c._isTransfer)continue;
      if(subMerchants.has(normalizeMerchant(c._rawDescription||c.description))){
        c.service_start=startOfMonth(c.date);
        c.service_end=endOfMonth(c.service_start);
        c.service_days=daysInclusive(c.service_start,c.service_end);
        c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
        if(c.description)c.description=fixMonthSuffix(c.description,c.service_start);
      }
    }
  }
  promoteMoneyFlows(candidates);
}

function propagateEdits(candidates,editedIndex){
  const edited=candidates[editedIndex];
  const key=normalizeMerchant(edited._rawDescription);
  for(let i=0;i<candidates.length;i++){
    if(i===editedIndex)continue;
    const c=candidates[i];
    if(c._status!=="pending")continue;
    if(!!c._isTransfer!==!!edited._isTransfer)continue;
    if(normalizeMerchant(c._rawDescription)===key){
      c.description=edited.description;
      c.category_id=edited.category_id;
      c.service_start=getDefStart(c.category_id,c.date)||c.date;
      c.service_end=getDefEnd(c.category_id,c.service_start)||c.service_start;
      c.service_days=daysInclusive(c.service_start,c.service_end);
      c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
    }
  }
}

