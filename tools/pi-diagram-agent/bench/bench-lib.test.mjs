import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {matchesRateLimit,eventIsRateLimit,median,reduceEvents,summariseAudit,aggregate,renderMarkdown,isCompleted} from './bench-lib.mjs';
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
test('summariseAudit lists FAIL and NOT-CHECKABLE but skips the structural pair',()=>{
  const s=summariseAudit({status:'FAIL',checks:{a:{status:'PASS'},b:{status:'FAIL'},c:{status:'NOT-CHECKABLE'},routeGeometry:{status:'NOT-CHECKABLE'},visualQuality:{status:'NOT-CHECKABLE'}}});
  assert.deepEqual(s,{status:'FAIL',fail:['b'],notCheckable:['c'],error:null});
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
