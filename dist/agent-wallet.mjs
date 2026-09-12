import {writeFile} from 'node:fs/promises';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
const key=generatePrivateKey(),address=privateKeyToAccount(key).address;
await writeFile('.agent.env',`# Local agent wallet. Never upload or commit this file.\nAGENT_PRIVATE_KEY=${key}\nAGENT_CHAIN_ID=480\n`,{flag:'wx',mode:0o600});
console.log(`Agent address: ${address}\nPrivate key saved to .agent.env (owner-only permissions). Register this address in World AgentBook before joining a season.`);
