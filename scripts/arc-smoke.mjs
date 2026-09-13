// Explicit contract-only test fixtures on a separate Arc Testnet deployment.
// These identities never enter World-authenticated public seasons.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createWalletClient,http,erc20Abi,encodeFunctionData,keccak256,parseUnits} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {createAgentkitClient} from '@worldcoin/agentkit';
import {AgentKitGate} from '../lib/agentkit-auth.mjs';
import {circleWallet} from '../lib/circle-wallet.mjs';
import {ArcChain} from '../lib/arc-chain.mjs';
import {ArcSeasonStore} from '../lib/arc-season-store.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {ARC_CHAIN,ARC_USDC,stringify,dayPermit,dayTypedData} from '../lib/arc.mjs';
import {decide} from '../examples/steady-agent.mjs';
const address=process.argv[2];if(!address)throw Error('Pass the funded Circle ARC-TESTNET wallet address.');
const deployment=JSON.parse(await readFile('contracts/deployments/arc-testnet-smoke.json','utf8'));
const main=JSON.parse(await readFile('contracts/deployments/arc-testnet.json','utf8'));
if(main.contract.toLowerCase()===deployment.contract.toLowerCase())throw Error('Test fixtures must use a separate contract from public seasons.');
const roles=JSON.parse(await readFile('.arc-wallets.json','utf8'));
const arc=new ArcChain({chain:ARC_CHAIN,rpcUrl:ARC_CHAIN.rpcUrls.default.http[0],token:ARC_USDC,contract:deployment.contract,privateKey:roles.operator.privateKey,maxGasUsdc:'0.50'});
const db=openSeasonDatabase('.runs/arc-smoke.sqlite'),store=new ArcSeasonStore({db,arc,bookScope:'contract-test-fixtures',turnMs:180000,intermissionMs:1});
let privateKeys;try{privateKeys=JSON.parse(await readFile('.runs/arc-smoke-wallets.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;privateKeys=Array.from({length:3},generatePrivateKey);await writeFile('.runs/arc-smoke-wallets.json',JSON.stringify(privateKeys)+'\n',{flag:'wx',mode:0o600});}
const accounts=[circleWallet(address,{binary:process.env.CIRCLE_BIN||resolve('node_modules/.bin/circle')}),...privateKeys.map(privateKeyToAccount)];
const identities=accounts.map((a,i)=>({address:a.address,humanId:`CONTRACT TEST FIXTURE ${i}; NOT A WORLD ID`}));
const signerTest='AutoBazaar Arc Testnet signing check; no payment authorization.';
if(!await arc.client.verifyMessage({address,message:signerTest,signature:await accounts[0].signMessage({message:signerTest})}))throw Error('Circle message signature did not match the expected wallet contract.');
const gate=new AgentKitGate({store,book:{lookupHuman:async()=> 'CONTRACT TEST SIGNATURE CHECK ONLY'}});
const fixtureUrl='https://autobazaar-test.invalid/api/seasons/1/join';
const challenge=await gate.challenge(fixtureUrl,'POST','{}');
const kit=createAgentkitClient({signer:{address,chainId:'eip155:5042002',type:'eip1271',signMessage:message=>accounts[0].signMessage({message})}});
await gate.authenticate(await kit.createHeader(challenge.extensions.agentkit),fixtureUrl,'POST','{}');
const balance=wallet=>arc.client.readContract({address:ARC_USDC,abi:erc20Abi,functionName:'balanceOf',args:[wallet]});
await arc.ready();
db.exec('CREATE TABLE IF NOT EXISTS smoke_transfers(op TEXT PRIMARY KEY,raw TEXT NOT NULL,hash TEXT NOT NULL)');
async function transferFixture(i){
  const op=`fixture:${i}`,prior=db.prepare('SELECT * FROM smoke_transfers WHERE op=?').get(op);
  let record=prior;
  if(!record){
    const data=encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[accounts[i].address,1100000n]});
    const gas=(await arc.client.estimateGas({account:arc.account,to:ARC_USDC,data}))*120n/100n;
    const fee=await arc.client.estimateFeesPerGas(),maxFeePerGas=fee.maxFeePerGas<21000000000n?21000000000n:fee.maxFeePerGas;
    if(gas*maxFeePerGas>parseUnits('0.10',18))throw Error('Fixture transfer gas exceeds 0.10 test USDC.');
    const raw=await arc.wallet.signTransaction({to:ARC_USDC,data,gas,nonce:await arc.client.getTransactionCount({address:arc.account.address,blockTag:'pending'}),type:'eip1559',maxFeePerGas,maxPriorityFeePerGas:1000000000n});
    record={raw,hash:keccak256(raw)};db.prepare('INSERT INTO smoke_transfers VALUES (?,?,?)').run(op,raw,record.hash);
  }
  let receipt;try{receipt=await arc.client.getTransactionReceipt({hash:record.hash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}
  if(!receipt){await arc.broadcast(record.raw);receipt=await arc.client.waitForTransactionReceipt({hash:record.hash,timeout:60000});}
  if(receipt.status!=='success')throw Error('Fixture funding reverted.');
}
async function pump(){
  for(let attempt=0;attempt<100;attempt++){
    await store.pump();
    const failed=db.prepare("SELECT error FROM arc_jobs WHERE status='failed' LIMIT 1").get();if(failed)throw Error(failed.error);
    if(!db.prepare("SELECT 1 FROM arc_jobs WHERE status NOT IN ('confirmed','failed') LIMIT 1").get())return;
    await sleep(1000);
  }
  throw Error('Arc is still pending. Rerun to resume the persisted transactions.');
}
try{
  for(let i=0;i<4;i++){
    if(store.entries(1).some(e=>e.address===accounts[i].address.toLowerCase()))continue;
    if(i)await transferFixture(i);
    const profile={name:`Arc fixture ${i+1}`,strategy:'Steady'};
    const ticket=await store.join(1,identities[i],profile);
    if(ticket.fundingRequired){
      const allowance=await arc.client.readContract({address:ARC_USDC,abi:erc20Abi,functionName:'allowance',args:[accounts[i].address,deployment.contract]});
      if(allowance!==1000000n){
        const wallet=createWalletClient({account:accounts[i],chain:ARC_CHAIN,transport:http(ARC_CHAIN.rpcUrls.default.http[0])});
        const hash=i?await wallet.writeContract({address:ARC_USDC,abi:erc20Abi,functionName:'approve',args:[deployment.contract,1000000n]}):await accounts[0].approve(deployment.contract,1000000n);
        const receipt=await arc.client.waitForTransactionReceipt({hash,timeout:60000});if(receipt.status!=='success')throw Error('Approval reverted.');
      }
      await store.join(1,identities[i],{...profile,funding:{deadline:ticket.typedData.message.deadline,signature:await accounts[i].signTypedData(ticket.typedData)}});
    }
    await pump();console.log(`Arc fixture ${i+1}: 1 test USDC entry confirmed.`);
  }
  while(store.get(1).state.phase!=='finished'){
    store.tick();
    for(let i=0;i<4;i++){
      const status=store.observe(1,identities[i]),obs=status.observation;if(!obs?.self.active||status.submitted)continue;
      const decision=await decide(obs),authorization=await accounts[i].signTypedData(dayTypedData(arc.metadata,{seasonId:1,day:obs.day,...dayPermit(obs,decision)}));
      await store.submit(1,identities[i],{day:obs.day,decision,authorization});
    }
    await pump();const s=store.get(1).state;
    const chain=await arc.snapshot(1);if(chain.day!==s.day||chain.customerBudget!==s.customerBudgetRemaining||chain.machines.some((m,i)=>m.cash!==s.agents[i].cash))throw Error('Live Arc cash did not reconcile with the game.');
    console.log(`Day ${s.day}: ${s.customerTransactions.length} purchases; customer budget ${(s.customerBudgetRemaining/100000).toFixed(5)} test USDC; ${s.arcReceipt?.hash}`);
    await sleep(30);
  }
  const final=store.get(1).state;
  for(let i=0;i<4;i++){store.withdraw(1,identities[i]);await pump();}
  const chain=await arc.snapshot(1);if(chain.customerBudget!==0||chain.machines.some(m=>!m.claimed||m.cash!==0)||await balance(deployment.contract)!==0n)throw Error('Escrow did not empty after payouts.');
  const report={purpose:'Separate contract-only test fixtures; no production World identities or seats',network:'Arc Testnet',contract:deployment.contract,circleWallet:address,days:final.day,purchases:final.transactionHistory.length,entryUsdc:'4.00',customerPoolUsdc:'2.00',reconciled:true,circleAgentkitSmartWalletSignatureVerified:true,escrowBalanceMicros:'0',payouts:final.agents.map((a,i)=>({wallet:accounts[i].address,amountUsdc:(a.cash/100000).toFixed(5)})),transactions:store.jobs(1)};
  await writeFile('contracts/deployments/arc-smoke-results.json',stringify(report)+'\n');const snapshot=store.publicView(1);snapshot.recordedAt=new Date().toISOString();snapshot.season.escrow={...chain,checkedAt:Date.now()};await writeFile('dist/arc-test-season.json',stringify(snapshot)+'\n');console.log(stringify({...report,transactions:`${report.transactions.length} confirmed game transactions`}));
}finally{db.close();}
