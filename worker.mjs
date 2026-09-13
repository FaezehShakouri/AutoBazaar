import {DurableObject} from 'cloudflare:workers';
import {SeasonStore} from './lib/season-store.mjs';
import {createSeasonApi,apiJson} from './lib/season-api.mjs';
import {agentBookConfig} from './lib/agentkit-auth.mjs';
import {arcConfig} from './lib/arc.mjs';
import {ArcChain} from './lib/arc-chain.mjs';
import {ArcSeasonStore} from './lib/arc-season-store.mjs';
import {seasonIdentity} from './lib/season-identity.mjs';
import {seasonParticipation} from './lib/season-participation.mjs';

// Same SQL and transactions as the Node server, backed by Cloudflare's durable
// SQLite store. No always-on computer or separate database server is needed.
function durableDatabase(storage){
  const sql=storage.sql;
  return {
    exec:query=>sql.exec(query),
    prepare:query=>({
      get:(...args)=>sql.exec(query,...args).toArray()[0],
      all:(...args)=>sql.exec(query,...args).toArray(),
      run:(...args)=>{sql.exec(query,...args).toArray();const result=sql.exec('SELECT changes() AS changes,last_insert_rowid() AS lastInsertRowid').one();return result;},
    }),
    transactionSync:fn=>storage.transactionSync(fn),close:()=>{},
  };
}
export class SeasonCoordinator extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.ctx=ctx;const config=agentBookConfig(env),identity=seasonIdentity(env,config);
    const arc=arcConfig(env),Store=arc?ArcSeasonStore:SeasonStore;
    this.store=new Store({arc:arc?new ArcChain(arc):undefined,db:durableDatabase(ctx.storage),bookScope:identity.scope,participation:seasonParticipation(env),allowEmptyDemoMigration:env.ALLOW_EMPTY_DEMO_MIGRATION==='true',allowSingleHumanDemoMigration:env.ALLOW_SINGLE_HUMAN_DEMO_MIGRATION==='true',allowRetiredSandboxMigration:env.MIGRATE_EMPTY_SANDBOX_TO_AGENTBOOK==='true',turnMs:Number(env.SEASON_TURN_SECONDS||180)*1000,intermissionMs:Number(env.SEASON_INTERMISSION_SECONDS||30)*1000});
    this.api=createSeasonApi({store:this.store,config,worldEnv:env});
  }
  async schedule(){const at=this.store.nextWake();if(at!==null)await this.ctx.storage.setAlarm(at);else await this.ctx.storage.deleteAlarm();}
  async fetch(request){const response=await this.api(request,{remoteAddress:request.headers.get('CF-Connecting-IP')||'unknown'});await this.schedule();if(this.store.pump)this.ctx.waitUntil(this.store.pump().finally(()=>this.schedule()));return response;}
  async alarm(){this.store.tick();await this.store.pump?.();await this.schedule();}
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/healthz')return apiJson({ok:true,seasons:true,seasonMode:env.SEASON_MODE||'competition',identityMode:env.SEASON_IDENTITY_MODE||'agentbook',version:env.CF_VERSION_METADATA?.id||null});
    if(url.pathname==='/api/seasons'||url.pathname.startsWith('/api/seasons/')||url.pathname.startsWith('/api/world-id/'))return env.SEASONS.get(env.SEASONS.idFromName(env.ARC_CONTRACT_ADDRESS?`autobazaar-arc-5042002-${env.ARC_CONTRACT_ADDRESS.toLowerCase()}`:'vending-plaza-seasons-v1')).fetch(request);
    if(url.pathname.startsWith('/api/'))return apiJson({error:'Only the authenticated season API is available publicly.'},404);
    if(url.pathname==='/'||url.pathname==='/seasons')url.pathname='/seasons.html';
    if(url.pathname==='/play')url.pathname='/index.html';
    if(url.pathname==='/world-id'||url.pathname==='/world-id.html')return Response.redirect(new URL('/agent-guide.html#register',url).href,302);
    if(url.pathname==='/world-id-diagnostic')url.pathname='/world-id.html';
    return env.ASSETS.fetch(new Request(url,request));
  },
};
