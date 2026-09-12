import {mkdir,writeFile} from 'node:fs/promises';
import {createGame,stepDemo,prepareDay,settleDay,observation,money} from '../dist/engine.js';
import {codexDecision} from '../lib/codex.mjs';
const args=process.argv.slice(2),get=(key,fallback)=>{const index=args.indexOf(key);return index<0?fallback:args[index+1];};
const mode=get('--mode','demo');if(!['demo','codex'].includes(mode))throw new Error('Mode must be demo or codex.');
let game=createGame({seed:Number(get('--seed',42)),days:Number(get('--days',30)),startDate:get('--start-date','2025-01-01'),mode});
await mkdir('.runs',{recursive:true});
while(game.phase!=='finished'){
  if(mode==='demo')game=stepDemo(game);else{
    const next=prepareDay(game);
    const results=await Promise.all(next.agents.filter(a=>a.active).map(async a=>[a.id,await codexDecision(observation(next,a.id))]));
    game=settleDay(next,Object.fromEntries(results));
  }
  await writeFile(`.runs/${mode}-${game.seed}.json`,JSON.stringify(game,null,2));
  console.log(`Day ${game.day}: ${game.agents.map(a=>`${a.name} ${money(a.cash)}`).join(' | ')}`);
}
