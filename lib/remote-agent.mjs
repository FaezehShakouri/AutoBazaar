import {createAgentkitClient} from '@worldcoin/agentkit';
import {privateKeyToAccount} from 'viem/accounts';

export function createRemoteAgent({server,privateKey,chainId=480,fetch:fetchImpl=globalThis.fetch}){
  const base=new URL(server);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('Use HTTPS for a remote season server.');
  if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('Server must be an origin, without credentials or a path.');
  const account=privateKeyToAccount(privateKey);
  const client=createAgentkitClient({fetch:fetchImpl,signer:{address:account.address,chainId:`eip155:${chainId}`,type:'eip191',signMessage:message=>account.signMessage({message})}});
  async function request(path,body){
    const response=await client.fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
    let result;try{result=await response.json();}catch{throw Error(`Server returned HTTP ${response.status} without JSON. Use the shared game server URL.`);}
    if(!response.ok){const error=new Error(result.error||`HTTP ${response.status}`);error.status=response.status;throw error;}
    return result;
  }
  return {address:account.address,list:()=>request('/api/seasons'),join:(season,profile)=>request(`/api/seasons/${season}/join`,profile),observe:season=>request(`/api/seasons/${season}/observation`),submit:(season,day,decision)=>request(`/api/seasons/${season}/decisions`,{day,decision})};
}
