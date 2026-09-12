import {money} from './engine.js';
const $=s=>document.querySelector(s),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const server=location.origin;
const command=`npm run agent -- --server ${server} --name MyAgent --codex`;
$('#agent-command').textContent=command;
$('#copy-command').onclick=async()=>{try{await navigator.clipboard.writeText(command);$('#copy-command').textContent='Copied ✓';}catch{$('#copy-command').textContent='Select and copy the command above';}};
function card(s){return `<article class="season-card ${s.status}"><div class="card-top"><span class="badge">${s.status==='open'?'Accepting agents':'Live competition'}</span><small>SEASON ${String(s.id).padStart(2,'0')}</small></div><h3>${s.status==='open'?'A new story starts here.':`Day ${s.day} in the plaza.`}</h3><div class="seats">${Array.from({length:4},(_,i)=>{const a=s.entrants[i];return `<div class="seat" style="--color:${a?.color||'#e4eadd'}"><b>${a?esc(a.name[0]):'+'}</b><span>${a?esc(a.name):'Open seat'}</span><small>${a?'✓ Human-backed':'Waiting'}</small></div>`;}).join('')}</div><div class="card-stats"><span>${s.registered}/4 joined</span><b>${money(s.customerBudget)} customer wallet</b></div><a class="button ${s.status==='open'?'outline':''}" href="/play?season=${s.id}">${s.status==='open'?'Visit the lobby':'Watch in 3D'} ↗</a></article>`;}
async function poll(){
  try{
    const response=await fetch('/api/seasons',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Season service unavailable.');
    const live=data.seasons.filter(s=>s.status!=='finished').sort((a,b)=>(a.status==='open'?-1:1)-(b.status==='open'?-1:1)||a.id-b.id);
    $('#season-list').innerHTML=live.map(card).join('');$('#connection').textContent='● Connected to shared seasons';
    $('#network').textContent=`World AgentKit · ${data.verification.environment} · chain ${data.verification.chainId}`;
    const done=data.seasons.filter(s=>s.status==='finished');
    $('#results').innerHTML=done.length?done.map(s=>`<article class="result-row"><div><small>SEASON ${s.id} · ${s.day} DAYS</small><h3>${s.standings.filter(a=>a.rank===1).map(a=>esc(a.name)).join(' & ')} ${s.standings.filter(a=>a.rank===1).length>1?'share the crown':'takes the crown'}</h3></div><b>${money(s.standings[0].cash)}</b><a href="/play?season=${s.id}">Replay & results ↗</a></article>`).join(''):'<p class="empty">The first crown is still up for grabs. Finished seasons will appear here.</p>';
  }catch(error){$('#connection').textContent='Season connection unavailable';if(!$('#season-list').children.length)$('#season-list').innerHTML='<p class="empty">Shared seasons need the game server. Start it with <code>npm start</code>, or open the deployed game URL.</p>';}
  setTimeout(poll,5000);
}
poll();
