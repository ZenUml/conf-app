import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {register} from 'node:module';
import {writeRunManifest,readRunManifest,writeManifests,readAuthoritativeManifest} from '../src/manifest.mjs';
import {writeJudgement} from '../src/judge-run.mjs';
import {buildJudgement} from '../src/judge.mjs';
const MDIR=fs.mkdtempSync(path.join(os.tmpdir(),'pi-manifests-test-'));
process.env.PI_DIAGRAM_MANIFEST_DIR=MDIR; // authoritative manifests: never the real ~ in tests
process.on('exit',()=>fs.rmSync(MDIR,{recursive:true,force:true}));

const here=path.dirname(fileURLToPath(import.meta.url));
const stub=name=>pathToFileURL(path.join(here,'stubs',name)).href;
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){
  if(s==='@earendil-works/pi-ai')return {url:${JSON.stringify(stub('pi-ai.mjs'))},shortCircuit:true};
  if(s==='@earendil-works/pi-coding-agent')return {url:${JSON.stringify(stub('pi-coding-agent.mjs'))},shortCircuit:true};
  return n(s,c)}`));
const ext=(await import('../pi-extension.ts')).default;

const hash=b=>createHash('sha256').update(b).digest('hex');
// /magic-accept now needs a fresh IMPROVED judgement (or --override-judge).
const judged=(dir,svg,over={})=>writeJudgement(dir,buildJudgement({candidateSha256:hash(svg),originalSha256:'o'.repeat(64),mode:'original',model:{provider:'openai-codex',id:'x',thinking:'medium'},passes:[],merged:{dims:{balance:{score:0.5,uncertain:false},grouping:null},mean:0.5},thresholds:{minDim:-0.2,minMean:0.2},verdict:'IMPROVED',verdictReason:'ok',...over}));
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
    assert.ok(f.tools.has('diagram_build_check'));assert.equal(f.tools.has('diagram_check'),false);
    assert.deepEqual(Object.keys(f.tools.get('diagram_build_check').parameters.properties),['jobId']);
    assert.deepEqual(Object.keys(f.tools.get('diagram_submit').parameters.properties),['jobId','svgHash']);
    const s=await start(f);
    try{
      assert.match(f.sent[0],/diagram_submit/);assert.match(f.sent[0],/at most 3 diagram_inspect/);
      // The normal loop is described: make.py -> diagram_build_check -> occasional inspect -> submit with the hash.
      assert.match(f.sent[0],/make\.py/);assert.match(f.sent[0],/diagram_build_check/);assert.match(f.sent[0],/at most 6 diagram_build_check/);assert.match(f.sent[0],/svgHash/);
    }finally{s.cleanup()}
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
      writeManifests(dir,{schema:'pi-diagram-run/2',status:'REVIEWED',sourceHash:'s'.repeat(64),finalSvgSha256:hash(svg),acceptance:null});
      const cmd=f.commands.get('magic-accept');
      await cmd.handler(`${dir}`,f.ctx);assert.match(f.notes.at(-1)[0],/Usage/);
      await cmd.handler(`${dir} ${'0'.repeat(64)}`,f.ctx);assert.equal(f.notes.at(-1)[1],'warning');assert.match(f.notes.at(-1)[0],/HASH_MISMATCH/);
      assert.equal(readRunManifest(dir).status,'REVIEWED');
      // No judgement yet: refused, and the run stays REVIEWED.
      await cmd.handler(`${dir} ${hash(svg)}`,f.ctx);assert.equal(f.notes.at(-1)[1],'warning');assert.match(f.notes.at(-1)[0],/JUDGEMENT_MISSING/);
      assert.equal(readRunManifest(dir).status,'REVIEWED');
      judged(dir,svg);
      // Pasted hashes are often upper-case and surrounded by spaces; the path may be quoted.
      await cmd.handler(`  "${dir}"   ${hash(svg).toUpperCase()} `,f.ctx);assert.match(f.notes.at(-1)[0],/VALIDATED/);
      assert.equal(readRunManifest(dir).status,'VALIDATED');assert.equal(readAuthoritativeManifest(dir).status,'VALIDATED');
      assert.match(f.notes.at(-1)[0],new RegExp(path.basename(dir)+'\\.json'));
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
      assert.equal(f.notes.at(-1)[1],'warning');assert.match(f.notes.at(-1)[0],/MANIFEST_DISAGREES/);
      // Forging the authoritative copy as well (same OS user) still fails against the live process's in-memory manifest.
      writeManifests(s.runDir,{schema:'pi-diagram-run/2',status:'REVIEWED',sourceHash:'x',finalSvgSha256:hash(svg),acceptance:null});
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
      // Binding two-phase gate: submit is refused until diagram_build_check has seen these bytes, and refused again while they FAIL.
      const refused=JSON.parse((await f.tools.get('diagram_submit').execute('c',{jobId:s.jobId})).content[0].text);
      assert.equal(refused.status,'REFUSED');assert.equal(refused.code,'UNCHECKED_BYTES');
      const chk=JSON.parse((await f.tools.get('diagram_build_check').execute('c',{jobId:s.jobId},undefined,undefined,{})).content[0].text);
      assert.equal(chk.status,'CHECK_FAIL');assert.equal(chk.source,'candidate.svg');assert.ok(chk.findings.some(x=>x.rule==='forbidden-construct'));
      assert.ok(chk.content===undefined&&!JSON.stringify(chk).includes('"type":"image"')); // text only
      const refused2=JSON.parse((await f.tools.get('diagram_submit').execute('c',{jobId:s.jobId,svgHash:chk.svgHash})).content[0].text);
      assert.equal(refused2.code,'FAILING_BYTES');
      assert.ok(fs.existsSync(path.join(s.runDir,'run.json')));
      const m=readRunManifest(s.runDir);
      assert.equal(m.status,'RUNNING');assert.equal(m.twoPhase.refusals.length,2);assert.equal(m.twoPhase.checksTotal,1);
    }finally{s.cleanup()}
  });
});

test('hung author: past the wall-clock budget the extension aborts the author turn and finalises the run as CANDIDATE WALL_CLOCK',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined,PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined,PI_DIAGRAM_MAX_WALL_MIN:'0.0005'},async()=>{
    // Watchdog timer: no further author event is needed (a stuck stream emits none).
    const f=fakePi();let aborted=0;f.ctx.abort=()=>{aborted++};ext(f.pi);const s=await start(f);
    try{
      await new Promise(r=>setTimeout(r,200));
      assert.ok(aborted>=1,'author turn aborted by the watchdog');
      const m=readRunManifest(s.runDir);assert.equal(m.status,'CANDIDATE');assert.match(m.statusReason,/WALL_CLOCK/);
    }finally{s.cleanup()}
    // message_end path: an author still streaming messages past the budget is aborted at the next message.
    const g=fakePi();ext(g.pi);const s2=await start(g);
    try{
      await new Promise(r=>setTimeout(r,60));
      let aborted2=0;
      await g.handlers.get('message_end')({message:{role:'assistant',usage:{input:1,output:1}}},{abort:()=>{aborted2++}});
      assert.ok(aborted2===1||readRunManifest(s2.runDir).status==='CANDIDATE');
      assert.match(readRunManifest(s2.runDir).statusReason??'',/WALL_CLOCK/);
    }finally{s2.cleanup()}
  });
});

test('diagram_build_check runs make.py through ctx.executeTool(bash) and reports a generator failure as text; the call is counted in run.json',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined,PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined,PI_DIAGRAM_TWO_PHASE:undefined},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      fs.writeFileSync(path.join(s.runDir,'make.py'),'raise SystemExit(1)\n');
      const seen=[];
      const ctx={executeTool:async(name,args)=>{seen.push({name,args});return {isError:true,result:{content:[{type:'text',text:'Traceback (most recent call last):\nValueError: no route for A->B'}]}}}};
      const res=await f.tools.get('diagram_build_check').execute('c',{jobId:s.jobId},undefined,undefined,ctx);
      const body=JSON.parse(res.content[0].text);
      assert.equal(seen.length,1);assert.equal(seen[0].name,'bash');assert.equal(seen[0].args.timeout,60);assert.match(seen[0].args.command,/python3 make\.py/);
      assert.equal(body.status,'GENERATOR_ERROR');assert.match(body.message,/no route for A->B/);assert.deepEqual(res.content.map(c=>c.type),['text']);
      assert.equal(readRunManifest(s.runDir).twoPhase.generatorErrors,1);
      // A runtime without ctx.executeTool is a genuine failure of the tool, not a silent skip.
      await assert.rejects(f.tools.get('diagram_build_check').execute('c',{jobId:s.jobId},undefined,undefined,{}),/GENERATOR_EXECUTION_UNAVAILABLE/);
      await assert.rejects(f.tools.get('diagram_build_check').execute('c',{jobId:'nope'},undefined,undefined,ctx),/UNKNOWN_DIAGRAM_JOB/);
    }finally{s.cleanup()}
  });
});

test('PI_DIAGRAM_TWO_PHASE=0: no diagram_build_check tool, the old single-phase submit protocol in the prompt',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined,PI_DIAGRAM_TWO_PHASE:'0',PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined},async()=>{
    const f=fakePi();ext(f.pi);
    assert.equal(f.tools.has('diagram_build_check'),false);assert.ok(f.tools.has('diagram_submit'));
    const s=await start(f);
    try{assert.doesNotMatch(f.sent[0],/diagram_build_check/);assert.match(f.sent[0],/diagram_submit/)}finally{s.cleanup()}
  });
});

test('assistant messages are counted as author model calls (message_end), with or without usage',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined,PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined,PI_DIAGRAM_TWO_PHASE:undefined},async()=>{
    const f=fakePi();ext(f.pi);const s=await start(f);
    try{
      await f.handlers.get('message_end')({message:{role:'assistant',usage:{input:5,output:2}}});
      await f.handlers.get('message_end')({message:{role:'assistant'}});
      await f.handlers.get('message_end')({message:{role:'user'}});
      await f.handlers.get('agent_end')({});
      const m=readRunManifest(s.runDir);
      assert.deepEqual(m.modelCalls,{author:2,reviewer:0});
    }finally{s.cleanup()}
  });
});

test('/magic-accept --waive: a REVIEWED_WITH_EXCEPTIONS run is validated only when the command names every waived check',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined},async()=>{
    const f=fakePi();ext(f.pi);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-diagram-agent-')),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
    try{
      fs.writeFileSync(path.join(dir,'candidate.svg'),svg);
      writeManifests(dir,{schema:'pi-diagram-run/3',status:'REVIEWED_WITH_EXCEPTIONS',sourceHash:'s'.repeat(64),finalSvgSha256:hash(svg),exceptions:[{check:'routeCrossings',findingId:'F-1',elements:['A->B'],measured:'1',reason:'must cross'},{check:'routePairClearance',findingId:'F-2',elements:['C->D'],measured:'6',reason:'narrow gutter'}],acceptance:null});
      const cmd=f.commands.get('magic-accept');
      await cmd.handler(`${dir} ${hash(svg)}`,f.ctx);assert.equal(f.notes.at(-1)[1],'warning');assert.match(f.notes.at(-1)[0],/WAIVERS_NOT_NAMED.*--waive routeCrossings,routePairClearance/);
      await cmd.handler(`${dir} ${hash(svg)} --waive routeCrossings`,f.ctx);assert.match(f.notes.at(-1)[0],/WAIVERS_NOT_NAMED/);
      await cmd.handler(`${dir} ${hash(svg)} --waive`,f.ctx);assert.match(f.notes.at(-1)[0],/Usage/);
      assert.equal(readRunManifest(dir).status,'REVIEWED_WITH_EXCEPTIONS');
      judged(dir,svg);
      await cmd.handler(`${dir} ${hash(svg)} --waive routePairClearance,routeCrossings`,f.ctx);
      assert.match(f.notes.at(-1)[0],/VALIDATED/);assert.match(f.notes.at(-1)[0],/waived routeCrossings, routePairClearance/);
      const m=readRunManifest(dir);assert.equal(m.status,'VALIDATED');assert.equal(m.acceptance.acceptedFrom,'REVIEWED_WITH_EXCEPTIONS');
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
  });
});

test('/magic-accept --override-judge "<reason>": accepts a NOT_IMPROVED run and records the reason; --waive still works with it; bad usage is refused',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined},async()=>{
    const f=fakePi();ext(f.pi);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-diagram-agent-')),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
    try{
      fs.writeFileSync(path.join(dir,'candidate.svg'),svg);
      writeManifests(dir,{schema:'pi-diagram-run/2',status:'REVIEWED',sourceHash:'s'.repeat(64),finalSvgSha256:hash(svg),acceptance:null});
      judged(dir,svg,{verdict:'NOT_IMPROVED',verdictReason:'mean 0.05 < 0.2'});
      const cmd=f.commands.get('magic-accept');
      await cmd.handler(`${dir} ${hash(svg)}`,f.ctx);assert.match(f.notes.at(-1)[0],/JUDGEMENT_NOT_IMPROVED/);
      await cmd.handler(`${dir} ${hash(svg)} --override-judge`,f.ctx);assert.match(f.notes.at(-1)[0],/Usage/);
      await cmd.handler(`${dir} ${hash(svg)} --override-judge ""`,f.ctx);assert.match(f.notes.at(-1)[0],/OVERRIDE_REASON/);
      assert.equal(readRunManifest(dir).status,'REVIEWED');
      await cmd.handler(`${dir} ${hash(svg)} --override-judge "customer prefers this layout"`,f.ctx);
      assert.match(f.notes.at(-1)[0],/VALIDATED/);assert.match(f.notes.at(-1)[0],/customer prefers this layout/);
      const m=readRunManifest(dir);assert.equal(m.status,'VALIDATED');assert.equal(m.acceptance.judgeOverride.reason,'customer prefers this layout');
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
  });
});

test('/magic-judge is registered, validates its arguments, and refuses a run directory outside the temp area without throwing into the UI',async()=>{
  await withEnv({PI_DIAGRAM_V2:undefined},async()=>{
    const f=fakePi();ext(f.pi);
    const cmd=f.commands.get('magic-judge');assert.ok(cmd);
    await cmd.handler('',f.ctx);assert.match(f.notes.at(-1)[0],/Usage/);
    await cmd.handler('/x --vs-old',f.ctx);assert.match(f.notes.at(-1)[0],/Usage/);
    await cmd.handler('/etc',f.ctx);assert.equal(f.notes.at(-1)[1],'warning');assert.match(f.notes.at(-1)[0],/Not judged: UNSAFE_RUN_DIRECTORY/);
  });
});
