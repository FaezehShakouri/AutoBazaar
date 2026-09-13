import {randomBytes,createHmac} from 'node:crypto';
import {isAddress} from 'viem';
import {signRequest} from '@worldcoin/idkit-core/signing';
import {hashSignal} from '@worldcoin/idkit-core/hashing';
import {SeasonError} from './season-store.mjs';

// Standalone phone diagnostics only. These proofs never authorize game entry.
export class WorldSandbox {
  constructor({store,env={},verifyFetch=fetch}){
    this.store=store;this.verifyFetch=verifyFetch;
    this.app=env.WORLD_ID_APP_ID;this.rp=env.WORLD_ID_RP_ID;
    this.key=env.WORLD_ID_SIGNING_KEY;this.action=env.WORLD_ID_ACTION||'autobazaar-agent-test';
    this.credential=env.WORLD_ID_SANDBOX_CREDENTIAL||'proof_of_human';
    if(!['proof_of_human','selfie'].includes(this.credential))throw Error('Invalid World ID Sandbox credential.');
    this.ready=Boolean(this.app&&this.rp&&this.key);
    if(this.ready&&(!/^app_[a-f0-9]+$/.test(this.app)||!/^rp_[a-f0-9]+$/.test(this.rp)||!/^(0x)?[a-f0-9]{64}$/i.test(this.key)))throw Error('Invalid World ID Sandbox configuration.');
    store.db.exec('CREATE TABLE IF NOT EXISTS world_sandbox_sessions(id TEXT PRIMARY KEY,address TEXT NOT NULL,nonce TEXT NOT NULL,signal TEXT NOT NULL,expires INTEGER NOT NULL,verified_at INTEGER,human_key TEXT)');
    if(!store.db.prepare('PRAGMA table_info(world_sandbox_sessions)').all().some(column=>column.name==='credential'))store.db.exec("ALTER TABLE world_sandbox_sessions ADD COLUMN credential TEXT NOT NULL DEFAULT 'proof_of_human'");
    const columns=store.db.prepare('PRAGMA table_info(world_sandbox_sessions)').all().map(c=>c.name);
    if(!columns.includes('enrollment'))store.db.exec('ALTER TABLE world_sandbox_sessions ADD COLUMN enrollment INTEGER NOT NULL DEFAULT 0');
    if(!columns.includes('request_json'))store.db.exec('ALTER TABLE world_sandbox_sessions ADD COLUMN request_json TEXT');
    this.registrationEnabled=false;
  }
  config(){return {configured:this.ready,environment:'sandbox',appId:this.app||null,action:this.action,credential:this.credential,registrationEnabled:false,grantsSeasonEntry:false,productionAgentBook:false};}
  start(address,{enrollment=false}={}){
    if(!this.ready)throw new SeasonError(503,'World ID Sandbox is not configured on this server yet.');
    if(enrollment)throw new SeasonError(410,'Sandbox enrollment has been retired. Register the agent in World AgentBook.');
    if(!isAddress(address))throw new SeasonError(400,'Enter a valid public agent wallet address.');
    this.store.db.prepare('DELETE FROM world_sandbox_sessions WHERE expires<?').run(Date.now()-86400000);
    if(this.store.db.prepare('SELECT COUNT(*) AS n FROM world_sandbox_sessions WHERE expires>?').get(Date.now()).n>=1000)throw new SeasonError(503,'Sandbox verification is busy. Retry shortly.');
    const id=randomBytes(24).toString('hex'),signal=`AutoBazaar sandbox ${enrollment?'registration':'agent'} ${address.toLowerCase()} session ${id}`;
    const {sig,nonce,createdAt,expiresAt}=signRequest({signingKeyHex:this.key,action:this.action,ttl:300});
    const request={id,signal,enrollment,credential:this.credential,config:{app_id:this.app,action:this.action,environment:'sandbox',allow_legacy_proofs:true,rp_context:{rp_id:this.rp,nonce,created_at:createdAt,expires_at:expiresAt,signature:sig}}};
    this.store.db.prepare('INSERT INTO world_sandbox_sessions(id,address,nonce,signal,expires,credential,enrollment,request_json) VALUES (?,?,?,?,?,?,?,?)').run(id,address.toLowerCase(),nonce,signal,expiresAt*1000,this.credential,enrollment?1:0,JSON.stringify(request));
    return request;
  }
  async complete(id,result){
    if(!this.ready)throw new SeasonError(503,'World ID Sandbox is not configured.');
    const row=this.store.db.prepare('SELECT * FROM world_sandbox_sessions WHERE id=?').get(id);
    if(!row||row.expires<=Date.now()||row.verified_at)throw new SeasonError(409,'Verification session expired or was already completed. Start a new check.');
    if(row.enrollment)throw new SeasonError(410,'This is a retired Sandbox enrollment request. Register the agent in World AgentBook.');
    if(result?.environment!=='sandbox')throw new SeasonError(400,'Returned proof environment is not Sandbox.');
    if(!['3.0','4.0'].includes(result.protocol_version))throw new SeasonError(400,'World ID returned an unsupported proof version.');
    if(result.action!==this.action)throw new SeasonError(400,'Returned proof action does not match AutoBazaar.');
    if(result.nonce!==row.nonce)throw new SeasonError(400,'Returned proof nonce does not match the signed request.');
    if(result.session_id)throw new SeasonError(400,'A uniqueness proof is required, not a session proof.');
    if(!Array.isArray(result.responses)||result.responses.length!==1)throw new SeasonError(400,'Exactly one credential response is required.');
    const proof=result.responses[0];
    // World's v4 verify endpoint also verifies unchanged legacy Orb results.
    // Pin the requested credential per session, including across deployments.
    // Selfie Check is an explicitly separate Sandbox test, not Orb uniqueness.
    const credentialMatches=row.credential==='selfie'
      ?result.protocol_version==='3.0'&&proof?.identifier==='selfie'
      :result.protocol_version==='4.0'
        ?proof?.identifier==='proof_of_human'&&proof.issuer_schema_id===1
        :proof?.identifier==='orb';
    if(!credentialMatches)throw new SeasonError(400,`The phone returned a different credential. This check requires ${row.credential==='selfie'?'Selfie Check':'Proof of Human or legacy Orb'}.`);
    if(proof.signal_hash!==hashSignal(row.signal))throw new SeasonError(400,'The returned proof is not bound to this wallet and verification session.');
    if(!/^0x[0-9a-f]{1,64}$/i.test(proof.nullifier||'')||BigInt(proof.nullifier)===0n)throw new SeasonError(400,'World ID returned an invalid proof identifier.');
    let response,data;
    try{response=await this.verifyFetch(`https://developer.world.org/api/v4/verify/${this.rp}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result),signal:AbortSignal.timeout(20000)});data=await response.json();}
    catch{throw new SeasonError(503,'World proof verification is unavailable. Retry shortly.');}
    if(!response.ok||data.success!==true||data.environment!=='sandbox'||data.action!==this.action||!data.results?.some(r=>r.identifier===proof.identifier&&r.success===true))throw new SeasonError(400,'World could not verify this Sandbox proof.');
    const human=createHmac('sha256',this.store.salt).update(`world-sandbox:${this.app}:${this.action}:${row.credential}:${result.protocol_version}:${BigInt(proof.nullifier)}`).digest('hex');
    this.store.transaction(()=>{
      const updated=this.store.db.prepare('UPDATE world_sandbox_sessions SET verified_at=?,human_key=? WHERE id=? AND verified_at IS NULL AND expires>?').run(Date.now(),human,id,Date.now());
      if(updated.changes!==1)throw new SeasonError(409,'Verification session expired or was already completed.');
    });
    return {verified:true,registered:false,environment:'sandbox',credential:row.credential,agentAddress:row.address,grantsSeasonEntry:false,productionAgentBook:false,message:'Phone-to-backend Sandbox diagnostic completed. Game registration requires World AgentBook.'};
  }
}
