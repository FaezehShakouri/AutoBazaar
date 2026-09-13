import {mkdir,copyFile,readFile,writeFile,readdir} from 'node:fs/promises';
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
const browserBuild=await build({entryPoints:['src/world-id.js'],outfile:'dist/world-id.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true});
const browserOutput=await readFile(new URL('dist/world-id.js',root),'utf8'),licenseFooter=browserOutput.lastIndexOf('\n/*! Bundled license information:');
if(licenseFooter>=0)await writeFile(new URL('dist/world-id.js',root),browserOutput.slice(0,licenseFooter)+browserOutput.slice(licenseFooter).replace(/[ \t]+$/gm,''));
const notices=[`World ID SDK and WebAssembly\n${await readFile(new URL('licenses/WORLD-ID-MIT.txt',root),'utf8')}`];
const packages=new Set(Object.keys(browserBuild.metafile.inputs).map(file=>/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file)?.[1]).filter(Boolean));
for(const name of [...packages].sort()){
  const dir=new URL(`node_modules/${name}/`,root),license=(await readdir(dir)).find(file=>/^licen[cs]e(?:\.(?:md|txt))?$/i.test(file));
  if(license)notices.push(`${name}\n${await readFile(new URL(license,dir),'utf8')}`);
}
await writeFile(new URL('dist/THIRD-PARTY-NOTICES.txt',root),notices.join('\n\n--------------------\n\n').trimEnd()+'\n');
await copyFile(new URL('node_modules/@worldcoin/idkit-core/dist/idkit_wasm_bg.wasm',root),new URL('dist/idkit_wasm_bg.wasm',root));
console.log('World ID Sandbox browser client bundled.');
await build({entryPoints:['scripts/remote-agent.mjs'],outfile:'dist/agent.mjs',bundle:true,format:'esm',platform:'node',target:'node24',packages:'external',legalComments:'eof'});
await copyFile(new URL('scripts/create-agent-wallet.mjs',root),new URL('dist/agent-wallet.mjs',root));
await copyFile(new URL('examples/steady-agent.mjs',root),new URL('dist/steady-agent.mjs',root));
console.log('Standalone contender runner and wallet helper prepared for download.');
await build({entryPoints:['scripts/agent-dashboard.mjs'],outfile:'dist/agent-dashboard.mjs',bundle:true,format:'esm',platform:'node',target:'node24',packages:'external',legalComments:'eof'});
console.log('Standalone owner dashboard prepared; serve beside its HTML, CSS and JS assets.');
