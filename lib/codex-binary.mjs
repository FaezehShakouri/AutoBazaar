import {access,readdir,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter,dirname,isAbsolute,join,resolve} from 'node:path';

async function executable(path){
  try { await access(path,constants.X_OK); return (await stat(path)).isFile(); }
  catch { return false; }
}
async function entries(path){
  try { return (await readdir(path)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})); }
  catch { return []; }
}

// Resolve before changing the child's cwd. GUI/IDE-launched Node processes often
// have a smaller PATH than an interactive shell; no shell startup files are run.
export async function resolveCodexBinary({binary=process.env.CODEX_BIN,env=process.env,home=homedir(),platform=process.platform,arch=process.arch,nodePath=process.execPath,cwd=process.cwd()}={}){
  const name=platform==='win32'?'codex.exe':'codex';
  const pathCandidates=command=>(env.PATH||'').split(delimiter).filter(Boolean).map(p=>resolve(cwd,p,command));
  if(binary){
    const candidates=isAbsolute(binary)||/[\\/]/.test(binary)?[resolve(cwd,binary)]:pathCandidates(binary);
    for(const path of candidates)if(await executable(path))return path;
    throw new Error('CODEX_BIN does not point to an executable Codex binary. Set CODEX_BIN to its absolute path, then restart the server.');
  }
  const candidates=[...pathCandidates(name),join(dirname(nodePath),name),join(home,'.local','bin',name),join(home,'.npm-global','bin',name),'/opt/homebrew/bin/codex','/usr/local/bin/codex'];
  if(platform==='darwin')candidates.push('/Applications/Codex.app/Contents/Resources/codex',join(home,'Applications/Codex.app/Contents/Resources/codex'));
  const nvm=join(home,'.nvm','versions','node');
  for(const version of await entries(nvm))candidates.push(join(nvm,version,'bin',name));
  const target=platform==='darwin'?`macos-${arch==='arm64'?'aarch64':'x86_64'}`:platform==='win32'?`windows-${arch==='arm64'?'aarch64':'x86_64'}`:`linux-${arch==='arm64'?'aarch64':'x86_64'}`;
  for(const editor of ['.cursor','.vscode','.vscode-insiders']){
    const root=join(home,editor,'extensions');
    for(const extension of await entries(root))if(extension.startsWith('openai.chatgpt-'))candidates.push(join(root,extension,'bin',target,name));
  }
  for(const path of candidates)if(await executable(path))return path;
  throw new Error('Codex executable not found on PATH or in common local installations. Install Codex CLI, or set CODEX_BIN to an existing Codex executable, then restart the server.');
}
