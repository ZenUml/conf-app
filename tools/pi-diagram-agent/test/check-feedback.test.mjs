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

import {composePrompt} from '../src/agent-led.mjs';

const BLOCK=['groupMembership','originalGroupParity','semanticPreservation','nodeText','relations','relationStyle','groups','sourceDefinitionConflicts','markerDrawing','labelCoversRoute','nodeIdentity','nodeShape'];
const ADVICE=['routeCrossings','routePairClearance','textContrast','filletUniformity','markerUniformity'];
const withMarker=(m,names)=>svg(m+' FAIL:'+names.join(','));

test('relaxed: a reply with 12 blocking findings lists all 12; advice is capped at 3 plus a +N more count',async()=>{
  const t=setup();
  try{
    t.write(withMarker('a',[...BLOCK,...ADVICE]));
    const r=await t.check();
    assert.equal(r.status,'CHECK_FAIL');
    assert.equal(r.findings.filter(f=>f.severity==='blocking').length,12);
    assert.equal(r.findings.length,12);assert.equal(r.omittedBlocking,0);
    assert.equal(r.advice.length,3);assert.equal(r.advisoryMore,2);
    assert.match(r.next,/\+2 more/);
  }finally{t.cleanup()}
});

test('strict: the findings cap still applies and no advisoryMore / regression fields appear',async()=>{
  const t=setup({gate:'strict'});
  try{
    t.write(withMarker('a',BLOCK));
    const r=await t.check();
    assert.equal(r.findings.length,8);assert.equal(r.omittedBlocking,4);
    assert.equal('advisoryMore' in r,false);assert.equal('regressions' in r,false);
    t.write(withMarker('b',BLOCK.slice(1)));await t.check();
    t.write(withMarker('c',BLOCK));
    const r3=await t.check();
    assert.ok(r3.findings.every(f=>!('regression' in f)));
    const log=JSON.parse(fs.readFileSync(path.join(t.job.runDir,'run.json'),'utf8')).twoPhase.checks;
    assert.ok(log.every(c=>!('regressions' in c)));
  }finally{t.cleanup()}
});

test('relaxed: a finding fixed at check 2 and broken again at check 3 is flagged REGRESSION, listed first and counted in run.json',async()=>{
  const t=setup();
  try{
    t.write(withMarker('a',['nodeText','relations','groupMembership']));
    const c1=await t.check();assert.equal(c1.regressions,undefined);
    t.write(withMarker('b',['nodeText','relations']));
    const c2=await t.check();assert.equal(c2.findings.length,2);
    t.write(withMarker('c',['nodeText','relations','groupMembership']));
    const c3=await t.check();
    assert.equal(c3.status,'CHECK_FAIL');
    assert.equal(c3.findings[0].rule,'groupMembership');
    assert.equal(c3.findings[0].regression,'REGRESSION: fixed in check #2, broken again');
    assert.equal(c3.findings.slice(1).filter(f=>f.regression).length,0);
    assert.deepEqual(c3.regressions,[{rule:'groupMembership',fixedInCheck:2}]);
    assert.match(c3.next,/REGRESSION/);
    const log=JSON.parse(fs.readFileSync(path.join(t.job.runDir,'run.json'),'utf8')).twoPhase.checks;
    assert.deepEqual(log.map(c=>c.regressions),[0,0,1]);
  }finally{t.cleanup()}
});

test('relaxed: a CHECK_PASS reply says to submit now with the svgHash',async()=>{
  const t=setup();
  try{
    t.write(withMarker('a',ADVICE));
    const r=await t.check();
    assert.equal(r.status,'CHECK_PASS');
    assert.equal(r.next,`No blocking findings. Submit now with diagram_submit (svgHash ${r.svgHash}). Do not spend more checks on advisory items.`);
  }finally{t.cleanup()}
});

test('relaxed: a repeat check on unchanged passing bytes is refused and not counted; changed bytes are checked',async()=>{
  const t=setup();
  try{
    t.write(withMarker('a',ADVICE));
    const r1=await t.check();assert.equal(r1.status,'CHECK_PASS');assert.equal(r1.checksUsedThisRound,1);
    const r2=await t.check();
    assert.equal(r2.status,'REFUSED');assert.equal(r2.code,'UNCHANGED_PASSING_BYTES');assert.equal(r2.countedAsCheck,false);
    assert.equal(r2.checksUsedThisRound,1);assert.equal(r2.checksUsedThisRun,1);
    assert.match(r2.message,/No blocking findings\. Submit now with diagram_submit/);
    assert.match(r2.message,/Do not spend more checks on advisory items/);
    t.write(withMarker('b',ADVICE));
    const r3=await t.check();assert.equal(r3.status,'CHECK_PASS');assert.equal(r3.checksUsedThisRound,2);
    const log=JSON.parse(fs.readFileSync(path.join(t.job.runDir,'run.json'),'utf8')).twoPhase;
    assert.equal(log.checks.length,2);assert.equal(log.checksTotal,2);
  }finally{t.cleanup()}
});

test('relaxed: failing bytes may be re-checked unchanged (cache hit, counted as before); strict never refuses',async()=>{
  const t=setup(),s=setup({gate:'strict'});
  try{
    t.write(withMarker('a',['nodeText']));
    await t.check();const again=await t.check();
    assert.equal(again.status,'CHECK_FAIL');assert.equal(again.cached,true);assert.equal(again.checksUsedThisRound,2);
    s.write(svg('a'));await s.check();
    const sr=await s.check();assert.equal(sr.status,'CHECK_PASS');assert.equal(sr.checksUsedThisRound,2);
  }finally{t.cleanup();s.cleanup()}
});

test('author prompt asks for a source-facts verification before the first draft and stays short',()=>{
  const job={prompt:'P',runDir:'/run/x'};
  const p=composePrompt(job,{jobId:'j',v2:{maxRounds:4,maxInspectionsPerRound:3,twoPhase:true,maxChecksPerRound:6,maxChecksPerRun:16,relaxed:true}});
  assert.match(p,/Before your first diagram_build_check, verify every node's group and every edge's endpoints and direction against the source facts/);
  assert.match(p,/diagram_submit at once/);
  const s=composePrompt(job,{jobId:'j',v2:{maxRounds:4,maxInspectionsPerRound:3,twoPhase:true,maxChecksPerRound:6,maxChecksPerRun:16,relaxed:false}});
  assert.doesNotMatch(s,/Do not spend more checks on advisory items/);
});
