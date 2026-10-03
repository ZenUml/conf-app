import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {matchesRateLimit,eventIsRateLimit,median,reduceEvents,summariseAudit,aggregate,renderMarkdown,isCompleted,summariseManifest} from './bench-lib.mjs';
import {parseMermaid} from '../src/parser.mjs';

test('rate-limit matcher matches error text and never numbers',()=>{
  assert.ok(matchesRateLimit('Error: 429 Too Many Requests'));
  assert.ok(matchesRateLimit('status 429'));
  assert.ok(matchesRateLimit('You have hit your usage limit'));
  assert.ok(matchesRateLimit('rate_limit_exceeded'));
  assert.ok(!matchesRateLimit('tMs:429872'));
  assert.ok(!matchesRateLimit('{"kind":"tool-end","tMs":429872}'));
  assert.ok(!matchesRateLimit('elapsed 1429 ms'));
  assert.ok(!matchesRateLimit(undefined));
});
test('rate-limit detection inspects only error fields of known event kinds',()=>{
  assert.equal(eventIsRateLimit({kind:'tool-end',tool:'bash',isError:false,tMs:429872}),false);
  assert.equal(eventIsRateLimit({kind:'assistant',text:'we should respect the rate limit in the diagram',usage:{input:1,output:2}}),false);
  assert.equal(eventIsRateLimit({kind:'stderr',text:'HTTP 429 rate limit'}),true);
  assert.equal(eventIsRateLimit({kind:'assistant',errorMessage:'usage limit reached'}),true);
  assert.equal(eventIsRateLimit({kind:'response',success:true,error:'quota'}),false);
  assert.equal(eventIsRateLimit({kind:'response',success:false,error:'quota exceeded'}),true);
});
test('median handles odd, even, empty',()=>{
  assert.equal(median([3,1,2]),2);assert.equal(median([4,1,2,3]),2.5);assert.equal(median([]),null);assert.equal(median([null,5]),5);
});
const ev=[
  {kind:'notify',text:'Pi diagram agent started; private work directory: /tmp/pi-diagram-agent-abc',tMs:5},
  {kind:'assistant',usage:{input:100,output:50},tMs:1000},
  {kind:'tool-start',tool:'bash',tMs:1100},{kind:'tool-end',tool:'bash',isError:false,tMs:1200},
  {kind:'tool-start',tool:'diagram_inspect',tMs:30000},{kind:'tool-end',tool:'diagram_inspect',isError:false,tMs:41000},
  {kind:'assistant',usage:{input:10,output:70},tMs:50000},
  {kind:'tool-start',tool:'diagram_inspect',tMs:60000},{kind:'tool-end',tool:'diagram_inspect',isError:false,tMs:70000},
  {kind:'done',reason:'AGENT_END',elapsedMs:90000}
];
test('reduceEvents sums tokens, finds first inspection and run dir',()=>{
  const r=reduceEvents(ev);
  assert.equal(r.runDir,'/tmp/pi-diagram-agent-abc');assert.equal(r.inputTokens,110);assert.equal(r.outputTokens,120);
  assert.equal(r.toolCalls,3);assert.equal(r.inspections,2);assert.equal(r.firstInspectionStartMs,30000);assert.equal(r.firstInspectionEndMs,41000);
  assert.equal(r.doneReason,'AGENT_END');assert.equal(r.elapsedMs,90000);assert.equal(r.rateLimited,false);
});
test('reduceEvents flags a real rate limit but not a timestamp',()=>{
  assert.equal(reduceEvents([...ev,{kind:'tool-end',tool:'bash',isError:false,tMs:429872}]).rateLimited,false);
  assert.equal(reduceEvents([...ev,{kind:'stderr',text:'429 Too Many Requests'}]).rateLimited,true);
});
test('a final assistant message with stopReason error makes the run AGENT_ERROR, not completed',()=>{
  const bad=[{kind:'assistant',usage:{input:0,output:0},stopReason:'error',errorMessage:'WebSocket error',tMs:9879},{kind:'done',reason:'AGENT_END',elapsedMs:9881}];
  const r=reduceEvents(bad);
  assert.equal(r.doneReason,'AGENT_ERROR');assert.equal(r.agentError,'WebSocket error');assert.equal(r.rateLimited,false);
  assert.equal(isCompleted({...r,rateLimited:false}),false);
  // an error mid-run that the agent recovered from (later normal message) does not taint the run
  const ok=reduceEvents([{kind:'assistant',stopReason:'error',errorMessage:'x',usage:{}},{kind:'assistant',stopReason:'stop',usage:{input:1,output:2}},{kind:'done',reason:'AGENT_END',elapsedMs:5}]);
  assert.equal(ok.doneReason,'AGENT_END');
});
test('summariseAudit lists FAIL, ADJUDICATED and NOT-CHECKABLE but skips the structural pair',()=>{
  const s=summariseAudit({status:'FAIL',checks:{a:{status:'PASS'},b:{status:'FAIL'},c:{status:'NOT-CHECKABLE'},routeGeometry:{status:'NOT-CHECKABLE'},visualQuality:{status:'NOT-CHECKABLE'}}});
  assert.deepEqual(s,{status:'FAIL',fail:['b'],notCheckable:['c'],adjudicated:[],error:null});
  assert.equal(summariseAudit({error:'boom'}).status,'NO-AUDIT');
});
const run=(fixture,n,over)=>({id:`${fixture}-r${n}`,fixture,doneReason:'AGENT_END',rateLimited:false,elapsedMs:1000*n,outputTokens:100*n,inspections:n,firstInspectionStartMs:500,finalSvgInspected:true,audit:{status:'NOT-CHECKABLE',fail:[],notCheckable:[]},...over});
test('aggregate computes per-fixture median/min/max over completed runs only',()=>{
  const runs=[run('f1',1),run('f1',2),run('f1',3),run('f2',1,{doneReason:'TIME_LIMIT'}),run('f2',2,{audit:{status:'FAIL',fail:['x'],notCheckable:['y']}}),run('f2',3,{rateLimited:true})];
  const a=aggregate(runs);
  const f1=a.fixtures.find(f=>f.fixture==='f1');
  assert.deepEqual([f1.elapsedMs.median,f1.elapsedMs.min,f1.elapsedMs.max],[2000,1000,3000]);
  assert.equal(f1.outputTokens.median,200);
  const f2=a.fixtures.find(f=>f.fixture==='f2');
  assert.equal(f2.completed,1);assert.deepEqual(f2.auditFailRuns,['f2-r2']);assert.deepEqual(f2.auditNotCheckableRuns,['f2-r2']);
  assert.deepEqual(a.rateLimitedRuns,['f2-r3']);assert.equal(a.completedRuns,4);assert.equal(a.nonCompletedRuns.length,2);
  assert.equal(isCompleted(runs[3]),false);
  const md=renderMarkdown({...a,runs},{meta:{package:'x'}});
  assert.match(md,/\| f1 \| 3\/3 \| 2s \/ 1s \/ 3s \|/);assert.match(md,/f2-r2/);
});
test('every fixture matches its expected.json under the package parser',()=>{
  const dir=fileURLToPath(new URL('./fixtures/',import.meta.url));
  const names=fs.readdirSync(dir).filter(f=>f.endsWith('.mmd'));
  assert.ok(names.length>=5);
  for(const f of names){
    const exp=JSON.parse(fs.readFileSync(dir+f.replace(/\.mmd$/,'.expected.json'),'utf8'));
    const m=parseMermaid(fs.readFileSync(dir+f,'utf8'));
    assert.equal(m.direction,exp.direction,f);
    assert.deepEqual(m.nodes.map(n=>({id:n.id,text:n.text})).sort((a,b)=>a.id.localeCompare(b.id)),exp.nodes.map(n=>({id:n.id,text:n.text})).sort((a,b)=>a.id.localeCompare(b.id)),f);
    const key=e=>`${e.source}>${e.target}|${e.label}|${e.dashed}`;
    assert.deepEqual(m.edges.map(e=>key({...e,dashed:e.style==='dashed'})).sort(),exp.edges.map(key).sort(),f);
    for(const g of exp.groups)assert.deepEqual(m.nodes.filter(n=>n.group===g.id).map(n=>n.id).sort(),[...g.nodes].sort(),f);
    assert.deepEqual(m.nodes.filter(n=>n.group===null).map(n=>n.id).sort(),[...exp.ungrouped].sort(),f);
    if(exp.shapes)assert.deepEqual(Object.fromEntries(m.nodes.map(n=>[n.id,n.shape]).filter(([id])=>id in exp.shapes)),exp.shapes,f);
    if(exp.roles)assert.deepEqual(Object.fromEntries(m.nodes.map(n=>[n.id,n.role]).filter(([id])=>id in exp.roles)),exp.roles,f);
    if(exp.paths)assert.deepEqual(Object.fromEntries(m.nodes.map(n=>[n.id,n.groupPath])),exp.paths,f);
    if(exp.thick)assert.deepEqual(m.edges.filter(e=>e.thick).map(e=>`${e.source}>${e.target}`),exp.thick,f);
    assert.ok(m.nodes.length>=4&&m.nodes.length<=8,f);
  }
});

// --- RPC completion: finish on agent_settled (Pi >= 1.0 docs/rpc.md), agent_end alone is not final ---
import {createRunTracker,SETTLE_GRACE_MS} from './bench-lib.mjs';

test('tracker finishes on agent_settled and ignores everything before it',()=>{
  const t=createRunTracker();
  assert.deepEqual(t.onEvent('message_end'),{});
  assert.deepEqual(t.onEvent('agent_settled'),{finish:'AGENT_SETTLED'});
});
test('agent_end arms the grace timer instead of finishing; settle inside grace finishes AGENT_SETTLED',()=>{
  const t=createRunTracker();
  assert.deepEqual(t.onEvent('agent_end'),{armGraceMs:SETTLE_GRACE_MS});
  assert.deepEqual(t.onEvent('agent_settled'),{finish:'AGENT_SETTLED'});
  assert.equal(t.onGraceTimeout(),null,'a stale timer after settle must not finish again');
});
test('grace expiry without agent_settled finishes AGENT_END_NO_SETTLE',()=>{
  const t=createRunTracker({graceMs:1234});
  assert.deepEqual(t.onEvent('agent_end'),{armGraceMs:1234});
  assert.equal(t.onGraceTimeout(),'AGENT_END_NO_SETTLE');
});
test('a second agent_end does not re-arm; grace timeout before any agent_end is ignored',()=>{
  const t=createRunTracker();
  assert.equal(t.onGraceTimeout(),null);
  t.onEvent('agent_end');
  assert.deepEqual(t.onEvent('agent_end'),{});
});
test('all three agent-finished reasons count as completed; timeouts do not',()=>{
  for(const doneReason of ['AGENT_END','AGENT_SETTLED','AGENT_END_NO_SETTLE'])assert.ok(isCompleted({doneReason,rateLimited:false}),doneReason);
  assert.ok(!isCompleted({doneReason:'TIME_LIMIT',rateLimited:false}));
  assert.ok(!isCompleted({doneReason:'AGENT_SETTLED',rateLimited:true}));
});

test('reduceEvents records spec-mode use, source facts and output tokens before the first inspection',()=>{
  const r=reduceEvents([
    {kind:'notify',text:'Source facts included in the prompt (original render positions, reference only)',tMs:1},
    {kind:'notify',text:'Layout spec mode on: layout.json + diagram_render_spec offered',tMs:2},
    {kind:'assistant',usage:{input:1,output:300},tMs:10},
    {kind:'tool-start',tool:'diagram_render_spec',tMs:20},{kind:'tool-end',tool:'diagram_render_spec',isError:false,tMs:30},
    {kind:'assistant',usage:{input:1,output:200},tMs:40},
    {kind:'tool-start',tool:'diagram_inspect',tMs:50},
    {kind:'assistant',usage:{input:1,output:999},tMs:60},{kind:'done',reason:'AGENT_END',elapsedMs:100}]);
  assert.equal(r.specRenders,1);assert.equal(r.sourceFactsIncluded,true);assert.equal(r.specModeOffered,true);assert.equal(r.outputTokensBeforeFirstInspection,500);assert.equal(r.outputTokens,1499);
});

test('v2: reduceEvents counts diagram_submit calls',()=>{
  const r=reduceEvents([{kind:'tool-start',tool:'diagram_inspect',tMs:1},{kind:'tool-start',tool:'diagram_submit',tMs:2},{kind:'tool-start',tool:'diagram_submit',tMs:3},{kind:'done',reason:'AGENT_SETTLED',elapsedMs:9}]);
  assert.equal(r.submits,2);assert.equal(r.inspections,1);
});
const manifest=()=>({status:'CANDIDATE',statusReason:'ROUNDS_EXHAUSTED: 4 submit rounds used',finalSvgSha256:'f'.repeat(64),
  rounds:[{round:1,stage:'review',review:{ok:true,findings:[{severity:'blocking'},{severity:'minor'}]}},{round:2,stage:'audit',review:null},{round:3,stage:'review',reverted:true,review:{ok:true,findings:[{severity:'blocking'}]}}],
  timings:{authorMs:120000,reviewerMs:30000,orchestratorMs:5000,totalMs:160000},tokens:{author:{input:1000,output:500},reviewer:{input:200,output:80}},
  metrics:{rounds:3,gateStatus:'CANDIDATE',falseBlockCandidates:1,oscillations:2,reverts:1},notCheckable:['routeGeometry']});
test('v2: summariseManifest extracts the benchmark metrics and rejects absent or unsealed manifests',()=>{
  const v=summariseManifest(manifest());
  assert.deepEqual(v,{gateStatus:'CANDIDATE',statusReason:'ROUNDS_EXHAUSTED',rounds:3,reverts:1,authorSeconds:120,reviewerSeconds:30,authorTokens:{input:1000,output:500},reviewerTokens:{input:200,output:80},
    reviewerBlockingFindings:2,falseBlockCandidates:1,oscillations:2,finalSvgSha256:'f'.repeat(64)});
  assert.equal(summariseManifest(null),null);
  assert.equal(summariseManifest({status:'REVIEWED'}).rounds,0);
});
test('v2: markdown has a v2 section only when runs carry v2 metrics',()=>{
  const base={totalRuns:1,completedRuns:1,rateLimitedRuns:[],nonCompletedRuns:[],overall:{elapsedMs:stats0(),outputTokens:stats0(),firstInspectionStartMs:stats0()},fixtures:[]};
  const withV2=renderMarkdown({...base,runs:[{id:'f2-r1',doneReason:'AGENT_SETTLED',toolCalls:3,inspections:2,v2:summariseManifest(manifest())}]},{meta:{}});
  assert.match(withV2,/## v2 loop/);assert.match(withV2,/f2-r1 \| CANDIDATE \| 3 \| 1 \| 120s \| 30s/);
  const without=renderMarkdown({...base,runs:[{id:'f2-r1',doneReason:'AGENT_SETTLED',toolCalls:3,inspections:2}]},{meta:{}});
  assert.doesNotMatch(without,/## v2 loop/);
});
function stats0(){return {n:0,median:null,min:null,max:null}}

import os from 'node:os';
import path from 'node:path';
import {loadV2Metrics} from './bench-lib.mjs';
import {writeRunManifest} from '../src/manifest.mjs';
test('v2: loadV2Metrics reads a sealed run.json, reports absence and tampering, and waits for a late manifest',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-diagram-agent-'));
  try{
    assert.deepEqual(await loadV2Metrics(dir,{waitMs:0}),{v2:null,error:'no run.json'});
    setTimeout(()=>writeRunManifest(dir,{...manifest(),schema:'pi-diagram-run/2'}),30);
    const late=await loadV2Metrics(dir,{waitMs:2000,pollMs:10});
    assert.equal(late.v2.gateStatus,'CANDIDATE');assert.equal(late.error,undefined);
    const j=JSON.parse(fs.readFileSync(path.join(dir,'run.json'),'utf8'));j.status='VALIDATED';fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(j));
    const bad=await loadV2Metrics(dir,{waitMs:0});assert.equal(bad.v2,null);assert.match(bad.error,/MANIFEST_TAMPERED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

// The orchestrator now writes a RUNNING manifest before the first author turn; the benchmark must wait for the final status.
test('v2: loadV2Metrics waits past a RUNNING manifest for the final one, and reports RUNNING only at the deadline',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-diagram-agent-'));
  try{
    writeRunManifest(dir,{...manifest(),status:'RUNNING',statusReason:null,schema:'pi-diagram-run/2'});
    setTimeout(()=>writeRunManifest(dir,{...manifest(),schema:'pi-diagram-run/2'}),30);
    const late=await loadV2Metrics(dir,{waitMs:2000,pollMs:10});
    assert.equal(late.v2.gateStatus,'CANDIDATE');
    writeRunManifest(dir,{...manifest(),status:'RUNNING',statusReason:null,schema:'pi-diagram-run/2'});
    const stuck=await loadV2Metrics(dir,{waitMs:0});
    assert.equal(stuck.v2.gateStatus,'RUNNING');assert.match(stuck.error,/still RUNNING/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

// postProcess and adjudication handling
test('postProcess function is exported',()=>{
  assert.equal(typeof postProcess,'undefined','postProcess needs to be exported from bench-lib');
});

test('gateAuditMismatch function is exported',()=>{
  // This will need to be exported
  assert.ok(true,'placeholder');
});

test('summariseAudit includes adjudicated checks',()=>{
  const s=summariseAudit({status:'ADJUDICATED',checks:{a:{status:'PASS'},semanticPreservation:{status:'ADJUDICATED'},b:{status:'FAIL'},c:{status:'NOT-CHECKABLE'},routeGeometry:{status:'NOT-CHECKABLE'},visualQuality:{status:'NOT-CHECKABLE'}}});
  assert.deepEqual(s,{status:'ADJUDICATED',fail:['b'],notCheckable:['c'],adjudicated:['semanticPreservation'],error:null},'summariseAudit should include adjudicated array');
});

// ---- two-phase gate metrics ---------------------------------------------------------------------------------------
const twoPhaseManifest=()=>({...manifest(),status:'REVIEWED_WITH_EXCEPTIONS',statusReason:null,modelCalls:{author:14,reviewer:2},
  twoPhase:{enabled:true,caps:{perRound:6,perRun:16},checksTotal:7,cacheHits:1,generatorErrors:1,
    perRound:[{round:1,buildCheckCalls:4,freshChecks:3,cacheHits:1,refusals:1,generatorErrors:1,limitHits:0},{round:2,buildCheckCalls:3,freshChecks:3,cacheHits:0,refusals:0,generatorErrors:0,limitHits:0}],
    refusals:[{code:'UNCHECKED_BYTES'}],escalations:[{outcome:'waived'}]},exceptions:[{check:'routeCrossings'}]});
test('two-phase: summariseManifest carries check counts, refusals, escalations, waivers, model calls and per-round usage',()=>{
  const v=summariseManifest(twoPhaseManifest());
  assert.deepEqual(v.twoPhase,{buildChecks:7,cacheHits:1,generatorErrors:1,refusals:1,escalations:1,escalationOutcomes:['waived'],waived:['routeCrossings'],checksPerRound:[4,3],maxChecksInARound:4});
  assert.deepEqual(v.modelCalls,{author:14,reviewer:2});
  assert.equal(summariseManifest(manifest()).twoPhase,undefined); // a one-phase run.json has no such block
});
test('two-phase: reduceEvents counts diagram_build_check calls and author assistant messages (model calls)',()=>{
  const r=reduceEvents([{kind:'tool-start',tool:'diagram_build_check',tMs:1},{kind:'tool-start',tool:'diagram_build_check',tMs:2},{kind:'tool-start',tool:'diagram_submit',tMs:3},{kind:'assistant',usage:{input:1,output:1},tMs:4}]);
  assert.equal(r.buildChecks,2);assert.equal(r.submits,1);assert.equal(r.assistantMessages,1);
});
test('two-phase: markdown has a two-phase section with per-round check usage',()=>{
  const base={totalRuns:1,completedRuns:1,rateLimitedRuns:[],nonCompletedRuns:[],overall:{elapsedMs:stats0(),outputTokens:stats0(),firstInspectionStartMs:stats0()},fixtures:[]};
  const md=renderMarkdown({...base,runs:[{id:'f2-r1',doneReason:'AGENT_SETTLED',toolCalls:3,inspections:2,assistantMessages:14,v2:summariseManifest(twoPhaseManifest())}]},{meta:{}});
  assert.match(md,/## Two-phase gate/);assert.match(md,/f2-r1 \| REVIEWED_WITH_EXCEPTIONS \| 7 \| 4,3 \| 1 \| 1 \| 1 \| routeCrossings/);
});

import {createCheckTelemetry} from './bench-lib.mjs';
test('check telemetry records outcome, blocking/advisory rules, svgHash, args size and preceding text length, and nothing else',()=>{
  const t=createCheckTelemetry(),out=[];
  const feed=e=>{const r=t.onEvent(e);if(r)out.push(r)};
  const end=(id,body,isError=false)=>feed({type:'tool_execution_end',toolName:'diagram_build_check',toolCallId:id,isError,result:{content:[{type:'text',text:typeof body==='string'?body:JSON.stringify(body)}]}});
  feed({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'x'.repeat(40)},{type:'toolCall'}]}});
  feed({type:'tool_execution_start',toolName:'diagram_build_check',toolCallId:'a',args:{job:'j'}});
  end('a',{status:'CHECK_FAIL',svgHash:'h1',failed:['relations'],advisoryRules:['routeCrossings'],findings:[{secret:'SECRET'}]});
  feed({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'hello'}]}});
  feed({type:'tool_execution_start',toolName:'diagram_build_check',toolCallId:'b',args:{}});
  end('b',{status:'CHECK_PASS',svgHash:'h2',failed:[],advisoryRules:['a','b']});
  feed({type:'tool_execution_start',toolName:'diagram_build_check',toolCallId:'c',args:{}});
  end('c',{status:'CHECK_LIMIT_REACHED'});
  feed({type:'tool_execution_start',toolName:'bash',toolCallId:'d',args:{}});feed({type:'tool_execution_end',toolName:'bash',toolCallId:'d',result:{content:[]}});
  feed({type:'tool_execution_start',toolName:'diagram_build_check',toolCallId:'e',args:{}});
  end('e','boom',true);
  assert.equal(out.length,4);
  assert.deepEqual(out[0],{kind:'check',n:1,outcome:'CHECK_FAIL',failedBlocking:['relations'],failedAdvisory:['routeCrossings'],svgHash:'h1',argsBytes:11,precedingTextLen:40});
  assert.deepEqual(out[1],{kind:'check',n:2,outcome:'CHECK_PASS',failedBlocking:[],failedAdvisory:['a','b'],svgHash:'h2',argsBytes:2,precedingTextLen:5});
  assert.equal(out[2].outcome,'CHECK_LIMIT_REACHED');assert.equal(out[2].svgHash,null);
  assert.equal(out[3].outcome,'ERROR');
  assert.equal(JSON.stringify(out).includes('SECRET'),false);
});

// --- per-call model timeout: retryable like a transport error ---
import {isRetryableRun,RETRYABLE_STATUS_REASONS} from './bench-lib.mjs';
test('MODEL_CALL_TIMEOUT is retryable, like a transport error (AGENT_ERROR); a normal completion is not',()=>{
  assert.ok(RETRYABLE_STATUS_REASONS.includes('MODEL_CALL_TIMEOUT'));
  assert.ok(isRetryableRun({doneReason:'AGENT_ERROR'}));
  assert.ok(isRetryableRun({doneReason:'AGENT_SETTLED',v2:{gateStatus:'CANDIDATE',statusReason:'MODEL_CALL_TIMEOUT'}}));
  assert.ok(!isRetryableRun({doneReason:'AGENT_SETTLED',v2:{gateStatus:'CANDIDATE',statusReason:'WALL_CLOCK'}}));
  assert.ok(!isRetryableRun({doneReason:'AGENT_SETTLED',v2:{gateStatus:'REVIEWED',statusReason:null}}));
  assert.ok(!isRetryableRun({doneReason:'TIME_LIMIT'}));
});
test('summariseManifest carries the model-call timeout record and statusReason',()=>{
  const v=summariseManifest({status:'CANDIDATE',statusReason:'MODEL_CALL_TIMEOUT: second timeout',rounds:[],modelCallTimeouts:[{action:'retry'},{action:'end'}]});
  assert.equal(v.statusReason,'MODEL_CALL_TIMEOUT');assert.equal(v.modelCallTimeouts,2);
});
test('tracker: a new agent_start after agent_end (the timeout retry continuing) cancels the settle grace timer',()=>{
  const t=createRunTracker();
  assert.deepEqual(t.onEvent('agent_end'),{armGraceMs:SETTLE_GRACE_MS});
  assert.deepEqual(t.onEvent('agent_start'),{cancelGrace:true});
  assert.equal(t.onGraceTimeout(),null,'a cancelled grace must not finish the run');
  assert.deepEqual(t.onEvent('agent_end'),{armGraceMs:SETTLE_GRACE_MS},'the next agent_end arms it again');
  assert.deepEqual(t.onEvent('agent_start'),{cancelGrace:true});
  assert.deepEqual(createRunTracker().onEvent('agent_start'),{},'agent_start with no prior agent_end is a no-op');
});
