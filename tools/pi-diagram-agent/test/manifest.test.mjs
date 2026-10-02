import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sealManifest,verifyManifest,writeRunManifest,readRunManifest,acceptRun} from '../src/manifest.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';
function runDir(status='REVIEWED',{svg=SVG,finalHash=hash(SVG)}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-diagram-agent-'));
  fs.writeFileSync(path.join(dir,'candidate.svg'),svg);
  const m=writeRunManifest(dir,{schema:'pi-diagram-run/2',status,sourceHash:'s'.repeat(64),finalSvgSha256:finalHash,acceptance:null});
  return {dir,m};
}

test('manifest is sealed with a self hash; any edit breaks verification',()=>{
  const m=sealManifest({a:1,status:'REVIEWED'});
  assert.match(m.selfHash,/^[0-9a-f]{64}$/);assert.equal(verifyManifest(m),true);
  assert.equal(verifyManifest({...m,status:'VALIDATED'}),false);
  assert.equal(verifyManifest({a:1}),false);
});

test('writeRunManifest writes run.json atomically and readRunManifest verifies it',()=>{
  const {dir,m}=runDir();
  try{
    assert.deepEqual(readRunManifest(dir),m);
    const onDisk=JSON.parse(fs.readFileSync(path.join(dir,'run.json'),'utf8'));
    onDisk.status='VALIDATED';fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(onDisk));
    assert.throws(()=>readRunManifest(dir),/MANIFEST_TAMPERED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('acceptRun: REVIEWED + matching hash -> VALIDATED, acceptance recorded like an adjudication',()=>{
  const {dir}=runDir();
  try{
    const r=acceptRun(dir,hash(SVG),{user:'alice',now:()=>new Date('2026-10-02T00:00:00Z')});
    assert.equal(r.status,'VALIDATED');
    const m=readRunManifest(dir);
    assert.equal(m.status,'VALIDATED');
    assert.deepEqual(m.acceptance,{authorisedBy:'alice',timestamp:'2026-10-02T00:00:00.000Z',sourceHash:'s'.repeat(64),svgSha256:hash(SVG),acceptedFrom:'REVIEWED'});
    assert.equal(verifyManifest(m),true);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('acceptRun refuses: not REVIEWED, wrong hash, candidate changed since review, tampered manifest, unsafe directory',()=>{
  for(const status of ['CANDIDATE','VALIDATED']){
    const {dir}=runDir(status);
    try{assert.throws(()=>acceptRun(dir,hash(SVG),{user:'a'}),/RUN_NOT_REVIEWED/)}finally{fs.rmSync(dir,{recursive:true,force:true})}
  }
  {const {dir}=runDir();
    try{assert.throws(()=>acceptRun(dir,'0'.repeat(64),{user:'a'}),/HASH_MISMATCH/);assert.throws(()=>acceptRun(dir,'xyz',{user:'a'}),/HASH_MISMATCH|INVALID_HASH/);assert.equal(readRunManifest(dir).status,'REVIEWED')}finally{fs.rmSync(dir,{recursive:true,force:true})}}
  {const {dir}=runDir();
    try{fs.writeFileSync(path.join(dir,'candidate.svg'),SVG+'<!-- edited -->');assert.throws(()=>acceptRun(dir,hash(SVG),{user:'a'}),/CANDIDATE_CHANGED_SINCE_REVIEW/)}finally{fs.rmSync(dir,{recursive:true,force:true})}}
  {const {dir}=runDir();
    try{const j=JSON.parse(fs.readFileSync(path.join(dir,'run.json'),'utf8'));j.finalSvgSha256='1'.repeat(64);fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(j));assert.throws(()=>acceptRun(dir,'1'.repeat(64),{user:'a'}),/MANIFEST_TAMPERED/)}finally{fs.rmSync(dir,{recursive:true,force:true})}}
  {const other=fs.mkdtempSync(path.join(os.tmpdir(),'not-a-run-'));
    try{assert.throws(()=>acceptRun(other,hash(SVG),{user:'a'}),/UNSAFE_RUN_DIRECTORY/)}finally{fs.rmSync(other,{recursive:true,force:true})}}
});

test('acceptRun: a run forged by the author (re-sealed) is rejected when the live process knows the real manifest hash',()=>{
  const {dir,m}=runDir('CANDIDATE');
  try{
    // The author rewrites run.json as a perfectly sealed REVIEWED manifest.
    writeRunManifest(dir,{schema:'pi-diagram-run/2',status:'REVIEWED',sourceHash:'s'.repeat(64),finalSvgSha256:hash(SVG),acceptance:null});
    assert.throws(()=>acceptRun(dir,hash(SVG),{user:'a',expectedSelfHash:m.selfHash}),/MANIFEST_TAMPERED/);
    assert.equal(acceptRun(dir,hash(SVG),{user:'a'}).status,'VALIDATED'); // without the in-memory record only the seal can be checked (documented limitation)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
