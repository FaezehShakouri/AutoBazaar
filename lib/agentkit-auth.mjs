import {createHash} from 'node:crypto';
import {createPublicClient,http,verifyMessage,isAddress} from 'viem';
import {worldchain} from 'viem/chains';
import {AGENTKIT,createAgentBookVerifier,declareAgentkitExtension,agentkitResourceServerExtension,parseAgentkitHeader,validateAgentkitMessage,verifyAgentkitSignature,formatSIWEMessage} from '@worldcoin/agentkit';
import {SeasonError} from './season-store.mjs';

export const AGENTBOOK_ADDRESS='0xA23aB2712eA7BBa896930544C7d6636a96b944dA';
const bodyDigest=body=>createHash('sha256').update(body).digest('hex');
const reject=(status,message)=>{throw new SeasonError(status,message);};

export function agentBookConfig(env={}){
  const network=env.AGENTBOOK_ENVIRONMENT||'production';
  if(!['production','sandbox'].includes(network))throw Error('AGENTBOOK_ENVIRONMENT must be production or sandbox.');
  const chainId=Number(env.AGENTBOOK_CHAIN_ID||480),contractAddress=env.AGENTBOOK_ADDRESS||AGENTBOOK_ADDRESS,rpcUrl=env.WORLDCHAIN_RPC_URL||worldchain.rpcUrls.default.http[0];
  if(!Number.isSafeInteger(chainId)||chainId<1||!isAddress(contractAddress))throw Error('Invalid AgentBook chain or contract address.');
  if(network==='production'&&(chainId!==480||contractAddress.toLowerCase()!==AGENTBOOK_ADDRESS.toLowerCase()))throw Error('Production uses the canonical World Chain AgentBook. Custom deployments must use a separate sandbox environment.');
  if(network==='sandbox'&&(!env.WORLDCHAIN_RPC_URL||!env.AGENTBOOK_ADDRESS||!env.AGENTBOOK_CHAIN_ID))throw Error('Sandbox needs the RPC, AgentBook contract and chain ID supplied by World. Production registration is not a Sandbox proof.');
  const scope=`${network}:${chainId}:${contractAddress.toLowerCase()}`;
  return {network,chainId,contractAddress,rpcUrl,scope};
}

// The SDK currently maps RPC errors to an unregistered result. Preserve that
// distinction so an outage never silently becomes permission or a fake human.
export function makeAgentBook(config){
  const client=createPublicClient({chain:{...worldchain,id:config.chainId},transport:http(config.rpcUrl,{timeout:8000,retryCount:0})});
  return {async lookupHuman(address){
    let rpcFailed=false;
    const verifier=createAgentBookVerifier({contractAddress:config.contractAddress,client:{readContract:async args=>{try{return await client.readContract(args);}catch(error){rpcFailed=true;throw error;}}}});
    const human=await verifier.lookupHuman(address);
    if(rpcFailed)throw new SeasonError(503,'AgentBook is temporarily unavailable. Retry shortly.');
    return human;
  }};
}

export class AgentKitGate {
  constructor({store,book,config=agentBookConfig()}={}){this.store=store;this.config=config;this.book=book||makeAgentBook(config);}
  async challenge(url,method,rawBody){
    const options={domain:new URL(url).hostname,resourceUri:url,network:`eip155:${this.config.chainId}`,expirationSeconds:120,mode:{type:'free'},statement:`Vending Plaza: authorize ${method} ${new URL(url).pathname}. Request SHA-256: ${bodyDigest(rawBody)}. All game balances are simulated.`};
    const declaration=declareAgentkitExtension(options)[AGENTKIT];
    const extension=await agentkitResourceServerExtension.enrichPaymentRequiredResponse(declaration,{resourceInfo:{url},requirements:[]});
    this.store.saveChallenge(extension.info,method,bodyDigest(rawBody));
    return {x402Version:2,error:'Human-backed agent verification required. Register your agent wallet in AgentBook.',accepts:[],resource:{url},extensions:{[AGENTKIT]:extension},registration:{docs:'https://docs.world.org/agents/agent-kit/integrate',environment:this.config.network,chainId:this.config.chainId,contract:this.config.contractAddress}};
  }
  async authenticate(header,url,method,rawBody){
    let payload;try{payload=parseAgentkitHeader(header);}catch{reject(401,'Malformed AgentKit signature header.');}
    const c=this.store.challenge(payload.nonce);
    if(!c||c.consumed||c.expires<=Date.now())reject(401,'Unknown, expired or already used challenge. Retry without a signature to request a new one.');
    if(c.method!==method||c.body_hash!==bodyDigest(rawBody)||payload.uri!==url)reject(401,'Signature is bound to another request.');
    // SDK validation checks only the URI host. Also bind the exact method, body,
    // path, query, purpose and issued challenge before checking its signature.
    for(const [key,value] of Object.entries(c.info))if(JSON.stringify(payload[key])!==JSON.stringify(value))reject(401,'The signed challenge was changed.');
    if(payload.chainId!==`eip155:${this.config.chainId}`||!['eip191','eip1271'].includes(payload.type)||payload.signatureScheme&&!['eip191','eip1271'].includes(payload.signatureScheme))reject(401,'Unsupported agent signature network or type.');
    if(payload.notBefore||payload.requestId||!isAddress(payload.address))reject(401,'Invalid agent identity payload.');
    const valid=await validateAgentkitMessage(payload,url,{maxAge:120000});if(!valid.valid)reject(401,'The signed challenge is no longer valid.');
    let signatureValid=false;
    try{
      if(payload.type==='eip191')signatureValid=await verifyMessage({address:payload.address,message:formatSIWEMessage(payload,payload.address),signature:payload.signature});
      else signatureValid=(await verifyAgentkitSignature(payload,this.config.rpcUrl)).valid;
    }catch{}
    if(!signatureValid)reject(401,'The agent wallet signature is invalid.');
    const humanId=await this.book.lookupHuman(payload.address);
    if(!humanId)reject(403,'This wallet is not registered in AgentBook. Its human owner must complete World ID verification first.');
    // Atomic conditional update closes the concurrent replay race, including
    // across restarts. Authorization is re-resolved on every protected request.
    this.store.consumeChallenge(payload.nonce);
    return {address:payload.address.toLowerCase(),humanId};
  }
}
