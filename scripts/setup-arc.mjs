import {readFile,writeFile} from 'node:fs/promises';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
let wallets;
try{wallets=JSON.parse(await readFile('.arc-wallets.json','utf8'));}
catch(error){
  if(error.code!=='ENOENT')throw error;
  wallets=Object.fromEntries(['operator','treasury','express','wholesale','budget'].map(role=>{const privateKey=generatePrivateKey();return [role,{address:privateKeyToAccount(privateKey).address,privateKey}];}));
  await writeFile('.arc-wallets.json',JSON.stringify(wallets,null,2)+'\n',{flag:'wx',mode:0o600});
}
try{await writeFile('.arc.env',`ARC_OPERATOR_PRIVATE_KEY=${wallets.operator.privateKey}\nARC_MAX_GAS_USDC=0.50\n`,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
console.log('Arc Testnet wallets (private keys saved locally with mode 0600):');
for(const [role,wallet] of Object.entries(wallets))console.log(`${role}: ${wallet.address}`);
console.log('Fund the operator with test USDC, then run npm run arc:deploy. Circle agent wallets stay in Circle; these are server/payee wallets.');
