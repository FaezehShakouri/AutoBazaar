import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {ControlError} from './agent-controller.mjs';
import {arcErrorMessage} from './arc.mjs';

// The wallet lives in this localhost process. Websites cannot call its signing
// controls: reject foreign Host/Origin and require an unguessable UI token.
export function createDashboardServer({controller,assets=new URL('../dist/',import.meta.url),onChange=()=>{}}){
  const token=randomBytes(32).toString('hex');
  const files=new Map([['/',['agent-dashboard.html','text/html']],['/agent-dashboard.js',['agent-dashboard.js','text/javascript']],['/agent-dashboard.css',['agent-dashboard.css','text/css']]]);
  const server=createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
    const json=(data,status=200)=>{res.writeHead(status,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try{
      const port=server.address()?.port,allowed=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
      if(!allowed.has(req.headers.host))throw new ControlError(403,'Open the dashboard on localhost.');
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new ControlError(403,'Cross-origin dashboard access is blocked.');
      if(req.headers['sec-fetch-site']==='cross-site')throw new ControlError(403,'Open the dashboard directly on localhost.');
      const url=new URL(req.url,`http://${req.headers.host}`),file=files.get(url.pathname);
      if(file&&req.method==='GET'){
        let content=await readFile(new URL(file[0],assets),'utf8');
        if(file[0].endsWith('.html'))content=content.replace('__DASHBOARD_TOKEN__',token);
        res.writeHead(200,{...headers,'Content-Type':file[1]+'; charset=utf-8'});res.end(content);return;
      }
      if(!url.pathname.startsWith('/api/'))throw new ControlError(404,'Not found.');
      const supplied=Buffer.from(String(req.headers['x-dashboard-token']||'')),expected=Buffer.from(token);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new ControlError(403,'Reopen this local dashboard to reconnect.');
      if(req.method==='GET'&&url.pathname==='/api/state'){json(controller.state());return;}
      if(req.method!=='POST')throw new ControlError(405,'Use POST for dashboard controls.');
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new ControlError(415,'Use application/json.');
      if(Number(req.headers['content-length'])>32000)throw new ControlError(413,'Request is too large.');
      const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>32000)throw new ControlError(413,'Request is too large.');chunks.push(chunk);}const raw=Buffer.concat(chunks).toString('utf8');
      let body;try{body=JSON.parse(raw);}catch{throw new ControlError(400,'Invalid JSON.');}
      if(!body||typeof body!=='object'||Array.isArray(body))throw new ControlError(400,'Expected an object.');
      let result;
      if(url.pathname==='/api/strategy')result=controller.saveStrategy(body);
      else if(url.pathname==='/api/mode')result=controller.setMode(body.mode);
      else if(url.pathname==='/api/approve'){
        if(!Number.isSafeInteger(body.id)||body.id<1)throw new ControlError(400,'Invalid draft.');
        result=await controller.approve(body.id);
      }
      else if(url.pathname==='/api/retry')result=await controller.retry();
      else if(url.pathname==='/api/house-agents')result=await controller.addHouseAgents();
      else throw new ControlError(404,'Unknown dashboard control.');
      json(result);onChange();
    }catch(error){json({error:arcErrorMessage(error)},error.status||500);}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}

export async function listenDashboard(server,port=3210){
  for(let attempt=0;attempt<10;attempt++){
    try{
      await new Promise((resolve,reject)=>{const failed=e=>{server.off('listening',ready);reject(e);},ready=()=>{server.off('error',failed);resolve();};server.once('error',failed);server.once('listening',ready);server.listen(port?port+attempt:0,'127.0.0.1');});
      return `http://127.0.0.1:${server.address().port}`;
    }catch(error){if(error.code!=='EADDRINUSE')throw error;}
  }
  throw Error(`Ports ${port}–${port+9} are busy. Choose another --port.`);
}
