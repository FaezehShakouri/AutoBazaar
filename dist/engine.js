import {SALES_MODEL,validateSalesModel,dateForDay,weatherForDay,simulateSales} from './sales-model.js';
// Shared deterministic engine: browser demo and authoritative local runner.
export const PRODUCTS = [
  {id:'water',name:'Spring water',icon:'💧',cost:45,retail:150,category:'drink'},
  {id:'cola',name:'Cola',icon:'🥤',cost:70,retail:200,category:'drink'},
  {id:'coffee',name:'Cold brew',icon:'☕',cost:120,retail:320,category:'drink'},
  {id:'chips',name:'Sea salt chips',icon:'🥔',cost:65,retail:180,category:'snack'},
  {id:'bar',name:'Protein bar',icon:'🍫',cost:105,retail:280,category:'snack'},
  {id:'nuts',name:'Trail mix',icon:'🥜',cost:90,retail:250,category:'snack'},
];
export const SUPPLIERS = [
  {id:'express',name:'Metro Express',multiplier:1.15,lead:1,delay:0.02},
  {id:'wholesale',name:'Bay Wholesale',multiplier:1,lead:2,delay:0.08},
  {id:'budget',name:'Budget Depot',multiplier:0.82,lead:4,delay:0.22},
];
export const PERSONALITIES = [
  {id:'atlas',name:'Atlas',color:'#b1ed75',strategy:'Adaptive',brief:'Develop your own strategy. Test prices, study sales, adapt to competitors and preserve liquidity.'},
  {id:'penny',name:'Penny',color:'#b9a0fb',strategy:'Volume',brief:'Your starting hypothesis is affordable prices and high volume. You may change strategy as evidence develops.'},
  {id:'nova',name:'Nova',color:'#f7ba78',strategy:'Premium',brief:'Your starting hypothesis is premium margins and reliable availability. You may change strategy as evidence develops.'},
  {id:'sage',name:'Sage',color:'#89cbe9',strategy:'Conservative',brief:'Your starting hypothesis is disciplined cash reserves and steady replenishment. You may change strategy as evidence develops.'},
];
export const REQUIRED_AGENTS = 4;
export const REGISTRATION_STAKE = 50000;
export const STARTING_CASH = 50000;
const quantities = (n=0) => Object.fromEntries(PRODUCTS.map(p=>[p.id,n]));
export const money = cents => (cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
export function createGame({seed=42,mode='demo',startDate='2025-01-01',salesModel=SALES_MODEL,registrationStake=REGISTRATION_STAKE,startingCash=STARTING_CASH}={}) {
  if(!Number.isInteger(seed)||seed<0||seed>4294967295) throw new Error('Seed must be an unsigned 32-bit integer.');
  if(!Number.isInteger(registrationStake)||registrationStake<REGISTRATION_STAKE) throw new Error('Registration stake must be at least $500.');
  if(!Number.isInteger(startingCash)||startingCash<STARTING_CASH) throw new Error('Starting cash must be at least $500.');
  const calendar=dateForDay(startDate,0);
  validateSalesModel(salesModel,PRODUCTS);
  return {version:4,round:1,requiredAgents:REQUIRED_AGENTS,registrationStake,startingCash,seed,rng:seed||1,day:0,mode,startDate,calendar,salesModel:structuredClone(salesModel),salesReport:[],customerTransactions:[],transactionHistory:[],daySituation:null,phase:'lobby',finishReason:null,weather:'Mild',unitsSoldToday:0,customerBudgetTotal:0,customerBudgetRemaining:0,customerBudgetSpent:0,closingAdjustment:0,agents:PERSONALITIES.map(a=>({...a,registered:false,registrationPaid:0,entryBalance:0,cash:0,inventory:quantities(),storage:quantities(),prices:Object.fromEntries(PRODUCTS.map(p=>[p.id,p.retail])),orders:[],revenue:0,spending:0,fees:0,refunds:0,sold:0,missedFees:0,arrears:0,active:false,memory:'',rationale:'Waiting to register for the round.',lastSales:quantities(),lastRevenue:0})),history:[],log:[],nextLogId:1};
}
function random(s){s.rng=(Math.imul(1664525,s.rng)+1013904223)>>>0;return s.rng/4294967296;}
function log(s,agent,type,text){s.log.push({id:s.nextLogId++,day:s.day,agent,type,text});}
export function registerAgent(state,id){
  const s=structuredClone(state);
  if(s.phase!=='lobby')throw new Error('Registration is closed for this round.');
  const agent=s.agents.find(a=>a.id===id);if(!agent)throw new Error('Unknown agent slot.');
  if(agent.registered)throw new Error(`${agent.name} is already registered.`);
  agent.registered=true;agent.active=true;agent.registrationPaid=s.registrationStake;agent.entryBalance=s.startingCash;agent.cash=s.startingCash;agent.rationale=`Paid ${money(s.registrationStake)} to register and received ${money(s.startingCash)} operating cash.`;
  s.customerBudgetTotal+=s.registrationStake;s.customerBudgetRemaining+=s.registrationStake;
  log(s,id,'registration',`${agent.name} paid a ${money(s.registrationStake)} registration stake into the customer wallet and starts with ${money(s.startingCash)} operating cash.`);
  return s;
}
export function startRound(state){
  const s=structuredClone(state);
  if(s.phase!=='lobby')throw new Error('The round cannot be started from its current phase.');
  if(s.agents.filter(a=>a.registered).length!==s.requiredAgents)throw new Error(`Waiting for ${s.requiredAgents-s.agents.filter(a=>a.registered).length} more agents.`);
  s.phase='ready';s.history=[{day:0,cash:s.agents.map(a=>a.cash),customerBudget:s.customerBudgetRemaining}];
  log(s,null,'round',`Round ${s.round} started with ${money(s.customerBudgetTotal)} in the customer wallet.`);
  return s;
}
export function quote(product,supplier,quantity){return Math.round(product.cost*supplier.multiplier*(quantity>=24?0.92:1));}
export function prepareDay(state){
  const s=structuredClone(state);
  if(s.phase==='finished') return s;
  if(s.phase!=='ready') throw new Error(s.phase==='lobby'?'Wait for all agents and start the round first.':'This day is already prepared.');
  s.day++;s.phase='deciding';
  if(s.version!==4)throw new Error('Start a new round to use the updated game rules.');
  s.calendar=dateForDay(s.startDate,s.day);
  s.weather=weatherForDay(s.seed,s.calendar.date,s.salesModel);
  s.unitsSoldToday=0;s.salesReport=[];s.customerTransactions=[];
  const weekday=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][s.calendar.weekday];
  const traffic=s.salesModel.calibration.weekdays[s.calendar.weekday];
  s.daySituation={date:s.calendar.date,weekday,weather:s.weather,trafficMultiplier:traffic,seasonMultiplier:s.salesModel.calibration.months[s.calendar.month],headline:`${weekday} · ${s.weather} weather · ${traffic>=1.1?'busy':traffic<1?'quiet':'normal'} expected foot traffic`,weatherEffect:s.weather==='Hot'?'Customers favor drinks in the heat.':s.weather==='Rainy'?'Rain reduces demand across drinks and snacks.':'Mild weather leaves product demand unchanged.'};
  log(s,null,'situation',s.daySituation.headline);
  for(const a of s.agents){
    if(!a.active)continue;
    a.previousSales={...a.lastSales};a.previousRevenue=a.lastRevenue;
    a.lastSales=quantities();a.lastRevenue=0;
    for(const o of a.orders.filter(o=>o.arrives<=s.day)){a.storage[o.product]+=o.quantity;log(s,a.id,'delivery',`${o.quantity} ${PRODUCTS.find(p=>p.id===o.product).name} arrived in storage.`);}
    a.orders=a.orders.filter(o=>o.arrives>s.day);
  }
  return s;
}
export function observation(s,id){
  const self=s.agents.find(a=>a.id===id);if(!self)throw new Error('Unknown agent');
  return structuredClone({round:s.round,day:s.day,weather:s.weather,date:s.calendar.date,daySituation:s.daySituation,customerBudget:{total:s.customerBudgetTotal,remaining:s.customerBudgetRemaining,spent:s.customerBudgetSpent},self,products:PRODUCTS,suppliers:SUPPLIERS,competitors:s.agents.filter(a=>a.id!==id).map(a=>({id:a.id,name:a.name,prices:a.prices,active:a.active})),recentEvents:s.log.filter(e=>e.agent===id||e.agent===null).slice(-35),rules:{currency:'integer USD cents',registrationStake:s.registrationStake,startingCash:s.startingCash,dailyFee:200,capacityPerProduct:30,storageAndTransitPerProduct:240,maxOrdersPerDay:12,score:'Highest bank cash when the shared customer budget reaches zero; stock has no liquidation value',settlement:'Each agent pays a registration stake into the shared customer wallet and separately receives starting operating cash. Orders are paid immediately. Deliveries enter storage before decisions; load them explicitly. Sales drain the customer wallet and settle automatically. The final sale may be paid with the exact remaining wallet balance. Ten consecutive unpaid daily fees eliminates a machine. Arrears are settled before new fees. No debt or real purchases.',customerChoice:'Daily product demand uses price elasticity against a reference price, baseline sales, weekday, month, weather, assortment variety, noise and inventory caps. Competing machines share per-product demand weighted by their standalone expected sales. This follows the public paper structure with local calibration and a local Arena allocation rule.'}});
}
export function validateDecision(d){
  if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Decision must be an object.');
  if(typeof d.rationale!=='string'||d.rationale.length>2000||typeof d.memory!=='string'||d.memory.length>6000)throw new Error('Invalid rationale or memory.');
  for(const key of ['prices','load']){
    if(!d[key]||typeof d[key]!=='object'||Array.isArray(d[key]))throw new Error(`Missing ${key}.`);
    for(const [id,value] of Object.entries(d[key])){
      if(!PRODUCTS.some(p=>p.id===id)||!Number.isInteger(value)||value<(key==='prices'?25:0)||value>(key==='prices'?2000:30))throw new Error(`Invalid ${key}: ${id}`);
    }
  }
  if(!Array.isArray(d.orders)||d.orders.length>12)throw new Error('Invalid orders.');
  for(const o of d.orders){if(!o||!PRODUCTS.some(p=>p.id===o.product)||!SUPPLIERS.some(p=>p.id===o.supplier)||!Number.isInteger(o.quantity)||o.quantity<1||o.quantity>120)throw new Error('Invalid order.');}
  return d;
}
export function settleDay(state,decisions){
  if(state.phase!=='deciding')throw new Error('Prepare the day before settling.');
  const s=structuredClone(state);
  // All agents decide from the same pre-action snapshot; arrival randomness is independent of execution timing.
  for(const a of s.agents){
    if(!a.active)continue;
    let d;try{d=validateDecision(decisions[a.id]);}catch(e){log(s,a.id,'error',`No action: ${e.message}`);continue;}
    Object.assign(a.prices,d.prices);a.rationale=d.rationale;a.memory=d.memory;
    log(s,a.id,'decision',d.rationale);
    if(Object.keys(d.prices).length)log(s,a.id,'pricing',`Updated ${Object.keys(d.prices).length} price${Object.keys(d.prices).length===1?'':'s'}: ${Object.entries(d.prices).map(([id,price])=>`${PRODUCTS.find(p=>p.id===id).name} ${money(price)}`).join(', ')}.`);
    for(const [id,n] of Object.entries(d.load)){const moved=Math.min(n,a.storage[id],30-a.inventory[id]);a.storage[id]-=moved;a.inventory[id]+=moved;if(moved)log(s,a.id,'restock',`Loaded ${moved} ${PRODUCTS.find(p=>p.id===id).name} into the machine.`);}
    for(const o of d.orders){
      const p=PRODUCTS.find(p=>p.id===o.product),supplier=SUPPLIERS.find(x=>x.id===o.supplier);
      const total=quote(p,supplier,o.quantity)*o.quantity;
      const held=a.storage[p.id]+a.inventory[p.id]+a.orders.filter(x=>x.product===p.id).reduce((n,x)=>n+x.quantity,0);
      if(total>a.cash||held+o.quantity>240){log(s,a.id,'rejected',`Order rejected: ${total>a.cash?'insufficient cash':'stock limit'}.`);continue;}
      a.cash-=total;a.spending+=total;
      const delayed=random(s)<supplier.delay;const arrives=s.day+supplier.lead+(delayed?2:0);
      a.orders.push({...o,arrives,total});log(s,a.id,'order',`Ordered ${o.quantity} ${p.name} for ${money(total)} · day ${arrives}${delayed?' (delayed)':''}.`);
    }
  }
  const sales=simulateSales({agents:s.agents,products:PRODUCTS,calendar:s.calendar,weather:s.weather,seed:s.seed,model:s.salesModel,budget:s.customerBudgetRemaining});
  s.salesReport=sales.reports;s.customerTransactions=sales.transactions.map(transaction=>({...transaction,day:s.day,date:s.calendar.date}));s.transactionHistory.push(...s.customerTransactions);
  for(const a of s.agents){
    for(const p of PRODUCTS){
      const units=sales.sold[a.id][p.id],revenue=sales.payments[a.id][p.id];
      a.inventory[p.id]-=units;a.sold+=units;a.lastSales[p.id]=units;
      a.cash+=revenue;a.revenue+=revenue;a.lastRevenue+=revenue;s.unitsSoldToday+=units;
    }
  }
  s.customerBudgetRemaining=sales.budgetRemaining;s.customerBudgetSpent+=sales.spent;s.closingAdjustment+=sales.closingAdjustment;
  for(const report of sales.reports){
    const product=PRODUCTS.find(p=>p.id===report.product);
    const allocations=report.machines.filter(m=>m.sold).map(m=>`${s.agents.find(a=>a.id===m.id).name} ${m.sold}`).join(', ');
    log(s,null,'customers',`${product.name}: ${report.demand} wanted, ${report.sold} bought${report.unserved?`, ${report.unserved} unserved`:''}${allocations?` · ${allocations}`:''}.`);
  }
  for(const a of s.agents){
    if(!a.active)continue;
    const due=200+a.arrears;
    if(a.cash>=due){a.cash-=due;a.fees+=due;a.arrears=0;a.missedFees=0;log(s,a.id,'fee',`${money(due)} operating fee paid.`);}else{a.arrears+=200;a.missedFees++;log(s,a.id,'warning',`Operating fee unpaid (${a.missedFees}/10 days).`);}
    if(a.missedFees>=10){a.active=false;log(s,a.id,'bankrupt','Machine closed after 10 consecutive unpaid fees.');}
    log(s,a.id,'sales',`${Object.values(a.lastSales).reduce((n,x)=>n+x,0)} items sold · ${money(a.lastRevenue)} revenue.`);
  }
  s.history.push({day:s.day,cash:s.agents.map(a=>a.cash),customerBudget:s.customerBudgetRemaining});
  if(s.customerBudgetRemaining===0){s.phase='finished';s.finishReason='customer_budget_exhausted';log(s,null,'round',`Customer wallet exhausted. Round ${s.round} is complete.`);}
  else if(s.agents.every(a=>!a.active)){s.phase='finished';s.finishReason='all_agents_closed';log(s,null,'round',`All machines closed with ${money(s.customerBudgetRemaining)} left in the customer wallet.`);}
  else s.phase='ready';
  return s;
}
export function demoDecision(s,id){
  const a=s.agents.find(x=>x.id===id),prices={},load={},orders=[];
  const factor={atlas:1.02,penny:.82,nova:1.28,sage:1.08}[id];
  const supplier=SUPPLIERS.find(x=>x.id===(id==='penny'?'budget':id==='nova'?'express':'wholesale'));
  let budget=Math.max(0,a.cash-(id==='sage'?12000:2500));
  for(const p of PRODUCTS){
    const heat=s.weather==='Hot'&&p.category==='drink'?1.1:1;
    const competitors=s.agents.filter(x=>x.id!==id&&x.active).map(x=>x.prices[p.id]);
    prices[p.id]=id==='atlas'?Math.max(Math.round(p.cost*1.5),Math.round((competitors.length?Math.min(...competitors):p.retail)*.98*heat)):Math.round(p.retail*factor*heat);
    load[p.id]=Math.min(30-a.inventory[p.id],a.storage[p.id]);
    const held=a.inventory[p.id]+a.storage[p.id]+a.orders.filter(o=>o.product===p.id).reduce((n,o)=>n+o.quantity,0);
    const target=id==='penny'?45:id==='sage'?24:32;
    if(held<target-12){
      const quantity=target-held;
      const cost=quote(p,supplier,quantity)*quantity;
      if(cost<=budget&&quantity>0){orders.push({product:p.id,supplier:supplier.id,quantity});budget-=cost;}
    }
  }
  const rationale={atlas:`Match the lowest competitor with a small price edge${s.weather==='Hot'?', with a hot-weather drinks adjustment':''}. Replenish through Bay Wholesale.`,penny:'Keep prices accessible. Use bulk stock from Budget Depot to support volume.',nova:'Maintain premium margins and buy fast deliveries to protect availability.',sage:'Keep a $120 cash reserve and replenish conservatively.'}[id];
  return {prices,load,orders,rationale,memory:`Day ${s.day}: ${money(a.cash)} cash. ${orders.length} replenishment orders. Built-in ${a.strategy.toLowerCase()} policy.`};
}
export function stepDemo(s){const next=prepareDay(s);if(next.phase==='finished')return next;return settleDay(next,Object.fromEntries(next.agents.filter(a=>a.active).map(a=>[a.id,demoDecision(next,a.id)])));}
