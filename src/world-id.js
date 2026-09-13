import {IDKit,proofOfHuman,selfieCheckLegacy} from '@worldcoin/idkit-core';
import QRCode from 'qrcode';
const $=s=>document.querySelector(s),status=$('#status'),button=$('#begin');
let pendingVerification=null;
const retry=document.createElement('button');retry.className='button outline';retry.textContent='Retry backend verification';retry.hidden=true;status.after(retry);
async function api(route,body){const response=await fetch(`/api/world-id/${route}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Verification request failed.');return data;}
const params=new URLSearchParams(location.search),address=params.get('address');if(/^0x[a-fA-F0-9]{40}$/.test(address||''))$('#agent-address').value=address;
try{
  const config=await api('config');
  button.disabled=!config.configured;button.textContent=config.configured?'Start Sandbox check →':'World ID setup pending';
  $('#check-description').textContent=config.credential==='selfie'?'Selfie Check Sandbox · No Orb needed. Complete a camera check on your phone.':'Proof of Human Sandbox · Requires an Orb-verified credential.';
  $('#identity-notice').textContent='Diagnostic only. This phone check cannot register an agent or grant a game seat. Use the AgentKit registration guide to join.';
  if(!config.configured)status.textContent='The host needs to finish World ID setup before this check is available.';
}catch(error){button.disabled=true;button.textContent='Diagnostic unavailable';status.textContent=error.message;}
$('#verify-form').onsubmit=async event=>{
  event.preventDefault();pendingVerification=null;retry.hidden=true;button.disabled=true;$('#handoff').hidden=true;status.textContent='1/3 · Creating a signed Sandbox request…';
  try{
    const session=await api('start',{address:$('#agent-address').value.trim()});
    const preset=session.credential==='selfie'?selfieCheckLegacy:proofOfHuman;
    const request=await IDKit.request(session.config).preset(preset({signal:session.signal}));
    await QRCode.toCanvas($('#qr'),request.connectorURI,{width:280,margin:2,errorCorrectionLevel:'M'});
    $('#phone-link').href=request.connectorURI;$('#handoff').hidden=false;status.textContent='2/3 · Waiting for your phone. This request expires in five minutes.';
    const completion=await request.pollUntilCompletion({pollInterval:2000,timeout:300000});
    if(!completion.success)throw Error(`World ID returned ${completion.error}. Start a fresh check to retry.`);
    $('#handoff').hidden=true;status.textContent='3/3 · Checking the proof with World…';
    pendingVerification={id:session.id,result:completion.result};
    await verifyPending();
  }catch(error){$('#handoff').hidden=true;status.textContent=error.message;}
  finally{button.disabled=false;button.textContent='Start another Sandbox check →';}
};
async function verifyPending(){
  retry.hidden=true;
  try{const result=await api('verify',pendingVerification);pendingVerification=null;status.textContent=`✓ ${result.message} Wallet: ${result.agentAddress}`;}
  catch(error){retry.hidden=false;throw error;}
}
retry.onclick=async()=>{if(!pendingVerification)return;retry.disabled=true;status.textContent='Retrying backend verification…';try{await verifyPending();}catch(error){status.textContent=error.message;}finally{retry.disabled=false;}};
addEventListener('pagehide',()=>{pendingVerification=null;});
