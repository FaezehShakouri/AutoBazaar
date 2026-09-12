import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createGame,registerAgent,startRound,prepareDay,settleDay,observation} from './dist/engine.js';
import {codexDecision} from './lib/codex.mjs';
import {SeasonStore} from './lib/season-store.mjs';
import {openSeasonDatabase} from './lib/sqlite.mjs';
import {createSeasonApi} from './lib/season-api.mjs';
import {agentBookConfig} from './lib/agentkit-auth.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
export function createArenaServer({decide=codexDecision,saveDirectory=join(root,'.runs'),seasons,book,bookConfig=agentBookConfig(),publicOrigin,worldEnv={}}={}){
  let game=createGame({mode:'codex'}),busy=false;
  const seasonApi=seasons?createSeasonApi({store:seasons,book,config:bookConfig,origin:publicOrigin,worldEnv}):null;
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const readBody=async req=>{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new Error('Request too large.');}return JSON.parse(body||'{}');};
  const server=http.createServer(async(req,res)=>{
    // A public server exposes only the season API. It can never launch Codex
    // on behalf of a remote request or reset the local practice game.
    const host=req.headers.host||'';
    const loopback=/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    if(!loopback&&(!publicOrigin||host!==new URL(publicOrigin).host))return json(res,403,{error:'Unexpected Host header.'});
    const origin=publicOrigin||`http://${host}`,url=new URL(req.url,origin),path=url.pathname;
    try{
      if(path==='/api/seasons'||path.startsWith('/api/seasons/')||path.startsWith('/api/world-id/')){
        if(!seasonApi)return json(res,503,{error:'Shared seasons are not enabled on this server.'});
        const init={method:req.method,headers:req.headers};
        if(!['GET','HEAD'].includes(req.method)){init.body=Readable.toWeb(req);init.duplex='half';}
        const response=await seasonApi(new Request(url,init),{remoteAddress:req.socket.remoteAddress});
        res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
      }
      if(path==='/healthz')return json(res,200,{ok:true,seasons:Boolean(seasons)});
      if(path.startsWith('/api/')){
        if(publicOrigin)return json(res,404,{error:'Only the authenticated season API is available publicly.'});
        if(req.method==='POST'){
          if(req.headers.origin&&req.headers.origin!==`http://${host}`)return json(res,403,{error:'Cross-origin request rejected.'});
          if(req.headers['content-type']!=='application/json')return json(res,415,{error:'Use application/json.'});
        }
        if(path==='/api/status'&&req.method==='GET')return json(res,200,{local:true,busy,mode:game.mode,phase:game.phase,day:game.day});
        if(path==='/api/state'&&req.method==='GET')return json(res,200,game);
        if(path==='/api/reset'&&req.method==='POST'){
          if(busy)return json(res,409,{error:'Wait for the current decision round to finish.'});
          const body=await readBody(req);
          const fresh=createGame({seed:body.seed,startDate:body.startDate,mode:'codex'});game=fresh;return json(res,200,game);
        }
        if(path==='/api/register'&&req.method==='POST'){
          if(busy)return json(res,409,{error:'Wait for the current operation to finish.'});
          const body=await readBody(req);game=registerAgent(game,body.id);return json(res,200,game);
        }
        if(path==='/api/start'&&req.method==='POST'){
          if(busy)return json(res,409,{error:'Wait for the current operation to finish.'});
          await readBody(req);game=startRound(game);return json(res,200,game);
        }
        if(path==='/api/step'&&req.method==='POST'){
          if(busy)return json(res,409,{error:'A decision round is already running.'});
          await readBody(req);
          if(game.phase==='finished')return json(res,200,game);
          busy=true;
          try{
            const next=prepareDay(game),active=next.agents.filter(a=>a.active);
            const results=await Promise.allSettled(active.map(a=>decide(observation(next,a.id))));
            const errors=results.flatMap((r,i)=>r.status==='rejected'?[`${active[i].name}: ${r.reason.message}`]:[]);
            if(errors.length)return json(res,502,{error:`${errors.join(' ')} No decisions were applied. Retry the day after resolving the problem.`});
            const decisions=Object.fromEntries(results.map((r,i)=>[active[i].id,r.value]));
            const settled=settleDay(next,decisions);
            // Persist before committing the round; a disk failure cannot half-advance it.
            await mkdir(saveDirectory,{recursive:true});
            await writeFile(join(saveDirectory,'latest.json.tmp'),JSON.stringify(settled,null,2));
            await rename(join(saveDirectory,'latest.json.tmp'),join(saveDirectory,'latest.json'));
            game=settled;return json(res,200,game);
          }finally{busy=false;}
        }
        return json(res,404,{error:'Unknown endpoint.'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed.'});
      const files=Object.fromEntries(['index.html','app.js','game-app.js','world.js','playback.js','engine.js','sales-model.js','style.css','game.css','plaza.css','seasons.html','seasons.js','seasons.css','season-view.js','world-id.html','world-id.js','agent-guide.html','agent.mjs','agent-wallet.mjs','steady-agent.mjs','idkit_wasm_bg.wasm','THIRD-PARTY-NOTICES.txt','vendor/three.module.js','vendor/three.core.js','vendor/OrbitControls.js','vendor/THREE-LICENSE.txt'].map(file=>['/'+file,file]));files['/']=publicOrigin?'seasons.html':'index.html';files['/seasons']='seasons.html';files['/play']='index.html';files['/world-id']='world-id.html';
      if(!files[path])return json(res,404,{error:'Not found.'});
      const body=await readFile(join(root,'dist',files[path]));
      res.writeHead(200,{'Content-Type':path.endsWith('.wasm')?'application/wasm':/\.m?js$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.txt')?'text/plain':'text/html','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
    }catch(e){json(res,400,{error:e.message});}
  });
  if(seasons){const timer=setInterval(()=>{try{seasons.tick();}catch(e){console.error('Season clock:',e.message);}},1000);timer.unref();server.on('close',()=>clearInterval(timer));}
  return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||3000);
  if(!Number.isInteger(port)||port<1||port>65535){
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode=1;
  }else{
    const publicOrigin=process.env.PUBLIC_ORIGIN||undefined,bindAddress=process.env.BIND_ADDRESS||'127.0.0.1';
    if(publicOrigin){const url=new URL(publicOrigin);if(url.origin!==publicOrigin||url.protocol!=='https:')throw Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash.');}
    if(!['127.0.0.1','localhost','::1'].includes(bindAddress)&&!publicOrigin)throw Error('Set PUBLIC_ORIGIN before binding a public interface.');
    const bookConfig=agentBookConfig(process.env);
    const seasons=new SeasonStore({db:openSeasonDatabase(process.env.SEASON_DB||join(root,'.runs','seasons.sqlite')),bookScope:bookConfig.scope,turnMs:Number(process.env.SEASON_TURN_SECONDS||180)*1000,intermissionMs:Number(process.env.SEASON_INTERMISSION_SECONDS||30)*1000});
    const server=createArenaServer({seasons,bookConfig,publicOrigin,worldEnv:process.env});
    server.on('close',()=>seasons.close());
    server.on('error',error=>{
      if(error.code==='EADDRINUSE'){
        console.error(`Port ${port} is already in use. If Vending Arena is already running, open http://127.0.0.1:${port}. Otherwise stop the process using that port or choose another port, for example: PORT=${port===3001?3002:3001} npm start`);
      }else console.error(`Cannot start Vending Arena: ${error.message}`);
      process.exitCode=1;
    });
    server.listen(port,bindAddress,()=>console.log(`Vending Plaza: ${publicOrigin||`http://127.0.0.1:${port}`} · Seasons: /seasons`));
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close());
  }
}
