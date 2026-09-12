import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,registerAgent,startRound,prepareDay,settleDay,stepDemo,observation,validateDecision,PRODUCTS} from '../dist/engine.js';
const hold=()=>({prices:{},load:{},orders:[],rationale:'Wait.',memory:''});
const decisions=g=>Object.fromEntries(g.agents.map(a=>[a.id,hold()]));
const ready=(options={})=>{let game=createGame(options);for(const agent of game.agents)game=registerAgent(game,agent.id);return startRound(game);};
test('lobby requires four registered agents and builds the wallet from their balances',()=>{
  let game=createGame();assert.equal(game.phase,'lobby');assert.throws(()=>prepareDay(game),/start the round/);assert.throws(()=>startRound(game),/4 more/);
  game=registerAgent(game,'atlas',50000);game=registerAgent(game,'penny',60000);game=registerAgent(game,'nova',70000);
  assert.equal(game.customerBudgetTotal,180000);assert.throws(()=>startRound(game),/1 more/);assert.throws(()=>registerAgent(game,'sage',49999),/at least/);
  game=registerAgent(game,'sage',80000);game=startRound(game);
  assert.equal(game.customerBudgetTotal,260000);assert.deepEqual(game.agents.map(a=>a.cash),[50000,60000,70000,80000]);assert.equal(game.phase,'ready');
  assert.throws(()=>registerAgent(game,'atlas'),/closed/);
});
test('identical seeds reproduce a complete round; accounting and budget remain valid',()=>{
  let a=ready(),b=ready(),guard=0;
  while(a.phase!=='finished'&&guard++<1000){
    a=stepDemo(a);b=stepDemo(b);
    for(const agent of a.agents){
      assert.equal(agent.cash,agent.entryBalance+agent.revenue-agent.spending-agent.fees-agent.refunds);
      assert.ok(Number.isInteger(agent.cash)&&agent.cash>=0);
      for(const p of PRODUCTS){assert.ok(agent.inventory[p.id]>=0&&agent.inventory[p.id]<=30);assert.ok(agent.storage[p.id]>=0);}
    }
  }
  assert.deepEqual(a,b);assert.equal(a.phase,'finished');assert.equal(a.finishReason,'customer_budget_exhausted');assert.equal(a.customerBudgetRemaining,0);assert.equal(a.customerBudgetSpent,a.customerBudgetTotal);assert.equal(totalRevenue(a),a.customerBudgetSpent);assert.equal(a.history.length,a.day+1);
  assert.deepEqual(stepDemo(a),a);
  assert.notDeepEqual(a.agents.map(x=>x.cash),[50000,50000,50000,50000]);
});
const totalRevenue=game=>game.agents.reduce((sum,agent)=>sum+agent.revenue,0);
test('ordering pays immediately, arrival enters storage, loading is explicit and capacity-limited',()=>{
  let g=prepareDay(ready());const d=decisions(g);
  d.atlas.orders=[{product:'water',supplier:'express',quantity:40}];
  g=settleDay(g,d);const a=g.agents[0],arrival=a.orders[0].arrives;
  assert.equal(a.inventory.water,0);assert.equal(a.storage.water,0);assert.equal(a.cash,50000-a.spending-200);
  while(g.day<arrival-1){g=prepareDay(g);g=settleDay(g,decisions(g));}
  g=prepareDay(g);assert.equal(g.agents[0].storage.water,40);assert.equal(g.agents[0].inventory.water,0);
  g.agents[0].prices.water=2000;const load=decisions(g);load.atlas.load={water:30};g=settleDay(g,load);
  assert.equal(g.agents[0].inventory.water,30);assert.equal(g.agents[0].storage.water,10);
});
test('invalid decisions cannot mint money or stock',()=>{
  for(const bad of [{...hold(),prices:{water:-5}},{...hold(),load:{water:31}},{...hold(),orders:[{product:'water',supplier:'express',quantity:-1}]},{...hold(),prices:{unknown:100}},{...hold(),load:{water:NaN}}])assert.throws(()=>validateDecision(bad));
  const g=prepareDay(ready());const d=decisions(g);d.atlas.load={water:30};d.atlas.orders=Array(12).fill({product:'coffee',supplier:'express',quantity:120});
  const out=settleDay(g,d);assert.equal(out.agents[0].inventory.water,0);assert.ok(out.agents[0].cash>=0);assert.ok(out.agents[0].orders.reduce((n,o)=>n+o.quantity,0)<=240);
});
test('private observations exclude opponents finances, notes, RNG and inventories',()=>{
  const g=prepareDay(ready());g.agents[1].memory='secret';const o=observation(g,'atlas');
  assert.equal(o.rng,undefined);assert.equal(o.seed,undefined);assert.equal(o.competitors[0].cash,undefined);assert.equal(o.competitors[0].inventory,undefined);assert.ok(!JSON.stringify(o).includes('secret'));
  o.self.cash=0;assert.equal(g.agents[0].cash,50000);
});
test('ten consecutive unpaid fees eliminate an agent; arrears are retained',()=>{
  let g=ready();g.agents[0].cash=0;
  for(let i=0;i<10;i++){g=prepareDay(g);g=settleDay(g,decisions(g));}
  assert.equal(g.agents[0].active,false);assert.equal(g.agents[0].arrears,2000);
});
test('daily product demand falls at high prices, with no invented automatic refunds',()=>{
  const run=price=>{const g=prepareDay(ready());for(const a of g.agents)for(const p of PRODUCTS){a.inventory[p.id]=30;a.prices[p.id]=price;}return settleDay(g,decisions(g));};
  const cheap=run(100),expensive=run(2000),sales=g=>g.agents.reduce((n,a)=>n+a.sold,0);
  assert.ok(sales(cheap)>sales(expensive));assert.equal(sales(expensive),0);assert.ok(cheap.agents.every(a=>a.refunds===0));assert.equal(cheap.unitsSoldToday,sales(cheap));
});
test('day transition does not mutate caller, and previous product sales are visible',()=>{
  const g=stepDemo(stepDemo(stepDemo(ready()))),copy=structuredClone(g),next=prepareDay(g);
  assert.deepEqual(g,copy);assert.deepEqual(next.agents[0].previousSales,g.agents[0].lastSales);
  assert.throws(()=>prepareDay(next));assert.throws(()=>settleDay(g,{}));
});
