import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runtimePaths} from '../src/runtime.mjs';
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
test('help is safe and independent of cwd and auth',()=>{
 const r=spawnSync(process.execPath,[cli,'--help'],{cwd:'/',encoding:'utf8',env:{PATH:process.env.PATH}});
 assert.equal(r.status,0);assert.match(r.stdout,/subscription OAuth/);assert.match(r.stdout,/--model/);
});
test('refine requires explicit model before preflight or any launch',()=>{
 const r=spawnSync(process.execPath,[cli,'refine','--source','missing.mmd','--out','missing'],{encoding:'utf8'});
 assert.equal(r.status,1);assert.match(r.stderr,/--model is required/);
});
test('local runtime closure resolves installed package files',()=>{
 for(const p of Object.values(runtimePaths()))assert.ok(fs.statSync(p).isFile(),p);
});
test('doctor exercises actual local Chromium without auth/model call',()=>{
 const r=spawnSync(process.execPath,[cli,'doctor'],{cwd:'/',encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PASS: local Pi SDK/);assert.match(r.stdout,/unverified/);assert.match(r.stdout,/Arial-compatible font metrics/);
});
test('installed local Pi RPC loads the extension with no model prompt',async()=>{
 const {spawn}=await import('node:child_process');
 const extension=fileURLToPath(new URL('../pi-extension.ts',import.meta.url));
 await new Promise((resolve,reject)=>{
  const child=spawn(runtimePaths().piBin,['--mode','rpc','--provider','openai-codex','--model','gpt-6.1-sol','--no-session','--no-skills','--no-context-files','--no-prompt-templates','--no-extensions','--extension',extension],{cwd:'/',env:process.env});
  let stdout='',stderr='';const timer=setTimeout(()=>finish(Error(`Pi RPC timeout: ${stderr}`)),20000);
  function finish(error){clearTimeout(timer);child.kill();error?reject(error):resolve()}
  child.stderr.on('data',c=>{stderr+=c});child.on('error',finish);child.on('exit',code=>{if(code!==null&&code!==0)finish(Error(`Pi RPC exited ${code}: ${stderr}`))});
  child.stdout.on('data',c=>{stdout+=c;for(const line of stdout.split('\n')){let event;try{event=JSON.parse(line)}catch{continue}if(event.id==='portable-state'){try{assert.equal(event.success,true);assert.equal(event.data.messageCount,0);assert.doesNotMatch(stderr,/Failed to load extension|SyntaxError|does not provide an export/);finish()}catch(e){finish(e)}return}}});
  child.stdin.write(JSON.stringify({id:'portable-state',type:'get_state'})+'\n');
 });
});
