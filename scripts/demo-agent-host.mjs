import {parseArgs} from 'node:util';
import {readFile,mkdir,open,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {privateKeyToAccount} from 'viem/accounts';
import {createPublicClient,http,erc20Abi,isAddress} from 'viem';
import {createRemoteAgent} from '../lib/remote-agent.mjs';
import {ARC_CHAIN,ARC_USDC,arcErrorMessage} from '../lib/arc.mjs';

// Host-only supervisor. Players send authenticated requests; private house keys
// remain on this computer. Each requested season uses the existing signed runner.
process.umask(0o077);
const {values}=parseArgs({options:{server:{type:'string'},'arc-contract':{type:'string'},help:{type:'boolean'}}});
if(values.help){console.log('npm run demo:host -- --server https://GAME --arc-contract REVIEWED_ESCROW\nServes human-requested demo seasons, one at a time, using .demo-wallets.json and built-in policies. Each new season uses 1 test USDC per house plus approval gas. Never tops up wallets automatically. Keep this host process running.');process.exit(0);}
if(!values.server||!isAddress(values['arc-contract']||''))throw Error('Provide --server and the reviewed --arc-contract.');
const root=new URL('../',import.meta.url),directory=new URL('.runs/',root),contract=values['arc-contract'].toLowerCase();
let wallets;
try{
  wallets=JSON.parse(await readFile(new URL('.demo-wallets.json',root),'utf8'));
  if(wallets.length!==3||new Set(wallets.map(w=>w.address.toLowerCase())).size!==3||wallets.some(w=>privateKeyToAccount(w.privateKey).address.toLowerCase()!==w.address.toLowerCase()))throw Error();
}catch{throw Error('A valid private .demo-wallets.json with the three configured house wallets is required.');}
const agent=createRemoteAgent({server:values.server,privateKey:wallets[0].privateKey,arcContract:contract});
const client=createPublicClient({chain:ARC_CHAIN,transport:http(ARC_CHAIN.rpcUrls.default.http[0],{timeout:15000,retryCount:1})});
function checkServer(data){
  if(data.participation?.mode!=='demo'||data.participation.houseAddresses.length!==3||wallets.some(w=>!data.participation.houseAddresses.includes(w.address.toLowerCase())))throw Error('The server does not configure these three house wallets.');
  if(data.arc?.chainId!==5042002||data.arc.contract.toLowerCase()!==contract||data.arc.token.toLowerCase()!==ARC_USDC.toLowerCase())throw Error('The server differs from the pinned Arc Testnet escrow.');
}
checkServer(await agent.list());
await mkdir(directory,{recursive:true});
const key=createHash('sha256').update(values.server+'|'+contract).digest('hex').slice(0,16),lockFile=new URL(`demo-host-${key}.lock`,directory);
try{
  const prior=JSON.parse(await readFile(lockFile,'utf8'));
  let alive=true;try{process.kill(prior.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
  if(alive)throw Error(`A house host is already running (PID ${prior.pid}).`);
  await unlink(lockFile);
}catch(e){if(e.code!=='ENOENT')throw e;}
const lock=await open(lockFile,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid,server:values.server,contract}));await lock.close();
let stopped=false,active=null;
const cancel=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopped=true;cancel.abort();active?.child?.kill('SIGTERM');});
async function report(status,code){return agent.houseAgents(active.id,{operation:'heartbeat',attempt:active.attempt,lease:active.lease,status,...(code?{code}:{})});}
async function start(season){
  const claimed=await agent.houseAgents(season.id,{operation:'claim',attempt:season.houseRequest.attempt});
  active={id:season.id,attempt:claimed.attempt,lease:claimed.lease,child:null,exited:false};
  try{
    for(const wallet of wallets){
      if(season.entrants.some(e=>e.address.toLowerCase()===wallet.address.toLowerCase()))continue;
      const balance=await client.readContract({address:ARC_USDC,abi:erc20Abi,functionName:'balanceOf',args:[wallet.address]});
      if(balance<1100000n){console.error(`Season ${season.id}: ${wallet.name} needs at least 1.10 test USDC for entry and gas.`);await report('failed','funds');active=null;return;}
      await report('starting');
    }
    if(stopped){await report('failed','stopped');active=null;return;}
    const env={...process.env};delete env.ARC_OPERATOR_PRIVATE_KEY;delete env.WORLD_ID_SIGNING_KEY;delete env.AGENT_PRIVATE_KEY;
    const job=active;
    job.child=spawn(process.execPath,[fileURLToPath(new URL('scripts/demo-agents.mjs',root)),'--server',values.server,'--season',String(season.id),'--arc-contract',contract],{cwd:fileURLToPath(root),env,stdio:['ignore','pipe','pipe']});
    for(const stream of [job.child.stdout,job.child.stderr])createInterface({input:stream}).on('line',line=>console.log(`[Season ${season.id}] ${line}`));
    job.child.on('error',()=>{job.exited=true;});
    job.child.on('exit',()=>{job.exited=true;});
    console.log(`House request accepted for season ${season.id}. Starting Penny, Nova and Sage.`);
  }catch(error){await report('failed','runner').catch(()=>{});active=null;throw error;}
}
console.log(`AutoBazaar house host ready · ${values.server}\nWaiting for a registered human to select “Add 3 house agents”. One season at a time; built-in strategies; keys stay local.`);
try{
  while(!stopped){
    try{
      const data=await agent.list();checkServer(data);
      if(active){
        const season=data.seasons.find(s=>s.id===active.id);
        if(!season)throw Error('The active season is no longer listed.');
        if(season.status==='finished'){
          active.child?.kill('SIGTERM');
          if(active.child&&!active.exited)await new Promise(resolve=>active.child.once('exit',resolve));
          await report('finished');
          active=null;
        }else if(active.exited){await report('failed','runner');active=null;}
        else await report(season.seatCounts.house===3?'playing':'starting');
      }else{
        const next=data.seasons.filter(s=>s.status!=='finished'&&s.seatCounts.human===1&&s.houseRequest&&['queued','starting','playing'].includes(s.houseRequest.status)&&!s.houseRequest.hostOnline).sort((a,b)=>a.id-b.id)[0];
        if(next)await start(next);
      }
    }catch(error){
      console.error('House host:',arcErrorMessage(error));
      // Stop signing if we cannot renew ownership of the request. The expired
      // lease can then be reclaimed; confirmed seats and deposits are reused.
      if(active){const job=active;job.child?.kill('SIGTERM');await report('failed','runner').catch(()=>{});if(job.child&&!job.exited)await new Promise(resolve=>job.child.once('exit',resolve));active=null;}
    }
    if(!stopped)try{await sleep(8000,undefined,{signal:cancel.signal});}catch{}
  }
}finally{
  if(active){active.child?.kill('SIGTERM');await report('failed','stopped').catch(()=>{});if(active.child&&!active.exited)await new Promise(resolve=>active.child.once('exit',resolve));}
  await unlink(lockFile).catch(()=>{});
}
