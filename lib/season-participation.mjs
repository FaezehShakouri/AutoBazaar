import {isAddress} from 'viem';

// House seats are an explicit test/demo configuration, never an identity fallback.
export function seasonParticipation(env={}){
  const mode=env.SEASON_MODE||'competition';
  if(!['competition','demo'].includes(mode))throw Error('SEASON_MODE must be competition or demo.');
  const addresses=(env.DEMO_AGENT_ADDRESSES||'').split(',').map(a=>a.trim().toLowerCase()).filter(Boolean).sort();
  if(mode==='competition'){
    if(addresses.length)throw Error('House wallets require explicit SEASON_MODE=demo.');
    return {mode,verifiedSeats:4,houseSeats:0,houseAddresses:[]};
  }
  if(addresses.length!==3||new Set(addresses).size!==3||addresses.some(a=>!isAddress(a)||/^0x0{40}$/.test(a)))throw Error('Demo mode needs exactly three distinct public house wallet addresses.');
  return {mode,verifiedSeats:1,houseSeats:3,houseAddresses:addresses};
}
export const houseIdentity=address=>`autobazaar-demo-house:${address.toLowerCase()}`;
