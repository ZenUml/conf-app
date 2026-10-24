import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {renderOriginalMermaid,measureMermaidLabelTiers} from '../src/original-render.mjs';
import {parseMermaid} from '../src/parser.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bundle=process.env.PI_DIAGRAM_MERMAID_BUNDLE;
const playwright=process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'pi-original-test-'))}

test('unavailable local bundle fails before producing output',async()=>{
  const dir=temp();try{
    await assert.rejects(renderOriginalMermaid('flowchart LR\nA-->B',{outPrefix:path.join(dir,'sample'),mermaidBundlePath:path.join(dir,'missing.js')}));
    assert.deepEqual(fs.readdirSync(dir),[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('non-exact UTF-8 and non-product autostart fail closed',async()=>{
  const dir=temp();try{
    await assert.rejects(renderOriginalMermaid(Buffer.from([0xff]),{outPrefix:path.join(dir,'sample'),mermaidBundlePath:path.join(dir,'missing.js')}),/SOURCE_NOT_EXACT_UTF8/);
    const local=path.join(dir,'bundle.js');fs.writeFileSync(local,'window.mermaid={}');
    await assert.rejects(renderOriginalMermaid('flowchart LR\nA-->B',{outPrefix:path.join(dir,'sample'),mermaidBundlePath:local,mermaidConfig:{startOnLoad:true,theme:'neutral'}}),/MERMAID_AUTOSTART_UNSUPPORTED/);
    assert.deepEqual(fs.readdirSync(dir),['bundle.js']);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('actual local Mermaid browser evidence is exact-hash bound and contains full and four crops',{
  skip:!bundle||!playwright?'set PI_DIAGRAM_MERMAID_BUNDLE and PI_DIAGRAM_PLAYWRIGHT_MODULE for browser evidence':false,
},async()=>{
  const dir=temp();try{
    const raw='flowchart LR\nA[Input\u00a0node] --> B[Result]';
    const result=await renderOriginalMermaid(raw,{outPrefix:path.join(dir,'sample'),mermaidBundlePath:bundle,playwrightModulePath:playwright});
    assert.equal(result.status,'PASS');
    assert.equal(result.sourceHash,sha(Buffer.from(raw)));
    assert.equal(result.renderedSourceHash,sha(Buffer.from(raw.replaceAll('\u00a0',' '))));
    assert.equal(result.normalization,'nbsp-to-space');
    assert.equal(result.mermaid.config.theme,'neutral');
    assert.equal(result.mermaid.bundleHash,sha(fs.readFileSync(bundle)));
    assert.equal(result.deviceScaleFactor,2);
    assert.equal(result.observations.blockedRequestCount,0);
    for(const role of ['svg','full','crop-0-0','crop-0-1','crop-1-0','crop-1-1']){
      const item=result.media[role];assert.ok(item,role);
      assert.match(item.file,new RegExp(result.originalSvgHash.slice(0,12)));
      assert.equal(sha(fs.readFileSync(path.join(dir,item.file))),item.sha256);
    }
    assert.equal(result.media.svg.sha256,result.originalSvgHash);
    assert.ok(result.metrics.displayWidth>0&&result.metrics.displayHeight>0);
    assert.equal(fs.readdirSync(dir).length,7);
    const receipt=JSON.parse(fs.readFileSync(result.receiptPath,'utf8'));
    assert.equal(receipt.originalSvgHash,result.originalSvgHash);
    assert.match(receipt.limitations.join(' '),/not semantic or layout certification/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('browser glyph measurement exposes a smaller S-tier witness for thin text',{
  skip:!playwright?'set PI_DIAGRAM_PLAYWRIGHT_MODULE for canvas evidence':false,
},async()=>{
  const source='flowchart LR\nA[iiiiiiiiii]';
  const model=parseMermaid(source);
  const result=await measureMermaidLabelTiers(source,{model,actualTiers:{A:[200,80]},playwrightModulePath:playwright});
  assert.equal(result.status,'MEASURED');
  assert.equal(result.sourceHash,sha(Buffer.from(source)));
  assert.equal(result.renderedSourceHash,result.sourceHash);
  assert.match(result.method.font,/Arial, Helvetica, sans-serif/);
  assert.ok(result.method.browserVersion);
  const node=result.nodes.find(n=>n.id==='A');
  assert.deepEqual(node.firstFittingTier,[96,40]);
  assert.deepEqual(node.smallerTierWitness.tier,[96,40]);
  assert.ok(node.smallerTierWitness.measuredWidths[0]<68);
  assert.match(result.limitations.join(' '),/actual SVG text ink bounds/);
});

test('wide Latin and CJK words can exceed XL despite bounded character counts',{
  skip:!playwright?'set PI_DIAGRAM_PLAYWRIGHT_MODULE for canvas evidence':false,
},async()=>{
  for(const word of ['W'.repeat(40),'漢'.repeat(40)]){
    const source=`flowchart LR\nA[${word}]`;
    const result=await measureMermaidLabelTiers(source,{playwrightModulePath:playwright});
    const node=result.nodes.find(n=>n.id==='A');
    assert.equal(node.firstFittingTier,null);
    assert.match(node.unresolved,/no measured tier fits/);
    assert.equal(node.tiers.at(-1).error,'unbreakable-word');
  }
});

test('font measurement bounds source and node count before opening a browser',async()=>{
  const source='flowchart LR\n'+Array.from({length:65},(_,i)=>`N${i}[Word]`).join('\n');
  await assert.rejects(measureMermaidLabelTiers(source),/FONT_MEASUREMENT_SIZE_LIMIT/);
});

test('font measurement refuses a model whose node text differs from source',async()=>{
  const source='flowchart LR\nA[Original]';
  const model=parseMermaid(source);
  model.nodes[0].text='Tampered';
  await assert.rejects(measureMermaidLabelTiers(source,{model}),/MODEL_SOURCE_BINDING_MISMATCH/);
});
