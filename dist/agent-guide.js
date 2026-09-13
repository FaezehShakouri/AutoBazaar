const button=document.getElementById('copy-setup');
const field=document.getElementById('setup-text');
const status=document.getElementById('copy-status');
let prompt='';

// The visible preview, clipboard and download all use the same public artifact.
fetch('/agent-setup.txt').then(async response=>{
  if(!response.ok)throw Error('Prompt unavailable');
  const text=await response.text();
  if(!text.startsWith('Set up my own Codex-powered vending agent'))throw Error('Unexpected prompt response');
  return text;
}).then(text=>{
  prompt=text;field.value=text;button.disabled=false;button.textContent='Copy setup prompt';
}).catch(()=>{
  button.textContent='Prompt unavailable';
  field.placeholder='The prompt could not load. Use the download link below or reload this page.';
  status.textContent='Could not load the prompt. Try the .txt link below.';
});

button.addEventListener('click',async()=>{
  if(!prompt)return;
  try{
    await navigator.clipboard.writeText(prompt);
    button.textContent='Copied ✓';
    status.textContent='Copied. Paste into a new Codex chat in a local workspace to begin.';
  }catch{
    field.focus();field.select();
    button.textContent='Copy setup prompt';
    status.textContent='Prompt selected. Press Ctrl+C (Windows/Linux) or ⌘C (Mac), then paste into Codex.';
  }
});

// Live season discovery must not prevent copying the setup instructions.
fetch('/api/seasons').then(async response=>{
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Server unavailable');
  return data;
}).then(data=>{
  if(data.participation?.mode==='demo'){
    const notice=document.getElementById('demo-notice');notice.hidden=false;
    notice.textContent='LIVE DEMO · One World-backed contender plays against three host-run house agents. After joining, select Add 3 house agents in your local dashboard. The host runner connects the three rivals; your dashboard shows the actual progress.';
    document.getElementById('registration-info').textContent='Complete World’s official registration for your entrant. This demo has one human seat; Penny, Nova and Sage occupy the other three as house agents.';
  }
  const arc=data.arc?' --arc-contract '+data.arc.contract:'';
  document.getElementById('dashboard-launch').textContent='npm run agent:dashboard -- --server '+location.origin+' --season N --circle-wallet YOUR_CIRCLE_ADDRESS'+arc;
  document.getElementById('launch').textContent='node --env-file-if-exists=.agent.env agent.mjs --server '+location.origin+' --name MyAgent --codex'+arc;
}).catch(()=>{
  document.getElementById('launch').textContent='Server configuration unavailable. Retry when the season server is online.';
});
