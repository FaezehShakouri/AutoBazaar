import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createGame,prepareDay,settleDay,observation} from './dist/engine.js';
import {codexDecision} from './lib/codex.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
export function createArenaServer({decide=codexDecision,saveDirectory=join(root,'.runs')}={}){
  let game=createGame({mode:'codex'}),busy=false;
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const readBody=async req=>{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new Error('Request too large.');}return JSON.parse(body||'{}');};
  return http.createServer(async(req,res)=>{
    // Bind loopback only and reject cross-origin mutations / DNS-rebinding hosts.
    const host=req.headers.host||'';
    if(!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))return json(res,403,{error:'Local access only.'});
    const path=new URL(req.url,`http://${host}`).pathname;
    try{
      if(path.startsWith('/api/')){
        if(req.method==='POST'){
          if(req.headers.origin&&req.headers.origin!==`http://${host}`)return json(res,403,{error:'Cross-origin request rejected.'});
          if(req.headers['content-type']!=='application/json')return json(res,415,{error:'Use application/json.'});
        }
        if(path==='/api/status'&&req.method==='GET')return json(res,200,{local:true,busy,mode:game.mode,day:game.day});
        if(path==='/api/state'&&req.method==='GET')return json(res,200,game);
        if(path==='/api/reset'&&req.method==='POST'){
          if(busy)return json(res,409,{error:'Wait for the current decision round to finish.'});
          const body=await readBody(req);
          const fresh=createGame({seed:body.seed,days:body.days,startDate:body.startDate,mode:'codex'});game=fresh;return json(res,200,game);
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
      const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/engine.js':'engine.js','/sales-model.js':'sales-model.js','/style.css':'style.css'};
      if(!files[path])return json(res,404,{error:'Not found.'});
      const body=await readFile(join(root,'dist',files[path]));
      res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
    }catch(e){json(res,400,{error:e.message});}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||3000);
  if(!Number.isInteger(port)||port<1||port>65535){
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode=1;
  }else{
    const server=createArenaServer();
    server.on('error',error=>{
      if(error.code==='EADDRINUSE'){
        console.error(`Port ${port} is already in use. If Vending Arena is already running, open http://127.0.0.1:${port}. Otherwise stop the process using that port or choose another port, for example: PORT=${port===3001?3002:3001} npm start`);
      }else console.error(`Cannot start Vending Arena: ${error.message}`);
      process.exitCode=1;
    });
    server.listen(port,'127.0.0.1',()=>console.log(`Vending Arena: http://127.0.0.1:${port}`));
  }
}
