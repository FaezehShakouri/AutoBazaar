import {validateDecision} from '../dist/engine.js';
import {arcErrorMessage} from './arc.mjs';

export class ControlError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new ControlError(status,message);};
export class AgentController {
  constructor({db,agent,season,decide,server,arcContract,now=Date.now}){
    Object.assign(this,{db,agent,season,decide,server,arcContract,now});
    this.view=null;this.error=null;this.lastSyncedAt=null;this.working=false;this.submitting=false;this.refreshing=null;
    db.exec(`CREATE TABLE IF NOT EXISTS control_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_strategies(revision INTEGER PRIMARY KEY AUTOINCREMENT,instructions TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_drafts(id INTEGER PRIMARY KEY AUTOINCREMENT,day INTEGER NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,decision TEXT,error TEXT,created_at INTEGER NOT NULL,submitted_at INTEGER);`);
    const scope=JSON.stringify({server,wallet:agent.address.toLowerCase(),season,arcContract:arcContract?.toLowerCase()||null}),saved=db.prepare("SELECT value FROM control_settings WHERE key='scope'").get();
    if(saved&&saved.value!==scope)throw Error('This dashboard database belongs to a different wallet or season.');
    db.prepare('INSERT OR IGNORE INTO control_settings VALUES (?,?)').run('scope',scope);
    db.prepare('INSERT OR IGNORE INTO control_settings VALUES (?,?)').run('mode','paused');
    if(!this.strategy())db.prepare('INSERT INTO owner_strategies(instructions,created_at) VALUES (?,?)').run('',now());
    db.prepare("UPDATE agent_drafts SET status='error',error='The runner restarted during this draft. Retry to generate a new decision.' WHERE status='thinking'").run();
    db.prepare("UPDATE agent_drafts SET status='uncertain',error='Checking whether the server accepted this decision before retrying.' WHERE status='submitting'").run();
  }
  strategy(){const s=this.db.prepare('SELECT * FROM owner_strategies ORDER BY revision DESC LIMIT 1').get();return s?{revision:s.revision,instructions:s.instructions,createdAt:s.created_at}:null;}
  mode(){return this.db.prepare("SELECT value FROM control_settings WHERE key='mode'").get().value;}
  draft(id){const d=id?this.db.prepare('SELECT * FROM agent_drafts WHERE id=?').get(id):this.db.prepare('SELECT * FROM agent_drafts ORDER BY id DESC LIMIT 1').get();return d?{...d,decision:d.decision?JSON.parse(d.decision):null}:null;}
  setDraft(id,status,extra={}){this.db.prepare('UPDATE agent_drafts SET status=?,decision=COALESCE(?,decision),error=?,submitted_at=COALESCE(?,submitted_at) WHERE id=?').run(status,extra.decision?JSON.stringify(extra.decision):null,extra.error||null,extra.submittedAt||null,id);}
  state(){return {wallet:this.agent.address,server:this.server,seasonId:this.season,arcContract:this.arcContract,mode:this.mode(),strategy:this.strategy(),strategyHistory:this.db.prepare('SELECT revision,instructions,created_at AS createdAt FROM owner_strategies ORDER BY revision DESC LIMIT 20').all(),draft:this.draft(),runs:this.db.prepare('SELECT id,day,revision,status,error,created_at AS createdAt,submitted_at AS submittedAt FROM agent_drafts ORDER BY id DESC LIMIT 50').all(),view:this.view,lastSyncedAt:this.lastSyncedAt,error:this.error,working:this.working,submitting:this.submitting};}
  saveStrategy({instructions,expectedRevision}={}){
    if(typeof instructions!=='string'||instructions.length>6000)fail(400,'Strategy must be at most 6000 characters.');
    if(expectedRevision!==this.strategy().revision)fail(409,'Strategy changed in another tab. Refresh before saving.');
    this.db.prepare('INSERT INTO owner_strategies(instructions,created_at) VALUES (?,?)').run(instructions.trim(),this.now());
    const d=this.draft();if(d?.status==='draft')this.setDraft(d.id,'superseded',{error:'New owner guidance will be used for the next draft.'});
    return this.strategy();
  }
  setMode(mode){if(!['paused','review','automatic'].includes(mode))fail(400,'Choose paused, review or automatic.');this.db.prepare("UPDATE control_settings SET value=? WHERE key='mode'").run(mode);return {mode};}
  async addHouseAgents(){
    await this.refresh();
    if(this.view.season.mode!=='demo')fail(409,'House agents are available only in demo seasons.');
    const result=await this.agent.houseAgents(this.season);await this.refresh();return result;
  }
  async refresh(){
    if(this.refreshing)return this.refreshing;
    this.refreshing=(async()=>{
      try{
        const view=await this.agent.dashboard(this.season);
        if(view.season.arc&&view.season.arc.contract.toLowerCase()!==this.arcContract?.toLowerCase())fail(409,'The server escrow differs from the pinned dashboard escrow.');
        const owner=view.season.entrants.find(e=>e.slot===view.slot);
        if(owner?.address.toLowerCase()!==this.agent.address.toLowerCase())fail(403,'The dashboard response belongs to another wallet.');
        this.view=view;this.lastSyncedAt=this.now();this.error=null;
        const d=this.draft();
        if(d&&['draft','submitting','uncertain'].includes(d.status)){
          const accepted=view.decisions.find(row=>row.day===d.day);
          if(accepted)this.setDraft(d.id,JSON.stringify(accepted.decision)===JSON.stringify(d.decision)?'submitted':'superseded',{submittedAt:accepted.submittedAt,error:JSON.stringify(accepted.decision)===JSON.stringify(d.decision)?null:'A different runner submitted this day.'});
          else if(view.season.day>=d.day||view.season.status==='finished')this.setDraft(d.id,'expired',{error:'The decision window closed before this draft was accepted.'});
        }
        return view;
      }catch(error){this.error=arcErrorMessage(error);throw error;}
      finally{this.refreshing=null;}
    })();return this.refreshing;
  }
  eligible(){const v=this.view;return Boolean(v?.observation&&!v.submitted&&v.observation.self.active&&v.season.deadline>this.now()&&v.season.status==='running');}
  async tick(){
    try{await this.refresh();}catch{return;}
    if(this.working||this.submitting||this.mode()==='paused'||!this.eligible())return;
    const d=this.draft(),day=this.view.observation.day,revision=this.strategy().revision;
    if(d?.day===day){
      if(['submitted','submitting','uncertain','thinking'].includes(d.status))return;
      if(d.revision===revision&&['draft','error','expired'].includes(d.status)){
        if(d.status==='draft'&&this.mode()==='automatic')try{await this.approve(d.id);}catch{}
        return;
      }
    }
    this.working=true;
    const strategy=this.strategy(),observation={...structuredClone(this.view.observation),ownerStrategy:strategy};
    const {lastInsertRowid}=this.db.prepare("INSERT INTO agent_drafts(day,revision,status,created_at) VALUES (?,?,'thinking',?)").run(day,strategy.revision,this.now());
    const id=Number(lastInsertRowid);
    try{
      const decision=validateDecision(await this.decide(observation));
      if(this.strategy().revision!==strategy.revision){this.setDraft(id,'superseded',{decision,error:'Owner strategy changed while thinking. A new draft will use the latest revision.'});return;}
      await this.refresh();
      if(this.strategy().revision!==strategy.revision){this.setDraft(id,'superseded',{decision,error:'Owner guidance changed while refreshing the decision window.'});return;}
      if(!this.eligible()||this.view.observation.day!==day){this.setDraft(id,'expired',{decision,error:'This decision window closed or another runner submitted.'});return;}
      this.setDraft(id,'draft',{decision});
      if(this.mode()==='automatic')await this.approve(id);
    }catch(error){if(!['submitted','uncertain'].includes(this.draft(id).status))this.setDraft(id,'error',{error:arcErrorMessage(error)});}
    finally{this.working=false;}
  }
  async approve(id){
    if(this.submitting)fail(409,'A decision is already being submitted.');
    this.submitting=true;
    try{
      await this.refresh();
      const d=this.draft(id);
      if(!d||this.draft()?.id!==id||d.status!=='draft')fail(409,'This draft is no longer available to submit.');
      if(this.mode()==='paused')fail(409,'Resume in review or automatic mode before submitting.');
      if(d.revision!==this.strategy().revision)fail(409,'This draft uses an older strategy. Generate a fresh draft.');
      if(!this.eligible()||this.view.observation.day!==d.day)fail(409,'The decision window closed or a decision is already locked.');
      this.setDraft(id,'submitting');
      try{
        await this.agent.submit(this.season,d.day,d.decision,this.view.observation);
        this.setDraft(id,'submitted',{submittedAt:this.now()});await this.refresh();
      }catch(error){
        if(this.draft(id).status!=='submitted')this.setDraft(id,'uncertain',{error:'Submission could not be confirmed. Checking server history before allowing a retry.'});
        this.error=arcErrorMessage(error);throw error;
      }
      return {submitted:true};
    }finally{this.submitting=false;}
  }
  async retry(){
    if(this.working||this.submitting)fail(409,'Wait for the current operation to finish.');
    await this.refresh();const d=this.draft();
    if(!d||!['error','expired','superseded','draft','uncertain'].includes(d.status))fail(409,'There is no draft to retry.');
    if(!this.eligible()||this.view.observation.day!==d.day)fail(409,'Retry is unavailable outside this decision window.');
    if(d.status==='uncertain'){
      // Retry the exact persisted decision; the remote API is idempotent.
      this.setDraft(d.id,'draft');return {retry:'same-decision'};
    }
    this.setDraft(d.id,'superseded');return {retry:'new-draft'};
  }
}
