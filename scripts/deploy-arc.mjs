import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createPublicClient,createWalletClient,http,encodeDeployData,keccak256,parseUnits,formatUnits} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {ARC_CHAIN,ARC_USDC,stringify,arcErrorMessage} from '../lib/arc.mjs';
try {
const flags=process.argv.slice(2),smoke=flags.includes('--smoke'),sandbox=flags.includes('--sandbox');
if(flags.some(flag=>!['--smoke','--sandbox'].includes(flag))||(smoke&&sandbox))throw Error('Use at most one of --smoke or --sandbox.');
const deploymentName=smoke?'arc-testnet-smoke':sandbox?'arc-testnet-sandbox':'arc-testnet';
const wallets=JSON.parse(await readFile('.arc-wallets.json','utf8'));
const artifact=JSON.parse(await readFile('contracts/artifacts/AutoBazaar.json','utf8'));
const account=privateKeyToAccount(wallets.operator.privateKey),transport=http(process.env.ARC_RPC_URL||ARC_CHAIN.rpcUrls.default.http[0],{retryCount:3,retryDelay:750,timeout:15000});
const client=createPublicClient({chain:ARC_CHAIN,transport}),wallet=createWalletClient({chain:ARC_CHAIN,transport,account});
if(await client.getChainId()!==5042002)throw Error('Wrong network. Deployment is restricted to Arc Testnet.');
const args=[ARC_USDC,account.address,['express','wholesale','budget'].map(role=>wallets[role].address),wallets.treasury.address];
const data=encodeDeployData({...artifact,args}),codeHash=keccak256(data);
await mkdir('.runs',{recursive:true});
const journalFile=smoke?'.runs/arc-smoke-deployment.json':sandbox?'.runs/arc-sandbox-deployment.json':'.runs/arc-deployment.json';let journal;
try{journal=JSON.parse(await readFile(journalFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(journal&&journal.codeHash!==codeHash)throw Error('Deployment journal belongs to different code or payees. Review the existing deployment before deploying another escrow.');
if(!journal){
  const gas=(await client.estimateGas({account,data}))*120n/100n,fees=await client.estimateFeesPerGas();
  const maxFeePerGas=fees.maxFeePerGas<21000000000n?21000000000n:fees.maxFeePerGas;
  if(gas*maxFeePerGas>parseUnits('0.50',18))throw Error('Deployment estimate exceeds 0.50 test USDC gas.');
  console.log(stringify({network:'Arc Testnet',operator:account.address,token:ARC_USDC,suppliers:args[2],treasury:args[3],maximumGasUsdc:formatUnits(gas*maxFeePerGas,18),deploymentBytes:(data.length-2)/2}));
  const nonce=await client.getTransactionCount({address:account.address,blockTag:'pending'});
  const raw=await wallet.signTransaction({data,gas,nonce,type:'eip1559',maxFeePerGas,maxPriorityFeePerGas:1000000000n});
  journal={codeHash,raw,hash:keccak256(raw)};await writeFile(journalFile,stringify(journal)+'\n',{mode:0o600,flag:'wx'});
}
let receipt;try{receipt=await client.getTransactionReceipt({hash:journal.hash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}
if(!receipt){await client.sendRawTransaction({serializedTransaction:journal.raw});receipt=await client.waitForTransactionReceipt({hash:journal.hash,timeout:60000});}
if(receipt.status!=='success')throw Error(`Deployment reverted: ${journal.hash}`);
const record={network:'Arc Testnet',chainId:5042002,contract:receipt.contractAddress,token:ARC_USDC,operator:account.address,suppliers:args[2],treasury:args[3],transactionHash:journal.hash,blockNumber:receipt.blockNumber,gasUsdc:formatUnits(receipt.gasUsed*receipt.effectiveGasPrice,18),compiler:artifact.compiler,codeHash};
await mkdir('contracts/deployments',{recursive:true});await writeFile(`contracts/deployments/${deploymentName}.json`,stringify({...record,purpose:smoke?'Contract-only test fixtures; no World-verified seats':sandbox?'World ID Sandbox profiles; separate test season escrow':'Human-backed public seasons'})+'\n');
if(!smoke){let env=await readFile('.arc.env','utf8');env=env.replace(/^ARC_CONTRACT_ADDRESS=.*\n?/m,'');await writeFile('.arc.env',env+`ARC_CONTRACT_ADDRESS=${receipt.contractAddress}\n`,{mode:0o600});}
console.log(stringify(record));
} catch(error) { console.error(arcErrorMessage(error));process.exitCode=1; }
