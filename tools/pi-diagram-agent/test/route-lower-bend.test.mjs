import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
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
