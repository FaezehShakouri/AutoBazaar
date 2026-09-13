import {arcTestnet} from 'viem/chains';
import {isAddress,keccak256,toHex,zeroHash} from 'viem';
import {ECONOMY,PRODUCTS,SUPPLIERS,quote,validateDecision} from '../dist/engine.js';

export const ARC_CHAIN={...arcTestnet,rpcUrls:{default:{http:['https://rpc.testnet.arc.io']}},blockExplorers:{default:{name:'ArcScan',url:'https://testnet.arcscan.app'}}};
export const ARC_USDC='0x3600000000000000000000000000000000000000';
export const stringify=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
// Provider URLs may contain API keys. Keep RPC details out of public jobs/logs.
export const arcErrorMessage=error=>String(error?.shortMessage||error?.message||'Arc unavailable').split('\n')[0].replace(/https?:\/\/\S+/gi,'[RPC]').slice(0,300);
export function arcConfig(env={}){
  if(!env.ARC_CONTRACT_ADDRESS){if(env.ARC_OPERATOR_PRIVATE_KEY)throw Error('ARC_CONTRACT_ADDRESS is required with an Arc operator key.');return null;}
  if(!isAddress(env.ARC_CONTRACT_ADDRESS)||!/^0x[0-9a-f]{64}$/i.test(env.ARC_OPERATOR_PRIVATE_KEY||''))throw Error('Arc needs a valid escrow address and private operator key.');
  const rpcUrl=env.ARC_RPC_URL||ARC_CHAIN.rpcUrls.default.http[0];
  if(new URL(rpcUrl).protocol!=='https:')throw Error('Arc RPC must use HTTPS.');
  return {chain:ARC_CHAIN,rpcUrl,contract:env.ARC_CONTRACT_ADDRESS,token:ARC_USDC,privateKey:env.ARC_OPERATOR_PRIVATE_KEY,maxGasUsdc:env.ARC_MAX_GAS_USDC||'0.50'};
}
export function arcMetadata(config){return {network:config.chain.id===5042002?'Arc Testnet':'Local contract test',chainId:config.chain.id,contract:config.contract,token:config.token,explorer:config.chain.blockExplorers?.default.url||'',economy:ECONOMY,entryUsdc:'1.00',customerStakeUsdc:'0.50',operatingCashUsdc:'0.50',settlement:'Daily atomic escrow settlement',customerWallet:'Per-season USDC escrow subaccount',gasPayer:'Server operator; wallet pays approval gas',trust:'The server computes NPC demand and inventory. The contract enforces signed prices, spending caps, fixed payees and balance conservation.'};}
const domain=config=>({name:'AutoBazaar',version:'1',chainId:config.chainId??config.chain.id,verifyingContract:config.contract});
export function joinTypedData(config,{seasonId,humanId,deadline}){return {domain:domain(config),primaryType:'Join',types:{Join:[{name:'seasonId',type:'uint256'},{name:'humanId',type:'bytes32'},{name:'stake',type:'uint64'},{name:'capital',type:'uint64'},{name:'deadline',type:'uint64'}]},message:{seasonId:Number(seasonId),humanId,stake:ECONOMY.stake,capital:ECONOMY.capital,deadline:Number(deadline)}};}
export function dayPermit(observation,decision){
  validateDecision(decision);
  const prices=PRODUCTS.map(p=>decision.prices[p.id]??observation.self.prices[p.id]);
  const financial={prices,load:PRODUCTS.map(p=>decision.load[p.id]??0),orders:decision.orders.map(o=>({product:o.product,supplier:o.supplier,quantity:o.quantity}))};
  const maxSupplySpend=decision.orders.reduce((sum,o)=>sum+quote(PRODUCTS.find(p=>p.id===o.product),SUPPLIERS.find(s=>s.id===o.supplier),o.quantity)*o.quantity,0);
  return {decisionHash:keccak256(toHex(JSON.stringify(financial))),maxSupplySpend,prices};
}
export function dayTypedData(config,{seasonId,day,...permit}){return {domain:domain(config),primaryType:'Day',types:{Day:[{name:'seasonId',type:'uint256'},{name:'day',type:'uint32'},{name:'decisionHash',type:'bytes32'},{name:'maxSupplySpend',type:'uint64'},{name:'prices',type:'uint32[6]'}]},message:{seasonId:Number(seasonId),day,...permit}};}
export const emptyPermit=()=>({decisionHash:zeroHash,maxSupplySpend:0,prices:[0,0,0,0,0,0],signature:'0x'});
export function settlementCall(id,state,permits){
  const slot=agent=>state.agents.findIndex(a=>a.id===agent);
  const orders=state.supplierPayments.map(o=>({slot:slot(o.agent),supplier:SUPPLIERS.findIndex(s=>s.id===o.supplier),product:PRODUCTS.findIndex(p=>p.id===o.product),quantity:o.quantity,amount:o.amount}));
  const sales=state.customerTransactions.map(s=>({slot:slot(s.agent),product:PRODUCTS.findIndex(p=>p.id===s.product),amount:s.payment}));
  // Public financial transcript only: private agent notebooks never go onchain.
  const commitment=keccak256(toHex(stringify({season:Number(id),day:state.day,permits:permits.map(({signature,...p})=>p),orders,sales,cash:state.agents.map(a=>a.cash),budget:state.customerBudgetRemaining})));
  return {functionName:'settleDay',args:[Number(id),state.day,permits,orders,sales,commitment,state.agents.map(a=>a.cash),state.customerBudgetRemaining],commitment};
}
