import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {createRemoteAgent} from '../lib/remote-agent.mjs';
import {validateDecision} from '../dist/engine.js';

const {values}=parseArgs({options:{server:{type:'string'},name:{type:'string'},strategy:{type:'string',default:'Independent'},season:{type:'string'},policy:{type:'string'},codex:{type:'boolean'},follow:{type:'boolean'},help:{type:'boolean'}}});
if(values.help){console.log('npm run agent -- --server https://GAME --name MyAgent (--codex | --policy ./my-policy.mjs) [--season 1] [--follow]\nThe agent wallet stays in .agent.env as AGENT_PRIVATE_KEY. Register its public address with World AgentBook first.');process.exit(0);}
if(!values.server||!values.name||Boolean(values.codex)===Boolean(values.policy))throw Error('Provide --server, --name and exactly one of --codex or --policy. Use --help.');
if(!/^0x[0-9a-f]{64}$/i.test(process.env.AGENT_PRIVATE_KEY||''))throw Error('Set AGENT_PRIVATE_KEY in .agent.env. Run npm run agent:wallet to create a new game wallet.');
if(values.season&&!/^[1-9]\d*$/.test(values.season))throw Error('--season must be a positive integer.');
const decide=values.codex?(await import('../lib/codex.mjs')).codexDecision:(await import(pathToFileURL(resolve(values.policy)))).decide;
if(typeof decide!=='function')throw Error('Policy module must export async function decide(observation).');
const agent=createRemoteAgent({server:values.server,privateKey:process.env.AGENT_PRIVATE_KEY,chainId:Number(process.env.AGENT_CHAIN_ID||480)});
console.log(`Agent wallet: ${agent.address}. Decisions run on this computer; no private key is uploaded.`);
let stopped=false;const cancel=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopped=true;cancel.abort();});
async function wait(){try{await sleep(5000,undefined,{signal:cancel.signal});}catch{}}
do{
  const seasons=await agent.list(),season=values.season?Number(values.season):seasons.seasons.filter(s=>s.status==='open').sort((a,b)=>a.id-b.id)[0]?.id;
  if(!season)throw Error('No open season is available.');
  const joined=await agent.join(season,{name:values.name,strategy:values.strategy});
  console.log(`Joined season ${season}, seat ${joined.slot}. $500 stake + $500 operating cash, all simulated.`);
  let pending=null,announced=null;
  while(!stopped){
    try{
      const status=await agent.observe(season);
      if(status.season.status==='finished'){console.log(`Season ${season} finished.`,status.season.standings.map(a=>`${a.rank}. ${a.name}: $${(a.cash/100).toFixed(2)}`).join(' | '));break;}
      const obs=status.observation;
      if(obs&&!status.submitted&&obs.self.active){
        if(!pending||pending.day!==obs.day){
          console.log(`Day ${obs.day}: deciding. Deadline ${new Date(status.season.deadline).toISOString()}.`);
          pending={day:obs.day,decision:validateDecision(await decide(obs))};
        }
        if(Date.now()<status.season.deadline){await agent.submit(season,pending.day,pending.decision);console.log(`Day ${pending.day}: decision locked.`);}
        else console.log(`Day ${obs.day}: decision finished after the deadline; fetching the next window.`);
      }else{const text=status.season.status==='open'?`Waiting for ${4-status.season.registered} more human-backed agents.`:'Waiting for the next decision window.';if(text!==announced){console.log(text);announced=text;}}
    }catch(error){
      if([401,402,403].includes(error.status))throw error;
      console.error(error.message,'Retrying.');
    }
    await wait();
  }
  if(!values.follow||values.season)break;
}while(!stopped);
