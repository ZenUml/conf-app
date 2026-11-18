import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareAgentTask,createAgentVisualInspector} from '../src/agent-led.mjs';
import {createV2Run} from '../src/orchestrator.mjs';
import {renderAgentSvg} from '../src/agent-render.mjs';
import {renderSpec,validateSpec} from '../src/spec-render.mjs';
import {createSpecRenderer} from '../src/spec-tool.mjs';

const SOURCE='flowchart LR\n A[Start] --> B[Finish]\n';
const SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" data-presentation="native" data-scale="9"/>';
const rec=n=>({path:`/unused/${n}.png`,file:`${n}.png`,sha256:n});
const fixture=(options={})=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-presentation-')),input=path.join(root,'source.mmd');fs.writeFileSync(input,SOURCE);
  const job=prepareAgentTask(input,options);fs.writeFileSync(job.outputPath,SVG);
  return {job,input,root,cleanup(){fs.rmSync(job.runDir,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}};
};
const original=async()=>({rendered:{originalSvgHash:'original',media:{full:rec('original')}},svgBytes:Buffer.from('<svg/>')});
const cleanAudit={status:'PASS',checks:{svgWellFormed:{status:'PASS'},nodeIdentity:{status:'PASS'},relations:{status:'PASS'},groups:{status:'PASS'},semanticPreservation:{status:'PASS'}}};

test('caller declaration is copied, immutable, recorded before authoring and stated in the prompt',()=>{
  const declared={mode:'native',scale:1.5},t=fixture({presentation:declared});
  try{
    declared.scale=9;
    assert.deepEqual(t.job.presentation,{mode:'native',scale:1.5});assert.ok(Object.isFrozen(t.job.presentation));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t.job.runDir,'.job.json'),'utf8')).presentation,t.job.presentation);
    assert.match(t.job.prompt,/Caller-declared presentation: \{"mode":"native","scale":1.5\}/);
    assert.match(t.job.prompt,/author SVG\/layout metadata cannot change it/);
    assert.throws(()=>prepareAgentTask(t.input,{presentation:{mode:'native',scale:0}}),/INVALID_PRESENTATION/);
  }finally{t.cleanup()}
});

test('resume uses the new caller declaration and never trusts author-written saved presentation',()=>{
  const t=fixture({presentation:{mode:'native',scale:1.5}});
  try{
    const saved=JSON.parse(fs.readFileSync(path.join(t.job.runDir,'.job.json'),'utf8'));saved.presentation={mode:'native',scale:9};fs.writeFileSync(path.join(t.job.runDir,'.job.json'),JSON.stringify(saved));
    const resumed=prepareAgentTask(t.input,{resumeRunDir:t.job.runDir});assert.deepEqual(resumed.presentation,{mode:'fit',width:1200,height:710});
    const explicit=prepareAgentTask(t.input,{resumeRunDir:t.job.runDir,presentation:{mode:'native',scale:1.5}});assert.deepEqual(explicit.presentation,{mode:'native',scale:1.5});
  }finally{t.cleanup()}
});

test('inspector sends the caller presentation to rendering and audit and includes its actual image',async()=>{
  const t=fixture({presentation:{mode:'fit',width:1600,height:900}}),calls=[];
  try{
    const inspect=createAgentVisualInspector(t.job,{deps:{original,render:async(_b,_p,options)=>{calls.push(['render',options]);return {full:rec('full'),crops:[],fullscreen:rec('fit'),presentationImage:rec('actual'),presentationView:{mode:'fit',scale:2.5}}},audit:async(_b,_o,options)=>{calls.push(['audit',options]);return cleanAudit},image:r=>({type:'image',data:r.sha256,mimeType:'image/png'})}});
    const result=await inspect();
    for(const [,options] of calls)assert.deepEqual(options.presentation,t.job.presentation);
    assert.ok(result.content.some(c=>c.type==='image'&&c.data==='actual'));
    assert.deepEqual(JSON.parse(result.content[0].text).presentation,{mode:'fit',width:1600,height:900});
    const saved=JSON.parse(fs.readFileSync(path.join(t.job.runDir,'.job.json'),'utf8'));saved.presentation={mode:'native',scale:9};fs.writeFileSync(path.join(t.job.runDir,'.job.json'),JSON.stringify(saved));
    await assert.rejects(inspect(),/JOB_MANIFEST_TAMPERED/);assert.equal(calls.length,2);
  }finally{t.cleanup()}
});

test('orchestrator audits with caller presentation, persists it, and refuses job-manifest tampering',async()=>{
  const t=fixture({presentation:{mode:'native',scale:1.25}}),calls=[],manifestDir=path.join(t.root,'manifests');
  try{
    const run=createV2Run(t.job,{gate:'strict',manifestDir,deps:{original,audit:async(_bytes,options)=>{calls.push(options);return cleanAudit},geometry:async()=>({natural:{w:600,h:200},nodes:[],groups:[],labels:[],edges:[]})}});
    await run.buildCheck();assert.deepEqual(calls[0].presentation,{mode:'native',scale:1.25});assert.deepEqual(run.manifest().presentation,t.job.presentation);
    fs.writeFileSync(path.join(t.job.runDir,'.job.json'),'{}');
    await assert.rejects(run.buildCheck(),/JOB_MANIFEST_TAMPERED/);assert.equal(calls.length,1);
  }finally{t.cleanup()}
});

test('job renderer ignores an author layout presentation override',async()=>{
  const t=fixture();
  try{
    const layout={canvas:{w:2400,h:1420},presentation:{mode:'native',scale:9},palette:{p:{fill:'#ffffff',stroke:'#123456',text:'#123456',meaning:'Process'}},nodes:[{id:'A',rect:[20,20,112,56],text:'Start',role:'p',font:18},{id:'B',rect:[300,20,112,56],text:'Finish',role:'p',font:18}],edges:[{source:'A',target:'B',points:[[132,48],[300,48]]}]};
    fs.writeFileSync(path.join(t.job.runDir,'layout.json'),JSON.stringify(layout));
    const r=await createSpecRenderer(t.job)();assert.match(r.content[0].text,/label-font-legibility/);assert.match(r.content[0].text,/effective font 9 px/);
  }finally{t.cleanup()}
});

test('declared size-extension steps render exact enlarged tiers and JSON neutral evidence',()=>{
  const layout={canvas:{w:600,h:400},palette:{p:{fill:'#ffffff',stroke:'#123456',text:'#123456',meaning:'Process'}},nodes:[{id:'A',centre:[200,150],sizeFamily:'service',sizeTier:'compact',sizeExtension:{width:2,height:1},text:'A',role:'p'}],edges:[]};
  const result=renderSpec(layout);assert.equal(result.findings.filter(f=>f.rule==='node-size-tier').length,0);
  assert.match(result.svg,/data-size-extension="\{&quot;width&quot;:2,&quot;height&quot;:1\}"/);
  assert.match(result.svg,/data-label-box="148 128 104 44"/);assert.match(result.svg,/<rect x="140" y="120" width="120" height="60"/);
  layout.nodes[0].sizeExtension.width=0.5;assert.ok(validateSpec(layout).some(e=>e.path==='nodes[0].sizeExtension.width'));
  layout.nodes[0].sizeExtension.width=-1;assert.ok(validateSpec(layout).some(e=>e.path==='nodes[0].sizeExtension.width'));
});

test('renderer shows native zoom and custom fit alongside the standard reference',{skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-presentation-render-'));
  const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><rect width="600" height="200" fill="white"/><text x="20" y="50" font-size="18">Synthetic</text></svg>');
  try{
    const native=await renderAgentSvg(bytes,{outPrefix:path.join(root,'native'),presentation:{mode:'native',scale:1.5}});
    assert.deepEqual(native.presentationView.viewport,{width:900,height:300});assert.equal(native.presentationView.scale,1.5);assert.equal(native.presentationView.minCssPx,27);assert.notEqual(native.presentationImage.path,native.fullscreen.path);assert.ok(fs.statSync(native.presentationImage.path).size>0);
    const fit=await renderAgentSvg(bytes,{outPrefix:path.join(root,'fit'),presentation:{mode:'fit',width:1600,height:900}});
    assert.deepEqual(fit.presentationView.viewport,{width:1600,height:900});assert.equal(fit.presentationView.scale,1600/600);assert.notEqual(fit.presentationImage.path,fit.fullscreen.path);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});
