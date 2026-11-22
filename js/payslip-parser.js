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

// Identify which employer/payroll layout a page belongs to. Defaults to the
// Pinterest/Workday parser so existing behavior is unchanged for any unknown PDF.
function detectPayslipProfile(fullText){
  for(const[key,prof] of Object.entries(PAYSLIP_PROFILES)){
    if(key==="pinterest")continue; // checked last as the default fallback
    if(prof.detect&&prof.detect(fullText))return key;
  }
  return "pinterest";
}

// Rippling layout (Shilpa / Pronto). Structure differs entirely from Workday:
// SUMMARY block (Gross Pay / Deductions / Taxes / Net Pay), a DEDUCTIONS section
// with employee+company columns, and PAY PERIOD / PAY DATE labels. Multi-line
// label wrapping means amounts often land on their own row, so 401K and similar
// items are matched against fullText (PDF reading order) with line fallbacks.
function parseRipplingPayslipPage(lines,fullText){
  // Pay period (the only "MM/DD/YYYY - MM/DD/YYYY" range on the stub) + pay date.
  const pm=fullText.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if(!pm)return null;
  const ppb=convertMMDDYYYY(pm[1]),ppe=convertMMDDYYYY(pm[2]);
  const dm=fullText.match(/PAY DATE:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const cd=dm?convertMMDDYYYY(dm[1]):ppe;

  // SUMMARY totals — single-line rows: "<Label> $current $ytd". Take current (first).
  let grossPay=0,taxes=0,deductions=0,netPay=0;
  for(const ln of lines){
    let m;
    if((m=ln.match(/^Gross Pay\s+\$?([\d,]+\.\d{2})/)))grossPay=pn(m[1]);
    else if((m=ln.match(/^Net Pay\s+\$?([\d,]+\.\d{2})/)))netPay=pn(m[1]);
    else if((m=ln.match(/^Taxes\s+\$?([\d,]+\.\d{2})/)))taxes=pn(m[1]);
    else if((m=ln.match(/^Deductions\s+\$?([\d,]+\.\d{2})/)))deductions=pn(m[1]);
  }
  // fullText fallbacks (handles SUMMARY rows that wrapped across PDF lines).
  if(!grossPay){const m=fullText.match(/Gross Pay\s+\$?([\d,]+\.\d{2})/);if(m)grossPay=pn(m[1]);}
  if(!netPay){const m=fullText.match(/Net Pay\s+\$?([\d,]+\.\d{2})/);if(m)netPay=pn(m[1]);}
  if(!taxes){const m=fullText.match(/(?:^|\s)Taxes\s+\$?([\d,]+\.\d{2})/);if(m)taxes=pn(m[1]);}
  // Deductions stays 0 when there is no deductions section (e.g. the Pronto.ai stub).

  if(grossPay===0)return null;

  // 401K lines. DEDUCTIONS columns are: CURRENT EMP. DEDUCTION | CURRENT CO.
  // CONTRIBUTION | YTD EMP. | YTD CO. So group 1 = employee deferral, group 2 =
  // employer match (income into her 401K). Captured for both pre-tax and Roth.
  let preTax401k=0,deferral401k=0,match401k=0;
  const preM=fullText.match(/401\s*\(?k\)?\s*\(Pre-?tax\)\s*Deduction\s+\$?([\d,]+\.\d{2})(?:\s+\$?([\d,]+\.\d{2}))?/i);
  if(preM){preTax401k=pn(preM[1]);if(preM[2])match401k+=pn(preM[2]);}
  const rothM=fullText.match(/401\s*\(?k\)?\s*\((?:Roth|After-?tax)\)\s*Deduction\s+\$?([\d,]+\.\d{2})(?:\s+\$?([\d,]+\.\d{2}))?/i);
  if(rothM){deferral401k=pn(rothM[1]);if(rothM[2])match401k+=pn(rothM[2]);}

  // preTaxTotal carries the full SUMMARY deductions so the review net-pay checksum
  // (earningsTotal - gtl - taxes - preTaxTotal - postTaxTotal) reconciles to Net Pay.
  // The Pronto branch of generatePayslipTransactions splits 401K back out of it.
  return{payPeriodBegin:ppb,payPeriodEnd:ppe,checkDate:cd,grossPay,netPay,
    earningsTotal:grossPay,employeeTaxTotal:taxes,preTaxTotal:deductions,postTaxTotal:0,
    gtl:0,preTax401k,deferral401k,fsa:0,match401k,rsuOffset:0,connectivityReimb:0,
    isRSU:false,isSkip:false,company:"Pronto"};
}

async function parsePayslipPDF(file){
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const pages=[],texts=[];
  for(let i=1;i<=pdf.numPages;i++){
    const pg=await pdf.getPage(i);
    const tc=await pg.getTextContent();
    const lines=extractLinesFromPage(tc);
    texts.push(lines.join("\n"));
    const fullText=tc.items.map(it=>it.str).join(" ");
    const profile=detectPayslipProfile(fullText);
    const parsed=profile==="pronto"
      ?parseRipplingPayslipPage(lines,fullText)
      :parsePayslipPage(lines,fullText);
    if(parsed)pages.push(parsed);
  }
  return{pages,texts};
}

async function parsePayslipXLSX(file){
  await loadSheetJS();
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:"array"});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
  const texts=wb.SheetNames.map(n=>XLSX.utils.sheet_to_csv(wb.Sheets[n]));

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

  if(!ppb||!ppe||!cd||grossPay===0)return{pages:[],texts};
  return{pages:[{payPeriodBegin:ppb,payPeriodEnd:ppe,checkDate:cd,
    grossPay,netPay,earningsTotal,employeeTaxTotal,preTaxTotal,postTaxTotal,
    preTax401k,deferral401k,fsa,match401k,rsuOffset,connectivityReimb,isRSU,isSkip:false}],texts};
}

// Gross - taxes - deductions should equal net pay to the cent. Uses the stub's own
// gross (not earningsTotal) so imputed income can't skew the check. RSU and zero
// stubs are exempt.
function payslipNetGap(p){
  return Math.round((p.grossPay-p.employeeTaxTotal-p.preTaxTotal-p.postTaxTotal-p.netPay)*100)/100;
}
function payslipReconciles(p){return p.isSkip||p.isRSU||Math.abs(payslipNetGap(p))<=0.02}

function payslipProfileForEmployer(name){
  for(const[key,prof] of Object.entries(PAYSLIP_PROFILES)){
    if(prof.employerMatch&&prof.employerMatch.test(name||""))return key;
  }
  return null;
}

const PAYSLIP_AI_PROMPT=`You read employee pay stubs and return the CURRENT-PERIOD numbers as JSON. Ignore YTD columns. Employer-paid contributions (company-paid insurance, etc.) are not employee deductions; the only employer amount you report is the 401(k) match.

Return ONLY a JSON object: {"payslips":[{...}]} with one entry per pay stub. A stub can span pages; skip pages that are not pay stubs.

Fields (plain numbers without $ or commas, 0 when absent; dates as YYYY-MM-DD):
- employer: employer name as printed. If both a PEO / employer of record and a client company appear, include both, e.g. "Pronto.ai / TAV Employer, LP".
- pay_period_begin, pay_period_end, pay_date
- gross_pay: current gross pay as printed on the stub
- employee_taxes: total employee taxes withheld
- pre_tax_deductions: total employee pre-tax deductions (pre-tax 401(k), FSA, medical, dental, vision...)
- post_tax_deductions: total employee post-tax deductions (Roth / after-tax 401(k), RSU gain offset...). If the stub does not split pre- vs post-tax, put all employee deductions in pre_tax_deductions and 0 here.
- net_pay
- pre_tax_401k: employee pre-tax 401(k) deferral
- roth_401k: employee Roth or after-tax 401(k) deferral
- employer_401k_match: employer / company 401(k) contribution
- fsa: employee health FSA contribution
- rsu_gain_offset
- connectivity_reimbursement: internet / phone stipend earnings line
- is_rsu_vest: true only for an RSU / stock vesting stub

gross_pay - employee_taxes - pre_tax_deductions - post_tax_deductions should equal net_pay. If your numbers do not, re-read the stub; never adjust a number just to force the total.`;

function aiPayslipToPage(s,profileKey){
  const n=v=>Math.round((parseFloat(v)||0)*100)/100;
  const iso=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||"")?v:null;
  const ppb=iso(s.pay_period_begin),ppe=iso(s.pay_period_end),cd=iso(s.pay_date)||ppe;
  if(!ppb||!ppe||ppb>ppe)return null;
  const pre=n(s.pre_tax_deductions),post=n(s.post_tax_deductions);
  const base={payPeriodBegin:ppb,payPeriodEnd:ppe,checkDate:cd,grossPay:n(s.gross_pay),netPay:n(s.net_pay),
    earningsTotal:n(s.gross_pay),employeeTaxTotal:n(s.employee_taxes),gtl:0,
    preTax401k:n(s.pre_tax_401k),deferral401k:n(s.roth_401k),match401k:n(s.employer_401k_match),_aiParsed:true};
  // Pronto's transaction builder expects every employee deduction in preTaxTotal.
  if(profileKey==="pronto")return{...base,preTaxTotal:n(pre+post),postTaxTotal:0,fsa:0,rsuOffset:0,
    connectivityReimb:0,isRSU:false,isSkip:false,company:"Pronto"};
  return{...base,preTaxTotal:pre,postTaxTotal:post,fsa:n(s.fsa),rsuOffset:n(s.rsu_gain_offset),
    connectivityReimb:n(s.connectivity_reimbursement),isRSU:!!s.is_rsu_vest,
    isSkip:!base.grossPay&&!base.employeeTaxTotal&&!pre&&!post};
}

// Claude reads the stub text only when the rule parsers find nothing or a page
// fails the net-pay check. Rule pages that reconcile are kept; Claude's reading
// replaces the rest. Stubs from employers without a PAYSLIP_PROFILES entry come
// back in `unknown` so the caller can block the import.
async function payslipAIFallback(rulePages,texts){
  const doc=texts.map((t,i)=>`--- Page ${i+1} ---\n${t}`).join("\n\n");
  if(doc.length>60000)throw new Error("Payslip file is too long for AI reading. Split it into smaller files.");
  const{json,usage}=await callClaudeJSON({model:getAIModel(),max_tokens:Math.min(8000,800+500*texts.length),
    system:PAYSLIP_AI_PROMPT,messages:[{role:"user",content:doc}]});
  const aiPages=[],unknown=[];
  for(const s of json.payslips||[]){
    const key=payslipProfileForEmployer(s.employer);
    if(!key){unknown.push(s);continue}
    const p=aiPayslipToPage(s,key);
    if(p)aiPages.push(p);
  }
  const period=p=>`${p.payPeriodBegin}|${p.payPeriodEnd}|${p.checkDate}`;
  const good=rulePages.filter(payslipReconciles);
  const goodKeys=new Set(good.map(p=>period(p)+"|"+p.netPay.toFixed(2)));
  const added=aiPages.filter(p=>!goodKeys.has(period(p)+"|"+p.netPay.toFixed(2)));
  const aiPeriods=new Set(added.map(period));
  const stillBad=rulePages.filter(p=>!payslipReconciles(p)&&!aiPeriods.has(period(p)));
  return{pages:[...good,...added,...stillBad],aiCount:added.length,unknown,usage};
}

function generatePayslipTransactions(pages,enteredDate){
  const txns=[];
  for(const p of pages){
    if(p.isSkip)continue;
    const ss=p.payPeriodBegin,se=p.payPeriodEnd;
    if(p.company==="Pronto"){
      const cfg=PAYSLIP_PROFILES.pronto;
      const grp=`${fmtD(ss)} \u2013 ${fmtD(se)} (Pronto)`;
      // Medical = total employee deductions minus the 401K lines (split out below).
      const medical=Math.round((p.preTaxTotal-p.preTax401k-p.deferral401k)*100)/100;
      txns.push({date:enteredDate,service_start:ss,service_end:se,
        description:"Pronto Income",category_id:"income",
        amount_usd:-p.earningsTotal,payment_type:cfg.bank,
        _group:grp,_source:"salary",_pageData:p});
      txns.push({date:enteredDate,service_start:ss,service_end:se,
        description:"Income Taxes and Social Security",category_id:"income",
        amount_usd:p.employeeTaxTotal,payment_type:cfg.bank,
        _group:grp,_source:"tax",_pageData:p});
      if(medical>0.005){
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Medical Insurance Benefits",category_id:"health",
          amount_usd:medical,payment_type:cfg.bank,
          _group:grp,_source:"benefits",_pageData:p});
      }
      if(p.preTax401k>0){
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Pre-tax 401K",category_id:"financial",
          amount_usd:p.preTax401k,payment_type:cfg.bank,
          _group:grp,_source:"pretax_401k_out",_pageData:p});
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Fidelity Deposited Pre-tax 401K",category_id:"financial",
          amount_usd:-p.preTax401k,payment_type:cfg.k401Account,
          _group:grp,_source:"pretax_401k_in",_pageData:p});
      }
      if(p.deferral401k>0){
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"401K (Roth)",category_id:"financial",
          amount_usd:p.deferral401k,payment_type:cfg.bank,
          _group:grp,_source:"401k_out",_pageData:p});
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Fidelity Deposited 401K (Roth)",category_id:"financial",
          amount_usd:-p.deferral401k,payment_type:cfg.k401Account,
          _group:grp,_source:"401k_in",_pageData:p});
      }
      if(p.match401k>0){
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"401K Match",category_id:"income",
          amount_usd:-p.match401k,payment_type:cfg.k401Account,
          _group:grp,_source:"401k_match",_pageData:p});
      }
    }else if(p.isRSU){
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
        // Standalone group — linked to the Astound internet bill, not merged into the payroll group
        txns.push({date:enteredDate,service_start:ss,service_end:se,
          description:"Connectivity Reimbursement Fund",category_id:"utilities",
          amount_usd:-p.connectivityReimb,payment_type:"Chase Chequing",
          _group:`Connectivity Reimb – ${ss.slice(0,7)}`,_source:"connectivity_reimb",_pageData:p});
      }
    }
  }
  return txns;
}

