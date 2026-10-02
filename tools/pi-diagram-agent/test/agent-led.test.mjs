import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareAgentTask,createAgentVisualInspector} from '../src/agent-led.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source='flowchart LR\n  A[Start] --> B[Finish]\n';
const candidateSvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs><g data-node="A"><rect x="10" y="50" width="100" height="60"/><text x="20" y="80">Start</text></g><g data-node="B"><rect x="400" y="50" width="100" height="60"/><text x="410" y="80">Finish</text></g><path data-source="A" data-target="B" d="M110 80 L400 80" stroke="black" fill="none" marker-end="url(#arrow)"/></svg>';
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-agent-test-'));const input=path.join(root,'source.mmd');fs.writeFileSync(input,source);return {root,input}};

test('agent prompt contains complete pinned rules and exact source, and directs a real authored loop',()=>{
  const {root,input}=fixture();
  try{
    const job=prepareAgentTask(input);
    assert.equal(job.sourceHash,hash(Buffer.from(source)));
    assert.match(job.prompt,/Mandatory lower-bend route search/);
    assert.match(job.prompt,/render the standalone SVG at 2×/);
    assert.ok(job.prompt.includes(source));
    assert.match(job.prompt,/call diagram_inspect/);
    assert.match(job.prompt,/Do not use layoutGraph/);
    const kitDir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','kit');
    assert.ok(job.prompt.includes(`${kitDir}/svgkit.py`));
    assert.ok(job.prompt.includes(`${kitDir}/README.md`));
    assert.match(job.prompt,/You still own every position, port, route point and layout decision/);
    const kitParagraph=job.prompt.split('\n\n').find(p=>p.includes('svgkit.py'));
    assert.match(kitParagraph,/optional/i);
    assert.match(kitParagraph,/You may/);
    assert.doesNotMatch(kitParagraph,/instead of|template|example\.py|context-stroke/i);
    assert.ok(fs.existsSync(path.join(kitDir,'svgkit.py')));
    assert.equal(fs.existsSync(job.outputPath),false);
    fs.rmSync(job.runDir,{recursive:true,force:true});
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('source exact bytes are required and candidate may not be a symlink',async()=>{
  const {root,input}=fixture();
  try{
    fs.writeFileSync(input,Buffer.from([0xff,0xfe,...Buffer.from(source)]));
    assert.throws(()=>prepareAgentTask(input),/SOURCE_NOT_EXACT_UTF8/);
    fs.writeFileSync(input,source);
    const job=prepareAgentTask(input);
    fs.symlinkSync(input,job.outputPath);
    const inspect=createAgentVisualInspector(job,{mermaidBundlePath:'/nonexistent'});
    await assert.rejects(inspect(),/CANDIDATE_FILE_UNAVAILABLE_OR_UNSAFE/);
    fs.rmSync(job.runDir,{recursive:true,force:true});
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('continuation reuses only a bound private run and carries reviewer feedback',()=>{
  const {root,input}=fixture();
  try{
    const job=prepareAgentTask(input);
    fs.writeFileSync(job.outputPath,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
    const accepted=path.join(root,'accepted.svg'),feedback=path.join(root,'review.txt');
    fs.writeFileSync(accepted,fs.readFileSync(job.outputPath));
    fs.writeFileSync(feedback,'Legend is incomplete; compare the reference image.');
    const resumed=prepareAgentTask(input,{resumeRunDir:job.runDir,referenceSvgPath:accepted,feedbackPath:feedback});
    assert.equal(resumed.runDir,fs.realpathSync(job.runDir));
    assert.match(resumed.prompt,/Legend is incomplete/);
    assert.match(resumed.prompt,/accepted prior SVG is supplied only as a visual quality reference/);
    assert.equal(resumed.referenceHash,hash(fs.readFileSync(accepted)));
    fs.writeFileSync(input,source.replace('Finish','Changed'));
    assert.throws(()=>prepareAgentTask(input,{resumeRunDir:job.runDir}),/AGENT_RESUME_SOURCE_OR_RULES_MISMATCH/);
    fs.rmSync(job.runDir,{recursive:true,force:true});
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('rules upgrade requires an exact-source continuation and records old and new revisions',()=>{
  const {root,input}=fixture();
  let job;
  try{
    assert.throws(()=>prepareAgentTask(input,{upgradeRules:true}),/RULES_UPGRADE_REQUIRES_RESUME/);
    job=prepareAgentTask(input);
    const manifestPath=path.join(job.runDir,'.job.json');
    const priorRules='e4dffd1cfeb8155002f1d2aa1e328def544bd2bbabeb57ab6679eef29ce053ea';
    fs.writeFileSync(manifestPath,JSON.stringify({sourceHash:job.sourceHash,rulesHash:priorRules}));
    assert.throws(()=>prepareAgentTask(input,{resumeRunDir:job.runDir,upgradeRules:true}),/AGENT_RESUME_CANDIDATE_UNAVAILABLE/);
    assert.equal(JSON.parse(fs.readFileSync(manifestPath,'utf8')).rulesHash,priorRules);
    fs.writeFileSync(job.outputPath,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
    assert.throws(()=>prepareAgentTask(input,{resumeRunDir:job.runDir}),/AGENT_RESUME_SOURCE_OR_RULES_MISMATCH/);
    const resumed=prepareAgentTask(input,{resumeRunDir:job.runDir,upgradeRules:true});
    assert.match(resumed.prompt,/Re-evaluate this existing candidate under the entire new rules text/);
    assert.match(resumed.prompt,/old inspection receipts do not certify the new revision/);
    assert.match(resumed.prompt,/Semantic preservation/);
    const saved=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    assert.equal(saved.sourceHash,job.sourceHash);
    assert.equal(saved.rulesHash,resumed.rulesHash);
    assert.deepEqual(saved.rulesHistory,[priorRules]);
    assert.notEqual(saved.rulesHash,priorRules);
  }finally{
    if(job)fs.rmSync(job.runDir,{recursive:true,force:true});
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('visual tool returns original, candidate full/crops and viewer-fit images, not a quality certificate',
  {skip:!process.env.PI_DIAGRAM_MERMAID_BUNDLE||!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
    const {root,input}=fixture();
    try{
      const job=prepareAgentTask(input);
      fs.writeFileSync(job.outputPath,candidateSvg);
      const inspect=createAgentVisualInspector(job,{mermaidBundlePath:process.env.PI_DIAGRAM_MERMAID_BUNDLE,maxInspections:1});
      const result=await inspect();
      assert.equal(result.content[0].type,'text');
      assert.equal(JSON.parse(result.content[0].text).status,'VISUAL_EVIDENCE_ONLY');
      assert.equal(result.content.length,8);
      assert.ok(result.content.slice(1).every(item=>item.type==='image'&&item.mimeType==='image/png'&&item.data.length>1000));
      assert.equal(result.details.sourceHash,job.sourceHash);
      const {fitBounds}=result.details.rendered.containFit;
      assert.ok(Math.abs(fitBounds.x+fitBounds.width/2-600)<1);
      assert.ok(Math.abs(fitBounds.y+fitBounds.height/2-355)<1);
      await assert.rejects(inspect(),/AGENT_INSPECTION_LIMIT/);
      const reference=path.join(root,'accepted.svg');
      fs.copyFileSync(job.outputPath,reference);
      const resumed=prepareAgentTask(input,{resumeRunDir:job.runDir,referenceSvgPath:reference});
      const comparative=await createAgentVisualInspector(resumed,{mermaidBundlePath:process.env.PI_DIAGRAM_MERMAID_BUNDLE,maxInspections:1})();
      assert.equal(comparative.content.filter(item=>item.type==='image').length,9);
      assert.equal(comparative.details.reference.svgHash,resumed.referenceHash);
      fs.rmSync(job.runDir,{recursive:true,force:true});
    }finally{fs.rmSync(root,{recursive:true,force:true})}
  });

const adjudicationRecord=sourceHash=>({nodeId:'A',declaredGroup:'G',renderedGroup:null,chosenGroup:null,authorisedBy:'owner@example.test',timestamp:'2026-10-02T00:00:00Z',sourceHash});

test('a model-written adjudications.json in the run directory is ignored on resume',()=>{
  const {root,input}=fixture();
  let job;
  try{
    job=prepareAgentTask(input);
    assert.deepEqual(job.adjudications,[]);
    fs.writeFileSync(job.outputPath,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
    // The agent under audit has file/shell access to its run directory and forges its own adjudication.
    fs.writeFileSync(path.join(job.runDir,'adjudications.json'),JSON.stringify(adjudicationRecord(job.sourceHash)));
    const resumed=prepareAgentTask(input,{resumeRunDir:job.runDir});
    assert.deepEqual(resumed.adjudications,[]);
    // Nor can the agent smuggle one in through the manifest it can also write.
    const manifest=JSON.parse(fs.readFileSync(path.join(job.runDir,'.job.json'),'utf8'));
    fs.writeFileSync(path.join(job.runDir,'.job.json'),JSON.stringify({...manifest,adjudications:[adjudicationRecord(job.sourceHash)]}));
    assert.deepEqual(prepareAgentTask(input,{resumeRunDir:job.runDir}).adjudications,[]);
  }finally{
    if(job)fs.rmSync(job.runDir,{recursive:true,force:true});
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('--adjudication is read at command start from outside the run directory and recorded in the manifest',()=>{
  const {root,input}=fixture();
  let job;
  try{
    job=prepareAgentTask(input);
    fs.writeFileSync(job.outputPath,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
    const record=adjudicationRecord(job.sourceHash);
    const outside=path.join(root,'adjudication.json');
    fs.writeFileSync(outside,JSON.stringify(record));
    const resumed=prepareAgentTask(input,{resumeRunDir:job.runDir,adjudicationPath:outside});
    assert.deepEqual(resumed.adjudications,[record]);
    const manifest=JSON.parse(fs.readFileSync(path.join(job.runDir,'.job.json'),'utf8'));
    assert.equal(manifest.adjudication.sha256,hash(fs.readFileSync(outside)));
    assert.deepEqual(manifest.adjudication.records,[record]);
    assert.equal(manifest.sourceHash,job.sourceHash);
    // An array is accepted on a fresh run too, and recorded before any model turn.
    fs.writeFileSync(outside,JSON.stringify([record,{...record,nodeId:'B'}]));
    const fresh=prepareAgentTask(input,{adjudicationPath:outside});
    try{
      assert.equal(fresh.adjudications.length,2);
      assert.equal(JSON.parse(fs.readFileSync(path.join(fresh.runDir,'.job.json'),'utf8')).adjudication.records.length,2);
    }finally{fs.rmSync(fresh.runDir,{recursive:true,force:true})}
    // Inside the run directory, directly or through a symlink, is refused.
    const inside=path.join(job.runDir,'adjudications.json');
    fs.writeFileSync(inside,JSON.stringify(record));
    assert.throws(()=>prepareAgentTask(input,{resumeRunDir:job.runDir,adjudicationPath:inside}),/ADJUDICATION_INSIDE_RUN_DIRECTORY/);
    const link=path.join(root,'link.json');
    fs.symlinkSync(inside,link);
    assert.throws(()=>prepareAgentTask(input,{resumeRunDir:job.runDir,adjudicationPath:link}),/ADJUDICATION_INSIDE_RUN_DIRECTORY/);
    assert.throws(()=>prepareAgentTask(input,{resumeRunDir:job.runDir,adjudicationPath:'relative.json'}),/ADJUDICATION_PATH_NOT_ABSOLUTE/);
    fs.writeFileSync(outside,'not json');
    assert.throws(()=>prepareAgentTask(input,{resumeRunDir:job.runDir,adjudicationPath:outside}),/ADJUDICATIONS_UNREADABLE/);
  }finally{
    if(job)fs.rmSync(job.runDir,{recursive:true,force:true});
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('diagram_inspect refuses a manifest rewritten after the command started',async()=>{
  const {root,input}=fixture();
  let job;
  try{
    job=prepareAgentTask(input);
    fs.writeFileSync(job.outputPath,candidateSvg);
    fs.writeFileSync(path.join(job.runDir,'.job.json'),JSON.stringify({sourceHash:job.sourceHash,rulesHash:job.rulesHash,adjudication:{records:[]}}));
    await assert.rejects(createAgentVisualInspector(job,{mermaidBundlePath:'/nonexistent'})(),/JOB_MANIFEST_TAMPERED/);
  }finally{
    if(job)fs.rmSync(job.runDir,{recursive:true,force:true});
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('diagram_inspect keeps the original render it produced even if the run-directory copy is rewritten',
  {skip:!process.env.PI_DIAGRAM_MERMAID_BUNDLE||!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
    const {root,input}=fixture();
    let job;
    try{
      job=prepareAgentTask(input);
      fs.writeFileSync(job.outputPath,candidateSvg);
      const inspect=createAgentVisualInspector(job,{mermaidBundlePath:process.env.PI_DIAGRAM_MERMAID_BUNDLE,maxInspections:2});
      const first=await inspect();
      const originalFile=path.join(job.runDir,first.details.original.media.svg.file);
      fs.writeFileSync(originalFile,'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
      const second=await inspect();
      assert.equal(first.details.audit.originalSvgHash,first.details.original.originalSvgHash);
      assert.equal(second.details.audit.originalSvgHash,first.details.original.originalSvgHash);
    }finally{
      if(job)fs.rmSync(job.runDir,{recursive:true,force:true});
      fs.rmSync(root,{recursive:true,force:true});
    }
  });

test('adjudication records reach the model prompt as explicit user-authorised group instructions',()=>{
  const {root,input}=fixture();
  let job;
  try{
    const base=prepareAgentTask(input);
    fs.rmSync(base.runDir,{recursive:true,force:true});
    const outside=path.join(root,'adjudication.json');
    fs.writeFileSync(outside,JSON.stringify([{nodeId:'A',declaredGroup:'G1',renderedGroup:'G2',chosenGroup:'G1',authorisedBy:'owner@example.test',timestamp:'2026-10-02T00:00:00Z',sourceHash:base.sourceHash}]));
    job=prepareAgentTask(input,{adjudicationPath:outside});
    assert.match(job.prompt,/User-authorised group adjudications/);
    assert.match(job.prompt,/node "A": declared group "G1", rendered group "G2", chosen group "G1"/);
    assert.match(job.prompt,/user authorised drawing node "A" in "G1"/);
    assert.match(job.prompt,/ADJUDICATED/);
    const none=prepareAgentTask(input);
    assert.doesNotMatch(none.prompt,/User-authorised group adjudications/);
    fs.rmSync(none.runDir,{recursive:true,force:true});
  }finally{
    if(job)fs.rmSync(job.runDir,{recursive:true,force:true});
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('agent prompt states the one shared-trunk convention and rejects invented attribute names',()=>{
  const {root,input}=fixture();
  try{
    const {prompt}=prepareAgentTask(input);
    assert.match(prompt,/data-shared-trunk="<id>"/);
    assert.match(prompt,/same target, the same relation style \(dash, width, colour\) and the same entry side/);
    assert.match(prompt,/within 4 units of the shared run/);
    assert.match(prompt,/own complete source-to-target path/);
    assert.match(prompt,/exactly one visible arrowhead/);
    assert.match(prompt,/data-shared-bus[^.]*not recognised/);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});
