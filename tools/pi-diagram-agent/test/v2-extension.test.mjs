import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {register} from 'node:module';
import {writeRunManifest,readRunManifest} from '../src/manifest.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const stub=name=>pathToFileURL(path.join(here,'stubs',name)).href;
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){
  if(s==='@earendil-works/pi-ai')return {url:${JSON.stringify(stub('pi-ai.mjs'))},shortCircuit:true};
  if(s==='@earendil-works/pi-coding-agent')return {url:${JSON.stringify(stub('pi-coding-agent.mjs'))},shortCircuit:true};
  return n(s,c)}`));
const ext=(await import('../pi-extension.ts')).default;

const hash=b=>createHash('sha256').update(b).digest('hex');
const SRC='flowchart LR\n  A[Start] --> B[Finish]\n';
const browserEnv=!!process.env.PI_DIAGRAM_MERMAID_BUNDLE&&!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
function fakePi(){
  const tools=new Map(),commands=new Map(),handlers=new Map(),sent=[],notes=[];
  const pi={registerTool:t=>tools.set(t.name,t),registerCommand:(n,c)=>commands.set(n,c),on:(e,h)=>handlers.set(e,h),setModel:async()=>true,setThinkingLevel(){},sendUserMessage:m=>sent.push(m)};
  const ctx={cwd:os.tmpdir(),model:undefined,modelRegistry:{getAvailable:()=>[{provider:'openai-codex',id:'gpt-5.6-sol',input:['image']}]},ui:{notify:(m,l)=>notes.push([m,l])}};
  return {pi,tools,commands,handlers,sent,notes,ctx};
}
const withEnv=async(env,fn)=>{const old={};for(const k of Object.keys(env)){old[k]=process.env[k];if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k]}
  try{return await fn()}finally{for(const k of Object.keys(old)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}}};
async function start(f){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-v2-ext-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,SRC);
  await f.commands.get('magic').handler(input,f.ctx);
  const runDir=/private work directory: (\S+)/.exec(f.notes.map(n=>n[0]).join('\n'))[1];
  const jobId=/job ID: ([0-9a-f-]{36})/.exec(f.sent.at(-1))[1];
  return {root,runDir,jobId,cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(runDir,{recursive:true,force:true})}};
}

test('v2 is the default: diagram_submit and /magic-accept are registered and the prompt carries the submission protocol',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined,PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined},async()=>{
    const f=fakePi();ext(f.pi);
    assert.ok(f.tools.has('diagram_submit'));assert.ok(f.tools.has('diagram_inspect'));assert.ok(f.commands.has('magic-accept'));
    assert.deepEqual(Object.keys(f.tools.get('diagram_submit').parameters.properties),['jobId']);
    const s=await start(f);
    try{assert.match(f.sent[0],/diagram_submit/);assert.match(f.sent[0],/at most 3 diagram_inspect/)}finally{s.cleanup()}
  });
});

test('PI_DIAGRAM_V2=0 restores the old single-session behaviour: no diagram_submit, unchanged prompt, no run manifest',async()=>{
  await withEnv({PI_DIAGRAM_V2:'0',PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined},async()=>{
    const f=fakePi();ext(f.pi);
    assert.equal(f.tools.has('diagram_submit'),false);assert.ok(f.tools.has('diagram_inspect'));assert.ok(f.commands.has('magic-accept'));
    const s=await start(f);
    try{
      assert.doesNotMatch(f.sent[0],/diagram_submit|Submission protocol/);
      await f.handlers.get('agent_end')?.({});
      assert.equal(fs.existsSync(path.join(s.runDir,'run.json')),false);
    }finally{s.cleanup()}
  });
});

test('diagram_submit rejects an unknown job',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined},async()=>{
    const f=fakePi();ext(f.pi);
    await assert.rejects(f.tools.get('diagram_submit').execute('c',{jobId:'nope'}),/UNKNOWN_DIAGRAM_JOB/);
  });
});

test('author token usage is tallied from assistant messages; agent_end without a submit finalises the run as CANDIDATE',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined,PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      await f.handlers.get('message_end')({message:{role:'assistant',usage:{input:5,output:2}}});
      await f.handlers.get('message_end')({message:{role:'assistant',usage:{input:7,output:3}}});
      await f.handlers.get('message_end')({message:{role:'user'}});
      await f.handlers.get('agent_end')({});
      const m=readRunManifest(s.runDir);
      assert.equal(m.status,'CANDIDATE');assert.match(m.statusReason,/AUTHOR_DID_NOT_SUBMIT/);
      assert.equal(m.tokens.author.input,12);assert.equal(m.tokens.author.output,5);
    }finally{s.cleanup()}
  });
});

test('/magic-accept validates a REVIEWED run for exactly its hash; refuses everything else and never throws into the UI',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined},async()=>{
    const f=fakePi();ext(f.pi);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-diagram-agent-')),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
    try{
      fs.writeFileSync(path.join(dir,'candidate.svg'),svg);
      writeRunManifest(dir,{schema:'pi-diagram-run/2',status:'REVIEWED',sourceHash:'s'.repeat(64),finalSvgSha256:hash(svg),acceptance:null});
      const cmd=f.commands.get('magic-accept');
      await cmd.handler(`${dir}`,f.ctx);assert.match(f.notes.at(-1)[0],/Usage/);
      await cmd.handler(`${dir} ${'0'.repeat(64)}`,f.ctx);assert.equal(f.notes.at(-1)[1],'warning');assert.match(f.notes.at(-1)[0],/HASH_MISMATCH/);
      assert.equal(readRunManifest(dir).status,'REVIEWED');
      await cmd.handler(`${dir} ${hash(svg)}`,f.ctx);assert.match(f.notes.at(-1)[0],/VALIDATED/);
      assert.equal(readRunManifest(dir).status,'VALIDATED');
      await cmd.handler(`${dir} ${hash(svg)}`,f.ctx);assert.match(f.notes.at(-1)[0],/RUN_NOT_REVIEWED/);
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
  });
});

test('/magic-accept: a run.json the author re-sealed as REVIEWED is rejected for a run this process orchestrated',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined,PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
      fs.writeFileSync(path.join(s.runDir,'candidate.svg'),svg);
      await f.handlers.get('message_end')({message:{role:'assistant',usage:{input:1,output:1}}});
      await f.handlers.get('agent_end')({});
      assert.equal(readRunManifest(s.runDir).status,'CANDIDATE');
      writeRunManifest(s.runDir,{schema:'pi-diagram-run/2',status:'REVIEWED',sourceHash:'x',finalSvgSha256:hash(svg),acceptance:null});
      await f.commands.get('magic-accept').handler(`${s.runDir} ${hash(svg)}`,f.ctx);
      assert.equal(f.notes.at(-1)[1],'warning');assert.match(f.notes.at(-1)[0],/MANIFEST_TAMPERED/);
    }finally{s.cleanup()}
  });
});

test('through the extension with real rendering: inspect carries early checks, submit returns structured audit findings and resets the inspection round',
  {skip:!browserEnv},async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined,PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      fs.writeFileSync(path.join(s.runDir,'candidate.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><defs><marker id="a" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker></defs><rect x="10" y="50" width="100" height="60"/></svg>');
      const ins=await f.tools.get('diagram_inspect').execute('c',{jobId:s.jobId});
      const body=JSON.parse(ins.content[0].text);
      assert.ok(body.earlyChecks.findings.some(x=>x.rule==='forbidden-construct'));
      assert.ok(body.earlyChecks.findings.some(x=>x.rule==='nodeIdentity'));
      const sub=await f.tools.get('diagram_submit').execute('c',{jobId:s.jobId});
      const r=JSON.parse(sub.content[0].text);
      assert.equal(r.status,'REVISE');assert.equal(r.round,1);
      assert.ok(r.findings.some(x=>x.rule==='forbidden-construct'));
      assert.ok(fs.existsSync(path.join(s.runDir,'run.json')));
      assert.equal(readRunManifest(s.runDir).status,'RUNNING');
    }finally{s.cleanup()}
  });
});
