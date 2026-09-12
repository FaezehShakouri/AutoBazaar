import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=['server.mjs','worker.mjs',...['lib','scripts','tests','examples','src','dist'].flatMap(dir=>readdirSync(dir).filter(file=>/\.(mjs|js)$/.test(file)).map(file=>`${dir}/${file}`))];
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
console.log(`Syntax checked ${files.length} JavaScript files.`);
