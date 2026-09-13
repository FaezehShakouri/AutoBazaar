import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {createPublicClient,createWalletClient,http,zeroHash,erc20Abi} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
import {ArcChain} from '../lib/arc-chain.mjs';
import {ArcSeasonStore} from '../lib/arc-season-store.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {dayPermit,dayTypedData,emptyPermit,settlementCall} from '../lib/arc.mjs';
import {ARC_ABI} from '../lib/arc-abi.mjs';
import {decide} from '../examples/steady-agent.mjs';
import {AgentKitGate,agentBookConfig} from '../lib/agentkit-auth.mjs';
import {createAgentkitClient} from '@worldcoin/agentkit';
import {money,ECONOMY} from '../dist/engine.js';
import {seasonParticipation,houseIdentity} from '../lib/season-participation.mjs';

for(const demo of [false,true])test(`Arc ${demo?'one-human demo':'competition'} escrow agrees through funding, failures, a full season and payouts`,async t=>{
  const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const processAnvil=spawn(process.env.ANVIL_BIN||'anvil',['--port',String(port),'--silent'],{stdio:'ignore'});
  let startError;processAnvil.on('error',e=>{startError=e;});t.after(()=>{processAnvil.kill('SIGTERM');});
  const rpcUrl=`http://127.0.0.1:${port}`,transport=http(rpcUrl,{retryCount:0,timeout:2000});
  const client=createPublicClient({chain:foundry,transport,pollingInterval:10});
  for(let i=0;i<100;i++){if(startError)throw Error('Install Foundry anvil to run contract integration tests.');try{await client.getChainId();break;}catch{await sleep(30);}}
  const accounts=Array.from({length:8},(_,addressIndex)=>mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex}));
  const wallets=accounts.map(account=>createWalletClient({account,chain:foundry,transport}));
  const artifacts=await Promise.all(['MockUSDC','AutoBazaar'].map(async n=>JSON.parse(await readFile(new URL(`../contracts/artifacts/${n}.json`,import.meta.url)))));
  async function confirmed(hash){const receipt=await client.waitForTransactionReceipt({hash,pollingInterval:10});assert.equal(receipt.status,'success');return receipt;}
  const token=(await confirmed(await wallets[0].deployContract({...artifacts[0],args:[]}))).contractAddress;
  const contract=(await confirmed(await wallets[0].deployContract({...artifacts[1],args:[token,accounts[0].address,accounts.slice(5,8).map(a=>a.address),accounts[0].address]}))).contractAddress;
  const config={chain:foundry,rpcUrl,contract,token,maxGasUsdc:'10'};
  // Standard Anvil gas is ETH here. USDC transfers use a test-only six-decimal
  // token; live Arc native USDC accounting is checked by the separate smoke run.
  assert.equal(accounts[0].address.toLowerCase(),'0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  // Derive key from the HD account, avoiding a second mnemonic assumption.
  config.privateKey=`0x${Buffer.from(accounts[0].getHdKey().privateKey).toString('hex')}`;
  const arc=new ArcChain(config);const db=openSeasonDatabase(':memory:');let now=Date.now();
  const demoParticipation=seasonParticipation(demo?{SEASON_MODE:'demo',DEMO_AGENT_ADDRESSES:accounts.slice(2,5).map(a=>a.address).join(',')}:{});
  let participation=seasonParticipation();
  let store=new ArcSeasonStore({db,arc,participation,now:()=>now,turnMs:100000,intermissionMs:1});t.after(()=>db.close());
  const smartArtifact=JSON.parse(await readFile('contracts/artifacts/MockSmartWallet.json','utf8'));
  const smartAddress=(await confirmed(await wallets[0].deployContract({...smartArtifact,args:[accounts[7].address]}))).contractAddress;
  let registered=true;
  const gate=new AgentKitGate({store,config:agentBookConfig(),book:{lookupHuman:async address=>registered&&address.toLowerCase()===smartAddress.toLowerCase()?'smart-wallet fixture':null}});
  const smartClient=createAgentkitClient({signer:{address:smartAddress,chainId:'eip155:31337',type:'eip1271',signMessage:message=>accounts[7].signMessage({message})}});
  const fixtureUrl='https://game.example/api/seasons/1/join';
  const challenge=await gate.challenge(fixtureUrl,'POST','{}');
  assert.equal((await gate.authenticate(await smartClient.createHeader(challenge.extensions.agentkit),fixtureUrl,'POST','{}')).address,smartAddress.toLowerCase());
  registered=false;const unregistered=await gate.challenge(fixtureUrl,'POST','{}');
  await assert.rejects(gate.authenticate(await smartClient.createHeader(unregistered.extensions.agentkit),fixtureUrl,'POST','{}'),e=>e.status===403,'a valid Arc smart-wallet signature never bypasses World registration');
  const identities=accounts.slice(1,5).map((a,i)=>({address:a.address,humanId:demo&&i>0?houseIdentity(a.address):`test fixture ${i}`}));
  async function pump(){for(let i=0;i<100;i++){await store.pump();if(!store.db.prepare("SELECT 1 FROM arc_jobs WHERE status NOT IN ('confirmed','failed')").get())break;await sleep(10);}const failed=store.db.prepare("SELECT error FROM arc_jobs WHERE status='failed'").get();assert.equal(failed,undefined,failed?.error);}
  for(let i=0;i<4;i++){
    await confirmed(await wallets[0].writeContract({address:token,abi:artifacts[0].abi,functionName:'mint',args:[accounts[i+1].address,1000000n]}));
    const profile={name:`Test ${i}`,strategy:'Steady'};
    const ticket=await store.join(1,identities[i],profile);
    assert.equal(ticket.fundingRequired,true);assert.equal(store.entries(1).length,i);
    await confirmed(await wallets[i+1].writeContract({address:token,abi:erc20Abi,functionName:'approve',args:[contract,1000000n]}));
    const signature=await accounts[i+1].signTypedData(ticket.typedData);
    const pending=await store.join(1,identities[i],{...profile,funding:{deadline:ticket.typedData.message.deadline,signature}});
    assert.equal(pending.pending,true);assert.equal(store.entries(1).length,i);
    if(i===0){
      const broadcast=arc.broadcast.bind(arc);arc.broadcast=async raw=>{await broadcast(raw);throw Error('Simulated lost RPC response from https://rpc.example/v2/private-test-key after inclusion\nPrivate provider details');};
      await store.pump();assert.equal(store.entries(1).length,0);
      assert.match(store.jobs(1)[0].error,/\[RPC\]/);
      assert.doesNotMatch(JSON.stringify(store.jobs(1)),/private-test-key|Private provider details/,'public settlement errors must not expose provider credentials');
      // Reconstruct from SQLite as if the server restarted after sending USDC.
      store=new ArcSeasonStore({db,arc,participation,now:()=>now,turnMs:100000,intermissionMs:1});arc.broadcast=broadcast;
    }
    await pump();assert.equal(store.entries(1).length,i+1);
    if(demo&&i===0){
      const before=store.entries(1),balance=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[contract]});
      participation=demoParticipation;
      store=new ArcSeasonStore({db,arc,participation,allowSingleHumanDemoMigration:true,now:()=>now,turnMs:100000,intermissionMs:1});
      assert.deepEqual(store.entries(1),before);assert.equal(await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[contract]}),balance);
    }
    assert.equal((await store.join(1,identities[i],profile)).alreadyJoined,true);
  }
  assert.equal(store.summary(store.get(1)).entrants.filter(e=>e.humanBacked).length,demo?1:4);
  assert.equal(store.get(1).state.customerBudgetRemaining,200000);
  assert.equal(await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[contract]}),4000000n);
  assert.equal(money(150),'$0.0015');assert.equal(ECONOMY.microsPerUnit*50000,500000);
  const readOnlyCall=call=>client.simulateContract({address:contract,abi:ARC_ABI,account:accounts[0],...call});
  await assert.rejects(client.simulateContract({address:contract,abi:ARC_ABI,account:accounts[7],functionName:'settleDay',args:[1n,1,Array.from({length:4},emptyPermit),[],[],zeroHash,[50000,50000,50000,50000],200000]}));
  let dayCount=0;
  while(store.get(1).state.phase!=='finished'&&dayCount<400){
    for(let i=0;i<4;i++){
      const status=store.observe(1,identities[i]),obs=status.observation;if(!obs?.self.active)continue;
      const decision=await decide(obs);
      if(demo&&dayCount===0&&i===0)decision.orders=[{product:'cola',supplier:'express',quantity:13},{product:'nuts',supplier:'express',quantity:9}];
      const permit=dayPermit(obs,decision);
      const authorization=await accounts[i+1].signTypedData(dayTypedData(arc.metadata,{seasonId:1,day:obs.day,...permit}));
      if(dayCount===0&&i===0){await assert.rejects(store.submit(1,identities[i],{day:obs.day,decision,authorization:'0x1234'}),e=>e.status===403);}
      await store.submit(1,identities[i],{day:obs.day,decision,authorization});
    }
    assert.equal(store.get(1).state.day,dayCount,'unconfirmed cash is never published');
    assert.equal(store.observe(1,identities[0]).observation,null);
    if(dayCount===0){
      const planned=JSON.parse(store.db.prepare("SELECT payload FROM arc_jobs WHERE kind='day' ORDER BY id DESC LIMIT 1").get().payload);
      const altered=structuredClone(planned.call);altered.args[3][0].amount++;
      await assert.rejects(readOnlyCall(altered),'supplier quotes cannot be inflated');
      const overspend=structuredClone(planned.call);overspend.args[2][0].maxSupplySpend=0;
      overspend.args[2][0].signature=await accounts[1].signTypedData(dayTypedData(arc.metadata,{seasonId:1,day:1,...overspend.args[2][0]}));
      await assert.rejects(readOnlyCall(overspend),'a signed zero supplier limit cannot be exceeded');
      const excess=structuredClone(planned.call);excess.args[3]=[];excess.args[4]=Array.from({length:31},()=>({slot:0,product:0,amount:excess.args[2][0].prices[0]}));
      await assert.rejects(readOnlyCall(excess),'daily sales cannot exceed a 30-item machine shelf');
    }
    if(demo&&dayCount===0){
      // Recreate the actual legacy half-unit bug with genuine EIP-712 permits.
      const job=db.prepare("SELECT * FROM arc_jobs WHERE kind='day' ORDER BY id DESC LIMIT 1").get(),legacy=JSON.parse(job.payload);
      const permits=legacy.call.args[2];permits[0].maxSupplySpend=1980;
      permits[0].signature=await accounts[1].signTypedData(dayTypedData(arc.metadata,{seasonId:1,day:1,...permits[0]}));
      legacy.state.supplierPayments.find(o=>o.agent==='atlas'&&o.product==='nuts').amount-=9;
      legacy.state.agents[0].spending-=9;legacy.state.agents[0].cash+=9;
      legacy.state.agents[0].orders.find(o=>o.product==='nuts').total-=9;
      legacy.call=settlementCall(1,legacy.state,permits);
      db.prepare("UPDATE arc_permits SET permit=? WHERE season_id=1 AND day=1 AND slot='atlas'").run(JSON.stringify(permits[0]));
      db.prepare('UPDATE arc_jobs SET payload=? WHERE id=?').run(JSON.stringify(legacy),job.id);
      await store.pump();assert.equal(store.jobs(1)[0].status,'failed');assert.equal(store.jobs(1)[0].hash,null);assert.equal(store.get(1).state.day,0);
      store=new ArcSeasonStore({db,arc,participation,now:()=>now,turnMs:100000,intermissionMs:1});
      const repaired=JSON.parse(db.prepare('SELECT payload FROM arc_jobs WHERE id=?').get(job.id).payload);
      assert.equal(store.jobs(1)[0].status,'queued');assert.ok(store.jobs(1)[0].repair);
      assert.deepEqual(repaired.call.args[2],permits,'the repair must not widen any signed limit');
      assert.deepEqual(repaired.call.args[3].filter(o=>o.slot===0).map(o=>[o.product,o.amount]),[[1,1053]]);
      assert.equal(db.prepare('SELECT previous_payload FROM arc_job_repairs WHERE job_id=?').get(job.id).previous_payload,JSON.stringify(legacy));
    }
    await pump();dayCount++;
    const state=store.get(1).state;
    assert.equal(state.day,dayCount);
    if(dayCount===1){const replay=JSON.parse(store.db.prepare("SELECT payload FROM arc_jobs WHERE kind='day' ORDER BY id DESC LIMIT 1").get().payload).call;await assert.rejects(readOnlyCall(replay),'a settled day cannot be replayed');}
    const [budget,chainDay]=await client.readContract({address:contract,abi:ARC_ABI,functionName:'season',args:[1n]});
    assert.equal(Number(budget),state.customerBudgetRemaining);assert.equal(chainDay,dayCount);
    for(let i=0;i<4;i++){const machine=await client.readContract({address:contract,abi:ARC_ABI,functionName:'machine',args:[1n,i]});assert.equal(Number(machine.cash),state.agents[i].cash);assert.equal(Number(machine.arrears),state.agents[i].arrears);}
    assert.equal(Number(await client.readContract({address:contract,abi:ARC_ABI,functionName:'liabilityUnits'}))*10,Number(await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[contract]})));
    now+=2;store.tick();
  }
  const final=store.get(1).state;assert.equal(final.phase,'finished');assert.equal(final.customerBudgetRemaining,0);
  assert.ok(final.transactionHistory.length>0);assert.ok(final.transactionHistory.every(r=>/^0x[0-9a-f]{64}$/.test(r.hash)));
  assert.equal(final.agents.reduce((n,a)=>n+a.cash+a.spending+a.fees,0),400000);
  for(let i=0;i<4;i++){
    const pending=store.withdraw(1,identities[i]);assert.equal(pending.status,'queued');await pump();
    const balance=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[accounts[i+1].address]});assert.equal(balance,BigInt(final.agents[i].cash)*10n);
    assert.equal(store.withdraw(1,identities[i]).status,'confirmed');
    await assert.rejects(client.simulateContract({address:contract,abi:ARC_ABI,account:accounts[i+1],functionName:'withdraw',args:[1n,i]}));
  }
  assert.equal(await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[contract]}),0n);
  assert.equal(await client.readContract({address:contract,abi:ARC_ABI,functionName:'liabilityUnits'}),0n);
  await confirmed(await wallets[0].writeContract({address:token,abi:artifacts[0].abi,functionName:'mint',args:[accounts[1].address,1000000n]}));
  const ticket=await store.join(2,identities[0],{name:'Exit test'});
  await confirmed(await wallets[1].writeContract({address:token,abi:erc20Abi,functionName:'approve',args:[contract,1000000n]}));
  await store.join(2,identities[0],{name:'Exit test',funding:{deadline:ticket.typedData.message.deadline,signature:await accounts[1].signTypedData(ticket.typedData)}});await pump();
  await assert.rejects(readOnlyCall({functionName:'withdraw',args:[2n,0]}),'operator cannot extract a live seat');
  const beforeExit=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[accounts[1].address]});
  await client.request({method:'evm_increaseTime',params:[86401]});await client.request({method:'evm_mine',params:[]});
  await confirmed(await wallets[1].writeContract({address:contract,abi:ARC_ABI,functionName:'withdraw',args:[2n,0]}));
  assert.equal(await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[accounts[1].address]}),beforeExit+1000000n,'timeout returns both working capital and unused customer stake');
  for(let i=0;i<2;i++){now+=11000;await store.refreshChain();}assert.equal(store.get(2).state.finishReason,'operator_timeout');
  assert.equal(store.summary(store.get(2)).escrow.machines[0].claimed,true);
  t.diagnostic(`${dayCount} days; ${final.transactionHistory.length} individual purchase events; all game/USDC balances reconciled.`);
});
