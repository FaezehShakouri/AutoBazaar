const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function seasonLobby(season){
  const sandbox=season?.identityEnvironment==='world-id-sandbox',demo=season?.mode==='demo';
  return `<section class="lobby glass interactive"><div class="overline">${demo?'HACKATHON DEMO · 1 HUMAN + 3 HOUSE':sandbox?'WORLD ID SANDBOX · TEST SEASON':'WORLD · HUMAN-BACKED AGENTS'}</div><h1>Season ${season?String(season.id).padStart(2,'0'):'…'}<br><em>Bring your contender.</em></h1><p>${demo?'Your World ID-backed agent versus three house agents.':sandbox?'Four Sandbox profiles. Four independent agents.':'Four humans. Four independent agents.'} The season starts when all four entries are confirmed.</p><p class="hint">Amounts in mUSDC · 1 USDC = 1,000 mUSDC</p><div class="entry-summary"><span><b>500 mUSDC</b>customer stake</span><i>+</i><span><b>500 mUSDC</b>starting cash</span><span><b>${season?.arc?'Arc Testnet':'Practice'}</b>${season?.arc?'confirmed deposits':'simulated funds'}</span></div>${demo&&season?.seatCounts?.human===1?`<p>${season.houseRequest?escape(season.houseRequest.message||({queued:'House agents requested. Waiting for the host runner.',starting:'House agents are joining. Waiting for Arc confirmations.',playing:'The house agents are connected.',failed:'House runner needs a retry from your dashboard.'}[season.houseRequest.status]||'House request received.')):'Your human seat is filled. Open your agent dashboard and select Add 3 house agents to start your rivals.'}</p>`:''}${Array.from({length:4},(_,i)=>{const a=season?.entrants[i];return `<div class="signup"><span class="avatar" style="--agent:${a?.color||'#dbe4d0'}">${a?escape(a.name[0]):'?'}</span><div><b>${a?escape(a.name):'Open seat'}</b><small>${a?(a.participantKind==='house'?'⚙ Demo house · ':sandbox?'✓ Sandbox profile · ':'✓ Human-backed · ')+escape(a.strategy):demo?(season?.seatCounts?.human===0?'Human entrant or house agent':'Waiting for a house agent'):'Waiting for a verified agent'}</small></div></div>`;}).join('')}<a class="primary season-link" href="/seasons#join">Connect your agent →</a><div class="lobby-foot">${season?.registered||0}/4 joined <span>${demo?'1 verified entrant + 3 house agents':sandbox?'One entry per Sandbox profile':'One entry per human'}</span></div></section>`;
}
export function seasonStatus(season){
  if(!season)return 'Connecting to the shared season…';
  if(season.testFixture)return 'Recorded Arc Testnet season · contract test identities · 857 onchain purchases';
  if(season.mode==='demo'&&season.status==='open')return `${season.registered}/4 demo participants · ${season.seatCounts.human}/1 human · ${season.seatCounts.house}/3 house${season.pendingEntries?` · ${season.pendingEntries} deposits confirming`:''}`;
  if(season.status==='open')return `${season.registered}/4 ${season.identityEnvironment==='world-id-sandbox'?'Sandbox':'human-backed'} agents joined${season.pendingEntries?` · ${season.pendingEntries} deposits confirming`:''}`;
  if(season.settlement)return season.settlement.status==='failed'?'Arc settlement paused · inspect the chain monitor':`Settling day ${season.decidingDay} on Arc · ${season.settlement.status}`;
  if(season.status==='finished')return `Season ${season.id} complete · results archived`;
  if(season.decidingDay){const seconds=Math.max(0,Math.ceil((season.deadline-Date.now())/1000));return `${season.mode==='demo'?'DEMO · ':''}Day ${season.decidingDay} decisions · ${season.submitted.length}/${season.entrants.filter(a=>a.active).length} ready · ${seconds}s left`;}
  return 'Market settled · the next decision window opens shortly';
}
export function watchSeason(id,onSnapshot,onError){
  let stopped=false,timer,controller;
  async function poll(){
    if(stopped)return;
    if(!document.hidden){
      controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
      try{const response=await fetch(`/api/seasons/${id}/snapshot`,{signal:controller.signal,cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Season unavailable.');if(data.state?.version!==4||data.season?.id!==Number(id))throw Error('Unsupported season response.');if(!stopped)onSnapshot(data);}catch(error){if(!stopped)onError(error.name==='AbortError'?'Connection timed out. Reconnecting…':error.message);}finally{clearTimeout(timeout);}
    }
    if(!stopped)timer=setTimeout(poll,3000);
  }
  poll();return ()=>{stopped=true;clearTimeout(timer);controller?.abort();};
}
