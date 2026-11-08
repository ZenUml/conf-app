import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {auditToFindings} from '../src/findings.mjs';
import {renderSpec} from '../src/spec-render.mjs';
import {enabled,doc,node,edge,label,H_SRC,hBase,baseSpec,withLabel} from './helpers/label-fixtures.mjs';

test('R3 edgeLabelStyle: an opaque borderless background PASSes',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:305,cy:330})));
  assert.equal(r.checks.edgeLabelStyle.status,'PASS',JSON.stringify(r.checks.edgeLabelStyle.evidence));
  assert.equal(r.checks.edgeLabelStyle.evidence.checkedLabels,1);
});

test('R3 edgeLabelStyle: a stroked background FAILs (attribute and CSS style), naming the label',{skip:!enabled},async()=>{
  for(const rect of ['fill="#ffffff" stroke="#333333"','fill="#ffffff" style="stroke:#333;stroke-width:2"']){
    const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:305,cy:330,rect})));
    const c=r.checks.edgeLabelStyle;
    assert.equal(c.status,'FAIL',rect);
    assert.equal(c.evidence.violations[0].label,'A->B');
    assert.equal(c.evidence.violations[0].problem,'visible stroke');
    const f=auditToFindings(r).find(x=>x.rule==='edgeLabelStyle');
    assert.equal(f.severity,'blocking');assert.ok(f.elements.includes('A->B'));assert.match(f.suggestion,/no border|stroke/i);
  }
});

test('R3 edgeLabelStyle: a missing, transparent, translucent or too small background FAILs',{skip:!enabled},async()=>{
  const cases=[
    ['no background shape',{withRect:false}],
    ['fill none',{rect:'fill="none"'}],
    ['translucent fill',{rect:'fill="#ffffff" fill-opacity="0.5"'}],
    ['group opacity',{rect:'fill="#ffffff" opacity="0.4"'}],
    ['background not behind the text',{w:10,h:10}],
  ];
  for(const [name,extra] of cases){
    const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:305,cy:330,...extra})));
    const c=r.checks.edgeLabelStyle;
    assert.equal(c.status,'FAIL',name);
    assert.equal(c.evidence.violations[0].problem,'no opaque background behind the text',name);
  }
});

test('R3 edgeLabelStyle: an untagged label is NOT-CHECKABLE, never PASS',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:305,cy:330,tagged:false})));
  assert.equal(r.checks.edgeLabelStyle.status,'NOT-CHECKABLE');
  assert.deepEqual(r.checks.edgeLabelStyle.evidence.unboundLabels,['A->B']);
});

test('R3 edgeLabelStyle: a diagram with no edge labels has nothing to judge and PASSes with zero checked',{skip:!enabled},async()=>{
  const r=await auditAgentSvg('flowchart LR\n A[N] --> B[N]\n',doc(node('A',60,300,100,60),node('B',450,300,100,60),edge('A','B','M160 330 L450 330')));
  assert.equal(r.checks.edgeLabelStyle.status,'PASS');assert.equal(r.checks.edgeLabelStyle.evidence.checkedLabels,0);
});

test('spec renderer R3: the pill has no border and an opaque canvas-coloured background',()=>{
  const r=renderSpec(withLabel({text:'Yes',x:487,y:142}));
  const pill=/<g data-edge-label-source="B" data-edge-label-target="C"[^>]*><rect ([^>]*)\/>/.exec(r.svg)?.[1];
  assert.ok(pill,r.svg);
  assert.match(pill,/fill="#ffffff"/);
  assert.match(pill,/stroke="none"/);
  assert.doesNotMatch(pill,/stroke-width|fill-opacity|opacity/);
});

test('spec renderer R3: a pill inside a group takes the group fill as its opaque background',()=>{
  const s=baseSpec();s.groups=[{id:'G',label:'Group',rect:[400,60,300,160],role:'step'}];
  s.nodes[2].group='G';
  const r=renderSpec(s);
  const pill=/<g data-edge-label-source="B" data-edge-label-target="C"[^>]*><rect ([^>]*)\/>/.exec(r.svg)?.[1];
  assert.match(pill,/fill="#e8f1fb"|fill="#f8fafc"/);assert.match(pill,/stroke="none"/);
});

