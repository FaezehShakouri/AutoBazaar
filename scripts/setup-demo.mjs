import {readFile,writeFile} from 'node:fs/promises';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
const filename='.demo-wallets.json';
let wallets;
try{wallets=JSON.parse(await readFile(filename,'utf8'));}
catch(error){
  if(error.code!=='ENOENT')throw error;
  wallets=[['Penny House','value'],['Nova House','premium'],['Sage House','adaptive']].map(([name,style])=>{const privateKey=generatePrivateKey();return {name,style,address:privateKeyToAccount(privateKey).address,privateKey};});
  await writeFile(filename,JSON.stringify(wallets,null,2)+'\n',{flag:'wx',mode:0o600});
}
if(wallets.length!==3||wallets.some(w=>privateKeyToAccount(w.privateKey).address.toLowerCase()!==w.address.toLowerCase()))throw Error('Invalid demo wallet file. Do not replace funded wallet keys.');
console.log('Three house wallets saved privately. Keep .demo-wallets.json to resume or withdraw.');
for(const w of wallets)console.log(`${w.name} (${w.style}): ${w.address}`);
console.log(`SEASON_MODE=demo\nDEMO_AGENT_ADDRESSES=${wallets.map(w=>w.address).join(',')}`);
console.log('Configure these public addresses on the host; fund each on Arc Testnet with at least 1 test USDC plus approval gas. Then run npm run demo:agents -- --server URL --season N --arc-contract ADDRESS.');
