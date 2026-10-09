import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseMermaid} from '../src/parser.mjs';
import {validateLayoutIntent,hashLayoutIntent} from '../src/layout-intent.mjs';
import {prepareAgentTask} from '../src/agent-led.mjs';
import {createV2Run} from '../src/orchestrator.mjs';
import {buildReviewerPrompt} from '../src/reviewer.mjs';
const source='flowchart LR\nsubgraph G[Group]\n A[start]\nend\n A --> B[end]\n';
const model=parseMermaid(source);
const plan=()=>({purpose:'Explain handoff',readingOrder:'Left to right',layoutGrammar:'Two source-specific stages with group retained',nodes:model.nodes.map(n=>({id:n.id,role:n.id==='A'?'origin':'result',layer:n.id==='A'?'start':'finish',peers:[],groupPath:n.groupPath})),relations:model.edges.map(({id,source,target})=>({id,source,target})),constraints:[{priority:'hard',reason:'Source containment',description:'Retain source groups and direction',nodeIds:['A','B']},{priority:'soft',reason:'Reading flow',description:'Prefer horizontal placement',nodeIds:['A','B']}],uncertainties:[]});
test('semantic plan requires exact source coverage, membership and relations',()=>{
 assert.deepEqual(validateLayoutIntent(plan(),model),plan());
 for(const modify of [p=>p.nodes.pop(),p=>p.nodes.push(p.nodes[0]),p=>p.nodes[0].groupPath=[],p=>p.nodes[0].peers=['missing'],p=>p.relations[0].target='A']){const p=plan();modify(p);assert.throws(()=>validateLayoutIntent(p,model),/LAYOUT_CONTRACT_INVALID/)}
 assert.throws(()=>validateLayoutIntent(plan(),{...model,conflicts:[{}]}),/unresolved/);
 assert.throws(()=>validateLayoutIntent(plan(),{...model,membershipConflicts:['A']}),/unresolved/);
 assert.doesNotThrow(()=>validateLayoutIntent(plan(),{...model,notCheckable:[{construct:'shape'}]}));
});
test('planning gates generators and submission, revision clears checked bytes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'layout-intent-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,source);
 const job=prepareAgentTask(input);let builds=0;
 const run=createV2Run(job,{contractRequired:true,gate:'strict',manifestDir:path.join(root,'manifests'),reviewerFactory:()=>{},deps:{original:async()=>({svgBytes:Buffer.from('<svg/>')}),audit:async()=>({checks:{svgWellFormed:{status:'PASS'}}}),geometry:async()=>({nodes:[],groups:[],edges:[],labels:[]})}});
 try{
 await assert.rejects(run.buildCheck({build:async()=>{builds++}}),/LAYOUT_INTENT_REQUIRED/);assert.equal(builds,0);
 await assert.rejects(run.submit(),/LAYOUT_INTENT_REQUIRED/);assert.throws(run.requireLayoutIntent,/LAYOUT_INTENT_REQUIRED/);
 await run.submitLayoutIntent({intent:plan()});const first=run.manifest().layoutIntent;
 assert.equal(first.hash,hashLayoutIntent(first));assert.equal(run.manifest().layoutIntentRequired,true);
 fs.writeFileSync(job.outputPath,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"/>');
 await run.buildCheck();assert.ok(run.manifest().twoPhase.checks.length);
 await assert.rejects(run.submitLayoutIntent({intent:plan()}),/PREDECESSOR/);
 const p=plan();p.readingOrder='Top to bottom';await run.submitLayoutIntent({intent:p,predecessorHash:first.hash,reason:'Reviewer requested clearer reading order'});
 assert.notEqual(run.manifest().layoutIntent.hash,first.hash);assert.equal(run.manifest().finalLayoutIntentHash,null);
 const response=JSON.parse((await run.submit()).content[0].text);assert.equal(response.code,'UNCHECKED_BYTES');
 assert.deepEqual(run.manifest().layoutIntentEvents.map(e=>e.name),['magic_layout_intent_created','magic_layout_contract_failed','magic_layout_intent_revised']);
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(job.runDir,{recursive:true,force:true})}
});
test('reviewer receives frozen contract as data with semantic conflict instruction',()=>{
 const contract={hash:'intent-hash',sourceHash:'source',rulesHash:'rules',intent:plan()};
 const prompt=buildReviewerPrompt({facts:model,audit:{checks:{}},geometry:{},imageLabels:[],layoutIntent:contract});
 assert.ok(prompt.includes(JSON.stringify(contract)));assert.match(prompt,/Semantic-layering/);
});
test('extension schedules mandatory source facts and planning tool before drawing',()=>{
 const code=fs.readFileSync(new URL('../pi-extension.ts',import.meta.url),'utf8');
 assert.match(code,/contractRequired: true/);assert.match(code,/name: 'diagram_layout_intent'/);assert.match(code,/await buildSourceFacts\(job, \{ details: true \}\)/);assert.doesNotMatch(code,/Source facts unavailable, continuing/);assert.match(code,/run.requireLayoutIntent\(\)/);
});
