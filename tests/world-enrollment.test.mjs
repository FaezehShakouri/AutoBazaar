import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {hashSignal} from '@worldcoin/idkit-core/hashing';
import {SeasonStore,SeasonError} from '../lib/season-store.mjs';
import {WorldSandbox} from '../lib/world-sandbox.mjs';
import {seasonIdentity} from '../lib/season-identity.mjs';
import {agentBookConfig} from '../lib/agentkit-auth.mjs';
import {createSeasonApi} from '../lib/season-api.mjs';
import {createRemoteAgent} from '../lib/remote-agent.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {circleWallet} from '../lib/circle-wallet.mjs';

const env={SEASON_IDENTITY_MODE:'agentbook',WORLD_ID_APP_ID:'app_abcd',WORLD_ID_RP_ID:'rp_abcd',WORLD_ID_SIGNING_KEY:'ab'.repeat(32),WORLD_ID_SANDBOX_CREDENTIAL:'selfie'};
const base='https://test.autobazaar.example',config=agentBookConfig();
const keys=Array.from({length:5},(_,i)=>'0x'+String(i+1).padStart(64,'0'));
const accepted=async()=>Response.json({success:true,environment:'sandbox',action:'autobazaar-agent-test',results:[{identifier:'selfie',success:true}]});
function fixture(t,{lookupHuman=async()=>null}={}){
  const db=openSeasonDatabase(':memory:'),store=new SeasonStore({db,bookScope:config.scope});t.after(()=>db.close());
  const api=createSeasonApi({store,config,worldEnv:env,worldVerifyFetch:accepted,book:{lookupHuman}});
  const raw=(path,body)=>api(new Request(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{remoteAddress:'browser'});
  const agents=keys.map((privateKey,i)=>createRemoteAgent({server:base,privateKey,fetch:(url,init)=>api(new Request(url,init),{remoteAddress:`wallet-${i}`})}));
  return {store,agents,raw,api};
}
function proof(s){return {protocol_version:'3.0',nonce:s.config.rp_context.nonce,action:s.config.action,environment:'sandbox',responses:[{identifier:'selfie',signal_hash:hashSignal(s.signal),nullifier:'0x12',merkle_root:'0x1234',proof:'0x5678'}]};}

test('official AgentBook is required even with a verified Selfie diagnostic and a legacy registry record',async t=>{
  let lookups=0;const f=fixture(t,{lookupHuman:async()=>{lookups++;return null;}}),agent=f.agents[0];
  f.store.db.exec('CREATE TABLE world_sandbox_agents(address TEXT PRIMARY KEY,human_key TEXT,scope TEXT,credential TEXT,registered_at INTEGER)');
  f.store.db.prepare('INSERT INTO world_sandbox_agents VALUES (?,?,?,?,?)').run(agent.address.toLowerCase(),'old-profile','world-id-sandbox:legacy','selfie',Date.now());
  const s=await (await f.raw('/api/world-id/start',{address:agent.address,enrollment:true})).json();
  const response=await f.raw('/api/world-id/verify',{id:s.id,result:proof(s)});assert.equal(response.status,200);
  const done=await response.json();assert.equal(done.registered,false);assert.equal(done.grantsSeasonEntry,false);
  await assert.rejects(agent.join(1,{name:'Atlas'}),e=>e.status===403&&/agentkit-cli@0.2.0 register/.test(e.message));
  assert.equal(lookups,1);assert.equal(f.store.entries(1).length,0);assert.equal(f.store.get(1).state.customerBudgetTotal,0);
  const metadata=await (await f.raw('/api/seasons')).json();assert.equal(metadata.verification.mode,'agentbook');assert.equal(metadata.verification.contract,config.contractAddress);assert.equal(metadata.rules.oneAgentPerHuman,true);
  assert.ok(!JSON.stringify(metadata).includes(env.WORLD_ID_SIGNING_KEY));
});

test('retired enrollment endpoints and outstanding phone enrollments cannot register wallets',async t=>{
  const f=fixture(t);
  for(const path of ['/api/world-id/enroll','/api/world-id/status','/api/world-id/session/'+'a'.repeat(48)]){
    const response=await f.raw(path,path.includes('/session/')?undefined:{});assert.equal(response.status,410);assert.match((await response.json()).error,/AgentBook/);
  }
  const sandbox=new WorldSandbox({store:f.store,env,verifyFetch:accepted});
  assert.throws(()=>sandbox.start(f.agents[0].address,{enrollment:true}),e=>e.status===410);
  const s=sandbox.start(f.agents[0].address);f.store.db.prepare('UPDATE world_sandbox_sessions SET enrollment=1 WHERE id=?').run(s.id);
  await assert.rejects(sandbox.complete(s.id,proof(s)),e=>e.status===410);
  assert.equal(f.store.db.prepare('SELECT verified_at FROM world_sandbox_sessions WHERE id=?').get(s.id).verified_at,null);
  assert.throws(()=>seasonIdentity({...env,SEASON_IDENTITY_MODE:'world-id-sandbox'},config),/retired/);
});

test('four AgentBook humans fill a season and a second wallet for the same human cannot take another seat',async t=>{
  const humans=new Map(keys.map((key,i)=>[privateKeyToAccount(key).address.toLowerCase(),`human-${i===4?0:i}`]));
  const f=fixture(t,{lookupHuman:async address=>humans.get(address)});
  await f.agents[0].join(1,{name:'Atlas'});
  await assert.rejects(f.agents[4].join(1,{name:'Duplicate'}),e=>e.status===409);
  for(let i=1;i<4;i++)await f.agents[i].join(1,{name:`Agent ${i}`});
  const season=f.store.summary(f.store.get(1));assert.equal(season.status,'running');assert.equal(season.registered,4);assert.ok(season.entrants.every(e=>e.humanBacked));
});

test('unregistered or unavailable AgentBook blocks Arc funding tickets before any wallet payment',async t=>{
  for(const status of [403,503]){
    const f=fixture(t,{lookupHuman:async()=>{if(status===503)throw new SeasonError(503,'AgentBook is temporarily unavailable.');return null;}});
    let fundingCalls=0;f.store.arc={metadata:{chainId:5042002}};f.store.join=()=>{fundingCalls++;throw Error('Funding must remain unreachable');};
    await assert.rejects(f.agents[0].join(1,{name:'Atlas'}),e=>e.status===status);
    assert.equal(fundingCalls,0);assert.equal(f.store.entries(1).length,0);
  }
});

test('retiring a Sandbox scope requires explicit opt-in, no entrants and no payment jobs',t=>{
  const legacyScope='world-id-sandbox:app_abcd:rp_abcd:autobazaar-agent-test:selfie';
  for(const occupied of ['empty','seat','payment']){
    const db=openSeasonDatabase(':memory:');t.after(()=>db.close());const store=new SeasonStore({db,bookScope:legacyScope});
    store.saveChallenge({nonce:'old-enrollment',expirationTime:new Date(Date.now()+60000).toISOString()},'POST','digest');
    if(occupied==='seat')store.join(1,{address:privateKeyToAccount(keys[0]).address,humanId:'old profile'},{name:'Existing'});
    if(occupied==='payment'){db.exec('CREATE TABLE arc_jobs(id INTEGER)');db.exec('INSERT INTO arc_jobs VALUES (1)');}
    assert.throws(()=>new SeasonStore({db,bookScope:config.scope}),/another identity/);
    const change=()=>new SeasonStore({db,bookScope:config.scope,allowRetiredSandboxMigration:true});
    if(occupied==='empty'){
      const migrated=change();assert.equal(migrated.bookScope,config.scope);assert.equal(migrated.challenge('old-enrollment'),null);
      assert.throws(()=>new SeasonStore({db,bookScope:legacyScope,allowRetiredSandboxMigration:true}),/separate escrow/);
    }else{
      assert.throws(change,/separate escrow/);assert.equal(db.prepare("SELECT value FROM settings WHERE key='book_scope'").get().value,legacyScope);
    }
  }
});

test('Circle activation errors reach the runner before AgentBook or funding is attempted',async t=>{
  const f=fixture(t,{lookupHuman:async()=>{throw Error('Unsigned request must not reach AgentBook');}});let signedRequests=0;
  const account=circleWallet(f.agents[0].address,{run:async()=>{throw Object.assign(Error('CLI failed'),{stderr:"Error: This wallet isn't deployed on-chain yet. Send any transaction first."});}});
  f.store.arc={metadata:{chainId:5042002},verifyMessage:async()=>{throw Error('Unsigned request must not reach signature verification');}};
  const agent=createRemoteAgent({server:base,account,fetch:(url,init)=>{const req=new Request(url,init);if(req.headers.has('agentkit'))signedRequests++;return f.api(req);}});
  await assert.rejects(agent.join(1,{name:'Atlas'}),/Agent wallet could not sign: Circle wallet is not deployed on Arc Testnet/);
  assert.equal(signedRequests,0);assert.equal(f.store.entries(1).length,0);
});
