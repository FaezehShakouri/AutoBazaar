// Implements the sequence described in Vending-Bench §2.2.2.
// The paper does NOT disclose numeric calibrations, exact functions, or Arena
// allocation. Every numeric default below is LOCAL, not an Andon Labs value.
export const SALES_MODEL = {
  id: 'vending-bench-public-description-v1',
  fidelity: 'Public-description reconstruction; local calibration and Arena allocation',
  sources: [
    'https://andonlabs.com/evals/vending-bench-2',
    'https://arxiv.org/html/2502.15840v1#S2.SS2.SSS2',
    'https://andonlabs.com/evals/vending-bench-arena',
  ],
  calibration: {
    provenance: 'Hand-authored local estimates; not the original GPT-4o cache',
    // Prices are cents, baseSales are units/day, elasticity is signed.
    products: {
      water: {referencePrice:150,elasticity:-1.3,baseSales:9},
      cola: {referencePrice:200,elasticity:-1.4,baseSales:8},
      coffee: {referencePrice:320,elasticity:-1.1,baseSales:6},
      chips: {referencePrice:180,elasticity:-1.5,baseSales:7},
      bar: {referencePrice:280,elasticity:-1.2,baseSales:5},
      nuts: {referencePrice:250,elasticity:-1.2,baseSales:5},
    },
    // Sunday first. The paper reports stronger weekend sales, not these values.
    weekdays: [1.2,0.9,0.95,1,1,1.1,1.25],
    months: [0.85,0.85,0.95,1,1.05,1.15,1.2,1.15,1.05,1,0.9,0.9],
    weatherProbabilities: {Rainy:0.18,Hot:0.25,Mild:0.57},
    weather: {
      Rainy: {drink:0.8,snack:0.85},
      Hot: {drink:1.3,snack:0.95},
      Mild: {drink:1,snack:1},
    },
    variety: {optimal:6,rewardPerExtraProduct:0.03,penaltyPerExcessProduct:0.05},
    noiseFraction: 0.15,
  },
  // The original publication does not specify a competing-machine equation.
  competition: 'One product demand pool, sized by highest standalone expected demand; weighted allocation among stocked machines',
};

export function validateSalesModel(model,products){
  const c=model?.calibration;
  if(!c||typeof model.id!=='string'||typeof c.provenance!=='string')throw new Error('Invalid sales model metadata.');
  const positive=n=>Number.isFinite(n)&&n>0;
  for(const p of products){const v=c.products?.[p.id];if(!v||!Number.isInteger(v.referencePrice)||!positive(v.referencePrice)||!Number.isFinite(v.elasticity)||v.elasticity>0||!positive(v.baseSales))throw new Error(`Invalid sales calibration: ${p.id}`);}
  if(!Array.isArray(c.weekdays)||c.weekdays.length!==7||!c.weekdays.every(positive)||!Array.isArray(c.months)||c.months.length!==12||!c.months.every(positive))throw new Error('Invalid calendar multipliers.');
  for(const name of ['Rainy','Hot','Mild']){
    if(!Number.isFinite(c.weatherProbabilities?.[name])||c.weatherProbabilities[name]<0)throw new Error('Invalid weather probabilities.');
    for(const category of ['drink','snack'])if(!positive(c.weather?.[name]?.[category]))throw new Error('Invalid weather multipliers.');
  }
  if(Math.abs(Object.values(c.weatherProbabilities).reduce((a,b)=>a+b,0)-1)>1e-8)throw new Error('Weather probabilities must sum to one.');
  if(!Number.isInteger(c.variety?.optimal)||c.variety.optimal<1||!Number.isFinite(c.variety.rewardPerExtraProduct)||c.variety.rewardPerExtraProduct<0||!Number.isFinite(c.variety.penaltyPerExcessProduct)||c.variety.penaltyPerExcessProduct<0||!Number.isFinite(c.noiseFraction)||c.noiseFraction<0||c.noiseFraction>1)throw new Error('Invalid variety or noise calibration.');
}

export function dateForDay(startDate,day){
  const start=new Date(`${startDate}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isFinite(start.valueOf())||start.toISOString().slice(0,10)!==startDate)throw new Error('Start date must be a valid YYYY-MM-DD date.');
  start.setUTCDate(start.getUTCDate()+Math.max(0,day-1));
  return {date:start.toISOString().slice(0,10),weekday:start.getUTCDay(),month:start.getUTCMonth()};
}

// Separate random streams keep market conditions fixed across different agent
// orders and execution order for the same seed/date/product.
export function randomStream(seed,key){
  let h=2166136261;
  for(const c of `${seed}:${key}`)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
  return ()=>{h=(Math.imul(1664525,h)+1013904223)>>>0;return h/4294967296;};
}
export function weatherForDay(seed,date,model=SALES_MODEL){
  const r=randomStream(seed,`${date}:weather`)();
  const p=model.calibration.weatherProbabilities;
  return r<p.Rainy?'Rainy':r<p.Rainy+p.Hot?'Hot':'Mild';
}
export function choiceMultiplier(count,model=SALES_MODEL){
  if(count<=0)return 0;
  const v=model.calibration.variety;
  // A peak at the preferred assortment size, with a 50% lower bound as described
  // in the paper. Peak, slopes and this piecewise-linear shape are local choices.
  return Math.max(0.5,1+Math.min(count-1,v.optimal-1)*v.rewardPerExtraProduct-Math.max(0,count-v.optimal)*v.penaltyPerExcessProduct);
}
export function expectedSales({product,price,variety,calendar,weather,model=SALES_MODEL}){
  const c=model.calibration,profile=c.products[product.id];
  const relativePrice=(price-profile.referencePrice)/profile.referencePrice;
  const factors={price:Math.max(0,1+profile.elasticity*relativePrice),weekday:c.weekdays[calendar.weekday],month:c.months[calendar.month],weather:c.weather[weather][product.category],variety:choiceMultiplier(variety,model)};
  const expected=profile.baseSales*Object.values(factors).reduce((a,b)=>a*b,1);
  return {baseSales:profile.baseSales,referencePrice:profile.referencePrice,elasticity:profile.elasticity,factors,expected};
}
export function roundedDemand(expected,noiseFraction,draw){
  const noise=expected*noiseFraction*(2*draw-1);
  return {noise,units:Math.max(0,Math.round(expected+noise))};
}

export function simulateSales({agents,products,calendar,weather,seed,model=SALES_MODEL,budget=Number.POSITIVE_INFINITY}){
  if(!(budget===Number.POSITIVE_INFINITY||Number.isInteger(budget)&&budget>=0))throw new Error('Customer budget must be a non-negative integer number of cents.');
  const sold=Object.fromEntries(agents.map(a=>[a.id,Object.fromEntries(products.map(p=>[p.id,0]))]));
  const payments=Object.fromEntries(agents.map(a=>[a.id,Object.fromEntries(products.map(p=>[p.id,0]))]));
  const reports=[],transactions=[];
  let budgetRemaining=budget,spent=0,closingAdjustment=0;
  const assortment=Object.fromEntries(agents.map(a=>[a.id,products.filter(p=>a.inventory[p.id]>0).length]));
  for(const product of products){
    const candidates=agents.filter(a=>a.active&&a.inventory[product.id]>0).sort((a,b)=>a.id.localeCompare(b.id)).map(a=>({id:a.id,inventory:a.inventory[product.id],...expectedSales({product,price:a.prices[product.id],variety:assortment[a.id],calendar,weather,model})}));
    const expected=candidates.length?Math.max(...candidates.map(a=>a.expected)):0;
    const prediction=roundedDemand(expected,model.calibration.noiseFraction,randomStream(seed,`${calendar.date}:${product.id}:noise`)());
    const stock=candidates.reduce((n,a)=>n+a.inventory,0);
    const target=Math.min(stock,prediction.units);
    const draw=randomStream(seed,`${calendar.date}:${product.id}:allocation`);
    // Local Arena extension. With one machine this reduces exactly to its
    // rounded, noisy, inventory-capped daily product prediction.
    for(let unit=0;unit<target;unit++){
      if(budgetRemaining===0)break;
      const eligible=candidates.filter(a=>a.expected>0&&sold[a.id][product.id]<a.inventory);
      const weight=eligible.reduce((n,a)=>n+a.expected,0);
      if(weight<=0)break;
      let ticket=draw()*weight;
      for(let i=0;i<eligible.length;i++){
        ticket-=eligible[i].expected;
        if(ticket<=0||i===eligible.length-1){
          const winner=eligible[i],listed=agents.find(a=>a.id===winner.id).prices[product.id];
          const payment=Math.min(listed,budgetRemaining);
          sold[winner.id][product.id]++;payments[winner.id][product.id]+=payment;
          spent+=payment;budgetRemaining-=payment;closingAdjustment+=listed-payment;
          transactions.push({sequence:transactions.length+1,agent:winner.id,product:product.id,listedPrice:listed,payment,discount:listed-payment,budgetAfter:budgetRemaining});
          break;
        }
      }
    }
    const unitsSold=agents.reduce((n,a)=>n+sold[a.id][product.id],0);
    reports.push({product:product.id,expected,noise:prediction.noise,demand:prediction.units,stock,capacityLimited:Math.max(0,prediction.units-stock),walletLimited:Math.max(0,Math.min(stock,prediction.units)-unitsSold),sold:unitsSold,unserved:Math.max(0,prediction.units-unitsSold),machines:candidates.map(a=>({...a,sold:sold[a.id][product.id],revenue:payments[a.id][product.id]}))});
  }
  return {sold,payments,reports,transactions,spent,budgetRemaining,closingAdjustment};
}
