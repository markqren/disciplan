#!/usr/bin/env node
// Offline check: parse the attached Wells Fargo PDFs with pdf.js + the in-app parser.
const fs=require("fs");
const path=require("path");
const vm=require("vm");

async function main(){
  let pdfjs;
  try{pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs")}
  catch(e1){
    try{
      const cjs=require("pdfjs-dist/legacy/build/pdf.js");
      pdfjs={getDocument:cjs.getDocument};
    }catch(e2){
      console.error("Need pdfjs-dist. Run: npm install pdfjs-dist@3.11.174");
      throw e2;
    }
  }
  const parserSrc=fs.readFileSync(path.join(__dirname,"../js/wf-statement-parser.js"),"utf8");
  const sandbox={
    console,
    window:{},
    extractLinesFromPage(tc){
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
  };
  vm.createContext(sandbox);
  vm.runInContext(parserSrc+"\nthis.parseWellsFargoStatementLines=parseWellsFargoStatementLines;",sandbox);

  const files=[
    ["/Users/markren/.cursor/projects/Users-markren-code-disciplan/attachments/3bc5e97f-c144-42b8-a9a5-77ef62bff735/Statement_07_23_26__143K__PDF_.pdf","2026-07"],
    ["/Users/markren/.cursor/projects/Users-markren-code-disciplan/attachments/3bc5e97f-c144-42b8-a9a5-77ef62bff735/Statement_08_25_26__108K__PDF_.pdf","2026-08"],
    ["/Users/markren/.cursor/projects/Users-markren-code-disciplan/attachments/e49c519d-ac8f-456a-bfcb-36dfb1ffaaf4/Statement_09_24_26__111K__PDF_.pdf","2026-09"]
  ];
  const ccRe=/CHASE CREDIT CRD\s+(EPAY|AUTOPAY|RETRY PYMT)|BILT CARD\s+PMT|AMEX EPAYMENT|AMERICAN EXPRESS/i;
  const xferRe=/ONLINE TRANSFER/i;
  for(const [file,label] of files){
    const data=new Uint8Array(fs.readFileSync(file));
    const pdf=await pdfjs.getDocument({data,disableWorker:true}).promise;
    const lines=[];
    for(let i=1;i<=pdf.numPages;i++){
      const pg=await pdf.getPage(i);
      const tc=await pg.getTextContent();
      lines.push(...sandbox.extractLinesFromPage(tc));
    }
    const parsed=sandbox.parseWellsFargoStatementLines(lines);
    const cc=parsed.rows.filter(r=>ccRe.test(r.DESCRIPTION));
    const xfer=parsed.rows.filter(r=>xferRe.test(r.DESCRIPTION));
    console.log(label,{
      account:parsed.account,
      rows:parsed.rows.length,
      deposits:parsed.deposits,
      withdrawals:parsed.withdrawals,
      beginning:parsed.beginning,
      ending:parsed.ending,
      ccPays:cc.map(r=>({d:r.DATE,a:r.AMOUNT,desc:r.DESCRIPTION.slice(0,48)})),
      transfers:xfer.map(r=>({d:r.DATE,a:r.AMOUNT,desc:r.DESCRIPTION.slice(0,72)}))
    });
  }
}

main().catch(e=>{console.error(e);process.exit(1)});
