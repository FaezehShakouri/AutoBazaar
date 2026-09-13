import {parseArgs} from 'node:util';
import {mkdir,open,readFile,writeFile,unlink,chmod,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {isAddress} from 'viem';
import {createRemoteAgent} from '../lib/remote-agent.mjs';
import {circleWallet} from '../lib/circle-wallet.mjs';
import {codexDecision} from '../lib/codex.mjs';
import {resolveCodexBinary} from '../lib/codex-binary.mjs';
import {openSeasonDatabase} from '../lib/sqlite.mjs';
import {AgentController} from '../lib/agent-controller.mjs';
import {createDashboardServer,listenDashboard} from '../lib/agent-dashboard-server.mjs';
import {arcErrorMessage} from '../lib/arc.mjs';

process.umask(0o077);
const {values}=parseArgs({options:{server:{type:'string'},season:{type:'string'},'circle-wallet':{type:'string'},'arc-contract':{type:'string'},port:{type:'string',default:'3210'},model:{type:'string'},help:{type:'boolean'}}});
if(values.help){console.log('npm run agent:dashboard -- --server https://GAME --season N --circle-wallet ADDRESS --arc-contract ESCROW [--port 3210] [--model MODEL]\nManage an already joined agent using local Codex. Starts paused; choose Review or Automatic in the dashboard. Without --circle-wallet, uses AGENT_PRIVATE_KEY from .agent.env. Never joins or funds a season.');process.exit(0);}
if(!values.server||!/^\d+$/.test(values.season||'')||Number(values.season)<1||!Number.isSafeInteger(Number(values.season)))throw Error('Provide --server and a positive --season. Use --help.');
if(!/^\d+$/.test(values.port)||Number(values.port)<1024||Number(values.port)>65526)throw Error('--port must be between 1024 and 65526.');
const arcContract=values['arc-contract']||process.env.ARC_CONTRACT_ADDRESS;
if(arcContract&&!isAddress(arcContract))throw Error('Invalid --arc-contract address.');
if(!values['circle-wallet']&&!/^0x[0-9a-f]{64}$/i.test(process.env.AGENT_PRIVATE_KEY||''))throw Error('Use --circle-wallet ADDRESS or set AGENT_PRIVATE_KEY in .agent.env.');
const serverOrigin=new URL(values.server).origin,season=Number(values.season);
const agent=createRemoteAgent({server:values.server,arcContract,account:values['circle-wallet']?circleWallet(values['circle-wallet']):undefined,privateKey:process.env.AGENT_PRIVATE_KEY,chainId:Number(process.env.AGENT_CHAIN_ID||480)});
// One controller per owner/season prevents accidentally launching two local
// dashboard runners. The remote server also enforces one locked decision/day.
const key=createHash('sha256').update(`${serverOrigin}|${agent.address.toLowerCase()}|${season}|${arcContract?.toLowerCase()||''}`).digest('hex').slice(0,20);
const directory=resolve('.runs');await mkdir(directory,{recursive:true,mode:0o700});
const lockPath=resolve(directory,`agent-dashboard-${key}.lock`);let lock;
try{lock=await open(lockPath,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  let prior;try{prior=JSON.parse(await readFile(lockPath,'utf8'));}catch{throw Error(`A dashboard lock exists. Check ${lockPath} before removing it.`);}
  let alive=true;try{process.kill(prior.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
  if(alive)throw Error(`This agent dashboard is already running${prior.url?` at ${prior.url}`:''} (PID ${prior.pid}).`);
  await unlink(lockPath);lock=await open(lockPath,'wx',0o600);
}
await lock.writeFile(JSON.stringify({pid:process.pid,wallet:agent.address,season}));await lock.close();
const dbPath=resolve(directory,`agent-dashboard-${key}.sqlite`),db=openSeasonDatabase(dbPath);await chmod(dbPath,0o600);
const controller=new AgentController({db,agent,season,server:serverOrigin,arcContract,decide:observation=>codexDecision(observation,{model:values.model})});
// A process restart is an explicit pause, even if it last ran automatically.
controller.setMode('paused');
let stopped=false,ticking=false;
async function tick(){if(stopped||ticking)return;ticking=true;try{await controller.tick();}catch(e){console.error(arcErrorMessage(e));}finally{ticking=false;}}
let assets=new URL('./',import.meta.url);try{await access(new URL('agent-dashboard.html',assets));}catch{assets=new URL('../dist/',import.meta.url);}
const http=createDashboardServer({controller,assets,onChange:()=>{void tick();}});let url;
try{url=await listenDashboard(http,Number(values.port));}catch(error){db.close();await unlink(lockPath);throw error;}
await writeFile(lockPath,JSON.stringify({pid:process.pid,url,wallet:agent.address,season}),{mode:0o600});
const timer=setInterval(()=>{void tick();},8000);
console.log(`AutoBazaar agent control room: ${url}\nWallet: ${agent.address}\nSeason ${season} · ${serverOrigin}\nPaused. Open the dashboard to save strategy and choose Review or Automatic. Keep this process running.\nPrivate strategy and drafts: ${dbPath}`);
resolveCodexBinary().catch(e=>console.error(`Codex setup: ${arcErrorMessage(e)}`));
void tick();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{
  stopped=true;controller.setMode('paused');clearInterval(timer);http.close();
  console.log('Dashboard paused. Waiting for any in-flight decision to finish…');
  const done=setInterval(async()=>{if(ticking||controller.submitting)return;clearInterval(done);db.close();await unlink(lockPath).catch(()=>{});process.exit(0);},250);
});
