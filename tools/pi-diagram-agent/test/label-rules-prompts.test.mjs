import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareAgentTask} from '../src/agent-led.mjs';
import {buildReviewerPrompt} from '../src/reviewer.mjs';
import {specModeParagraph} from '../src/spec-tool.mjs';

const prepare=(source,env={})=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-label-prompt-'));
  const input=path.join(root,'source.mmd');fs.writeFileSync(input,source);
  const before={};for(const k of Object.keys(env)){before[k]=process.env[k];process.env[k]=env[k]}
  try{const job=prepareAgentTask(input);fs.rmSync(job.runDir,{recursive:true,force:true});return job}
  finally{for(const k of Object.keys(env)){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k]}fs.rmSync(root,{recursive:true,force:true})}
};
const relations=n=>'flowchart LR\n'+Array.from({length:n},(_,i)=>`  S${i}[N] --> T${i}[N]\n`).join('');
const auditStub={};const geometryStub={units:'u',canvas:{w:100,h:100},nodes:[],groups:[],labels:[],routes:[]};
const reviewer=(edges,extra={})=>buildReviewerPrompt({facts:{nodes:[],edges:Array.from({length:edges},()=>({style:'solid'})),groups:[]},audit:auditStub,geometry:geometryStub,imageLabels:[],...extra});

test('author prompt: dense-diagram rule (R1) with the threshold, the do-not-chase-zero direction and this job\'s relation count',()=>{
  const sparse=prepare(relations(3)).prompt,dense=prepare(relations(20)).prompt;
  for(const p of [sparse,dense]){
    assert.match(p,/at or above 20 source relations/i);
    assert.match(p,/minimi[sz]e crossings with port order and lanes[^.]*do not chase zero/i);
    assert.match(p,/PI_DIAGRAM_DENSE_RELATIONS/);
  }
  assert.match(dense,/This source has 20 relations: dense \(dense: 20 relations >= 20\)/);
  assert.match(sparse,/This source has 3 relations: not dense/);
  assert.match(prepare(relations(10),{PI_DIAGRAM_DENSE_RELATIONS:'10'}).prompt,/This source has 10 relations: dense \(dense: 10 relations >= 10\)/);
});

test('author prompt: edge-label rules (R2, R3, R4) and the placement priority',()=>{
  const p=prepare(relations(2)).prompt;
  assert.match(p,/fewer than 4 words[^.]*on its own route, centred on a straight segment/i);
  assert.match(p,/vertical or mostly vertical route[^.]*drawn vertically[^.]*rotated -90 degrees[^.]*bottom to top/i);
  assert.match(p,/no border[^.]*no stroke/i);
  assert.match(p,/opaque (background|fill)[^.]*canvas/i);
  assert.match(p,/never hides another route/i);
  assert.match(p,/never push the label away from its route/i);
  assert.match(p,/widen the gap, spread the ports/i);
});

test('the pinned rules text carries the dense paragraph and the new rule 11',()=>{
  const p=prepare(relations(2)).prompt;
  assert.match(p,/\*\*Dense diagrams\.\*\*/);
  assert.match(p,/\n11\. Edge labels\./);
});

test('reviewer prompt: dense diagrams (R1) never report crossings as blocking, and the diagram\'s own state is stated',()=>{
  const dense=reviewer(20),sparse=reviewer(3);
  for(const t of [dense,sparse])assert.match(t,/at or above 20 (source )?relations[^.]*do not report (route )?crossings as blocking/i);
  assert.match(dense,/This diagram has 20 relations: dense \(dense: 20 relations >= 20\)/);
  assert.match(sparse,/This diagram has 3 relations: not dense/);
});

test('reviewer prompt: short labels on the line, vertical labels, no border, background (R2, R3) as judgement not measurement',()=>{
  const t=reviewer(3);
  assert.match(t,/fewer than 4 words[^.]*on its own route[^.]*centred/i);
  assert.match(t,/vertical or mostly vertical route[^.]*vertical[^.]*bottom to top/i);
  assert.match(t,/no border[^.]*opaque background/i);
  assert.match(t,/as far as possible|judge/i);
  assert.match(t,/label background never hides another route/i);
});

test('spec schema text documents label.vertical',()=>{
  const t=specModeParagraph({runDir:'/tmp/run',jobId:'job'});
  assert.match(t,/label\?: \{text, x, y, vertical\?: boolean\}/);
  assert.match(t,/vertical[^.]*rotated -90 degrees around the centre[^.]*bottom to top/i);
  assert.match(t,/fewer than 4 words[^.]*on its own route/i);
  assert.match(t,/no border/i);
});
