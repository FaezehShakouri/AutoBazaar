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
const quantities = (n=0) => Object.fromEntries(PRODUCTS.map(p=>[p.id,n]));
export const money = cents => (cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
export function createGame({seed=42,days=365,mode='demo'}={}) {
  if(!Number.isInteger(seed)||seed<0||seed>4294967295) throw new Error('Seed must be an unsigned 32-bit integer.');
  if(!Number.isInteger(days)||days<1||days>365) throw new Error('Season must be between 1 and 365 days.');
  return {version:1,seed,rng:seed||1,day:0,days,mode,phase:'ready',weather:'Mild',customers:0,event:'Opening day',agents:PERSONALITIES.map(a=>({...a,cash:50000,inventory:quantities(),storage:quantities(),prices:Object.fromEntries(PRODUCTS.map(p=>[p.id,p.retail])),orders:[],revenue:0,spending:0,fees:0,refunds:0,sold:0,missedFees:0,arrears:0,active:true,memory:'',rationale:'Ready to open. Choose stock and set prices.',lastSales:quantities(),lastRevenue:0})),history:[{day:0,cash:PERSONALITIES.map(()=>50000)}],log:[],nextLogId:1};
}
function random(s){s.rng=(Math.imul(1664525,s.rng)+1013904223)>>>0;return s.rng/4294967296;}
function log(s,agent,type,text){s.log.push({id:s.nextLogId++,day:s.day,agent,type,text});}
export function quote(product,supplier,quantity){return Math.round(product.cost*supplier.multiplier*(quantity>=24?0.92:1));}
export function prepareDay(state){
  const s=structuredClone(state);
  if(s.phase==='finished') return s;
  if(s.phase==='deciding') throw new Error('This day is already prepared.');
  s.day++;s.phase='deciding';
  const w=random(s);s.weather=w<.18?'Rainy':w<.43?'Hot':'Mild';
  s.event=s.day%17===0?'Campus festival':s.day%11===0?'Office closure':'Business as usual';
  s.customers=Math.round((80+random(s)*40)*(s.day%7>=5?.7:1)*(s.weather==='Rainy'?.7:1)*(s.event==='Campus festival'?1.65:s.event==='Office closure'?.55:1));
  log(s,null,'market',`${s.weather} weather · ${s.customers} visitors · ${s.event}`);
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
  return structuredClone({day:s.day,days:s.days,weather:s.weather,event:s.event,visitors:s.customers,self,products:PRODUCTS,suppliers:SUPPLIERS,competitors:s.agents.filter(a=>a.id!==id).map(a=>({id:a.id,name:a.name,prices:a.prices,active:a.active})),recentEvents:s.log.filter(e=>e.agent===id||e.agent===null).slice(-35),rules:{currency:'integer USD cents',startingCash:50000,dailyFee:200,capacityPerProduct:30,storageAndTransitPerProduct:240,maxOrdersPerDay:12,score:'Final bank cash; stock has no liquidation value',settlement:'Orders paid immediately. Deliveries enter storage before decisions; load them explicitly. Sales settle automatically that day. Ten consecutive unpaid daily fees eliminates a machine. Arrears are settled before new fees. No debt or real purchases.',customerChoice:'Shared visitors choose among available machines by price relative to product reference retail, with random preferences; visitors may walk away.'}});
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
    for(const [id,n] of Object.entries(d.load)){const moved=Math.min(n,a.storage[id],30-a.inventory[id]);a.storage[id]-=moved;a.inventory[id]+=moved;}
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
  for(let i=0;i<s.customers;i++){
    const drink=random(s)<(s.weather==='Hot'?.78:.52);
    const group=PRODUCTS.filter(p=>p.category===(drink?'drink':'snack'));
    const p=group[Math.floor(random(s)*group.length)];
    const available=s.agents.filter(a=>a.active&&a.inventory[p.id]>0);
    const weights=available.map(a=>Math.exp(-2.7*(a.prices[p.id]/p.retail-1)));
    let ticket=random(s)*(weights.reduce((n,w)=>n+w,0)+.75);
    for(let j=0;j<available.length;j++){
      ticket-=weights[j];if(ticket>0)continue;
      const a=available[j];a.inventory[p.id]--;a.sold++;a.lastSales[p.id]++;
      a.cash+=a.prices[p.id];a.revenue+=a.prices[p.id];a.lastRevenue+=a.prices[p.id];
      if(random(s)<.012){a.cash-=a.prices[p.id];a.refunds+=a.prices[p.id];log(s,a.id,'refund',`Customer refunded ${money(a.prices[p.id])} for ${p.name}.`);}break;
    }
  }
  for(const a of s.agents){
    if(!a.active)continue;
    const due=200+a.arrears;
    if(a.cash>=due){a.cash-=due;a.fees+=due;a.arrears=0;a.missedFees=0;}else{a.arrears+=200;a.missedFees++;log(s,a.id,'warning',`Operating fee unpaid (${a.missedFees}/10 days).`);}
    if(a.missedFees>=10){a.active=false;log(s,a.id,'bankrupt','Machine closed after 10 consecutive unpaid fees.');}
    log(s,a.id,'sales',`${Object.values(a.lastSales).reduce((n,x)=>n+x,0)} items sold · ${money(a.lastRevenue)} revenue.`);
  }
  s.history.push({day:s.day,cash:s.agents.map(a=>a.cash)});
  s.phase=s.day>=s.days||s.agents.every(a=>!a.active)?'finished':'ready';
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
    const remaining=s.days-s.day;
    if(held<target-12&&remaining>supplier.lead){
      const quantity=Math.min(target-held,Math.floor(remaining*3));
      const cost=quote(p,supplier,quantity)*quantity;
      if(cost<=budget&&quantity>0){orders.push({product:p.id,supplier:supplier.id,quantity});budget-=cost;}
    }
  }
  const rationale={atlas:`Match the lowest competitor with a small price edge${s.weather==='Hot'?', with a hot-weather drinks adjustment':''}. Replenish through Bay Wholesale.`,penny:'Keep prices accessible. Use bulk stock from Budget Depot to support volume.',nova:'Maintain premium margins and buy fast deliveries to protect availability.',sage:'Keep a $120 cash reserve and replenish conservatively.'}[id];
  return {prices,load,orders,rationale,memory:`Day ${s.day}: ${money(a.cash)} cash. ${orders.length} replenishment orders. Built-in ${a.strategy.toLowerCase()} policy.`};
}
export function stepDemo(s){const next=prepareDay(s);if(next.phase==='finished')return next;return settleDay(next,Object.fromEntries(next.agents.filter(a=>a.active).map(a=>[a.id,demoDecision(next,a.id)])));}
