function pn(s){return parseFloat(String(s).replace(/,/g,""))||0}

function extractLinesFromPage(tc){
  const items=tc.items.filter(i=>i.str.trim());
  if(!items.length)return[];
  const groups=[];let cur=[items[0]],cy=items[0].transform[5];
  for(let i=1;i<items.length;i++){
    const it=items[i],y=it.transform[5];
    if(Math.abs(y-cy)<=2){cur.push(it)}
    else{groups.push({y:cy,items:cur});cur=[it];cy=y}
  }
  groups.push({y:cy,items:cur});
  groups.sort((a,b)=>b.y-a.y);
  return groups.map(g=>{
    g.items.sort((a,b)=>a.transform[4]-b.transform[4]);
    return g.items.map(i=>i.str).join(" ");
  });
}

function parsePayslipPage(lines,fullText){
  // Extract 3 consecutive dates
  const dm=fullText.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/);
  if(!dm)return null;
  const ppb=convertMMDDYYYY(dm[1]),ppe=convertMMDDYYYY(dm[2]),cd=convertMMDDYYYY(dm[3]);

  // Parse Current summary row
  const cm=fullText.match(/Current\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/);
  if(!cm)return null;
  const grossPay=pn(cm[2]),preTaxSum=pn(cm[3]),empTaxSum=pn(cm[4]),postTaxSum=pn(cm[5]),netPay=pn(cm[6]);

  // Skip if all zeros
  if(grossPay===0&&empTaxSum===0&&preTaxSum===0&&postTaxSum===0){
    return{payPeriodBegin:ppb,payPeriodEnd:ppe,checkDate:cd,grossPay:0,netPay:0,
      earningsTotal:0,employeeTaxTotal:0,preTaxTotal:0,postTaxTotal:0,
      preTax401k:0,deferral401k:0,fsa:0,match401k:0,rsuOffset:0,isRSU:false,isSkip:true};
  }

  // Section totals: try combined-line format first (old layout), then "Total:" lines (new layout)
  let earningsTotal=0,employeeTaxTotal=0,preTaxTotal=0,postTaxTotal=0;
  for(const ln of lines){
    const em=ln.match(/^Earnings\s+([\d,.]+)\s+[\d,.]+\s+Employee Taxes\s+([\d,.]+)/);
    if(em){earningsTotal=pn(em[1]);employeeTaxTotal=pn(em[2])}
    const pm=ln.match(/^Pre Tax Deductions\s+([\d,.]+)\s+[\d,.]+\s+Post Tax Deductions\s+([\d,.]+)/);
    if(pm){preTaxTotal=pn(pm[1]);postTaxTotal=pn(pm[2])}
  }
  // Fallback: parse "Total:" lines after each section header (new PDF layout)
  if(!earningsTotal&&!employeeTaxTotal){
    const sectionOrder=["Earnings","Employee Taxes","Pre Tax Deductions","Post Tax Deductions"];
    let curSection="";
    for(const ln of lines){
      const sh=sectionOrder.find(s=>ln.trim()===s||ln.startsWith(s+" "));
      if(sh){curSection=sh;continue}
      if(curSection){const tm=ln.match(/^Total:\s+([\d,.]+)/);if(tm){
        const v=pn(tm[1]);
        if(curSection==="Earnings")earningsTotal=v;
        else if(curSection==="Employee Taxes")employeeTaxTotal=v;
        else if(curSection==="Pre Tax Deductions")preTaxTotal=v;
        else if(curSection==="Post Tax Deductions")postTaxTotal=v;
        curSection="";
      }}
    }
  }
  // Fallback to Current row values for any section totals missing due to cross-page splits
  if(!earningsTotal)earningsTotal=grossPay;
  if(!employeeTaxTotal)employeeTaxTotal=empTaxSum;
  if(!preTaxTotal&&preTaxSum)preTaxTotal=preTaxSum;
  if(!postTaxTotal&&postTaxSum)postTaxTotal=postTaxSum;

  // GTL is IRS imputed income — excluded from gross pay and not a real deduction; ignore it

  // Use lines (Y-sorted, X-sorted within row) for deduction/benefit parsing — more reliable
  // than fullText which joins raw PDF items and can interleave multi-column values.

  // Pre-tax 401(k): line starting with "401(k)" then a number (no word between label and amount)
  let preTax401k=0;
  for(const ln of lines){
    const m=ln.match(/^401\(k\)\s+([\d,.]+)/);
    if(m){preTax401k=pn(m[1]);break;}
  }

  // 401(k) After-tax Deferral: 2 numbers = [current, YTD], 1 number = YTD only (Google post-tax)
  let deferral401k=0;
  const km=fullText.match(/401\(k\) After-tax Deferral\s+([\d,.]+)(?:\s+([\d,.]+))?/);
  if(km&&km[2])deferral401k=pn(km[1]);

  // FSA: line containing "Flex Spending Health" then a number
  let fsa=0;
  for(const ln of lines){
    const m=ln.match(/Flex\s+Spending\s+Health\s+([\d,.]+)/i);
    if(m){fsa=pn(m[1]);break;}
  }

  // 401(k) Employer/Company Match: try lines first, then fullText fallback with permissive gap
  // (label and amount may split across lines if PDF column Y values differ by >2px)
  let match401k=0;
  for(const ln of lines){
    const m=ln.match(/(?:Company|Employer)\s+Match\s+([\d,.]+)/i);
    if(m){match401k=pn(m[1]);break;}
  }
  if(!match401k){
    const m=fullText.match(/(?:Company|Employer)\s+Match[^\d]*([\d,.]+)/i);
    if(m)match401k=pn(m[1]);
  }

  // RSU Gain Offset: same pattern
  let rsuOffset=0;
  const rm=fullText.match(/RSU Gain Offset\s+([\d,.]+)(?:\s+([\d,.]+))?/);
  if(rm&&rm[2])rsuOffset=pn(rm[1]);

  // RSU detection: RSU Gain followed by a date
  const isRSU=!!fullText.match(/RSU Gain\s+\d{2}\/\d{2}\/\d{4}/);

  // Connectivity Reimbursement Fund: try lines first, then fullText fallback
  let connectivityReimb=0;
  for(const ln of lines){
    const m=ln.match(/Connect\w*\s+Reimbursement(?:\s+Fund)?\s+([\d,.]+)/i);
    if(m){connectivityReimb=pn(m[1]);break;}
  }
  if(!connectivityReimb){
    const m=fullText.match(/Connect\w*\s+Reimbursement(?:\s+Fund)?[^\d]*([\d,.]+)/i);
    if(m)connectivityReimb=pn(m[1]);
  }

  return{payPeriodBegin:ppb,payPeriodEnd:ppe,checkDate:cd,grossPay,netPay,
    earningsTotal,employeeTaxTotal,preTaxTotal,postTaxTotal,
    preTax401k,deferral401k,fsa,match401k,rsuOffset,connectivityReimb,isRSU,isSkip:false};
}

async function parsePayslipPDF(file){
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const pg=await pdf.getPage(i);
    const tc=await pg.getTextContent();
    const lines=extractLinesFromPage(tc);
    const fullText=tc.items.map(it=>it.str).join(" ");
    const parsed=parsePayslipPage(lines,fullText);
    if(parsed)pages.push(parsed);
  }
  return pages;
}

async function parsePayslipXLSX(file){
  await loadSheetJS();
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:"array"});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});

  let ppb=null,ppe=null,cd=null;
  let grossPay=0,earningsTotal=0,preTaxTotal=0,employeeTaxTotal=0,postTaxTotal=0,netPay=0;
  let preTax401k=0,deferral401k=0,fsa=0,match401k=0,rsuOffset=0,connectivityReimb=0;
  let isRSU=false;
  const SECTIONS=["Earnings","Employee Taxes","Pre Tax Deductions","Post Tax Deductions","Employer Paid Benefits"];
  let section=null;
  let awaitingDates=false;

  for(const row of rows){
    if(!row||row.every(c=>c==null))continue;
    const c=row.map(c=>c==null?null:String(c).trim());

    // Pay Period dates: header row contains "Pay Period Begin", next data row has dates
    if(c.includes("Pay Period Begin")){awaitingDates=true;continue;}
    if(awaitingDates&&!ppb){
      // Date values are at index 3,4,5 (matching header order)
      const idx=c.findIndex(v=>v&&/\d{2}\/\d{2}\/\d{4}/.test(v));
      if(idx>=0){ppb=convertMMDDYYYY(c[idx]);ppe=convertMMDDYYYY(c[idx+1]);cd=convertMMDDYYYY(c[idx+2]);}
      awaitingDates=false;continue;
    }

    // Current summary row
    if(c[0]==="Current"&&c[2]!=null){
      grossPay=parseFloat(c[2])||0;earningsTotal=grossPay;
      preTaxTotal=parseFloat(c[3])||0;
      employeeTaxTotal=parseFloat(c[4])||0;
      postTaxTotal=parseFloat(c[5])||0;
      netPay=parseFloat(c[6])||0;
      continue;
    }

    // Section header detection
    const sec=SECTIONS.find(s=>c[0]===s);
    if(sec){section=sec;continue;}
    if(c[0]==="Description")continue; // column header row

    // Section data rows: (Description, Amount, YTD)
    if(section&&c[0]){
      const desc=c[0],amt=c[1]!=null?parseFloat(c[1])||0:null;
      if(section==="Earnings"){
        // Earnings section: Amount is at c[4] (col layout: Description|Dates|Hours|Rate|Amount|...)
        const earningsAmt=c[4]!=null?parseFloat(c[4])||0:null;
        if(/RSU\s*Gain/i.test(desc)&&!/Offset/i.test(desc)&&earningsAmt!=null)isRSU=true;
        if(/Connect\w*\s+Reimbursement/i.test(desc)&&earningsAmt!=null)connectivityReimb=earningsAmt;
      }
      if(section==="Pre Tax Deductions"){
        if(/^401\(k\)$/i.test(desc)&&amt!=null)preTax401k=amt;
        if(/Flex\s+Spending\s+Health/i.test(desc)&&amt!=null)fsa=amt;
      }
      if(section==="Post Tax Deductions"){
        if(/After-tax\s+Deferral/i.test(desc)&&amt!=null)deferral401k=amt;
        if(/RSU\s+Gain\s+Offset/i.test(desc)&&amt!=null)rsuOffset=amt;
      }
      if(section==="Employer Paid Benefits"){
        if(/(?:Company|Employer)\s+Match/i.test(desc)&&amt!=null)match401k=amt;
        if(/Connect\w*\s+Reimbursement/i.test(desc)&&amt!=null)connectivityReimb=amt;
      }
      if(section==="Post Tax Deductions"){
        if(/Connect\w*\s+Reimbursement/i.test(desc)&&amt!=null)connectivityReimb=amt;
      }
    }
  }

  if(!ppb||!ppe||!cd||grossPay===0)return[];
  return[{payPeriodBegin:ppb,payPeriodEnd:ppe,checkDate:cd,
    grossPay,netPay,earningsTotal,employeeTaxTotal,preTaxTotal,postTaxTotal,
    preTax401k,deferral401k,fsa,match401k,rsuOffset,connectivityReimb,isRSU,isSkip:false}];
}

function generatePayslipTransactions(pages,enteredDate){
  const txns=[];
  for(const p of pages){
    if(p.isSkip)continue;
    const ss=p.payPeriodBegin,se=p.payPeriodEnd;
    if(p.isRSU){
      const vp=getQuarterlyVestingPeriod(ss);
      const q=Math.ceil((new Date(ss+"T00:00:00").getMonth()+1)/3);
      const y=new Date(ss+"T00:00:00").getFullYear();
      txns.push({date:enteredDate,service_start:vp.start,service_end:vp.end,
        description:`Pinterest Stock Units Vested (Q${q} ${y})`,category_id:"income",
        amount_usd:-p.earningsTotal,payment_type:"Charles Schwab",
        _group:`${fmtD(ss)} \u2013 ${fmtD(se)} (RSU Vesting)`,_source:"rsu",_pageData:p});
      txns.push({date:enteredDate,service_start:vp.start,service_end:vp.end,
        description:"Income Taxes and Social Security",category_id:"income",
        amount_usd:p.employeeTaxTotal,payment_type:"Charles Schwab",
        _group:`${fmtD(ss)} \u2013 ${fmtD(se)} (RSU Vesting)`,_source:"rsu_tax",_pageData:p});
    }else{
      const postTaxNon401k=Math.round((p.postTaxTotal-p.deferral401k-p.rsuOffset)*100)/100;
      // Medical = preTaxTotal minus pre-tax 401K and FSA (which are separate line items) + non-401K post-tax deductions
      const medical=Math.round((p.preTaxTotal-p.preTax401k-p.fsa+postTaxNon401k)*100)/100;
      const grp=`${fmtD(ss)} \u2013 ${fmtD(se)} (Regular)`;
      txns.push({date:enteredDate,service_start:ss,service_end:se,
        description:"Pinterest Income",category_id:"income",
        amount_usd:-p.earningsTotal,payment_type:"Chase Chequing",
        _group:grp,_source:"salary",_pageData:p});
      txns.push({date:enteredDate,service_start:ss,service_end:se,
        description:"Income Taxes and Social Security",category_id:"income",
        amount_usd:p.employeeTaxTotal,payment_type:"Chase Chequing",
        _group:grp,_source:"tax",_pageData:p});
      txns.push({date:enteredDate,service_start:ss,service_end:se,
        description:"Medical Insurance Benefits",category_id:"health",
        amount_usd:medical,payment_type:"Chase Chequing",
        _group:grp,_source:"benefits",_pageData:p});
      if(p.preTax401k>0){
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Pre-tax 401K",category_id:"financial",
          amount_usd:p.preTax401k,payment_type:"Chase Chequing",
          _group:grp,_source:"pretax_401k_out",_pageData:p});
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Vanguard Deposited Pre-tax 401K",category_id:"financial",
          amount_usd:-p.preTax401k,payment_type:"Vanguard",
          _group:grp,_source:"pretax_401k_in",_pageData:p});
      }
      if(p.deferral401k>0){
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"401K (Post-tax)",category_id:"financial",
          amount_usd:p.deferral401k,payment_type:"Chase Chequing",
          _group:grp,_source:"401k_out",_pageData:p});
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Vanguard Deposited 401K (Post-tax)",category_id:"financial",
          amount_usd:-p.deferral401k,payment_type:"Vanguard",
          _group:grp,_source:"401k_in",_pageData:p});
      }
      if(p.fsa>0){
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"FSA Deposit",category_id:"financial",
          amount_usd:p.fsa,payment_type:"Chase Chequing",
          _group:grp,_source:"fsa_out",_pageData:p});
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"FSA Deposited",category_id:"financial",
          amount_usd:-p.fsa,payment_type:"Transfer",credit:"FSA 2026",
          _group:grp,_source:"fsa_in",_pageData:p});
      }
      if(p.match401k>0){
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"401K Match",category_id:"income",
          amount_usd:-p.match401k,payment_type:"Vanguard",
          _group:grp,_source:"401k_match",_pageData:p});
      }
      if(p.connectivityReimb>0){
        // Standalone group — will be linked to AT&T bill alone (not merged into payroll group)
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Connectivity Reimbursement Fund",category_id:"utilities",
          amount_usd:-p.connectivityReimb,payment_type:"Chase Chequing",
          _group:`Connectivity Reimb – ${ss.slice(0,7)}`,_source:"connectivity_reimb",_pageData:p});
      }
    }
  }
  return txns;
}

