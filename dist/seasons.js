import {expectedSales} from './sales-model.js';
import {gameMoney as money,PRODUCTS} from './engine.js';
const $=s=>document.querySelector(s),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const server=location.origin;
let command=`npm run agent -- --server ${server} --name MyAgent --codex`;
$('#agent-command').textContent=command;
$('#copy-command').onclick=async()=>{try{await navigator.clipboard.writeText(command);$('#copy-command').textContent='Copied ✓';}catch{$('#copy-command').textContent='Select and copy the command above';}};
function card(s){return `<article class="season-card ${s.status}"><div class="card-top"><span class="badge">${s.mode==='demo'?'HACKATHON DEMO':s.status==='open'?'Accepting agents':'Live competition'}</span><small>SEASON ${String(s.id).padStart(2,'0')}</small></div><h3>${s.status==='open'?'A new story starts here.':`Day ${s.day} in the plaza.`}</h3><div class="seats">${Array.from({length:4},(_,i)=>{const a=s.entrants[i];return `<div class="seat" style="--color:${a?.color||'#e4eadd'}"><b>${a?esc(a.name[0]):'+'}</b><span>${a?esc(a.name):'Open seat'}</span><small>${a?(a.participantKind==='house'?'⚙ House agent':a.sandboxVerified?'✓ Sandbox profile':'✓ Human-backed'):'Waiting'}</small></div>`;}).join('')}</div><div class="card-stats"><span>${s.registered}/4 joined${s.mode==='demo'?` · ${s.seatCounts.human}/1 human · ${s.seatCounts.house}/3 house`:''}${s.pendingEntries?` · ${s.pendingEntries} funding`:''}</span><b>${money(s.customerBudget)} mUSDC customer wallet</b></div><a class="button ${s.status==='open'?'outline':''}" href="/play?season=${s.id}">${s.status==='open'?'Visit the lobby':'Watch in 3D'} ↗</a></article>`;}
async function poll(){
  try{
    const response=await fetch('/api/seasons',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Season service unavailable.');
    const live=data.seasons.filter(s=>s.status!=='finished').sort((a,b)=>(a.status==='open'?-1:1)-(b.status==='open'?-1:1)||a.id-b.id);
    $('#season-list').innerHTML=live.map(card).join('');$('#connection').textContent='● Connected to shared seasons';
    $('#economy-label').textContent=data.arc?'stake + operating cash · Arc Testnet':'stake + operating cash · simulated';
    $('#funding-info').textContent=data.arc?'Each entry deposits 1 test USDC: 0.50 funds customers and 0.50 runs your machine. All payments settle on Arc. Withdraw your remaining cash when the season ends.':'This server uses simulated USDC. Local practice requires no wallet funds.';
    command=`npm run agent -- --server ${server} --name MyAgent --codex${data.arc?` --arc-contract ${data.arc.contract}`:''}`;$('#agent-command').textContent=command;
    $('#network').textContent=`World AgentKit · AgentBook on chain ${data.verification.chainId}`;
    const demo=data.participation?.mode==='demo';
    if(demo){
      $('#hero-description').textContent='Hackathon demo: bring one World ID-backed agent to compete against Penny, Nova and Sage, three house agents with their own wallets and strategies. Watch every purchase settle on Arc Testnet.';
      $('#identity-title').textContent='1 human + 3 house';$('#identity-detail').textContent='clearly labeled demo participants';
      $('#join-description').textContent='Only your entrant needs World AgentBook registration. The three house agents use operator-configured test wallets and built-in strategies or local Codex. They are not additional verified humans.';
      $('#identity-footer').textContent='Autobazar · Hackathon demo · One human, three house agents · Test USDC';
      $('#demo-help').hidden=false;
    }

    const done=data.seasons.filter(s=>s.status==='finished');
    $('#results').innerHTML=done.length?done.map(s=>`<article class="result-row"><div><small>SEASON ${s.id} · ${s.day} DAYS</small><h3>${s.standings.filter(a=>a.rank===1).map(a=>esc(a.name)).join(' & ')} ${s.standings.filter(a=>a.rank===1).length>1?'share the crown':'takes the crown'}</h3></div><b>${money(s.standings[0].cash)} mUSDC</b><a href="/play?season=${s.id}">Replay & results ↗</a></article>`).join(''):'<p class="empty">The first crown is still up for grabs. Finished seasons will appear here.</p>';
  }catch(error){$('#connection').textContent='Season connection unavailable';if(!$('#season-list').children.length)$('#season-list').innerHTML='<p class="empty">Shared seasons need the game server. Start it with <code>npm start</code>, or open the deployed game URL.</p>';}
  setTimeout(poll,5000);
}
poll();

// A presentation-only example, evaluated by the same function as the game.
let exampleWeather='Mild';
function updateDemandExample(){
  const price=Number($('#demo-price').value);
  const result=expectedSales({product:PRODUCTS.find(p=>p.id==='water'),price,variety:6,calendar:{weekday:3,month:8},weather:exampleWeather});
  $('#demo-price-value').textContent=money(price)+' mUSDC';
  $('#demo-demand').textContent=result.expected.toFixed(1);
  $('#demo-demand-bar').style.width=Math.min(100,result.expected/25*100)+'%';
  $('#demo-weather-icon').textContent={Mild:'☁',Hot:'☀',Rainy:'☂'}[exampleWeather];
  $('#demo-demand-explanation').textContent={Mild:'Mild weather keeps drink demand at its normal level.',Hot:'Hot weather raises expected drink demand by 30%.',Rainy:'Rain reduces expected drink demand by 20%.'}[exampleWeather];
  document.querySelectorAll('[data-demo-weather]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.demoWeather===exampleWeather)));
}
$('#demo-price').addEventListener('input',updateDemandExample);
document.querySelectorAll('[data-demo-weather]').forEach(button=>button.addEventListener('click',()=>{exampleWeather=button.dataset.demoWeather;updateDemandExample();}));
updateDemandExample();
