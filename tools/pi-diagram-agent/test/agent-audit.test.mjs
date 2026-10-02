import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditAgentSvg} from '../src/agent-audit.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const source='flowchart LR\n  A[Start] --> B[Finish]\n';
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs><g data-node="A"><rect x="10" y="50" width="100" height="60"/><text x="20" y="80">Start</text></g><g data-node="B"><rect x="400" y="50" width="100" height="60"/><text x="410" y="80">Finish</text></g><path data-source="A" data-target="B" d="M110 80 L400 80" stroke="black" fill="none" marker-end="url(#arrow)"/></svg>`;

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
  const labelled='flowchart LR\n  A[Start] -->|Go| B[Finish]\n';
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
  assert.deepEqual(result.checks.routeCrossings.evidence.violations[0],{edgeA:'A->B',edgeB:'C->D',x:270,y:80});
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

// ---- routeLowerBend: lower-bend and midpoint-anchor witnesses ------------------
const lbDefs='<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs>';
const lbNode=(id,x,y,w,h)=>`<g data-node="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="black"/><text x="${x+14}" y="${y+h/2+4}">N</text></g>`;
const lbEdge=(s,t,d)=>`<path data-source="${s}" data-target="${t}" d="${d}" stroke="black" fill="none" marker-end="url(#arrow)"/>`;
const lbGroup=(id,x,y,w,h)=>`<g data-group="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="black" fill="none"/></g>`;
const lbDoc=(...parts)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320">${lbDefs}${parts.join('')}</svg>`;
const lbSource='flowchart LR\n A[N] --> B[N]\n';
const lbA=lbNode('A',10,50,100,60);
const lbDiag=lbNode('B',300,200,100,60);

test('routeLowerBend fails a filleted 3-bend route when a feasible one-bend L exists and reports the witness',{skip:!enabled},async()=>{
  const drawn=lbDoc(lbA,lbDiag,lbEdge('A','B','M110 80 L145 80 Q150 80 150 75 L150 45 Q150 40 155 40 L345 40 Q350 40 350 45 L350 200'));
  const result=await auditAgentSvg(lbSource,drawn);
  const check=result.checks.routeLowerBend;
  assert.equal(check.status,'FAIL');
  const [v]=check.evidence.violations;
  assert.equal(v.edge,'A->B');
  assert.equal(v.kind,'lowerBend');
  assert.equal(v.drawnBends,3);
  assert.equal(v.witnessBends,1);
  assert.equal(v.witness.segments.length,2);
  assert.ok(['right','bottom'].includes(v.witness.faces.source));
  assert.equal(result.status,'FAIL');
});

test('routeLowerBend passes a 3-bend route when every L is blocked by unrelated nodes',{skip:!enabled},async()=>{
  // M1 blocks every horizontal exit from A's right face; M2 blocks every horizontal run into B's left face from below A.
  const blocked=lbDoc(lbA,lbDiag,lbNode('M1',160,50,60,70),lbNode('M2',130,160,60,120),lbEdge('A','B','M60 50 L60 20 L270 20 L270 230 L300 230'));
  const result=await auditAgentSvg(lbSource,blocked);
  const check=result.checks.routeLowerBend;
  assert.equal(check.status,'PASS');
  assert.deepEqual(check.evidence.relations.map(r=>[r.edge,r.status,r.drawnBends]),[['A->B','PASS',3]]);
  assert.notEqual(result.status,'PASS');
  // Remove the blockers: the same drawing now has a feasible L.
  const open=await auditAgentSvg(lbSource,lbDoc(lbA,lbDiag,lbEdge('A','B','M60 50 L60 20 L270 20 L270 230 L300 230')));
  assert.equal(open.checks.routeLowerBend.status,'FAIL');
  assert.equal(open.checks.routeLowerBend.evidence.violations[0].witnessBends,1);
});

test('routeLowerBend fails an L when a straight route is feasible and passes the straight',{skip:!enabled},async()=>{
  const nodes=[lbA,lbNode('B',300,70,100,60)];
  const l=await auditAgentSvg(lbSource,lbDoc(...nodes,lbEdge('A','B','M60 110 L60 125 L300 125')));
  assert.equal(l.checks.routeLowerBend.status,'FAIL');
  const [v]=l.checks.routeLowerBend.evidence.violations;
  assert.deepEqual([v.kind,v.drawnBends,v.witnessBends],['lowerBend',1,0]);
  assert.equal(v.witness.segments.length,1);
  const straight=await auditAgentSvg(lbSource,lbDoc(...nodes,lbEdge('A','B','M110 90 L300 90')));
  assert.equal(straight.checks.routeLowerBend.status,'PASS');
});

test('routeLowerBend fails off-midpoint anchors when a midpoint route has the same bends',{skip:!enabled},async()=>{
  const nodes=[lbA,lbNode('B',300,50,100,60)];
  const off=await auditAgentSvg(lbSource,lbDoc(...nodes,lbEdge('A','B','M110 95 L300 95')));
  assert.equal(off.checks.routeLowerBend.status,'FAIL');
  const [v]=off.checks.routeLowerBend.evidence.violations;
  assert.deepEqual([v.kind,v.drawnBends,v.witnessBends],['midpoint',0,0]);
  assert.deepEqual(v.witness.anchors,{source:[110,80],target:[300,80]});
  const mid=await auditAgentSvg(lbSource,lbDoc(...nodes,lbEdge('A','B','M110 80 L300 80')));
  assert.equal(mid.checks.routeLowerBend.status,'PASS');
});

test('routeLowerBend lets a route transit its source ancestor container but not an unrelated container',{skip:!enabled},async()=>{
  const b=lbNode('B',300,50,100,60);
  const straight='M110 80 L300 80';
  // G holds A: the straight route crosses G's boundary legitimately; a detour around it is a lower-bend violation.
  const ancestor=await auditAgentSvg(lbSource,lbDoc(lbGroup('G',0,20,200,130),lbA,b,lbEdge('A','B',straight)));
  assert.equal(ancestor.checks.routeLowerBend.status,'PASS');
  const detour='M60 50 L60 10 L350 10 L350 50';
  const needless=await auditAgentSvg(lbSource,lbDoc(lbGroup('G',0,20,200,130),lbA,b,lbEdge('A','B',detour)));
  assert.equal(needless.checks.routeLowerBend.status,'FAIL');
  assert.equal(needless.checks.routeLowerBend.evidence.violations[0].witnessBends,0);
  // G holds only another node C and sits between A and B: the straight route is infeasible, so the 2-bend detour is correct.
  const unrelated=await auditAgentSvg(lbSource,lbDoc(lbGroup('G',200,20,60,130),lbNode('C',215,70,30,30),lbA,b,lbEdge('A','B',detour)));
  assert.equal(unrelated.checks.routeLowerBend.status,'PASS');
});

test('routeLowerBend is NOT-CHECKABLE per relationship for unsupported shapes, curves and unbound labels, and never PASS overall',{skip:!enabled},async()=>{
  const diamond=lbDoc('<g data-node="A"><polygon points="60,40 120,80 60,120 0,80"/><text x="40" y="85">N</text></g>',lbNode('B',300,50,100,60),lbEdge('A','B','M120 80 L300 80'));
  const shape=await auditAgentSvg(lbSource,diamond);
  assert.equal(shape.checks.routeLowerBend.status,'NOT-CHECKABLE');
  assert.equal(shape.checks.routeLowerBend.evidence.notCheckable[0].edge,'A->B');
  assert.match(shape.checks.routeLowerBend.evidence.notCheckable[0].reason,/unsupported endpoint shape: A/);
  const curved=await auditAgentSvg(lbSource,lbDoc(lbA,lbNode('B',300,50,100,60),lbEdge('A','B','M110 80 L200 80 Q250 20 300 80')));
  assert.equal(curved.checks.routeLowerBend.status,'NOT-CHECKABLE');
  assert.match(curved.checks.routeLowerBend.evidence.notCheckable[0].reason,/curved non-fillet/);
  const unbound=await auditAgentSvg('flowchart LR\n A[N] -- "Go" --> B[N]\n',lbDoc(lbA,lbNode('B',300,50,100,60),lbEdge('A','B','M110 80 L300 80')));
  assert.equal(unbound.checks.routeLowerBend.status,'NOT-CHECKABLE');
  assert.match(unbound.checks.routeLowerBend.evidence.notCheckable[0].reason,/label/);
  // One checked PASS relationship cannot hide an unchecked one.
  const two=await auditAgentSvg('flowchart LR\n A[N] --> B[N]\n C[N] --> B\n',lbDoc(lbA,lbNode('B',300,50,100,60),'<g data-node="C"><polygon points="200,190 260,230 200,270 140,230"/><text x="180" y="235">N</text></g>',lbEdge('A','B','M110 80 L300 80'),lbEdge('C','B','M260 230 L350 230 L350 110')));
  assert.deepEqual(two.checks.routeLowerBend.evidence.relations.map(r=>[r.edge,r.status]),[['A->B','PASS'],['C->B','NOT-CHECKABLE']]);
  assert.equal(two.checks.routeLowerBend.status,'NOT-CHECKABLE');
  assert.notEqual(two.status,'PASS');
});
