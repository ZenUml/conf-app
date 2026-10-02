import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareAgentTask,createAgentVisualInspector,composePrompt} from '../src/agent-led.mjs';

const rec=n=>({file:`${n}.png`,path:`/x/${n}.png`,sha256:n});
function setup(candidate){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-v2-inspect-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,'flowchart LR\n  A[Start] --> B[Finish]\n');
  const job=prepareAgentTask(input);fs.writeFileSync(job.outputPath,candidate);
  const audit={status:'FAIL',checks:{nodeIdentity:{status:'FAIL',evidence:{missing:['B'],extra:[]}},routeCrossings:{status:'FAIL',evidence:{violations:[]}},semanticPreservation:{status:'PASS'}}};
  const deps={
    original:async()=>({rendered:{originalSvgHash:'o'.repeat(64),media:{full:rec('orig')}},svgBytes:Buffer.from('<svg/>')}),
    render:async bytes=>({svgHash:'h',full:rec('full'),crops:[rec('c0'),rec('c1'),rec('c2'),rec('c3')],fullscreen:rec('fit'),containFit:{},textAudit:{}}),
    audit:async()=>audit,
    image:r=>({type:'image',data:r.sha256,mimeType:'image/png'}),
  };
  return {job,deps,cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(job.runDir,{recursive:true,force:true})}};
}
const svg=body=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`;
const body=r=>JSON.parse(r.content[0].text);

test('v2 inspect result carries early checks: forbidden constructs and missing bindings, as findings',async()=>{
  const t=setup(svg('<path stroke="context-stroke" d="M0 0"/>'));
  try{
    const inspect=createAgentVisualInspector(t.job,{deps:t.deps,earlyChecks:true});
    const r=body(await inspect());
    assert.deepEqual(r.earlyChecks.findings.map(f=>f.rule).sort(),['forbidden-construct','nodeIdentity']);
    assert.equal(r.earlyChecks.blocking,2);
    assert.ok(r.earlyChecks.findings.every(f=>f.severity==='blocking'&&f.suggestion));
    assert.equal(r.content,undefined);
  }finally{t.cleanup()}
});

test('v1 inspect result (default) has no earlyChecks field: old behaviour unchanged',async()=>{
  const t=setup(svg(''));
  try{
    const r=body(await createAgentVisualInspector(t.job,{deps:t.deps})());
    assert.equal('earlyChecks' in r,false);
    assert.ok(r.independentAudit);
  }finally{t.cleanup()}
});

test('per-round inspection cap: 3 inspections, the 4th fails with an actionable message until the round is reset',async()=>{
  const t=setup(svg(''));
  try{
    const inspect=createAgentVisualInspector(t.job,{deps:t.deps,maxInspections:3,perRound:true,earlyChecks:true});
    for(let i=0;i<3;i++)await inspect();
    await assert.rejects(()=>inspect(),/AGENT_INSPECTION_LIMIT.*diagram_submit/s);
    inspect.resetRound();
    assert.equal(body(await inspect()).round,1);
  }finally{t.cleanup()}
});

test('without perRound the cap is still a lifetime cap (v1)',async()=>{
  const t=setup(svg(''));
  try{
    const inspect=createAgentVisualInspector(t.job,{deps:t.deps,maxInspections:2});
    await inspect();await inspect();
    await assert.rejects(()=>inspect(),/AGENT_INSPECTION_LIMIT/);
    assert.equal(typeof inspect.resetRound,'function');inspect.resetRound();
    await assert.rejects(()=>inspect(),/AGENT_INSPECTION_LIMIT/); // resetRound is a no-op for a lifetime cap
  }finally{t.cleanup()}
});

test('v2 prompt: submission protocol replaces the eight-inspection stop; v1 prompt is unchanged',()=>{
  const t=setup(svg(''));
  try{
    const v1=composePrompt(t.job,{jobId:'J'}),v2=composePrompt(t.job,{jobId:'J',v2:{maxRounds:4,maxInspectionsPerRound:3}});
    assert.doesNotMatch(v1,/diagram_submit/);
    assert.match(v2,/diagram_submit/);assert.match(v2,/at most 3 diagram_inspect/);assert.match(v2,/4 submit rounds/);
    assert.match(v2,/overrides.*eight/is);assert.match(v2,/do not certify|never certify/i);
    assert.match(v2,/Visual inspection job ID: J/);
    assert.ok(v2.startsWith(v1));
  }finally{t.cleanup()}
});
