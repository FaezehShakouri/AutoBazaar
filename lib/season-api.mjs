import {AgentKitGate,agentBookConfig} from './agentkit-auth.mjs';
import {SeasonError} from './season-store.mjs';
import {WorldSandbox} from './world-sandbox.mjs';

export const apiJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const LIMIT=24000;
async function readLimited(request){
  if(Number(request.headers.get('content-length'))>LIMIT)throw new SeasonError(413,'Request is too large.');
  if(!request.body)return '';
  const reader=request.body.getReader(),decoder=new TextDecoder();let total=0,body='';
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>LIMIT){await reader.cancel();throw new SeasonError(413,'Request is too large.');}body+=decoder.decode(value,{stream:true});}
  return body+decoder.decode();
}

export function createSeasonApi({store,config=agentBookConfig(),book,origin,worldEnv={}}={}){
  const gate=new AgentKitGate({store,config,book}),rate=new Map();
  const sandbox=new WorldSandbox({store,env:worldEnv});
  return async function handle(request,{remoteAddress='local'}={}){
    try{
      const url=new URL(request.url),base=origin||url.origin;
      if(origin&&url.origin!==origin)return apiJson({error:'Unexpected server origin.'},403);
      const path=url.pathname;
      if(request.headers.get('origin')&&request.headers.get('origin')!==base)return apiJson({error:'Cross-origin request rejected.'},403);
      if(rate.size>=10000){const minute=Math.floor(Date.now()/60000);for(const [key,value] of rate)if(value.minute!==minute)rate.delete(key);if(rate.size>=10000)return apiJson({error:'Verification traffic is busy. Retry shortly.'},503);}
      store.tick();
      if(path==='/api/world-id/config'&&request.method==='GET')return apiJson(sandbox.config());
      if(path.startsWith('/api/world-id/')){
        if(request.method!=='POST'||!['/api/world-id/start','/api/world-id/verify'].includes(path))return apiJson({error:'Unknown World ID endpoint.'},404);
        if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return apiJson({error:'Use application/json.'},415);
        const key=`world:${remoteAddress}`,minute=Math.floor(Date.now()/60000),prior=rate.get(key),count=prior?.minute===minute?prior.count+1:1;
        rate.set(key,{minute,count});if(count>20)return apiJson({error:'Too many verification requests. Retry in one minute.'},429);
        let body;try{body=JSON.parse(await readLimited(request));}catch(error){if(error instanceof SeasonError)throw error;throw new SeasonError(400,'Invalid JSON.');}
        if(!body||typeof body!=='object'||Array.isArray(body))throw new SeasonError(400,'JSON body must be an object.');
        return apiJson(path.endsWith('/start')?sandbox.start(body.address):await sandbox.complete(body.id,body.result));
      }
      if(path==='/api/seasons'&&request.method==='GET')return apiJson({seasons:store.list(),verification:{provider:'World AgentKit',environment:config.network,chainId:config.chainId,contract:config.contractAddress},rules:{agentsPerSeason:4,oneAgentPerHuman:true,registrationStake:50000,startingCash:50000,currency:'simulated USD cents',turnMs:store.turnMs}});
      const route=/^\/api\/seasons\/(\d+)\/(snapshot|join|observation|decisions)$/.exec(path);
      if(!route)return apiJson({error:'Unknown season endpoint.'},404);
      const [,id,action]=route,method=action==='snapshot'||action==='observation'?'GET':'POST';
      if(request.method!==method)return apiJson({error:`Use ${method}.`},405);
      store.get(id);
      if(action==='snapshot')return apiJson(store.publicView(id));
      const minute=Math.floor(Date.now()/60000),prior=rate.get(remoteAddress),count=prior?.minute===minute?prior.count+1:1;
      if(rate.size>10000)for(const [key,value] of rate)if(value.minute!==minute)rate.delete(key);
      rate.set(remoteAddress,{minute,count});if(count>240)return apiJson({error:'Too many protected requests. Retry in one minute.'},429);
      if(method==='POST'&&!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return apiJson({error:'Use application/json.'},415);
      const raw=await readLimited(request);let body;try{body=raw?JSON.parse(raw):{};}catch{return apiJson({error:'Invalid JSON.'},400);}
      if(method==='POST'&&(!body||typeof body!=='object'||Array.isArray(body)))return apiJson({error:'JSON body must be an object.'},400);
      const header=request.headers.get('agentkit');
      if(!header)return apiJson(await gate.challenge(url.href,method,raw),402);
      const identity=await gate.authenticate(header,url.href,method,raw);
      if(action==='join')return apiJson(store.join(id,identity,body));
      if(action==='observation')return apiJson(store.observe(id,identity));
      return apiJson(store.submit(id,identity,body));
    }catch(error){if(!(error instanceof SeasonError))console.error('Season API error:',error.message);return apiJson({error:error instanceof SeasonError?error.message:'The season service could not complete the request.'},error.status||500);}
  };
}
