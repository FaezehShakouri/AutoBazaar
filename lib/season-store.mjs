import {createHmac,randomBytes,randomInt} from 'node:crypto';
import {createGame,registerAgent,startRound,prepareDay,settleDay,observation,validateDecision} from '../dist/engine.js';

export class SeasonError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
const fail=(status,message)=>{throw new SeasonError(status,message);};
const encode=JSON.stringify;
const namePattern=/^[\p{L}\p{N} ._-]{1,24}$/u;

// All state transitions are synchronous SQLite transactions. Multiple requests
// or processes using this same database cannot claim the same seat or day.
export class SeasonStore {
  constructor({db,turnMs=180000,intermissionMs=30000,now=Date.now,bookScope='worldchain:480:canonical'}={}){
    if(!db)throw Error('A season database is required.');
    for(const [key,value] of Object.entries({turnMs,intermissionMs}))if(!Number.isInteger(value)||value<1)throw Error(`Invalid ${key}.`);
    this.db=db;this.now=now;this.turnMs=turnMs;this.intermissionMs=intermissionMs;this.bookScope=bookScope;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seasons(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL,finished_at INTEGER,state TEXT NOT NULL,morning TEXT,deadline INTEGER,next_day_at INTEGER);
      CREATE TABLE IF NOT EXISTS entrants(season_id INTEGER NOT NULL,slot TEXT NOT NULL,address TEXT NOT NULL,human_key TEXT NOT NULL,joined_at INTEGER NOT NULL,PRIMARY KEY(season_id,slot),UNIQUE(season_id,address),UNIQUE(season_id,human_key));
      CREATE TABLE IF NOT EXISTS decisions(season_id INTEGER NOT NULL,day INTEGER NOT NULL,slot TEXT NOT NULL,decision TEXT NOT NULL,submitted_at INTEGER NOT NULL,PRIMARY KEY(season_id,day,slot));
      CREATE TABLE IF NOT EXISTS challenges(nonce TEXT PRIMARY KEY,info TEXT NOT NULL,method TEXT NOT NULL,body_hash TEXT NOT NULL,expires INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS challenge_expiry ON challenges(expires);`);
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run('identity_salt',randomBytes(32).toString('hex'));
    this.salt=this.db.prepare('SELECT value FROM settings WHERE key=?').get('identity_salt').value;
    this.transaction(()=>{
      const scope=this.db.prepare('SELECT value FROM settings WHERE key=?').get('book_scope');
      if(scope&&scope.value!==bookScope)throw Error('This database belongs to another AgentBook environment. Use a separate database.');
      this.db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run('book_scope',bookScope);
      this.ensureLobby();
    });
  }
  transaction(fn){if(this.db.transactionSync)return this.db.transactionSync(fn);this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  close(){this.db.close();}
  get(id){
    if(!Number.isSafeInteger(Number(id))||Number(id)<1)fail(404,'Season not found.');
    const row=this.db.prepare('SELECT * FROM seasons WHERE id=?').get(Number(id));if(!row)fail(404,'Season not found.');
    return {...row,state:JSON.parse(row.state),morning:row.morning?JSON.parse(row.morning):null};
  }
  save(s){this.db.prepare('UPDATE seasons SET state=?,morning=?,deadline=?,next_day_at=?,finished_at=? WHERE id=?').run(encode(s.state),s.morning?encode(s.morning):null,s.deadline??null,s.next_day_at??null,s.finished_at??null,s.id);}
  ensureLobby(){
    const open=this.db.prepare("SELECT id FROM seasons WHERE json_extract(state,'$.phase')='lobby' ORDER BY id LIMIT 1").get();if(open)return open.id;
    const state=createGame({mode:'remote',seed:randomInt(0,4294967296),startDate:new Date(this.now()).toISOString().slice(0,10)});
    const result=this.db.prepare('INSERT INTO seasons(created_at,state) VALUES (?,?)').run(this.now(),encode(state));
    const id=Number(result.lastInsertRowid);state.round=id;this.db.prepare('UPDATE seasons SET state=? WHERE id=?').run(encode(state),id);return id;
  }
  humanKey(id,humanId){return createHmac('sha256',this.salt).update(`${this.bookScope}:${id}:${humanId}`).digest('hex');}
  entries(id){return this.db.prepare('SELECT slot,address,joined_at FROM entrants WHERE season_id=? ORDER BY joined_at,slot').all(id);}
  summary(s){
    const entries=this.entries(s.id),submitted=s.morning?this.db.prepare('SELECT slot FROM decisions WHERE season_id=? AND day=?').all(s.id,s.morning.day).map(r=>r.slot):[];
    return {id:s.id,status:s.state.phase==='lobby'?'open':s.state.phase==='finished'?'finished':'running',day:s.state.day,decidingDay:s.morning?.day??null,deadline:s.deadline,nextDayAt:s.next_day_at,createdAt:s.created_at,finishedAt:s.finished_at,registered:entries.length,capacity:4,registrationStake:s.state.registrationStake,startingCash:s.state.startingCash,customerBudget:s.state.customerBudgetRemaining,turnMs:this.turnMs,intermissionMs:this.intermissionMs,submitted,
      entrants:entries.map(e=>{const a=s.state.agents.find(a=>a.id===e.slot);return {slot:e.slot,name:a.name,strategy:a.strategy,color:a.color,address:e.address,humanBacked:true,cash:a.cash,active:a.active};}),
      standings:s.state.phase==='finished'?s.state.agents.slice().sort((a,b)=>b.cash-a.cash||a.id.localeCompare(b.id)).map(a=>({slot:a.id,name:a.name,cash:a.cash,revenue:a.revenue,sold:a.sold,rank:1+s.state.agents.filter(b=>b.cash>a.cash).length})):[]};
  }
  list(){return this.db.prepare('SELECT id FROM seasons ORDER BY id DESC LIMIT 100').all().map(row=>this.summary(this.get(row.id)));}
  publicView(id){const s=this.get(id),state=structuredClone(s.state);delete state.rng;delete state.salesModel;for(const a of state.agents)a.memory='';return {season:this.summary(s),state};}
  authorize(id,identity){
    const entry=this.db.prepare('SELECT * FROM entrants WHERE season_id=? AND address=?').get(Number(id),identity.address.toLowerCase());
    if(!entry||entry.human_key!==this.humanKey(id,identity.humanId))fail(403,'This wallet and its currently verified human do not own a seat in this season.');
    return entry;
  }
  join(id,identity,{name,strategy='Independent'}={}){
    if(typeof name!=='string'||!namePattern.test(name.trim()))fail(400,'Agent name must be 1–24 letters, numbers, spaces, dots, hyphens or underscores.');
    if(typeof strategy!=='string'||!namePattern.test(strategy.trim()))fail(400,'Strategy label must be 1–24 letters, numbers, spaces, dots, hyphens or underscores.');
    return this.transaction(()=>{
      const s=this.get(id),address=identity.address.toLowerCase(),humanKey=this.humanKey(id,identity.humanId);
      const existing=this.db.prepare('SELECT * FROM entrants WHERE season_id=? AND (address=? OR human_key=?)').all(s.id,address,humanKey);
      if(existing.some(e=>e.address===address&&e.human_key===humanKey))return {slot:existing.find(e=>e.address===address).slot,season:this.summary(s),alreadyJoined:true};
      if(existing.length)fail(409,'One agent per verified human per season. This human or wallet already has a seat.');
      if(s.state.phase!=='lobby')fail(409,'This season is full or has finished. Join an open season.');
      if(s.state.agents.some(a=>a.registered&&a.name.toLowerCase()===name.trim().toLowerCase()))fail(409,'That agent name is already used in this season.');
      const slot=s.state.agents.find(a=>!a.registered);slot.name=name.trim();slot.strategy=strategy.trim();slot.brief='Independent remote agent acting on behalf of a verified human.';
      s.state=registerAgent(s.state,slot.id);
      this.db.prepare('INSERT INTO entrants VALUES (?,?,?,?,?)').run(s.id,slot.id,address,humanKey,this.now());
      if(s.state.agents.every(a=>a.registered)){s.state=startRound(s.state);this.beginDay(s);}
      this.save(s);this.ensureLobby();return {slot:slot.id,season:this.summary(s),alreadyJoined:false};
    });
  }
  beginDay(s){s.morning=prepareDay(s.state);s.deadline=this.now()+this.turnMs;s.next_day_at=null;}
  observe(id,identity){
    const s=this.get(id),entry=this.authorize(id,identity),submitted=s.morning?Boolean(this.db.prepare('SELECT 1 FROM decisions WHERE season_id=? AND day=? AND slot=?').get(s.id,s.morning.day,entry.slot)):false;
    return {season:this.summary(s),slot:entry.slot,submitted,observation:s.morning?observation(s.morning,entry.slot):null};
  }
  submit(id,identity,{day,decision}={}){
    if(!Number.isInteger(day)||day<1)fail(400,'A positive decision day is required.');
    try{validateDecision(decision);}catch(e){fail(400,e.message);}
    return this.transaction(()=>{
      const s=this.get(id),entry=this.authorize(id,identity),prior=this.db.prepare('SELECT decision FROM decisions WHERE season_id=? AND day=? AND slot=?').get(s.id,day,entry.slot);
      if(prior){if(prior.decision!==encode(decision))fail(409,'A decision is already locked for this day.');return {accepted:true,duplicate:true,day,slot:entry.slot};}
      if(!s.morning||s.morning.day!==day||this.now()>=s.deadline)fail(409,'This decision window has closed. Fetch a fresh observation.');
      if(!s.morning.agents.find(a=>a.id===entry.slot).active)fail(409,'This machine is closed.');
      this.db.prepare('INSERT INTO decisions VALUES (?,?,?,?,?)').run(s.id,day,entry.slot,encode(decision),this.now());
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM decisions WHERE season_id=? AND day=?').get(s.id,day).n;
      if(count===s.morning.agents.filter(a=>a.active).length)this.settle(s);
      return {accepted:true,duplicate:false,day,slot:entry.slot};
    });
  }
  settle(s){
    const decisions=Object.fromEntries(this.db.prepare('SELECT slot,decision FROM decisions WHERE season_id=? AND day=?').all(s.id,s.morning.day).map(r=>[r.slot,JSON.parse(r.decision)]));
    for(const a of s.morning.agents.filter(a=>a.active))if(!decisions[a.id])decisions[a.id]={prices:{},load:{},orders:[],rationale:'Decision deadline missed. Kept prices and placed no orders or restocks.',memory:a.memory};
    s.state=settleDay(s.morning,decisions);s.morning=null;s.deadline=null;
    s.next_day_at=s.state.phase==='finished'?null:this.now()+this.intermissionMs;
    if(s.state.phase==='finished')s.finished_at=this.now();this.save(s);
  }
  tick(){this.transaction(()=>{
    const due=this.db.prepare('SELECT id FROM seasons WHERE deadline<=? OR next_day_at<=?').all(this.now(),this.now());
    for(const row of due){const s=this.get(row.id);if(s.morning&&s.deadline<=this.now())this.settle(s);else if(s.next_day_at&&s.next_day_at<=this.now()){this.beginDay(s);this.save(s);}}
    this.db.prepare('DELETE FROM challenges WHERE expires<?').run(this.now()-60000);
  });}
  nextWake(){return this.db.prepare('SELECT MIN(time) AS time FROM (SELECT deadline AS time FROM seasons WHERE deadline IS NOT NULL UNION ALL SELECT next_day_at AS time FROM seasons WHERE next_day_at IS NOT NULL)').get().time;}
  saveChallenge(info,method,bodyHash){
    if(this.db.prepare('SELECT COUNT(*) AS n FROM challenges WHERE expires>?').get(this.now()).n>=10000)fail(503,'Verification is busy. Retry shortly.');
    this.db.prepare('INSERT INTO challenges(nonce,info,method,body_hash,expires) VALUES (?,?,?,?,?)').run(info.nonce,encode(info),method,bodyHash,Date.parse(info.expirationTime));
  }
  challenge(nonce){const row=this.db.prepare('SELECT * FROM challenges WHERE nonce=?').get(nonce);return row?{...row,info:JSON.parse(row.info)}:null;}
  consumeChallenge(nonce){const result=this.db.prepare('UPDATE challenges SET consumed=1 WHERE nonce=? AND consumed=0 AND expires>?').run(nonce,this.now());if(result.changes!==1)fail(401,'This challenge expired or was already used. Make a new request.');}
}
