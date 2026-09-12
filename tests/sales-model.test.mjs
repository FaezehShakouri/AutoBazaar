import test from 'node:test';
import assert from 'node:assert/strict';
import {SALES_MODEL,dateForDay,expectedSales,roundedDemand,choiceMultiplier,simulateSales,weatherForDay,validateSalesModel} from '../dist/sales-model.js';
import {createGame,registerAgent,startRound,prepareDay,settleDay,PRODUCTS,observation} from '../dist/engine.js';

const product={id:'water',category:'drink'};
const calendar={date:'2025-01-01',weekday:3,month:0};
function neutral(){const m=structuredClone(SALES_MODEL),c=m.calibration;c.products.water={referencePrice:200,elasticity:-1,baseSales:10};c.weekdays.fill(1);c.months.fill(1);c.weather.Mild.drink=1;c.noiseFraction=0;return m;}
const machine=(id,price=200,stock=30)=>({id,active:true,prices:{water:price},inventory:{water:stock}});
const simulate=(agents,model=neutral())=>simulateSales({agents,products:[product],calendar,weather:'Mild',seed:42,model});
const ready=(options={})=>{let game=createGame(options);for(const agent of game.agents)game=registerAgent(game,agent.id);return startRound(game);};

test('hand-calculated single-machine elasticity, noise and inventory cap',()=>{
  // 25% above reference at elasticity -1 => 10 * 0.75 = 7.5 => 8 units.
  const m=neutral();const prediction=expectedSales({product,price:250,variety:1,calendar,weather:'Mild',model:m});
  assert.equal(prediction.expected,7.5);
  assert.equal(simulate([machine('a',250)],m).sold.a.water,8);
  assert.equal(simulate([machine('a',250,3)],m).sold.a.water,3);
  assert.equal(simulate([machine('a',450)],m).sold.a.water,0);
  assert.equal(simulate([machine('a',100)],m).sold.a.water,15);
  assert.deepEqual(roundedDemand(10,0.2,0.75),{noise:1,units:11});
  assert.deepEqual(roundedDemand(0,0.2,0.75),{noise:0,units:0});
});
test('weekday, month and weather multipliers combine before noise and rounding',()=>{
  const m=neutral();m.calibration.weekdays[3]=1.2;m.calibration.months[0]=0.5;m.calibration.weather.Mild.drink=1.5;
  assert.equal(expectedSales({product,price:200,variety:1,calendar,weather:'Mild',model:m}).expected,9);
  assert.ok(SALES_MODEL.calibration.weekdays[6]>SALES_MODEL.calibration.weekdays[1]);
  assert.ok(SALES_MODEL.calibration.months[6]>SALES_MODEL.calibration.months[0]);
});
test('choice multiplier rewards assortment, penalizes excess, and never reduces more than 50%',()=>{
  assert.ok(choiceMultiplier(6)>choiceMultiplier(1));assert.ok(choiceMultiplier(7)<choiceMultiplier(6));
  assert.equal(choiceMultiplier(100),0.5);assert.equal(choiceMultiplier(0),0);
});
test('calendar uses real weekdays, leap dates and month/year boundaries',()=>{
  assert.deepEqual(dateForDay('2025-01-01',1),calendar);
  assert.equal(dateForDay('2024-02-28',2).date,'2024-02-29');
  assert.equal(dateForDay('2025-01-31',2).month,1);
  assert.equal(dateForDay('2025-12-31',2).date,'2026-01-01');
  assert.throws(()=>dateForDay('2025-02-30',1));
});
test('competition conserves shared demand and excludes closed, empty and zero-demand machines',()=>{
  const agents=[machine('a'),machine('b'),machine('empty',200,0),{...machine('closed'),active:false},machine('expensive',500)];
  const result=simulate(agents);
  assert.equal(Object.values(result.sold).reduce((n,x)=>n+x.water,0),10);
  for(const id of ['empty','closed','expensive'])assert.equal(result.sold[id].water,0);
  assert.deepEqual(simulate([...agents].reverse()).sold,result.sold);
  const capped=simulate([machine('a',200,1),machine('b',200,2)]);
  assert.equal(capped.sold.a.water,1);assert.equal(capped.sold.b.water,2);
});
test('finite customer wallet caps payments and reaches exactly zero on the closing purchase',()=>{
  const result=simulateSales({agents:[machine('a',200)],products:[product],calendar,weather:'Mild',seed:42,model:neutral(),budget:450});
  assert.equal(result.sold.a.water,3);assert.equal(result.payments.a.water,450);assert.equal(result.spent,450);assert.equal(result.budgetRemaining,0);assert.equal(result.closingAdjustment,150);
  assert.deepEqual(result.transactions.map(t=>t.payment),[200,200,50]);assert.equal(result.reports[0].unserved,7);assert.equal(result.reports[0].walletLimited,7);
  assert.equal(simulateSales({agents:[machine('a')],products:[product],calendar,weather:'Mild',seed:42,model:neutral(),budget:0}).sold.a.water,0);
});
test('lower-priced competitors gain demand across fixed repeatable samples',()=>{
  const agents=[machine('cheap',100),machine('costly',250)],totals={cheap:0,costly:0};
  for(let seed=0;seed<100;seed++){
    const result=simulateSales({agents,products:[product],calendar,weather:'Mild',seed,model:neutral()});
    totals.cheap+=result.sold.cheap.water;totals.costly+=result.sold.costly.water;
  }
  assert.ok(totals.cheap>totals.costly*1.5);
});
test('model cache is frozen per season, private to engine, and validated',()=>{
  const m=neutral(),g=ready({salesModel:m});m.calibration.products.water.baseSales=999;
  assert.equal(g.salesModel.calibration.products.water.baseSales,10);
  assert.equal(observation(prepareDay(g),'atlas').salesModel,undefined);
  for(const mutate of [m=>m.calibration.products.water.referencePrice=0,m=>m.calibration.products.water.elasticity=NaN,m=>m.calibration.weekdays=[],m=>m.calibration.noiseFraction=-1]){
    const bad=neutral();mutate(bad);assert.throws(()=>validateSalesModel(bad,PRODUCTS));
  }
});
test('placing additional orders cannot perturb future weather',()=>{
  const morning=prepareDay(ready());
  const hold=()=>({prices:{},load:{},orders:[],rationale:'Hold.',memory:''});
  const d=Object.fromEntries(morning.agents.map(a=>[a.id,hold()])),extra=structuredClone(d);
  extra.atlas.orders=[{product:'water',supplier:'express',quantity:1}];
  const a=prepareDay(settleDay(morning,d)),b=prepareDay(settleDay(morning,extra));
  assert.equal(a.weather,b.weather);assert.equal(a.weather,weatherForDay(a.seed,a.calendar.date,a.salesModel));
  assert.equal('customers' in a,false);assert.equal('event' in a,false);
});
