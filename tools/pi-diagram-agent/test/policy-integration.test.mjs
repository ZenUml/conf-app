import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {auditToFindings} from '../src/findings.mjs';
import {resolvePresentation} from '../src/presentation.mjs';
import {visibleRouteCrossings} from '../src/route-crossings.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const marker='<defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="10" refY="5"><path d="M0 0 L10 5 L0 10 Z" fill="black"/></marker></defs>';
const node=(id,x,y,text,w=60,h=40,extra='')=>`<g data-node="${id}" ${extra}><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="black"/><text data-role="label" x="${x+10}" y="${y+25}" font-size="14">${text}</text></g>`;
const edge=d=>`<path data-source="A" data-target="B" d="${d}" fill="none" stroke="black" stroke-width="1" marker-end="url(#arrow)"/>`;
const group=(id,x,y,w,h)=>`<g data-group="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="black"/></g>`;
const svg=(body,viewBox='0 0 400 240',extra='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${extra}>${marker}${body}</svg>`;
const spans=points=>points.slice(1).map((p,i)=>{const a=points[i],axis=a[1]===p[1]?'h':'v',start=axis==='h'?a[0]:a[1],end=axis==='h'?p[0]:p[1];return {axis,fixed:axis==='h'?a[1]:a[0],start,end,lo:Math.min(start,end),hi:Math.max(start,end),dir:Math.sign(end-start)}});
const route=(edge,points,trunk=null,target='T')=>({edge,id:edge,points,spans:spans(points),trunk,target});

test('visible crossing count deduplicates shared tracks and retains every logical pair',()=>{
  const A=route('A-T',[[0,0],[10,0],[10,30],[40,30]],'family');
  const B=route('B-T',[[0,10],[10,10],[10,30],[40,30]],'family');
  const C=route('C-D',[[25,20],[25,40]],null,'D');
  const r=visibleRouteCrossings([A,B,C]);
  assert.equal(r.crossings.length,1);assert.equal(r.logicalCrossings,2);
  assert.equal(r.crossings[0].edgePairs.length,2);
});
test('same family does not excuse a crossing before the continuous shared suffix',()=>{
  const A=route('A-T',[[0,0],[20,0],[20,20],[40,20],[40,50]],'family');
  const B=route('B-T',[[30,-10],[30,10],[10,10],[10,20],[40,20],[40,50]],'family');
  const r=visibleRouteCrossings([A,B]);assert.equal(r.crossings.length,1);
  assert.deepEqual([r.crossings[0].x,r.crossings[0].y],[20,10]);
});
test('presentation is caller-controlled and invalid scales remain unresolved',()=>{
  assert.deepEqual(resolvePresentation({mode:'native'},{w:2400,h:710}),{mode:'native',scale:1});
  assert.equal(resolvePresentation(null,{w:2400,h:710}).scale,.5);
  assert.ok(resolvePresentation({mode:'native',scale:0}).error);
  assert.ok(resolvePresentation({mode:'fit',width:-1},{w:100,h:100}).error);
});

test('short ancestor border coincidence blocks relaxed acceptance while transverse crossings pass',{skip:!enabled},async()=>{
  const source='flowchart LR\nsubgraph G[Group]\nA[Alpha]\nend\nA --> B[Beta]\n';
  const body=group('G',10,10,150,100)+node('A',30,40,'Alpha')+node('B',250,130,'Beta');
  const bad=await auditAgentSvg(source,svg(body+edge('M90 60 L120 60 L120 110 L140 110 L140 150 L250 150')));
  assert.equal(bad.checks.routeBoundaryCoincidence.status,'FAIL');
  assert.ok(bad.checks.routeBoundaryCoincidence.evidence.violations.length);
  assert.ok(auditToFindings(bad,{relaxed:true}).some(f=>f.rule==='routeBoundaryCoincidence'&&f.severity==='blocking'));
  const good=await auditAgentSvg(source,svg(body+edge('M90 60 L120 60 L120 122 L140 122 L140 150 L250 150')));
  assert.equal(good.checks.routeBoundaryCoincidence.status,'PASS');
});
test('sibling overlap blocks and geometric containment alone cannot declare nesting',{skip:!enabled},async()=>{
  const source='flowchart LR\nsubgraph G[First]\nA[Alpha]\nend\nsubgraph H[Second]\nB[Beta]\nend\nA --> B\n';
  const result=await auditAgentSvg(source,svg(group('G',10,10,150,100)+group('H',145,10,150,100)+node('A',30,40,'Alpha')+node('B',200,40,'Beta')+edge('M90 60 L200 60')));
  assert.equal(result.checks.siblingGroupOverlap.status,'FAIL');
  assert.ok(auditToFindings(result,{relaxed:true}).some(f=>f.rule==='siblingGroupOverlap'&&f.severity==='blocking'));
});
test('explicit source nesting permits contained groups',{skip:!enabled},async()=>{
  const source='flowchart LR\nsubgraph G[Outer]\nsubgraph H[Inner]\nA[Alpha]\nend\nend\nA --> B[Beta]\n';
  const result=await auditAgentSvg(source,svg(group('G',10,10,180,140)+group('H',20,35,150,100)+node('A',40,60,'Alpha')+node('B',300,60,'Beta')+edge('M100 80 L300 80')));
  assert.equal(result.checks.siblingGroupOverlap.status,'PASS');
});
test('fit/native typography is measured at caller scale and author metadata cannot waive it',{skip:!enabled},async()=>{
  const source='flowchart LR\nA[Alpha] --> B[Beta]\n';
  const input=svg(node('A',30,40,'Alpha')+node('B',250,40,'Beta')+edge('M90 60 L250 60'),'0 0 2400 710','data-presentation-mode="native"');
  const fit=await auditAgentSvg(source,input);assert.equal(fit.checks.labelFontFit.status,'FAIL');
  assert.equal(fit.checks.labelFontFit.evidence.pageScale,.5);
  const native=await auditAgentSvg(source,input,{presentation:{mode:'native'}});
  assert.equal(native.checks.labelFontFit.status,'PASS');assert.equal(native.checks.labelFontFit.evidence.minEffective,14);
  const zoomedOut=await auditAgentSvg(source,input,{presentation:{mode:'native',scale:.5}});
  assert.equal(zoomedOut.checks.labelFontFit.status,'FAIL');
});
test('actual unequal boxes in one declared peer tier report a sizing finding',{skip:!enabled},async()=>{
  const source='flowchart LR\nA[Alpha] --> B[Beta]\n',attrs='data-size-family="services" data-size-tier="compact" data-layer="domain"';
  const result=await auditAgentSvg(source,svg(node('A',30,40,'Alpha',112,56,attrs)+node('B',250,40,'Beta',116,56,attrs)+edge('M142 68 L250 68')));
  assert.equal(result.checks.boxSizeConsistency.status,'FAIL');
  assert.ok(auditToFindings(result,{relaxed:true}).some(f=>f.rule==='boxSizeConsistency'&&f.severity==='minor'));
});

test('missing size declarations surface as advice instead of a silent pass',{skip:!enabled},async()=>{
  const result=await auditAgentSvg('flowchart LR\nA[Alpha] --> B[Beta]\n',svg(node('A',30,40,'Alpha')+node('B',250,40,'Beta')+edge('M90 60 L250 60')));
  assert.equal(result.checks.boxSizeConsistency.status,'NOT-CHECKABLE');
  assert.ok(auditToFindings(result,{relaxed:true}).some(f=>f.rule==='boxSizeConsistency'&&f.severity==='minor'));
});

test('profile label tiers include outline padding and grid extensions in the independent browser check',{skip:!enabled},async()=>{
  const base='data-size-family="services" data-size-tier="compact" data-layer="domain"';
  const input=svg(node('A',30,40,'Alpha',112,56,base)+node('B',250,40,'Beta',120,60,base+' data-size-extension="{&quot;width&quot;:2,&quot;height&quot;:1}"'));
  const result=await auditAgentSvg('flowchart LR\nA[Alpha]\nB[Beta]\n',input);
  assert.equal(result.checks.boxSizeConsistency.status,'PASS');
});
test('scaled group borders are checked in root coordinates and uncertain route transforms stay unresolved',{skip:!enabled},async()=>{
  const source='flowchart LR\nsubgraph G[Group]\nA[Alpha]\nend\nA --> B[Beta]\n';
  const body='<g data-group="G" transform="translate(10 10) scale(2)"><rect x="0" y="0" width="75" height="50" fill="none" stroke="black"/></g>'+node('A',30,40,'Alpha')+node('B',250,130,'Beta');
  const result=await auditAgentSvg(source,svg(body+edge('M90 60 L120 60 L120 110 L140 110 L140 150 L250 150')));
  assert.equal(result.checks.routeBoundaryCoincidence.status,'FAIL');
  assert.equal(result.checks.routeBoundaryCoincidence.evidence.violations[0].relation,'source-ancestor');
  const unknown=await auditAgentSvg(source,svg(body+edge('M90 60 L250 60').replace('<path data-source=','<path transform="rotate(10)" data-source=')));
  assert.equal(unknown.checks.routeBoundaryCoincidence.status,'NOT-CHECKABLE');
});
