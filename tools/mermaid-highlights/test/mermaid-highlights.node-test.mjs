import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {readMermaidFlowchartModel, attachMermaidHighlights, attachPreparedSvgHighlights, requireMountedFlowchart, installValidatedBindings} from '../src/mermaid-highlights.mjs';
import {installInteractiveSvg, INTERACTIVE_SVG_STYLE} from '../src/interactive-runtime.mjs';
import {exportMermaidInteractive} from '../src/mermaid-interactive-export.mjs';

const enabled=!!process.env.MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE&&!!process.env.MERMAID_HIGHLIGHTS_MERMAID_BUNDLE;
// Skipping is for a plain local checkout. Under CI it would hide that the runtime never ran.
if(!enabled&&/^(1|true)$/i.test(process.env.CI??''))throw Error('MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE and MERMAID_HIGHLIGHTS_MERMAID_BUNDLE are required when CI is set; run `pnpm test:mermaid-highlights`, which supplies them.');
const SOURCE='flowchart LR\n A-B[Input<br/>Details] -->|one| C[Result]\n A-B -->|two| C\n C --> A-B\n subgraph G[Group]\n D[Inside]\n end\n C --> D';
const GROUP_SOURCE='flowchart LR\n A[Start] --> G\n subgraph G[Group]\n B[Inside]\n end\n G --> C[End]';
const customSource='flowchart LR\n A_B[First] ab@--> C_D[Second]\n A[Third] ac@--> B_C_D[Fourth]';
const browserOptions={headless:true,...(process.env.MERMAID_HIGHLIGHTS_CHROMIUM_EXECUTABLE?{executablePath:process.env.MERMAID_HIGHLIGHTS_CHROMIUM_EXECUTABLE}:{})};
async function withBrowser(fn){const pw=createRequire(import.meta.url)(process.env.MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE),browser=await pw.chromium.launch(browserOptions);try{await fn(browser)}finally{await browser.close()}}
async function setup(browser,source=SOURCE,options={}){
  const page=await browser.newPage({viewport:{width:1100,height:800},...options}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><div id="diagram"></div><p id="status">Initial status</p>');
  await page.addScriptTag({content:fs.readFileSync(process.env.MERMAID_HIGHLIGHTS_MERMAID_BUNDLE,'utf8')});
  await page.addScriptTag({content:`const INTERACTIVE_SVG_STYLE=${JSON.stringify(INTERACTIVE_SVG_STYLE)};const installInteractiveSvg=(${installInteractiveSvg.toString()});const readMermaidFlowchartModel=(${readMermaidFlowchartModel.toString()});const requireMountedFlowchart=(${requireMountedFlowchart.toString()});const installValidatedBindings=(${installValidatedBindings.toString()});const attachMermaidHighlights=(${attachMermaidHighlights.toString()});const attachPreparedSvgHighlights=(${attachPreparedSvgHighlights.toString()});`});
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
  assert.equal(await page.locator('g[data-node]').count(),4);assert.equal(await page.locator('.edge-hit').count(),4);
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

test('a source group endpoint binds to its actual Mermaid cluster and traces both connectors', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,GROUP_SOURCE);
  assert.equal(await page.locator('g.cluster[data-node="G"][data-group="G"]').count(),1);
  assert.equal(await page.locator('path.flowchart-link[data-edge]').count(),2);
  const border=await page.locator('.node-hit[data-hit-group="G"]').evaluate(e=>{const p=e.getPointAtLength(4),m=e.getScreenCTM(),v=new DOMPoint(p.x,p.y).matrixTransform(m);return {x:v.x,y:v.y}});
  await page.mouse.move(border.x,border.y);
  const hovered=await state(page);
  assert.equal(hovered.kind,'none');
  assert.equal(hovered.edges.length,2);
  assert.deepEqual(hovered.nodes,['A','B','C','G']);
  await page.mouse.click(border.x,border.y);
  assert.equal((await state(page)).kind,'group');
  assert.match(await page.locator('g.cluster[data-group="G"]').getAttribute('aria-label'),/^Trace group /);
  // Members kept by containment are not connector neighbours.
  assert.match(await page.locator('#status').textContent(),/: 2 incident connectors; 2 neighboring nodes\.$/);
  assert.deepEqual(errors,[]);
}));

test('flowchart model keeps subgraph membership as a detached copy of Mermaid state',()=>{
  const subgraphs=[{id:'Inner',nodes:['D']},{id:'G',nodes:['B','Inner']}];
  const model=readMermaidFlowchartModel({type:'flowchart-v2',db:{
    getVertices:()=>new Map([['B',{id:'B',domId:'flowchart-B-0'}],['D',{id:'D',domId:'flowchart-D-1'}]]),
    getEdges:()=>[],getSubGraphs:()=>subgraphs}});
  assert.deepEqual(model.groups,[{id:'Inner',nodes:['D']},{id:'G',nodes:['B','Inner']}]);
  subgraphs[1].nodes.push('changed');subgraphs[0].id='changed';
  assert.deepEqual(model.groups,[{id:'Inner',nodes:['D']},{id:'G',nodes:['B','Inner']}]);
});

const MEMBER_SOURCE='flowchart LR\n A[Start] --> B\n subgraph G[Group]\n B[Inside] --> D[Also inside]\n end';
const NESTED_SOURCE='flowchart LR\n A[Start] --> B\n subgraph Outer[Outer]\n B[Inside] --> C[Sibling]\n subgraph Inner[Inner]\n D[Deep] --> E[Deeper]\n end\n end\n E --> F[Elsewhere]';
const inactive=(page,selector)=>page.locator(selector).evaluate(e=>e.classList.contains('interaction-inactive'));
const borderPoint=(page,id)=>page.locator(`.node-hit[data-hit-group="${id}"]`).evaluate(e=>{const p=e.getPointAtLength(4),m=e.getScreenCTM(),v=new DOMPoint(p.x,p.y).matrixTransform(m);return {x:v.x,y:v.y}});

test('tracing a node keeps every enclosing subgraph frame and title visible', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,MEMBER_SOURCE);
  await page.locator('.node-hit[data-hit-node="B"]').click();
  assert.equal((await state(page)).kind,'node');
  assert.equal(await inactive(page,'g.cluster[data-group="G"]'),false);
  assert.equal(await page.locator('g.cluster[data-group="G"]').evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.keyboard.press('Escape');
  await page.mouse.move(1000,700);
  const deep=await setup(browser,NESTED_SOURCE);
  await deep.page.locator('.node-hit[data-hit-node="E"]').click();
  for(const id of ['Inner','Outer'])assert.equal(await inactive(deep.page,`g.cluster[data-group="${id}"]`),false,`${id} faded`);
  assert.equal(await inactive(deep.page,'g[data-node="C"]'),true);
  assert.deepEqual(errors,[]);assert.deepEqual(deep.errors,[]);
}));

test('tracing a subgraph keeps its members and never paints the filled frame over them', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,MEMBER_SOURCE);
  const border=await borderPoint(page,'G');
  await page.mouse.click(border.x,border.y);
  assert.equal((await state(page)).kind,'group');
  for(const id of ['B','D'])assert.equal(await inactive(page,`g[data-node="${id}"]`),false,`${id} faded`);
  assert.equal(await page.locator('.interaction-node-overlay-layer .active-node-overlay .cluster').count(),0);
  // A group that is only a connector neighbour is kept, but its filled frame must not cover members either.
  await page.keyboard.press('Escape');
  await page.locator('.node-hit[data-hit-node="A"]').click();
  assert.equal(await inactive(page,'g.cluster[data-group="G"]'),false);
  assert.equal(await page.locator('.interaction-node-overlay-layer .active-node-overlay .cluster').count(),0);
  assert.deepEqual(errors,[]);
}));

test('tracing a nested subgraph keeps members and nested boxes at every level and its outer frames', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,NESTED_SOURCE);
  const outer=await borderPoint(page,'Outer');
  await page.mouse.click(outer.x,outer.y);
  assert.equal((await state(page)).kind,'group');
  assert.deepEqual((await state(page)).nodes,['B','C','D','E','Inner','Outer']);
  await page.keyboard.press('Escape');
  const inner=await borderPoint(page,'Inner');
  await page.mouse.click(inner.x,inner.y);
  assert.equal((await state(page)).kind,'group');
  assert.deepEqual((await state(page)).nodes,['D','E','Inner','Outer']);
  assert.deepEqual(errors,[]);
}));

// Cost model for tracing a subgraph. Painting a node deep-clones it and copies its computed styles, so the
// cost must follow the connectors, not the subgraph size. A member kept only because its subgraph is traced
// is un-faded where it already sits and never cloned. These tests count clones; they do not time anything.
const SPARSE_SOURCE='flowchart LR\n A[Start] --> G\n subgraph G[Group]\n B[Alpha] --> D[Beta]\n E[Gamma]\n F[Delta]\n end\n G --> C[End]';
const CONTAINED=['B','D','E','F'];
// Opacity a viewer actually sees: the product along the ancestor chain.
const visibleOpacity=(page,selector)=>page.locator(selector).evaluate(el=>{let o=1;for(let e=el;e&&e.nodeType===1;e=e.parentElement)o*=Number(getComputedStyle(e).opacity);return o});
const overlayTexts=page=>page.evaluate(()=>[...document.querySelectorAll('.interaction-node-overlay-layer > .active-node-overlay')].map(e=>e.textContent.trim()).sort());
// Records the data-node of every element passed to a deep cloneNode, which is how paintNode copies a node.
const countNodeClones=page=>page.evaluate(()=>{
  window.deepClones=[];const original=Node.prototype.cloneNode;window.restoreCloneNode=()=>{Node.prototype.cloneNode=original};
  Node.prototype.cloneNode=function(deep){if(deep&&this.dataset?.node)window.deepClones.push(this.dataset.node);return original.call(this,deep)};
});

test('tracing a subgraph clones only its edge-connected nodes and keeps the rest visible in place', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,SPARSE_SOURCE);
  const border=await borderPoint(page,'G');
  await page.mouse.click(border.x,border.y);
  assert.equal((await state(page)).kind,'group');
  assert.deepEqual((await state(page)).nodes,['A','B','C','D','E','F','G']);
  // Members, their frames and the subgraph title stay at full strength without a copy.
  for(const id of CONTAINED){
    assert.equal(await inactive(page,`g[data-node="${id}"]`),false,`${id} faded`);
    assert.equal(await visibleOpacity(page,`g[data-node="${id}"]`),1,`${id} dimmed`);
  }
  assert.equal(await visibleOpacity(page,'g.cluster[data-group="G"]'),1);
  assert.equal(await visibleOpacity(page,'g.cluster[data-group="G"] .cluster-label'),1);
  assert.deepEqual(await overlayTexts(page),['End','Start']);
  assert.deepEqual(errors,[]);
}));

test('with a subgraph selected, crossing other nodes never repaints its contained members', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,SPARSE_SOURCE);
  const border=await borderPoint(page,'G');
  await page.mouse.click(border.x,border.y);
  assert.equal((await state(page)).kind,'group');
  await countNodeClones(page);
  try{
    // Every pointerenter and pointerleave repaints the selection.
    for(const id of ['B','A','E','C'])await page.locator(`.node-hit[data-hit-node="${id}"]`).hover();
    await page.mouse.move(1000,700);
  }finally{await page.evaluate(()=>window.restoreCloneNode())}
  const cloned=await page.evaluate(()=>window.deepClones);
  // The instrument works: connected nodes are still repainted on each pass.
  assert.ok(cloned.includes('A')&&cloned.includes('C'),JSON.stringify(cloned));
  const memberClones=cloned.filter(id=>CONTAINED.includes(id));
  assert.equal(memberClones.length,0,`${memberClones.length} of ${cloned.length} deep clones were contained members`);
  assert.equal((await state(page)).kind,'group');
  assert.deepEqual(await overlayTexts(page),['End','Start']);
  for(const id of CONTAINED)assert.equal(await visibleOpacity(page,`g[data-node="${id}"]`),1,`${id} dimmed`);
  assert.deepEqual(errors,[]);
}));

test('prepared SVG tracing a subgraph also clones only its edge-connected nodes', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,GROUP_SOURCE);
  await page.evaluate(()=>{
    window.control.destroy();
    document.getElementById('diagram').innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" width="480" height="300">
      <g data-group="G"><rect x="180" y="20" width="120" height="260" fill="none" stroke="black"/></g>
      <g data-node="A"><rect x="20" y="130" width="80" height="40"/><text x="30" y="155">Start</text></g>
      <g data-node="B"><rect x="200" y="50" width="80" height="40"/><text x="210" y="75">Alpha</text></g>
      <g data-node="E"><rect x="200" y="130" width="80" height="40"/><text x="210" y="155">Gamma</text></g>
      <g data-node="F"><rect x="200" y="210" width="80" height="40"/><text x="210" y="235">Delta</text></g>
      <g data-node="C"><rect x="380" y="130" width="80" height="40"/><text x="390" y="155">End</text></g>
      <path data-edge="prepared-1" data-source="A" data-target="G" d="M100 150L180 150" stroke="black"/>
      <path data-edge="prepared-2" data-source="G" data-target="C" d="M300 150L380 150" stroke="black"/>
    </svg>`;
    window.prepared=document.querySelector('svg');
    const node=id=>({id}),model={type:'flowchart-v2',nodes:['A','B','E','F','C'].map(node),edges:[{id:'p1',source:'A',target:'G'},{id:'p2',source:'G',target:'C'}],groups:[{id:'G',nodes:['B','E','F']}]};
    window.control=attachPreparedSvgHighlights(window.prepared,model);
  });
  await countNodeClones(page);
  await page.locator('#diagram .node-hit[data-hit-group="G"]').dispatchEvent('click');
  const cloned=await page.evaluate(()=>{window.restoreCloneNode();return window.deepClones});
  assert.deepEqual(cloned.sort(),['A','C']);
  assert.deepEqual(await overlayTexts(page),['End','Start']);
  for(const id of ['B','E','F']){
    assert.equal(await inactive(page,`g[data-node="${id}"]`),false,`${id} faded`);
    assert.equal(await visibleOpacity(page,`g[data-node="${id}"]`),1,`${id} dimmed`);
  }
  assert.deepEqual(errors,[]);
}));

// Mermaid draws a subgraph that has no members as one plain node (id `<svg id>-<subgraph id>`), not as a cluster
// frame. The model still lists it as a group, so it must bind as the node it is drawn as. Refusing the whole
// diagram because of it would switch relationship highlighting off for every other node and connector.
const EMPTY_SOURCE='flowchart LR\n A[Start] --> B[End]\n subgraph E[Empty]\n end';
const EMPTY_LINKED_SOURCE='flowchart LR\n A[Start] --> E\n subgraph E[Empty]\n end';
const EMPTY_NESTED_SOURCE='flowchart LR\n A[Start] --> B[End]\n subgraph O[Outer]\n subgraph I[Inner]\n end\n C[Sibling]\n end';

test('an empty subgraph binds as a node and the rest of the diagram still highlights', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,EMPTY_SOURCE);
  // Drawn as a node, so no group frame is bound for it.
  assert.equal(await page.locator('g.cluster').count(),0);
  assert.equal(await page.locator('g[data-node="E"]').count(),1);
  assert.equal(await page.locator('g[data-node="E"][data-group]').count(),0);
  assert.equal(await page.locator('.node-hit[data-hit-node="E"]').count(),1);
  assert.equal(await page.evaluate(()=>window.control.nodeCount),3);
  assert.equal(await page.evaluate(()=>window.control.edgeCount),1);
  await page.locator('.node-hit[data-hit-node="A"]').hover();
  assert.equal((await state(page)).edges.length,1);
  assert.deepEqual((await state(page)).nodes,['A','B']);
  assert.equal(await inactive(page,'g[data-node="E"]'),true);
  await page.locator('.node-hit[data-hit-node="E"]').click();
  assert.deepEqual(await state(page),{edges:[],nodes:['E'],kind:'node'});
  assert.equal(await inactive(page,'g[data-node="A"]'),true);
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).kind,'none');
  // Destroying restores the Mermaid SVG exactly, including the node that stands for the empty subgraph.
  await page.evaluate(()=>window.control.destroy());
  assert.equal(await page.evaluate(()=>document.querySelector('svg').outerHTML===window.originalSvg),true);
  assert.deepEqual(errors,[]);
}));

test('a connector that ends at an empty subgraph is traced from both ends', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,EMPTY_LINKED_SOURCE);
  assert.equal(await page.locator('path.flowchart-link[data-edge]').count(),1);
  await page.locator('.node-hit[data-hit-node="E"]').click();
  assert.deepEqual(await state(page),{edges:await page.evaluate(()=>[document.querySelector('path[data-edge]').dataset.edge]),nodes:['A','E'],kind:'node'});
  // It is a node joined by a traced connector, so it is painted above the connector like any other.
  assert.deepEqual(await overlayTexts(page),['Empty','Start']);
  await page.keyboard.press('Escape');
  await page.locator('.node-hit[data-hit-node="A"]').hover();
  assert.deepEqual((await state(page)).nodes,['A','E']);
  assert.deepEqual(errors,[]);
}));

test('an empty subgraph inside another keeps the enclosing frame, and a traced frame keeps it without a copy', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,EMPTY_NESTED_SOURCE);
  assert.equal(await page.locator('g.cluster[data-group="O"]').count(),1);
  assert.equal(await page.locator('g[data-node="I"]:not([data-group])').count(),1);
  await page.locator('.node-hit[data-hit-node="I"]').click();
  assert.deepEqual((await state(page)).nodes,['I','O']);
  assert.equal(await inactive(page,'g.cluster[data-group="O"]'),false);
  assert.equal(await inactive(page,'g[data-node="C"]'),true);
  await page.keyboard.press('Escape');
  const outer=await borderPoint(page,'O');
  await countNodeClones(page);
  try{await page.mouse.click(outer.x,outer.y)}finally{await page.evaluate(()=>window.restoreCloneNode())}
  assert.equal((await state(page)).kind,'group');
  assert.deepEqual((await state(page)).nodes,['C','I','O']);
  for(const id of ['C','I']){
    assert.equal(await inactive(page,`g[data-node="${id}"]`),false,`${id} faded`);
    assert.equal(await visibleOpacity(page,`g[data-node="${id}"]`),1,`${id} dimmed`);
  }
  // Nothing in the outer frame is joined by a connector, so nothing is copied.
  assert.deepEqual(await page.evaluate(()=>window.deepClones),[]);
  assert.deepEqual(await overlayTexts(page),[]);
  assert.deepEqual(errors,[]);
}));

test('a subgraph that Mermaid drew as neither a frame nor its own node is still refused', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,MEMBER_SOURCE);
  const result=await page.evaluate(()=>{
    window.control.destroy();
    const svg=document.querySelector('svg'),failures=[];
    const expectFailure=(label,change)=>{
      const bad=structuredClone(window.model);change(bad);const before=svg.outerHTML;
      try{attachMermaidHighlights(svg,bad);failures.push(`${label}: false pass`)}catch(e){failures.push(`${label}: ${e.message}`)}
      if(svg.outerHTML!==before)failures.push(`${label}: mutation`);
    };
    expectFailure('empty, nothing drawn',m=>m.groups.push({id:'Ghost',nodes:[]}));
    expectFailure('with members, nothing drawn',m=>m.groups.push({id:'Ghost',nodes:['B']}));
    // Only a subgraph with no members may stand on a node: one with members must have been drawn as a frame.
    expectFailure('with members, id of a drawn node',m=>m.groups.push({id:'flowchart-A-0',nodes:['B']}));
    // A node that already belongs to a vertex is not available to an empty subgraph.
    expectFailure('empty, id of a drawn node',m=>m.groups.push({id:'flowchart-A-0',nodes:[]}));
    return failures;
  });
  assert.equal(result.length,4);
  assert.match(result[0],/^empty, nothing drawn: MERMAID_HIGHLIGHTS_GROUP_BINDING_UNRESOLVED:Ghost$/);
  assert.match(result[1],/^with members, nothing drawn: MERMAID_HIGHLIGHTS_GROUP_BINDING_UNRESOLVED:Ghost$/);
  assert.match(result[2],/^with members, id of a drawn node: MERMAID_HIGHLIGHTS_GROUP_BINDING_UNRESOLVED:flowchart-A-0$/);
  // Whichever check refuses it first, it is refused with a highlight error and the SVG is left untouched.
  assert.match(result[3],/^empty, id of a drawn node: MERMAID_HIGHLIGHTS_[A-Z_]+/);
  assert.deepEqual(errors,[]);
}));

test('prepared SVG binds every source node, group and directed connector before enabling hover', {skip:!enabled},async()=>withBrowser(async browser=>{
  const {page,errors}=await setup(browser,GROUP_SOURCE);
  await page.evaluate(()=>{
    window.control.destroy();
    document.getElementById('diagram').innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 220" width="480" height="220">
      <g data-group="G"><rect x="180" y="30" width="120" height="150" fill="none" stroke="black"/></g>
      <g data-node="A"><rect x="20" y="80" width="80" height="40"/><text x="30" y="105">Start</text></g>
      <g data-node="B"><rect x="200" y="80" width="80" height="40"/><text x="210" y="105">Inside</text></g>
      <g data-node="C"><rect x="380" y="80" width="80" height="40"/><text x="390" y="105">End</text></g>
      <path data-edge="prepared-1" data-source="A" data-target="G" d="M100 100L180 100" stroke="black"/>
      <path data-edge="prepared-2" data-source="G" data-target="C" d="M300 100L380 100" stroke="black"/>
    </svg>`;
    window.prepared=document.querySelector('svg');
    window.control=attachPreparedSvgHighlights(window.prepared,window.model);
  });
  assert.equal(await page.evaluate(()=>window.control.nodeCount),4);
  assert.equal(await page.evaluate(()=>window.prepared.querySelectorAll('.edge-hit').length),2);
  await page.locator('#diagram .node-hit[data-hit-group="G"]').dispatchEvent('click');
  assert.deepEqual(await page.evaluate(()=>[...window.prepared.querySelectorAll('path[data-edge].is-active')].map(e=>e.dataset.edge).sort()),['prepared-1','prepared-2']);
  await page.evaluate(()=>window.control.destroy());
  const result=await page.evaluate(()=>{
    const svg=window.prepared, failures=[];
    const expectFailure=(change,restore)=>{change();const before=svg.outerHTML;try{attachPreparedSvgHighlights(svg,window.model);failures.push('false pass')}catch(e){failures.push(e.message)}if(svg.outerHTML!==before)failures.push('mutation');restore()};
    const a=svg.querySelector('g[data-node="A"]'),edge=svg.querySelector('path[data-edge="prepared-1"]'),group=svg.querySelector('g[data-group="G"]');
    expectFailure(()=>a.dataset.node='B',()=>a.dataset.node='A');
    expectFailure(()=>edge.dataset.target='C',()=>edge.dataset.target='G');
    expectFailure(()=>edge.removeAttribute('data-source'),()=>edge.dataset.source='A');
    expectFailure(()=>group.removeAttribute('data-group'),()=>group.dataset.group='G');
    return failures;
  });
  assert.equal(result.length,4);for(const failure of result)assert.match(failure,/MAGIC_HIGHLIGHTS_/);
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
  assert.equal(await page.locator('.node-hit').count(),4);
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
  await page.evaluate(()=>window.control=attachMermaidHighlights(document.querySelector('svg'),window.model));
  await page.locator('.node-hit[data-hit-node="A-B"]').click();
  assert.ok(await page.locator('.interaction-inactive').count()>0);
  await page.evaluate(()=>window.control.destroy());
  assert.equal(await page.locator('.interaction-inactive,.active-node-overlay,.active-edge-overlay,.node-hit,.edge-hit').count(),0);
  assert.equal(await page.evaluate(()=>document.querySelector('svg').outerHTML===window.originalSvg),true);
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
