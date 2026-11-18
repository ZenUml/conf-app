import test from 'node:test';
import assert from 'node:assert/strict';
import {BOX_RULES_PROFILE} from '../src/rules-profile.mjs';
import {
  boundaryCoincidence,
  checkBoxSizeConsistency,
  checkRouteBoundaryCoincidence,
  checkSiblingGroupOverlap,
  isBoundaryCoincident,
} from '../src/geometry-policy.mjs';

const rect=(id,x,y,w,h,extra={})=>({id,outline:'rect',box:{x,y,w,h},...extra});

test('boundary coincidence requires collinear positive-length overlap and accounts for painted strokes',()=>{
  const side={side:'top',axis:'h',fixed:0,lo:0,hi:100,strokeWidth:2};
  assert.equal(isBoundaryCoincident({axis:'h',fixed:1.4,lo:20,hi:40,strokeWidth:1},side,{edgeStrokeWidth:1}),true);
  assert.equal(boundaryCoincidence({axis:'h',fixed:1.4,lo:20,hi:40,strokeWidth:1},side,{edgeStrokeWidth:1}).overlap,20);
  assert.equal(isBoundaryCoincident({axis:'h',fixed:1.6,lo:20,hi:40,strokeWidth:1},side,{edgeStrokeWidth:1}),false);
  assert.equal(isBoundaryCoincident({axis:'h',fixed:0,lo:100,hi:120,strokeWidth:1},side),false);
  assert.equal(isBoundaryCoincident({axis:'v',fixed:0,lo:-20,hi:20,strokeWidth:1},side),false);
  assert.equal(isBoundaryCoincident({axis:'h',fixed:0,lo:100,hi:100,strokeWidth:1},side),false);
});

test('route boundary policy fails every measured same-axis run, but ignores transverse crossings and rounded corners',()=>{
  const groups=[rect('G',0,0,100,80,{strokeWidth:2,cornerRadius:{rx:10,ry:8},axisAligned:true})];
  const nodes=[{id:'A',box:{x:10,y:10,w:10,h:10},ancestors:['G']},{id:'B',box:{x:120,y:10,w:10,h:10}}];
  const edge={id:'A-B',source:'A',target:'B',spans:[
    {axis:'h',fixed:1,lo:20,hi:40,strokeWidth:1},
  ]};
  const bad=checkRouteBoundaryCoincidence({groups,nodes,edges:[edge]});
  assert.equal(bad.status,'FAIL');
  assert.deepEqual(bad.evidence.violations.map(v=>[v.edge,v.group,v.side,v.relation]),[['A-B','G','top','source-ancestor']]);
  const crossing=checkRouteBoundaryCoincidence({groups,nodes,edges:[{...edge,id:'A-B-cross',spans:[{axis:'v',fixed:50,lo:-10,hi:40,strokeWidth:1}]}]});
  assert.equal(crossing.status,'PASS');
  const corner=checkRouteBoundaryCoincidence({groups,nodes,edges:[{...edge,id:'A-B-corner',spans:[{axis:'h',fixed:0,lo:0,hi:5,strokeWidth:1}]}]});
  assert.equal(corner.status,'PASS');
  const straight=checkRouteBoundaryCoincidence({groups,nodes,edges:[{...edge,id:'A-B-straight',spans:[{axis:'h',fixed:0,lo:20,hi:40,strokeWidth:1}]}]});
  assert.equal(straight.status,'FAIL');
  assert.equal(straight.evidence.violations[0].side,'top');
  const unsupported=checkRouteBoundaryCoincidence({groups:[{id:'G',outline:'path',box:{x:0,y:0,w:100,h:80}}],nodes,edges:[edge]});
  assert.equal(unsupported.status,'NOT-CHECKABLE');
  const transformed=checkRouteBoundaryCoincidence({groups:[{id:'G',outline:'rect',axisAligned:false,box:{x:0,y:0,w:100,h:80}}],nodes,edges:[edge]});
  assert.equal(transformed.status,'NOT-CHECKABLE');
  const missing=checkRouteBoundaryCoincidence({groups,edges:[{id:'A-B',spans:[]}]});
  assert.equal(missing.status,'NOT-CHECKABLE');
  const negative=checkRouteBoundaryCoincidence({groups:[rect('G',0,0,-100,80)],nodes,edges:[edge]});
  assert.equal(negative.status,'NOT-CHECKABLE');
  const malformedSpan=checkRouteBoundaryCoincidence({groups,edges:[{id:'bad',spans:[{axis:'h',fixed:null,lo:0,hi:20}]}]});
  assert.equal(malformedSpan.status,'NOT-CHECKABLE');
  const fallback=checkRouteBoundaryCoincidence({groups:[rect('G',0,0,100,80)],nodes:[
    {id:'inside',box:{x:10,y:10,w:10,h:10}},
    {id:'outside',box:{x:120,y:10,w:10,h:10}},
  ],edges:[{id:'inside-outside',source:'inside',target:'outside',spans:[{axis:'h',fixed:0,lo:20,hi:40}]}]});
  assert.equal(fallback.evidence.violations[0].relation,'source-ancestor');
});

test('sibling overlap requires explicit hierarchy and does not infer nesting from geometry',()=>{
  const overlap=checkSiblingGroupOverlap({groups:[rect('A',0,0,100,100),rect('B',50,50,100,100)]});
  assert.equal(overlap.status,'FAIL');
  assert.deepEqual([overlap.evidence.violations[0].groupA,overlap.evidence.violations[0].groupB],['A','B']);
  const containment=checkSiblingGroupOverlap({groups:[rect('outer',0,0,200,200),rect('inner',20,20,40,40)]});
  assert.equal(containment.status,'FAIL');
  const declared=checkSiblingGroupOverlap({groups:[rect('outer',0,0,200,200),rect('inner',20,20,40,40,{ancestors:['outer']})]});
  assert.equal(declared.status,'PASS');
  assert.deepEqual(declared.evidence.nestedPairs.map(pair=>[pair.ancestor,pair.descendant]),[['outer','inner']]);
  const contradictory=checkSiblingGroupOverlap({groups:[rect('A',0,0,100,100,{ancestors:['B']}),rect('B',20,20,100,100,{ancestors:['A']})]});
  assert.equal(contradictory.status,'NOT-CHECKABLE');
  assert.match(contradictory.evidence.notCheckable[0].reason,/contradictory cycle/i);
  const touching=checkSiblingGroupOverlap({groups:[rect('A',0,0,100,100),rect('B',100,0,100,100)]});
  assert.equal(touching.status,'PASS');
  const unsupported=checkSiblingGroupOverlap({groups:[rect('A',0,0,100,100),{id:'B',outline:'path',box:{x:50,y:50,w:100,h:100}}]});
  assert.equal(unsupported.status,'NOT-CHECKABLE');
});

test('box size policy uses rules profile tiers and grid extensions',()=>{
  const standard={id:'standard',box:{x:0,y:0,w:216,h:96},labelBox:{x:8,y:8,w:200,h:80},shape:'rect',sizeFamily:'process',sizeTier:'standard',group:'G'};
  const extended={id:'extended',box:{x:0,y:0,w:224,h:100},labelBox:{x:8,y:8,w:208,h:84},shape:'rect',sizeFamily:'process',sizeTier:'standard',sizeExtension:{widthSteps:2,heightSteps:1},layer:'expanded',group:'G'};
  const pass=checkBoxSizeConsistency({nodes:[standard,extended]});
  assert.equal(pass.status,'PASS');
  assert.deepEqual(pass.evidence.tiers.map(({width,height})=>[width,height]),BOX_RULES_PROFILE.sizingContract.tiers);
  assert.equal(pass.evidence.gridStep,BOX_RULES_PROFILE.gridStep);
  const mismatch=checkBoxSizeConsistency({nodes:[{...standard,id:'bad',labelBox:{x:8,y:8,w:204,h:80}}]});
  assert.equal(mismatch.status,'FAIL');
  assert.equal(mismatch.evidence.violations[0].kind,'size-mismatch');
  const peerOuter=checkBoxSizeConsistency({nodes:[
    {...standard,id:'peer-a',layer:'same'},
    {...standard,id:'peer-b',layer:'same',box:{x:0,y:0,w:220,h:96}},
  ]});
  assert.equal(peerOuter.status,'FAIL');
  assert.equal(peerOuter.evidence.violations[0].kind,'peer-size-mismatch');
  assert.equal(peerOuter.evidence.violations[0].subject,'outline');
  const missing=checkBoxSizeConsistency({nodes:[{id:'missing',box:{x:0,y:0,w:216,h:96},labelBox:{x:8,y:8,w:200,h:80},shape:'rect',group:'G'}]});
  assert.equal(missing.status,'NOT-CHECKABLE');
  assert.equal(missing.evidence.advisories[0].kind,'missing-size-declaration');
  assert.deepEqual(missing.evidence.advisories[0].measured,{width:216,height:96});
  assert.match(missing.evidence.advisories[0].suggestion,/sizeFamily.*sizeTier/i);
  const noLabelBox=checkBoxSizeConsistency({nodes:[{...standard,id:'no-label-box',labelBox:undefined}]});
  assert.equal(noLabelBox.status,'NOT-CHECKABLE');
  assert.ok(noLabelBox.evidence.advisories.some(advisory=>advisory.kind==='missing-label-box'));
  const unsupportedLabelBox=checkBoxSizeConsistency({nodes:[{...standard,id:'bad-label-box',labelBox:{x:8,y:8,w:-200,h:80}}]});
  assert.equal(unsupportedLabelBox.status,'NOT-CHECKABLE');
  assert.ok(unsupportedLabelBox.evidence.advisories.some(advisory=>advisory.kind==='unsupported-label-box'));
  const negative=checkBoxSizeConsistency({nodes:[{id:'negative',box:{x:0,y:0,w:-216,h:96},labelBox:{x:8,y:8,w:200,h:80},shape:'rect',sizeFamily:'process',sizeTier:'standard'}]});
  assert.equal(negative.status,'NOT-CHECKABLE');
  assert.match(negative.evidence.notCheckable[0].reason,/box/i);
  const peers=checkBoxSizeConsistency({nodes:[
    {id:'u1',box:{x:0,y:0,w:216,h:96},shape:'rect',group:'G'},
    {id:'u2',box:{x:0,y:100,w:224,h:96},shape:'rect',group:'G'},
  ]});
  assert.equal(peers.status,'NOT-CHECKABLE');
  assert.ok(peers.evidence.advisories.some(advisory=>advisory.kind==='undeclared-peer-group'));
  const invalidTier=checkBoxSizeConsistency({nodes:[{...standard,id:'unknown',sizeTier:'business'}]});
  assert.equal(invalidTier.status,'NOT-CHECKABLE');
});
