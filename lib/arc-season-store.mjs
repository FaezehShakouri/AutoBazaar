import {SeasonStore,SeasonError} from './season-store.mjs';
import {registerAgent,startRound,settleDay,observation,validateDecision,PRODUCTS,SUPPLIERS,quote} from '../dist/engine.js';
import {joinTypedData,dayTypedData,dayPermit,emptyPermit,settlementCall,stringify,arcErrorMessage} from './arc.mjs';

const fail=(status,message)=>{throw new SeasonError(status,message);};
const profilePattern=/^[\p{L}\p{N} ._-]{1,24}$/u;
const validSignature=s=>typeof s==='string'&&/^0x[0-9a-f]+$/i.test(s)&&s.length<=4098;

export class ArcSeasonStore extends SeasonStore {
  constructor({arc,...options}){
    if(options.participation?.mode==='demo'&&![5042002,31337].includes(arc.metadata.chainId))throw Error('Demo house agents are restricted to Arc Testnet or the local test EVM.');
    super(options);this.arc=arc;
    this.db.exec(`CREATE TABLE IF NOT EXISTS arc_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,op TEXT NOT NULL UNIQUE,season_id INTEGER NOT NULL,kind TEXT NOT NULL,
      address TEXT,human_key TEXT,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',raw TEXT,hash TEXT,
      receipt TEXT,error TEXT,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS arc_permits(season_id INTEGER NOT NULL,day INTEGER NOT NULL,slot TEXT NOT NULL,permit TEXT NOT NULL,PRIMARY KEY(season_id,day,slot));
      CREATE TABLE IF NOT EXISTS arc_job_repairs(job_id INTEGER PRIMARY KEY,reason TEXT NOT NULL,previous_payload TEXT NOT NULL,created_at INTEGER NOT NULL);`);
    const scope=`${arc.metadata.chainId}:${arc.metadata.contract.toLowerCase()}`;
    const saved=this.db.prepare('SELECT value FROM settings WHERE key=?').get('arc_scope');
    if(saved&&saved.value!==scope)throw Error('Use a separate season database for each Arc escrow.');
    if(!saved&&this.db.prepare('SELECT COUNT(*) AS n FROM entrants').get().n)throw Error('Simulated seasons cannot be converted to funded Arc seasons. Use a new database.');
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run('arc_scope',scope);
    this.repairSupplierRounding();
  }
  jobs(id){return this.db.prepare('SELECT j.id,j.kind,j.status,j.hash,j.receipt,j.error,j.updated_at,r.reason AS repair_reason,r.created_at AS repaired_at FROM arc_jobs j LEFT JOIN arc_job_repairs r ON r.job_id=j.id WHERE j.season_id=? ORDER BY j.id DESC LIMIT 100').all(Number(id)).map(j=>({id:j.id,kind:j.kind,status:j.status,hash:j.hash,receipt:j.receipt?JSON.parse(j.receipt):null,error:j.error,updatedAt:j.updated_at,...(j.repair_reason?{repair:{reason:j.repair_reason,createdAt:j.repaired_at}}:{})}));}
  dayPlan(s){
    const decisions=Object.fromEntries(this.db.prepare('SELECT slot,decision FROM decisions WHERE season_id=? AND day=?').all(s.id,s.morning.day).map(r=>[r.slot,JSON.parse(r.decision)]));
    for(const a of s.morning.agents.filter(a=>a.active))if(!decisions[a.id])decisions[a.id]={prices:{},load:{},orders:[],rationale:'Decision deadline missed. Kept prices and placed no orders or restocks.',memory:a.memory};
    const permits=s.morning.agents.map(a=>{const row=this.db.prepare('SELECT permit FROM arc_permits WHERE season_id=? AND day=? AND slot=?').get(s.id,s.morning.day,a.id);return row?JSON.parse(row.permit):emptyPermit();});
    const supplyLimits=Object.fromEntries(s.morning.agents.map((a,i)=>[a.id,Number(permits[i].maxSupplySpend)]));
    const state=settleDay(s.morning,decisions,{supplyLimits});
    return {state,call:settlementCall(s.id,state,permits)};
  }
  repairSupplierRounding(){
    // Only the known legacy quote defect in an unbroadcast preflight failure is
    // repairable. Keep every original decision, signature and spending cap.
    // Never replace bytes that may already be in flight or rewrite settled days.
    this.transaction(()=>{
      const jobs=this.db.prepare("SELECT * FROM arc_jobs WHERE kind='day' AND status='failed' AND raw IS NULL AND hash IS NULL AND receipt IS NULL AND id NOT IN (SELECT job_id FROM arc_job_repairs)").all();
      for(const job of jobs){
        const s=this.get(job.season_id),old=JSON.parse(job.payload),args=old.call?.args;
        if(old.call?.functionName!=='settleDay'||!s.morning||s.state.phase==='finished'||args?.[0]!==s.id||args[1]!==s.state.day+1||args[1]!==s.morning.day||old.state?.day!==args[1])continue;
        let mismatch=false,legacy=true;
        for(const order of args[3]){
          const p=PRODUCTS[order.product],supplier=SUPPLIERS[order.supplier];if(!p||!supplier){legacy=false;break;}
          const oldAmount=Math.round(p.cost*supplier.multiplier*(order.quantity>=24?.92:1))*order.quantity;
          if(order.amount!==oldAmount){legacy=false;break;}
          if(order.amount!==quote(p,supplier,order.quantity)*order.quantity)mismatch=true;
        }
        if(!legacy||!mismatch)continue;
        const plan=this.dayPlan(s);
        if(JSON.stringify(plan.call.args[2])!==JSON.stringify(args[2]))continue;
        const reason='Corrected integer supplier quotes; retained original signed spending limits. Orders exceeding those limits were skipped.';
        plan.state.log.push({id:plan.state.nextLogId++,day:plan.state.day,agent:null,type:'settlement',text:reason});
        this.db.prepare('INSERT INTO arc_job_repairs VALUES (?,?,?,?)').run(job.id,reason,job.payload,this.now());
        this.db.prepare("UPDATE arc_jobs SET payload=?,status='queued',error=NULL,updated_at=? WHERE id=?").run(stringify(plan),this.now(),job.id);
      }
    });
  }
  summary(s){
    const result=super.summary(s);if(!this.arc)return result;
    const pending=this.db.prepare("SELECT kind,status,error,hash FROM arc_jobs WHERE season_id=? AND status NOT IN ('confirmed') ORDER BY id").all(s.id);
    const snapshot=this.db.prepare('SELECT value FROM settings WHERE key=?').get(`arc_balance:${s.id}`);
    const testFixture=this.bookScope==='contract-test-fixtures';
    return {...result,testFixture,entrants:result.entrants.map(e=>({...e,humanBacked:e.humanBacked&&!testFixture})),arc:this.arc.metadata,escrow:snapshot?JSON.parse(snapshot.value):null,settlement:pending.find(j=>j.kind==='day')||null,pendingEntries:pending.filter(j=>j.kind==='join'&&j.status!=='failed').length};
  }
  publicView(id){const result=super.publicView(id);return {...result,transactions:this.jobs(id)};}
  queue(op,id,kind,payload,address=null,humanKey=null){
    this.db.prepare('INSERT INTO arc_jobs(op,season_id,kind,address,human_key,payload,updated_at) VALUES (?,?,?,?,?,?,?)').run(op,Number(id),kind,address,humanKey,stringify(payload),this.now());
  }
  async join(id,identity,{name,strategy='Independent',funding}={}){
    for(const value of [name,strategy])if(typeof value!=='string'||!profilePattern.test(value.trim()))fail(400,'Name and strategy must be 1–24 letters, numbers, spaces, dots, hyphens or underscores.');
    const address=identity.address.toLowerCase(),humanKey=this.humanKey(id,identity.humanId),op=`join:${id}:${address}`;
    const entry=this.db.prepare('SELECT * FROM entrants WHERE season_id=? AND (address=? OR human_key=?)').get(Number(id),address,humanKey);
    if(entry){if(entry.address!==address||entry.human_key!==humanKey)fail(409,this.bookScope.startsWith('world-id-sandbox:')?'One agent per Sandbox profile per season.':'One agent per verified human per season.');return {slot:entry.slot,season:this.summary(this.get(id)),alreadyJoined:true};}
    const prior=this.db.prepare('SELECT * FROM arc_jobs WHERE op=?').get(op);
    if(prior&&prior.status!=='failed')return {pending:true,season:this.summary(this.get(id)),transaction:{status:prior.status,hash:prior.hash}};
    const s=this.get(id);if(s.state.phase!=='lobby')fail(409,'This season is full or finished.');
    this.assertSeatAvailable(id,address,this.db.prepare("SELECT address FROM arc_jobs WHERE season_id=? AND kind='join' AND status NOT IN ('confirmed','failed')").all(Number(id)));
    const deadline=funding?.deadline??Math.floor(this.now()/1000)+3600;
    if(!Number.isInteger(deadline)||deadline<Math.floor(this.now()/1000)+15||deadline>Math.floor(this.now()/1000)+3600)fail(400,'Funding signature expired or has an invalid deadline. Request a fresh ticket.');
    const typedData=joinTypedData(this.arc.metadata,{seasonId:id,humanId:`0x${humanKey}`,deadline});
    if(!funding?.signature)return {fundingRequired:true,arc:this.arc.metadata,approval:{token:this.arc.metadata.token,spender:this.arc.metadata.contract,amountMicros:'1000000'},typedData};
    if(!validSignature(funding.signature)||!await this.arc.verify(address,typedData,funding.signature))fail(403,'Invalid Arc entry signature.');
    return this.transaction(()=>{
      const current=this.get(id);
      if(current.state.phase!=='lobby')fail(409,'This season filled while the entry was being signed.');
      const reserved=this.db.prepare("SELECT address,human_key,payload FROM arc_jobs WHERE season_id=? AND kind='join' AND status NOT IN ('confirmed','failed')").all(Number(id));
      this.assertSeatAvailable(id,address,reserved);
      // Recheck after signature verification, which yielded to concurrent requests.
      const entries=this.db.prepare('SELECT * FROM entrants WHERE season_id=?').all(Number(id));
      if([...reserved,...entries].some(r=>r.address===address||r.human_key===humanKey))fail(409,'This human or wallet already has an entry pending or confirmed.');
      if(reserved.length+entries.length>=4)fail(409,'All seats are funded or awaiting Arc confirmation.');
      if([...current.state.agents.filter(a=>a.registered).map(a=>a.name),...reserved.map(r=>JSON.parse(r.payload).profile.name)].some(n=>n.toLowerCase()===name.trim().toLowerCase()))fail(409,'That agent name is already used.');
      if(prior)this.db.prepare('DELETE FROM arc_jobs WHERE op=? AND status=?').run(op,'failed');
      this.queue(op,id,'join',{profile:{name:name.trim(),strategy:strategy.trim()},call:{functionName:'join',args:[Number(id),address,`0x${humanKey}`,deadline,funding.signature]}},address,humanKey);
      return {pending:true,season:this.summary(current),transaction:{status:'queued',hash:null}};
    });
  }
  observe(id,identity){
    const result=super.observe(id,identity);
    if(result.season.settlement)result.observation=null;
    if(result.observation){result.observation.arc=this.arc.metadata;result.observation.rules.settlement+=' This season requires an EIP-712 financial authorization; funds move only after Arc confirmation.';}
    return result;
  }
  async submit(id,identity,{day,decision,authorization}={}){
    if(!Number.isInteger(day)||day<1)fail(400,'A positive decision day is required.');
    try{validateDecision(decision);}catch(e){fail(400,e.message);}
    const s=this.get(id),entry=this.authorize(id,identity);
    const prior=this.db.prepare('SELECT decision FROM decisions WHERE season_id=? AND day=? AND slot=?').get(Number(id),day,entry.slot);
    if(prior){if(prior.decision!==JSON.stringify(decision))fail(409,'A decision is already locked.');return {accepted:true,duplicate:true,day,slot:entry.slot};}
    if(!s.morning||s.morning.day!==day||!s.deadline||this.now()>=s.deadline)fail(409,'This decision window has closed.');
    const permit=dayPermit(observation(s.morning,entry.slot),decision);
    if(!validSignature(authorization)||!await this.arc.verify(identity.address,dayTypedData(this.arc.metadata,{seasonId:id,day,...permit}),authorization))fail(403,'A valid Arc daily financial authorization is required.');
    return this.transaction(()=>{
      const current=this.get(id),owner=this.authorize(id,identity);
      if(!current.morning||current.morning.day!==day||!current.deadline||this.now()>=current.deadline)fail(409,'This decision window has closed.');
      if(!current.morning.agents.find(a=>a.id===owner.slot).active)fail(409,'This machine is closed.');
      const locked=this.db.prepare('SELECT decision FROM decisions WHERE season_id=? AND day=? AND slot=?').get(Number(id),day,owner.slot);
      if(locked){if(locked.decision!==JSON.stringify(decision))fail(409,'A decision is already locked.');return {accepted:true,duplicate:true,day,slot:owner.slot};}
      this.db.prepare('INSERT INTO arc_permits VALUES (?,?,?,?)').run(Number(id),day,owner.slot,stringify({...permit,signature:authorization}));
      this.db.prepare('INSERT INTO decisions VALUES (?,?,?,?,?)').run(Number(id),day,owner.slot,JSON.stringify(decision),this.now());
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM decisions WHERE season_id=? AND day=?').get(Number(id),day).n;
      if(count===current.morning.agents.filter(a=>a.active).length)this.settle(current);
      return {accepted:true,duplicate:false,day,slot:owner.slot};
    });
  }
  settle(s){
    const op=`day:${s.id}:${s.morning.day}`;if(this.db.prepare('SELECT 1 FROM arc_jobs WHERE op=?').get(op))return;
    this.queue(op,s.id,'day',this.dayPlan(s));
    s.deadline=null;s.next_day_at=null;this.save(s);
  }
  withdraw(id,identity){
    const entry=this.authorize(id,identity),s=this.get(id);
    if(s.state.phase!=='finished')fail(409,'Withdrawals open after the season finishes. The wallet can call the escrow directly after a 24-hour server outage.');
    const op=`withdraw:${id}:${entry.slot}`,prior=this.db.prepare('SELECT status,hash FROM arc_jobs WHERE op=?').get(op);
    if(prior)return prior;
    const slot=s.state.agents.findIndex(a=>a.id===entry.slot);
    if(this.summary(s).escrow?.machines[slot]?.claimed)return {status:'confirmed',alreadyWithdrawn:true};
    this.queue(op,id,'withdraw',{call:{functionName:'withdraw',args:[Number(id),slot]}},entry.address);
    return {status:'queued',hash:null};
  }
  nextWake(){const at=super.nextWake(),pending=this.db.prepare("SELECT 1 FROM arc_jobs WHERE status NOT IN ('confirmed','failed') LIMIT 1").get();return pending?Math.min(at??Infinity,this.now()+5000):at;}
  async pump(){
    if(this.pumping)return this.pumping;
    this.pumping=this.processOne().finally(()=>{this.pumping=null;});return this.pumping;
  }
  async processOne(){
    const job=this.db.prepare("SELECT * FROM arc_jobs WHERE status NOT IN ('confirmed','failed') ORDER BY id LIMIT 1").get();if(!job){await this.refreshChain();return;}
    const payload=JSON.parse(job.payload);
    try{
      if(!job.raw){
        const prepared=await this.arc.prepare(payload.call);
        this.db.prepare("UPDATE arc_jobs SET raw=?,hash=?,status='prepared',error=NULL,updated_at=? WHERE id=?").run(prepared.raw,prepared.hash,this.now(),job.id);
        job.raw=prepared.raw;job.hash=prepared.hash;
      }
      const receipt=await this.arc.receipt(job.hash);
      if(!receipt){
        try{await this.arc.broadcast(job.raw);}catch(error){if(!/already known|nonce too low/i.test(error.message))throw error;}
        this.db.prepare("UPDATE arc_jobs SET status='broadcast',error=NULL,updated_at=? WHERE id=?").run(this.now(),job.id);return;
      }
      if(receipt.status!=='success'){
        this.db.prepare("UPDATE arc_jobs SET status='failed',receipt=?,error='Arc transaction reverted; game balances were not changed.',updated_at=? WHERE id=?").run(stringify(receipt),this.now(),job.id);return;
      }
      const expected=job.kind==='join'?'Funded':job.kind==='day'?'DaySettled':'Withdrawn';
      const event=receipt.events.find(e=>e.eventName===expected&&Number(e.args.seasonId)===job.season_id);
      if(!event)throw Error('Arc receipt is missing the expected season event. Reconciliation paused.');
      if(job.kind==='day'&&event.args.commitment!==payload.call.commitment)throw Error('Arc day commitment mismatch. Reconciliation paused.');
      this.transaction(()=>{
        const current=this.db.prepare('SELECT status FROM arc_jobs WHERE id=?').get(job.id);if(current.status==='confirmed')return;
        const s=this.get(job.season_id);
        if(job.kind==='join'){
          const slot=s.state.agents.find(a=>!a.registered);
          if(!slot||s.state.agents.indexOf(slot)!==Number(event.args.slot)||event.args.wallet.toLowerCase()!==job.address)throw Error('Funded seat does not match reserved seat. Reconciliation paused.');
          Object.assign(slot,payload.profile,{brief:this.participantBrief(job.address),participantKind:this.participantKind(job.address)});
          s.state=registerAgent(s.state,slot.id);
          this.db.prepare('INSERT INTO entrants VALUES (?,?,?,?,?)').run(s.id,slot.id,job.address,job.human_key,this.now());
          if(s.state.agents.every(a=>a.registered)){s.state=startRound(s.state);this.beginDay(s);}
        }else if(job.kind==='day'){
          if(Number(event.args.customerBudget)!==payload.state.customerBudgetRemaining||event.args.cash.some((cash,i)=>Number(cash)!==payload.state.agents[i].cash))throw Error('Arc balances differ from the planned game day.');
          s.state=payload.state;s.morning=null;s.deadline=null;s.next_day_at=s.state.phase==='finished'?null:this.now()+this.intermissionMs;
          s.state.arcReceipt={hash:job.hash,blockNumber:receipt.blockNumber,gasUsdc:receipt.gasUsdc};
          for(const tx of s.state.customerTransactions)tx.hash=job.hash;
          for(const tx of s.state.transactionHistory)if(tx.day===s.state.day)tx.hash=job.hash;
          if(s.state.phase==='finished')s.finished_at=this.now();
        }
        this.db.prepare("UPDATE arc_jobs SET status='confirmed',receipt=?,error=NULL,updated_at=? WHERE id=?").run(stringify(receipt),this.now(),job.id);
        this.save(s);this.ensureLobby();
      });
    }catch(error){
      // Only a definite preflight contract revert is terminal. RPC uncertainty
      // keeps the exact signed transaction pending for safe recovery.
      const reverted=!job.raw&&Boolean(error.walk?.(e=>e.name==='ContractFunctionRevertedError')?.name==='ContractFunctionRevertedError');
      const message=reverted?'Arc rejected this operation during preflight. No funds moved.':arcErrorMessage(error);
      this.db.prepare('UPDATE arc_jobs SET status=?,error=?,updated_at=? WHERE id=?').run(reverted?'failed':job.raw?'broadcast':'queued',message,this.now(),job.id);
      console.error('Arc settlement:',message);
    }
  }
  async refreshChain(){
    if(!this.arc.snapshot||this.now()<(this.nextRefresh??0))return;this.nextRefresh=this.now()+10000;
    const ids=this.db.prepare('SELECT DISTINCT season_id FROM entrants ORDER BY season_id DESC LIMIT 100').all();if(!ids.length)return;
    this.refreshIndex=((this.refreshIndex??-1)+1)%ids.length;const id=ids[this.refreshIndex].season_id;
    try{
      const snapshot={...await this.arc.snapshot(id),checkedAt:this.now()};
      this.transaction(()=>{
        this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(`arc_balance:${id}`,stringify(snapshot));
        const s=this.get(id);
        if(snapshot.aborted){
          s.state.phase='finished';s.state.finishReason='operator_timeout';for(const a of s.state.agents)a.active=false;
          s.state.customerBudgetRefunded=s.state.customerBudgetTotal-s.state.customerBudgetSpent-snapshot.customerBudget;
          s.state.customerBudgetRemaining=snapshot.customerBudget;s.morning=null;s.deadline=null;s.next_day_at=null;s.finished_at??=this.now();this.save(s);this.ensureLobby();
        }
      });
    }catch(error){console.error('Arc balance refresh:',arcErrorMessage(error));}
  }
}
