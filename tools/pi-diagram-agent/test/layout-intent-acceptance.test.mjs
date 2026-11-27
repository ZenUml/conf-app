import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeManifests,acceptRun,assertFinalLayoutIntent} from '../src/manifest.mjs';
import {acceptWithJudge,writeJudgement,judgeRunDir} from '../src/judge-run.mjs';
import {buildJudgement} from '../src/judge.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'layout-accept-'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-diagram-agent-')),manifestDir=path.join(root,'manifests');
  fs.writeFileSync(path.join(dir,'candidate.svg'),svg);fs.writeFileSync(path.join(dir,'original.svg'),svg);
  const record={schema:'pi-layout-intent/1',sourceHash:'a'.repeat(64),rulesHash:'b'.repeat(64),predecessorHash:null,reason:null,intent:{purpose:'governance is above business flow'}};
  const layoutIntent={...record,hash:hash(JSON.stringify(record))};
  const base={schema:'pi-diagram-run/3',status:'REVIEWED',sourceHash:record.sourceHash,rulesHash:record.rulesHash,originalSvgHash:hash(svg),finalSvgSha256:hash(svg),layoutIntentRequired:true,layoutIntent,finalLayoutIntentHash:layoutIntent.hash};
  const save=extra=>writeManifests(dir,{...base,...extra},{manifestDir});save({});
  const judgement=(intentHash=layoutIntent.hash)=>buildJudgement({candidateSha256:hash(svg),originalSha256:hash(svg),mode:'original',model:{id:'fake'},passes:[],merged:{dims:{},mean:0.5},thresholds:{},verdict:'IMPROVED',verdictReason:'test',extra:{layoutIntentHash:intentHash}});
  return {root,dir,manifestDir,base,save,judgement,cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true})}};
}
test('acceptance records the reviewed semantic intent and SVG together',()=>{
  const f=fixture();try{const r=acceptRun(f.dir,hash(svg),{manifestDir:f.manifestDir});assert.equal(r.acceptance.layoutIntentHash,f.base.layoutIntent.hash)}finally{f.cleanup()}
});
test('acceptance rejects missing, tampered, wrong-source and revised-but-unreviewed intent even when SVG is unchanged',()=>{
  const f=fixture();try{
    for(const [over,re] of [[{layoutIntent:null},/MISSING/],[{layoutIntent:{...f.base.layoutIntent,intent:{purpose:'edited'}}},/TAMPERED/],[{sourceHash:'c'.repeat(64)},/SOURCE_RULES_MISMATCH/],[{finalLayoutIntentHash:'d'.repeat(64)},/STALE/]]){
      f.save(over);assert.throws(()=>acceptRun(f.dir,hash(svg),{manifestDir:f.manifestDir}),re);
    }
  }finally{f.cleanup()}
});
test('a same-SVG judgement from a previous intent is rejected, including judge override',()=>{
  const f=fixture();try{writeJudgement(f.dir,f.judgement('f'.repeat(64)));
    for(const overrideJudge of [null,'I accept the score'])assert.throws(()=>acceptWithJudge(f.dir,hash(svg),{manifestDir:f.manifestDir,overrideJudge}),/JUDGEMENT_LAYOUT_INTENT_STALE/);
    writeJudgement(f.dir,f.judgement());assert.equal(acceptWithJudge(f.dir,hash(svg),{manifestDir:f.manifestDir}).status,'VALIDATED');
  }finally{f.cleanup()}
});
test('explicit Judge seals intent digest without exposing intent text to blind scoring',async()=>{
  const f=fixture();try{
    const seen=[];
    const render=async(bytes,{outPrefix})=>{const p=outPrefix+'.png';fs.writeFileSync(p,'image');return {full:{path:p},fullscreen:{path:p}}};
    const factory=async()=>({async prompt(t){seen.push(t);return {text:JSON.stringify({scores:{balance:0.5,readability:0.5,aesthetics:0.5,lineClarity:0.5,pageWidth:0.5,grouping:null},reasons:{balance:'b',readability:'r',aesthetics:'a',lineClarity:'l',pageWidth:'p'}})}},dispose(){}});
    const j=await judgeRunDir(f.dir,{manifestDir:f.manifestDir,render,factory,model:{id:'fake'}});
    assert.equal(j.layoutIntentHash,f.base.layoutIntent.hash);for(const t of seen)assert.doesNotMatch(t,/governance is above business flow/);
  }finally{f.cleanup()}
});
test('historical standalone manifests remain readable without inventing intent evidence',()=>assert.equal(assertFinalLayoutIntent({status:'REVIEWED'}),null));
