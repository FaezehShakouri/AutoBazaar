import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {get as httpGet} from 'node:http';
import {privateKeyToAccount} from 'viem/accounts';
import {AgentController} from '../lib/agent-controller.mjs';
import {createDashboardServer,listenDashboard} from '../lib/agent-dashboard-server.mjs';
import {SeasonStore} from '../lib/season-store.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {createRemoteAgent} from '../lib/remote-agent.mjs';
import {createArenaServer} from '../server.mjs';
import {agentBookConfig} from '../lib/agentkit-auth.mjs';
import {promptFor,codexDecision} from '../lib/codex.mjs';
import {seasonParticipation} from '../lib/season-participation.mjs';

const keys=Array.from({length:5},(_,i)=>`0x${(i+10).toString(16).padStart(64,'0')}`),accounts=keys.map(privateKeyToAccount);
const hold={prices:{water:160},load:{water:0},orders:[{product:'water',supplier:'express',quantity:12}],rationale:'Test demand with a small water order.',memory:'Private agent sales notebook.'};
const owner={address:accounts[0].address.toLowerCase(),humanId:'owner-0'};
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(t,{decide=async()=>hold,filename=':memory:',demo=false}={}){
  let now=Date.now(),calls=0,submissions=0;
  const store=new SeasonStore({db:openSeasonDatabase(':memory:'),bookScope:agentBookConfig().scope,now:()=>now,turnMs:180000,intermissionMs:1,...(demo?{participation:seasonParticipation({SEASON_MODE:'demo',DEMO_AGENT_ADDRESSES:accounts.slice(1,4).map(a=>a.address).join(',')})}:{})});
  accounts.slice(0,demo?1:4).forEach((a,i)=>store.join(1,{address:a.address.toLowerCase(),humanId:`owner-${i}`},{name:`Owner ${i}`,strategy:'Independent'}));
  const agent={address:accounts[0].address,dashboard:async()=>store.dashboard(1,owner),houseAgents:async season=>store.manageHouseAgents(season,owner),submit:async(season,day,decision)=>{submissions++;return store.submit(season,owner,{day,decision});}};
  const db=openSeasonDatabase(filename),controller=new AgentController({db,agent,season:1,server:'http://127.0.0.1:9999',decide:async obs=>{calls++;return decide(obs);},now:()=>now});
  t.after(()=>{db.close();store.close();});
  return {controller,db,store,agent,get calls(){return calls;},get submissions(){return submissions;},advance(ms){now+=ms;store.tick();}};
}
test('dashboard house control requests rivals without playing, changing mode or charging the human again',async t=>{
  const f=fixture(t,{demo:true}),server=createDashboardServer({controller:f.controller}),url=await listenDashboard(server,0);
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const page=await(await fetch(url)).text(),token=/name="dashboard-token" content="([^"]+)"/.exec(page)[1];
  const post=()=>fetch(url+'/api/house-agents',{method:'POST',headers:{'Content-Type':'application/json','x-dashboard-token':token},body:'{}'});
  const denied=await fetch(url+'/api/house-agents',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
  const results=await Promise.all([post(),post()]);for(const response of results){assert.equal(response.status,200);assert.equal((await response.json()).attempt,1);}
  assert.equal(f.controller.view.season.houseRequest.status,'queued');assert.equal(f.controller.mode(),'paused');
  assert.equal(f.calls,0);assert.equal(f.submissions,0);assert.equal(f.store.entries(1).length,1);assert.equal(f.store.get(1).state.customerBudgetTotal,50000);
  const normal=fixture(t);await assert.rejects(normal.controller.addHouseAgents(),e=>e.status===409);
});
test('owner guidance reaches Codex; pause, review and approval preserve the exact inspected decision',async t=>{
  let observation;const f=fixture(t,{decide:async obs=>{observation=obs;return hold;}}),c=f.controller;
  await c.tick();assert.equal(f.calls,0);assert.equal(c.mode(),'paused');
  c.saveStrategy({instructions:'Keep 0.15 USDC as reserve.',expectedRevision:1});c.setMode('review');await c.tick();
  assert.equal(f.calls,1);assert.equal(f.submissions,0);assert.equal(c.draft().status,'draft');
  assert.equal(observation.ownerStrategy.revision,2);assert.match(promptFor(observation),/Keep 0.15 USDC as reserve/);assert.match(promptFor(observation),/No shell, file, browser, network or external tools/);
  await c.approve(c.draft().id);assert.equal(f.submissions,1);assert.equal(c.draft().status,'submitted');
  assert.deepEqual(c.view.decisions[0].decision,hold);assert.equal(c.view.decisions[0].status,'submitted');
  c.saveStrategy({instructions:'Try premium pricing tomorrow.',expectedRevision:2});await c.tick();assert.equal(f.calls,1);assert.deepEqual(c.view.decisions[0].decision,hold);
});
test('automatic submits once under concurrent ticks and approvals; next day uses new guidance',async t=>{
  const f=fixture(t),c=f.controller;c.setMode('automatic');
  await Promise.all([c.tick(),c.tick(),c.tick()]);assert.equal(f.calls,1);assert.equal(f.submissions,1);
  c.saveStrategy({instructions:'Focus on water.',expectedRevision:1});
  f.advance(180001);f.advance(2);await c.tick();assert.equal(f.calls,2);assert.equal(f.submissions,2);assert.equal(c.draft().revision,2);
});
test('strategy edits during model execution discard stale output before any submission',async t=>{
  const started=later(),finish=later();const f=fixture(t,{decide:async()=>{started.resolve();await finish.promise;return hold;}}),c=f.controller;
  c.setMode('automatic');const run=c.tick();await started.promise;
  c.saveStrategy({instructions:'New private strategy.',expectedRevision:1});finish.resolve();await run;
  assert.equal(c.draft().status,'superseded');assert.equal(f.submissions,0);
  await c.tick();assert.equal(f.calls,2);assert.equal(f.submissions,1);assert.equal(c.draft().revision,2);
});
test('pause during thinking retains an unsubmitted draft; expired windows never submit',async t=>{
  const started=later(),finish=later();const f=fixture(t,{decide:async()=>{started.resolve();await finish.promise;return hold;}}),c=f.controller;
  c.setMode('automatic');const run=c.tick();await started.promise;c.setMode('paused');finish.resolve();await run;
  assert.equal(c.draft().status,'draft');assert.equal(f.submissions,0);await assert.rejects(c.approve(c.draft().id),e=>e.status===409);
  c.setMode('review');f.advance(180001);await assert.rejects(c.approve(c.draft().id),e=>e.status===409);assert.equal(f.submissions,0);assert.equal(c.draft().status,'expired');
});
test('failed model calls require retry; simultaneous approvals sign only once',async t=>{
  let bad=true;const f=fixture(t,{decide:async()=>{if(bad)throw Error('Model unavailable');return hold;}}),c=f.controller;
  c.setMode('review');await c.tick();await c.tick();assert.equal(f.calls,1);assert.equal(c.draft().status,'error');
  bad=false;await c.retry();await c.tick();const results=await Promise.allSettled([c.approve(c.draft().id),c.approve(c.draft().id)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.submissions,1);
});
test('lost submit response reconciles against private server history without a second spend',async t=>{
  const f=fixture(t),c=f.controller,submit=f.agent.submit;
  f.agent.submit=async(...args)=>{await submit(...args);throw Error('Response lost');};
  c.setMode('automatic');await c.tick();assert.equal(c.draft().status,'uncertain');assert.equal(f.submissions,1);
  await c.tick();assert.equal(c.draft().status,'submitted');assert.equal(f.submissions,1);
  await assert.rejects(c.retry(),e=>e.status===409);
});
test('an uncertain submission retries the identical persisted decision, never a fresh model call',async t=>{
  const f=fixture(t),c=f.controller,submit=f.agent.submit;let fail=true;
  f.agent.submit=async(...args)=>{if(fail)throw Error('Offline before send');return submit(...args);};
  c.setMode('automatic');await c.tick();assert.equal(c.draft().status,'uncertain');await c.tick();assert.equal(f.calls,1);
  fail=false;await c.retry();await c.tick();assert.equal(f.calls,1);assert.equal(f.submissions,1);assert.deepEqual(c.view.decisions[0].decision,hold);
});
test('private instructions and drafts survive restart, with scope and revision conflicts rejected',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'agent-control-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const f=fixture(t,{filename:join(dir,'private.sqlite')}),c=f.controller;
  c.saveStrategy({instructions:'Private reserve target.',expectedRevision:1});c.setMode('review');await c.tick();
  const again=new AgentController({db:f.db,agent:f.agent,season:1,server:c.server,decide:async()=>hold});
  assert.equal(again.strategy().instructions,'Private reserve target.');assert.deepEqual(again.draft().decision,hold);
  assert.throws(()=>again.saveStrategy({instructions:'Stale edit.',expectedRevision:1}),e=>e.status===409);
  assert.throws(()=>again.saveStrategy({instructions:'x'.repeat(6001),expectedRevision:2}),e=>e.status===400);
  assert.throws(()=>new AgentController({db:f.db,agent:f.agent,season:2,server:c.server,decide:async()=>hold}),/different wallet or season/);
  c.setDraft(c.draft().id,'submitting');const restarted=new AgentController({db:f.db,agent:f.agent,season:1,server:c.server,decide:async()=>hold});assert.equal(restarted.draft().status,'uncertain');
});
test('owner dashboard uses real AgentKit authentication and never reveals another seat notebook',async t=>{
  const humans=new Map(accounts.map((a,i)=>[a.address.toLowerCase(),`owner-${i}`]));
  const store=new SeasonStore({db:openSeasonDatabase(':memory:'),bookScope:agentBookConfig().scope});
  const server=createArenaServer({seasons:store,book:{lookupHuman:async address=>humans.get(address.toLowerCase())||null}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
  const agents=keys.map(privateKey=>createRemoteAgent({server:base,privateKey}));
  for(let i=0;i<4;i++)await agents[i].join(1,{name:`Owner ${i}`,strategy:'Independent'});
  assert.equal((await fetch(base+'/api/seasons/1/dashboard')).status,402);
  await assert.rejects(agents[4].dashboard(1),e=>e.status===403);
  const db=openSeasonDatabase(':memory:');t.after(()=>db.close());
  const c=new AgentController({db,agent:agents[0],season:1,server:base,decide:async obs=>{assert.equal(obs.ownerStrategy.instructions,'Top secret owner guidance.');return hold;}});
  c.saveStrategy({instructions:'Top secret owner guidance.',expectedRevision:1});c.setMode('review');await c.tick();await c.approve(c.draft().id);
  const privateView=await agents[0].dashboard(1),other=await agents[1].dashboard(1);
  assert.equal(privateView.decisions.length,1);assert.equal(other.decisions.length,0);
  assert.ok(!JSON.stringify(other).includes(hold.memory));
  for(let i=1;i<4;i++)await agents[i].submit(1,1,{...hold,memory:`Other private notebook ${i}`});
  const settled=await agents[0].dashboard(1);assert.equal(settled.decisions[0].status,'settled');assert.equal(settled.self.memory,hold.memory);assert.ok(settled.history.length>0);
  const publicView=await(await fetch(base+'/api/seasons/1/snapshot')).json();
  for(const secret of [hold.memory,'Top secret owner guidance.','Other private notebook'])assert.ok(!JSON.stringify(publicView).includes(secret));
  assert.ok(!JSON.stringify(settled).includes('Other private notebook'));
  humans.set(accounts[0].address.toLowerCase(),'new owner');await assert.rejects(agents[0].dashboard(1),e=>e.status===403);
});
test('localhost controls reject cross-origin, forged Host, missing tokens and invalid bodies',async t=>{
  const f=fixture(t);await f.controller.refresh();const server=createDashboardServer({controller:f.controller}),base=await listenDashboard(server,0);
  t.after(()=>new Promise(r=>server.close(r)));
  const page=await fetch(base+'/'),source=await page.text(),token=/name="dashboard-token" content="([a-f0-9]+)"/.exec(source)[1];
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(base+'/api/state')).status,403);
  const headers={'X-Dashboard-Token':token,'Content-Type':'application/json'},post=(path,body,extra={})=>fetch(base+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/api/state',{headers})).status,200);
  assert.equal((await post('/api/mode',{mode:'automatic'},{Origin:'https://evil.example'})).status,403);
  // Node fetch normalizes Host, so send the rebinding probe with raw HTTP.
  assert.equal(await new Promise((resolve,reject)=>httpGet(base+'/',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject)),403);
  assert.equal((await post('/api/strategy',{instructions:'x'.repeat(33000),expectedRevision:1})).status,413);
  assert.equal((await post('/api/strategy',[])).status,400);
  assert.equal((await post('/api/approve',{id:'1; DROP TABLE agent_drafts'})).status,400);
  assert.equal((await post('/api/mode',{mode:'invalid'})).status,400);
  assert.equal((await post('/api/join',{})).status,404);
  assert.equal((await post('/api/strategy',{instructions:'Keep a cash reserve.',expectedRevision:1})).status,200);
  assert.equal((await post('/api/mode',{mode:'review'})).status,200);await f.controller.tick();
  assert.equal((await post('/api/approve',{id:f.controller.draft().id})).status,200);assert.equal(f.submissions,1);
  assert.equal((await fetch(base+'/.agent.env',{headers})).status,404);
  assert.equal((await fetch(base+'/agent-dashboard.js')).status,200);
});
test('a busy dashboard port falls forward to the next free localhost port',async t=>{
  const f=fixture(t),one=createDashboardServer({controller:f.controller});await listenDashboard(one,0);
  const two=createDashboardServer({controller:f.controller});const url=await listenDashboard(two,one.address().port);
  t.after(()=>Promise.all([one,two].map(s=>new Promise(r=>s.close(r)))));
  assert.notEqual(two.address().port,one.address().port);assert.equal((await fetch(url)).status,200);
});
test('Codex gets owner guidance through stdin with tools disabled and without game signing secrets',async t=>{
  const f=fixture(t);await f.controller.refresh();
  const names=['AGENT_PRIVATE_KEY','ARC_OPERATOR_PRIVATE_KEY','ARC_RPC_URL','WORLD_ID_SIGNING_KEY'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  names.forEach(n=>process.env[n]='test-only-secret');t.after(()=>names.forEach(n=>{if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}));
  let input='';
  const result=await codexDecision({...f.controller.view.observation,ownerStrategy:{revision:9,instructions:'Maintain a reserve.'}},{binary:process.execPath,spawnFn:(_binary,args,options)=>{
    names.forEach(n=>assert.equal(options.env[n],undefined));assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('features.shell_tool=false'));assert.ok(args.includes('--ephemeral'));assert.equal(options.stdio[0],'pipe');
    const child=new EventEmitter();child.stdin=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin.on('data',chunk=>input+=chunk);child.stdin.on('finish',()=>{writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(hold)).then(()=>child.emit('close',0));});return child;
  }});
  assert.deepEqual(result,hold);assert.match(input,/Maintain a reserve/);assert.ok(!input.includes('test-only-secret'));
});
