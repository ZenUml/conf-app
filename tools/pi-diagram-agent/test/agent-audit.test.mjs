import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditAgentSvg} from '../src/agent-audit.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const source='flowchart LR\n  A[Start] --> B[Finish]\n';
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><defs><style>rect:not([fill]){fill:#fff}</style><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs><g data-node="A"><rect x="10" y="50" width="100" height="60"/><text x="20" y="80">Start</text></g><g data-node="B"><rect x="400" y="50" width="100" height="60"/><text x="410" y="80">Finish</text></g><path data-source="A" data-target="B" d="M110 80 L400 80" stroke="black" fill="none" marker-end="url(#arrow)"/></svg>`;

test('agent audit accepts historical-style neutral bindings without old data-box schema',{skip:!enabled},async()=>{
  // The shared fixture draws text 10 units from its box edge, which T2 (12-unit inset) rejects; fit it here so this test isolates binding.
  const result=await auditAgentSvg(source,svg.replace('x="20" y="80">Start','x="30" y="85">Start').replace('x="410" y="80">Finish','x="430" y="85">Finish'));
  assert.equal(result.status,'NOT-CHECKABLE');
  for(const id of ['nodeIdentity','nodeText','relations','textFit'])assert.equal(result.checks[id].status,'PASS');
  assert.equal(result.checks.routeGeometry.status,'NOT-CHECKABLE');
  assert.equal(result.checks.visualQuality.status,'NOT-CHECKABLE');
});

test('agent audit rejects actual changed label and relation direction',{skip:!enabled},async()=>{
  const badLabel=await auditAgentSvg(source,svg.replace('>Finish</text>','>Wrong</text>'));
  assert.equal(badLabel.checks.nodeText.status,'FAIL');
  const badEdge=await auditAgentSvg(source,svg.replace('data-source="A" data-target="B"','data-source="B" data-target="A"'));
  assert.equal(badEdge.checks.relations.status,'FAIL');
});

test('absence of source-binding metadata is unresolved, not a verdict on visual quality',{skip:!enabled},async()=>{
  const bare=svg.replaceAll(' data-node="A"','').replaceAll(' data-node="B"','').replace(' data-source="A" data-target="B"','');
  const result=await auditAgentSvg(source,bare);
  assert.equal(result.checks.nodeIdentity.status,'NOT-CHECKABLE');
  assert.equal(result.checks.relations.status,'NOT-CHECKABLE');
  assert.equal(result.status,'NOT-CHECKABLE');
});

test('a Mermaid feature outside the narrow legacy parser cannot suppress visual evidence',{skip:!enabled},async()=>{
  const labelled='flowchart LR\n  A[Start] --> B[Finish]\n  A@{ shape: cyl }\n';
  const result=await auditAgentSvg(labelled,svg);
  assert.equal(result.checks.svgWellFormed.status,'PASS');
  assert.equal(result.checks.nodeIdentity.status,'NOT-CHECKABLE');
  assert.match(result.checks.nodeIdentity.evidence,/source parser cannot establish/);
});

test('group membership follows actual drawn containment, not claimed parent metadata',{skip:!enabled},async()=>{
  const grouped='flowchart LR\n subgraph G[Group]\n A[Start]\n end\n B[Finish]\n A --> B\n';
  const drawn=svg.replace('<g data-node="A">','<g data-group="G"><rect x="0" y="20" width="200" height="130"/></g><g data-node="A" data-parent="wrong">');
  const good=await auditAgentSvg(grouped,drawn);
  assert.equal(good.checks.groupMembership.status,'PASS');
  const moved=await auditAgentSvg(grouped,drawn.replace('width="200" height="130"','width="550" height="130"'));
  assert.equal(moved.checks.groupMembership.status,'FAIL');
  assert.deepEqual(moved.checks.groupMembership.evidence.mismatchedNodeIds,['B']);
});

test('actual path leaving and re-entering its source fails sampled node clearance',{skip:!enabled},async()=>{
  const changed=svg.replace('d="M110 80 L400 80"','d="M110 80 L50 80 L400 80"');
  const result=await auditAgentSvg(source,changed);
  assert.equal(result.checks.routeNodeIntrusion.status,'FAIL');
  assert.deepEqual(result.checks.routeNodeIntrusion.evidence.intrusions,[{edge:'A->B',nodeIds:['A']}]);
});

test('actual route endpoint missing its source stroke fails',{skip:!enabled},async()=>{
  const changed=svg.replace('d="M110 80 L400 80"','d="M120 80 L400 80"');
  const result=await auditAgentSvg(source,changed);
  assert.equal(result.checks.routeNodeIntrusion.status,'FAIL');
  assert.deepEqual(result.checks.routeNodeIntrusion.evidence.endpointErrors,['A->B']);
});

test('an invisible or obscured arrowhead cannot pass marker drawing',{skip:!enabled},async()=>{
  const hidden=await auditAgentSvg(source,svg.replace('fill="black"','fill="none"'));
  assert.equal(hidden.checks.markerDrawing.status,'FAIL');
  const extra=await auditAgentSvg(source,svg.replace('</marker>','<rect width="10" height="10" fill="white"/></marker>'));
  assert.equal(extra.checks.markerDrawing.status,'FAIL');
});

test('rendered original grouping overrides a conflicting later source declaration',{skip:!enabled},async()=>{
  const grouped='flowchart LR\n subgraph G[Group]\n A[Start]\n end\n B[Finish]\n A --> B\n';
  const candidate=svg.replace('<g data-node="A">','<g data-group="G"><rect x="0" y="20" width="200" height="130"/></g><g data-node="A">');
  const original=`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><g class="cluster" id="old-G"><rect x="300" y="20" width="250" height="130"/></g><g class="node" id="old-flowchart-A-0"><rect x="10" y="50" width="100" height="60"/></g><g class="node" id="old-flowchart-B-1"><rect x="400" y="50" width="100" height="60"/></g></svg>`;
  const wrong=await auditAgentSvg(grouped,candidate,{originalSvg:original});
  assert.equal(wrong.checks.groupMembership.status,'PASS');
  assert.equal(wrong.checks.originalGroupParity.status,'FAIL');
  assert.deepEqual(wrong.checks.originalGroupParity.evidence.mismatchedNodeIds,['A','B']);
  const visible=await auditAgentSvg(grouped,candidate.replace('x="0" y="20" width="200"','x="300" y="20" width="250"'),{originalSvg:original});
  assert.equal(visible.checks.originalGroupParity.status,'PASS');
  assert.equal(visible.checks.groupMembership.status,'FAIL');
  assert.equal(visible.checks.semanticPreservation.status,'FAIL');
  assert.deepEqual(visible.checks.semanticPreservation.evidence.sourceDeclarationConflictNodeIds,['A','B']);
});

test('actual distinct post-fillet straight spans under ten units apart fail',{skip:!enabled},async()=>{
  const two='flowchart LR\n A[Start] --> B[Finish]\n A --> C[Other]\n';
  const drawn=svg.replace('</svg>','<g data-node="C"><rect x="400" y="59" width="100" height="60"/><text x="410" y="89">Other</text></g><path data-source="A" data-target="C" d="M110 89 L400 89" stroke="black" fill="none" marker-end="url(#arrow)"/></svg>');
  const result=await auditAgentSvg(two,drawn);
  assert.equal(result.checks.routePairClearance.status,'FAIL');
  assert.equal(result.checks.routePairClearance.evidence.violations[0].separation,9);
});

test('actual short final straight shaft fails against measured marker axial length',{skip:!enabled},async()=>{
  const short=svg.replace('x="400" y="50" width="100"','x="120" y="50" width="100"').replace('x="410" y="80"','x="130" y="80"').replace('d="M110 80 L400 80"','d="M110 80 L120 80"');
  const result=await auditAgentSvg(source,short);
  assert.equal(result.checks.arrowShaft.status,'FAIL');
  assert.equal(result.checks.arrowShaft.evidence.failures[0].required,18);
});

test('computed dashed relation style must match the Mermaid relationship',{skip:!enabled},async()=>{
  const dashed='flowchart LR\n A[Start] -.-> B[Finish]\n';
  const wrong=await auditAgentSvg(dashed,svg);
  assert.equal(wrong.checks.relationStyle.status,'FAIL');
  const right=await auditAgentSvg(dashed,svg.replace('stroke="black" fill="none" marker-end','stroke="black" stroke-dasharray="6 4" fill="none" marker-end'));
  assert.equal(right.checks.relationStyle.status,'PASS');
});

test('two actual orthogonal connector interiors cannot cross unnoticed',{skip:!enabled},async()=>{
  const crossingSource='flowchart LR\n A[Start] --> B[Finish]\n C[Up] --> D[Down]\n';
  const crossingSvg=svg.replace('</svg>','<g data-node="C"><rect x="220" y="0" width="100" height="40"/><text x="230" y="25">Up</text></g><g data-node="D"><rect x="220" y="120" width="100" height="40"/><text x="230" y="145">Down</text></g><path data-source="C" data-target="D" d="M270 40 L270 120" stroke="black" fill="none" marker-end="url(#arrow)"/></svg>');
  const result=await auditAgentSvg(crossingSource,crossingSvg);
  assert.equal(result.checks.routeCrossings.status,'FAIL');
  const {repairHint,reason,...at}=result.checks.routeCrossings.evidence.violations[0];
  assert.deepEqual(at,{edgeA:'A->B',edgeB:'C->D',x:270,y:80});
  assert.ok(repairHint===null?typeof reason==='string':repairHint.edge&&repairHint.points.length>=2); // every crossing carries a hint or a reason
});

test('a path ending in a curve cannot borrow an earlier straight span for arrow clearance',{skip:!enabled},async()=>{
  const curved=svg.replace('d="M110 80 L400 80"','d="M110 80 L380 80 Q390 80 400 80"');
  const result=await auditAgentSvg(source,curved);
  assert.equal(result.checks.arrowShaft.status,'NOT-CHECKABLE');
});

test('a connector through actual group heading text fails clearance',{skip:!enabled},async()=>{
  const grouped='flowchart LR\n subgraph G[Group]\n A[Start]\n end\n B[Finish]\n A --> B\n';
  const drawn=svg.replace('<g data-node="A">','<g data-group="G"><rect x="0" y="20" width="200" height="130"/><text x="145" y="79">Heading</text></g><g data-node="A">');
  const result=await auditAgentSvg(grouped,drawn);
  assert.equal(result.checks.routeHeadingClearance.status,'FAIL');
  assert.deepEqual(result.checks.routeHeadingClearance.evidence.intrusions,[{edge:'A->B',groupIds:['G']}]);
});

test('a straight connector through an unrelated drawn container fails routing transit',{skip:!enabled},async()=>{
  const grouped='flowchart LR\n subgraph G[Group]\n C[Middle]\n end\n A[Start] --> B[Finish]\n';
  const drawn=svg.replace('<g data-node="A">','<g data-group="G"><rect x="200" y="20" width="100" height="130"/></g><g data-node="C"><rect x="220" y="30" width="60" height="30"/><text x="225" y="50">Middle</text></g><g data-node="A">');
  const result=await auditAgentSvg(grouped,drawn);
  assert.equal(result.checks.routeUnrelatedContainerTransit.status,'FAIL');
  assert.deepEqual(result.checks.routeUnrelatedContainerTransit.evidence.violations.map(v=>v.groupId),['G']);
  const related=drawn.replace('x="200" y="20" width="100"','x="0" y="20" width="200"').replace('x="220" y="30"','x="120" y="30"');
  const relatedSource='flowchart LR\n subgraph G[Group]\n A[Start]\n C[Middle]\n end\n A --> B[Finish]\n';
  const allowed=await auditAgentSvg(relatedSource,related);
  assert.equal(allowed.checks.routeUnrelatedContainerTransit.status,'PASS');
});

test('conservative curve envelopes prove a clear bypass but leave a possible container hit unresolved',{skip:!enabled},async()=>{
  const grouped='flowchart LR\n subgraph G[Group]\n C[Middle]\n end\n A[Start] --> B[Finish]\n';
  const drawn=svg.replace('<g data-node="A">','<g data-group="G"><rect x="200" y="20" width="100" height="130" rx="12"/></g><g data-node="C"><rect x="220" y="30" width="60" height="30"/><text x="225" y="50">Middle</text></g><g data-node="A">');
  const bypass=drawn.replace('d="M110 80 L400 80"','d="M110 80 L150 80 L150 0 Q150 -10 160 -10 L350 -10 Q360 -10 360 0 L360 80 L400 80"');
  assert.equal((await auditAgentSvg(grouped,bypass)).checks.routeUnrelatedContainerTransit.status,'PASS');
  const uncertain=drawn.replace('d="M110 80 L400 80"','d="M110 80 L180 80 Q250 0 320 80 L400 80"');
  assert.equal((await auditAgentSvg(grouped,uncertain)).checks.routeUnrelatedContainerTransit.status,'NOT-CHECKABLE');
});

// ---- textFit (T2 / labelBox) -------------------------------------------------
test('textFit passes text inside a rectangular node inset by 12 units',{skip:!enabled},async()=>{
  const fit=svg.replace('x="20" y="80">Start','x="30" y="85">Hi').replace('x="410" y="80">Finish','x="430" y="85">Ok');
  const result=await auditAgentSvg(source,fit);
  assert.equal(result.checks.textFit.status,'PASS');
  assert.deepEqual(result.checks.textFit.evidence.overflows,[]);
});

test('textFit fails text running to its own box border and names node and amount',{skip:!enabled},async()=>{
  // Node A text starts at the rect edge (x=10), so it overflows the 12-unit inset by 12 on the left.
  const result=await auditAgentSvg(source,svg.replace('x="20" y="80">Start','x="10" y="85">Start').replace('x="410" y="80">Finish','x="430" y="85">Ok'));
  assert.equal(result.checks.textFit.status,'FAIL');
  const [overflow]=result.checks.textFit.evidence.overflows;
  assert.equal(overflow.nodeId,'A');
  assert.ok(Math.abs(overflow.left-12)<0.5,`left overflow ${overflow.left}`);
  assert.equal(result.status,'FAIL');
});

test('textFit is NOT-CHECKABLE for a non-rectangular node without a declared labelBox',{skip:!enabled},async()=>{
  const diamond=svg.replace('<rect x="10" y="50" width="100" height="60"/><text x="20" y="80">Start</text>','<polygon points="60,40 120,80 60,120 0,80"/><text x="45" y="85">Hi</text>').replace('x="410" y="80">Finish','x="430" y="85">Ok');
  const result=await auditAgentSvg(source,diamond);
  assert.equal(result.checks.textFit.status,'NOT-CHECKABLE');
  assert.deepEqual(result.checks.textFit.evidence.notCheckableNodeIds,['A']);
  const declared=await auditAgentSvg(source,diamond.replace('<g data-node="A">','<g data-node="A" data-label-box="30 65 60 30">'));
  assert.equal(declared.checks.textFit.status,'PASS');
  const overflowing=await auditAgentSvg(source,diamond.replace('<g data-node="A">','<g data-node="A" data-label-box="50 65 8 30">'));
  assert.equal(overflowing.checks.textFit.status,'FAIL');
});

// ---- textFit vs drawn structure (cylinder lid, queue bars) -------------------
const cylinderNode=(box,textY)=>`<g data-node="A" data-shape="store" data-label-box="${box}"><path d="M10 60 C10 44 130 44 130 60 L130 140 C130 156 10 156 10 140 Z" fill="#fff" stroke="#000" stroke-width="2"/><path d="M10 60 C10 76 130 76 130 60" fill="none" stroke="#000" stroke-width="2"/><text x="70" y="${textY}" text-anchor="middle" dominant-baseline="central" font-size="16">Hi</text></g>`;
const withCylinder=(box,textY)=>svg.replace(/<g data-node="A">.*?<\/g>/,cylinderNode(box,textY)).replace('x="410" y="80">Finish','x="430" y="85">Ok');

test('textFit fails text drawn over the cylinder lid arc and names the stroke gap',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(source,withCylinder('22 90 96 40',72)); // text centred on the lid arc (peak y=72)
  assert.equal(result.checks.textFit.status,'FAIL');
  const [hit]=result.checks.textFit.evidence.structureOverlaps;
  assert.equal(hit.nodeId,'A');
  assert.ok(hit.gap<4,`gap ${hit.gap}`);
  assert.equal(result.status,'FAIL');
});

test('textFit reports a labelBox overlapping the cylinder lid as a non-blocking warning when the text is clear',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(source,withCylinder('22 62 96 80',110)); // box top 62 is above the lid peak 72; text at y=110 is clear
  assert.equal(result.checks.textFit.status,'PASS');
  assert.deepEqual(result.checks.textFit.evidence.structureOverlaps,[]);
  assert.deepEqual(result.checks.textFit.evidence.labelBoxWarnings.map(x=>x.nodeId),['A']);
  assert.match(result.checks.textFit.evidence.labelBoxWarnings[0].reason,/label box overlaps shape structure/);
});

test('textFit still FAILs when the text is on the lid and also reports the labelBox warning',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(source,withCylinder('22 62 96 80',72));
  assert.equal(result.checks.textFit.status,'FAIL');
  assert.ok(result.checks.textFit.evidence.structureOverlaps.length>0);
});

test('textFit passes a cylinder whose labelBox and text sit below the lid with 4 units clearance',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(source,withCylinder('22 90 96 40',110));
  assert.equal(result.checks.textFit.status,'PASS');
  assert.deepEqual(result.checks.textFit.evidence.structureOverlaps,[]);
  assert.deepEqual(result.checks.textFit.evidence.labelBoxWarnings,[]);
});

test('textFit warns (non-blocking) about a queue labelBox that contains an inner bar',{skip:!enabled},async()=>{
  const queue=(box)=>`<g data-node="A" data-shape="queue" data-label-box="${box}"><rect x="10" y="50" width="200" height="60" rx="4" fill="#fff" stroke="#000" stroke-width="2"/><line x1="26" y1="50" x2="26" y2="110" stroke="#000" stroke-width="2"/><line x1="194" y1="50" x2="194" y2="110" stroke="#000" stroke-width="2"/><text x="110" y="80" text-anchor="middle" dominant-baseline="central" font-size="16">Hi</text></g>`;
  const mk=box=>svg.replace(/<g data-node="A">.*?<\/g>/,queue(box)).replace('x="410" y="80">Finish','x="430" y="85">Ok');
  const bad=await auditAgentSvg(source,mk('22 62 176 36')); // left edge 22 is left of the bar at x=26
  assert.equal(bad.checks.textFit.status,'PASS');
  assert.deepEqual(bad.checks.textFit.evidence.labelBoxWarnings.map(x=>x.nodeId),['A']);
  const good=await auditAgentSvg(source,mk('34 62 152 36'));
  assert.equal(good.checks.textFit.status,'PASS');
});

// ---- nodeHeadingClearance (node outline vs group heading, own container margin) ----
const headingSource='flowchart LR\n subgraph G[Group]\n A[Start]\n end\n B[Finish]\n A --> B\n';
// Group G outline (0,0)-(260,160), heading text near the top-left; node A is the standard rect moved to y=nodeY. Text 14px high at y=heading baseline.
const headed=({nodeY,nodeX=30,headingX=20})=>svg.replace('<g data-node="A">',`<g data-group="G"><rect x="0" y="0" width="260" height="170" fill="none" stroke="#999"/><text x="${headingX}" y="22" font-size="16">Heading</text></g><g data-node="A">`)
  .replace('<rect x="10" y="50" width="100" height="60"/><text x="20" y="80">Start</text>',`<rect x="${nodeX}" y="${nodeY}" width="100" height="60"/><text x="${nodeX+20}" y="${nodeY+35}">Hi</text>`)
  .replace('M110 80 L400 80',`M${nodeX+100} ${nodeY+30} L400 ${nodeY+30}`).replace('x="410" y="80">Finish','x="430" y="85">Ok');

test('nodeHeadingClearance fails a node box pressed against its group heading and lists node, heading and gap',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(headingSource,headed({nodeY:32}));
  assert.equal(result.checks.nodeHeadingClearance.status,'FAIL');
  const [v]=result.checks.nodeHeadingClearance.evidence.violations;
  assert.equal(v.nodeId,'A');assert.equal(v.groupId,'G');assert.equal(v.kind,'heading');
  assert.ok(v.gap<8,`gap ${v.gap}`);
  assert.equal(result.status,'FAIL');
});

test('nodeHeadingClearance passes with 8+ units from heading and the container border',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(headingSource,headed({nodeY:50}));
  assert.equal(result.checks.nodeHeadingClearance.status,'PASS',JSON.stringify(result.checks.nodeHeadingClearance.evidence));
  assert.ok(result.checks.nodeHeadingClearance.evidence.checkedNodes>=1);
});

test('nodeHeadingClearance fails a node that touches its own container border (B10)',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(headingSource,headed({nodeY:60,nodeX:3,headingX:150}));
  assert.equal(result.checks.nodeHeadingClearance.status,'FAIL');
  const [v]=result.checks.nodeHeadingClearance.evidence.violations;
  assert.equal(v.kind,'container-border');assert.equal(v.groupId,'G');assert.ok(v.gap<8);
});

test('nodeHeadingClearance ignores a node element that carries data-group membership metadata (it is not a container)',{skip:!enabled},async()=>{
  const tagged=headed({nodeY:50}).replace('<g data-node="A">','<g data-node="A" data-group="G">');
  const result=await auditAgentSvg(headingSource,tagged);
  assert.equal(result.checks.nodeHeadingClearance.status,'PASS',JSON.stringify(result.checks.nodeHeadingClearance.evidence.violations));
});

test('nodeHeadingClearance is NOT-CHECKABLE when a node outline cannot be measured',{skip:!enabled},async()=>{
  const unmeasurable=headed({nodeY:50}).replace('<rect x="30" y="50" width="100" height="60"/>','<rect x="30" y="50" width="100" height="60" transform="rotate(5 80 80)"/>');
  const result=await auditAgentSvg(headingSource,unmeasurable);
  assert.notEqual(result.checks.nodeHeadingClearance.status,'PASS');
});

// ---- labelClearance (B5) -----------------------------------------------------
const labelSource='flowchart LR\n subgraph G[Group]\n A[Start]\n end\n A --> B[Finish]\n';
const labelBase=svg.replace('<g data-node="A">','<g data-group="G"><rect x="0" y="20" width="200" height="130" stroke="black" fill="none"/></g><g data-node="A">');
const label=(x,y,extra='')=>`<g data-edge-label-source="A" data-edge-label-target="B"><rect x="${x-3}" y="${y-16}" width="40" height="22" fill="white"/><text x="${x}" y="${y}">Go</text>${extra}</g>`;
test('labelClearance passes an edge label in open space',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(labelSource,labelBase.replace('</svg>',`${label(260,70)}</svg>`));
  assert.equal(result.checks.labelClearance.status,'PASS');
  assert.deepEqual(result.checks.labelClearance.evidence.violations,[]);
});

test('labelClearance fails a label sitting on a container outline and on a node outline',{skip:!enabled},async()=>{
  const onContainer=await auditAgentSvg(labelSource,labelBase.replace('</svg>',`${label(190,70)}</svg>`));
  assert.equal(onContainer.checks.labelClearance.status,'FAIL');
  assert.deepEqual(onContainer.checks.labelClearance.evidence.violations.map(v=>[v.label,v.outline]),[['A->B','group:G']]);
  assert.equal(onContainer.status,'FAIL');
  const onNode=await auditAgentSvg(labelSource,labelBase.replace('</svg>',`${label(395,70)}</svg>`).replace('<rect x="400" y="50" width="100" height="60"/>','<rect x="400" y="50" width="100" height="60" stroke="black"/>'));
  assert.equal(onNode.checks.labelClearance.status,'FAIL');
  assert.deepEqual(onNode.checks.labelClearance.evidence.violations.map(v=>[v.label,v.outline]),[['A->B','node:B']]);
});

test('labelClearance without bound edge labels is NOT-CHECKABLE when the source has labels',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(labelSource,labelBase);
  assert.equal(result.checks.labelClearance.status,'PASS');
  const unknown=await auditAgentSvg('flowchart LR\n A[Start] -->|Go| B[Finish]\n',svg);
  assert.equal(unknown.checks.labelClearance.status,'NOT-CHECKABLE');
});

// ---- hash-bound adjudication of a declared-vs-rendered membership conflict ----
const adjGrouped='flowchart LR\n subgraph G[Group]\n A[Start]\n end\n B[Finish]\n A --> B\n';
const adjOriginal=`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><g class="cluster" id="old-G"><rect x="300" y="20" width="250" height="130"/></g><g class="node" id="old-flowchart-A-0"><rect x="10" y="50" width="100" height="60"/></g><g class="node" id="old-flowchart-B-1"><rect x="400" y="50" width="100" height="60"/></g></svg>`;
// Candidate keeps the visible original grouping: B in G, A in none (declaration says the opposite).
const adjCandidate=svg.replace('<g data-node="A">','<g data-group="G"><rect x="300" y="20" width="250" height="130"/></g><g data-node="A">');
const adjHash=createHash('sha256').update(adjGrouped).digest('hex');
const rec=(nodeId,declaredGroup,renderedGroup,chosenGroup,over={})=>({nodeId,declaredGroup,renderedGroup,chosenGroup,authorisedBy:'owner@example.test',timestamp:'2026-10-02T00:00:00Z',sourceHash:adjHash,...over});
const records=()=>[rec('A','G',null,null),rec('B',null,'G','G')];

test('a matching hash-bound adjudication yields ADJUDICATED, never PASS',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(adjGrouped,adjCandidate,{originalSvg:adjOriginal,adjudications:records()});
  assert.equal(result.checks.semanticPreservation.status,'ADJUDICATED');
  assert.deepEqual(result.checks.semanticPreservation.evidence.adjudications.map(r=>r.nodeId),['A','B']);
  assert.equal(result.checks.semanticPreservation.evidence.adjudications[0].authorisedBy,'owner@example.test');
  assert.notEqual(result.status,'PASS');
});

test('adjudication cannot rescue a missing, stale or non-matching record',{skip:!enabled},async()=>{
  const none=await auditAgentSvg(adjGrouped,adjCandidate,{originalSvg:adjOriginal});
  assert.equal(none.checks.semanticPreservation.status,'FAIL');
  const stale=await auditAgentSvg(adjGrouped,adjCandidate,{originalSvg:adjOriginal,adjudications:records().map(r=>({...r,sourceHash:'0'.repeat(64)}))});
  assert.equal(stale.checks.semanticPreservation.status,'FAIL');
  assert.match(JSON.stringify(stale.checks.semanticPreservation.evidence.rejectedAdjudications),/sourceHash/);
  // Chosen group G for A, but the candidate draws A outside G.
  const wrongChoice=await auditAgentSvg(adjGrouped,adjCandidate,{originalSvg:adjOriginal,adjudications:[rec('A','G',null,'G'),rec('B',null,'G','G')]});
  assert.equal(wrongChoice.checks.semanticPreservation.status,'FAIL');
  const wrongRendered=await auditAgentSvg(adjGrouped,adjCandidate,{originalSvg:adjOriginal,adjudications:[rec('A','G','G',null),rec('B',null,'G','G')]});
  assert.equal(wrongRendered.checks.semanticPreservation.status,'FAIL');
});

// ---- review fixes: false-PASS paths ------------------------------------------
test('labelClearance is NOT-CHECKABLE when only some source edge labels are bound',{skip:!enabled},async()=>{
  const twoLabels='flowchart LR\n A[Start] -- "Go" --> B[Finish]\n B -- "Back" --> A\n';
  const result=await auditAgentSvg(twoLabels,svg.replace('</svg>',`${label(260,30)}</svg>`));
  assert.equal(result.checks.labelClearance.status,'NOT-CHECKABLE');
  assert.deepEqual(result.checks.labelClearance.evidence.unboundLabels,['B->A']);
});

test('labelClearance fails an edge label sitting entirely inside a node box',{skip:!enabled},async()=>{
  const inside=labelBase.replace('</svg>',`${label(420,85)}</svg>`).replace('<rect x="400" y="50" width="100" height="60"/>','<rect x="400" y="50" width="100" height="60" stroke="black"/>');
  const result=await auditAgentSvg(labelSource,inside);
  assert.equal(result.checks.labelClearance.status,'FAIL');
  assert.deepEqual(result.checks.labelClearance.evidence.violations.map(v=>[v.label,v.outline]),[['A->B','node:B']]);
});

test('textFit does not accept a declared labelBox that is only inside the shape bounding box',{skip:!enabled},async()=>{
  // The full bbox of the diamond: its corners lie outside the diamond itself.
  const diamond=svg.replace('<rect x="10" y="50" width="100" height="60"/><text x="20" y="80">Start</text>','<polygon points="60,40 120,80 60,120 0,80"/><text x="4" y="56">Hi</text>').replace('x="410" y="80">Finish','x="430" y="85">Ok');
  const result=await auditAgentSvg(source,diamond.replace('<g data-node="A">','<g data-node="A" data-label-box="0 40 120 80">'));
  assert.notEqual(result.checks.textFit.status,'PASS');
  assert.deepEqual(result.checks.textFit.evidence.notCheckableNodeIds,['A']);
});

test('textFit is NOT-CHECKABLE for a node with no bound text',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(source,svg.replace('<text x="20" y="80">Start</text>','').replace('x="410" y="80">Finish','x="430" y="85">Ok'));
  assert.equal(result.checks.textFit.status,'NOT-CHECKABLE');
  assert.deepEqual(result.checks.textFit.evidence.notCheckableNodeIds,['A']);
});

test('textFit ignores an unpainted rect when choosing the node outline',{skip:!enabled},async()=>{
  // Text 2 units inside the visible rect would fit only the larger invisible rect's 12-unit inset.
  const padded=svg.replace('<rect x="10" y="50" width="100" height="60"/><text x="20" y="80">Start</text>','<rect x="0" y="40" width="120" height="80" fill="none" stroke="none"/><rect x="10" y="50" width="100" height="60"/><text x="12" y="85">Hi</text>').replace('x="410" y="80">Finish','x="430" y="85">Ok');
  const result=await auditAgentSvg(source,padded);
  assert.equal(result.checks.textFit.status,'FAIL');
});

// A source without groups has no membership to compare. With the original render supplied and showing no clusters, membership
// preservation is vacuously PASS (not "original not supplied"); a cluster in the original that the parser did not see stays NOT-CHECKABLE.
const grouplessOriginal='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><g class="node" id="m-flowchart-A-0"><rect x="10" y="50" width="100" height="60"/></g><g class="node" id="m-flowchart-B-1"><rect x="400" y="50" width="100" height="60"/></g></svg>';
test('group-less source: original supplied with no clusters -> originalGroupParity and semanticPreservation PASS (vacuous, with evidence)',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(source,svg,{originalSvg:grouplessOriginal});
  assert.equal(r.checks.originalGroupParity.status,'PASS');
  assert.match(JSON.stringify(r.checks.originalGroupParity.evidence),/source declares no groups and original render has no clusters/);
  assert.equal(r.checks.semanticPreservation.status,'PASS');
});
test('group-less source: vacuous PASS needs both facts — no original, or an original with a cluster, stays NOT-CHECKABLE',{skip:!enabled},async()=>{
  const none=await auditAgentSvg(source,svg);
  assert.equal(none.checks.originalGroupParity.status,'NOT-CHECKABLE');assert.equal(none.checks.semanticPreservation.status,'NOT-CHECKABLE');
  const clustered=grouplessOriginal.replace('<g class="node"','<g class="cluster" id="m-X"><rect x="0" y="0" width="300" height="200"/></g><g class="node"');
  const r=await auditAgentSvg(source,svg,{originalSvg:clustered});
  assert.equal(r.checks.originalGroupParity.status,'NOT-CHECKABLE');
  assert.match(JSON.stringify(r.checks.originalGroupParity.evidence),/cluster/);
  assert.equal(r.checks.semanticPreservation.status,'NOT-CHECKABLE');
});

const nestedSrc='flowchart LR\n subgraph O[Outer]\n  subgraph I[Inner]\n   A[Start]\n  end\n  B[Finish]\n end\n A --> B\n';
const nestedSvg=(oW)=>svg.replace('<g data-node="A">',`<g data-group="O"><rect x="0" y="20" width="${oW}" height="130"/></g><g data-group="I"><rect x="0" y="30" width="150" height="110"/></g><g data-node="A">`);
test('nested subgraphs: membership is the whole path, checked by actual containment',{skip:!enabled},async()=>{
  const good=await auditAgentSvg(nestedSrc,nestedSvg(520));
  assert.equal(good.checks.groups.status,'PASS');
  assert.equal(good.checks.groupMembership.status,'PASS');
  const wrong=await auditAgentSvg(nestedSrc,nestedSvg(300));
  assert.equal(wrong.checks.groupMembership.status,'FAIL');
  assert.deepEqual(wrong.checks.groupMembership.evidence.mismatchedNodeIds,['B']);
});
test('relations the auditor cannot verify (open link, group endpoint, bidirectional) are NOT-CHECKABLE, never PASS',{skip:!enabled},async()=>{
  for(const src of ['flowchart LR\n  A[Start] --- B[Finish]\n','flowchart LR\n  A[Start] <--> B[Finish]\n','flowchart LR\n  subgraph G\n    A[Start]\n  end\n  G --> B[Finish]\n']){
    const r=await auditAgentSvg(src,svg.replace('x="20" y="80">Start','x="30" y="85">Start').replace('x="410" y="80">Finish','x="430" y="85">Finish'));
    assert.equal(r.checks.relations.status,'NOT-CHECKABLE',src);
    assert.match(JSON.stringify(r.checks.relations.evidence),/not checkable|NOT-CHECKABLE|cannot/i);
    assert.notEqual(r.status,'PASS');
  }
});

// --- review fixes (2026-10-02) ---
const fitted=svg.replace('x="20" y="80">Start','x="30" y="85">Start').replace('x="410" y="80">Finish','x="430" y="85">Finish');
test('a node defined twice with different text or shape FAILs sourceDefinitionConflicts (Mermaid draws the last one)',{skip:!enabled},async()=>{
  const r=await auditAgentSvg('flowchart LR\n  A[Start] --> B[Other]\n  B(Finish)\n',fitted);
  assert.equal(r.checks.nodeText.status,'PASS');
  assert.equal(r.checks.sourceDefinitionConflicts?.status,'FAIL');
  assert.deepEqual(r.checks.sourceDefinitionConflicts?.evidence.nodeIds,['B']);
  assert.equal(r.status,'FAIL');
  const clean=await auditAgentSvg(source,fitted);
  assert.equal(clean.checks.sourceDefinitionConflicts?.status,'PASS');
});
test('a thick source edge makes relationStyle NOT-CHECKABLE: the auditor compares dashing only',{skip:!enabled},async()=>{
  const r=await auditAgentSvg('flowchart LR\n  A[Start] ==> B[Finish]\n',fitted);
  assert.equal(r.checks.relations.status,'PASS');
  assert.equal(r.checks.relationStyle.status,'NOT-CHECKABLE');
  assert.match(JSON.stringify(r.checks.relationStyle.evidence),/thick/);
});
test('node shapes are never PASS: the auditor does not compare drawn shapes, and lists shapes the rules have no notation for',{skip:!enabled},async()=>{
  const r=await auditAgentSvg('flowchart LR\n  A([Start]) --> B[Finish]\n',fitted);
  assert.equal(r.checks.nodeShape?.status,'NOT-CHECKABLE');
  assert.deepEqual(r.checks.nodeShape?.evidence?.notCheckableShapeNodeIds,['A']);
  assert.equal((await auditAgentSvg(source,fitted)).checks.nodeShape?.status,'NOT-CHECKABLE');
});
