import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createPublicClient,http,erc20Abi,isAddress} from 'viem';
import {ARC_CHAIN,ARC_USDC,arcErrorMessage} from '../lib/arc.mjs';
const {values}=parseArgs({options:{'source-circle':{type:'string'},season:{type:'string'}}});
if(values.season&&(!/^[1-9]\d*$/.test(values.season)||!Number.isSafeInteger(Number(values.season))))throw Error('--season must be a positive safe integer.');
if(!isAddress(values['source-circle']||''))throw Error('Provide --source-circle with your spare Circle Arc Testnet wallet. Funds exactly 1.10 test USDC per house wallet once.');
const client=createPublicClient({chain:ARC_CHAIN,transport:http(process.env.ARC_RPC_URL||ARC_CHAIN.rpcUrls.default.http[0],{timeout:10000,retryCount:2})});
const wallets=JSON.parse(await readFile('.demo-wallets.json','utf8'));
if(wallets.length!==3||new Set(wallets.map(w=>w.address.toLowerCase())).size!==3||wallets.some(w=>!isAddress(w.address)))throw Error('Expected three distinct house wallets.');
await mkdir('.runs',{recursive:true});const filename=values.season?`.runs/demo-house-funding-season-${values.season}.json`:'.runs/demo-house-funding.json';let journal={};
try{journal=JSON.parse(await readFile(filename,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const save=()=>writeFile(filename,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
const balance=address=>client.readContract({address:ARC_USDC,abi:erc20Abi,functionName:'balanceOf',args:[address]});
try{
  if(await client.getChainId()!==5042002)throw Error('Arc Testnet only.');
  for(const wallet of wallets){
    const address=wallet.address.toLowerCase(),prior=journal[address];
    if(prior?.confirmed){console.log(`${wallet.name}: already funded; ${prior.hash||'prior balance'}`);continue;}
    if(prior?.hash){
      const receipt=await client.waitForTransactionReceipt({hash:prior.hash,timeout:30000});if(receipt.status!=='success')throw Error('Prior house funding reverted. Inspect it before retrying.');
      journal[address]={...prior,confirmed:true};await save();console.log(`${wallet.name}: ${prior.hash}`);continue;
    }
    if(await balance(address)>=1100000n){journal[address]={confirmed:true,existingBalance:true};await save();console.log(`${wallet.name}: sufficient existing test funds.`);continue;}
    if(prior?.started)throw Error(`Prior funding for ${wallet.name} has an uncertain outcome. Inspect Circle transaction history before retrying; no second transfer was sent.`);
    if(await balance(values['source-circle'])<1200000n)throw Error('Circle source needs 1.10 test USDC plus gas per remaining house wallet.');
    journal[address]={started:Date.now(),source:values['source-circle'],amountMicros:'1100000'};await save();
    const {stdout}=await promisify(execFile)(process.env.CIRCLE_BIN||'circle',['wallet','execute','transfer(address,uint256)',wallet.address,'1100000','--contract',ARC_USDC,'--address',values['source-circle'],'--chain','ARC-TESTNET','--output','json'],{timeout:60000,maxBuffer:1048576});
    const result=JSON.parse(stdout);const hash=result.data?.txHash;
    if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('Circle did not return a transaction hash. Inspect its history before retrying.');
    journal[address].hash=hash;await save();
    const receipt=await client.waitForTransactionReceipt({hash,timeout:30000});if(receipt.status!=='success')throw Error('House funding reverted.');
    journal[address].confirmed=true;await save();console.log(`${wallet.name}: 1.10 test USDC funded · https://testnet.arcscan.app/tx/${hash}`);
  }
}catch(error){console.error(arcErrorMessage(error));process.exitCode=1;}
