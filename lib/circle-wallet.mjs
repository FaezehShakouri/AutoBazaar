import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAddress} from 'viem';
import {ARC_USDC,stringify} from './arc.mjs';
const execute=promisify(execFile);

// Circle's authenticated CLI holds the wallet session. Models receive neither
// it nor an unrestricted payment tool. Only these bounded operations are exposed.
export function circleWallet(address,{binary=process.env.CIRCLE_BIN||'circle',run=execute}={}){
  if(!isAddress(address))throw Error('Invalid Circle wallet address.');
  async function call(args){
    let stdout;
    try{({stdout}=await run(binary,['wallet',...args,'--address',address,'--chain','ARC-TESTNET','--output','json'],{timeout:120000,maxBuffer:1048576}));}
    catch(error){
      if(/wallet isn't deployed on-chain yet/i.test(String(error.stderr||'')))throw Error('Circle wallet is not deployed on Arc Testnet yet. Activate it with a zero-allowance USDC approval before signing; see docs/arc-payments.md.');
      throw Error(`Circle wallet command failed. Check testnet login with circle wallet status. ${error.code==='ENOENT'?'Install @circle-fin/cli or set CIRCLE_BIN.':''}`);
    }
    const result=JSON.parse(stdout);if(result.error)throw Error(`Circle: ${result.error.message}`);return result.data;
  }
  async function signature(args){const result=await call(args);if(!/^0x[0-9a-f]+$/i.test(result.signature||''))throw Error('Circle returned no signature.');return result.signature;}
  return {address,signatureType:'eip1271',signatureChainId:5042002,
    signMessage:({message})=>signature(['sign','message',message]),
    signTypedData:typed=>{
      if(typed.domain.chainId!==5042002||typed.domain.name!=='AutoBazaar'||!['Join','Day'].includes(typed.primaryType))throw Error('Circle signing is restricted to AutoBazaar on Arc Testnet.');
      // Circle's EIP-712 endpoint expects the domain type explicitly.
      const data={...typed,types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...typed.types}};
      return signature(['sign','typed-data',stringify(data)]);
    },
    approve:async(spender,amount)=>{
      if(!isAddress(spender)||amount!==1000000n)throw Error('Only the exact 1 USDC season entry may be approved.');
      const result=await call(['execute','approve(address,uint256)',spender,String(amount),'--contract',ARC_USDC]);
      if(!/^0x[0-9a-f]{64}$/i.test(result.txHash||''))throw Error('Circle has not returned a transaction hash. Check the approval status before retrying.');
      return result.txHash;
    },
  };
}
