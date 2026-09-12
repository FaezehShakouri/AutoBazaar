import {mkdir,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('dist/vendor/',root),{recursive:true});
for(const [source,target] of [
  ['build/three.module.js','three.module.js'],
  ['build/three.core.js','three.core.js'],
  ['examples/jsm/controls/OrbitControls.js','OrbitControls.js'],
  ['LICENSE','THREE-LICENSE.txt'],
])await copyFile(new URL(`node_modules/three/${source}`,root),new URL(`dist/vendor/${target}`,root));
console.log('Three.js modules copied to dist/vendor for offline play.');
