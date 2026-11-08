import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {auditToFindings} from '../src/findings.mjs';
import {renderSpec} from '../src/spec-render.mjs';
import {enabled,doc,node,edge,label,H_SRC,hBase,V_SRC,vBase,vLabel,baseSpec,withLabel,SPEC_SOURCE} from './helpers/label-fixtures.mjs';

test('R4 labelCoversRoute: a label centred on its own route PASSes (own route is not "another route")',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:305,cy:330})));
  assert.equal(r.checks.labelCoversRoute.status,'PASS',JSON.stringify(r.checks.labelCoversRoute.evidence));
  assert.equal(r.checks.labelClearance.status,'PASS');
});

test('R4 labelCoversRoute: a label box over another route FAILs, names label, covered edge and overlap, and offers a free stretch of the label\'s own route',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:305,cy:530})));
  const c=r.checks.labelCoversRoute;
  assert.equal(c.status,'FAIL',JSON.stringify(c.evidence));
  const [v]=c.evidence.violations;
  assert.equal(v.edge,'A->B');assert.equal(v.coveredEdge,'C->D');
  assert.ok(v.overlap.w>0&&v.overlap.h>=0);
  assert.ok(v.repairHint,JSON.stringify(v));
  assert.equal(v.repairHint.edge,'A->B');assert.equal(v.repairHint.y,330);
  assert.ok(v.repairHint.x>=180&&v.repairHint.x<=430);
  const f=auditToFindings(r).find(x=>x.rule==='labelCoversRoute');
  assert.equal(f.severity,'blocking');assert.deepEqual(f.elements,['A->B','C->D']);
  assert.match(f.suggestion,/own route/i);assert.match(f.suggestion,/330/);
});

test('R4 labelCoversRoute: no free stretch of the own route gives a null hint with a reason (never a guess)',{skip:!enabled},async()=>{
  // The own route is 40 long between its nodes and the label is 100 wide: no stretch can hold it.
  const src='flowchart LR\n A[N] -->|a long label| B[N]\n C[N] --> D[N]\n';
  const nodes=[node('A',60,300,100,60),node('B',230,300,100,60),node('C',60,500,100,60),node('D',450,500,100,60)];
  const r=await auditAgentSvg(src,doc(...nodes,edge('A','B','M160 330 L230 330'),edge('C','D','M160 530 L450 530'),label({s:'A',t:'B',cx:300,cy:530,w:100,text:'a long label'})));
  const [v]=r.checks.labelCoversRoute.evidence.violations;
  assert.equal(v.coveredEdge,'C->D');assert.equal(v.repairHint,null);assert.equal(typeof v.reason,'string');
});

test('R4 labelCoversRoute does not double-report what labelClearance owns: a label on a node outline is labelClearance only',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:160,cy:330})));
  assert.equal(r.checks.labelClearance.status,'FAIL');
  assert.equal(r.checks.labelCoversRoute.status,'PASS');
});

test('R2 labelCoversRoute: a vertical label\'s footprint is the rotated box (same label, same centre: the rotated one clears the neighbour route, the flat one covers it)',{skip:!enabled},async()=>{
  const rotated=await auditAgentSvg(V_SRC,doc(...vBase(),vLabel(250,true)));
  assert.equal(rotated.checks.labelCoversRoute.status,'PASS',JSON.stringify(rotated.checks.labelCoversRoute.evidence));
  const flat=await auditAgentSvg(V_SRC,doc(...vBase(),vLabel(250,false)));
  assert.equal(flat.checks.labelCoversRoute.status,'FAIL');
  assert.equal(flat.checks.labelCoversRoute.evidence.violations[0].coveredEdge,'G->H');
});

test('R2 labelCoversRoute: the rotated footprint can cover a route the flat box would miss',{skip:!enabled},async()=>{
  // centre (300,160): the rotated box spans y 90..230 and crosses E->F at y=125; the flat box (y 148..172) does not reach it.
  const r=await auditAgentSvg(V_SRC,doc(...vBase(),vLabel(160,true)));
  const covered=r.checks.labelCoversRoute.evidence.violations.map(v=>v.coveredEdge);
  assert.ok(covered.includes('E->F'),JSON.stringify(r.checks.labelCoversRoute.evidence));
});


test('a spec-rendered label (flat and vertical) passes edgeLabelStyle, labelCoversRoute and labelClearance in the independent audit',{skip:!enabled},async()=>{
  for(const label of [{text:'Yes',x:487,y:142},{text:'Yes',x:505,y:142,vertical:true}]){
    const r=renderSpec(withLabel(label));
    const a=await auditAgentSvg(SPEC_SOURCE,Buffer.from(r.svg));
    for(const id of ['edgeLabelStyle','labelCoversRoute','labelClearance'])assert.equal(a.checks[id].status,'PASS',`${id} ${JSON.stringify(a.checks[id].evidence)}`);
  }
});

// User rule (2026-10-05): "标签覆盖箭头的时候应该判定失败" — a label over an arrowhead FAILs, including its own route's arrowhead.
// A->B ends at (450,330); the fixture marker (refX 10, 10x10, scale 1) draws its head over x 440..450, y 325..335.
test('labelCoversRoute: a label over its own route\'s arrowhead FAILs (own route shaft stays allowed, R2)',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:425,cy:330})));
  const c=r.checks.labelCoversRoute;
  assert.equal(c.status,'FAIL',JSON.stringify(c.evidence));
  const v=c.evidence.violations.find(x=>x.coveredPart==='arrowhead');
  assert.ok(v,JSON.stringify(c.evidence));
  assert.equal(v.edge,'A->B');assert.equal(v.coveredEdge,'A->B');
  assert.match(v.finding,/label of A->B covers the arrowhead of A->B/);
  assert.ok(!v.repairHint||v.repairHint.x+20<=440,JSON.stringify(v.repairHint));
  const f=auditToFindings(r,{relaxed:true}).find(x=>x.rule==='labelCoversRoute');
  assert.equal(f.severity,'blocking');
  assert.match(f.suggestion,/away from the arrowhead/i);
});

test('labelCoversRoute: a label beside another route\'s arrowhead (off its centreline, inside the head width) FAILs',{skip:!enabled},async()=>{
  // C->D ends at (450,530): head y 525..535. Label of A->B (24 tall) centred at y 546 spans 534..558: misses the centreline, covers the head's lower wing.
  const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:430,cy:546})));
  const v=r.checks.labelCoversRoute.evidence.violations.find(x=>x.coveredPart==='arrowhead');
  assert.ok(v,JSON.stringify(r.checks.labelCoversRoute.evidence));
  assert.equal(v.edge,'A->B');assert.equal(v.coveredEdge,'C->D');
});
