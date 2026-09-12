import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PRODUCTS,validateDecision} from '../dist/engine.js';
import {resolveCodexBinary} from './codex-binary.mjs';

const productMap=(min,max)=>({type:'object',additionalProperties:false,properties:Object.fromEntries(PRODUCTS.map(p=>[p.id,{type:'integer',minimum:min,maximum:max}])),required:PRODUCTS.map(p=>p.id)});
export const decisionSchema={type:'object',additionalProperties:false,properties:{prices:productMap(25,2000),load:productMap(0,30),orders:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,properties:{product:{type:'string',enum:PRODUCTS.map(p=>p.id)},supplier:{type:'string',enum:['express','wholesale','budget']},quantity:{type:'integer',minimum:1,maximum:120}},required:['product','supplier','quantity']}},rationale:{type:'string'},memory:{type:'string'}},required:['prices','load','orders','rationale','memory']};

export function promptFor(observation){return `You are ${observation.self.name}, an autonomous vending-machine business owner in a simulated competitive market. Maximize your bank balance at the end of the season. All money is fictional. You may develop and revise your own strategy. Starting hypothesis: ${observation.self.brief}
Make this day's decisions from the JSON observation below. Amounts are INTEGER CENTS. Set prices, move delivered stock from storage to the machine with load, and buy inventory with orders. Respect cash, capacity and delivery times. Bulk orders of at least 24 units receive an 8% unit-price discount; unit prices round to cents. Supplier delay probabilities add two days. Day-one machines are empty and need orders before sales become possible. Loading happens before purchases; purchased goods cannot be loaded until arrival. The current date and weather are known. Sales are computed once per product each day using price elasticity, reference prices, baseline demand, weekday/month/weather multipliers, assortment variety and noise, capped by stock. In this game, machines compete for a shared per-product demand pool. Learn product demand from your previousSales and sales history; no fixed visitor population is simulated. Opponent cash, inventory and private notes are not available.
Your memory field is your persistent private notebook, included in the next daily observation; record useful product-level sales, hypotheses and plans within 6000 characters. Rationale is a brief public business explanation, at most 2000 characters. All product keys must be included in prices and load. Return only the structured decision. No shell, file, browser, network or external tools are needed or allowed for this game decision; all relevant information is in this prompt. Do not inspect your surroundings or execute code.
OBSERVATION:
${JSON.stringify(observation)}`;}

// One stateless Codex execution per decision. Explicit notebook persistence keeps
// each agent's state bounded and portable without exposing other agents' context.
export async function codexDecision(observation,{binary=process.env.CODEX_BIN,model=process.env.CODEX_MODEL,timeoutMs=120000,spawnFn=spawn}={}){
  const executable=await resolveCodexBinary({binary});
  const dir=await mkdtemp(join(tmpdir(),'vending-agent-'));
  try{
    const schema=join(dir,'decision.schema.json'),output=join(dir,'decision.json');
    await writeFile(schema,JSON.stringify(decisionSchema));
    const args=['exec','--ignore-user-config','--skip-git-repo-check','--ephemeral','--sandbox','read-only','-c','approval_policy="never"','-c','features.shell_tool=false','--output-schema',schema,'--output-last-message',output,'--color','never','-'];
    if(model)args.splice(1,0,'--model',model);
    await new Promise((resolve,reject)=>{
      const child=spawnFn(executable,args,{cwd:dir,stdio:['pipe','ignore','pipe'],env:process.env});
      let stderr='',timedOut=false;
      const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
      child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-3000);});
      child.stdin.on('error',()=>{});
      child.on('error',e=>{clearTimeout(timeout);reject(new Error(`Cannot start Codex (${e.code||'launch failed'}) at ${executable}. Check that the executable still exists and can run, or set CODEX_BIN and restart the server.`));});
      child.on('close',code=>{clearTimeout(timeout);if(timedOut)reject(new Error('Codex decision timed out; the day was not advanced.'));else if(code!==0)reject(new Error(`Codex exited with code ${code}. Check local Codex authentication/model configuration.${/auth|login|401/i.test(stderr)?' Authentication may be required.':''}`));else resolve();});
      child.stdin.end(promptFor(observation));
    });
    return validateDecision(JSON.parse(await readFile(output,'utf8')));
  }finally{await rm(dir,{recursive:true,force:true});}
}
