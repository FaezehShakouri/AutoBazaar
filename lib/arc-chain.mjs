import {createPublicClient,createWalletClient,http,encodeFunctionData,keccak256,parseUnits,formatUnits,decodeEventLog,hashMessage,parseAbi} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {ARC_ABI} from './arc-abi.mjs';
import {arcMetadata,stringify} from './arc.mjs';

// The durable store persists signed bytes before broadcast. A lost RPC response
// can only cause the same transaction to be rebroadcast, never a second payment.
export class ArcChain {
  constructor(config){
    this.config=config;this.metadata=arcMetadata(config);this.account=privateKeyToAccount(config.privateKey);
    // The public Arc endpoint occasionally throttles shared Cloudflare egress.
    // Retrying reads or the same signed transaction cannot duplicate a payment.
    const transport=http(config.rpcUrl,{timeout:6000,retryCount:3,retryDelay:750});
    this.client=createPublicClient({chain:config.chain,transport});
    this.wallet=createWalletClient({chain:config.chain,transport,account:this.account});
    this.gasLimit=parseUnits(config.maxGasUsdc||'0.50',18);
  }
  async ready(){
    if(this.checked)return;
    if(await this.client.getChainId()!==this.config.chain.id)throw Error('Arc RPC returned the wrong chain.');
    const values=[];for(const functionName of ['operator','usdc','UNIT_MICROS'])values.push(await this.client.readContract({address:this.config.contract,abi:ARC_ABI,functionName}));
    const [operator,token,units]=values;
    if(operator.toLowerCase()!==this.account.address.toLowerCase()||token.toLowerCase()!==this.config.token.toLowerCase()||units!==10n)throw Error('Escrow configuration does not match this operator and USDC economy.');
    this.checked=true;
  }
  async verify(address,typed,signature){await this.ready();return this.client.verifyTypedData({...typed,address,signature});}
  async verifyMessage({address,message,signature}){
    await this.ready();
    // Circle wallets are already deployed. Verify ERC-1271 directly against the
    // wallet on Arc, avoiding a generic deployless/counterfactual verifier.
    try{return await this.client.readContract({address,abi:parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']),functionName:'isValidSignature',args:[hashMessage(message),signature]})==='0x1626ba7e';}
    catch(error){
      if(error.walk?.(e=>e.name==='ContractFunctionRevertedError')?.name==='ContractFunctionRevertedError'||error.walk?.(e=>e.name==='ContractFunctionZeroDataError')?.name==='ContractFunctionZeroDataError')return false;
      throw error;
    }
  }
  async prepare(call){
    await this.ready();
    await this.client.simulateContract({address:this.config.contract,abi:ARC_ABI,account:this.account,...call});
    const data=encodeFunctionData({abi:ARC_ABI,...call});
    const estimate=await this.client.estimateGas({account:this.account,to:this.config.contract,data});
    const gas=estimate*120n/100n;
    const fees=await this.client.estimateFeesPerGas();
    const maxFeePerGas=fees.maxFeePerGas<21000000000n?21000000000n:fees.maxFeePerGas;
    if(gas*maxFeePerGas>this.gasLimit)throw Error('Estimated Arc gas exceeds the configured per-transaction USDC cap. Settlement paused.');
    const nonce=await this.client.getTransactionCount({address:this.account.address,blockTag:'pending'});
    const raw=await this.wallet.signTransaction({to:this.config.contract,data,gas,nonce,maxFeePerGas,maxPriorityFeePerGas:1000000000n,type:'eip1559'});
    return {raw,hash:keccak256(raw),nonce};
  }
  async receipt(hash){
    let receipt;try{receipt=await this.client.getTransactionReceipt({hash});}catch(error){if(error.name==='TransactionReceiptNotFoundError')return null;throw error;}
    const events=receipt.logs.filter(l=>l.address.toLowerCase()===this.config.contract.toLowerCase()).flatMap(log=>{try{return [{...decodeEventLog({abi:ARC_ABI,data:log.data,topics:log.topics}),logIndex:log.logIndex}];}catch{return [];}});
    return JSON.parse(stringify({hash,status:receipt.status,blockNumber:receipt.blockNumber,gasUsdc:formatUnits(receipt.gasUsed*receipt.effectiveGasPrice,18),events}));
  }
  async broadcast(raw){return this.client.sendRawTransaction({serializedTransaction:raw});}
  async snapshot(id){
    await this.ready();
    const args=[BigInt(id)],s=await this.client.readContract({address:this.config.contract,abi:ARC_ABI,functionName:'season',args});
    const machines=await Promise.all(Array.from({length:s[2]},(_,slot)=>this.client.readContract({address:this.config.contract,abi:ARC_ABI,functionName:'machine',args:[...args,slot]})));
    return JSON.parse(stringify({customerBudget:Number(s[0]),day:s[1],joined:s[2],closed:s[3],aborted:s[4],lastActivity:Number(s[5]),machines:machines.map(m=>({wallet:m.wallet,cash:Number(m.cash),claimed:m.claimed}))}));
  }
}
