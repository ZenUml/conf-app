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
  const run=createV2Run(job,{deps,reviewerFactory,judgeFactory:over.noJudge?undefined:judgeFactory,judgeModel:{provider:'openai-codex',id:'judge-test',thinking:'medium'},gate:over.gate??'relaxed',now:()=>clock.t,budgets:{...over.budgets,twoPhase:false},reviewer:over.reviewerCfg});
  const write=text=>fs.writeFileSync(job.outputPath,text);
  const out=async()=>JSON.parse((await run.submit()).content[0].text);
  const cleanup=()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(job.runDir,{recursive:true,force:true})};
  return {job,run,clock,calls,write,out,cleanup};
}

test('acceptance thresholds: in-loop default is +0.4 mean and -0.2 per dimension; env overrides them',()=>{
  assert.deepEqual(acceptThresholdsFromEnv({}),{minDim:-0.2,minMean:0.4,minPassMean:0.4});
  assert.deepEqual(acceptThresholdsFromEnv({PI_DIAGRAM_ACCEPT_MIN_MEAN:'0.3',PI_DIAGRAM_ACCEPT_MIN_DIM:'-0.1'}),{minDim:-0.1,minMean:0.3,minPassMean:0.3});
});

test('IMPROVED in both passes at the in-loop threshold gives REVIEWED, with a sealed judgement.json bound to the final hash',async()=>{
  const t=setup({judge:[{p1:0.5,p2:0.5}]});try{
    const bytes=svg('good');t.write(bytes);
    const r=await t.out();
    assert.equal(r.status,'REVIEWED');assert.equal(r.svgHash,hash(bytes));
    assert.equal(t.calls.judge.length,2);assert.equal(t.calls.coach.length,0); // identity hidden in both scoring passes; no coach call when IMPROVED
    const file=path.join(t.job.runDir,'judgement.json'),j=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(verifyManifest(j),true);assert.equal(j.schema,'pi-diagram-judgement/1');
    assert.equal(j.verdict,'IMPROVED');assert.equal(j.candidateSha256,hash(bytes));assert.equal(j.originalSha256,hash(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
    assert.deepEqual(j.thresholds,{minDim:-0.2,minMean:0.4,minPassMean:0.4});
    assert.equal(j.inLoop,true);
    assert.equal(fs.statSync(file).mode&0o777,0o600);
    const m=readRunManifest(t.job.runDir);
    assert.equal(m.status,'REVIEWED');assert.equal(m.gate,'relaxed');assert.equal(m.judge.rounds.length,1);assert.equal(m.judge.rounds[0].verdict,'IMPROVED');
    assert.equal(m.rounds[0].judgement.verdict,'IMPROVED');
    // /magic-accept keeps working unchanged
    assert.equal(verifyJudgement(t.job.runDir,hash(bytes)).verdict,'IMPROVED');
    const accepted=acceptWithJudge(t.job.runDir,hash(bytes),{expected:t.run.manifest(),cwd:process.cwd()});
    assert.equal(accepted.status,'VALIDATED');assert.equal(accepted.acceptance.judgement.verdict,'IMPROVED');
  }finally{t.cleanup()}
});

test('the judge is not run while a blocking finding remains, and not before the reviewer accepts',async()=>{
  const t=setup({judge:[{p1:0.5,p2:0.5}],replies:[{findings:[{rule:'label-ownership',severity:'blocking',elements:['A->B'],evidence:'x',measured:'m',threshold:'t',suggestion:'s'}],verdict:'revise'}]});try{
    t.write(svg('v1'));
    const r1=await t.out();
    assert.equal(r1.status,'REVISE');assert.equal(t.calls.judge.length,0);
    assert.equal(r1.judge,undefined);
    t.write(svg('v2'));
    assert.equal((await t.out()).status,'REVIEWED');assert.equal(t.calls.judge.length,2);
  }finally{t.cleanup()}
});

test('a geometry FAIL no longer blocks: advice-only audit FAILs reach the reviewer and the judge',async()=>{
  const t=setup({judge:[{p1:0.6,p2:0.6}]});try{
    t.write(svg('FAIL:routeCrossings,routePairClearance,legendCompleteness'));
    const r=await t.out();
    assert.equal(r.status,'REVIEWED');
    assert.equal(t.calls.reviewer.length,1);assert.equal(t.calls.judge.length,2);
  }finally{t.cleanup()}
});

test('one pass below the in-loop threshold (mean 0.4 but a pass at 0.2) is NOT_IMPROVED: a revise round with the judge improvements, blocking findings and the top-3 advice only',async()=>{
  const t=setup({judge:[{p1:0.6,p2:0.2},{p1:0.6,p2:0.6}]});try{
    t.write(svg('FAIL:routeCrossings,routePairClearance,routeDetour,labelFontWeight,filletUniformity'));
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.round,1);
    assert.equal(r.judge.verdict,'NOT_IMPROVED');assert.match(r.judge.reason,/PASS_MEAN_BELOW_MIN/);
    assert.equal(r.judge.improvements.length,3); // the fourth is dropped
    assert.deepEqual(Object.keys(r.judge.improvements[0]).sort(),['change','dimension','why']);
    assert.equal(t.calls.coach.length,1);
    assert.equal(t.calls.coach[0].images.length,4);
    assert.deepEqual(r.findings,[]); // nothing blocking remained
    assert.equal(r.advice.length,3);assert.equal(r.advice[0].rule,'routeCrossings');
    assert.equal(r.adviceTotal,5);assert.equal(r.minorCount,5);
    assert.equal(JSON.stringify(r).includes('filletUniformity'),false); // the full advice list is not sent
    // second round: better
    t.write(svg('v2'));
    const r2=await t.out();
    assert.equal(r2.status,'REVIEWED');
    const m=readRunManifest(t.job.runDir);
    assert.deepEqual(m.judge.rounds.map(x=>x.verdict),['NOT_IMPROVED','IMPROVED']);
  }finally{t.cleanup()}
});

test('a NOT_IMPROVED judgement is written to judgement.json too, and /magic-accept refuses it',async()=>{
  const t=setup({judge:[{p1:0.1,p2:0.1}],budgets:{maxRounds:1}});try{
    const bytes=svg('weak');t.write(bytes);
    const r=await t.out();
    assert.equal(r.status,'CANDIDATE');
    assert.throws(()=>verifyJudgement(t.job.runDir,hash(bytes)),/JUDGEMENT_NOT_IMPROVED/);
  }finally{t.cleanup()}
});

test('rounds exhausted while NOT_IMPROVED ends as CANDIDATE with reason NOT_IMPROVED; the best judged candidate is kept',async()=>{
  const t=setup({judge:[{p1:0.1,p2:0.1},{p1:0.3,p2:0.3},{p1:0.2,p2:0.2}],budgets:{maxRounds:3}});try{
    const bytes=[svg('a'),svg('b'),svg('c')];
    t.write(bytes[0]);assert.equal((await t.out()).status,'REVISE');
    t.write(bytes[1]);assert.equal((await t.out()).status,'REVISE');
    t.write(bytes[2]);
    const r=await t.out();
    assert.equal(r.status,'CANDIDATE');assert.match(r.statusReason,/^NOT_IMPROVED/);assert.match(r.statusReason,/ROUNDS_EXHAUSTED/);
    assert.equal(r.svgHash,hash(bytes[1])); // highest judge mean (0.3), restored on disk
    assert.equal(hash(fs.readFileSync(t.job.outputPath)),hash(bytes[1]));
    const m=readRunManifest(t.job.runDir);
    assert.equal(m.status,'CANDIDATE');assert.equal(m.finalSvgSha256,hash(bytes[1]));
  }finally{t.cleanup()}
});

test('best-candidate order: a judged zero-blocking candidate beats an unjudged one with the same blocking counts, by highest judge mean',async()=>{
  const t=setup({judge:[{p1:0.1,p2:0.1},{p1:0.3,p2:0.3}],budgets:{maxRounds:2}});try{
    t.write(svg('a'));await t.out();
    const b=svg('b');t.write(b);
    const r=await t.out();
    assert.equal(r.status,'CANDIDATE');assert.equal(r.svgHash,hash(b));
  }finally{t.cleanup()}
});

test('JUDGE_ERROR is never REVIEWED: the run ends as CANDIDATE like a reviewer error',async()=>{
  const t=setup({judgeError:true});try{
    t.write(svg('x'));
    const r=await t.out();
    assert.equal(r.status,'CANDIDATE');assert.match(r.statusReason,/^JUDGE_ERROR/);
    const j=JSON.parse(fs.readFileSync(path.join(t.job.runDir,'judgement.json'),'utf8'));
    assert.equal(j.verdict,'JUDGE_ERROR');
    assert.throws(()=>verifyJudgement(t.job.runDir,hash(svg('x'))),/JUDGEMENT_JUDGE_ERROR/);
    assert.equal(readRunManifest(t.job.runDir).status,'CANDIDATE');
  }finally{t.cleanup()}
});

test('a coach failure does not change the verdict: the revise message still carries the judge dimension scores',async()=>{
  const t=setup({judge:[{p1:0.1,p2:0.1}],coachFails:true});try{
    t.write(svg('x'));
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.judge.verdict,'NOT_IMPROVED');assert.deepEqual(r.judge.improvements,[]);
    assert.ok(r.judge.dimensions.balance!==undefined);
  }finally{t.cleanup()}
});

test('strict mode is unchanged: no judge, geometry FAILs block, the revise message has no advice or judge block',async()=>{
  const t=setup({gate:'strict'});try{
    t.write(svg('FAIL:routeCrossings'));
    const r=await t.out();
    assert.equal(r.status,'REVISE');assert.equal(r.findings[0].rule,'routeCrossings');assert.equal(r.findings[0].severity,'blocking');
    assert.equal(r.advice,undefined);assert.equal(r.judge,undefined);
    t.write(svg('clean'));
    const r2=await t.out();
    assert.equal(r2.status,'REVIEWED');assert.equal(t.calls.judge.length,0);
    assert.equal(fs.existsSync(path.join(t.job.runDir,'judgement.json')),false);
    assert.equal(readRunManifest(t.job.runDir).gate,'strict');
  }finally{t.cleanup()}
});

test('relaxed without a judge factory cannot accept: it reports a configuration error instead of a silent pass',()=>{
  assert.throws(()=>setup({noJudge:true}),/JUDGE_FACTORY_REQUIRED/);
});

// ---- judge units for the in-loop mode --------------------------------------------------------------------------
import {decide,mergePasses,passMean,parseCoachOutput,buildCoachPrompt,buildJudgePrompt} from '../src/judge.mjs';
const all=v=>({balance:v,readability:v,aesthetics:v,lineClarity:v,pageWidth:v,grouping:null});

test('decide with a per-pass floor: both pass means must reach the threshold even when the merged mean does',()=>{
  const merged=mergePasses(all(0.6),all(-0.2)); // pass 2 is negated: candidate scores 0.6 and 0.2 -> mean 0.4
  assert.ok(Math.abs(merged.mean-0.4)<1e-9);
  const pm=[passMean(all(0.6),1),passMean(all(-0.2),-1)];
  assert.deepEqual(pm.map(x=>Math.round(x*100)/100),[0.6,0.2]);
  assert.equal(decide(merged,{minDim:-0.2,minMean:0.4}).verdict,'IMPROVED'); // legacy rule ignores passes
  const d=decide(merged,{minDim:-0.2,minMean:0.4,minPassMean:0.4},{passMeans:pm});
  assert.equal(d.verdict,'NOT_IMPROVED');assert.match(d.reason,/PASS_MEAN_BELOW_MIN: candidate-first pass mean 0.2 < 0.4/);
  const ok=decide(mergePasses(all(0.5),all(-0.5)),{minDim:-0.2,minMean:0.4,minPassMean:0.4},{passMeans:[0.5,0.5]});
  assert.equal(ok.verdict,'IMPROVED');
});

test('coach: the prompt names the new drawing; output keeps at most 3 improvements with a valid dimension',()=>{
  const p=buildCoachPrompt({hasGroups:false,weak:['readability']});
  assert.match(p,/NEW drawing/);assert.match(p,/readability/);
  assert.doesNotMatch(buildJudgePrompt({hasGroups:false}),/NEW drawing|most valuable/); // the scoring prompt stays blind
  const out=parseCoachOutput(JSON.stringify({improvements:[{change:'a',dimension:'balance',why:'w'},{change:'b',dimension:'bogus',why:'w'},{change:'',dimension:'balance'},{change:'c',dimension:'pageWidth',why:'w'},{change:'d',dimension:'grouping',why:'w'}]}));
  assert.deepEqual(out.map(x=>x.change),['a','b','c']);assert.equal(out[1].dimension,'readability');
  assert.throws(()=>parseCoachOutput('nope'),/COACH_MALFORMED_JSON/);
  assert.throws(()=>parseCoachOutput('{"improvements":3}'),/COACH_SCHEMA/);
});
