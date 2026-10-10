// Relaxed gate inside the /magic loop: the Judge accepts (mocked judge factory, no model, no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareAgentTask} from '../src/agent-led.mjs';
import {createV2Run} from '../src/orchestrator.mjs';
import {readRunManifest,verifyManifest} from '../src/manifest.mjs';
import {verifyJudgement,acceptWithJudge} from '../src/judge-run.mjs';
import {acceptThresholdsFromEnv} from '../src/judge.mjs';

const MDIR=fs.mkdtempSync(path.join(os.tmpdir(),'pi-manifests-test-'));
process.env.PI_DIAGRAM_MANIFEST_DIR=MDIR;
process.on('exit',()=>fs.rmSync(MDIR,{recursive:true,force:true}));
const hash=b=>createHash('sha256').update(b).digest('hex');
const SOURCE='flowchart LR\n  A[Start] -- "ok" --> B[Finish]\n';
const svg=(marker='',body='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><!--${marker}-->${body}</svg>`;
const rec=n=>({file:`${n}.png`,path:`/x/${n}.png`,sha256:n});
const emptyGeo=()=>({natural:{w:600,h:200},nodes:[],groups:[],labels:[],edges:[]});
const DIMS=['balance','readability','aesthetics','lineClarity','pageWidth'];

/** Marker grammar: FAIL:a,b makes those audit checks FAIL (evidence is blocking-shaped for blocking rules). */
function setup(over={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-relaxed-test-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,SOURCE);
  const job=prepareAgentTask(input);
  const clock={t:0},calls={judge:[],coach:[],reviewer:[],judgeRender:[]};
  const auditFor=text=>{
    const a={status:'NOT-CHECKABLE',checks:{svgWellFormed:{status:'PASS'},nodeIdentity:{status:'PASS',evidence:{missing:[],extra:[]}},relations:{status:'PASS'},groups:{status:'PASS'},semanticPreservation:{status:'PASS'},
      textFit:{status:'PASS',evidence:{method:'m',checkedNodes:2,overflows:[]}},routeCrossings:{status:'PASS',evidence:{method:'m',checkedEdges:1,violations:[]}},routeGeometry:{status:'NOT-CHECKABLE',evidence:'x'},visualQuality:{status:'NOT-CHECKABLE',evidence:'x'}}};
    const m=/FAIL:([A-Za-z,0-9]+)/.exec(text);
    if(m)for(const name of m[1].split(',')){
      a.checks[name]={status:'FAIL',evidence:{method:`method of ${name}`,violations:[{edgeA:'A->B',edgeB:`${name}->Z`}]}};
    }
    return a;
  };
  const deps={
    render:async bytes=>{clock.t+=100;return {svgHash:hash(bytes),full:rec('full'),crops:[rec('c0'),rec('c1'),rec('c2'),rec('c3')],fullscreen:rec('fit'),natural:{w:600,h:200}}},
    audit:async bytes=>{clock.t+=50;return auditFor(bytes.toString())},
    original:async()=>({rendered:{originalSvgHash:'o'.repeat(64),media:{full:rec('orig')}},svgBytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')}),
    image:r=>({type:'image',data:r.sha256,mimeType:'image/png'}),
    geometry:async()=>emptyGeo(),
    // The judge renders both drawings: a fake that writes one tiny file per image, named by the bytes it came from.
    judgeRender:async(bytes,{outPrefix})=>{
      calls.judgeRender.push(hash(bytes));
      const mk=n=>{const f=`${outPrefix}.${n}.png`;fs.writeFileSync(f,Buffer.from(`${hash(bytes).slice(0,6)}-${n}`));return {path:f,file:path.basename(f)}};
      return {full:mk('full'),fullscreen:mk('fit'),crops:[],natural:{w:600,h:200}};
    },
  };
  const replies=[...(over.replies??[])],verdicts=[...(over.judge??[])];
  const reviewerFactory=()=>({modelId:'test-model',async prompt(_text,{images}){
    calls.reviewer.push(images.length);clock.t+=700;
    const r=replies.shift()??{findings:[],verdict:'accept'};
    return {text:JSON.stringify({imagesSeen:images.length,...r}),usage:{input:10,output:5}};
  },dispose(){}});
  // Judge reply for the current round: `p1` = candidate-oriented score when the original is shown first (candidate = B), `p2` = candidate-first (candidate = A).
  let cur=null;
  const judgeFactory=()=>({modelId:'judge-test',async prompt(text,{images}){
    clock.t+=300;
    if(/most valuable/.test(text)){
      calls.coach.push({text,images});
      if(over.coachFails)throw Error('coach down');
      return {text:JSON.stringify({improvements:over.improvements??[
        {change:'Widen the gap between the two nodes',dimension:'balance',why:'the original is more evenly spaced'},
        {change:'Enlarge the node labels',dimension:'readability',why:'text is smaller than the original at page width'},
        {change:'Move the label onto its line',dimension:'lineClarity',why:'the label floats'},
        {change:'A fourth change that must be dropped',dimension:'aesthetics',why:'only three are kept'}]}),usage:{input:5,output:5}};
    }
    if(!cur)cur=verdicts.shift()??{p1:0.6,p2:0.6};
    const candidateIsA=Buffer.from(images[0].data,'base64').toString().startsWith(hash(fs.readFileSync(job.outputPath)).slice(0,6));
    calls.judge.push({candidateIsA});
    if(over.judgeError)throw Error('judge down');
    const c=candidateIsA?cur.p2:cur.p1,score=candidateIsA?-c:c;
    if(calls.judge.length%2===0)cur=null; // both passes of this judgement are done
    return {text:JSON.stringify({scores:Object.fromEntries([...DIMS.map(d=>[d,score]),['grouping',null]]),reasons:Object.fromEntries(DIMS.map(d=>[d,'seen']))}),usage:{input:100,output:10}};
  },dispose(){}});
  const run=createV2Run(job,{deps,reviewerFactory,judgeFactory:over.noJudge?undefined:judgeFactory,judgeModel:{provider:'openai-codex',id:'judge-test',thinking:'medium'},gate:over.gate??'relaxed',now:()=>clock.t,budgets:over.budgets===undefined?undefined:{...over.budgets},reviewer:over.reviewerCfg});
  const write=text=>fs.writeFileSync(job.outputPath,text);
  const out=async()=>JSON.parse((await run.submit()).content[0].text);
  const check=async()=>JSON.parse((await run.buildCheck()).content[0].text);
  const cleanup=()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(job.runDir,{recursive:true,force:true})};
  return {job,run,clock,calls,write,out,check,cleanup};
}

import {budgetsFromEnv,DEFAULT_BUDGETS} from '../src/orchestrator.mjs';
import {composePrompt} from '../src/agent-led.mjs';

test('check cap defaults: 6 per round in both the relaxed gate and strict (cap 3 lost the 14-run A/B); env still overrides; per-run cap stays 16',()=>{
  assert.equal(budgetsFromEnv({}).maxChecksPerRound,6);
  assert.equal(budgetsFromEnv({PI_DIAGRAM_GATE:'relaxed'}).maxChecksPerRound,6);
  assert.equal(budgetsFromEnv({PI_DIAGRAM_GATE:'strict'}).maxChecksPerRound,6);
  assert.equal(budgetsFromEnv({PI_DIAGRAM_MAX_CHECKS_PER_ROUND:'3'}).maxChecksPerRound,3);
  assert.equal(budgetsFromEnv({PI_DIAGRAM_GATE:'strict',PI_DIAGRAM_MAX_CHECKS_PER_ROUND:'2'}).maxChecksPerRound,2);
  assert.equal(budgetsFromEnv({}).maxChecksPerRun,16);assert.equal(DEFAULT_BUDGETS.maxChecksPerRun,16);
  const relaxed=setup(),strict=setup({gate:'strict'});
  try{assert.equal(relaxed.run.budgets.maxChecksPerRound,6);assert.equal(strict.run.budgets.maxChecksPerRound,6);assert.equal(relaxed.run.budgets.maxChecksPerRun,16)}
  finally{relaxed.cleanup();strict.cleanup()}
});

test('author prompt states the per-round check budget it is given',()=>{
  const job={prompt:'P',runDir:'/run/x'};
  const p=composePrompt(job,{jobId:'j',v2:{maxRounds:4,maxInspectionsPerRound:3,twoPhase:true,maxChecksPerRound:6,maxChecksPerRun:16,relaxed:true}});
  assert.match(p,/at most 6 diagram_build_check calls per round/);
  assert.match(p,/Advisory findings \(severity minor\) never block/);
  const s=composePrompt(job,{jobId:'j',v2:{maxRounds:4,maxInspectionsPerRound:3,twoPhase:true,maxChecksPerRound:6,maxChecksPerRun:16,relaxed:false}});
  assert.match(s,/at most 6 diagram_build_check calls per round/);
  assert.doesNotMatch(s,/Advisory findings \(severity minor\) never block/);
});

test('relaxed: after 6 checks a candidate with only advisory findings goes to the reviewer and the Judge: no refusal, no escalation',async()=>{
  const t=setup({judge:[{p1:0.6,p2:0.6}]});try{
    let last;
    for(let i=1;i<=6;i++){t.write(svg(`FAIL:routeCrossings,routePairClearance v${i}`));last=await t.check()}
    assert.equal(last.status,'CHECK_PASS');assert.deepEqual(last.failed,[]);assert.ok(last.minorCount>0);assert.equal(last.checksLeftThisRound,0);
    assert.match(last.next,/diagram_submit/);
    t.write(svg('FAIL:routeCrossings,routePairClearance v6')); // same bytes as the last check
    const over=await t.check();
    assert.equal(over.status,'CHECK_LIMIT_REACHED');assert.doesNotMatch(over.next,/escalation/);assert.match(over.next,/advisory/i);
    const r=await t.out();
    assert.equal(r.status,'REVIEWED');
    assert.equal(t.calls.reviewer.length,1);assert.equal(t.calls.judge.length,2);
    const m=readRunManifest(t.job.runDir);
    assert.deepEqual(m.twoPhase.refusals,[]);assert.deepEqual(m.twoPhase.escalations,[]);
    assert.equal(m.twoPhase.checksTotal,6);
  }finally{t.cleanup()}
});

test('relaxed: after 6 checks, advisory-only bytes written AFTER the cap are also reviewed and judged, with no refusal and no diagnosis escalation',async()=>{
  const t=setup({judge:[{p1:0.6,p2:0.6}]});try{
    for(let i=1;i<=6;i++){t.write(svg(`FAIL:routeCrossings v${i}`));await t.check()}
    t.write(svg('FAIL:routeCrossings v4 unchecked'));
    const r=await t.out();
    assert.equal(r.status,'REVIEWED');
    const m=readRunManifest(t.job.runDir);
    assert.deepEqual(m.twoPhase.refusals,[]);assert.deepEqual(m.twoPhase.escalations,[]);
    assert.equal(t.calls.reviewer.length,1);
  }finally{t.cleanup()}
});

test('relaxed: after 6 checks a candidate with a blocking failure still follows the existing escalation path (hard rule: rejected, no reviewer)',async()=>{
  const t=setup();try{
    let last;
    for(let i=1;i<=6;i++){t.write(svg(`FAIL:relations v${i}`));last=await t.check()}
    assert.equal(last.status,'CHECK_FAIL');assert.deepEqual(last.failed,['relations']);
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.escalation.outcome,'rejected-semantic');
    assert.equal(t.calls.reviewer.length,0);assert.equal(t.calls.judge.length,0);
  }finally{t.cleanup()}
});

test('relaxed: before the cap is spent, blocking bytes are still refused',async()=>{
  const t=setup();try{
    t.write(svg('FAIL:relations'));await t.check();
    const r=await t.out();
    assert.equal(r.status,'REFUSED');assert.equal(r.code,'FAILING_BYTES');
  }finally{t.cleanup()}
});

test('strict: cap stays 6; after 3 of 6 checks failing bytes are still refused',async()=>{
  const t=setup({gate:'strict'});try{
    for(let i=1;i<=3;i++){t.write(svg(`FAIL:routeNodeIntrusion v${i}`));await t.check()}
    t.write(svg('FAIL:routeNodeIntrusion v3'));
    const r=await t.out();
    assert.equal(r.status,'REFUSED');assert.equal(r.code,'FAILING_BYTES'); // 3 of 6 used: not escalating yet
  }finally{t.cleanup()}
});

test('run.json records, per check: outcome, blocking and advisory failing rules, svgHash',async()=>{
  const t=setup({judge:[{p1:0.6,p2:0.6}]});try{
    const a=svg('FAIL:relations,routeCrossings v1'),b=svg('FAIL:routeCrossings,routePairClearance v2');
    t.write(a);await t.check();t.write(b);await t.check();
    await t.out();
    const m=readRunManifest(t.job.runDir),[c1,c2]=m.twoPhase.checks;
    assert.equal(c1.outcome,'CHECK_FAIL');assert.deepEqual(c1.failed,['relations']);assert.deepEqual(c1.advisory,['routeCrossings']);assert.equal(c1.svgHash,hash(a));
    assert.equal(c2.outcome,'CHECK_PASS');assert.deepEqual(c2.failed,[]);assert.deepEqual(c2.advisory.sort(),['routeCrossings','routePairClearance']);assert.equal(c2.svgHash,hash(b));
  }finally{t.cleanup()}
});
