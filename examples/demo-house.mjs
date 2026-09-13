import {demoHouseDecision} from '../lib/demo-policy.mjs';
export const decide=observation=>demoHouseDecision(observation,process.env.DEMO_STYLE||'value');
