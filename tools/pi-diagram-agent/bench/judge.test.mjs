import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseJudgeArgs,resolveRunInput,runJudgeBatch} from './judge.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const svg=t=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${t}</title></svg>`;
const ORIG=svg('orig');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-judge-bench-test-'));
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
const benchDir=(name,t)=>{const d=path.join(root,name);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,`${name}-r1.candidate.svg`),svg(t));fs.writeFileSync(path.join(d,`${name}-r1.run.json`),'{}');return d};
const fixtures=path.join(root,'fixtures');fs.mkdirSync(fixtures);
for(const n of ['f1','f2'])fs.writeFileSync(path.join(fixtures,`${n}.mmd`),`flowchart LR\n  A-->B\n`);
fs.writeFileSync(path.join(fixtures,'f3.mmd'),`flowchart LR\n  subgraph G\n  A-->B\n  end\n`);

test('parseJudgeArgs: --runs takes many dirs, defaults, --vs-old, --concurrency, --out',()=>{
  const o=parseJudgeArgs(['--runs','/a','/b','--out','/o/x.jsonl','--fixtures','/f','--vs-old','/old','--concurrency','3']);
  assert.deepEqual(o.runs,['/a','/b']);assert.equal(o.concurrency,3);assert.equal(o.vsOld,'/old');assert.equal(o.out,'/o/x.jsonl');assert.equal(o.fixtures,'/f');
  assert.equal(parseJudgeArgs(['--runs','/a','--out','/o.jsonl']).concurrency,2);
  assert.throws(()=>parseJudgeArgs(['--out','/o.jsonl']),/usage/i);
  assert.throws(()=>parseJudgeArgs(['--runs','/a']),/usage/i);
  assert.throws(()=>parseJudgeArgs(['--runs','/a','--out','/o','--concurrency','0']),/concurrency/i);
  assert.throws(()=>parseJudgeArgs(['--runs','/a','--out','/o','--bogus']),/unknown/i);
});
test('resolveRunInput (bench layout): candidate bytes from *.candidate.svg, source from the fixtures dir by stem; vs-old maps by directory name',async()=>{
  const d=benchDir('f1','new');const old=path.join(root,'old'),od=path.join(old,'f1');fs.mkdirSync(od,{recursive:true});fs.writeFileSync(path.join(od,'f1-r1.candidate.svg'),svg('older'));
  const r=await resolveRunInput(d,{fixtures,vsOld:old,renderOriginal:async()=>Buffer.from(ORIG)});
  assert.equal(path.basename(r.candidatePath),'f1-r1.candidate.svg');assert.equal(r.candidate.toString(),svg('new'));
  assert.equal(r.baseline.toString(),svg('older'));assert.equal(r.mode,'vs-old');
  assert.equal(r.hasGroups,false);
  const plain=await resolveRunInput(d,{fixtures,renderOriginal:async()=>Buffer.from(ORIG)});
  assert.equal(plain.baseline.toString(),ORIG);assert.equal(plain.mode,'original');
  const g=benchDir('f3','x');assert.equal((await resolveRunInput(g,{fixtures,renderOriginal:async()=>Buffer.from(ORIG)})).hasGroups,true);
  await assert.rejects(()=>resolveRunInput(benchDir('zzz','x'),{fixtures,renderOriginal:async()=>Buffer.from(ORIG)}),/SOURCE_NOT_FOUND/);
});
const reply=v=>JSON.stringify({scores:{balance:v,readability:v,aesthetics:v,lineClarity:v,pageWidth:v,grouping:null},reasons:{balance:'b',readability:'r',aesthetics:'a',lineClarity:'l',pageWidth:'p'}});
const fakeRender=async(bytes,{outPrefix})=>{const mk=n=>{const f=`${outPrefix}.${n}.png`;fs.writeFileSync(f,Buffer.from(hash(bytes).slice(0,8)));return {path:f}};return {full:mk('full'),fullscreen:mk('fit')}};
test('runJudgeBatch: JSON lines out, one per run, offline results write nothing into the run dirs, concurrency is bounded, one failure does not stop the batch',async()=>{
  const dirs=['f1','f2','nosrc'].map((n,i)=>benchDir(n,'c'+i));
  const out=path.join(root,'out','results.jsonl');
  let inflight=0,peak=0;
  const factory=async()=>({async prompt(t,{images}){inflight++;peak=Math.max(peak,inflight);await new Promise(r=>setTimeout(r,15));inflight--;
    const candidateIsA=false;return {text:reply(0.5),usage:{input:7,output:1}}},dispose(){}});
  const lines=await runJudgeBatch({runs:dirs,fixtures,concurrency:1,out,factory,render:fakeRender,renderOriginal:async()=>Buffer.from(ORIG),model:{provider:'openai-codex',id:'m',thinking:'medium'}});
  assert.equal(lines.length,3);
  const disk=fs.readFileSync(out,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(disk.length,3);
  assert.ok(peak<=2,`peak sessions ${peak} with concurrency 1 (two passes per diagram)`);
  const byRun=Object.fromEntries(disk.map(l=>[path.basename(l.run),l]));
  assert.equal(byRun.nosrc.verdict,'ERROR');assert.match(byRun.nosrc.error,/SOURCE_NOT_FOUND/);
  assert.ok(['NOT_IMPROVED','IMPROVED'].includes(byRun.f1.verdict));assert.ok(byRun.f1.candidateSha256);assert.equal(byRun.f1.tokens.input,14);assert.ok('ms' in byRun.f1);
  for(const d of dirs)assert.equal(fs.existsSync(path.join(d,'judgement.json')),false); // offline never gates
  assert.equal(fs.statSync(path.dirname(out)).mode&0o777,0o700);
});
