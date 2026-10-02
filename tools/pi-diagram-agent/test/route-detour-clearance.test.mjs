import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {checkRouteContainerClearance} from '../src/route-clearance.mjs';
import {auditToFindings} from '../src/findings.mjs';
import {earlyFindings} from '../src/early-checks.mjs';
import {auditGateReasons} from '../src/gate.mjs';
import {buildReviewerPrompt} from '../src/reviewer.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const defs='<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs>';
const node=(id,x,y,w,h)=>`<g data-node="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="black"/><text x="${x+14}" y="${y+h/2+4}">N</text></g>`;
const edge=(s,t,d)=>`<path data-source="${s}" data-target="${t}" d="${d}" stroke="black" fill="none" marker-end="url(#arrow)"/>`;
const group=(id,x,y,w,h)=>`<g data-group="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="black" fill="none"/></g>`;
const label=(s,t,x,y,w=40,h=14,text='x')=>`<g data-edge-label-source="${s}" data-edge-label-target="${t}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/><text x="${x+4}" y="${y+h-3}">${text}</text></g>`;
const doc=(...parts)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">${defs}${parts.join('')}</svg>`;
const src='flowchart LR\n A[N] --> B[N]\n';
const srcLabel='flowchart LR\n A[N] -->|x| B[N]\n';
const check=async(source,svg,name)=>(await auditAgentSvg(source,svg)).checks[name];

// ---- routeDetour ------------------------------------------------------------------------
test('routeDetour fails a route that wraps around the canvas when a short feasible route exists, and reports the witness',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(src,doc(node('A',10,300,100,60),node('B',300,300,100,60),edge('A','B','M60 360 L60 800 L350 800 L350 360')));
  const c=r.checks.routeDetour;
  assert.equal(c.status,'FAIL');
  const [v]=c.evidence.violations;
  assert.equal(v.edge,'A->B');
  assert.equal(v.drawnLength,1170);
  assert.equal(v.witnessLength,190);
  assert.ok(v.limit<v.drawnLength);
  assert.ok(v.witness.segments.length>=1);
  assert.equal(r.status,'FAIL');
});

test('routeDetour passes the shortest route and a modest detour around a blocker',{skip:!enabled},async()=>{
  const nodes=[node('A',10,300,100,60),node('B',300,300,100,60)];
  assert.equal((await check(src,doc(...nodes,edge('A','B','M110 330 L300 330')),'routeDetour')).status,'PASS');
  const around=await check(src,doc(...nodes,node('M',180,280,40,100),edge('A','B','M60 300 L60 250 L350 250 L350 300')),'routeDetour');
  assert.equal(around.status,'PASS');
});

test('routeDetour is NOT-CHECKABLE (never PASS) when no feasible witness exists',{skip:!enabled},async()=>{
  // A is walled in by blockers 3 units from every face, so no candidate leg is long enough to leave it.
  const walls=[node('W1',197,100,106,6),node('W2',197,194,106,6),node('W3',197,100,6,100),node('W4',297,100,6,100)];
  const r=await check(src,doc(node('A',200,130,94,40),node('B',600,130,100,40),...walls,edge('A','B','M294 150 L600 150')),'routeDetour');
  assert.equal(r.status,'NOT-CHECKABLE');
  assert.match(JSON.stringify(r.evidence.notCheckable),/no feasible/i);
});

// ---- routeContainerClearance: routes ----------------------------------------------------------
const AB=[node('A',10,10,60,40),node('B',500,10,60,40)];
test('routeContainerClearance fails a connector riding 4 units from an unrelated container border and passes it 30 units away',{skip:!enabled},async()=>{
  const bad=await check(src,doc(...AB,group('G',200,34,200,100),edge('A','B','M70 30 L500 30')),'routeContainerClearance');
  assert.equal(bad.status,'FAIL');
  const [v]=bad.evidence.violations;
  assert.deepEqual([v.edge,v.container,v.side,v.relation],['A->B','G','top','unrelated']);
  assert.equal(v.distance,4);
  assert.ok(v.length>=200);
  const ok=await check(src,doc(...AB,group('G',200,60,200,100),edge('A','B','M70 30 L500 30')),'routeContainerClearance');
  assert.equal(ok.status,'PASS');
});

test('routeContainerClearance counts riding along the inside of the source container border as grazing',{skip:!enabled},async()=>{
  const nodes=[node('A',20,20,60,40),node('B',400,175,60,40)];
  const r=await check(src,doc(group('G',0,0,300,200),...nodes,edge('A','B','M50 60 L50 195 L400 195')),'routeContainerClearance');
  assert.equal(r.status,'FAIL');
  assert.equal(r.evidence.violations[0].relation,'source-ancestor');
  assert.equal(r.evidence.violations[0].side,'bottom');
});

test('routeContainerClearance allows the crossing point of an ancestor border but not the run beyond it',{skip:!enabled},async()=>{
  const nodes=[node('A',20,20,60,40),node('B',400,230,60,40)];
  // leaves G through the bottom border at x=50, turns 6 units below it and runs 30 units: only 18 units lie outside the +-12 crossing allowance.
  const near=await check(src,doc(group('G',0,0,300,200),...nodes,edge('A','B','M50 60 L50 206 L80 206 L80 250 L400 250')),'routeContainerClearance');
  assert.equal(near.status,'PASS');
  const far=await check(src,doc(group('G',0,0,300,200),...nodes,edge('A','B','M50 60 L50 206 L250 206 L250 250 L400 250')),'routeContainerClearance');
  assert.equal(far.status,'FAIL');
  // a straight exit through the border is a plain crossing
  const straight=await check(src,doc(group('G',0,0,300,200),node('A',20,80,60,40),node('B',400,80,60,40),edge('A','B','M80 100 L400 100')),'routeContainerClearance');
  assert.equal(straight.status,'PASS');
});

test('routeContainerClearance fails a connector in a gutter narrower than 8 units on both sides, passes a 40-unit gutter',{skip:!enabled},async()=>{
  const nodes=[node('A',10,300,60,40),node('B',700,300,60,40)];
  const narrow=await check(src,doc(group('G1',100,100,200,200),group('G2',100,314,200,200),...nodes,edge('A','B','M70 307 L700 307')),'routeContainerClearance');
  assert.equal(narrow.status,'FAIL');
  assert.deepEqual(narrow.evidence.violations.map(v=>v.container).sort(),['G1','G2']);
  const wide=await check(src,doc(group('G1',100,100,200,180),group('G2',100,340,200,200),...nodes,edge('A','B','M70 310 L700 310')),'routeContainerClearance');
  assert.equal(wide.status,'PASS');
});

// ---- routeContainerClearance: edge labels ------------------------------------------------------
test('routeContainerClearance fails an edge label within 4 units of a container border (also when untagged) and passes a clear label',{skip:!enabled},async()=>{
  const g=group('G',200,100,200,100),route=edge('A','B','M70 30 L500 30');
  const onBorder=await check(srcLabel,doc(...AB,g,route,label('A','B',250,96)),'routeContainerClearance');
  assert.equal(onBorder.status,'FAIL');
  assert.equal(onBorder.evidence.labelViolations[0].container,'G');
  const near=await check(srcLabel,doc(...AB,g,route,label('A','B',250,86)),'routeContainerClearance');   // box 86..100: touches the top border
  assert.equal(near.status,'FAIL');
  const close=await check(srcLabel,doc(...AB,g,route,label('A','B',250,83)),'routeContainerClearance'); // box 83..97: 3 units away
  assert.equal(close.status,'FAIL');
  const clear=await check(srcLabel,doc(...AB,g,route,label('A','B',250,60)),'routeContainerClearance');
  assert.equal(clear.status,'PASS');
  const inside=await check(srcLabel,doc(...AB,g,route,label('A','B',250,130)),'routeContainerClearance');
  assert.equal(inside.status,'PASS');
  const untagged=`<g class="edge-label" data-owner-edge="e1"><rect x="250" y="96" width="40" height="14" fill="white"/><text x="254" y="107">x</text></g>`;
  const u=await check(srcLabel,doc(...AB,g,route,untagged),'routeContainerClearance');
  assert.equal(u.status,'FAIL');
});

test('routeContainerClearance is NOT-CHECKABLE when container geometry or a source label is unknown',{skip:!enabled},async()=>{
  const unlabelled=await check(srcLabel,doc(...AB,group('G',200,100,200,100),edge('A','B','M70 30 L500 30')),'routeContainerClearance');
  assert.equal(unlabelled.status,'NOT-CHECKABLE');
  const round=`<g data-group="G"><path d="M200 100 L400 100 L400 200 L200 200 Z" fill="none" stroke="black"/><polygon points="0,0"/></g>`;
  const nonRect=await check(src,doc(...AB,round,edge('A','B','M70 30 L500 30')),'routeContainerClearance');
  assert.equal(nonRect.status,'NOT-CHECKABLE');
  const none=await check(src,doc(...AB,edge('A','B','M70 30 L500 30')),'routeContainerClearance');
  assert.equal(none.status,'PASS');   // no containers: nothing to graze
});

// ---- pure function -----------------------------------------------------------------------------
test('checkRouteContainerClearance never PASSes a route whose straight spans are unknown while containers exist',()=>{
  const r=checkRouteContainerClearance({groups:[{id:'G',outline:'rect',box:{x:0,y:0,w:10,h:10}}],nodes:[],edges:[{source:'A',target:'B',spans:null}],labels:[],unresolvedLabels:[]});
  assert.equal(r.status,'NOT-CHECKABLE');
});

// ---- wiring ------------------------------------------------------------------------------------
test('FAIL results of both checks are early blocking findings and block the gate',()=>{
  const audit={status:'FAIL',checks:{
    routeDetour:{status:'FAIL',evidence:{method:'m',violations:[{edge:'A->B',drawnLength:1170,witnessLength:190}]}},
    routeContainerClearance:{status:'FAIL',evidence:{method:'m',violations:[{edge:'A->C',container:'G',side:'top',distance:4,length:200}]}},
    semanticPreservation:{status:'PASS',evidence:'x'}}};
  const early=earlyFindings({svgText:'<svg/>',audit});
  assert.deepEqual(early.map(f=>f.rule).sort(),['routeContainerClearance','routeDetour']);
  assert.ok(early.every(f=>f.severity==='blocking'&&!/Resolve the .* failure shown/.test(f.suggestion)));
  assert.ok(auditToFindings(audit).length===2);
  assert.match(auditGateReasons({audit,forbidden:[]}).map(r=>r.detail).join(),/routeDetour.*routeContainerClearance|routeContainerClearance.*routeDetour/);
});

test('the reviewer prompt names the detour and container-clearance measurements',()=>{
  for(const measured of ['skip','report']){
    const p=buildReviewerPrompt({facts:{nodes:[],edges:[],groups:[]},audit:{},geometry:{},imageLabels:[],measured});
    assert.match(p,/shortest feasible route/i);
    assert.match(p,/within 8 units along a container border/i);
    assert.match(p,/within 4 units of a container border/i);
  }
});
