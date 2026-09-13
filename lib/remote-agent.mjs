import {createAgentkitClient} from '@worldcoin/agentkit';
import {privateKeyToAccount} from 'viem/accounts';
import {createPublicClient,createWalletClient,http,erc20Abi} from 'viem';
import {ARC_CHAIN,ARC_USDC,dayPermit,dayTypedData,arcErrorMessage} from './arc.mjs';

export function createRemoteAgent({server,privateKey,account:providedAccount,chainId=480,arcContract,fetch:fetchImpl=globalThis.fetch}){
  const base=new URL(server);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('Use HTTPS for a remote season server.');
  if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('Server must be an origin, without credentials or a path.');
  const account=providedAccount||privateKeyToAccount(privateKey);
  const client=createAgentkitClient({fetch:fetchImpl,signer:{address:account.address,chainId:`eip155:${account.signatureChainId??chainId}`,type:account.signatureType||'eip191',signMessage:message=>account.signMessage({message})},onEvent:event=>{
    // The SDK otherwise returns the original 402 and hides local signing errors.
    if(event.type==='agentkit_skipped')throw Error(`Agent wallet could not sign: ${arcErrorMessage({message:event.reason})}`);
  }});
  async function request(path,body){
    const response=await client.fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
    let result;try{result=await response.json();}catch{throw Error(`Server returned HTTP ${response.status} without JSON. Use the shared game server URL.`);}
    if(!response.ok){const error=new Error(result.error||`HTTP ${response.status}`);error.status=response.status;throw error;}
    return result;
  }
  const arc=createPublicClient({chain:ARC_CHAIN,transport:http(ARC_CHAIN.rpcUrls.default.http[0])});
  const wallet=providedAccount?null:createWalletClient({chain:ARC_CHAIN,transport:http(ARC_CHAIN.rpcUrls.default.http[0]),account});
  function checkArc(metadata){
    if(!arcContract)throw Error('This season moves test USDC. Set --arc-contract to the reviewed escrow address before joining.');
    if(metadata.chainId!==5042002||metadata.token.toLowerCase()!==ARC_USDC.toLowerCase()||metadata.contract.toLowerCase()!==arcContract.toLowerCase())throw Error('The server Arc configuration differs from your pinned escrow.');
  }
  return {address:account.address,list:()=>request('/api/seasons'),
    join:async(season,profile)=>{
      const result=await request(`/api/seasons/${season}/join`,profile);
      if(!result.fundingRequired)return result;
      checkArc(result.arc);
      if(result.approval.amountMicros!=='1000000'||result.approval.spender.toLowerCase()!==arcContract.toLowerCase()||result.approval.token.toLowerCase()!==ARC_USDC.toLowerCase())throw Error('Unexpected entry approval amount or recipient.');
      const typed=result.typedData;
      if(typed.primaryType!=='Join'||typed.domain.name!=='AutoBazaar'||typed.domain.chainId!==5042002||typed.domain.verifyingContract.toLowerCase()!==arcContract.toLowerCase()||Number(typed.message.seasonId)!==Number(season)||typed.message.stake!==50000||typed.message.capital!==50000)throw Error('Unexpected Arc entry authorization.');
      const allowance=await arc.readContract({address:ARC_USDC,abi:erc20Abi,functionName:'allowance',args:[account.address,arcContract]});
      if(allowance!==1000000n){
        const hash=account.approve?await account.approve(arcContract,1000000n):await wallet.writeContract({address:ARC_USDC,abi:erc20Abi,functionName:'approve',args:[arcContract,1000000n]});
        const receipt=await arc.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('Arc USDC approval reverted.');
      }
      const signature=await account.signTypedData(typed);
      return request(`/api/seasons/${season}/join`,{...profile,funding:{deadline:typed.message.deadline,signature}});
    },
    dashboard:season=>request(`/api/seasons/${season}/dashboard`),
    houseAgents:(season,body={})=>request(`/api/seasons/${season}/house-agents`,body),
    observe:season=>request(`/api/seasons/${season}/observation`),
    submit:async(season,day,decision,observation)=>{
      let authorization;
      if(observation?.arc){checkArc(observation.arc);authorization=await account.signTypedData(dayTypedData(observation.arc,{seasonId:season,day,...dayPermit(observation,decision)}));}
      return request(`/api/seasons/${season}/decisions`,{day,decision,...(authorization?{authorization}:{})});
    },
    withdraw:season=>request(`/api/seasons/${season}/withdraw`,{}),
  };
}
