import test from 'node:test';
import assert from 'node:assert/strict';
import {DIMENSIONS,buildJudgePrompt,parseJudgeOutput,mergePasses,decide,judgeThresholdsFromEnv,runJudgePass,scoreJudgement,buildJudgement,createPiJudgeFactory,resolveJudgeModel} from '../src/judge.mjs';
import {verifyManifest} from '../src/manifest.mjs';

const DIMS5=['balance','readability','aesthetics','lineClarity','pageWidth'];
const reasons=()=>Object.fromEntries(DIMS5.map(d=>[d,`${d} looks different`]));
const out=(scores,{hasGroups=false,extra={}}={})=>JSON.stringify({scores:{balance:0,readability:0,aesthetics:0,lineClarity:0,pageWidth:0,grouping:hasGroups?0:null,...scores},reasons:{...reasons(),...(hasGroups?{grouping:'groups are clear'}:{})},...extra});
const img=n=>({type:'image',data:`d${n}`,mimeType:'image/png'});
const images=[1,2,3,4].map(img);

// ---- normalisation and merge
test('merge: pass 2 is negated (candidate was A there); same sign gives the mean',()=>{
  const p1={balance:0.4,readability:0.6,aesthetics:0.3,lineClarity:0.5,pageWidth:0.7,grouping:null};
  const p2={balance:-0.2,readability:-0.4,aesthetics:-0.5,lineClarity:-0.5,pageWidth:-0.9,grouping:null}; // raw model scores in pass 2
  const m=mergePasses(p1,p2);
  assert.ok(Math.abs(m.dims.balance.score-0.3)<1e-9);assert.ok(Math.abs(m.dims.pageWidth.score-0.8)<1e-9);
  assert.equal(m.dims.balance.uncertain,false);
  assert.equal(m.dims.grouping,null);
});
test('merge: opposite signs give 0 and uncertain; 0 against >=0.3 is uncertain; 0 against <0.3 is not',()=>{
  const z={balance:0,readability:0,aesthetics:0,lineClarity:0,pageWidth:0,grouping:null};
  const m=mergePasses({...z,balance:0.5,readability:0.3,aesthetics:0.2,lineClarity:-0.1,pageWidth:0},{...z,balance:0.4/* candidate -0.4 */,readability:0,aesthetics:0,lineClarity:0.1,pageWidth:0});
  assert.deepEqual(m.dims.balance,{score:0,uncertain:true}); // +0.5 vs -0.4
  assert.deepEqual(m.dims.readability,{score:0,uncertain:true}); // +0.3 vs 0
  assert.equal(m.dims.aesthetics.uncertain,false);assert.ok(Math.abs(m.dims.aesthetics.score-0.1)<1e-9); // +0.2 vs 0
  assert.equal(m.dims.lineClarity.uncertain,false);assert.ok(Math.abs(m.dims.lineClarity.score+0.1)<1e-9); // -0.1 and -0.1 agree
});
test('merge: both passes zero is certain zero; a null grouping is excluded from the mean',()=>{
  const m=mergePasses({balance:0.5,readability:0.5,aesthetics:0.5,lineClarity:0.5,pageWidth:0.5,grouping:null},{balance:-0.5,readability:-0.5,aesthetics:-0.5,lineClarity:-0.5,pageWidth:-0.5,grouping:null});
  assert.equal(m.dims.grouping,null);assert.ok(Math.abs(m.mean-0.5)<1e-9); // mean over 5, not 6
  const g=mergePasses({balance:0.5,readability:0.5,aesthetics:0.5,lineClarity:0.5,pageWidth:0.5,grouping:0},{balance:-0.5,readability:-0.5,aesthetics:-0.5,lineClarity:-0.5,pageWidth:-0.5,grouping:0});
  assert.deepEqual(g.dims.grouping,{score:0,uncertain:false});assert.ok(Math.abs(g.mean-2.5/6)<1e-9);
});

// ---- decision
const dimsOf=(o)=>({dims:{balance:{score:0.3,uncertain:false},readability:{score:0.3,uncertain:false},aesthetics:{score:0.3,uncertain:false},lineClarity:{score:0.3,uncertain:false},pageWidth:{score:0.3,uncertain:false},grouping:null,...o},});
const mean=m=>{const v=Object.values(m.dims).filter(Boolean).map(x=>x.score);return v.reduce((a,b)=>a+b,0)/v.length};
test('decision: boundaries are inclusive at exactly -0.2 and +0.2',()=>{
  const th={minDim:-0.2,minMean:0.2};
  const at=dimsOf({balance:{score:-0.2,uncertain:false},readability:{score:0.6,uncertain:false},aesthetics:{score:0.4,uncertain:false},lineClarity:{score:0.6,uncertain:false},pageWidth:{score:0.2,uncertain:false}});
  at.mean=mean(at); // (-0.2+0.6+0.4+0.6+0.2)/5 = 0.32
  assert.equal(decide(at,th).verdict,'IMPROVED');
  const edge=dimsOf({balance:{score:0.2,uncertain:false},readability:{score:0.2,uncertain:false},aesthetics:{score:0.2,uncertain:false},lineClarity:{score:0.2,uncertain:false},pageWidth:{score:0.2,uncertain:false}});
  edge.mean=0.2;assert.equal(decide(edge,th).verdict,'IMPROVED');
  edge.mean=0.19999;assert.equal(decide(edge,th).verdict,'NOT_IMPROVED');
});
test('decision: one dimension below -0.2 is NOT_IMPROVED and names it; a low mean is named too',()=>{
  const th={minDim:-0.2,minMean:0.2};
  const low=dimsOf({lineClarity:{score:-0.25,uncertain:false},balance:{score:1,uncertain:false},readability:{score:1,uncertain:false},aesthetics:{score:1,uncertain:false},pageWidth:{score:1,uncertain:false}});
  low.mean=mean(low);
  const d=decide(low,th);assert.equal(d.verdict,'NOT_IMPROVED');assert.match(d.reason,/lineClarity/);assert.match(d.reason,/-0\.25/);
  const flat=dimsOf({balance:{score:0.1,uncertain:false},readability:{score:0.1,uncertain:false},aesthetics:{score:0.1,uncertain:false},lineClarity:{score:0.1,uncertain:false},pageWidth:{score:0.1,uncertain:false}});flat.mean=0.1;
  const f=decide(flat,th);assert.equal(f.verdict,'NOT_IMPROVED');assert.match(f.reason,/mean/i);
});
test('decision: more than half of the scored dimensions uncertain is NOT_IMPROVED with reason UNSTABLE',()=>{
  const th={minDim:-0.2,minMean:0.2};
  const U={score:0,uncertain:true},C={score:0.9,uncertain:false};
  const three=dimsOf({balance:U,readability:U,aesthetics:U,lineClarity:C,pageWidth:C});three.mean=mean(three);
  assert.match(decide(three,th).reason,/UNSTABLE/);assert.equal(decide(three,th).verdict,'NOT_IMPROVED');
  const two=dimsOf({balance:U,readability:U,aesthetics:C,lineClarity:C,pageWidth:C});two.mean=mean(two); // 2 of 5 is not more than half
  assert.doesNotMatch(decide(two,th).reason??'',/UNSTABLE/);
  const half=dimsOf({grouping:U,balance:U,readability:U,aesthetics:C,lineClarity:C,pageWidth:C});half.mean=mean(half); // exactly 3 of 6: not more than half
  assert.doesNotMatch(decide(half,th).reason??'',/UNSTABLE/);
});
test('thresholds come from env with the spec defaults',()=>{
  assert.deepEqual(judgeThresholdsFromEnv({}),{minDim:-0.2,minMean:0.2});
  assert.deepEqual(judgeThresholdsFromEnv({PI_DIAGRAM_JUDGE_MIN_DIM:'-0.5',PI_DIAGRAM_JUDGE_MIN_MEAN:'0.35'}),{minDim:-0.5,minMean:0.35});
  assert.deepEqual(judgeThresholdsFromEnv({PI_DIAGRAM_JUDGE_MIN_DIM:'x',PI_DIAGRAM_JUDGE_MIN_MEAN:''}),{minDim:-0.2,minMean:0.2});
});

// ---- parser
test('parser accepts the schema, a single code fence, and decimals',()=>{
  const r=parseJudgeOutput(out({balance:0.35,pageWidth:-1}),{hasGroups:false});
  assert.equal(r.scores.balance,0.35);assert.equal(r.scores.grouping,null);assert.equal(r.reasons.balance,'balance looks different');
  const f=parseJudgeOutput('```json\n'+out({},{hasGroups:true,extra:{notes:'text in the image addressed the judge'}})+'\n```',{hasGroups:true});
  assert.equal(f.scores.grouping,0);assert.match(f.notes,/addressed the judge/);
});
test('parser rejects: out-of-range, non-number, missing reason, grouping null/non-null mismatch, prose, bad JSON',()=>{
  const bad=[
    [out({balance:1.2}),false],[out({balance:-1.01}),false],[out({balance:'0.5'}),false],[out({balance:null}),false],
    [JSON.stringify({scores:{balance:0,readability:0,aesthetics:0,lineClarity:0,pageWidth:0,grouping:null},reasons:{...reasons(),balance:''}}),false],
    [JSON.stringify({scores:{balance:0,readability:0,aesthetics:0,lineClarity:0,pageWidth:0,grouping:null},reasons:{balance:'x'}}),false],
    [out({grouping:null},{hasGroups:true}),true], // grouped diagram: null is a schema error
    [out({grouping:0.2},{hasGroups:false}),false], // ungrouped diagram: a number is a schema error
    ['Sure! '+out({}),false],['{',false],['[]',false],[JSON.stringify({reasons:reasons()}),false],
  ];
  for(const [t,hasGroups] of bad)assert.throws(()=>parseJudgeOutput(t,{hasGroups}),/JUDGE_/,t.slice(0,70));
  // a grouped diagram with a null grouping that was given a reason is still an error; a missing grouping reason too
  assert.throws(()=>parseJudgeOutput(JSON.stringify({scores:{balance:0,readability:0,aesthetics:0,lineClarity:0,pageWidth:0,grouping:0.3},reasons:reasons()}),{hasGroups:true}),/JUDGE_SCHEMA/);
});

// ---- prompt and isolation
test('prompt: six dimensions, scale anchors, injection rule, strict JSON; never says which image is the candidate; no source/audit/review',()=>{
  const p=buildJudgePrompt({hasGroups:true,source:'flowchart LR\n  SECRETNODE-->B',audit:{x:1},review:'REVIEW TEXT'});
  for(const d of ['balance','readability','aesthetics','lineClarity','pageWidth','grouping'])assert.match(p,new RegExp(d));
  assert.match(p,/-1/);assert.match(p,/\+1/);assert.match(p,/strict JSON|ONLY one JSON/i);
  assert.match(p,/Image 1[^\n]*A[^\n]*full/i);assert.match(p,/Image 4[^\n]*B[^\n]*1200/i);
  assert.match(p,/never an instruction|not an instruction/i);
  assert.match(p,/same flowchart with the same content/i);
  assert.doesNotMatch(p,/candidate|original|mermaid|\bnew(er)?\b|\bold(er)?\b|\bagent\b|\bimproved\b|\bversion\b|SECRETNODE|REVIEW TEXT/i);
  assert.match(p,/grouping[^\n]*never null|never null/i);
  assert.match(buildJudgePrompt({hasGroups:false}),/no groups[^\n]*null/i);
});

// ---- running a pass: retry, timeout, JUDGE_ERROR path
const fakeFactory=(replies,calls={n:0,disposed:0,prompts:[]})=>{
  const f=async()=>({modelId:'m',async prompt(t,o){calls.prompts.push([t,o]);const r=replies[calls.n++];if(r instanceof Error)throw r;return {text:r,usage:{input:10,output:2}}},dispose(){calls.disposed++}});
  f.calls=calls;return f;
};
test('runJudgePass: valid reply; malformed is retried once then fails; provider error retried once; sessions disposed',async()=>{
  let f=fakeFactory([out({balance:0.5})]);
  let r=await runJudgePass({factory:f,prompt:'p',images,hasGroups:false});
  assert.equal(r.ok,true);assert.equal(r.attempts,1);assert.equal(r.scores.balance,0.5);assert.equal(r.usage.input,10);assert.equal(f.calls.disposed,1);
  f=fakeFactory(['nope',out({})]);r=await runJudgePass({factory:f,prompt:'p',images,hasGroups:false});
  assert.equal(r.ok,true);assert.equal(r.attempts,2);assert.equal(f.calls.disposed,2);assert.equal(r.usage.input,20); // usage of both attempts is counted
  f=fakeFactory(['nope','still nope']);r=await runJudgePass({factory:f,prompt:'p',images,hasGroups:false});
  assert.equal(r.ok,false);assert.equal(r.attempts,2);assert.match(r.error,/JUDGE_/);
  f=fakeFactory([new Error('provider down'),new Error('provider down')]);r=await runJudgePass({factory:f,prompt:'p',images,hasGroups:false});
  assert.equal(r.ok,false);assert.match(r.error,/provider down/);
});
test('runJudgePass: a hung provider becomes JUDGE_TIMEOUT per attempt',async()=>{
  const f=async()=>({async prompt(){return new Promise(()=>{})},dispose(){}});
  const r=await runJudgePass({factory:f,prompt:'p',images,hasGroups:false,timeoutMs:20});
  assert.equal(r.ok,false);assert.match(r.error,/JUDGE_TIMEOUT/);assert.equal(r.attempts,2);
});

// ---- scoreJudgement: two passes with swapped order, merge, verdict
const common={hasGroups:false,thresholds:{minDim:-0.2,minMean:0.2},now:()=>new Date('2026-10-03T00:00:00Z')};
const sets={originalFirst:[img('oF'),img('oP'),img('cF'),img('cP')],candidateFirst:[img('cF'),img('cP'),img('oF'),img('oP')]};
// The factory sees the images; the reply depends on which order it was given (A = first image).
const orderAware=(candidateScore)=>async()=>({async prompt(_t,{images}){
  const candidateIsA=images[0].data==='dcF';
  const v=candidateIsA?-candidateScore:candidateScore; // model score is B-vs-A
  return {text:out({balance:v,readability:v,aesthetics:v,lineClarity:v,pageWidth:v}),usage:{input:5,output:1}};
},dispose(){}});
test('scoreJudgement: passes use opposite orders; a consistent winner is IMPROVED; the candidate is never named in the prompt',async()=>{
  const seen=[];
  const factory=async()=>({async prompt(t,o){seen.push([t,o.images.map(i=>i.data)]);return orderAware(0.6)().then(s=>s.prompt(t,o))},dispose(){}});
  const r=await scoreJudgement({factory,imageSets:sets,...common});
  assert.equal(r.verdict,'IMPROVED');assert.ok(Math.abs(r.mean-0.6)<1e-9);
  assert.deepEqual(seen.map(s=>s[1][0]).sort(),['dcF','doF']);
  assert.equal(seen[0][0],seen[1][0]); // identical prompt text in both passes
  assert.equal(r.passes.length,2);assert.equal(r.passes[0].candidateIs,'B');assert.equal(r.passes[1].candidateIs,'A');
});
test('scoreJudgement: position bias cancels (a model that always prefers B scores about 0 and is not IMPROVED)',async()=>{
  const alwaysB=async()=>({async prompt(){return {text:out({balance:0.6,readability:0.6,aesthetics:0.6,lineClarity:0.6,pageWidth:0.6}),usage:{}}},dispose(){}});
  const r=await scoreJudgement({factory:alwaysB,imageSets:sets,...common});
  assert.equal(r.verdict,'NOT_IMPROVED');assert.match(r.verdictReason,/UNSTABLE/);
});
test('scoreJudgement: a pass that still fails after its retry makes JUDGE_ERROR, never IMPROVED',async()=>{
  const factory=async()=>({async prompt(_t,{images}){if(images[0].data==='doF')return {text:out({balance:0.9,readability:0.9,aesthetics:0.9,lineClarity:0.9,pageWidth:0.9}),usage:{}};return {text:'garbage',usage:{}}},dispose(){}});
  const r=await scoreJudgement({factory,imageSets:sets,...common});
  assert.equal(r.verdict,'JUDGE_ERROR');assert.match(r.verdictReason,/JUDGE_/);
});

// ---- judgement record
test('buildJudgement: sealed record with the spec fields, bound to both hashes',()=>{
  const j=buildJudgement({candidateSha256:'c'.repeat(64),originalSha256:'o'.repeat(64),mode:'original',model:{provider:'openai-codex',id:'gpt-x',thinking:'medium'},
    passes:[{order:'original-first',candidateIs:'B',ok:true,scores:{},reasons:{},notes:'',ms:5,usage:{input:1}},{order:'candidate-first',candidateIs:'A',ok:true,scores:{},reasons:{},notes:'',ms:6,usage:{input:1}}],
    merged:{dims:{balance:{score:0.5,uncertain:false},grouping:null},mean:0.5},thresholds:{minDim:-0.2,minMean:0.2},verdict:'IMPROVED',verdictReason:'ok',now:()=>new Date('2026-10-03T00:00:00Z')});
  assert.equal(j.schema,'pi-diagram-judgement/1');assert.equal(j.candidateSha256,'c'.repeat(64));assert.equal(j.originalSha256,'o'.repeat(64));
  assert.equal(j.mode,'original');assert.equal(j.createdAt,'2026-10-03T00:00:00.000Z');
  for(const k of ['model','passes','merged','mean','thresholds','verdict','verdictReason','selfHash'])assert.ok(k in j,k);
  assert.equal(verifyManifest(j),true);assert.equal(verifyManifest({...j,verdict:'NOT_IMPROVED'}),false);
});

// ---- model and session factory
test('resolveJudgeModel: defaults to the reviewer model; PI_DIAGRAM_JUDGE_MODEL overrides; fallback is the native author model, never another provider',()=>{
  const avail=[{provider:'openai-codex',id:'gpt-6.1-sol',input:['text','image']},{provider:'openai-codex',id:'gpt-j',input:['text','image']},{provider:'openrouter',id:'gpt-j',input:['text','image']}];
  assert.equal(resolveJudgeModel({available:avail,env:{}}).id,'gpt-6.1-sol');
  assert.equal(resolveJudgeModel({available:avail,env:{PI_DIAGRAM_JUDGE_MODEL:'gpt-j'}}).id,'gpt-j');
  assert.equal(resolveJudgeModel({available:avail,env:{PI_DIAGRAM_JUDGE_MODEL:'gpt-j'}}).provider,'openai-codex');
  const fb=resolveJudgeModel({available:[],authorModel:{provider:'openai-codex',id:'author'},env:{}});assert.equal(fb.id,'author');assert.ok(fb.fallback);
});
test('createPiJudgeFactory: noTools all, fresh empty temp cwd, judge system prompt, thinking default medium and env-overridable',async()=>{
  const calls={};
  const sdk={getAgentDir:()=>'/a',SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{constructor(o){calls.loader=o}async reload(){}},ModelRuntime:{create:async()=>({getModel:(p,id)=>({provider:p,id})})},
    createAgentSession:async o=>{calls.create=o;return {session:{messages:[],getLastAssistantText:()=>'',prompt:async()=>{},dispose(){}}}}};
  const prev=process.env.PI_DIAGRAM_JUDGE_THINKING;delete process.env.PI_DIAGRAM_JUDGE_THINKING;
  try{
    const fs=await import('node:fs');
    await createPiJudgeFactory(sdk,{provider:'openai-codex',modelId:'m'})();
    assert.equal(calls.create.noTools,'all');assert.equal(calls.create.thinkingLevel,'medium');
    assert.deepEqual(fs.readdirSync(calls.create.cwd),[]);assert.equal(calls.create.cwd,calls.loader.cwd);
    assert.match(calls.loader.systemPromptOverride(),/visual judge/i);assert.doesNotMatch(calls.loader.systemPromptOverride(),/reviewer/i);
    fs.rmSync(calls.create.cwd,{recursive:true,force:true});
    process.env.PI_DIAGRAM_JUDGE_THINKING='high';
    await createPiJudgeFactory(sdk,{provider:'openai-codex',modelId:'m'})();assert.equal(calls.create.thinkingLevel,'high');
    fs.rmSync(calls.create.cwd,{recursive:true,force:true});
  }finally{if(prev===undefined)delete process.env.PI_DIAGRAM_JUDGE_THINKING;else process.env.PI_DIAGRAM_JUDGE_THINKING=prev}
});
