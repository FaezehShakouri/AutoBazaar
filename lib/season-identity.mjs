// Game identity always comes from World AgentBook, independently of settlement.
export function seasonIdentity(env,book){
  const mode=env.SEASON_IDENTITY_MODE||'agentbook';
  if(mode!=='agentbook')throw Error('Invalid SEASON_IDENTITY_MODE. Use agentbook; app-specific Sandbox enrollment has been retired.');
  return {mode,scope:book.scope,verification:{provider:'World AgentKit',mode,environment:book.network,chainId:book.chainId,contract:book.contractAddress,registrationUrl:'https://docs.world.org/agents/agent-kit/integrate#step-2-register-the-agent-in-agentbook',registrationCommand:'npx @worldcoin/agentkit-cli@0.2.0 register YOUR_AGENT_ADDRESS'}};
}
