const $=id=>document.getElementById(id),token=document.querySelector('meta[name="dashboard-token"]').content;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Display milli-USDC; API decisions and balances remain integer game units.
const money=n=>(Number(n||0)/100).toLocaleString('en-US',{maximumFractionDigits:2});
const moneyText=text=>String(text??'').replace(/\$([\d,]+(?:\.\d+)?)/g,(_,amount)=>`${money(Number(amount.replaceAll(',',''))*100000)} mUSDC`);
const when=n=>n?new Date(n).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const short=a=>a?`${a.slice(0,8)}…${a.slice(-6)}`:'—';
const badge=(text,kind='')=>`<span class="badge ${kind}">${escape(text)}</span>`;
const empty=text=>`<p class="empty">${escape(text)}</p>`;
const presets={balanced:'Build a reliable, diverse assortment. Keep at least 0.08 USDC in cash for daily fees and replenishment. Start with small orders, use observed sales to adjust prices, and compare supplier costs against lead times. Explain each experiment and its result in your notebook.',value:'Compete on affordable prices and reliable availability. Focus first on water, cola and popular snacks. Preserve a positive margin, avoid stockouts, and increase prices gradually when demand stays strong. Keep at least 0.06 USDC in reserve; do not undercut without considering costs.',reserve:'Protect cash. Keep at least 0.15 USDC in reserve when possible. Buy small quantities of products with proven demand, avoid slow inventory, and favor margins over volume. Reduce purchases as the customer budget shrinks. Track fees and explain why each order is worth its cost.'};
let state=null,dirty=false,editorRevision=null,busy=false,polling=false,toastTimer,activeTab='decisions';
const cache=new Map();
function html(id,value){if(cache.get(id)!==value){$(id).innerHTML=value;cache.set(id,value);}}
function toast(message,error=false){$('toast').hidden=false;$('toast').classList.toggle('error',error);$('toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000);}
async function api(path,body){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'X-Dashboard-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||`Request failed (${r.status}).`);return data;}
function strategyLabel(){
  $('save-strategy').disabled=busy||!dirty||!state;
  $('strategy-state').textContent=dirty?(editorRevision!==state?.strategy.revision?'Newer version exists · refresh before saving':`${$('instructions').value.length}/6000 · unsaved changes`):`Revision ${state?.strategy.revision||1} · saved locally`;
}
function decisionDetails(decision,products,suppliers){
  const d=decision||{},name=id=>products.find(p=>p.id===id)?.name||id;
  return `<table class="data-table"><thead><tr><th>Product</th><th>Price · mUSDC</th><th>Load requested</th></tr></thead><tbody>${products.map(p=>`<tr><td>${escape(p.icon)} ${escape(p.name)}</td><td>${d.prices?.[p.id]===undefined?'Unchanged':money(d.prices[p.id])}</td><td>${Number(d.load?.[p.id]||0)}</td></tr>`).join('')}</tbody></table><div class="orders">${(d.orders||[]).map(o=>`<span class="order-chip">${Number(o.quantity)} × ${escape(name(o.product))} · ${escape(suppliers.find(s=>s.id===o.supplier)?.name||o.supplier)}</span>`).join('')||'<span class="muted">No supplier orders.</span>'}</div><details class="decision-details"><summary>Private agent notebook</summary><div class="notebook">${escape(d.memory||'No notebook yet.')}</div></details>`;
}
function render(s){
  state=s;
  if(!dirty){$('instructions').value=s.strategy.instructions;editorRevision=s.strategy.revision;}strategyLabel();
  const v=s.view,a=v?.self,products=v?.products||[],suppliers=v?.suppliers||[],season=v?.season;
  const houses=season?.seatCounts?.house||0,houseRequest=season?.houseRequest;
  $('house-control').hidden=!(season?.mode==='demo'&&season.status!=='finished'&&season.entrants.find(e=>e.slot===v.slot)?.participantKind==='human');
  const houseButton=$('add-house-agents');
  const housePending=houseRequest&&['queued','starting','playing'].includes(houseRequest.status);
  houseButton.disabled=busy||!v||Boolean(housePending)||houses===3&&houseRequest?.status!=='failed';
  houseButton.textContent=houseRequest?.status==='failed'?'Retry house agents ↗':houses===3?'3 house agents joined':housePending?'House agents requested…':'Add 3 house agents ↗';
  $('house-status').textContent=houses===3?'All three rivals have joined. Watch their decisions and Arc receipts as the season plays.':houseRequest?.status==='failed'?`${houses}/3 joined. ${houseRequest.message||'The host needs to retry the house runner.'}`:houseRequest?.status==='queued'?`${houses}/3 joined. Request queued; waiting for the host runner. It handles one season at a time.`:houseRequest&&!houseRequest.hostOnline?`${houses}/3 joined. Waiting for the host runner to reconnect.`:houseRequest?.status==='starting'?`${houses}/3 joined. The host is connecting their wallets and confirming entries on Arc.`:'Your seat is confirmed. Add the three house agents when you are ready to play.';
  $('agent-name').textContent=a?.name||'Your agent';$('avatar').textContent=(a?.name||'A').slice(0,1).toUpperCase();
  $('agent-address').textContent=short(s.wallet);$('agent-address').title=s.wallet;
  for(const id of ['watch-side','watch-top'])$(id).href=`${s.server}/play?season=${s.seasonId}`;
  const settlement=season?.settlement,blocked=settlement?.status==='failed';
  $('connection').hidden=Boolean(v&&!s.error&&!blocked);$('connection').classList.toggle('error',Boolean(s.error||blocked));
  $('connection').textContent=s.error?`${s.error}${s.lastSyncedAt?` Last synced ${when(s.lastSyncedAt)}; showing that snapshot.`:' Join this season with the agent runner first if this wallet has no seat.'}`:blocked?`Season paused at Arc settlement for day ${(season?.day||0)+1}. ${settlement.error||'The host must resolve the failed transaction.'} New decisions are unavailable until the host resolves settlement; you can still save your strategy.`:'Connecting securely with your agent wallet…';
  html('season-meta',`Season ${s.seasonId} · ${escape(season?.mode==='demo'?'Hackathon demo':'Shared game')}<br>${escape(season?.status||'Connecting')} · ${season?.arc?'Arc Testnet':'Simulation'}`);
  const remaining=season?.deadline?Math.max(0,Math.ceil((season.deadline-Date.now())/1000)):0;
  html('window',settlement?`<strong>Day ${(season?.day||0)+1} · ${blocked?'Settlement blocked':'Settling on Arc'}</strong><br>${blocked?'Host action needed':'Waiting for confirmation'}`:season?.status==='finished'?'<strong>Season complete</strong><br>Archive ready':!a?.active&&a?'<strong>Machine closed</strong><br>Review your season below':season?.deadline?`<strong>Day ${season.decidingDay} · ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}</strong><br>${v.submitted?'Decision locked':remaining?'Decision window open':'Awaiting settlement'}`:`<strong>Day ${season?.day||0} settled</strong><br>${season?.status==='open'?'Waiting for entrants':'Waiting for next window'}`);
  const currency=season?.arc?'test mUSDC':'sim. mUSDC';
  html('metrics',[
    ['Operating cash',a?money(a.cash):'—',currency,'Confirmed game balance'],
    ['Sales revenue',a?money(a.revenue):'—',currency,a?`${a.sold} items sold this season`:'Awaiting your agent'],
    ['Inventory spend',a?money(a.spending):'—',currency,'Supplier purchases to date'],
    ['Daily fees',a?money(a.fees):'—',currency,'2 mUSDC per game day']
  ].map(([label,value,unit,note])=>`<article class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-note">${escape(note)}</div></article>`).join(''));
  $('machine-status').textContent=a?(a.active?'OPEN':'CLOSED'):'CONNECTING';
  if(a){
    html('machine',`<div class="machine-scene"><div class="cabinet" role="img" aria-label="Your vending machine, ${Object.values(a.inventory).reduce((x,y)=>x+y,0)} items in stock"><div class="cabinet-brand">${escape(a.name.toUpperCase().slice(0,14))}</div><div class="cabinet-glass">${products.map(p=>`<div class="shelf-item ${a.inventory[p.id]?'':'sold-out'}"><span>${escape(p.icon)}</span><small>${Number(a.inventory[p.id])}</small></div>`).join('')}</div><div class="vend-slot"></div></div><div class="machine-stat"><b>${Object.values(a.inventory).reduce((x,y)=>x+y,0)}</b>items on shelves<span>LAST SETTLED DAY</span><b>${Object.values(a.lastSales).reduce((x,y)=>x+y,0)}</b>items sold</div></div>`);
    html('inventory',`<table class="data-table"><thead><tr><th>Product</th><th>Price · mUSDC</th><th>Shelf / 30</th><th>Storage</th></tr></thead><tbody>${products.map(p=>`<tr><td>${escape(p.name)}</td><td>${money(a.prices[p.id])}</td><td>${a.inventory[p.id]}<span class="stockbar"><i style="width:${Math.min(100,Math.max(0,a.inventory[p.id]/30*100))}%"></i></span></td><td>${a.storage[p.id]}</td></tr>`).join('')}</tbody></table>`);
    html('deliveries',`<div class="delivery-title">INCOMING DELIVERIES</div>${a.orders.map(o=>`<div class="delivery"><span>${o.quantity} × ${escape(products.find(p=>p.id===o.product)?.name||o.product)}</span><span>Day ${o.arrives}</span></div>`).join('')||empty('Nothing in transit.')}<p class="hint">Stock and cash reflect the last settled day. New deliveries appear in the next morning observation before your agent decides.</p>`);
    const history=v.history.length?v.history:[{day:0,cash:a.cash}],max=Math.max(...history.map(h=>h.cash),50000),min=Math.min(...history.map(h=>h.cash),50000),span=max-min||5000,x=i=>42+(i/Math.max(1,history.length-1))*272,y=n=>135-(n-min)/span*103;
    const points=history.map((h,i)=>`${x(i)},${y(h.cash)}`).join(' ');
    html('cash-chart',`<svg class="chart" viewBox="0 0 330 165" role="img" aria-label="Operating cash: ${money(history[0].cash)} to ${money(history.at(-1).cash)} mUSDC over ${history.length} recorded days"><path d="M42 28H315 M42 81H315 M42 135H315" stroke="#e3e9da" stroke-dasharray="3 4"/><polygon points="42,135 ${points} ${x(history.length-1)},135" fill="#e8f1d9"/><polyline points="${points}" fill="none" stroke="#749850" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${x(history.length-1)}" cy="${y(history.at(-1).cash)}" r="4" fill="#315a37"/><text x="0" y="32" class="chart-label">${money(max)}</text><text x="0" y="138" class="chart-label">${money(min)}</text><text x="42" y="160" class="chart-label">Day ${history[0].day}</text><text x="314" y="160" text-anchor="end" class="chart-label">Day ${history.at(-1).day}</text></svg><p class="chart-note">mUSDC · ${money(a.cash-50000)} change from starting capital</p>`);
  }else for(const id of ['machine','inventory','deliveries','cash-chart'])html(id,id==='machine'||id==='cash-chart'?empty('Waiting for your signed dashboard response…'):'');
  html('strategy-history',s.strategyHistory.map(h=>`<div class="strategy-version"><b>Revision ${h.revision}</b> · ${when(h.createdAt)}<p>${escape(h.instructions||'Independent strategy. No owner guidance yet.')}</p></div>`).join(''));
  $('runner-state').textContent=s.working?'THINKING':s.submitting?'SUBMITTING':s.mode.toUpperCase();
  document.querySelectorAll('[data-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.mode===s.mode));b.disabled=busy;});
  $('mode-note').textContent={paused:'No new decisions are generated or submitted. A decision already being signed can still complete. Game deadlines continue while paused.',review:'Codex drafts each open day. Review the plan below, then approve it before the deadline. The draft alone does not spend funds.',automatic:'Codex generates and signs one decision per open day, using your latest saved strategy. Purchases and fees settle from your existing game capital.'}[s.mode];
  const d=s.draft,eligible=Boolean(v?.observation&&!v.submitted&&v.observation.self.active&&season.deadline>Date.now()&&season.status==='running');
  $('draft-status').textContent=d?d.status.toUpperCase():'NO DRAFT';
  const waiting=!v?'Connect to your agent to see its next move.':settlement?(blocked?'The current day failed Arc settlement. Your funds panel still shows confirmed balances. Save guidance now; new drafts can resume after the host resolves settlement.':'Waiting for Arc to confirm the current day before the next decision window.'):season.status==='finished'?'This season is complete. Your decisions and results are archived below.':!a.active?'This machine has closed. The journal retains its past decisions.':v.submitted?'Today’s decision is locked. Your next draft will use the latest saved guidance.':s.mode==='paused'?'Choose Review to generate a decision you can approve, or Automatic to let your agent play.':'Waiting for the next open decision window.';
  html('draft',d?`<div class="draft-meta"><span>Day ${d.day} · Strategy revision ${d.revision}</span><span>${when(d.created_at)}</span></div>${d.status==='thinking'?'<div class="thinking"><span class="spinner"></span>Codex is planning the next move…</div>':''}${d.error?`<p class="connection error">${escape(d.error)}</p>`:''}${d.decision?`<p class="rationale">${escape(d.decision.rationale)}</p>${decisionDetails(d.decision,products,suppliers)}`:d.status==='thinking'?'':empty(waiting)}`:empty(waiting));
  const approve=eligible&&d?.status==='draft'&&d.revision===s.strategy.revision&&s.mode==='review'&&!s.submitting&&!busy;
  const retry=eligible&&d&&['error','expired','superseded','draft','uncertain'].includes(d.status)&&s.mode!=='paused'&&!s.working&&!s.submitting&&!busy;
  html('draft-actions',`${d&&['error','expired','superseded','draft','uncertain'].includes(d.status)?`<button class="button outline" data-action="retry" ${retry?'':'disabled'}>${d.status==='uncertain'?'Check & retry submission':'Generate fresh draft'}</button>`:''}${d?.status==='draft'?`<button class="button primary" data-action="approve" data-id="${d.id}" ${approve?'':'disabled'}>Approve & submit day ${d.day} ↗</button>`:''}`);
  const localRuns=s.runs.filter(r=>!['submitted','thinking','draft'].includes(r.status)).slice(0,10);
  let journal=(v?.decisions||[]).map(r=>`<article class="journal-entry"><div class="journal-heading"><strong>Day ${r.day} &nbsp; ${badge(r.status,r.status==='submitted'?'amber':'')}</strong><time>${when(r.submittedAt)}</time></div><p>${escape(r.decision.rationale)}</p><details class="decision-details"><summary>Prices, loading, orders & private notebook</summary>${decisionDetails(r.decision,products,suppliers)}</details></article>`).join('')||empty('No decisions submitted yet. Missed deadlines appear under Game events.');
  if(localRuns.length)journal+=`<details class="decision-details"><summary>Local draft attempts (${localRuns.length})</summary>${localRuns.map(r=>`<div class="event"><span class="event-day">Day ${r.day}</span><div>${badge(r.status,'amber')} &nbsp; Strategy ${r.revision}<p>${escape(r.error||'A newer draft replaced this attempt.')}</p></div></div>`).join('')}</details>`;
  html('panel-decisions',journal);
  html('panel-events',(v?.events||[]).map(e=>`<div class="event"><span class="event-day">Day ${e.day}</span><span class="event-tag">${escape(e.type)}</span><span>${escape(moneyText(e.text))}</span></div>`).join('')||empty('Game events will appear as the season progresses.'));
  html('panel-chain',(v?.transactions||[]).map(tx=>`<div class="receipt"><div><b>${escape({day:'Day settlement',join:'Agent deposit',withdraw:'Agent payout'}[tx.kind]||tx.kind)} &nbsp; ${badge(tx.status,tx.status==='confirmed'?'':'amber')}</b><p>${when(tx.updatedAt)} · Season-wide receipt${tx.receipt?` · Block ${escape(tx.receipt.blockNumber)} · Operator gas ${Number(tx.receipt.gasUsdc).toFixed(6)} USDC`:''}</p>${tx.error?`<p class="receipt-error">${escape(tx.error)}</p>`:''}</div>${/^0x[\da-f]{64}$/i.test(tx.hash||'')?`<a href="https://testnet.arcscan.app/tx/${tx.hash}" target="_blank" rel="noreferrer">${short(tx.hash)} ↗</a>`:`<span class="muted">${tx.status==='failed'?'No transaction broadcast':'Awaiting transaction'}</span>`}</div>`).join('')||empty(season?.arc?'No Arc receipts recorded yet.':'This season uses simulated funds.'));
}
async function refresh(){if(polling)return;polling=true;try{render(await api('state'));}catch(error){$('connection').hidden=false;$('connection').classList.add('error');$('connection').textContent=`Local runner disconnected. ${error.message} Keep the dashboard terminal running, then reload this page.`;}finally{polling=false;}}
async function action(path,body,message){if(busy)return;busy=true;if(state)render(state);try{await api(path,body);if(path==='strategy'){dirty=false;editorRevision=null;}toast(message);await refresh();}catch(error){toast(error.message,true);}finally{busy=false;if(state)render(state);}}
$('instructions').addEventListener('input',()=>{dirty=true;strategyLabel();});
$('save-strategy').addEventListener('click',()=>action('strategy',{instructions:$('instructions').value,expectedRevision:editorRevision},'Strategy saved. The next draft will use your guidance.'));
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.preset){$('instructions').value=presets[b.dataset.preset];dirty=true;strategyLabel();$('instructions').focus();}
  if(b.dataset.mode)void action('mode',{mode:b.dataset.mode},`Agent mode: ${b.dataset.mode}.`);
  if(b.dataset.action==='approve')void action('approve',{id:Number(b.dataset.id)},'Decision signed and locked. Follow the result in the agent journal.');
  if(b.dataset.action==='retry')void action('retry',{},'Retry requested. The runner checks the server before proceeding.');
  if(b.dataset.action==='house-agents')void action('house-agents',{},'House agents requested. Their confirmed entries will appear here.');
  if(b.dataset.tab){activeTab=b.dataset.tab;for(const name of ['decisions','events','chain']){$('panel-'+name).hidden=name!==activeTab;$('tab-'+name).setAttribute('aria-selected',String(name===activeTab));}}
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
void refresh();setInterval(()=>{void refresh();},2000);
