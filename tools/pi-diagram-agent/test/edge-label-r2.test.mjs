import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {collectGeometry,geometryFindings} from '../src/geometry.mjs';
import {renderSpec} from '../src/spec-render.mjs';
import {enabled,doc,node,edge,label,near,V_SRC,vBase,vLabel,baseSpec,withLabel,rulesOf} from './helpers/label-fixtures.mjs';

test('R2 labelClearance: a rotated label is measured against node outlines with its rotated box',{skip:!enabled},async()=>{
  // Horizontal route y=330, label "go" centred at (305,330); obstacle node N top edge at y=346.
  // Rotated: the box spans y 310..350 and touches N. Flat: y 318..342 is 4 units clear.
  const src='flowchart LR\n A[N] -->|go| B[N]\n N[N]\n';
  const parts=[node('A',60,300,100,60),node('B',450,300,100,60),node('N',290,346,40,30),edge('A','B','M160 330 L450 330')];
  const rotated=await auditAgentSvg(src,doc(...parts,label({s:'A',t:'B',cx:305,cy:330,transform:'rotate(-90 305 330)'})));
  assert.equal(rotated.checks.labelClearance.status,'FAIL',JSON.stringify(rotated.checks.labelClearance.evidence));
  near(rotated.checks.labelClearance.evidence.violations[0].labelBox.w,24);near(rotated.checks.labelClearance.evidence.violations[0].labelBox.h,40);
  const flat=await auditAgentSvg(src,doc(...parts,label({s:'A',t:'B',cx:305,cy:330})));
  assert.equal(flat.checks.labelClearance.status,'PASS');
});

test('R2 collectGeometry: a label group with its own rotate transform reports the rotated box',{skip:!enabled},async()=>{
  const svg=doc(edge('C','D','M300 80 L300 400'),label({s:'C',t:'D',cx:300,cy:250,w:60,text:'short',transform:'rotate(-90 300 250)'}));
  const g=await collectGeometry(Buffer.from(svg));
  const b=g.labels[0].box;
  near(b.x,288);near(b.y,220);near(b.w,24);near(b.h,60);
  // a transform on an inner element is measured the same way
  const inner=doc(edge('C','D','M300 80 L300 400'),`<g data-edge-label-source="C" data-edge-label-target="D"><g transform="rotate(-90 300 250)"><rect x="270" y="238" width="60" height="24" fill="#fff"/><text x="300" y="250" text-anchor="middle" dominant-baseline="central" font-size="15">short</text></g></g>`);
  const bi=(await collectGeometry(Buffer.from(inner))).labels[0].box;
  near(bi.x,288);near(bi.w,24);near(bi.h,60);
});

test('R2 ownership: a short label centred on its own route is neither detached nor ambiguous, even with another route 3 units from its box, flat or rotated',{skip:!enabled},async()=>{
  const model={nodes:[{id:'A'},{id:'B'},{id:'C'},{id:'D'}],edges:[{source:'A',target:'B',label:'go'},{source:'C',target:'D',label:''}],groups:[]};
  const flat=doc(edge('A','B','M160 330 L450 330'),edge('C','D','M160 345 L450 345'),label({s:'A',t:'B',cx:305,cy:330}));
  const rotated=doc(edge('A','B','M300 100 L300 450'),edge('C','D','M315 100 L315 450'),label({s:'A',t:'B',cx:300,cy:300,transform:'rotate(-90 300 300)'}));
  for(const svg of [flat,rotated]){
    const g=await collectGeometry(Buffer.from(svg));
    const bad=geometryFindings(g,model).filter(f=>['label-detached','label-ambiguous'].includes(f.rule));
    assert.deepEqual(bad.map(f=>f.rule),[],JSON.stringify(bad));
  }
});

test('spec renderer: label.vertical rotates the pill -90 degrees around its centre and the footprint used by every clearance check is the rotated box',()=>{
  const r=renderSpec(withLabel({text:'Yes',x:520,y:142,vertical:true}));
  assert.match(r.svg,/<g data-edge-label-source="B" data-edge-label-target="C" transform="rotate\(-90 520 142\)">/);
  assert.equal(rulesOf(r,'label-clearance').length,0,'the rotated pill (x 508..532) clears the store outline');
  // control: the same centre without vertical is the flat 44x24 pill (x 498..542) and touches the store
  const flat=renderSpec(withLabel({text:'Yes',x:520,y:142}));
  assert.ok(rulesOf(flat,'label-clearance').length);
  assert.doesNotMatch(flat.svg,/data-edge-label-source="B" data-edge-label-target="C" transform=/);
});

test('spec renderer: the rotated footprint decides label-on-route (flat box would hit the B->D vertical leg at x=330, the rotated one does not)',()=>{
  const flat=renderSpec(withLabel({text:'Yes',x:350,y:260}));
  assert.ok(rulesOf(flat,'label-on-route').length,'flat pill x 328..372 covers the leg at x=330');
  const rotated=renderSpec(withLabel({text:'Yes',x:350,y:260,vertical:true}));
  assert.equal(rulesOf(rotated,'label-on-route').length,0,'rotated pill x 338..362 clears it');
  // and the rotated pill's longer side now reaches vertically: a leg at its top end is covered
  const tall=renderSpec(withLabel({text:'Yes',x:440,y:312+20,vertical:true}));
  assert.ok(rulesOf(tall,'label-on-route').length,'rotated pill y 310..354 covers the B->D horizontal leg at y=312');
});

test('spec renderer: label.vertical must be a boolean; unknown label keys stay errors',()=>{
  assert.throws(()=>renderSpec(withLabel({text:'Yes',x:487,y:142,vertical:'yes'})),e=>e.errors?.[0]?.path==='edges[1].label.vertical'&&/true or false/.test(e.errors[0].message));
  assert.throws(()=>renderSpec(withLabel({text:'Yes',x:487,y:142,angle:90})),e=>e.errors?.[0]?.path==='edges[1].label.angle');
});
