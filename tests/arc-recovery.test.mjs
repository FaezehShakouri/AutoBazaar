import test from 'node:test';
import assert from 'node:assert/strict';
import {ArcSeasonStore} from '../lib/arc-season-store.mjs';
import {SeasonStore} from '../lib/season-store.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {settlementCall} from '../lib/arc.mjs';

const decision={prices:{},load:{},orders:[{product:'cola',supplier:'express',quantity:13},{product:'nuts',supplier:'express',quantity:9}],rationale:'Replenish drinks and nuts.',memory:'Private original notebook'};
async function fixture(t){
  const db=openSeasonDatabase(':memory:'),arc={metadata:{chainId:31337,contract:'0x'+'11'.repeat(20)},verify:async()=>true};
  const store=new ArcSeasonStore({db,arc});t.after(()=>db.close());
  const identities=Array.from({length:4},(_,i)=>({address:'0x'+String(i+1).padStart(40,'0'),humanId:`fixture-${i}`}));
  // Unit-only fixture seats; onchain funding/signatures are covered by Anvil.
  for(let i=0;i<4;i++)SeasonStore.prototype.join.call(store,1,identities[i],{name:`Test ${i}`,strategy:'Independent'});
  for(let i=0;i<4;i++)await store.submit(1,identities[i],{day:1,decision:i?{...decision,orders:[],memory:`Other private ${i}`} :decision,authorization:'0x1234'});
  const job=db.prepare("SELECT * FROM arc_jobs WHERE kind='day'").get(),payload=JSON.parse(job.payload);
  // Model the previous server's 103-unit quote and its already accepted cap.
  payload.state.supplierPayments[1].amount-=9;
  payload.state.agents[0].orders[1].total-=9;payload.state.agents[0].spending-=9;payload.state.agents[0].cash+=9;
  const permits=payload.call.args[2];permits[0].maxSupplySpend-=9;
  payload.call=settlementCall(1,payload.state,permits);
  db.prepare('UPDATE arc_permits SET permit=? WHERE season_id=1 AND slot=?').run(JSON.stringify(permits[0]),'atlas');
  db.prepare("UPDATE arc_jobs SET payload=?,status='failed',error='Arc rejected this operation during preflight. No funds moved.' WHERE id=?").run(JSON.stringify(payload),job.id);
  return {db,arc,store,job:db.prepare('SELECT * FROM arc_jobs WHERE id=?').get(job.id),payload};
}
test('legacy preflight quote failure is repaired once with original caps and an immutable audit copy',async t=>{
  const f=await fixture(t),before=f.store.get(1).state;
  const repaired=new ArcSeasonStore({db:f.db,arc:f.arc}),job=f.db.prepare('SELECT * FROM arc_jobs WHERE id=?').get(f.job.id),plan=JSON.parse(job.payload);
  assert.equal(job.status,'queued');assert.equal(job.raw,null);assert.equal(job.hash,null);assert.equal(job.op,f.job.op);
  assert.deepEqual(plan.call.args[2],f.payload.call.args[2]);assert.equal(plan.call.args[2][0].maxSupplySpend,1980);
  assert.equal(plan.call.args[3].length,1);assert.equal(plan.call.args[3][0].amount,1053);assert.equal(plan.state.agents[0].orders.length,1);
  assert.deepEqual(repaired.get(1).state,before,'published balances never advance before an Arc receipt');
  assert.equal(f.db.prepare('SELECT previous_payload FROM arc_job_repairs').get().previous_payload,f.job.payload);
  assert.equal(f.db.prepare('SELECT decision FROM decisions WHERE season_id=1 AND day=1 AND slot=?').get('atlas').decision,JSON.stringify(decision));
  assert.ok(repaired.jobs(1)[0].repair);assert.ok(!JSON.stringify(repaired.jobs(1)).includes('Private original notebook'));
  new ArcSeasonStore({db:f.db,arc:f.arc});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM arc_job_repairs').get().n,1);assert.equal(f.db.prepare('SELECT payload FROM arc_jobs WHERE id=?').get(job.id).payload,job.payload);
});
for(const patch of ["raw='0x1234'","hash='0x5678'","receipt='{}'","status='confirmed'","status='broadcast'"])test(`recovery never rewrites potentially broadcast or settled jobs: ${patch}`,async t=>{
  const f=await fixture(t);f.db.exec(`UPDATE arc_jobs SET ${patch}`);const before=f.db.prepare('SELECT * FROM arc_jobs').get();
  new ArcSeasonStore({db:f.db,arc:f.arc});assert.deepEqual(f.db.prepare('SELECT * FROM arc_jobs').get(),before);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM arc_job_repairs').get().n,0);
});
test('unrelated failures, changed permits and already advanced days do not qualify for repair',async t=>{
  const f=await fixture(t);
  const check=()=>{new ArcSeasonStore({db:f.db,arc:f.arc});assert.equal(f.db.prepare('SELECT status FROM arc_jobs').get().status,'failed');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM arc_job_repairs').get().n,0);};
  const invalid=structuredClone(f.payload);invalid.call.args[3][1].amount=1;f.db.prepare('UPDATE arc_jobs SET payload=?').run(JSON.stringify(invalid));check();
  f.db.prepare('UPDATE arc_jobs SET payload=?').run(f.job.payload);const p=structuredClone(f.payload.call.args[2][0]);p.signature='0xffff';f.db.prepare("UPDATE arc_permits SET permit=? WHERE slot='atlas'").run(JSON.stringify(p));check();
  f.db.prepare("UPDATE arc_permits SET permit=? WHERE slot='atlas'").run(JSON.stringify(f.payload.call.args[2][0]));const s=f.store.get(1);s.state.day=1;f.store.save(s);check();
});
