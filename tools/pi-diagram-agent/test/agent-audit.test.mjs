import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const source='flowchart LR\n  A[Start] --> B[Finish]\n';
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs><g data-node="A"><rect x="10" y="50" width="100" height="60"/><text x="20" y="80">Start</text></g><g data-node="B"><rect x="400" y="50" width="100" height="60"/><text x="410" y="80">Finish</text></g><path data-source="A" data-target="B" d="M110 80 L400 80" stroke="black" fill="none" marker-end="url(#arrow)"/></svg>`;

test('agent audit accepts historical-style neutral bindings without old data-box schema',{skip:!enabled},async()=>{
  const result=await auditAgentSvg(source,svg);
  assert.equal(result.status,'NOT-CHECKABLE');
  for(const id of ['nodeIdentity','nodeText','relations'])assert.equal(result.checks[id].status,'PASS');
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
