import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareAgentTask} from '../src/agent-led.mjs';
import {createThinkingSwitch} from '../src/thinking-switch.mjs';

const mkInput=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-speed-cd-'));const input=path.join(root,'s.mmd');fs.writeFileSync(input,'flowchart LR\n A-->B\n');return {root,input}};
const fakeResult=()=>({content:[{type:'text',text:JSON.stringify({status:'VISUAL_EVIDENCE_ONLY',round:1})},{type:'image',data:'x',mimeType:'image/png'}],details:{round:1}});

test('D: direct-draft instruction appears only when requested',()=>{
  const {root,input}=mkInput();
  try{
    const on=prepareAgentTask(input,{directDraft:true}),off=prepareAgentTask(input,{directDraft:false});
    assert.match(on.prompt,/write the first candidate directly/i);
    assert.match(on.prompt,/no separate planning message/i);
    assert.match(on.prompt,/review carefully/i);
    assert.doesNotMatch(off.prompt,/write the first candidate directly/i);
    fs.rmSync(on.runDir,{recursive:true,force:true});fs.rmSync(off.runDir,{recursive:true,force:true});
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('D: default follows PI_DIAGRAM_DIRECT_DRAFT=1 and is off when unset',()=>{
  const {root,input}=mkInput();const prev=process.env.PI_DIAGRAM_DIRECT_DRAFT;
  try{
    delete process.env.PI_DIAGRAM_DIRECT_DRAFT;
    const a=prepareAgentTask(input);assert.doesNotMatch(a.prompt,/write the first candidate directly/i);
    process.env.PI_DIAGRAM_DIRECT_DRAFT='1';
    const b=prepareAgentTask(input);assert.match(b.prompt,/write the first candidate directly/i);
    for(const j of [a,b])fs.rmSync(j.runDir,{recursive:true,force:true});
  }finally{if(prev===undefined)delete process.env.PI_DIAGRAM_DIRECT_DRAFT;else process.env.PI_DIAGRAM_DIRECT_DRAFT=prev;fs.rmSync(root,{recursive:true,force:true})}
});

test('C: unset leaves thinking untouched and inspector unwrapped',async()=>{
  const calls=[];const sw=createThinkingSwitch({firstDraftLevel:undefined,setLevel:l=>calls.push(l)});
  assert.equal(sw.start(),null);
  const inner=async()=>fakeResult();
  assert.equal(sw.wrap(inner),inner);
  assert.deepEqual(calls,[]);
});

test('C: sets first-draft level at start, switches to high after first successful inspection only',async()=>{
  const calls=[];let t=1000;
  const sw=createThinkingSwitch({firstDraftLevel:'medium',setLevel:l=>calls.push(l),now:()=>t});
  assert.equal(sw.start(),'medium');assert.deepEqual(calls,['medium']);
  let fail=true;
  const inspect=sw.wrap(async()=>{if(fail)throw Error('CANDIDATE_FILE_UNAVAILABLE_OR_UNSAFE');return fakeResult()});
  t=2000;await assert.rejects(inspect(),/CANDIDATE_FILE/);
  assert.deepEqual(calls,['medium'],'failed inspection must not switch');
  fail=false;t=181000;
  const r1=await inspect();
  assert.deepEqual(calls,['medium','high']);
  assert.equal(r1.content.length,2);
  const note1=JSON.parse(r1.content[0].text).thinking;
  assert.equal(JSON.parse(r1.content[0].text).status,'VISUAL_EVIDENCE_ONLY');
  assert.deepEqual(note1,{firstDraft:'medium',revisions:'high',switchedAfterMs:180000,current:'high'});
  const r2=await inspect();
  assert.deepEqual(calls,['medium','high'],'switch happens once');
  assert.equal(JSON.parse(r2.content[0].text).thinking.current,'high');
  assert.equal(JSON.parse(r2.content[0].text).thinking.switchedAfterMs,180000);
});

test('C: invalid level is rejected',()=>{
  assert.throws(()=>createThinkingSwitch({firstDraftLevel:'turbo',setLevel(){}}),/INVALID_FIRST_DRAFT_THINKING/);
});

test('C: first-draft level equal to high is a no-op switch but still recorded',async()=>{
  const calls=[];const sw=createThinkingSwitch({firstDraftLevel:'high',setLevel:l=>calls.push(l)});
  sw.start();const r=await sw.wrap(async()=>fakeResult())();
  assert.equal(JSON.parse(r.content[0].text).thinking.firstDraft,'high');
});
