import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {privateKeyToAccount} from 'viem/accounts';
const {values}=parseArgs({options:{server:{type:'string'},season:{type:'string',default:'1'},'arc-contract':{type:'string'},codex:{type:'boolean'},withdraw:{type:'boolean'},stop:{type:'boolean'},help:{type:'boolean'}}});
if(values.help){console.log('npm run demo:agents -- --server https://GAME --season 1 --arc-contract ESCROW [--codex | --withdraw | --stop]\nRuns exactly three configured house wallets for one season. Default: distinct built-in policies. --codex uses three local Codex processes. --withdraw claims their completed-season balances. Keep this process running during the demo. --stop stops the matching local house runner before switching policies.');process.exit(0);}
if(!values.server||!/^\d+$/.test(values.season)||Number(values.season)<1)throw Error('Provide --server and a positive --season.');
const base=new URL(values.server);if(base.origin!==values.server||base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('Use an HTTPS server origin, or loopback for local tests.');
await mkdir(new URL('../.runs/',import.meta.url),{recursive:true});
const lockFile=new URL(`../.runs/demo-agents-${base.hostname}-${values.season}.json`,import.meta.url);
let prior;
try{prior=JSON.parse(await readFile(lockFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
let priorRunning=false;
if(prior){
  try{const command=execFileSync('ps',['-p',String(prior.pid),'-o','command='],{encoding:'utf8',stdio:['ignore','pipe','ignore']});priorRunning=command.includes('demo-agents.mjs')&&command.includes(base.origin)&&prior.server===base.origin&&prior.season===values.season;}catch{}
}
if(values.stop){if(priorRunning){process.kill(prior.pid,'SIGTERM');console.log('Stopping the three local house agents. Their seats and funds remain in the season.');}else console.log('No matching local house runner is active.');process.exit(0);}
if(priorRunning)throw Error('These house agents are already running. Use the same server/season with --stop before switching policies.');
if(prior)await unlink(lockFile);
const wallets=JSON.parse(await readFile(new URL('../.demo-wallets.json',import.meta.url),'utf8'));
if(wallets.length!==3||wallets.some(w=>privateKeyToAccount(w.privateKey).address.toLowerCase()!==w.address.toLowerCase()))throw Error('Invalid demo wallet file.');
const response=await fetch(base.origin+'/api/seasons',{signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Server unavailable');
if(data.participation?.mode!=='demo'||data.participation.houseAddresses.length!==3||wallets.some(w=>!data.participation.houseAddresses.includes(w.address.toLowerCase())))throw Error('The host does not configure these three house wallets. Refusing to sign or pay.');
if(data.arc&&(data.arc.chainId!==5042002||data.arc.contract.toLowerCase()!==values['arc-contract']?.toLowerCase()))throw Error('Pin the exact Arc Testnet escrow shown by this server with --arc-contract.');
if(!data.seasons.some(s=>s.id===Number(values.season)))throw Error('Season does not exist.');
console.log(`Demo season ${values.season}: one World ID entrant + three house agents. ${values.withdraw?'Claiming completed payouts.':values.codex?'Using local Codex decisions.':'Using built-in value, premium and adaptive strategies.'}`);
await writeFile(lockFile,JSON.stringify({pid:process.pid,server:base.origin,season:values.season,codex:Boolean(values.codex)})+'\n',{flag:'wx',mode:0o600});
const children=[];
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{for(const child of children)child.kill(signal);});
const results=await Promise.all(wallets.map(wallet=>new Promise(resolve=>{
  const args=[fileURLToPath(new URL('./remote-agent.mjs',import.meta.url)),'--server',base.origin,'--season',values.season];
  if(values['arc-contract'])args.push('--arc-contract',values['arc-contract']);
  if(values.withdraw)args.push('--withdraw');
  else args.push('--name',wallet.name,'--strategy',`${values.codex?'Codex':'Built-in'} ${wallet.style}`,...(values.codex?['--codex']:['--policy',fileURLToPath(new URL('../examples/demo-house.mjs',import.meta.url))]));
  const env={...process.env,AGENT_PRIVATE_KEY:wallet.privateKey,DEMO_STYLE:wallet.style};
  delete env.ARC_OPERATOR_PRIVATE_KEY;delete env.WORLD_ID_SIGNING_KEY;
  const child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});children.push(child);
  for(const stream of [child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>console.log(`[${wallet.name}] ${line}`));
  child.on('error',error=>{console.error(`[${wallet.name}] Cannot start: ${error.message}`);resolve(1);});
  child.on('exit',(code,signal)=>resolve(code??(signal?130:1)));
})));
await unlink(lockFile);
process.exitCode=results.find(code=>code!==0)||0;
