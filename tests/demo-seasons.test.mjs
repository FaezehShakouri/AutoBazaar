import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {createAgentkitClient} from '@worldcoin/agentkit';
import {SeasonStore} from '../lib/season-store.mjs';
import {ArcSeasonStore} from '../lib/arc-season-store.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {agentBookConfig,AgentKitGate} from '../lib/agentkit-auth.mjs';
import {seasonParticipation,houseIdentity} from '../lib/season-participation.mjs';
import {createSeasonApi} from '../lib/season-api.mjs';
import {createRemoteAgent} from '../lib/remote-agent.mjs';
import {demoHouseDecision} from '../lib/demo-policy.mjs';
import {ARC_USDC} from '../lib/arc.mjs';
import {seasonLobby,seasonStatus} from '../dist/season-view.js';

const keys=Array.from({length:7},(_,i)=>'0x'+(i+31).toString(16).padStart(64,'0'));
const accounts=keys.map(privateKeyToAccount),config=agentBookConfig(),base='https://demo.example';
const env={SEASON_MODE:'demo',DEMO_AGENT_ADDRESSES:accounts.slice(1,4).map(a=>a.address).join(',')};
const participation=seasonParticipation(env),identity=i=>({address:accounts[i].address,humanId:i>0&&i<4?houseIdentity(accounts[i].address):`verified-${i}`});
function fixture(t,{demo=true,db=openSeasonDatabase(':memory:')}={}){
  let now=Date.now();const store=new SeasonStore({db,bookScope:config.scope,participation:demo?participation:seasonParticipation(),now:()=>now,intermissionMs:1});t.after(()=>db.close());
  const lookups=[];const book={lookupHuman:async address=>{lookups.push(address);return address===accounts[0].address.toLowerCase()?'verified-0':address===accounts[4].address.toLowerCase()?'verified-4':null;}};
  const api=createSeasonApi({store,config,book});
  const agents=keys.map((privateKey,i)=>createRemoteAgent({server:base,privateKey,fetch:(url,init)=>api(new Request(url,init),{remoteAddress:`wallet-${i}`})}));
  return {store,api,agents,lookups,advance:ms=>{now+=ms;},tick:()=>{now+=2;store.tick();}};
}

test('one real signed human client and three signed allowlisted house clients fill a demo',async t=>{
  const f=fixture(t);
  for(const i of [1,2,3])await f.agents[i].join(1,{name:`House ${i}`,strategy:'Built-in'});
  assert.equal(f.lookups.length,0);assert.equal(f.store.summary(f.store.get(1)).status,'open');
  await assert.rejects(f.agents[5].join(1,{name:'Fake house',participantKind:'house'}),e=>e.status===403);
  await f.agents[0].join(1,{name:'Human'});
  const s=f.store.summary(f.store.get(1));assert.equal(s.status,'running');assert.deepEqual(s.seatCounts,{human:1,house:3});
  assert.equal(s.entrants.filter(e=>e.humanBacked).length,1);assert.equal(s.entrants.filter(e=>e.participantKind==='house').length,3);
  const view=f.store.publicView(1);assert.equal(view.state.agents.filter(a=>a.participantKind==='house').length,3);
  assert.match(seasonLobby(s),/1 HUMAN \+ 3 HOUSE/);assert.match(seasonStatus(s),/DEMO/);assert.ok(!JSON.stringify(view).includes('verified-0'));
});

test('competition mode never grants house privileges and demo quotas reserve the human seat',async t=>{
  const normal=fixture(t,{demo:false});await assert.rejects(normal.agents[1].join(1,{name:'House'}),e=>e.status===403);
  const f=fixture(t);await f.agents[0].join(1,{name:'Human'});
  await assert.rejects(f.agents[4].join(1,{name:'Another human'}),e=>e.status===409&&/one human seat/.test(e.message));
  assert.equal(f.store.entries(1).length,1);
});

test('only the confirmed human seat can request houses; retries neither add seats nor spend capital',async t=>{
  const f=fixture(t);
  await assert.rejects(f.agents[0].houseAgents(1),e=>e.status===403);
  await f.agents[0].join(1,{name:'Human'});
  await assert.rejects(f.agents[4].houseAgents(1),e=>e.status===403);
  await f.agents[1].join(1,{name:'House'});
  await assert.rejects(f.agents[1].houseAgents(1),e=>e.status===403);
  const before=structuredClone(f.store.get(1).state);
  const results=await Promise.all([f.agents[0].houseAgents(1),f.agents[0].houseAgents(1)]);
  assert.ok(results.every(r=>r.status==='queued'&&r.attempt===1));
  assert.deepEqual(f.store.get(1).state,before);assert.equal(f.store.entries(1).length,2);
  assert.equal((await f.agents[0].dashboard(1)).season.houseRequest.status,'queued');
  const normal=fixture(t,{demo:false});await normal.agents[0].join(1,{name:'Human'});
  await assert.rejects(normal.agents[0].houseAgents(1),e=>e.status===409);
});

test('house leases require signed house ownership, expire, fence stale hosts and survive restart',async t=>{
  const f=fixture(t);await f.agents[0].join(1,{name:'Human'});await f.agents[0].houseAgents(1);
  await assert.rejects(f.agents[0].houseAgents(1,{operation:'claim',attempt:1}),e=>e.status===403);
  const first=await f.agents[1].houseAgents(1,{operation:'claim',attempt:1});assert.ok(first.lease);assert.equal(first.hostOnline,true);
  await assert.rejects(f.agents[2].houseAgents(1,{operation:'claim',attempt:1}),e=>e.status===409);
  await assert.rejects(f.agents[2].houseAgents(1,{operation:'heartbeat',attempt:1,lease:first.lease,status:'starting'}),e=>e.status===409);
  await assert.rejects(f.agents[1].houseAgents(1,{operation:'heartbeat',attempt:1,lease:first.lease,status:'playing'}),e=>e.status===409);
  assert.ok(!JSON.stringify(f.store.publicView(1)).includes(first.lease));
  f.advance(120001);assert.equal(f.store.houseRequest(1).hostOnline,false);
  const next=await f.agents[2].houseAgents(1,{operation:'claim',attempt:1});assert.notEqual(next.lease,first.lease);
  await assert.rejects(f.agents[1].houseAgents(1,{operation:'heartbeat',attempt:1,lease:first.lease,status:'starting'}),e=>e.status===409);
  await f.agents[2].houseAgents(1,{operation:'heartbeat',attempt:1,lease:next.lease,status:'failed',code:'funds'});
  assert.match(f.store.houseRequest(1).message,/test USDC/);
  const second=await f.agents[0].houseAgents(1);assert.equal(second.attempt,2);
  await assert.rejects(f.agents[2].houseAgents(1,{operation:'claim',attempt:1}),e=>e.status===409);
  const reopened=new SeasonStore({db:f.store.db,bookScope:config.scope,participation});
  assert.equal(reopened.houseRequest(1).attempt,2);assert.equal(reopened.houseRequest(1).status,'queued');
});

test('requested houses use normal signed joins and decisions, reporting play only after all seats confirm',async t=>{
  const f=fixture(t);await f.agents[0].join(1,{name:'Human'});await f.agents[0].houseAgents(1);
  const claim=await f.agents[1].houseAgents(1,{operation:'claim',attempt:1});
  for(const i of [1,2,3])await f.agents[i].join(1,{name:`House ${i}`});
  await f.agents[1].houseAgents(1,{operation:'heartbeat',attempt:1,lease:claim.lease,status:'playing'});
  for(const i of [1,2,3]){const {observation}=await f.agents[i].observe(1);await f.agents[i].submit(1,observation.day,demoHouseDecision(observation,['value','premium','adaptive'][i-1]));}
  const summary=f.store.summary(f.store.get(1));assert.equal(summary.houseRequest.status,'playing');assert.equal(summary.submitted.length,3);assert.equal(summary.customerBudget,200000);
  assert.equal((await f.agents[0].houseAgents(1)).attempt,1);
  await assert.rejects(f.agents[1].houseAgents(1,{operation:'heartbeat',attempt:1,lease:claim.lease,status:'finished'}),e=>e.status===409);
});

test('house address allowlisting still requires a valid wallet signature and single-use challenge',async t=>{
  const {store}=fixture(t),gate=new AgentKitGate({store,config,book:{lookupHuman:async()=>{throw Error('House bypasses only identity lookup');}}});
  const url=base+'/api/seasons/1/join',challenge=await gate.challenge(url,'POST','{}');
  const client=createAgentkitClient({signer:{address:accounts[1].address,chainId:'eip155:480',type:'eip191',signMessage:message=>accounts[1].signMessage({message})}});
  const header=await client.createHeader(challenge.extensions.agentkit),payload=JSON.parse(Buffer.from(header,'base64').toString());
  payload.address=accounts[2].address;
  await assert.rejects(gate.authenticate(Buffer.from(JSON.stringify(payload)).toString('base64'),url,'POST','{}'),e=>e.status===401);
  const owner=await gate.authenticate(header,url,'POST','{}');assert.equal(owner.participantKind,'house');assert.equal(owner.humanId,houseIdentity(accounts[1].address));
  await assert.rejects(gate.authenticate(header,url,'POST','{}'),e=>e.status===401);
});

test('demo configuration requires three unique wallets and cannot relabel funded competition or house history',t=>{
  for(const overrides of [{DEMO_AGENT_ADDRESSES:''},{DEMO_AGENT_ADDRESSES:accounts[1].address},{DEMO_AGENT_ADDRESSES:[accounts[1].address,accounts[1].address,accounts[2].address].join(',')},{SEASON_MODE:'competition'}])assert.throws(()=>seasonParticipation({...env,...overrides}));
  for(const occupied of ['empty','seat','pending']){
    const db=openSeasonDatabase(':memory:');t.after(()=>db.close());const store=new SeasonStore({db,bookScope:config.scope});
    if(occupied==='seat')store.join(1,identity(0),{name:'Existing'});
    if(occupied==='pending'){db.exec('CREATE TABLE arc_jobs(id INTEGER)');db.exec('INSERT INTO arc_jobs VALUES (1)');}
    assert.throws(()=>new SeasonStore({db,bookScope:config.scope,participation}),/pinned/);
    const change=()=>new SeasonStore({db,bookScope:config.scope,participation,allowEmptyDemoMigration:true});
    if(occupied==='empty'){
      const demo=change();demo.join(1,identity(1),{name:'House'});
      assert.throws(()=>new SeasonStore({db,bookScope:config.scope,allowEmptyDemoMigration:true}),/pinned/);
      assert.equal(new SeasonStore({db,bookScope:config.scope,participation}).summary(demo.get(1)).entrants[0].humanBacked,false);
    }else assert.throws(change,/pinned/);
  }
  const db=openSeasonDatabase(':memory:');t.after(()=>db.close());
  assert.throws(()=>new ArcSeasonStore({db,participation,arc:{metadata:{chainId:1}}}),/restricted to Arc Testnet/);
});

test('pending Arc human deposits reserve the sole human slot before another funding ticket',async t=>{
  const db=openSeasonDatabase(':memory:');t.after(()=>db.close());
  const arc={metadata:{chainId:5042002,contract:accounts[6].address,token:ARC_USDC},verify:async()=>true};
  const store=new ArcSeasonStore({db,arc,bookScope:config.scope,participation});
  const ticket=await store.join(1,identity(0),{name:'Human'});
  await store.join(1,identity(0),{name:'Human',funding:{deadline:ticket.typedData.message.deadline,signature:'0x1234'}});
  await assert.rejects(store.join(1,identity(4),{name:'Second human'}),e=>e.status===409);
  assert.equal((await store.join(1,identity(1),{name:'House'})).fundingRequired,true);
  assert.equal(store.jobs(1).length,1);assert.equal(store.entries(1).length,0);
});

test('the human and three distinct built-in policies finish a season with conserved capital',async t=>{
  const f=fixture(t);
  for(let i=0;i<4;i++)await f.agents[i].join(1,{name:i?`House ${i}`:'Human'});
  const styles=['adaptive','value','premium','adaptive'];
  for(let n=0;n<400&&f.store.get(1).state.phase!=='finished';n++){
    for(let i=0;i<4;i++){const status=await f.agents[i].observe(1);if(status.observation?.self.active)await f.agents[i].submit(1,status.observation.day,demoHouseDecision(status.observation,styles[i]));}
    f.tick();
  }
  const state=f.store.get(1).state;assert.equal(state.phase,'finished');assert.equal(state.customerBudgetRemaining,0);
  assert.equal(state.agents.reduce((n,a)=>n+a.cash+a.spending+a.fees,0),400000);
  assert.equal(f.store.summary(f.store.get(1)).entrants.filter(e=>e.humanBacked).length,1);
});


test('explicit demo conversion preserves a sole waiting human deposit and rejects pending or mixed funding',t=>{
  for(const kind of ['confirmed','queued','other-wallet','other-season','day']){
    const db=openSeasonDatabase(':memory:');t.after(()=>db.close());const store=new SeasonStore({db,bookScope:config.scope});
    store.join(1,identity(0),{name:'Existing human'});
    db.exec('CREATE TABLE arc_jobs(kind TEXT,status TEXT,address TEXT,season_id INTEGER)');
    db.prepare('INSERT INTO arc_jobs VALUES (?,?,?,?)').run(kind==='day'?'day':'join',kind==='queued'?'queued':'confirmed',accounts[kind==='other-wallet'?1:0].address.toLowerCase(),kind==='other-season'?2:1);
    const before=db.prepare('SELECT * FROM entrants').get(),state=store.get(1).state;
    const convert=()=>new SeasonStore({db,bookScope:config.scope,participation,allowSingleHumanDemoMigration:true});
    if(kind==='confirmed'){
      const demo=convert();assert.deepEqual(db.prepare('SELECT * FROM entrants').get(),before);assert.deepEqual(demo.get(1).state,state);
      assert.equal(demo.summary(demo.get(1)).entrants[0].humanBacked,true);assert.deepEqual(demo.summary(demo.get(1)).seatCounts,{human:1,house:0});
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM arc_jobs').get().n,1);
    }else assert.throws(convert,/pinned/);
  }
});
