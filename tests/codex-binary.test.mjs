import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {resolveCodexBinary} from '../lib/codex-binary.mjs';

async function fixture(t){
  const home=await mkdtemp(join(tmpdir(),'codex-discovery-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const make=async(relative,mode=0o755)=>{const path=join(home,relative);await mkdir(dirname(path),{recursive:true});await writeFile(path,'#!/bin/sh\nexit 0\n');await chmod(path,mode);return path;};
  return {home,make,options:{binary:undefined,env:{PATH:''},home,platform:'darwin',arch:'arm64',nodePath:join(home,'node/bin/node')}};
}
test('finds editor-bundled Codex when server PATH is missing it',async t=>{
  const {make,options}=await fixture(t);
  const bundled=await make('.cursor/extensions/openai.chatgpt-99.1.0-darwin-arm64/bin/macos-aarch64/codex');
  assert.equal(await resolveCodexBinary(options),bundled);
});
test('PATH takes precedence over bundled fallback',async t=>{
  const {home,make,options}=await fixture(t);const path=await make('bin/codex');
  await make('.cursor/extensions/openai.chatgpt-99.1.0/bin/macos-aarch64/codex');
  assert.equal(await resolveCodexBinary({...options,env:{PATH:join(home,'bin')}}),path);
});
test('explicit paths resolve before child cwd changes; invalid overrides fail clearly',async t=>{
  const {home,make,options}=await fixture(t);const path=await make('custom/codex');
  assert.equal(await resolveCodexBinary({...options,binary:'./custom/codex',cwd:home}),path);
  await assert.rejects(resolveCodexBinary({...options,binary:join(home,'missing')}),/CODEX_BIN/);
});
test('skips non-executable bundles and chooses newest executable extension',async t=>{
  const {make,options}=await fixture(t);
  await make('.cursor/extensions/openai.chatgpt-101.0.0/bin/macos-aarch64/codex',0o644);
  const newest=await make('.cursor/extensions/openai.chatgpt-100.0.0/bin/macos-aarch64/codex');
  await make('.cursor/extensions/openai.chatgpt-99.0.0/bin/macos-aarch64/codex');
  assert.equal(await resolveCodexBinary(options),newest);
});
