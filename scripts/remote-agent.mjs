import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {createRemoteAgent} from '../lib/remote-agent.mjs';
import {validateDecision,money} from '../dist/engine.js';

const {values}=parseArgs({options:{server:{type:'string'},name:{type:'string'},strategy:{type:'string',default:'Independent'},season:{type:'string'},policy:{type:'string'},codex:{type:'boolean'},follow:{type:'boolean'},'join-only':{type:'boolean'},'add-house-agents':{type:'boolean'},'circle-wallet':{type:'string'},'arc-contract':{type:'string'},'register-sandbox':{type:'boolean'},withdraw:{type:'boolean'},help:{type:'boolean'}}});
if(values.help){console.log('npm run agent -- --server https://GAME --name MyAgent (--codex | --policy ./my-policy.mjs) [--season 1] [--follow] [--circle-wallet ADDRESS] [--arc-contract ADDRESS]\nUse --join-only --season N instead of --codex/--policy to confirm one entry and exit without playing.\nUse --add-house-agents --season N after joining to request the three built-in demo rivals.\nUse --circle-wallet for Circle Agent Wallets or .agent.env for AGENT_PRIVATE_KEY. Pin --arc-contract to enable 1 test USDC entry per season; --follow authorizes another entry each season. Use --withdraw --season N to claim a finished season. Register first with: npx @worldcoin/agentkit-cli@0.2.0 register YOUR_AGENT_ADDRESS.');process.exit(0);}
if(values['register-sandbox'])throw Error('Sandbox enrollment has been retired. Use: npx @worldcoin/agentkit-cli@0.2.0 register YOUR_AGENT_ADDRESS');
const joinOnly=Boolean(values['join-only']),houseOnly=Boolean(values['add-house-agents']);
if(houseOnly&&(!values.season||joinOnly||values.follow||values.withdraw||values.codex||values.policy))throw Error('--add-house-agents requires --season and cannot be combined with playing, joining or withdrawal flags.');
if(joinOnly&&(!values.season||values.follow||values.withdraw||values.codex||values.policy))throw Error('--join-only requires --season and cannot be combined with --follow, --withdraw, --codex or --policy.');
if(!values.server||(!values.withdraw&&!houseOnly&&(!values.name||(!joinOnly&&Boolean(values.codex)===Boolean(values.policy)))))throw Error('Provide --server, --name and exactly one of --codex or --policy; or use --join-only --season N; or --withdraw --season N. Use --help.');
if(values.season&&(!/^[1-9]\d*$/.test(values.season)||!Number.isSafeInteger(Number(values.season))))throw Error('--season must be a positive safe integer.');
if(!values['circle-wallet']&&!/^0x[0-9a-f]{64}$/i.test(process.env.AGENT_PRIVATE_KEY||''))throw Error('Set AGENT_PRIVATE_KEY in .agent.env. Run npm run agent:wallet to create a new game wallet.');
const decide=values.withdraw||joinOnly||houseOnly?()=>{}:values.codex?(await import('../lib/codex.mjs')).codexDecision:(await import(pathToFileURL(resolve(values.policy)))).decide;
if(typeof decide!=='function')throw Error('Policy module must export async function decide(observation).');
const account=values['circle-wallet']?(await import('../lib/circle-wallet.mjs')).circleWallet(values['circle-wallet']):undefined;
const agent=createRemoteAgent({account,arcContract:values['arc-contract']||process.env.ARC_CONTRACT_ADDRESS,server:values.server,privateKey:process.env.AGENT_PRIVATE_KEY,chainId:Number(process.env.AGENT_CHAIN_ID||480)});
console.log(`Agent wallet: ${agent.address}. Decisions run on this computer; no private key is uploaded.`);
if(houseOnly){console.log(await agent.houseAgents(Number(values.season)));process.exit(0);}
if(values.withdraw){if(!values.season)throw Error('--withdraw requires --season.');console.log(await agent.withdraw(Number(values.season)));process.exit(0);}
let stopped=false;const cancel=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopped=true;cancel.abort();});
async function wait(){try{await sleep(5000,undefined,{signal:cancel.signal});}catch{}}
do{
  const seasons=await agent.list(),season=values.season?Number(values.season):seasons.seasons.filter(s=>s.status==='open').sort((a,b)=>a.id-b.id)[0]?.id;
  if(!season)throw Error('No open season is available.');
  let joined;
  do {
    try{joined=await agent.join(season,{name:values.name,strategy:values.strategy});if(joined.pending){console.log('Entry awaiting Arc confirmation.',joined.transaction);await wait();}}
    catch(error){if(![500,502,503,504].includes(error.status))throw error;console.error(error.message,'Retrying entry.');await wait();}
  } while((!joined||joined.pending)&&!stopped);
  if(stopped)break;
  console.log(`Joined season ${season}, seat ${joined.slot}. 0.50 customer stake + 0.50 operating cash (${joined.season.arc?'Arc test USDC':'simulated USDC'}). Identity: ${joined.season.entrants.find(a=>a.address.toLowerCase()===agent.address.toLowerCase())?.participantKind==='house'?'Demo house agent':'World AgentBook'}.`);
  if(joinOnly){console.log('Entry confirmed. No decisions submitted. Open your agent dashboard to start playing.');break;}
  let pending=null,announced=null;
  while(!stopped){
    try{
      const status=await agent.observe(season);
      if(status.season.status==='finished'){console.log(`Season ${season} finished.`,status.season.standings.map(a=>`${a.rank}. ${a.name}: ${money(a.cash)}`).join(' | '));break;}
      const obs=status.observation;
      if(obs&&!status.submitted&&obs.self.active){
        if(!pending||pending.day!==obs.day){
          console.log(`Day ${obs.day}: deciding. Deadline ${new Date(status.season.deadline).toISOString()}.`);
          pending={day:obs.day,decision:validateDecision(await decide(obs))};
        }
        if(Date.now()<status.season.deadline){await agent.submit(season,pending.day,pending.decision,obs);console.log(`Day ${pending.day}: decision locked.`);}
        else console.log(`Day ${obs.day}: decision finished after the deadline; fetching the next window.`);
      }else{const text=status.season.status==='open'?`Waiting for ${4-status.season.registered} more ${status.season.mode==='demo'?'demo participants':'human-backed agents'}.`:'Waiting for the next decision window.';if(text!==announced){console.log(text);announced=text;}}
    }catch(error){
      if([401,402,403].includes(error.status))throw error;
      console.error(error.message,'Retrying.');
    }
    await wait();
  }
  if(!values.follow||values.season)break;
}while(!stopped);
