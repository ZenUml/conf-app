import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {checkRouteLowerBend} from '../src/route-lower-bend.mjs';
import {derivePorts} from '../src/shape-ports.mjs';

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

test('routeLowerBend finds a 2-bend witness for a 3-bend route when every L is blocked by unrelated nodes',{skip:!enabled},async()=>{
  // M1 blocks every horizontal exit from A's right face; M2 blocks every horizontal run into B's left face from below A.
  const blocked=lbDoc(lbA,lbDiag,lbNode('M1',160,50,60,70),lbNode('M2',130,160,60,120),lbEdge('A','B','M60 50 L60 20 L270 20 L270 230 L300 230'));
  const result=await auditAgentSvg(lbSource,blocked);
  const check=result.checks.routeLowerBend;
  assert.equal(check.status,'FAIL');
  assert.deepEqual([check.evidence.violations[0].witnessBends,check.evidence.violations[0].witness.faces],[2,{source:'top',target:'top'}]);
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
  const star=lbDoc('<g data-node="A"><polygon points="60,40 75,70 110,80 75,90 60,120 45,90 10,80 45,70"/><text x="40" y="85">N</text></g>',lbNode('B',300,50,100,60),lbEdge('A','B','M110 80 L300 80'));
  const shape=await auditAgentSvg(lbSource,star);
  assert.equal(shape.checks.routeLowerBend.status,'NOT-CHECKABLE');
  assert.equal(shape.checks.routeLowerBend.evidence.notCheckable[0].edge,'A->B');
  assert.match(shape.checks.routeLowerBend.evidence.notCheckable[0].reason,/unsupported endpoint shape: A.*non-convex/);
  const curved=await auditAgentSvg(lbSource,lbDoc(lbA,lbNode('B',300,50,100,60),lbEdge('A','B','M110 80 L200 80 Q250 20 300 80')));
  assert.equal(curved.checks.routeLowerBend.status,'NOT-CHECKABLE');
  assert.match(curved.checks.routeLowerBend.evidence.notCheckable[0].reason,/curved non-fillet/);
  const unbound=await auditAgentSvg('flowchart LR\n A[N] -- "Go" --> B[N]\n',lbDoc(lbA,lbNode('B',300,50,100,60),lbEdge('A','B','M110 80 L300 80')));
  assert.equal(unbound.checks.routeLowerBend.status,'NOT-CHECKABLE');
  assert.match(unbound.checks.routeLowerBend.evidence.notCheckable[0].reason,/label/);
  // One checked PASS relationship cannot hide an unchecked one.
  const two=await auditAgentSvg('flowchart LR\n A[N] --> B[N]\n C[N] --> B\n',lbDoc(lbA,lbNode('B',300,50,100,60),'<g data-node="C"><polygon points="200,190 215,225 260,230 215,235 200,270 185,235 140,230 185,225"/><text x="180" y="235">N</text></g>',lbEdge('A','B','M110 80 L300 80'),lbEdge('C','B','M260 230 L350 230 L350 110')));
  assert.deepEqual(two.checks.routeLowerBend.evidence.relations.map(r=>[r.edge,r.status]),[['A->B','PASS'],['C->B','NOT-CHECKABLE']]);
  assert.equal(two.checks.routeLowerBend.status,'NOT-CHECKABLE');
  assert.notEqual(two.status,'PASS');
});

// ---- shape ports: every supported silhouette gets ports from its drawn outline --------------------------------
const n3=v=>Math.round(v*1000)/1000;
const toward=(v,o,r)=>{const l=Math.hypot(o[0]-v[0],o[1]-v[1]),t=Math.min(r,l/3)/l;return [v[0]+(o[0]-v[0])*t,v[1]+(o[1]-v[1])*t]};
const roundedPolygon=(pts,r=10)=>{const n=pts.length,before=pts.map((p,i)=>toward(p,pts[(i+n-1)%n],r)),after=pts.map((p,i)=>toward(p,pts[(i+1)%n],r));let d=`M ${n3(after[0][0])},${n3(after[0][1])}`;for(let i=1;i<=n;i++){const j=i%n;d+=` L ${n3(before[j][0])},${n3(before[j][1])} Q ${n3(pts[j][0])},${n3(pts[j][1])} ${n3(after[j][0])},${n3(after[j][1])}`}return d+' Z'};
const gShape=(id,inner)=>`<g data-node="${id}">${inner}<text x="30" y="85">N</text></g>`;
const shapes={
  diamond:{svg:gShape('A',`<path d="${roundedPolygon([[60,50],[110,80],[60,110],[10,80]])}" fill="#fff" stroke="black"/>`),right:[105.714,80]},
  hexagon:{svg:gShape('A',`<path d="${roundedPolygon([[70,40],[130,60],[130,100],[70,120],[10,100],[10,60]])}" fill="#fff" stroke="black"/>`),right:[130,80]},
  cylinder:{svg:gShape('A','<path d="M 10 62 C 10 46 110 46 110 62 L 110 98 C 110 114 10 114 10 98 Z" fill="#fff" stroke="black"/><path d="M 10 62 C 10 78 110 78 110 62" fill="none" stroke="black"/>'),right:[110,80]},
  queue:{svg:gShape('A','<path d="M 22 50 C 6 50 6 110 22 110 L 98 110 C 114 110 114 50 98 50 Z" fill="#fff" stroke="black"/><path d="M 98 50 C 82 50 82 110 98 110" fill="none" stroke="black"/>'),right:[110,80]},
  subroutine:{svg:gShape('A','<rect x="10" y="50" width="100" height="60" fill="#fff" stroke="black"/><path d="M 22 50 L 22 110" stroke="black"/><path d="M 98 50 L 98 110" stroke="black"/>'),right:[110,80]},
  capsule:{svg:gShape('A','<rect x="10" y="50" width="100" height="60" rx="30" fill="#fff" stroke="black"/>'),right:[110,80]},
  circle:{svg:gShape('A','<circle cx="60" cy="80" r="30" fill="#fff" stroke="black"/>'),right:[90,80]},
};
for(const [name,{svg,right}] of Object.entries(shapes)){
  test(`routeLowerBend supports a ${name} source: detour fails with a witness from its drawn port, the straight route from that port passes`,{skip:!enabled},async()=>{
    const b=lbNode('B',300,50,100,60),[x,y]=right;
    const detour=await auditAgentSvg(lbSource,lbDoc(svg,b,lbEdge('A','B',`M${x} ${y} L${x+20} ${y} L${x+20} 40 L330 40 L330 50`)));
    const rel=detour.checks.routeLowerBend.evidence.relations[0];
    assert.equal(rel.status,'FAIL',JSON.stringify(rel));
    const [v]=detour.checks.routeLowerBend.evidence.violations;
    assert.equal(v.faces.source,'right');
    assert.equal(v.witnessBends,0);
    assert.ok(Math.abs(v.witness.anchors.source[0]-x)<0.01&&Math.abs(v.witness.anchors.source[1]-y)<0.01,JSON.stringify(v.witness.anchors));
    const straight=await auditAgentSvg(lbSource,lbDoc(svg,b,lbEdge('A','B',`M${x} ${y} L300 ${y}`)));
    assert.equal(straight.checks.routeLowerBend.evidence.relations[0].status,'PASS',JSON.stringify(straight.checks.routeLowerBend.evidence.relations));
  });
}
test('routeLowerBend supports a shape as the target endpoint',{skip:!enabled},async()=>{
  const dia=gShape('B',`<path d="${roundedPolygon([[350,50],[400,80],[350,110],[300,80]])}" fill="#fff" stroke="black"/>`);
  const ok=await auditAgentSvg(lbSource,lbDoc(lbA,dia,lbEdge('A','B','M110 80 L304.286 80')));
  assert.equal(ok.checks.routeLowerBend.evidence.relations[0].status,'PASS',JSON.stringify(ok.checks.routeLowerBend.evidence.relations));
  const bad=await auditAgentSvg(lbSource,lbDoc(lbA,dia,lbEdge('A','B','M110 80 L150 80 L150 30 L350 30 L350 52.571')));
  assert.equal(bad.checks.routeLowerBend.evidence.relations[0].status,'FAIL');
});
test('routeLowerBend marks a non-convex or unrecognised outline NOT-CHECKABLE for that relation only',{skip:!enabled},async()=>{
  const l=gShape('A','<path d="M10 50 L110 50 L110 80 L60 80 L60 110 L10 110 Z" fill="#fff" stroke="black"/>');
  const r=await auditAgentSvg(lbSource,lbDoc(l,lbNode('B',300,50,100,60),lbEdge('A','B','M110 65 L300 65')));
  assert.equal(r.checks.routeLowerBend.evidence.relations[0].status,'NOT-CHECKABLE');
  assert.match(r.checks.routeLowerBend.evidence.relations[0].reason,/non-convex/);
});
test('derivePorts: apex and flat faces are read from sampled outlines',()=>{
  const diamond=[];for(let t=0;t<=1;t+=0.01){diamond.push([60+50*t,50+30*t],[110-50*t,80+30*t],[60-50*t,110-30*t],[10+50*t,80-30*t])}
  const d=derivePorts(diamond);
  assert.equal(d.error,undefined);
  assert.deepEqual(d.faces.map(f=>[f.name,f.lo===f.hi]),[['top',true],['right',true],['bottom',true],['left',true]]);
  assert.deepEqual(d.faces.find(f=>f.name==='right').point,[110,80]);
  const sq=[];for(let t=0;t<=100;t++)sq.push([10+t,50],[110,50+0.6*t],[110-t,110],[10,110-0.6*t]);
  const s=derivePorts(sq);
  assert.deepEqual(s.faces.map(f=>[f.name,f.lo===f.hi]),[['top',false],['right',false],['bottom',false],['left',false]]);
  assert.equal(derivePorts([[0,0],[1,1]]).error!==undefined,true);
});

// ---- 2-bend (Z/U) lower-bend candidates for relations drawn with three or more bends ---------------------------
const R=(id,x,y,w,h)=>({id,kind:'rect',reason:null,outline:{x,y,w,h},cornerRadius:0,bbox:{x,y,w,h}});
const pureEdge=(source,target,path,extra={})=>({source,target,tag:'path',path,axialLength:10,spans:[],hulls:[],...extra});
const around='M60 50 L60 20 L450 20 L450 230 L400 230';
const zuNodes=[R('A',10,50,100,60),R('B',300,200,100,60)];
const base=[R('M',150,40,50,80),R('N',130,190,70,80)];
const run=(nodes,edges)=>checkRouteLowerBend({nodes,groups:[],edges,labelBoxes:[],unboundLabels:[]});
test('2-bend: a U route is a witness for a 3-bend drawing when every straight and L is blocked',()=>{
  const r=run([...zuNodes,...base,R('S1',10,115,100,70)],[pureEdge('A','B',around)]);
  assert.equal(r.status,'FAIL');
  const [v]=r.evidence.violations;
  assert.equal(v.witnessBends,2);
  assert.deepEqual(v.witness.faces,{source:'top',target:'top'});
});
test('2-bend: a Z route is a witness for a 3-bend drawing',()=>{
  const r=run([...zuNodes,...base,R('C',300,60,100,40),R('D',300,262,100,38)],[pureEdge('A','B',around)]);
  assert.equal(r.status,'FAIL');
  const [v]=r.evidence.violations;
  assert.equal(v.witnessBends,2);
  assert.deepEqual(v.witness.faces,{source:'bottom',target:'top'});
  assert.equal(v.witness.segments.length,3);
});
test('2-bend: a 3-bend drawing passes only when no straight, L, Z or U candidate is feasible',()=>{
  const r=run([...zuNodes,...base,R('S1',10,115,100,70),R('Q',300,130,100,60),R('D',300,262,100,38)],[pureEdge('A','B',around)]);
  assert.equal(r.status,'PASS');
  assert.deepEqual(r.evidence.relations.map(x=>[x.edge,x.status,x.drawnBends]),[['A->B','PASS',3]]);
});
test('2-bend: a route with 4 or more bends is never PASS without a 3-bend search',()=>{
  const r=run([...zuNodes,...base,R('S1',10,115,100,70),R('Q',300,130,100,60),R('D',300,262,100,38)],[pureEdge('A','B','M60 50 L60 20 L450 20 L450 290 L350 290 L350 260')]);
  assert.equal(r.evidence.relations[0].status,'NOT-CHECKABLE');
  assert.match(r.evidence.relations[0].reason,/3-bend/);
});

// ---- shared trunks (rule 10) --------------------------------------------------------------------------------------
const span=(axis,fixed,lo,hi,end)=>({axis,fixed,lo,hi,length:hi-lo,end});
const withLast=(spans,c='L')=>Object.assign(spans,{lastCommand:c});
const trunkNodes=[R('A',10,20,100,60),R('B',10,120,100,60),R('T',400,70,100,60)];
const dA='M110 50 L255 50 Q260 50 260 55 L260 95 Q260 100 265 100 L400 100';
const dB='M110 150 L255 150 Q260 150 260 145 L260 105 Q260 100 265 100 L400 100';
const trunkEdges=(trunk)=>[
  pureEdge('A','T',dA,{trunk,spans:withLast([span('h',50,110,255,255),span('v',260,55,95,95),span('h',100,265,400,400)])}),
  pureEdge('B','T',dB,{trunk,spans:withLast([span('h',150,110,255,255),span('v',260,105,145,105),span('h',100,265,400,400)])})];
test('trunk: a declared trunk member keeps its shared final segment — the witness must end at the trunk entry',()=>{
  const r=run(trunkNodes,trunkEdges('t1'));
  const a=r.evidence.violations.find(v=>v.edge==='A->T');
  assert.ok(a,JSON.stringify(r.evidence.relations));
  assert.equal(a.witnessBends,1);
  assert.deepEqual(a.witness.anchors.target,[400,100]);
  const undeclared=run(trunkNodes,trunkEdges(null));
  const u=undeclared.evidence.violations.find(v=>v.edge==='A->T');
  assert.equal(u.witnessBends,0);
  assert.notDeepEqual(u.witness.anchors.target,[400,100]);
});
test('trunk: a member passes when the only better route would leave the trunk',()=>{
  const nodes=[...trunkNodes,R('E',10,84,100,12),R('E2',10,104,100,12)];
  const declared=run(nodes,trunkEdges('t1'));
  assert.deepEqual(declared.evidence.relations.map(x=>[x.edge,x.status]),[['A->T','PASS'],['B->T','PASS']]);
  assert.equal(declared.status,'PASS');
  const undeclared=run(nodes,trunkEdges(null));
  assert.equal(undeclared.evidence.relations[0].status,'FAIL');
});

// ---- obstacles: certain vs uncertain node geometry ------------------------------------------------------------------
const diamondSamples=(cx,cy,hw,hh)=>{const out=[];for(let t=0;t<=1;t+=0.01)out.push([cx+hw*t,cy-hh+hh*t],[cx+hw-hw*t,cy+hh*t],[cx-hw*t,cy+hh-hh*t],[cx-hw+hw*t,cy-hh*t]);return out};
const detour='M60 50 L60 30 L350 30 L350 50';
const abPair=[R('A',10,50,100,60),R('B',300,50,100,60)];
test('obstacle: an unrelated node that blocks the straight route only by an unusable outline is uncertain, so the detour is NOT-CHECKABLE',()=>{
  const r=run([...abPair,{id:'U',kind:'unsupported',reason:'x',bbox:{x:150,y:40,w:100,h:90}}],[pureEdge('A','B',detour)]);
  assert.equal(r.evidence.relations[0].status,'NOT-CHECKABLE');
  assert.match(r.evidence.relations[0].reason,/uncertain|unmeasured/);
});
test('obstacle: a supported unrelated diamond blocks through its outline, so the detour passes; a rectangle does too',()=>{
  const blockDiamond={id:'D',kind:'shape',samples:diamondSamples(200,85,60,45),bbox:{x:140,y:40,w:120,h:90}};
  const r=run([...abPair,blockDiamond],[pureEdge('A','B',detour)]);
  assert.equal(r.evidence.relations[0].status,'PASS',JSON.stringify(r.evidence.relations));
  const rect=run([...abPair,R('D',140,40,120,90)],[pureEdge('A','B',detour)]);
  assert.equal(rect.evidence.relations[0].status,'PASS');
});
