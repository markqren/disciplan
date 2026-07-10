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
      // Profile-driven classification (Wells Fargo). Inflows use NEGATIVE amount_usd
      // (income/credit) and outflows POSITIVE (debit), matching balance = -sum(amount_usd).
      const cl=profile.classifyRow(row,rawAmt);
      if(cl){
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
      _ccPaymentPair:{description:names[1],payment_type:"Chase Chequing",amount:Math.abs(amt)}
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

function fallbackCatMap(bankCat){return AMEX_CAT_MAP[bankCat]||CHASE_CAT_MAP[bankCat]||"other"}
function applyAIResults(candidates,aiResults,detectedSubs){
  if(!aiResults){
    for(const c of candidates){
      if(c._status==="skipped")continue;
      if(c._isCCPayment||c._isRent)continue;
      if(!c.category_id)c.category_id=fallbackCatMap(c._bankCategory);
      if(!c.ai_confidence)c.ai_confidence="low";
      c.service_start=getDefStart(c.category_id,c.date)||c.date;
      c.service_end=getDefEnd(c.category_id,c.service_start)||c.service_start;
      c.service_days=daysInclusive(c.service_start,c.service_end);
      c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
    }
    return;
  }
  const byIdx={};for(const r of aiResults)byIdx[r.i]=r;
  for(let i=0;i<candidates.length;i++){
    const c=candidates[i];
    if(c._status==="skipped")continue;
    if(c._isCCPayment||c._isRent)continue;
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
      if(c._status==="skipped"||c._isCCPayment||c._isRent)continue;
      if(subMerchants.has(normalizeMerchant(c._rawDescription||c.description))){
        c.service_start=startOfMonth(c.date);
        c.service_end=endOfMonth(c.service_start);
        c.service_days=daysInclusive(c.service_start,c.service_end);
        c.daily_cost=Math.round(c.amount_usd/c.service_days*1e6)/1e6;
        if(c.description)c.description=fixMonthSuffix(c.description,c.service_start);
      }
    }
  }
}

function propagateEdits(candidates,editedIndex){
  const edited=candidates[editedIndex];
  const key=normalizeMerchant(edited._rawDescription);
  for(let i=0;i<candidates.length;i++){
    if(i===editedIndex)continue;
    const c=candidates[i];
    if(c._status!=="pending")continue;
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

