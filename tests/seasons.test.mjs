import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SeasonStore} from '../lib/season-store.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {agentBookConfig,AgentKitGate} from '../lib/agentkit-auth.mjs';
import {createArenaServer} from '../server.mjs';
import {createRemoteAgent} from '../lib/remote-agent.mjs';
import {createAgentkitClient} from '@worldcoin/agentkit';
import {privateKeyToAccount} from 'viem/accounts';
import {decide} from '../examples/steady-agent.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const runFile=promisify(execFile);

const config=agentBookConfig();
// Public, deterministic test wallets only. The deployed server has no mock mode.
const keys=Array.from({length:6},(_,i)=>`0x${(i+1).toString(16).padStart(64,'0')}`);
const accounts=keys.map(privateKeyToAccount);
const identity=i=>({address:accounts[i].address.toLowerCase(),humanId:`human-${i}`});
const hold={prices:{},load:{},orders:[],rationale:'Hold.',memory:'private notebook'};
const profile=i=>({name:`Contender ${i+1}`,strategy:'Independent'});
function localStore(t,options={}){const store=new SeasonStore({db:openSeasonDatabase(':memory:'),bookScope:config.scope,...options});t.after(()=>store.close());return store;}
function fill(store,id=1){for(let i=0;i<4;i++)store.join(id,identity(i),profile(i));}
async function fixture(t,{mapping,filename=':memory:',publicOrigin}={}){
  const store=new SeasonStore({db:openSeasonDatabase(filename),bookScope:config.scope});
  const humans=mapping||new Map(accounts.map((a,i)=>[a.address.toLowerCase(),`human-${i}`]));
  const book={lookupHuman:async address=>humans.get(address.toLowerCase())||null};
  const server=createArenaServer({seasons:store,book,publicOrigin});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const agents=keys.map(privateKey=>createRemoteAgent({server:base,privateKey}));
  return {store,server,base,agents,humans};
}
test('four real signed SDK clients fill a shared season and open the next lobby',async t=>{
  const {agents,store}=await fixture(t);
  await Promise.all(agents.slice(0,4).map((a,i)=>a.join(1,profile(i))));
  const first=store.summary(store.get(1));assert.equal(first.status,'running');assert.equal(first.registered,4);assert.equal(first.decidingDay,1);assert.equal(first.customerBudget,200000);
  assert.equal(store.get(2).state.phase,'lobby');
  await assert.rejects(agents[4].join(1,profile(4)),e=>e.status===409);
  assert.equal((await agents[4].join(2,profile(4))).season.registered,1);
});
test('same human across wallets is rejected; same wallet retries do not fund the wallet twice',async t=>{
  const humans=new Map([[accounts[0].address.toLowerCase(),'one human'],[accounts[1].address.toLowerCase(),'one human']]);
  const {agents,store}=await fixture(t,{mapping:humans});
  await agents[0].join(1,profile(0));assert.equal((await agents[0].join(1,profile(0))).alreadyJoined,true);
  await assert.rejects(agents[1].join(1,profile(1)),e=>e.status===409);
  assert.equal(store.get(1).state.customerBudgetTotal,50000);
});
test('unregistered wallets, changed human ownership, and HTML agent names cannot enter or act',async t=>{
  const {agents,humans,store}=await fixture(t,{mapping:new Map([[accounts[0].address.toLowerCase(),'owner']])});
  await assert.rejects(agents[1].join(1,profile(1)),e=>e.status===403);
  await assert.rejects(agents[0].join(1,{name:'<img src=x>'}),e=>e.status===400);
  await agents[0].join(1,profile(0));humans.set(accounts[0].address.toLowerCase(),'new human');
  await assert.rejects(agents[0].observe(1),e=>e.status===403);assert.equal(store.entries(1).length,1);
});
test('AgentKit challenge binds body and exact URI; a concurrent replay is accepted once',async t=>{
  const {base,store}=await fixture(t),url=base+'/api/seasons/1/join',body=JSON.stringify(profile(0));
  const initial=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(initial.status,402);
  const challenge=await initial.json(),client=createAgentkitClient({signer:{address:accounts[0].address,chainId:'eip155:480',type:'eip191',signMessage:message=>accounts[0].signMessage({message})}});
  const header=await client.createHeader(challenge.extensions.agentkit);
  const send=(target=url,data=body,proof=header)=>fetch(target,{method:'POST',headers:{'Content-Type':'application/json',agentkit:proof},body:data});
  assert.equal((await send(url,JSON.stringify(profile(1)))).status,401);
  assert.equal((await send(url+'?different=1')).status,401);
  const payload=JSON.parse(Buffer.from(header,'base64').toString());payload.signature='0x'+'11'.repeat(65);
  assert.equal((await send(url,body,Buffer.from(JSON.stringify(payload)).toString('base64'))).status,401);
  const results=await Promise.all([send(),send()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);assert.equal(store.entries(1).length,1);
});
test('invented, altered, expired and method-swapped challenges fail closed',async t=>{
  const store=localStore(t),gate=new AgentKitGate({store,config,book:{lookupHuman:async()=> 'human'}}),url='https://game.example/api/seasons/1/join';
  const client=createAgentkitClient({signer:{address:accounts[0].address,chainId:'eip155:480',type:'eip191',signMessage:message=>accounts[0].signMessage({message})}});
  const c=await gate.challenge(url,'POST','{}');
  const changed=structuredClone(c.extensions.agentkit);changed.info.statement='A different authorization';
  await assert.rejects(gate.authenticate(await client.createHeader(changed),url,'POST','{}'),e=>e.status===401);
  const header=await client.createHeader(c.extensions.agentkit);
  await assert.rejects(gate.authenticate(header,url,'GET','{}'),e=>e.status===401);
  store.db.prepare('UPDATE challenges SET expires=0').run();
  await assert.rejects(gate.authenticate(header,url,'POST','{}'),e=>e.status===401);
});
test('decisions remain hidden until settlement, lock once, and only the owner sees its notebook',async t=>{
  const {agents,store,base}=await fixture(t);for(let i=0;i<4;i++)await agents[i].join(1,profile(i));
  const before=await agents[0].observe(1);assert.equal(before.observation.day,1);assert.equal(before.observation.competitors[0].cash,undefined);
  await agents[0].submit(1,1,hold);assert.equal((await agents[0].submit(1,1,hold)).duplicate,true);
  await assert.rejects(agents[0].submit(1,1,{...hold,rationale:'changed'}),e=>e.status===409);
  const publicBefore=await(await fetch(base+'/api/seasons/1/snapshot')).json();assert.equal(publicBefore.state.day,0);assert.ok(!JSON.stringify(publicBefore).includes('private notebook'));
  for(let i=1;i<4;i++)await agents[i].submit(1,1,{...hold,memory:`secret ${i}`});
  assert.equal(store.get(1).state.day,1);const publicAfter=store.publicView(1);assert.ok(publicAfter.state.agents.every(a=>a.memory===''));
  assert.ok(!JSON.stringify(publicAfter).includes('human-'));assert.equal(publicAfter.state.rng,undefined);assert.equal(publicAfter.state.salesModel,undefined);
});
test('missed deadlines settle once and intermissions survive without a connected browser',t=>{
  let now=Date.now();const store=localStore(t,{now:()=>now,turnMs:1000,intermissionMs:500});fill(store);
  now+=1001;store.tick();const s=store.get(1);assert.equal(s.state.day,1);assert.equal(s.morning,null);assert.equal(s.state.agents[0].cash,49800);assert.match(s.state.agents[0].rationale,/deadline missed/);
  store.tick();assert.equal(store.get(1).state.day,1);
  now+=501;store.tick();assert.equal(store.get(1).morning.day,2);assert.equal(store.get(1).state.day,1);
  assert.throws(()=>store.submit(1,identity(0),{day:1,decision:hold}),e=>e.status===409);
});
test('seasons, notebooks and consumed nonces survive a process restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vending-seasons-'));t.after(()=>rm(dir,{recursive:true,force:true}));const filename=join(dir,'db.sqlite');
  let store=new SeasonStore({db:openSeasonDatabase(filename),bookScope:config.scope});fill(store);store.submit(1,identity(0),{day:1,decision:hold});
  store.saveChallenge({nonce:'persisted',expirationTime:new Date(Date.now()+60000).toISOString()},'POST','digest');store.consumeChallenge('persisted');store.close();
  store=new SeasonStore({db:openSeasonDatabase(filename),bookScope:config.scope});t.after(()=>store.close());assert.equal(store.entries(1).length,4);assert.equal(store.observe(1,identity(0)).submitted,true);assert.equal(store.challenge('persisted').consumed,1);
  assert.throws(()=>store.consumeChallenge('persisted'),e=>e.status===401);assert.equal(store.get(2).state.phase,'lobby');
});
test('a complete independent-agent season archives results and conserves simulated entry capital',async t=>{
  let now=Date.now();const store=localStore(t,{now:()=>now,intermissionMs:1});fill(store);
  for(let turn=0;turn<400&&store.get(1).state.phase!=='finished';turn++){
    for(let i=0;i<4;i++){const o=store.observe(1,identity(i));if(o.observation?.self.active)store.submit(1,identity(i),{day:o.observation.day,decision:await decide(o.observation)});}
    now+=2;store.tick();
  }
  const s=store.get(1),summary=store.summary(s);assert.equal(s.state.phase,'finished');assert.equal(s.state.customerBudgetRemaining,0);assert.equal(summary.standings.length,4);assert.ok(summary.standings.some(a=>a.rank===1));
  assert.equal(s.state.agents.reduce((n,a)=>n+a.cash+a.spending+a.fees,0),400000);assert.equal(store.get(2).state.phase,'lobby');
});
test('public hosting cannot launch local Codex or reset games; cross-origin and oversized requests are rejected',async t=>{
  const {base}=await fixture(t,{publicOrigin:'https://game.example'});
  assert.equal((await fetch(base+'/api/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
  assert.equal((await fetch(base+'/api/step',{method:'POST'})).status,404);
  const foreign=await fetch(base+'/api/seasons/1/join',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'});assert.equal(foreign.status,403);
  const large=await fetch(base+'/api/seasons/1/join',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(25000)});assert.equal(large.status,413);
});
test('production cannot silently switch to a custom or unconfigured sandbox AgentBook',()=>{
  assert.throws(()=>agentBookConfig({AGENTBOOK_CHAIN_ID:'8453'}),/canonical/);
  assert.throws(()=>agentBookConfig({AGENTBOOK_ENVIRONMENT:'sandbox'}),/Sandbox needs/);
});

for(const runner of ['scripts/remote-agent.mjs','dist/agent.mjs'])test(`${runner}: join-only confirms one seat without playing and safely resumes`,async t=>{
  const {store,base,agents}=await fixture(t);
  for(let i=0;i<3;i++)await agents[i].join(1,profile(i));
  const args=[runner,'--server',base,'--name','Setup Agent','--season','1','--join-only'];
  const options={timeout:20000,env:{...process.env,AGENT_PRIVATE_KEY:keys[3],AGENT_CHAIN_ID:'480',CODEX_BIN:'/missing-codex-for-join-only-test'}};
  const first=await runFile(process.execPath,args,options);
  assert.match(first.stdout,/Entry confirmed\. No decisions submitted/);
  assert.equal(store.summary(store.get(1)).status,'running');
  assert.equal(store.entries(1).length,4);
  assert.equal(store.observe(1,identity(3)).submitted,false);
  assert.equal(store.entries(2).length,0);
  const retry=await runFile(process.execPath,args,options);
  assert.match(retry.stdout,/Entry confirmed/);
  assert.equal(store.get(1).state.customerBudgetTotal,200000);
  assert.equal(store.observe(1,identity(3)).submitted,false);
  assert.equal(store.entries(2).length,0);
});

test('join-only rejects ambiguous seasons and playing flags before any network request',async()=>{
  const base=['scripts/remote-agent.mjs','--server','https://unreachable.invalid','--name','Setup Agent','--join-only'];
  for(const flags of [[],['--season','1','--follow'],['--season','1','--withdraw'],['--season','1','--codex'],['--season','1','--policy','./missing.mjs']]){
    await assert.rejects(runFile(process.execPath,[...base,...flags],{timeout:5000}),e=>e.code===1&&/--join-only requires --season/.test(e.stderr));
  }
  for(const season of ['0','-1','1.5','9007199254740993']){
    await assert.rejects(runFile(process.execPath,[...base,`--season=${season}`],{timeout:5000}),e=>e.code===1&&/positive safe integer/.test(e.stderr));
  }
});

test('standalone setup prompt and every dashboard download are served with usable content types',async t=>{
  const {base}=await fixture(t);
  for(const [file,type] of [['agent-guide.html','text/html'],['agent-guide.js','text/javascript'],['agent-guide.css','text/css'],['agent-setup.txt','text/plain'],['agent.mjs','text/javascript'],['agent-wallet.mjs','text/javascript'],['steady-agent.mjs','text/javascript'],['agent-dashboard.mjs','text/javascript'],['agent-dashboard.html','text/html'],['agent-dashboard.css','text/css'],['agent-dashboard.js','text/javascript']]){
    const response=await fetch(`${base}/${file}`);
    assert.equal(response.status,200,file);assert.equal(response.headers.get('content-type'),type,file);
    assert.ok((await response.text()).length>100,file);
  }
});
