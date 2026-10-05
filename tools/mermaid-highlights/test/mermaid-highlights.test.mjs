import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {readMermaidFlowchartModel, attachMermaidHighlights} from '../src/mermaid-highlights.mjs';
import {installInteractiveSvg, INTERACTIVE_SVG_STYLE} from '../src/interactive-runtime.mjs';
import {exportMermaidInteractive} from '../src/mermaid-interactive-export.mjs';

const enabled=!!process.env.MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE&&!!process.env.MERMAID_HIGHLIGHTS_MERMAID_BUNDLE;
const SOURCE='flowchart LR\n A-B[Input<br/>Details] -->|one| C[Result]\n A-B -->|two| C\n C --> A-B\n subgraph G[Group]\n D[Inside]\n end\n C --> D';
const customSource='flowchart LR\n A_B[First] ab@--> C_D[Second]\n A[Third] ac@--> B_C_D[Fourth]';
const browserOptions={headless:true,...(process.env.MERMAID_HIGHLIGHTS_CHROMIUM_EXECUTABLE?{executablePath:process.env.MERMAID_HIGHLIGHTS_CHROMIUM_EXECUTABLE}:{})};
async function withBrowser(fn){const pw=createRequire(import.meta.url)(process.env.MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE),browser=await pw.chromium.launch(browserOptions);try{await fn(browser)}finally{await browser.close()}}
async function setup(browser,source=SOURCE,options={}){
  const page=await browser.newPage({viewport:{width:1100,height:800},...options}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><div id="diagram"></div><p id="status">Initial status</p>');
  await page.addScriptTag({content:fs.readFileSync(process.env.MERMAID_HIGHLIGHTS_MERMAID_BUNDLE,'utf8')});
  await page.addScriptTag({content:`const INTERACTIVE_SVG_STYLE=${JSON.stringify(INTERACTIVE_SVG_STYLE)};const installInteractiveSvg=(${installInteractiveSvg.toString()});const readMermaidFlowchartModel=(${readMermaidFlowchartModel.toString()});const attachMermaidHighlights=(${attachMermaidHighlights.toString()});`});
  await page.evaluate(async source=>{
    mermaid.initialize({startOnLoad:false,theme:'neutral',securityLevel:'strict'});
    const parsed=await mermaid.mermaidAPI.getDiagramFromText(source);window.model=readMermaidFlowchartModel(parsed);
    const result=await mermaid.render('test-render',source);document.getElementById('diagram').innerHTML=result.svg;
    result.bindFunctions?.(document.getElementById('diagram'));await document.fonts.ready;
    const svg=document.querySelector('svg');svg.style.maxWidth='none';svg.style.width=svg.viewBox.baseVal.width+'px';svg.style.height=svg.viewBox.baseVal.height+'px';
    window.originalSvg=svg.outerHTML;window.paths=[...svg.querySelectorAll('path.flowchart-link')].map(e=>e.getAttribute('d'));
    window.control=attachMermaidHighlights(svg,window.model,{status:document.getElementById('status')});
  },source);
  return {page,errors};
}
const state=page=>page.evaluate(()=>({edges:[...document.querySelectorAll('path[data-edge].is-active')].map(e=>e.dataset.edge).sort(),nodes:[...document.querySelectorAll('g[data-node].is-active')].map(e=>e.dataset.node).sort(),kind:document.querySelector('svg').dataset.selectionKind}));
const clickEdge=async(page,id)=>{const position=await page.locator(`.edge-hit[data-hit-edge="${id}"]`).evaluate(e=>{const p=e.getPointAtLength(e.getTotalLength()/2),m=e.getScreenCTM(),v=new DOMPoint(p.x,p.y).matrixTransform(m);return {x:v.x,y:v.y}});await page.mouse.click(position.x,position.y)};

test('flowchart model snapshot is detached, preserves relation IDs and rejects unsupported diagrams',()=>{
  const node={id:'A',domId:'flowchart-A-0'},edge={id:'ab',start:'A',end:'B',stroke:'normal'};
  const model=readMermaidFlowchartModel({type:'flowchart-v2',db:{getVertices:()=>new Map([['A',node]]),getEdges:()=>[edge]}});
  node.id='changed';edge.start='changed';assert.equal(model.nodes[0].id,'A');assert.equal(model.edges[0].source,'A');
  assert.throws(()=>readMermaidFlowchartModel({type:'sequence'}),/FLOWCHART_REQUIRED/);
});

test('actual Mermaid curved edges, parallel paths and nested HTML labels get direct hover/selection', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser);
  assert.equal(await page.locator('g[data-node]').count(),3);assert.equal(await page.locator('.edge-hit').count(),4);
  assert.ok(await page.locator('foreignObject').count()>0);
  await page.locator('.edge-hit').first().hover();assert.equal((await state(page)).edges.length,1);assert.deepEqual((await state(page)).nodes,['A-B','C']);
  await page.locator('.node-hit[data-hit-node="A-B"]').click();assert.equal((await state(page)).kind,'node');assert.equal((await state(page)).edges.length,3);
  const labels=await page.evaluate(()=>{
    const original=document.querySelector('g[data-node="A-B"] foreignObject div'),copy=[...document.querySelectorAll('.active-node-overlay foreignObject div')].find(e=>e.textContent===original.textContent);
    const read=el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:b.x,y:b.y,w:b.width,h:b.height,color:s.color,lineHeight:s.lineHeight,whiteSpace:s.whiteSpace}};
    return {original:read(original),copy:read(copy)};
  });for(const key of ['x','y','w','h'])assert.ok(Math.abs(labels.original[key]-labels.copy[key])<0.2,`${key}: ${JSON.stringify(labels)}`);
  for(const key of ['color','lineHeight','whiteSpace'])assert.equal(labels.original[key],labels.copy[key]);
  await page.mouse.move(1000,700);assert.equal((await state(page)).edges.length,3);
  await page.keyboard.press('Escape');assert.equal((await state(page)).kind,'none');
  await page.locator('g[data-node="C"]').focus();await page.keyboard.press('Enter');assert.equal((await state(page)).edges.length,4);
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('path.flowchart-link')].map(e=>e.getAttribute('d'))),await page.evaluate(()=>window.paths));
  assert.deepEqual(errors,[]);
}));

test('explicit edge IDs bind underscore-containing source IDs without delimiter guessing', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,customSource);
  await clickEdge(page,'ab');assert.deepEqual((await state(page)).nodes,['A_B','C_D']);
  await clickEdge(page,'ac');assert.deepEqual((await state(page)).nodes,['A','B_C_D']);
  assert.deepEqual(errors,[]);
}));

test('repeated attach and destroy restore exact Mermaid SVG and preserve existing click callback', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser);
  await page.evaluate(()=>{window.callbackCount=0;document.querySelector('g[data-node="A-B"]').addEventListener('click',()=>window.callbackCount++);window.control=attachMermaidHighlights(document.querySelector('svg'),window.model,{status:document.getElementById('status')})});
  assert.equal(await page.locator('.node-hit').count(),3);
  await page.locator('.node-hit[data-hit-node="A-B"]').click();assert.equal(await page.evaluate(()=>window.callbackCount),1);assert.equal((await state(page)).kind,'node');
  await page.evaluate(()=>{
    const svg=document.querySelector('svg'),edge=svg.querySelector('path[data-edge]');
    window.callbackEdge=edge.dataset.edge;window.edgeDirect=0;window.edgeDelegated=0;
    edge.addEventListener('click',()=>window.edgeDirect++);
    svg.addEventListener('click',event=>{if(event.target===edge)window.edgeDelegated++});
    window.control.reset();
  });
  const edgeId=await page.evaluate(()=>window.callbackEdge);
  await clickEdge(page,edgeId);assert.equal((await state(page)).kind,'edge');
  assert.deepEqual(await page.evaluate(()=>[window.edgeDirect,window.edgeDelegated]),[1,1]);
  await clickEdge(page,edgeId);assert.equal((await state(page)).kind,'none');
  assert.deepEqual(await page.evaluate(()=>[window.edgeDirect,window.edgeDelegated]),[2,2]);
  await page.evaluate(()=>{window.control.reset();window.control.destroy();window.control.destroy()});
  const difference=await page.evaluate(()=>{const actual=document.querySelector('svg').outerHTML,expected=window.originalSvg;if(actual===expected)return null;let at=0;while(at<actual.length&&actual[at]===expected[at])at++;return {at,actual:actual.slice(Math.max(0,at-60),at+160),expected:expected.slice(Math.max(0,at-60),at+160)}});
  assert.equal(difference,null,JSON.stringify(difference));
  assert.equal(await page.locator('#status').textContent(),'Initial status');
  await page.evaluate(()=>document.querySelector('path.flowchart-link').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.deepEqual(await page.evaluate(()=>[window.edgeDirect,window.edgeDelegated]),[3,3]);
  assert.deepEqual(errors,[]);
}));

test('phone tap selects a Mermaid node and a second tap clears it', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,SOURCE,{viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.locator('.node-hit[data-hit-node="A-B"]').tap();assert.equal((await state(page)).kind,'node');assert.equal((await state(page)).edges.length,3);
  await page.locator('.node-hit[data-hit-node="A-B"]').tap();assert.equal((await state(page)).kind,'none');assert.deepEqual(errors,[]);
}));

test('unresolved identities refuse attachment without changing an existing highlighted diagram', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser);
  await page.locator('.node-hit[data-hit-node="A-B"]').click();
  const result=await page.evaluate(()=>{
    const svg=document.querySelector('svg'),before=svg.outerHTML,bad=structuredClone(window.model);bad.edges[0].id='missing';
    let error='';try{attachMermaidHighlights(svg,bad)}catch(e){error=e.message}
    return {error,unchanged:before===svg.outerHTML};
  });assert.match(result.error,/BINDING_UNRESOLVED/);assert.equal(result.unchanged,true);assert.deepEqual(errors,[]);
}));

test('standalone Mermaid export retains HTML labels and works offline from saved SVG', {skip:!enabled},async()=>withBrowser(async browser=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mermaid-highlights-interactive-'));
  try{
    const receipt=await exportMermaidInteractive(SOURCE,{outPath:path.join(dir,'interactive.html')});assert.equal(receipt.nodeCount,3);assert.equal(receipt.edgeCount,4);
    const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
    await page.goto(`file://${receipt.path}`);await page.locator('.node-hit[data-hit-node="C"]').click();assert.equal((await state(page)).edges.length,4);
    assert.ok(await page.locator('foreignObject').count()>0);assert.deepEqual(errors,[]);assert.equal(requests.filter(url=>!url.startsWith('file:')).length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
}));

test('direct export preserves a nonbreaking space inside a quoted Mermaid label', {skip:!enabled},async()=>withBrowser(async browser=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mermaid-highlights-label-space-'));
  try{
    const receipt=await exportMermaidInteractive('flowchart LR\n A["Hello\u00a0World"] --> B[Result]',{outPath:path.join(dir,'label.html')});
    const page=await browser.newPage();await page.goto(`file://${receipt.path}`);
    assert.equal(await page.locator('g[data-node="A"] .nodeLabel').textContent(),'Hello\u00a0World');
    await page.locator('.node-hit[data-hit-node="A"]').click();
    assert.equal(await page.locator('.active-node-overlay .nodeLabel').filter({hasText:'Hello'}).textContent(),'Hello\u00a0World');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
}));


test('pan/zoom viewport keeps hit areas and paint aligned through later transforms', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser);
  await page.evaluate(()=>{
    window.control.destroy();
    const svg=document.querySelector('svg'),viewport=document.createElementNS(svg.namespaceURI,'g');
    viewport.classList.add('svg-pan-zoom_viewport');
    for(const child of [...svg.children])if(child.localName==='g')viewport.append(child);
    svg.append(viewport);viewport.setAttribute('transform','translate(20 30) scale(0.8)');
    window.control=attachMermaidHighlights(svg,window.model);
  });
  const geometry=()=>page.evaluate(()=>{
    const svg=document.querySelector('svg'),node=svg.querySelector('g[data-node="A-B"]'),nodeHit=svg.querySelector('.node-hit[data-hit-node="A-B"]');
    const edge=svg.querySelector('path[data-edge]'),hit=svg.querySelector('.edge-hit');
    const rect=el=>{const b=el.getBoundingClientRect();return [b.x,b.y,b.width,b.height]};
    const point=el=>{const p=el.getPointAtLength(el.getTotalLength()/2);const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return [q.x,q.y]};
    return {node:rect(node),nodeHit:rect(nodeHit),edge:point(edge),hit:point(hit),layers:[...svg.querySelectorAll('.interaction-hit-layer,.interaction-overlay-layer,.interaction-node-overlay-layer,.interaction-node-hit-layer')].every(el=>el.parentElement.classList.contains('svg-pan-zoom_viewport'))};
  });
  for(const transform of ['translate(20 30) scale(0.8)','translate(105 68) scale(1.3)']){
    await page.evaluate(value=>document.querySelector('.svg-pan-zoom_viewport').setAttribute('transform',value),transform);
    const g=await geometry();assert.equal(g.layers,true);
    for(let i=0;i<4;i++)assert.ok(Math.abs(g.node[i]-g.nodeHit[i])<0.3,JSON.stringify(g));
    for(let i=0;i<2;i++)assert.ok(Math.abs(g.edge[i]-g.hit[i])<0.3,JSON.stringify(g));
    await page.evaluate(()=>document.querySelector('.node-hit[data-hit-node="A-B"]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
    const paint=await page.evaluate(()=>{const rect=el=>{const b=el.getBoundingClientRect();return [b.x,b.y,b.width,b.height]};return {node:rect(document.querySelector('g[data-node="A-B"]')),paint:rect([...document.querySelectorAll('.active-node-overlay')].find(el=>el.textContent.includes('Input')))}});
    for(let i=0;i<4;i++)assert.ok(Math.abs(paint.node[i]-paint.paint[i])<0.3,JSON.stringify(paint));
    await page.evaluate(()=>window.control.reset());
  }
  await page.evaluate(()=>{window.control.destroy();window.control=attachMermaidHighlights(document.querySelector('svg'),window.model)});
  assert.equal(await page.locator('.interaction-hit-layer').count(),1);assert.deepEqual(errors,[]);
}));
