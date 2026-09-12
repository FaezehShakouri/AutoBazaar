import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldSandbox} from '../lib/world-sandbox.mjs';
import {SeasonStore} from '../lib/season-store.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {hashSignal} from '@worldcoin/idkit-core/hashing';

const env={WORLD_ID_APP_ID:'app_abcd',WORLD_ID_RP_ID:'rp_abcd',WORLD_ID_SIGNING_KEY:'ab'.repeat(32)};
const address='0x0000000000000000000000000000000000000001';
function fixture(t,verifyFetch){const store=new SeasonStore({db:openSeasonDatabase(':memory:')});t.after(()=>store.close());return {store,sandbox:new WorldSandbox({store,env,verifyFetch})};}
function proof(s){return {protocol_version:'4.0',nonce:s.config.rp_context.nonce,action:s.config.action,environment:'sandbox',responses:[{identifier:'proof_of_human',issuer_schema_id:1,signal_hash:hashSignal(s.signal),nullifier:'0x0012',proof:['0x01','0x02','0x03','0x04','0x05'],expires_at_min:Math.floor(Date.now()/1000)+300}]};}
const accepted=()=>Response.json({success:true,environment:'sandbox',action:'autobazaar-agent-test',results:[{identifier:'proof_of_human',success:true}]});

test('Sandbox request hides signing key and server-verified proof never grants a season seat',async t=>{
  let forwarded;
  const {store,sandbox}=fixture(t,async(url,init)=>{forwarded={url,body:JSON.parse(init.body)};return accepted();});
  const session=sandbox.start(address),result=proof(session);
  assert.equal(JSON.stringify(session).includes(env.WORLD_ID_SIGNING_KEY),false);
  assert.equal(session.config.environment,'sandbox');assert.equal(session.config.allow_legacy_proofs,true);
  const done=await sandbox.complete(session.id,result);assert.equal(done.verified,true);assert.equal(done.grantsSeasonEntry,false);
  assert.equal(forwarded.url,'https://developer.world.org/api/v4/verify/rp_abcd');assert.deepEqual(forwarded.body,result);
  assert.equal(store.entries(1).length,0);assert.equal(store.get(1).state.customerBudgetTotal,0);
  const row=store.db.prepare('SELECT * FROM world_sandbox_sessions WHERE id=?').get(session.id);assert.ok(row.verified_at);assert.equal(JSON.stringify(row).includes(result.responses[0].nullifier),false);
  await assert.rejects(sandbox.complete(session.id,result),e=>e.status===409);
});
test('wrong environment, nonce, action, credential and wallet signal fail before proof verification',async t=>{
  let calls=0;const {sandbox}=fixture(t,async()=>{calls++;return accepted();});
  const s=sandbox.start(address);
  for(const mutate of [r=>r.environment='production',r=>r.nonce='wrong',r=>r.action='wrong',r=>r.protocol_version='5.0',r=>r.responses[0].signal_hash=hashSignal('another wallet'),r=>r.responses[0].issuer_schema_id=11,r=>r.responses[0].nullifier='not-a-number']){
    const result=proof(s);mutate(result);await assert.rejects(sandbox.complete(s.id,result),e=>e.status===400);
  }
  assert.equal(calls,0);
});
test('legacy Orb proofs require wallet binding and an exact upstream credential success',async t=>{
  let forwarded,calls=0;
  const {sandbox,store}=fixture(t,async(url,init)=>{calls++;forwarded=JSON.parse(init.body);return Response.json({success:true,environment:'sandbox',action:env.WORLD_ID_ACTION||'autobazaar-agent-test',results:[{identifier:'orb',success:true}]});});
  const session=sandbox.start(address),result=proof(session);
  result.protocol_version='3.0';result.responses=[{identifier:'orb',signal_hash:hashSignal(session.signal),nullifier:'0x0012',merkle_root:'0x1234',proof:'0x5678'}];
  for(const identifier of ['device','face','selfie','document','proof_of_human']){
    const wrong=structuredClone(result);wrong.responses[0].identifier=identifier;
    await assert.rejects(sandbox.complete(session.id,wrong),e=>e.status===400);
  }
  const unbound=structuredClone(result);unbound.responses[0].signal_hash=hashSignal('');
  await assert.rejects(sandbox.complete(session.id,unbound),e=>e.status===400);assert.equal(calls,0);
  const done=await sandbox.complete(session.id,result);assert.equal(done.verified,true);assert.equal(done.grantsSeasonEntry,false);assert.deepEqual(forwarded,result);assert.equal(store.entries(1).length,0);
  const mismatch=fixture(t,async()=>accepted()),s=mismatch.sandbox.start(address),r=structuredClone(result);
  r.nonce=s.config.rp_context.nonce;r.responses[0].signal_hash=hashSignal(s.signal);
  await assert.rejects(mismatch.sandbox.complete(s.id,r),e=>e.status===400);
});
test('upstream rejection, partial success and outage never mark a Sandbox check verified',async t=>{
  for(const verifyFetch of [async()=>Response.json({success:false},{status:400}),async()=>Response.json({success:true,environment:'sandbox',action:'autobazaar-agent-test',results:[{identifier:'passport',success:true}]}),async()=>{throw Error('offline');}]){
    const {store,sandbox}=fixture(t,verifyFetch),s=sandbox.start(address);await assert.rejects(sandbox.complete(s.id,proof(s)),e=>[400,503].includes(e.status));assert.equal(store.db.prepare('SELECT verified_at FROM world_sandbox_sessions WHERE id=?').get(s.id).verified_at,null);
  }
});
test('only one concurrent verification can consume the same Sandbox session',async t=>{
  const {sandbox}=fixture(t,async()=>accepted()),s=sandbox.start(address),r=proof(s);
  const results=await Promise.allSettled([sandbox.complete(s.id,r),sandbox.complete(s.id,r)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('expired and unconfigured Sandbox requests remain unavailable',async t=>{
  const {store,sandbox}=fixture(t,async()=>accepted()),s=sandbox.start(address);store.db.prepare('UPDATE world_sandbox_sessions SET expires=0 WHERE id=?').run(s.id);
  await assert.rejects(sandbox.complete(s.id,proof(s)),e=>e.status===409);
  const unset=new WorldSandbox({store});assert.equal(unset.config().configured,false);assert.throws(()=>unset.start(address),e=>e.status===503);
});
test('explicit Selfie Check Sandbox sessions verify only the requested credential and never grant entry',async t=>{
  let calls=0,forwarded;
  const {store}=fixture(t);
  const sandbox=new WorldSandbox({store,env:{...env,WORLD_ID_SANDBOX_CREDENTIAL:'selfie'},verifyFetch:async(url,init)=>{calls++;forwarded=JSON.parse(init.body);return Response.json({success:true,environment:'sandbox',action:'autobazaar-agent-test',results:[{identifier:'selfie',success:true}]});}});
  const s=sandbox.start(address),r=proof(s);
  assert.equal(s.credential,'selfie');assert.equal(sandbox.config().credential,'selfie');
  r.protocol_version='3.0';r.responses=[{identifier:'selfie',signal_hash:hashSignal(s.signal),nullifier:'0x0012',merkle_root:'0x1234',proof:'0x5678'}];
  for(const identifier of ['orb','device','document','proof_of_human','face']){
    const wrong=structuredClone(r);wrong.responses[0].identifier=identifier;
    await assert.rejects(sandbox.complete(s.id,wrong),e=>e.status===400);
  }
  const wrongSignal=structuredClone(r);wrongSignal.responses[0].signal_hash=hashSignal('');
  await assert.rejects(sandbox.complete(s.id,wrongSignal),e=>e.status===400);assert.equal(calls,0);
  const done=await sandbox.complete(s.id,r);assert.equal(done.credential,'selfie');assert.equal(done.grantsSeasonEntry,false);assert.deepEqual(forwarded,r);assert.equal(store.entries(1).length,0);
});
test('Sandbox schema migration preserves old requests and pins credentials across configuration changes',async t=>{
  const store=new SeasonStore({db:openSeasonDatabase(':memory:')});t.after(()=>store.close());
  store.db.exec('CREATE TABLE world_sandbox_sessions(id TEXT PRIMARY KEY,address TEXT NOT NULL,nonce TEXT NOT NULL,signal TEXT NOT NULL,expires INTEGER NOT NULL,verified_at INTEGER,human_key TEXT)');
  store.db.prepare('INSERT INTO world_sandbox_sessions(id,address,nonce,signal,expires) VALUES (?,?,?,?,?)').run('old',address,'nonce','signal',Date.now()+300000);
  const initial=new WorldSandbox({store,env,verifyFetch:async()=>accepted()}),poh=initial.start(address);
  assert.equal(store.db.prepare('SELECT credential FROM world_sandbox_sessions WHERE id=?').get('old').credential,'proof_of_human');
  const updated=new WorldSandbox({store,env:{...env,WORLD_ID_SANDBOX_CREDENTIAL:'selfie'},verifyFetch:async()=>accepted()});
  assert.equal(updated.start(address).credential,'selfie');
  assert.equal((await updated.complete(poh.id,proof(poh))).credential,'proof_of_human');
});
