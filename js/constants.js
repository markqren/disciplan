
const PARENT_CATS=["entertainment","food","home","health","personal","transportation","utilities","financial","other"];
const SUB_MAP={entertainment:["accommodation","games"],food:["groceries","restaurant"],home:["rent","furniture"],personal:["clothes","tech"]};
const CC={entertainment:"#E07A5F",accommodation:"#D4726A",games:"#C4625A",food:"#F2CC8F",groceries:"#E9C46A",restaurant:"#D4A373",home:"#4A6FA5",rent:"#3A5F95",furniture:"#5A7FB5",health:"#CB997E",personal:"#3D405B",clothes:"#8B687F",tech:"#9B8EA0",transportation:"#81B29A",utilities:"#6B9AC4",financial:"#A8DADC",other:"#7B6D8D",income:"#2A9D8F",investment:"#264653",adjustment:"#B0BEC5"};
const BUDGET_TARGETS={
  2019:{entertainment:4,accommodation:0,games:0,food:6,groceries:2.5,restaurant:3.5,home:25,rent:23.5,furniture:1.5,health:2.5,personal:3,clothes:1.5,tech:1.5,transportation:2.5,utilities:1.5,financial:0.5,other:1,_expenses:46,_savings:54},
  2020:{entertainment:2,accommodation:0,games:0,food:6,groceries:2.5,restaurant:3.5,home:25,rent:23.5,furniture:1.5,health:2.5,personal:3,clothes:1.5,tech:1.5,transportation:1.5,utilities:1.5,financial:0.5,other:1,_expenses:43,_savings:57},
  2021:{entertainment:4,accommodation:0,games:0,food:8,groceries:3.5,restaurant:4.5,home:25,rent:23.5,furniture:1.5,health:6,personal:3,clothes:1.5,tech:1.5,transportation:2.5,utilities:1.5,financial:0.5,other:1,_expenses:51.5,_savings:48.5},
  2022:{entertainment:5,accommodation:0,games:0,food:7,groceries:3,restaurant:4,home:21.5,rent:20,furniture:1.5,health:3,personal:2,clothes:1,tech:1,transportation:4,utilities:2,financial:0,other:1,_expenses:45.5,_savings:54.5},
  2023:{entertainment:8,accommodation:0,games:0,food:7,groceries:2,restaurant:5,home:21,rent:20,furniture:1,health:4,personal:2,clothes:1,tech:1,transportation:5,utilities:2,financial:0,other:1,_expenses:50,_savings:50},
  2024:{entertainment:7,accommodation:0,games:0,food:6,groceries:1,restaurant:5,home:19,rent:18,furniture:1,health:4,personal:3,clothes:1.5,tech:1.5,transportation:5,utilities:2,financial:0,other:1,_expenses:47,_savings:53},
  2025:{entertainment:7,accommodation:0,games:0,food:6,groceries:1,restaurant:5,home:19,rent:18,furniture:1,health:4,personal:3,clothes:1.5,tech:1.5,transportation:5,utilities:2,financial:0,other:1,_expenses:47,_savings:53}
};
function getBudgetTargets(year){
  const base=BUDGET_TARGETS[year]||BUDGET_TARGETS[2025];
  const saved=localStorage.getItem("budgetTargets_"+year);
  if(saved)try{return{...base,...JSON.parse(saved)}}catch(e){}
  return{...base};
}
function saveBudgetTargets(year,bgt){
  const base=BUDGET_TARGETS[year]||BUDGET_TARGETS[2025];
  const diff={};
  for(const k of Object.keys(bgt)){if(bgt[k]!==base[k])diff[k]=bgt[k]}
  if(Object.keys(diff).length)localStorage.setItem("budgetTargets_"+year,JSON.stringify(diff));
  else localStorage.removeItem("budgetTargets_"+year);
}
const ML=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const TCOLS=["#4A6FA5","#E07A5F","#81B29A","#F2CC8F","#3D405B","#D4A373","#9B8EA0","#6B9AC4","#CB997E","#8B687F"];
// Cashback (FEA-14)
const CB_COLORS={"AMEX Rose Gold":"#E07A5F","Chase United":"#4A6FA5","Chase Sapphire":"#3D405B","Aeroplan":"#D4A373","Bilt":"#81B29A","Capital One":"#CB997E","Rakuten":"#F2CC8F","Uber":"#9B8EA0","Venmo Credit":"#6B9AC4","AMEX":"#264653","Chase Aeroplan":"#5B8DB8","TD Visa":"#8B687F","Scotiabank":"#E9C46A","Apple":"#7FB3D8","Flying Blue":"#52556E","Venmo":"#A8DADC"};
const CB_FEES={"AMEX Rose Gold":1075,"Chase Sapphire":985,"Chase United":345,"Chase Aeroplan":190,"Capital One":95,"AMEX":90};
const CB_PTS_BAL={"Aeroplan":140992,"AMEX Rose Gold":123884,"Bilt":49752,"Chase Sapphire":8507};
const CATS_LIST=[{id:"entertainment",l:"Entertainment (other)"},{id:"accommodation",l:"Accommodation"},{id:"games",l:"Games"},{id:"food",l:"Food (other)"},{id:"groceries",l:"Groceries"},{id:"restaurant",l:"Restaurant"},{id:"home",l:"Home (other)"},{id:"rent",l:"Rent"},{id:"furniture",l:"Furniture"},{id:"health",l:"Health"},{id:"personal",l:"Personal (other)"},{id:"clothes",l:"Clothes"},{id:"tech",l:"Tech"},{id:"transportation",l:"Transportation"},{id:"utilities",l:"Utilities"},{id:"financial",l:"Financial"},{id:"other",l:"Other"},{id:"income",l:"Income"},{id:"investment",l:"Investment"},{id:"adjustment",l:"Adjustment"}];
const PTS=["AMEX","AMEX Chequing","AMEX Rose Gold","AMEX US","Air Canada","Amazon","Apple","Bilt","Capital One","Cash","Charles Schwab","Chase Aeroplan","Chase Chequing","Chase Freedom","Chase Sapphire","Chase Savings","Chase United","Clipper","First Republic","HSA Invest","Home Trust","Kraken","Poker Stars","Presto","Rakuten","Splitwise","TD Chequing","TD Debit","TD Savings","TD TFSA","TD Visa","Transfer","Uber","Vanguard","Venmo","Venmo Credit","WageWorks","Walmart","Wealthsimple","eTrade","eTrade IRA"];
const CURS=["USD","CAD","EUR","GBP","JPY","MXN","INR","TND","CZK","TRY"];
const DFX={USD:1,CAD:0.73,EUR:1.08,GBP:1.26,JPY:0.0067,CZK:0.043,TRY:0.031,MXN:0.058,TND:0.32,INR:0.012};
async function fetchLiveFX(){
  try{
    const r=await fetch("https://api.frankfurter.dev/latest?from=USD");
    if(!r.ok)return;
    const d=await r.json();
    for(const[cur,rate]of Object.entries(d.rates)){if(DFX[cur]!==undefined&&rate>0)DFX[cur]=Math.round(1/rate*1e6)/1e6}
    DFX._live=d.date;
  }catch(e){/* silent fallback to defaults */}
}
const ACCRUAL_D={groceries:7,clothes:365,tech:730,furniture:730,rent:"month",utilities:"month"};
const BANK_PROFILES={chase:{detect:hd=>hd.includes("Transaction Date")&&hd.includes("Post Date")&&hd.includes("Memo"),columns:{date:"Transaction Date",description:"Description",amount:"Amount",bankCategory:"Category",type:"Type"},transformAmount:a=>-a,skipTypes:[],currency:"USD"},chase_checking:{detect:hd=>hd.includes("Posting Date")&&hd.includes("Details")&&hd.includes("Balance"),columns:{date:"Posting Date",description:"Description",amount:"Amount",bankCategory:"_none_",type:"Type"},transformAmount:a=>Math.abs(a),skipTypes:[],currency:"USD",isCheckingAccount:true,detectBillPay:row=>{const d=row.Description||"",t=row.Type||"";if(t==="LOAN_PMT")return"Chase Card Payment";if(/CHASE CREDIT CRD AUTOPAY/i.test(d))return"Chase Card Autopay";if(/AMERICAN EXPRESS ACH PMT/i.test(d))return"AMEX Payment";if(/APPLECARD GSBANK/i.test(d))return"Apple Card Payment";if(/WF Credit Card.*AUTO PAY/i.test(d))return"Capital One Payment";if(/WELLS FARGO CARD B(ILT|PP)/i.test(d))return"Bilt Card Payment";return null},detectPayroll:row=>/PINTEREST.*PAYROLL|ORIG CO NAME:PINTEREST/i.test(row.Description||"")},amex:{detect:hd=>hd.includes("Date")&&hd.includes("Description")&&hd.includes("Amount")&&(hd.includes("Category")||hd.includes("Extended Details")),columns:{date:"Date",description:"Description",amount:"Amount",bankCategory:"Category",type:"_none_"},transformAmount:a=>a,skipTypes:[],currency:"USD",detectPayment:row=>/^AUTOPAY|^ONLINE PAYMENT/i.test(row.Description||""),detectCredit:row=>/AMEX.*Credit/i.test(row.Description||"")},bilt:{detect:hd=>hd.includes("Transaction Date")&&hd.includes("Posted Date")&&!hd.includes("Memo")&&!hd.includes("Post Date"),columns:{date:"Transaction Date",description:"Description",amount:"Amount",bankCategory:"_none_",type:"_none_"},transformAmount:a=>a,skipTypes:[],currency:"USD",detectPayment:row=>/payment/i.test(row.Description||"")},bilt_legacy:{detect:hd=>hd.some(h=>/^\d{2}\/\d{2}\/\d{4}$/.test(h))&&hd.includes("*"),reparse:text=>parseCSV("Date,Amount,Flag,Empty,Description\n"+text),columns:{date:"Date",description:"Description",amount:"Amount",bankCategory:"_none_",type:"_none_"},transformAmount:a=>-a,skipTypes:[],currency:"USD",detectPayment:row=>/AUTOMATIC PAYMENT/i.test(row.Description||"")}};
const PAYSLIP_PROFILES={pinterest:{detect:t=>t.includes("Pinterest, Inc.")&&t.includes("Pay Period Begin"),company:"Pinterest",incomeItems:["Regular Salary Pay","Connectivity Reimbursement","GTL","Wellness Reimbursement","Home Office Setup Stipend","Sign on Bonus"],rsuIndicators:["RSU Gain"],postTaxExclude:["401(k) After-tax Deferral","RSU Gain Offset"],benefitEarnings:["GTL"]}};
const CC_PAY_NAMES={"Chase Sapphire":["Bill Paid: Chase Sapphire","Chase Sapphire Bill Payment"],"Chase United":["Bill Paid: Chase United","Chase United Bill Payment"],"Chase Freedom":["Bill Paid: Chase Freedom","Chase Freedom Bill Payment"],"Chase Aeroplan":["Bill Paid: Chase Aeroplan","Chase Aeroplan Bill Payment"],"AMEX Rose Gold":["Bill Paid: AMEX Rose Gold","Amex Rose Gold Bill Payment"],"Bilt":["Bill Paid: Bilt","Bilt Card Payment"],"Apple":["Bill Paid: Apple","Apple Bill Payment"],"Venmo Credit":["Bill Paid: Venmo","Venmo Bill Payment"],"Capital One":["Bill Paid: Capital One","Capital One Bill Payment"],"Uber":["Bill Paid: Uber","Uber Bill Payment"]};
const CHASE_CAT_MAP={"Food & Drink":"restaurant","Groceries":"groceries","Travel":"transportation","Entertainment":"entertainment","Shopping":"personal","Bills & Utilities":"utilities","Health & Wellness":"health","Home":"home","Gas":"transportation","Personal":"personal"};
const AMEX_CAT_MAP={"Restaurant-Restaurant":"restaurant","Restaurant-Bar & Café":"restaurant","Merchandise & Supplies-Groceries":"groceries","Merchandise & Supplies-Department Stores":"personal","Merchandise & Supplies-Mail Order":"personal","Merchandise & Supplies-Internet Purchase":"personal","Transportation-Fuel":"transportation","Transportation-Taxis & Coach":"transportation","Transportation-Transit":"transportation","Transportation-Parking":"transportation","Transportation-Other":"transportation","Entertainment-General Attractions":"entertainment","Entertainment-Ticketing":"entertainment","Travel-Airline":"transportation","Travel-Lodging":"accommodation","Travel-Other":"transportation","Business Services-Health Care":"health","Fees & Adjustments-Fees & Adjustments":"financial","Communications-Cable & Internet":"utilities","Communications-Telephone":"utilities"};
const SPLIT_PRESETS=[{label:"50%",value:0.5},{label:"33%",value:1/3},{label:"25%",value:0.25},{label:"Custom",value:null},{label:"Manual",value:"manual"}];
const PF_ACM={us_equity:{label:"US Equity",color:"#4A6FA5",target:70},intl_equity:{label:"International",color:"#81B29A",target:10},crypto:{label:"Crypto",color:"#E07A5F",target:5},balanced:{label:"Balanced",color:"#F2CC8F",target:5},money_market:{label:"Money Market",color:"#6B9AC4",target:5},target_date:{label:"Target Date",color:"#9B8EA0",target:5}};
const PF_ATL={retirement_401k:"401(k)",retirement_ira:"IRA",brokerage:"Brokerage",tax_free:"Tax-Free",hsa:"HSA",rsu:"RSU",crypto:"Crypto"};
const PF_ACCT_ANN_OVERRIDE={schwab_401k:7.3,vanguard_401k:null};

