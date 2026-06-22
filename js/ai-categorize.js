async function aiGroupLabels(groups){
  if(!aiAvailable())return{};
  const result={};
  const uncached=groups.filter(g=>{const c=sessionStorage.getItem(`grp_label_${g.gid}`);if(c){result[g.gid]=c;return false}return true});
  if(!uncached.length)return result;
  // Fetch past manual corrections as few-shot examples (cached per session)
  let examples="";
  try{
    let exCache=sessionStorage.getItem("grp_label_examples");
    if(!exCache){
      const ovs=await sb("group_overrides?label=not.is.null&order=updated_at.desc&limit=10&select=group_id,label");
      if(ovs.length){
        const exGids=ovs.map(o=>o.group_id);
        const exTxns=await sb(`transactions?transaction_group_id=in.(${exGids.join(",")})&select=transaction_group_id,description,amount_usd,date&order=date`);
        const exGroups={};exTxns.forEach(t=>{const g=t.transaction_group_id;if(!exGroups[g])exGroups[g]=[];exGroups[g].push(t)});
        const lines=ovs.filter(o=>exGroups[o.group_id]?.length).map(o=>`${exGroups[o.group_id].map(t=>`${t.description} ($${t.amount_usd})`).join("; ")} => "${o.label}"`);
        exCache=lines.join("\n");
        sessionStorage.setItem("grp_label_examples",exCache);
      }else{exCache="";sessionStorage.setItem("grp_label_examples","")}
    }
    if(exCache)examples=`\n\nHere are examples of preferred labels from past corrections:\n${exCache}\n`;
  }catch(e){console.warn("Failed to fetch label examples:",e)}
  const prompt=`Generate short summary labels (under 40 chars) for these transaction groups. Examples: "Whole Foods x6", "Pinterest Payroll Jan 15-31", "Japan Trip Restaurants x4", "Rent + Utilities Feb".${examples}\n\nGroups:\n${uncached.map(g=>`Group ${g.gid}: ${g.members.map(m=>`${m.description} ($${m.amount_usd}, ${m.date})`).join("; ")}`).join("\n")}\n\nReturn ONLY a JSON object mapping group ID to label string.`;
  try{
    const r=await callClaude({model:getAIModel(),max_tokens:1000,messages:[{role:"user",content:prompt}]});
    if(!r.ok)return result;
    const data=await r.json();const txt=data.content?.[0]?.text||"";
    const m=txt.match(/\{[\s\S]*\}/);if(!m)return result;
    const labels=JSON.parse(m[0]);
    for(const[gid,label]of Object.entries(labels)){sessionStorage.setItem(`grp_label_${gid}`,label);result[gid]=label}
    return result;
  }catch(e){console.warn("AI group labels failed:",e);return result}
}

async function fetchAIRules(){
  try{
    let rows=await sb("ai_rules?is_active=eq.true&order=created_at.asc"+importerQS());
    // Inherit household rules until this user has defined their own.
    if((!rows||!rows.length)&&currentHousehold!=null){
      rows=await sb(`ai_rules?is_active=eq.true&order=created_at.asc&household_id=eq.${currentHousehold}`);
    }
    return rows||[];
  }catch(e){console.warn("fetchAIRules failed:",e);return[]}
}

async function fetchMerchantPatterns(){
  // Scope to the importing user so the parser learns from their own history.
  // Fall back to the original RPC if the scoped variant is not deployed yet.
  let rows;
  if(currentOwner!=null){
    try{rows=await sbRPC("get_merchant_patterns_scoped",{p_owner:currentOwner,p_household_id:currentHousehold})}
    catch(e){console.warn("get_merchant_patterns_scoped unavailable, using unscoped:",e);rows=await sbRPC("get_merchant_patterns")}
    // A new household member has no patterns yet — inherit the household's
    // (i.e. the established user's) formatting so onboarding imports are clean.
    if((!rows||rows.length<5)&&currentHousehold!=null){
      try{const hh=await sbRPC("get_merchant_patterns_scoped",{p_owner:null,p_household_id:currentHousehold});if(hh&&hh.length>(rows?.length||0))rows=hh}catch(e){}
    }
  }else{
    rows=await sbRPC("get_merchant_patterns");
  }
  const patterns={};
  for(const r of (rows||[])){const k=normalizeMerchant(r.description);if(!patterns[k])patterns[k]={};patterns[k][r.category_id]=(patterns[k][r.category_id]||0)+Number(r.count)}
  return patterns;
}

async function fetchSampleDescriptions(){
  let recent=await sb("transactions?select=description&order=id.desc&limit=200"+importerQS());
  // Inherit household style examples when this user has little/no history.
  if((!recent||recent.length<10)&&currentHousehold!=null){
    const hh=await sb(`transactions?select=description&order=id.desc&limit=200&household_id=eq.${currentHousehold}`);
    if(hh&&hh.length>(recent?.length||0))recent=hh;
  }
  return[...new Set((recent||[]).map(r=>r.description))].slice(0,50);
}

async function fetchSubscriptions(){
  try{return await scopedRPC("detect_subscriptions")}
  catch(e){console.warn("Subscription detection failed:",e);return[]}
}

async function aiCategorize(candidates,merchantPatterns,sampleDescriptions,isCheckingAccount,profileName,detectedSubs,aiRules,onProgress){
  if(!aiAvailable())return null;
  const promptFor=(items)=>`You are a personal finance assistant that categorizes AND cleans up transaction descriptions for a detailed expense tracker.

CATEGORY TAXONOMY (use exact IDs):
- entertainment: Entertainment (concerts, movies, events, activities, sports — NOT accommodation or games)
- accommodation: Accommodation (hotels, Airbnb, hostels, lodging)
- games: Games (board games, video games, gaming, Steam, poker buy-ins)
- food: Food - use only when not clearly groceries or restaurant
- groceries: Groceries (grocery stores, supermarkets)
- restaurant: Restaurant (dining out, bars, cafes, food delivery)
- home: Home - general household
- rent: Rent
- furniture: Furniture (furnishings, home goods)
- health: Health (pharmacy, medical, fitness, wellness)
- personal: Personal - general personal items
- clothes: Clothes (apparel, shoes)
- tech: Tech (electronics, software, subscriptions, apps)
- transportation: Transportation (flights, trains, rideshare, gas, tolls, parking)
- utilities: Utilities (phone, internet, laundry)
- financial: Financial (fees, interest)
- other: Other (gifts, misc)
- income: Income (refunds, reimbursements, credits — ONLY if amount is negative/credit)

DESCRIPTION STYLE GUIDE:
The user writes clean, human-readable descriptions. Study these real examples to learn the style:
- "Restaurant - La Choza" (not "REST LA CHOZA")
- "Groceries - Whole Foods" (not "WHOLE FOODS MARKET #123")
- "Walgreens" (not "WALGREENS #16373")
- "Waymo" (not "WAYMO")
- "United Flights - SFO-CZM" (not "UNITED 0162374132542")
- "Amazon - [item description]" (not "AMAZON MKTPL*UY16L7LN3")
- "Claude AI Subscription (Feb 2026)" (not "CLAUDE.AI SUBSCRIPTION")
- "MTA Meter Parking" (not "TCB*MTA METER MTA P")
- "Groceries - Gus's Community Market" (not "GUS'S COMMUNITY MARKET")
- "Groceries - Jagalchi" (not "JAGALCHI")
- "Restaurant - Money Bar" (not "MONEY BAR")
- "Restaurant - Morella" (not "MORELLA")

Key patterns:
- Prefix with "Restaurant - " for dining. Prefix with "Groceries - " for grocery stores.
- Prefix with "Flight - " or "United Flights - " for airline charges, include route if identifiable.
- Prefix with "Amazon - " for Amazon purchases; add context from description if possible.
- For subscriptions, utilities, gym memberships, and any monthly recurring charge, append the month/year in parentheses: "Claude AI Subscription (Feb 2026)", "Trainability Gym (Jan 2026)", "PG&E Electric (Mar 2026)", "Xfinity Internet (Mar 2026)". Derive the month from the transaction date.
- Strip store numbers, transaction codes, prefixes like "SQ *", "TST*", "CLIP MX*", "TCB*"
- Use Title Case for merchant names
- Keep it concise but descriptive — the user should be able to remember what this was

HISTORICAL MERCHANT PATTERNS (merchant -> {category: count}):
${JSON.stringify(merchantPatterns)}

SAMPLE OF USER'S EXISTING DESCRIPTIONS (for style reference):
${JSON.stringify(sampleDescriptions)}
${detectedSubs&&detectedSubs.length?`
DETECTED RECURRING SUBSCRIPTIONS (from historical analysis):
${JSON.stringify(detectedSubs.map(s=>({merchant:s.merchant,amount:s.typical_amount,category:s.category_id,payment:s.payment_type})))}

When a candidate matches a detected subscription merchant:
1. Use the historical category
2. Append month/year: "Merchant Name (Mar 2026)"
3. Set conf: "high" since this is a known recurring charge
`:""}
${aiRules&&aiRules.length?`USER-DEFINED RULES (these override all other signals — highest priority):
${aiRules.map(r=>r.rule_text).join("\n")}
`:""}TRANSACTIONS TO CATEGORIZE AND CLEAN:
${JSON.stringify(items)}

For each transaction, return a JSON array of objects:
[{"i": <index>, "cat": "<category_id>", "conf": "high|medium|low", "desc": "<cleaned description>"}]

Rules:
- "desc" must be a clean, human-readable description matching the style guide above
- Use historical patterns when available and clear (one dominant category >70%)
- Use bank category as a secondary signal but don't trust it blindly
- "Shopping" from Chase is ambiguous — look at the merchant name and amount
- Subscriptions (CLAUDE.AI, software) -> tech
- Amazon -> personal unless description suggests otherwise
- Negative amounts (credits/refunds) that clearly offset an expense -> same category as the expense, NOT income
- Positive amounts that are clearly income (paycheck, reimbursement) -> income
- confidence: high = historical match or obvious merchant, medium = reasonable guess from bank category + description, low = ambiguous
${isCheckingAccount?`
CHECKING ACCOUNT CONTEXT:
These are from a Chase checking account (mixed debits/credits). No bank category available — categorize entirely from description.
- Zelle payments TO someone: "personal" (person-to-person transfer). Desc: "Zelle to [Name]"
- Zelle payments FROM someone: "income". Desc: "Zelle from [Name]"
- Venmo payments/cashouts: "personal". Desc: "Venmo Payment" or "Venmo Cashout"
- ATM withdrawals: "financial". Desc: "ATM Withdrawal"
- PGANDE / PG&E: "utilities". Desc: "PG&E"
- IRS USATAXPYMT: "financial". Desc: "IRS Tax Payment"
- CA DMV: "financial". Desc: "CA DMV"
- Wise transfers: "financial". Desc: "Wise Transfer"
- SPLITWISE PAYMENT: "personal". Desc: "Splitwise Payment"
- PayPal TRANSFER: "income". Desc: "PayPal Transfer"
- Google/Pinterest PAYROLL: "income". Desc: "Google Payroll" or "Pinterest Payroll"
- FRANCHISE TAX BD CASTTAXRFD: "income". Desc: "CA State Tax Refund"
- HEALTHEQUITY: "income". Desc: "HSA Reimbursement"
- COSTCO debit card purchases: "groceries". Desc: "Groceries - Costco"
- BILLPAY to specific vendors: categorize by vendor (e.g. Ashley Bond -> personal)
- Credit returns (MISC_CREDIT): categorize by what the credit is for
- Debit card purchases: categorize by merchant name`:""}
${profileName==="bilt"||profileName==="bilt_legacy"?`
BILT CREDIT CARD CONTEXT:
These are from a Bilt credit card. Descriptions may be ALL CAPS (legacy format). Key merchant mappings based on user's history:
- SPOTIFY / Spotify: "utilities". Desc: "Spotify Premium"
- LEMONADE / Lemonade Insurance: "utilities" (pet insurance). Desc: "Lemonade Pet Insurance"
- TRAINABILITY / gym: "health". Desc: "Trainability Gym"
- ADOBE / Adobe Creative Cloud: "utilities". Desc: "Adobe Creative Cloud"
- GOOGLE ONE / Google storage: "utilities". Desc: "Google One"
- FURBO / pet camera: "utilities". Desc: "Furbo Pet Camera"
- TOMKINS TIMES: "utilities". Desc: "Tomkins Times"
- XFINITY / Comcast: "utilities". Desc: "Xfinity Internet"
- Lyft / LYFT: "transportation". Desc: "Lyft"
- AMC / movie theater: "entertainment". Desc: "AMC Movies"
- STEAM / Steam games: "entertainment". Desc: "Steam"
- PETCO / pet supplies: "other". Desc: "Petco"
- Parking / meter: "transportation". Desc: "Parking" or "MTA Meter Parking"
- AUTOMATIC PAYMENT rows are bill payments -> skip (handled separately)
Description style: "Restaurant - Name", "Groceries - Store", "Clothes - Store", "Tech - Item"
Subscriptions: include month/year like "Spotify Premium (Mar 2026)"`:""}
Return ONLY the JSON array, no other text.`;
  // Batch so large imports don't blow the model's output budget. Chase caps CSV
  // downloads at ~1000 rows and an onboard can span several files; ~1,500 rows
  // can never fit in one response, which silently truncated the JSON and failed
  // the whole import. 40 rows/call, 4 calls in parallel, results merged by index.
  const all=candidates.map((c,i)=>({index:i,description:c._rawDescription,amount:c.amount_usd,bankCategory:c._bankCategory}));
  const BATCH=40,CONC=4;
  const batches=[];for(let i=0;i<all.length;i+=BATCH)batches.push(all.slice(i,i+BATCH));
  const out=[];let anyOk=false,authFail=false,done=0;
  for(let i=0;i<batches.length;i+=CONC){
    const group=batches.slice(i,i+CONC);
    const settled=await Promise.all(group.map(async b=>{
      try{
        const r=await callClaude({model:getAIModel(),max_tokens:8000,messages:[{role:"user",content:promptFor(b)}]});
        if(r.status===401){authFail=true;return null}
        if(!r.ok){console.warn(`aiCategorize batch ${r.status}:`,await r.text());return null}
        const data=await r.json();const txt=data.content?.[0]?.text||"";
        const m=txt.match(/\[[\s\S]*\]/);if(!m)return null;
        return JSON.parse(m[0]);
      }catch(e){console.error("aiCategorize batch failed:",e);return null}
    }));
    for(const arr of settled){done++;if(Array.isArray(arr)){anyOk=true;out.push(...arr)}}
    if(onProgress)onProgress(Math.min(done*BATCH,all.length),all.length);
  }
  if(authFail&&getApiKey())clearApiKey();
  return anyOk?out:null;
}

