// Wells Fargo Everyday Checking / Way2Save PDF statements (FEA-127).
// Parses Transaction history into the same DATE/DESCRIPTION/AMOUNT rows the
// wells_fargo CSV profile expects: positive AMOUNT = deposit, negative = withdrawal.

function wfMoneyRe(){return/\d{1,3}(?:,\d{3})*\.\d{2}/g}
const WF_DATE_RE=/^(\d{1,2}\/\d{1,2})(?:\s|$)/;
const WF_MONTHS={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};

function wfMoney(s){return Math.round(parseFloat(String(s).replace(/,/g,""))*100)/100}

function isWellsFargoStatement(text){
  return /Wells Fargo/i.test(text||"")&&/Transaction history/i.test(text||"");
}

function wfStatementAccount(text){
  const head=(text||"").slice(0,2500);
  if(/Everyday Checking/i.test(head))return"Wells Fargo Checking";
  if(/Way2Save/i.test(head)||(/Savings/i.test(head)&&!/Checking/i.test(head)))return"Wells Fargo Savings";
  return"Wells Fargo Checking";
}

function wfParseStatementDate(text){
  const m=(text||"").match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i);
  if(!m)return null;
  return{month:WF_MONTHS[m[1].toLowerCase()],day:+m[2],year:+m[3]};
}

function wfIsoFromMd(md,end){
  const p=md.split("/").map(Number);
  const m=p[0],d=p[1];
  let y=end.year;
  if(m>end.month||(m===end.month&&d>end.day))y=end.year-1;
  return`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function wfSignHint(desc){
  const d=(desc||"").toUpperCase();
  if(/PAYROLL|ZELLE FROM|INTEREST PAYMENT|TAX REF|ONLINE TRANSFER FROM|\bDEPOSIT\b/.test(d))return 1;
  if(/CHASE CREDIT CRD|BILT CARD|AMEX |PURCHASE AUTHORIZED|PAYPAL PURCHASE|ZELLE TO|ONLINE TRANSFER TO|VENMO PAYMENT|INS PREM|WIRE TRANS/.test(d))return-1;
  return 0;
}

function wfSolveSigns(prev,amounts,eod,hints){
  const n=amounts.length;
  if(!n)return[];
  if(eod==null||n>12)return amounts.map((_,i)=>hints[i]===1?1:-1);
  const want=Math.round(eod*100),start=Math.round(prev*100);
  let best=null,bestScore=-1e9;
  const limit=1<<n;
  for(let mask=0;mask<limit;mask++){
    let bal=start,signs=new Array(n),score=0;
    for(let i=0;i<n;i++){
      const s=(mask>>i)&1?1:-1;
      signs[i]=s;
      bal+=Math.round(amounts[i]*100)*s;
      if(hints[i]===s)score+=2;
      else if(hints[i]===-s)score-=1;
    }
    if(bal!==want)continue;
    if(score>bestScore){best=signs;bestScore=score}
  }
  return best||amounts.map((_,i)=>hints[i]===1?1:-1);
}

function wfIsHistHeader(ln){
  const t=(ln||"").trim();
  if(!t)return true;
  if(/^(Date|Check|Number Description|Deposits\/|Additions|Withdrawals\/|Subtractions|Ending daily|balance)$/i.test(t))return true;
  if(/Deposits\//i.test(t)&&/Withdrawals\//i.test(t))return true;
  if(/Page\s+\d+\s+of\s+\d+/i.test(t))return true;
  if(/Wells Fargo Everyday Checking/i.test(t))return true;
  if(/^Transaction History \(continued\)/i.test(t))return true;
  return false;
}

function wfCollectHistoryLines(lines){
  const hist=[];
  let inHist=false;
  for(const ln of lines){
    if(/Transaction history/i.test(ln)){inHist=true;continue}
    if(inHist&&/^\s*Totals\b/i.test(ln)){inHist=false;continue}
    if(inHist&&!wfIsHistHeader(ln))hist.push(ln);
  }
  return hist;
}

function wfExtractMoneys(s){
  const out=[];
  const m=String(s||"").match(wfMoneyRe());
  if(m)for(const x of m)out.push(wfMoney(x));
  return out;
}

function wfParseHistoryBlocks(histLines){
  const blocks=[];
  let cur=null;
  function flush(){if(cur)blocks.push(cur);cur=null}
  for(const ln of histLines){
    const dm=ln.match(WF_DATE_RE);
    if(dm){
      flush();
      cur={md:dm[1],text:ln.slice(dm[1].length).trim()};
    }else if(cur){
      cur.text=(cur.text+" "+ln.trim()).replace(/\s+/g," ").trim();
    }
  }
  flush();
  return blocks.map(b=>{
    const amounts=wfExtractMoneys(b.text);
    let desc=b.text.replace(wfMoneyRe()," ").replace(/\s+/g," ").trim();
    desc=desc.replace(/\s+Card\s+\d{3,4}\s*$/i,"").trim();
    return{md:b.md,description:desc,amounts};
  }).filter(b=>b.amounts.length);
}

function parseWellsFargoStatementLines(lines){
  const full=(lines||[]).join("\n");
  if(!isWellsFargoStatement(full))throw new Error("Not a Wells Fargo statement. Use Payslip Import for paystubs.");
  const end=wfParseStatementDate(full);
  if(!end)throw new Error("Could not read the Wells Fargo statement date.");
  const beginM=full.match(/Beginning balance on\s+(\d{1,2}\/\d{1,2})\s+\$?([\d,]+\.\d{2})/i);
  const endM=full.match(/Ending balance on\s+(\d{1,2}\/\d{1,2})\s+\$?([\d,]+\.\d{2})/i);
  const depM=full.match(/Deposits\/Additions\s+([\d,]+\.\d{2})/i);
  const wthM=full.match(/Withdrawals\/Subtractions\s+-?\s*([\d,]+\.\d{2})/i);
  if(!beginM||!endM)throw new Error("Could not read Wells Fargo beginning/ending balances.");
  const beginning=wfMoney(beginM[2]),ending=wfMoney(endM[2]);
  const statedDep=depM?wfMoney(depM[1]):null;
  const statedWth=wthM?wfMoney(wthM[1]):null;
  const blocks=wfParseHistoryBlocks(wfCollectHistoryLines(lines));
  if(!blocks.length)throw new Error("No transactions found on this Wells Fargo statement.");

  const days=[];
  for(const b of blocks){
    const last=days[days.length-1];
    if(last&&last.md===b.md)last.items.push(b);
    else days.push({md:b.md,items:[b]});
  }

  const rows=[];
  let bal=beginning,gotDep=0,gotWth=0;
  for(const day of days){
    const items=day.items.map(it=>{
      const amts=it.amounts.slice();
      return{description:it.description,amounts:amts};
    });
    const last=items[items.length-1];
    let eod=null;
    if(last.amounts.length>=2)eod=last.amounts[last.amounts.length-1];
    const amounts=items.map((it,i)=>{
      const a=it.amounts.slice();
      if(i===items.length-1&&a.length>=2)a.pop();
      return a[0]||0;
    });
    const hints=items.map(it=>wfSignHint(it.description));
    const target=eod==null?null:eod;
    const signs=wfSolveSigns(bal,amounts,target,hints);
    for(let i=0;i<items.length;i++){
      const signed=Math.round(amounts[i]*signs[i]*100)/100;
      if(signed>=0)gotDep+=signed;else gotWth+=-signed;
      bal=Math.round((bal+signed)*100)/100;
      rows.push({
        DATE:wfIsoFromMd(day.md,end).replace(/^(\d{4})-(\d{2})-(\d{2})$/,"$2/$3/$1"),
        DESCRIPTION:items[i].description,
        AMOUNT:String(signed),
        "CHECK #":"",
        STATUS:""
      });
    }
    if(target!=null)bal=target;
  }

  gotDep=Math.round(gotDep*100)/100;
  gotWth=Math.round(gotWth*100)/100;
  const recon=Math.round((beginning+gotDep-gotWth)*100)/100;
  if(Math.abs(recon-ending)>0.05){
    throw new Error(`Wells Fargo statement did not reconcile (computed ${recon.toFixed(2)} vs ending ${ending.toFixed(2)}).`);
  }
  if(statedDep!=null&&Math.abs(gotDep-statedDep)>0.05){
    throw new Error(`Wells Fargo deposits did not match statement totals (${gotDep.toFixed(2)} vs ${statedDep.toFixed(2)}).`);
  }
  if(statedWth!=null&&Math.abs(gotWth-statedWth)>0.05){
    throw new Error(`Wells Fargo withdrawals did not match statement totals (${gotWth.toFixed(2)} vs ${statedWth.toFixed(2)}).`);
  }
  return{
    account:wfStatementAccount(full),
    beginning,ending,deposits:gotDep,withdrawals:gotWth,
    rows
  };
}

async function parseWellsFargoStatementPDF(file){
  if(!window.pdfjsLib)throw new Error("PDF parser not available. Reload the page.");
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const lines=[];
  for(let i=1;i<=pdf.numPages;i++){
    const pg=await pdf.getPage(i);
    const tc=await pg.getTextContent();
    lines.push(...extractLinesFromPage(tc));
  }
  return parseWellsFargoStatementLines(lines);
}
