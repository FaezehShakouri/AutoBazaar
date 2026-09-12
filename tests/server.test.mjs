import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createArenaServer} from '../server.mjs';
const decision={prices:{},load:{},orders:[],rationale:'Hold cash.',memory:'Save.'};
async function fixture(t,decide){const dir=await mkdtemp(join(tmpdir(),'vending-test-'));const server=createArenaServer({decide,saveDirectory:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;return {base,post:(path,body={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};}
test('API commits a complete round, exports state and rejects cross-origin calls',async t=>{
  const {base,post}=await fixture(t,async()=>decision);
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/sales-model.js')).status,200);
  assert.equal((await post('/api/reset',{seed:9,startDate:'2025-06-01'})).status,200);
  for(const id of ['atlas','penny','nova','sage'])assert.equal((await post('/api/register',{id})).status,200);
  assert.equal((await post('/api/start')).status,200);
  const res=await post('/api/step');assert.equal(res.status,200);assert.equal((await res.json()).day,1);
  assert.equal((await(await fetch(base+'/api/state')).json()).agents[0].memory,'Save.');
  const state=await(await fetch(base+'/api/state')).json();
  assert.equal(state.calendar.date,'2025-06-01');assert.equal(state.version,4);assert.equal(state.salesReport.length,6);assert.equal(state.customerBudgetTotal,200000);assert.ok(state.daySituation);assert.ok(Array.isArray(state.customerTransactions));
  const bad=await fetch(base+'/api/step',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'});assert.equal(bad.status,403);
  assert.equal((await post('/api/reset',{seed:-1})).status,400);
});
test('a failed Codex call does not partially advance the market',async t=>{
  const {base,post}=await fixture(t,async o=>{if(o.self.id==='penny')throw new Error('Fake provider failure');return decision;});
  for(const id of ['atlas','penny','nova','sage'])await post('/api/register',{id});await post('/api/start');
  const r=await post('/api/step');assert.equal(r.status,502);assert.match((await r.json()).error,/Penny/);
  assert.equal((await(await fetch(base+'/api/state')).json()).day,0);
});
test('concurrent steps cannot duplicate a round',async t=>{
  let release;const gate=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
  const {post}=await fixture(t,async()=>{entered();await gate;return decision;});
  for(const id of ['atlas','penny','nova','sage'])await post('/api/register',{id});await post('/api/start');
  const first=post('/api/step');await ready;const second=await post('/api/step');assert.equal(second.status,409);release();assert.equal((await first).status,200);
});
