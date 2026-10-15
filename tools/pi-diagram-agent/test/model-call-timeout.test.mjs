// Per-call time limit for the author model: a single assistant turn that outlasts PI_DIAGRAM_MAX_CALL_S is aborted and retried once;
// a second consecutive timeout ends the run as CANDIDATE MODEL_CALL_TIMEOUT. Fake clock + fake Pi events; no model, no network.
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {register} from 'node:module';
import {readRunManifest} from '../src/manifest.mjs';
import {createCallGuard,maxCallMsFromEnv,DEFAULT_MAX_CALL_S} from '../src/call-guard.mjs';
const MDIR=fs.mkdtempSync(path.join(os.tmpdir(),'pi-manifests-mct-'));
process.env.PI_DIAGRAM_MANIFEST_DIR=MDIR;
process.on('exit',()=>fs.rmSync(MDIR,{recursive:true,force:true}));
const here=path.dirname(fileURLToPath(import.meta.url));
const stub=name=>pathToFileURL(path.join(here,'stubs',name)).href;
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){
  if(s==='@earendil-works/pi-ai')return {url:${JSON.stringify(stub('pi-ai.mjs'))},shortCircuit:true};
  if(s==='@earendil-works/pi-coding-agent')return {url:${JSON.stringify(stub('pi-coding-agent.mjs'))},shortCircuit:true};
  return n(s,c)}`));
const ext=(await import('../pi-extension.ts')).default;

const SRC='flowchart LR\n  A[Start] --> B[Finish]\n';
function fakePi(){
  const tools=new Map(),commands=new Map(),handlers=new Map(),sent=[],notes=[];let aborted=0;
  const pi={registerTool:t=>tools.set(t.name,t),registerCommand:(n,c)=>commands.set(n,c),on:(e,h)=>handlers.set(e,h),setModel:async()=>true,setThinkingLevel(){},sendUserMessage:(m,o)=>sent.push([m,o])};
  const ctx={cwd:os.tmpdir(),model:undefined,modelRegistry:{getAvailable:()=>[{provider:'openai-codex',id:'gpt-5.6-sol',input:['image']}]},ui:{notify:(m,l)=>notes.push([m,l])},abort:()=>{aborted++}};
  return {pi,commands,handlers,sent,notes,ctx,aborts:()=>aborted};
}
const withEnv=async(env,fn)=>{const old={};for(const k of Object.keys(env)){old[k]=process.env[k];if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k]}
  try{return await fn()}finally{for(const k of Object.keys(old)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}}};
const BASE={PI_DIAGRAM_V2:undefined,PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined,PI_DIAGRAM_MAX_CALL_S:undefined,PI_DIAGRAM_MAX_WALL_MIN:undefined};
async function start(f){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-mct-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,SRC);
  await f.commands.get('magic').handler(input,f.ctx);
  const runDir=/private work directory: (\S+)/.exec(f.notes.map(n=>n[0]).join('\n'))[1];
  return {runDir,cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(runDir,{recursive:true,force:true})}};
}
const on=(f,name,ev)=>f.handlers.get(name)(ev,f.ctx);
const requestStart=f=>on(f,'before_provider_request',{type:'before_provider_request',payload:{}});
const abortedEnd=f=>on(f,'message_end',{message:{role:'assistant',stopReason:'aborted',usage:{input:0,output:0}}});
const okEnd=f=>on(f,'message_end',{message:{role:'assistant',stopReason:'toolUse',usage:{input:3,output:2}}});
const tick=ms=>mock.timers.tick(ms);

test('default limit is 480 s and PI_DIAGRAM_MAX_CALL_S overrides it; junk values fall back to the default',()=>{
  assert.equal(DEFAULT_MAX_CALL_S,480);
  assert.equal(maxCallMsFromEnv({}),480_000);
  assert.equal(maxCallMsFromEnv({PI_DIAGRAM_MAX_CALL_S:'90'}),90_000);
  for(const bad of ['0','-5','abc',''])assert.equal(maxCallMsFromEnv({PI_DIAGRAM_MAX_CALL_S:bad}),480_000,bad);
});

test('guard: fires once after the limit, ends cleanly, and counts consecutive timeouts',()=>{
  mock.timers.enable({apis:['setTimeout','Date']});
  try{
    const fired=[];const g=createCallGuard({limitMs:1000,onTimeout:i=>fired.push(i)});
    g.start();tick(999);assert.equal(fired.length,0);tick(1);assert.equal(fired.length,1);
    const t1=g.takeTimeout();assert.equal(t1.retry,true);assert.equal(t1.consecutive,1);assert.equal(g.takeTimeout(),null);
    g.start();tick(1000);const t2=g.takeTimeout();assert.equal(t2.retry,false);assert.equal(t2.consecutive,2);
    g.start();g.end('toolUse');tick(5000);assert.equal(fired.length,2,'a call that ended in time never fires');
    g.start();tick(1000);g.end('toolUse');assert.equal(g.takeTimeout(),null,'a call that completed after the timer fired is not a timeout');
    g.start();tick(1000);g.end('aborted');assert.equal(g.takeTimeout().consecutive,1,'a completed call resets the consecutive count');
  }finally{mock.timers.reset()}
});

test('a call over the limit is aborted and the author is re-prompted once, in the same session (no new session, no finalisation)',async()=>{
  await withEnv({...BASE,PI_DIAGRAM_MAX_CALL_S:'480'},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      mock.timers.enable({apis:['setTimeout','Date']});
      await requestStart(f);tick(479_000);assert.equal(f.aborts(),0);
      tick(1_000);assert.equal(f.aborts(),1,'ctx.abort() called when the limit passes');
      await abortedEnd(f);await on(f,'agent_end',{});
      assert.equal(f.sent.length,2,'initial prompt plus one retry prompt');
      assert.match(f.sent[1][0],/aborted/i);assert.match(f.sent[1][0],/job ID: [0-9a-f-]{36}/);assert.match(f.sent[1][0],/diagram_build_check|diagram_submit/);
      const m=readRunManifest(s.runDir);
      assert.equal(m.status,'RUNNING','the run continues');
      assert.equal(m.modelCallTimeouts.length,1);assert.equal(m.modelCallTimeouts[0].limitS,480);assert.equal(m.modelCallTimeouts[0].action,'retry');assert.ok(m.modelCallTimeouts[0].elapsedS>=480);
    }finally{mock.timers.reset();s.cleanup()}
  });
});

test('a second timeout of the retried call ends the run as CANDIDATE MODEL_CALL_TIMEOUT and records both',async()=>{
  await withEnv({...BASE,PI_DIAGRAM_MAX_CALL_S:'480'},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      mock.timers.enable({apis:['setTimeout','Date']});
      await requestStart(f);tick(480_000);await abortedEnd(f);await on(f,'agent_end',{});
      await requestStart(f);tick(480_000);assert.equal(f.aborts(),2);await abortedEnd(f);await on(f,'agent_end',{});
      assert.equal(f.sent.length,2,'no second retry prompt');
      const m=readRunManifest(s.runDir);
      assert.equal(m.status,'CANDIDATE');assert.match(m.statusReason,/^MODEL_CALL_TIMEOUT/);
      assert.deepEqual(m.modelCallTimeouts.map(t=>t.action),['retry','end']);
    }finally{mock.timers.reset();s.cleanup()}
  });
});

test('a normal-length call is unaffected: no abort, no retry, and the next call gets a fresh timer',async()=>{
  await withEnv({...BASE,PI_DIAGRAM_MAX_CALL_S:'480'},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      mock.timers.enable({apis:['setTimeout','Date']});
      await requestStart(f);tick(300_000);await okEnd(f);
      tick(600_000);// tool execution and reviewer time between calls is not model-call time
      assert.equal(f.aborts(),0);
      await requestStart(f);tick(300_000);await okEnd(f);
      await on(f,'agent_end',{});
      assert.equal(f.aborts(),0);assert.equal(f.sent.length,1);
      const m=readRunManifest(s.runDir);assert.equal(m.modelCallTimeouts?.length??0,0);
      assert.match(m.statusReason,/AUTHOR_DID_NOT_SUBMIT/,'agent_end keeps the existing finalisation');
    }finally{mock.timers.reset();s.cleanup()}
  });
});

test('PI_DIAGRAM_MAX_CALL_S shortens the limit',async()=>{
  await withEnv({...BASE,PI_DIAGRAM_MAX_CALL_S:'30'},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      mock.timers.enable({apis:['setTimeout','Date']});
      await requestStart(f);tick(29_000);assert.equal(f.aborts(),0);tick(1_000);assert.equal(f.aborts(),1);
      await abortedEnd(f);await on(f,'agent_end',{});
      assert.equal(readRunManifest(s.runDir).modelCallTimeouts[0].limitS,30);
    }finally{mock.timers.reset();s.cleanup()}
  });
});

test('a successful call between two timeouts resets the retry allowance',async()=>{
  await withEnv({...BASE,PI_DIAGRAM_MAX_CALL_S:'100'},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      mock.timers.enable({apis:['setTimeout','Date']});
      await requestStart(f);tick(100_000);await abortedEnd(f);await on(f,'agent_end',{});
      await requestStart(f);tick(10_000);await okEnd(f);
      await requestStart(f);tick(100_000);await abortedEnd(f);await on(f,'agent_end',{});
      assert.equal(f.sent.length,3,'second isolated timeout is retried too');
      assert.equal(readRunManifest(s.runDir).status,'RUNNING');
    }finally{mock.timers.reset();s.cleanup()}
  });
});
