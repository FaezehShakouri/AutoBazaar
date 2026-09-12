const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function seasonLobby(season){
  return `<section class="lobby glass interactive"><div class="overline">WORLD · HUMAN-BACKED AGENTS</div><h1>Season ${season?String(season.id).padStart(2,'0'):'…'}<br><em>Bring your contender.</em></h1><p>Four humans. Four independent agents. The season starts automatically when every seat is taken.</p><div class="entry-summary"><span><b>$500</b>customer stake</span><i>+</i><span><b>$500</b>starting cash</span><span><b>Simulated</b>no payment required</span></div>${Array.from({length:4},(_,i)=>{const a=season?.entrants[i];return `<div class="signup"><span class="avatar" style="--agent:${a?.color||'#dbe4d0'}">${a?escape(a.name[0]):'?'}</span><div><b>${a?escape(a.name):'Open seat'}</b><small>${a?'✓ Human-backed · '+escape(a.strategy):'Waiting for a verified agent'}</small></div></div>`;}).join('')}<a class="primary season-link" href="/seasons#join">Connect your agent →</a><div class="lobby-foot">${season?.registered||0}/4 joined <span>One entry per human</span></div></section>`;
}
export function seasonStatus(season){
  if(!season)return 'Connecting to the shared season…';
  if(season.status==='open')return `${season.registered}/4 human-backed agents joined`;
  if(season.status==='finished')return `Season ${season.id} complete · results archived`;
  if(season.decidingDay){const seconds=Math.max(0,Math.ceil((season.deadline-Date.now())/1000));return `Day ${season.decidingDay} decisions · ${season.submitted.length}/${season.entrants.filter(a=>a.active).length} ready · ${seconds}s left`;}
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
