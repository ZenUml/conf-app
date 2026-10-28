import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeRunManifest,readRunManifest,verifyManifest} from '../src/manifest.mjs';
import {judgeRunDir,judgeSvgs,verifyJudgement,acceptWithJudge,writeJudgement,hasGroupsFromOriginalSvg,findOriginalSvg} from '../src/judge-run.mjs';
import {buildJudgement} from '../src/judge.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const CAND='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>cand</title></svg>';
const ORIG_PLAIN='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g class="node"/></svg>';
const ORIG_GROUPED='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g class="cluster" id="subGraph0"/><g class="node"/></svg>';
const MDIR=fs.mkdtempSync(path.join(os.tmpdir(),'pi-judge-manifests-test-'));
process.env.PI_DIAGRAM_MANIFEST_DIR=MDIR;
process.on('exit',()=>fs.rmSync(MDIR,{recursive:true,force:true}));
const tmp=[];process.on('exit',()=>tmp.forEach(d=>fs.rmSync(d,{recursive:true,force:true})));
function runDir({status='REVIEWED',orig=ORIG_PLAIN,cand=CAND}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-diagram-agent-'));tmp.push(dir);
  fs.writeFileSync(path.join(dir,'candidate.svg'),cand);
  fs.writeFileSync(path.join(dir,'source.original.abc.svg'),orig);
  const m=writeRunManifest(dir,{schema:'pi-diagram-run/2',status,sourceHash:'s'.repeat(64),finalSvgSha256:hash(cand),originalSvgHash:hash(orig),acceptance:null});
  fs.writeFileSync(path.join(MDIR,path.basename(dir)+'.json'),JSON.stringify(m,null,2),{mode:0o600});
  return dir;
}
// A fake renderer: writes one PNG per call so the judge can read the files it is told about.
const fakeRender=(log=[])=>async(bytes,{outPrefix})=>{
  log.push(hash(bytes));
  const mk=n=>{const f=`${outPrefix}.${n}.png`;fs.writeFileSync(f,Buffer.from(`${hash(bytes).slice(0,6)}-${n}`));return {path:f,file:path.basename(f)}};
  return {full:mk('full'),fullscreen:mk('fit'),crops:[],natural:{w:10,h:10}};
};
const good=(v,hasGroups=false)=>JSON.stringify({scores:{balance:v,readability:v,aesthetics:v,lineClarity:v,pageWidth:v,grouping:hasGroups?v:null},reasons:{balance:'b',readability:'r',aesthetics:'a',lineClarity:'l',pageWidth:'p',...(hasGroups?{grouping:'g'}:{})}});
// The candidate image is recognisable by its file bytes; the reply is the candidate's score signed for its position.
const factoryFor=(candScore,{hasGroups=false,seen=[]}={})=>async()=>({modelId:'fake',async prompt(t,{images}){
  seen.push({t,images});
  const first=Buffer.from(images[0].data,'base64').toString();
  const candidateIsA=first.startsWith(hash(Buffer.from(CAND)).slice(0,6));
  return {text:good(candidateIsA?-candScore:candScore,hasGroups),usage:{input:100,output:10}};
},dispose(){}});
const model={provider:'openai-codex',id:'fake',thinking:'medium'};

test('hasGroupsFromOriginalSvg and findOriginalSvg (hash-bound lookup in the run directory)',()=>{
  assert.equal(hasGroupsFromOriginalSvg(Buffer.from(ORIG_GROUPED)),true);assert.equal(hasGroupsFromOriginalSvg(Buffer.from(ORIG_PLAIN)),false);
  const dir=runDir();
  assert.equal(path.basename(findOriginalSvg(dir,hash(ORIG_PLAIN)).file),'source.original.abc.svg');
  assert.equal(findOriginalSvg(dir,'f'.repeat(64)),null);
});

test('judgeRunDir: loads the run, renders both SVGs, scores two passes, writes a sealed judgement.json bound to the candidate hash',async()=>{
  const dir=runDir();const rendered=[];const seen=[];
  const j=await judgeRunDir(dir,{factory:factoryFor(0.6,{seen}),render:fakeRender(rendered),model});
  assert.equal(j.verdict,'IMPROVED');assert.equal(j.mode,'original');
  assert.equal(j.candidateSha256,hash(CAND));assert.equal(j.originalSha256,hash(ORIG_PLAIN));
  assert.deepEqual(rendered.sort(),[hash(CAND),hash(ORIG_PLAIN)].sort());
  assert.equal(seen.length,2);for(const s of seen)assert.equal(s.images.length,4);
  const file=path.join(dir,'judgement.json');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const onDisk=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(verifyManifest(onDisk),true);assert.equal(onDisk.selfHash,j.selfHash);
  assert.equal(j.model.id,'fake');assert.equal(j.passes[0].usage.input,100);
});
test('judgeRunDir: the prompt carries no source text, audit, review or file names; the model sees only four images',async()=>{
  const dir=runDir();const seen=[];
  await judgeRunDir(dir,{factory:factoryFor(0.6,{seen}),render:fakeRender(),model});
  for(const s of seen){assert.doesNotMatch(s.t,/candidate|original|pi-diagram-agent|source\.original|REVIEWED/i);assert.equal(s.images.every(i=>i.type==='image'&&i.mimeType==='image/png'),true)}
});
test('judgeRunDir: a grouped original makes grouping a scored dimension; an ungrouped one makes it null',async()=>{
  const g=runDir({orig:ORIG_GROUPED});
  const jg=await judgeRunDir(g,{factory:factoryFor(0.6,{hasGroups:true}),render:fakeRender(),model});
  assert.equal(jg.merged.dims.grouping.score>0.5,true);
  const p=runDir();const jp=await judgeRunDir(p,{factory:factoryFor(0.6),render:fakeRender(),model});
  assert.equal(jp.merged.dims.grouping,null);
});
test('judgeRunDir refuses when candidate.svg no longer matches the manifest, or the original render is missing',async()=>{
  const dir=runDir();fs.writeFileSync(path.join(dir,'candidate.svg'),CAND+' ');
  await assert.rejects(()=>judgeRunDir(dir,{factory:factoryFor(0.6),render:fakeRender(),model}),/CANDIDATE_CHANGED/);
  const d2=runDir();fs.rmSync(path.join(d2,'source.original.abc.svg'));
  await assert.rejects(()=>judgeRunDir(d2,{factory:factoryFor(0.6),render:fakeRender(),model}),/ORIGINAL_RENDER_UNAVAILABLE/);
});
test('judgeRunDir vs-old: compares the final SVG of another run instead of the original',async()=>{
  const OLD='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>old</title></svg>';
  const dir=runDir(),old=runDir({cand:OLD});const rendered=[];
  const j=await judgeRunDir(dir,{vsOld:old,factory:async()=>({async prompt(){return {text:good(0.5),usage:{}}},dispose(){}}),render:fakeRender(rendered),model});
  assert.equal(j.mode,'vs-old');assert.equal(j.originalSha256,hash(OLD));assert.equal(j.candidateSha256,hash(CAND));
  assert.ok(rendered.includes(hash(OLD)));assert.ok(!rendered.includes(hash(ORIG_PLAIN)));
});
test('judgeSvgs (offline files, no run manifest): returns a judgement and writes nothing into the run',async()=>{
  const j=await judgeSvgs({candidate:Buffer.from(CAND),baseline:Buffer.from(ORIG_PLAIN),hasGroups:false,factory:factoryFor(0.7),render:fakeRender(),model});
  assert.equal(j.verdict,'IMPROVED');assert.equal(j.candidateSha256,hash(CAND));
});
test('a JUDGE_ERROR run is recorded, not thrown',async()=>{
  const dir=runDir();
  const j=await judgeRunDir(dir,{factory:async()=>({async prompt(){return {text:'nope',usage:{}}},dispose(){}}),render:fakeRender(),model});
  assert.equal(j.verdict,'JUDGE_ERROR');assert.equal(verifyManifest(JSON.parse(fs.readFileSync(path.join(dir,'judgement.json'),'utf8'))),true);
});

// ---- acceptance
const record=(dir,over={})=>{
  const j=buildJudgement({candidateSha256:hash(CAND),originalSha256:hash(ORIG_PLAIN),mode:'original',model,passes:[],merged:{dims:{balance:{score:0.5,uncertain:false},grouping:null},mean:0.5},thresholds:{minDim:-0.2,minMean:0.2},verdict:'IMPROVED',verdictReason:'ok',...over});
  writeJudgement(dir,j);return j;
};
const user={user:'alice',now:()=>new Date('2026-10-03T00:00:00Z')};
test('acceptWithJudge: a fresh IMPROVED judgement accepts and the acceptance record names it',()=>{
  const dir=runDir();const j=record(dir);
  const r=acceptWithJudge(dir,hash(CAND),user);
  assert.equal(r.status,'VALIDATED');
  const m=readRunManifest(dir);assert.equal(m.acceptance.judgement.verdict,'IMPROVED');assert.equal(m.acceptance.judgement.selfHash,j.selfHash);assert.equal(m.acceptance.judgeOverride,undefined);
});
test('acceptWithJudge refuses: missing, NOT_IMPROVED, JUDGE_ERROR, stale, tampered',()=>{
  const cases={
    missing:[d=>{},/JUDGMENT_MISSING|JUDGEMENT_MISSING/],
    notImproved:[d=>record(d,{verdict:'NOT_IMPROVED',verdictReason:'mean 0.1 < 0.2'}),/JUDGEMENT_NOT_IMPROVED/],
    judgeError:[d=>record(d,{verdict:'JUDGE_ERROR',verdictReason:'JUDGE_TIMEOUT'}),/JUDGEMENT_JUDGE_ERROR/],
    stale:[d=>record(d,{candidateSha256:'9'.repeat(64)}),/JUDGEMENT_STALE/],
    tampered:[d=>{record(d);const f=path.join(d,'judgement.json');const o=JSON.parse(fs.readFileSync(f,'utf8'));o.verdict='IMPROVED';o.mean=0.99;fs.writeFileSync(f,JSON.stringify(o))},/JUDGEMENT_TAMPERED/],
    garbage:[d=>fs.writeFileSync(path.join(d,'judgement.json'),'{nope'),/JUDGEMENT_TAMPERED/],
  };
  for(const [name,[setup,re]] of Object.entries(cases)){
    const dir=runDir();setup(dir);
    assert.throws(()=>acceptWithJudge(dir,hash(CAND),user),re,name);
    assert.equal(readRunManifest(dir).status,'REVIEWED',`${name}: the run must stay REVIEWED`);
  }
});
test('acceptWithJudge --override-judge accepts and records the reason; an empty reason does not',()=>{
  for(const setup of [()=>{},d=>record(d,{verdict:'NOT_IMPROVED',verdictReason:'mean 0.1 < 0.2'}),d=>record(d,{candidateSha256:'9'.repeat(64)})]){
    const dir=runDir();setup(dir);
    assert.throws(()=>acceptWithJudge(dir,hash(CAND),{...user,overrideJudge:'  '}),/OVERRIDE_REASON/);
    const r=acceptWithJudge(dir,hash(CAND),{...user,overrideJudge:'customer approved this layout'});
    assert.equal(r.status,'VALIDATED');
    const a=readRunManifest(dir).acceptance;
    assert.equal(a.judgeOverride.reason,'customer approved this layout');assert.ok(a.judgeOverride.judgementState);
  }
});
test('acceptWithJudge keeps the existing refusals (hash mismatch) and --waive behaviour',()=>{
  const dir=runDir();record(dir);
  assert.throws(()=>acceptWithJudge(dir,'a'.repeat(64),user),/HASH_MISMATCH/);
  assert.throws(()=>acceptWithJudge(dir,hash(CAND),{...user,waived:['x']}),/WAIVER_NOT_GRANTED/);
});
test('verifyJudgement returns the verified judgement for IMPROVED',()=>{
  const dir=runDir();const j=record(dir);
  assert.equal(verifyJudgement(dir,hash(CAND)).selfHash,j.selfHash);
});
