import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareAgentTask} from '../src/agent-led.mjs';
import {createV2Run,budgetsFromEnv,DEFAULT_BUDGETS} from '../src/orchestrator.mjs';
import {readRunManifest} from '../src/manifest.mjs';

const MDIR=fs.mkdtempSync(path.join(os.tmpdir(),'pi-manifests-test-'));
process.env.PI_DIAGRAM_MANIFEST_DIR=MDIR; // authoritative manifests: never the real ~ in tests
process.on('exit',()=>fs.rmSync(MDIR,{recursive:true,force:true}));
const hash=b=>createHash('sha256').update(b).digest('hex');
const SOURCE='flowchart LR\n  A[Start] -- "ok" --> B[Finish]\n';
const svg=(marker='',body='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><!--${marker}-->${body}</svg>`;
const rec=n=>({file:`${n}.png`,path:`/x/${n}.png`,sha256:n});
const emptyGeo=()=>({natural:{w:600,h:200},nodes:[],groups:[],labels:[],edges:[]});

/** Marker grammar inside the SVG comment: FAIL:a,b makes those audit checks FAIL; HINT makes routeCrossings violations carry a repairHint. */
function setup(over={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-twophase-test-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,SOURCE);
  const job=prepareAgentTask(input);
  const clock={t:0},calls={render:[],audit:[],geometry:[],reviewer:[],roundEnds:[]};
  const auditFor=text=>{
    const a={status:'NOT-CHECKABLE',checks:{svgWellFormed:{status:'PASS'},nodeIdentity:{status:'PASS',evidence:{missing:[],extra:[]}},relations:{status:'PASS'},groups:{status:'PASS'},semanticPreservation:{status:'PASS'},
      textFit:{status:'PASS',evidence:{method:'getBBox vs outline',checkedNodes:2,overflows:[]}},routeCrossings:{status:'PASS',evidence:{method:'straight spans',checkedEdges:1,violations:[]}},
      routeNodeIntrusion:{status:'PASS',evidence:{method:'sampled',checkedEdges:1}},routeGeometry:{status:'NOT-CHECKABLE',evidence:'x'},visualQuality:{status:'NOT-CHECKABLE',evidence:'x'}}};
    const m=/FAIL:([A-Za-z,0-9]+)/.exec(text);
    if(m)for(const name of m[1].split(',')){
      if(name==='routeCrossings'){
        const hinted=/HINT/.test(text);
        a.checks[name]={status:'FAIL',evidence:{method:'straight spans',violations:[{edgeA:'A->B',edgeB:'C->D',repairHint:hinted?{edge:'A->B',points:[[0,0],[5,5],[9,9]],bends:1}:null,moveHint:null}]}};
      }else a.checks[name]={status:'FAIL',evidence:{method:`method of ${name}`,violations:[{edgeA:'A->B',edgeB:`${name}->Z`}]}};
    }
    return a;
  };
  const deps={
    render:async bytes=>{calls.render.push(hash(bytes));clock.t+=100;return {svgHash:hash(bytes),full:rec('full'),crops:[rec('c0'),rec('c1'),rec('c2'),rec('c3')],fullscreen:rec('fit'),natural:{w:600,h:200}}},
    audit:async bytes=>{calls.audit.push(hash(bytes));clock.t+=50;return auditFor(bytes.toString())},
    original:async()=>({rendered:{originalSvgHash:'o'.repeat(64),media:{full:rec('orig')}},svgBytes:Buffer.from('<svg/>')}),
    image:r=>({type:'image',data:r.sha256,mimeType:'image/png'}),
    geometry:async bytes=>{calls.geometry.push(hash(bytes));return emptyGeo()},
    ...(over.deps??{}),
  };
  const replies=[...(over.replies??[])];
  const reviewerFactory=()=>({
    modelId:'test-model',
    async prompt(text,{images}){
      calls.reviewer.push({text,images});clock.t+=700;
      let r=replies.shift();if(typeof r==='function')r=r(text);
      if(r instanceof Error)throw r;
      return {text:typeof r==='string'?r:JSON.stringify({imagesSeen:images.length,...r}),usage:{input:10,output:5}};
    },
    dispose(){},
  });
  const run=createV2Run(job,{deps,reviewerFactory,now:()=>clock.t,budgets:over.budgets,onRoundEnd:n=>calls.roundEnds.push(n)});
  const write=text=>fs.writeFileSync(job.outputPath,text);
  const body=async res=>JSON.parse((await res).content[0].text);
  const check=async(opts)=>body(run.buildCheck(opts));
  const out=async(opts)=>body(run.submit(opts));
  const cleanup=()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(job.runDir,{recursive:true,force:true})};
  return {job,run,clock,calls,write,check,out,cleanup,replies};
}
const rv=(findings=[],verdict)=>({findings,verdict:verdict??(findings.some(f=>f.severity==='blocking')?'revise':'accept')});
const rf=(rule,elements,severity='blocking')=>({rule,severity,elements,evidence:'seen in the image',measured:'about 40 units',threshold:'<= 25 units',suggestion:'fix it'});
const idsIn=text=>[...new Set([...text.matchAll(/"id":"(F-[0-9a-f]{8})"/g)].map(m=>m[1]))];
const waiveAll=reason=>text=>({findings:[],verdict:'accept',diagnosis:{outcome:'waiver',waivers:idsIn(text).map(finding=>({finding,reason}))}});
/** Spends the whole per-round check budget on distinct failing bytes; the last write is what stays on disk. */
async function exhaustChecks(t,marker,n=6){
  let last=null;
  for(let i=1;i<=n;i++){t.write(svg(`${marker} v${i}`));last=await t.check()}
  return last;
}

test('budgets: diagram_build_check caps default to 6 per round and 16 per run, configurable by env',()=>{
  assert.equal(DEFAULT_BUDGETS.maxChecksPerRound,6);assert.equal(DEFAULT_BUDGETS.maxChecksPerRun,16);assert.equal(DEFAULT_BUDGETS.twoPhase,true);
  const b=budgetsFromEnv({PI_DIAGRAM_MAX_CHECKS_PER_ROUND:'4',PI_DIAGRAM_MAX_CHECKS_PER_RUN:'9'});
  assert.equal(b.maxChecksPerRound,4);assert.equal(b.maxChecksPerRun,9);
  assert.equal(budgetsFromEnv({PI_DIAGRAM_TWO_PHASE:'0'}).twoPhase,false);
});

test('submit REFUSES bytes that were never script-checked, and the refusal is not a round',async()=>{
  const t=setup();try{
    t.write(svg('v1'));
    const r=await t.out();
    assert.equal(r.status,'REFUSED');assert.equal(r.code,'UNCHECKED_BYTES');assert.equal(r.countedAsRound,false);
    assert.match(r.next,/diagram_build_check/);
    assert.equal(t.calls.reviewer.length,0);assert.equal(t.calls.audit.length,0);assert.equal(t.calls.render.length,0);
    assert.equal(t.run.state().round,0);assert.deepEqual(t.calls.roundEnds,[]);
  }finally{t.cleanup()}
});

test('submit REFUSES bytes whose latest check has a FAIL; the refusal lists the findings and is not a round',async()=>{
  const t=setup();try{
    t.write(svg('FAIL:routeNodeIntrusion'));
    const c=await t.check();
    assert.equal(c.status,'CHECK_FAIL');assert.ok(c.findings.some(f=>f.rule==='routeNodeIntrusion'));
    const r=await t.out();
    assert.equal(r.status,'REFUSED');assert.equal(r.code,'FAILING_BYTES');assert.equal(r.countedAsRound,false);
    assert.ok(r.findings.some(f=>f.rule==='routeNodeIntrusion'));
    assert.equal(t.calls.reviewer.length,0);assert.equal(t.run.state().round,0);
  }finally{t.cleanup()}
});

test('refusals do not consume submit rounds: three refusals then a clean check and submit is still round 1 of a 1-round budget',async()=>{
  const t=setup({budgets:{maxRounds:1},replies:[rv([])]});try{
    t.write(svg('FAIL:routeNodeIntrusion'));
    assert.equal((await t.out()).status,'REFUSED');assert.equal((await t.check()).status,'CHECK_FAIL');assert.equal((await t.out()).status,'REFUSED');
    t.write(svg('fixed'));assert.equal((await t.out()).status,'REFUSED');
    assert.equal((await t.check()).status,'CHECK_PASS');
    const r=await t.out();
    assert.equal(r.status,'REVIEWED');
    const m=readRunManifest(t.job.runDir);
    assert.equal(m.rounds.length,1);assert.equal(m.twoPhase.refusals.length,3);assert.deepEqual(m.twoPhase.refusals.map(x=>x.code),['UNCHECKED_BYTES','FAILING_BYTES','UNCHECKED_BYTES']);
  }finally{t.cleanup()}
});

test('cache by svg sha256: a repeated check re-uses the result; submit re-uses the phase-1 audit and renders only for the reviewer',async()=>{
  const t=setup({replies:[rv([])]});try{
    const bytes=svg('clean');t.write(bytes);
    const a=await t.check(),b=await t.check();
    assert.equal(a.cached,false);assert.equal(b.cached,true);assert.equal(a.svgHash,hash(bytes));
    assert.deepEqual(t.calls.audit,[hash(bytes)]);assert.equal(t.calls.geometry.length,1);assert.equal(t.calls.render.length,0); // check is text-only: no render
    assert.equal(b.checksUsedThisRound,2); // every call counts against the cap, a cache hit included
    const r=await t.out();
    assert.equal(r.status,'REVIEWED');
    assert.deepEqual(t.calls.audit,[hash(bytes)]); // not audited again at submit
    assert.equal(t.calls.geometry.length,1);assert.deepEqual(t.calls.render,[hash(bytes)]);
    assert.equal(t.calls.reviewer.length,1);assert.equal(t.calls.reviewer[0].images.length,3);
  }finally{t.cleanup()}
});

test('check runs geometry findings even when the audit already has a FAIL (author sees every failure in one call)',async()=>{
  const t=setup();try{
    t.write(svg('FAIL:routeNodeIntrusion'));
    await t.check();
    assert.equal(t.calls.geometry.length,1);
  }finally{t.cleanup()}
});

test('check caps: per round and per run, distinct bytes only; a cap hit does not call the auditor; usage is recorded in run.json',async()=>{
  const t=setup({budgets:{maxChecksPerRound:2,maxChecksPerRun:3,maxRounds:6},replies:[rv([rf('balance',['A'])]),rv([rf('balance',['A'])])]});try{
    t.write(svg('FAIL:routeNodeIntrusion a'));assert.equal((await t.check()).checksLeftThisRound,1);
    t.write(svg('b'));assert.equal((await t.check()).checksLeftThisRound,0);
    t.write(svg('c'));
    const limited=await t.check();
    assert.equal(limited.status,'CHECK_LIMIT_REACHED');assert.equal(limited.scope,'round');assert.equal(t.calls.audit.length,2);
    // The cap-th check is clean, so submit goes to the reviewer and ends the round; the budget resets.
    t.write(svg('b'));assert.equal((await t.out()).status,'REVISE');assert.deepEqual(t.calls.roundEnds,[1]);
    t.write(svg('d'));assert.equal((await t.check()).status,'CHECK_PASS'); // 3rd check of the run
    t.write(svg('e'));
    const runLimited=await t.check();
    assert.equal(runLimited.status,'CHECK_LIMIT_REACHED');assert.equal(runLimited.scope,'run');
    const m=readRunManifest(t.job.runDir);
    assert.equal(m.twoPhase.caps.perRound,2);assert.equal(m.twoPhase.caps.perRun,3);
    assert.equal(m.twoPhase.checksTotal,3);assert.deepEqual(m.twoPhase.perRound.map(x=>x.buildCheckCalls),[2,1]);
    assert.equal(m.twoPhase.checks.length,3);assert.ok(m.twoPhase.checks.every(c=>typeof c.svgHash==='string'&&Array.isArray(c.failed)));
  }finally{t.cleanup()}
});

test('escalation (cap-th check still FAILs) with a SEMANTIC fail: rejected like today, reviewer never called, never waivable',async()=>{
  const t=setup({budgets:{maxChecksPerRound:2}});try{
    t.write(svg('FAIL:routeCrossings,nodeText a'));await t.check();
    t.write(svg('FAIL:routeCrossings,nodeText b'));await t.check();
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.round,1);
    assert.ok(r.findings.some(f=>f.rule==='nodeText'));
    assert.equal(t.calls.reviewer.length,0);
    assert.equal(r.escalation.outcome,'rejected-semantic');
  }finally{t.cleanup()}
});

test('every semantic check name is rejected without a reviewer call',async()=>{
  for(const name of ['svgWellFormed','nodeIdentity','nodeText','relations','relationStyle','groups','groupMembership','originalGroupParity','semanticPreservation','sourceDefinitionConflicts']){
    const t=setup({budgets:{maxChecksPerRound:1}});try{
      t.write(svg(`FAIL:${name}`));await t.check();
      const r=await t.out();
      assert.equal(r.status,'REVISE',name);assert.equal(r.escalation.outcome,'rejected-semantic',name);assert.equal(t.calls.reviewer.length,0,name);
    }finally{t.cleanup()}
  }
});

test('escalation: routeCrossings that still has a repairHint is NOT waivable even if the reviewer asks',async()=>{
  const t=setup({replies:[waiveAll('the crossing is unavoidable')]});try{
    const last=await exhaustChecks(t,'FAIL:routeCrossings HINT');
    assert.equal(last.checksLeftThisRound,0);
    const r=await t.out();
    assert.equal(t.calls.reviewer.length,1);
    assert.equal(r.status,'REVISE');assert.equal(r.round,1);assert.equal(r.escalation.outcome,'waiver-rejected');
    assert.match(JSON.stringify(r.escalation.waiverRejected),/repairHint|hint/i);
    assert.notEqual(t.run.state().status,'REVIEWED_WITH_EXCEPTIONS');
  }finally{t.cleanup()}
});

test('escalation: routeCrossings with null repair/move hints + a reviewer waiver -> REVIEWED_WITH_EXCEPTIONS listing the waiver',async()=>{
  const t=setup({replies:[waiveAll('the two connectors must cross: the source group sits between the targets')]});try{
    await exhaustChecks(t,'FAIL:routeCrossings');
    const bytes=fs.readFileSync(t.job.outputPath);
    const r=await t.out();
    assert.equal(r.status,'REVIEWED_WITH_EXCEPTIONS');assert.equal(r.svgHash,hash(bytes));
    assert.equal(r.exceptions.length,1);
    const e=r.exceptions[0];
    assert.equal(e.check,'routeCrossings');assert.ok(e.elements.length>0);assert.ok(e.measured);assert.match(e.reason,/must cross/);
    assert.match(r.message,/\/magic-accept/);assert.match(r.message,/routeCrossings/);assert.equal(r.publishAsDefault,false);
    // The prompt sent to the reviewer is the diagnosis prompt: it carries the script findings.
    assert.match(t.calls.reviewer[0].text,/DIAGNOSIS/);assert.match(t.calls.reviewer[0].text,/routeCrossings/);
    assert.doesNotMatch(t.calls.reviewer[0].text,/ZERO failures|zero failures/); // the normal-mode preamble would contradict the listed FAILs
    assert.match(t.calls.reviewer[0].text,/every (?:other )?check except those listed/i);
    const m=readRunManifest(t.job.runDir);
    assert.equal(m.status,'REVIEWED_WITH_EXCEPTIONS');assert.equal(m.finalSvgSha256,hash(bytes));
    assert.deepEqual(m.exceptions.map(x=>x.check),['routeCrossings']);assert.equal(m.exceptions[0].svgSha256,hash(bytes));
    assert.equal(m.twoPhase.escalations.length,1);assert.equal(m.twoPhase.escalations[0].outcome,'waived');
    assert.equal(m.metrics.gateStatus,'REVIEWED_WITH_EXCEPTIONS');
  }finally{t.cleanup()}
});

test('escalation waiver does not pass if the reviewer also reports a blocking visual defect',async()=>{
  const t=setup({replies:[text=>({...waiveAll('must cross')(text),findings:[rf('balance',['A'])],verdict:'revise'})]});try{
    await exhaustChecks(t,'FAIL:routePairClearance');
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.ok(r.findings.some(f=>f.rule==='balance'));
    assert.ok(r.findings.some(f=>f.rule==='routePairClearance')); // the script FAIL stays blocking
  }finally{t.cleanup()}
});

test('escalation: a non-waivable check (textFit) plus a reviewer waiver is rejected',async()=>{
  const t=setup({replies:[waiveAll('looks fine to me')]});try{
    await exhaustChecks(t,'FAIL:textFit');
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.escalation.outcome,'waiver-rejected');
    assert.match(JSON.stringify(r.escalation.waiverRejected),/textFit/);
    assert.ok(r.findings.some(f=>f.rule==='textFit'));
  }finally{t.cleanup()}
});

test('escalation: a waiver that covers only some of the FAILs is rejected (waivable + non-waivable together)',async()=>{
  const t=setup({replies:[text=>{const ids=idsIn(text);return {findings:[],verdict:'accept',diagnosis:{outcome:'waiver',waivers:[{finding:ids[0],reason:'only the first one'}]}}}]});try{
    await exhaustChecks(t,'FAIL:routePairClearance,routeContainerClearance');
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.escalation.outcome,'waiver-rejected');
  }finally{t.cleanup()}
});

test('escalation: border-grazing checks (routePairClearance, routeContainerClearance) are waivable',async()=>{
  const t=setup({replies:[waiveAll('the gutter between the two groups is 6 units wide and cannot be widened without a relayout')]});try{
    await exhaustChecks(t,'FAIL:routePairClearance,routeContainerClearance');
    const r=await t.out();
    assert.equal(r.status,'REVIEWED_WITH_EXCEPTIONS');assert.deepEqual(r.exceptions.map(e=>e.check).sort(),['routeContainerClearance','routePairClearance']);
  }finally{t.cleanup()}
});

test('escalation relayout: layout-level advice goes to the author, counts as a round, and is carried in the reply',async()=>{
  const reply={findings:[],verdict:'accept',diagnosis:{outcome:'relayout',relayout:{summary:'The two branches fight over the middle lane.',changes:[{kind:'direction',detail:'switch LR to TB'},{kind:'branch-side',detail:'put the error branch below the main chain'}]}}};
  const t=setup({budgets:{maxChecksPerRound:2},replies:[reply]});try{
    await exhaustChecks(t,'FAIL:routeNodeIntrusion',2);
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.round,1);
    assert.equal(r.escalation.outcome,'relayout');assert.deepEqual(r.escalation.relayout.changes.map(c=>c.kind),['direction','branch-side']);
    assert.equal(t.run.state().round,1);assert.deepEqual(t.calls.roundEnds,[1]);
    assert.match(r.next,/layout|relayout/i);
    const m=readRunManifest(t.job.runDir);assert.equal(m.twoPhase.escalations[0].outcome,'relayout');assert.equal(m.rounds.length,1);
    // The check budget resets for the redo.
    t.write(svg('redo'));assert.equal((await t.check()).checksUsedThisRound,1);
  }finally{t.cleanup()}
});

test('escalation relayout with a malformed change kind is a reviewer schema error, not accepted advice; the escalation then falls back to a plain reject (a round, never a pass)',async()=>{
  const bad={findings:[],verdict:'accept',diagnosis:{outcome:'relayout',relayout:{summary:'x',changes:[{kind:'recolour',detail:'make it blue'}]}}};
  const t=setup({budgets:{maxChecksPerRound:1},replies:[bad,bad]});try{
    t.write(svg('FAIL:routeNodeIntrusion'));await t.check();
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.round,1);assert.equal(r.escalation.outcome,'reviewer-error');assert.match(r.escalation.error,/REVIEWER_SCHEMA/);
    assert.ok(r.findings.some(f=>f.rule==='routeNodeIntrusion'));
    assert.equal(readRunManifest(t.job.runDir).twoPhase.escalations[0].outcome,'reviewer-error');
  }finally{t.cleanup()}
});

test('escalation reviewer timeout/outage: the script findings come back as a normal rejected round instead of ending the run as CANDIDATE',async()=>{
  const t=setup({budgets:{maxChecksPerRound:1},replies:[new Error('provider down'),new Error('provider down')]});try{
    t.write(svg('FAIL:routePairClearance'));await t.check();
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.escalation.outcome,'reviewer-error');assert.ok(r.findings.some(f=>f.rule==='routePairClearance'));
  }finally{t.cleanup()}
});

test('reviewer prompt in two-phase mode states that the script checks passed and lists the visual focus items',async()=>{
  const t=setup({replies:[rv([])]});try{
    t.write(svg('clean'));await t.check();await t.out();
    const p=t.calls.reviewer[0].text;
    assert.match(p,/ZERO failures|zero failures/);assert.match(p,/FOCUS/);
    for(const w of ['label ownership','legend','balance'])assert.match(p,new RegExp(w,'i'));
    assert.doesNotMatch(p,/reading[- ]order/i);assert.match(p,/FOCUS first, in this order: \(1\) label ownership/);
    assert.match(p,/anything else you can see|any other defect you can see/i);
  }finally{t.cleanup()}
});

test('REVIEWED still requires zero script FAILs; a check-clean candidate reviewed OK is REVIEWED with no exceptions',async()=>{
  const t=setup({replies:[rv([])]});try{
    t.write(svg('clean'));await t.check();
    const r=await t.out();
    assert.equal(r.status,'REVIEWED');
    const m=readRunManifest(t.job.runDir);assert.deepEqual(m.exceptions,[]);assert.equal(m.twoPhase.escalations.length,0);
  }finally{t.cleanup()}
});

test('unchecked bytes after the check budget is spent are checked by the orchestrator itself (no deadlock) and then follow the escalation rules',async()=>{
  const t=setup({budgets:{maxChecksPerRound:1}});try{
    t.write(svg('a'));await t.check();
    t.write(svg('FAIL:nodeText b')); // edited after the last allowed check
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.escalation.outcome,'rejected-semantic');
    const m=readRunManifest(t.job.runDir);assert.ok(m.twoPhase.checks.some(c=>c.implicit===true));
  }finally{t.cleanup()}
});

test('PI_DIAGRAM_TWO_PHASE=0 (budgets.twoPhase=false): submit audits and reviews directly as before; run.check is unavailable',async()=>{
  const t=setup({budgets:{twoPhase:false},replies:[rv([])]});try{
    t.write(svg('clean'));
    const r=await t.out();assert.equal(r.status,'REVIEWED');
    await assert.rejects(()=>t.run.buildCheck(),/DIAGRAM_BUILD_CHECK_DISABLED/);
  }finally{t.cleanup()}
});

test('submit after editing bytes without a new build_check is refused even though an earlier hash passed',async()=>{
  const t=setup({replies:[rv([])]});try{
    const v1=svg('v1 clean');t.write(v1);
    const c=await t.check();assert.equal(c.status,'CHECK_PASS');
    t.write(svg('v2 edited after the check'));
    const r=await t.out();
    assert.equal(r.status,'REFUSED');assert.equal(r.code,'UNCHECKED_BYTES');
    assert.equal(t.calls.reviewer.length,0);assert.equal(t.run.state().round,0);
    // Restoring the checked bytes makes them submittable again (the cache is by hash).
    t.write(v1);assert.equal((await t.out()).status,'REVIEWED');
  }finally{t.cleanup()}
});

test('submit names the hash it was checked under: a different current hash is refused as STALE_HASH, the matching one goes through',async()=>{
  const t=setup({replies:[rv([])]});try{
    t.write(svg('v1'));const c1=await t.check();
    t.write(svg('v2'));const c2=await t.check();
    const r=await t.out({svgHash:c1.svgHash});
    assert.equal(r.status,'REFUSED');assert.equal(r.code,'STALE_HASH');assert.equal(t.run.state().round,0);
    assert.equal((await t.out({svgHash:c2.svgHash})).status,'REVIEWED');
  }finally{t.cleanup()}
});

test('build step: the generator runs inside every build_check before the hash is taken; its output bytes are what is checked',async()=>{
  const t=setup({replies:[rv([])]});try{
    const made=svg('made by make.py');let runs=0;
    const build=async()=>{runs++;t.write(made);return {ok:true,source:'make.py'}};
    const c=await t.check({build});
    assert.equal(runs,1);assert.equal(c.source,'make.py');assert.equal(c.svgHash,hash(made));assert.equal(c.status,'CHECK_PASS');
    // A second build that produces identical bytes is a cache hit but still a call against the cap.
    const c2=await t.check({build});
    assert.equal(c2.cached,true);assert.equal(c2.checksUsedThisRound,2);assert.deepEqual(t.calls.audit,[hash(made)]);
    assert.equal((await t.out({svgHash:c.svgHash})).status,'REVIEWED');
    const m=readRunManifest(t.job.runDir);
    assert.deepEqual(m.twoPhase.perRound.map(x=>({calls:x.buildCheckCalls,fresh:x.freshChecks,hits:x.cacheHits})),[{calls:2,fresh:1,hits:1}]);
    assert.equal(m.twoPhase.cacheHits,1);
  }finally{t.cleanup()}
});

test('build step: a generator error is a short message (status GENERATOR_ERROR), uses no check, never reaches the auditor, and is counted in run.json',async()=>{
  const t=setup();try{
    t.write(svg('stale bytes'));
    const c=await t.check({build:async()=>({ok:false,source:'make.py',message:'make.py failed. Last output: ValueError: no points'})});
    assert.equal(c.status,'GENERATOR_ERROR');assert.match(c.message,/no points/);assert.equal(c.checksUsedThisRound,0);assert.equal(c.checksLeftThisRound,6);assert.equal(c.generatorErrorsLeftThisRound,5);assert.equal(t.calls.audit.length,0);
    const m=readRunManifest(t.job.runDir);
    assert.equal(m.twoPhase.checksTotal,0);assert.equal(m.twoPhase.caps.generatorErrorsPerRound,6);assert.equal(m.twoPhase.generatorErrors,1);assert.equal(m.twoPhase.perRound[0].generatorErrors,1);assert.equal(m.twoPhase.checks[0].generatorError,true);
    // The stale candidate.svg left over from before is still unchecked, so submit refuses it.
    assert.equal((await t.out()).code,'UNCHECKED_BYTES');
  }finally{t.cleanup()}
});

test('build step: a genuine tool failure (throw) propagates and does not spend a check',async()=>{
  const t=setup();try{
    await assert.rejects(()=>t.check({build:async()=>{throw Error('GENERATOR_EXECUTION_UNAVAILABLE')}}),/GENERATOR_EXECUTION_UNAVAILABLE/);
    t.write(svg('x'));assert.equal((await t.check()).checksUsedThisRound,1);
  }finally{t.cleanup()}
});

test('run.json records per-round build_check calls, refusals, cache hits and generator errors, plus model calls per role and check time apart from author time',async()=>{
  const t=setup({replies:[rv([rf('balance',['A'])]),rv([])]});try{
    t.run.noteAuthorCall();t.run.noteAuthorCall();t.run.noteAuthorCall();
    t.write(svg('a'));await t.out();                 // refusal 1 (round 1)
    await t.check();await t.check();                 // fresh + cache hit
    await t.out();                                   // round 1 ends REVISE
    t.write(svg('b'));await t.check();await t.out(); // round 2 REVIEWED
    const m=readRunManifest(t.job.runDir);
    assert.deepEqual(m.twoPhase.perRound.map(x=>({round:x.round,calls:x.buildCheckCalls,fresh:x.freshChecks,hits:x.cacheHits,refusals:x.refusals,gen:x.generatorErrors})),
      [{round:1,calls:2,fresh:1,hits:1,refusals:1,gen:0},{round:2,calls:1,fresh:1,hits:0,refusals:0,gen:0}]);
    assert.deepEqual(m.modelCalls,{author:3,reviewer:2});assert.deepEqual(m.metrics.modelCalls,{author:3,reviewer:2});
    assert.equal(m.metrics.buildChecks,3);assert.equal(m.metrics.refusals,1);
    assert.ok(m.timings.checkMs>=0);
  }finally{t.cleanup()}
});

test('submit with the check budget exhausted and no readable candidate is refused (no throw), and the author can still recover by writing the file',async()=>{
  const t=setup({budgets:{maxChecksPerRound:1}});try{
    t.write(svg('a FAIL:textFit'));await t.check();           // spends the only check of the round
    fs.rmSync(t.job.outputPath);                              // candidate missing, as after a generator error
    const r=await t.out();
    assert.equal(r.status,'REFUSED');assert.equal(r.code,'NO_CANDIDATE');assert.match(r.message,/candidate\.svg/);assert.equal(r.countedAsRound,false);
    t.write(svg('b'));                                        // unchecked bytes after the budget: the orchestrator checks them itself
    const r2=await t.out();assert.notEqual(r2.status,'REFUSED');
  }finally{t.cleanup()}
});

test('submit with the wall clock spent and no readable candidate finalises as CANDIDATE instead of throwing',async()=>{
  const t=setup({budgets:{maxWallMs:1000}});try{
    t.clock.t=5000;
    const r=await t.out();
    assert.equal(r.status,'CANDIDATE');assert.match(r.statusReason??'',/WALL_CLOCK/);
  }finally{t.cleanup()}
});

test('submit with the budget exhausted, no candidate and the last round allowed does not throw (no hashing of a missing candidate)',async()=>{
  const t=setup({budgets:{maxChecksPerRound:1,maxRounds:1}});try{
    t.write(svg('a FAIL:textFit'));await t.check();
    fs.rmSync(t.job.outputPath);
    const r=await t.out();
    assert.equal(r.status,'REFUSED');assert.equal(r.code,'NO_CANDIDATE');
  }finally{t.cleanup()}
});

const genFail=message=>async()=>({ok:false,source:'make.py',message});

test('generator errors do not reduce the checks left; real checks still count',async()=>{
  const t=setup({budgets:{maxChecksPerRound:2}});try{
    for(let i=0;i<4;i++){const c=await t.check({build:genFail('boom')});assert.equal(c.status,'GENERATOR_ERROR');assert.equal(c.checksLeftThisRound,2);assert.equal(c.checksLeftThisRun,16)}
    t.write(svg('ok'));const r=await t.check({build:async()=>({ok:true,source:'make.py'})});
    assert.equal(r.status,'CHECK_PASS');assert.equal(r.checksUsedThisRound,1);assert.equal(r.checksLeftThisRound,1);
    const m=readRunManifest(t.job.runDir);
    assert.equal(m.twoPhase.checksTotal,1);assert.equal(m.twoPhase.generatorErrors,4);
    assert.deepEqual(m.twoPhase.perRound.map(x=>({calls:x.buildCheckCalls,fresh:x.freshChecks,gen:x.generatorErrors})),[{calls:1,fresh:1,gen:4}]);
    assert.equal(m.metrics.buildChecks,1);assert.equal(m.metrics.generatorErrors,4);
  }finally{t.cleanup()}
});

test('the generator-error cap refuses further build_checks for the round without running the generator, lets submit fall back to its own check, and resets after the round',async()=>{
  const t=setup({budgets:{maxGeneratorErrorsPerRound:2},replies:[rv([rf('balance',['A'])])]});try{
    let ran=0;const counting=async()=>{ran++;return {ok:false,source:'make.py',message:'boom'}};
    await t.check({build:counting});await t.check({build:counting});
    const c=await t.check({build:counting});
    assert.equal(c.status,'GENERATOR_ERROR_LIMIT_REACHED');assert.equal(ran,2);assert.equal(c.checksLeftThisRound,6);assert.match(c.next,/diagram_submit/);
    assert.equal((await t.out()).code,'NO_CANDIDATE'); // nothing written yet
    t.write(svg('written by hand'));
    assert.equal((await t.out()).status,'REVISE'); // unchecked bytes are checked by the orchestrator, no UNCHECKED_BYTES deadlock
    const next=await t.check({build:counting}); // new round: allowance restored
    assert.equal(next.status,'GENERATOR_ERROR');assert.equal(ran,3);
    const m=readRunManifest(t.job.runDir);
    assert.equal(m.twoPhase.generatorErrors,3);assert.equal(m.twoPhase.perRound[0].generatorErrors,2);assert.equal(m.twoPhase.perRound[0].limitHits,1);
  }finally{t.cleanup()}
});

test('budgets: PI_DIAGRAM_MAX_GENERATOR_ERRORS_PER_ROUND configures the cap, default 6',()=>{
  assert.equal(DEFAULT_BUDGETS.maxGeneratorErrorsPerRound,6);
  assert.equal(budgetsFromEnv({PI_DIAGRAM_MAX_GENERATOR_ERRORS_PER_ROUND:'3'}).maxGeneratorErrorsPerRound,3);
});

test('a build note (for example make.py ignored under spec mode required) is carried in the check reply',async()=>{
  const t=setup();try{
    t.write(svg('ok'));
    const c=await t.check({build:async()=>({ok:true,source:'layout.json',note:'make.py exists but is ignored'})});
    assert.equal(c.status,'CHECK_PASS');assert.equal(c.source,'layout.json');assert.match(c.buildNote,/make\.py.*ignored/);
    const g=await t.check({build:async()=>({ok:false,source:'layout.json',message:'SCHEMA_ERROR: x',note:'make.py exists but is ignored'})});
    assert.equal(g.status,'GENERATOR_ERROR');assert.match(g.buildNote,/ignored/);
  }finally{t.cleanup()}
});

test('live sequence: round 1 submitted with no candidate file, round 2 a valid but equal-or-worse candidate: no throw, a normal revise outcome, byteless rounds never become base or best',async()=>{
  const t=setup({budgets:{maxChecksPerRound:1,maxRounds:5}});try{
    t.write(svg('a FAIL:textFit'));await t.check();
    fs.rmSync(t.job.outputPath);
    const r1=await t.out();
    assert.equal(r1.status,'REFUSED');assert.equal(r1.code,'NO_CANDIDATE');
    t.write(svg('b FAIL:textFit'));
    const r2=await t.out();assert.equal(r2.status,'REVISE');assert.equal(r2.round,1);
    t.write(svg('c FAIL:textFit'));await t.check();       // a fresh round: equal blocking count, so base is kept or replaced without a throw
    const r3=await t.out();assert.ok(['REVISE','CANDIDATE'].includes(r3.status),r3.status);
    const m=readRunManifest(t.job.runDir);
    assert.ok(m.finalSvgSha256===null||/^[0-9a-f]{64}$/.test(m.finalSvgSha256));
    for(const rd of m.rounds)assert.ok(rd.svgHash===undefined||rd.svgHash===null||/^[0-9a-f]{64}$/.test(rd.svgHash));
  }finally{t.cleanup()}
});

test('author time is not double counted when a submit throws part-way: a failed submit consumes its interval, so authorMs never exceeds the wall time',async()=>{
  let failImage=true;
  const t=setup({deps:{image:r=>{if(failImage)throw Error('IMAGE_TOO_LARGE');return {type:'image',data:r.sha256,mimeType:'image/png'}}},replies:[rv([])]});try{
    t.write(svg('a'));t.clock.t=1000;await t.check();
    await assert.rejects(()=>t.out(),/IMAGE_TOO_LARGE/);
    failImage=false;t.clock.t+=1000;
    t.write(svg('b'));await t.check();
    await t.out();
    const m=readRunManifest(t.job.runDir);
    assert.ok(m.timings.authorMs<=m.timings.totalMs,`authorMs ${m.timings.authorMs} <= totalMs ${m.timings.totalMs}`);
  }finally{t.cleanup()}
});
