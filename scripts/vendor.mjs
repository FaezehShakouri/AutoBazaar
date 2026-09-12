import {mkdir,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
await mkdir(new URL('dist/vendor/',root),{recursive:true});
for(const [source,target] of [
  ['build/three.module.js','three.module.js'],
  ['build/three.core.js','three.core.js'],
  ['examples/jsm/controls/OrbitControls.js','OrbitControls.js'],
  ['LICENSE','THREE-LICENSE.txt'],
])await copyFile(new URL(`node_modules/three/${source}`,root),new URL(`dist/vendor/${target}`,root));
console.log('Three.js modules copied to dist/vendor for offline play.');
await build({entryPoints:['scripts/remote-agent.mjs'],outfile:'dist/agent.mjs',bundle:true,format:'esm',platform:'node',target:'node24',packages:'external',legalComments:'eof'});
await copyFile(new URL('scripts/create-agent-wallet.mjs',root),new URL('dist/agent-wallet.mjs',root));
await copyFile(new URL('examples/steady-agent.mjs',root),new URL('dist/steady-agent.mjs',root));
console.log('Standalone contender runner and wallet helper prepared for download.');
