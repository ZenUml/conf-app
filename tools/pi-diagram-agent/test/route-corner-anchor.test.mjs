import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {checkRouteCornerAnchor} from '../src/route-corner-anchor.mjs';
import {auditToFindings} from '../src/findings.mjs';
import {earlyFindings,EARLY_MEASURED_RULES} from '../src/early-checks.mjs';
import {auditGateReasons,evaluateGate} from '../src/gate.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;

// ---- pure function: synthetic measured input ----------------------------------------------------
const rect=(id,x,y,w,h,cornerRadius=0)=>({id,kind:'rect',outline:{x,y,w,h},cornerRadius,bbox:{x,y,w,h}});
const edge=(source,target,path)=>({source,target,tag:'path',path,trunk:null});
const T=rect('T',300,200,200,60);                          // top face: y=200, x 300..500 (length 200)
const S=(id,cx,w=60)=>rect(id,cx-w/2,40,w,60);             // source above, anchored at its own bottom midpoint
const run=(nodes,edges)=>checkRouteCornerAnchor({nodes,edges});
const only=r=>{assert.equal(r.evidence.violations.length,1);return r.evidence.violations[0]};

test('routeCornerAnchor FAILs a single connector ending exactly at a rectangle corner',()=>{
  const r=run([S('S',300),T],[edge('S','T','M300 100 L300 200')]);
  assert.equal(r.status,'FAIL');
  const v=only(r);
  assert.deepEqual([v.edge,v.end,v.node,v.face],['S->T','target','T','top']);
  assert.equal(v.distance,0);
  assert.equal(v.threshold,20);
});

test('routeCornerAnchor FAILs 5 units from the end of a 200-unit face (threshold 20) and passes 25 units',()=>{
  const bad=run([S('S',305),T],[edge('S','T','M305 100 L305 200')]);
  assert.equal(bad.status,'FAIL');
  const v=only(bad);
  assert.deepEqual([v.distance,v.threshold,v.faceLength],[5,20,200]);
  const ok=run([S('S',325),T],[edge('S','T','M325 100 L325 200')]);
  assert.equal(ok.status,'PASS');
  assert.equal(ok.evidence.violations.length,0);
});

test('routeCornerAnchor uses the 8-unit floor on a short face: 9 units from the end of a 60-unit face passes, 7 fails',()=>{
  const short=rect('T',300,200,60,60);
  const ok=run([S('S',309,40),short],[edge('S','T','M309 100 L309 200')]);
  assert.equal(ok.status,'PASS');
  const bad=run([S('S',307,40),short],[edge('S','T','M307 100 L307 200')]);
  assert.equal(bad.status,'FAIL');
  assert.equal(only(bad).threshold,8);
});

test('routeCornerAnchor checks the source end too',()=>{
  // Connector leaves the bottom face of S at its left corner and lands at T midpoint.
  const r=run([rect('S',300,40,200,60),rect('T',300,200,200,60)],[edge('S','T','M302 100 L302 150 L400 150 L400 200')]);
  assert.equal(r.status,'FAIL');
  const v=only(r);
  assert.deepEqual([v.end,v.node,v.face],['source','S','bottom']);
});

test('routeCornerAnchor on a shared face of 3 connectors FAILs only the connector at the corner and hints the even slot',()=>{
  const nodes=[S('S1',301),S('S2',400),S('S3',450),T];
  const r=run(nodes,[edge('S1','T','M301 100 L301 200'),edge('S2','T','M400 100 L400 200'),edge('S3','T','M450 100 L450 200')]);
  assert.equal(r.status,'FAIL');
  const v=only(r);
  assert.equal(v.edge,'S1->T');
  assert.equal(v.sharedBy,3);
  assert.equal(v.repairHint.anchor,350);              // slot 1/4 of the 200-unit face
  assert.equal(v.repairHint.slot,'1/4');
  assert.match(v.repairHint.text,/350/);
});

test('routeCornerAnchor hints the face midpoint for a single connector',()=>{
  const v=only(run([S('S',300),T],[edge('S','T','M300 100 L300 200')]));
  assert.equal(v.repairHint.anchor,400);
  assert.deepEqual(v.repairHint.point,[400,200]);
  assert.equal(v.repairHint.slot,'midpoint');
});

test('routeCornerAnchor measures a rounded rectangle on its straight edge',()=>{
  const round=rect('T',300,200,200,60,10);            // straight top edge x 310..490
  const bad=run([S('S',315),round],[edge('S','T','M315 100 L315 200')]); // 5 from the straight end, 15 from the bounding corner
  assert.equal(bad.status,'FAIL');
  assert.deepEqual([only(bad).distance,only(bad).faceLength],[5,180]);
  const ok=run([S('S',400),round],[edge('S','T','M400 100 L400 200')]);
  assert.equal(ok.status,'PASS');
});

test('routeCornerAnchor excludes fixed-port shapes (diamond vertex is by design) and never FAILs them',()=>{
  const samples=[];for(let t=0;t<=1;t+=0.01)samples.push([400+60*t,100+60*t],[460-60*t,160+60*t],[400-60*t,220-60*t],[340+60*t,160-60*t]);
  const diamond={id:'D',kind:'shape',samples,bbox:{x:340,y:100,w:120,h:120}};
  const r=run([diamond,rect('T',300,300,200,60)],[edge('D','T','M400 220 L400 300')]);
  assert.notEqual(r.status,'FAIL');
  assert.equal(r.evidence.excludedEnds,1);
  assert.equal(r.evidence.violations.length,0);
});

test('routeCornerAnchor reports NOT-CHECKABLE (never PASS) for curved and diagonal endpoints',()=>{
  const curved=run([S('S',300),T],[edge('S','T','M300 100 Q300 150 305 200')]);
  assert.equal(curved.status,'NOT-CHECKABLE');
  assert.deepEqual(curved.evidence.notCheckable.map(n=>n.edge),['S->T']);
  const diagonal=run([S('S',300),T],[edge('S','T','M300 100 L320 200')]);
  assert.equal(diagonal.status,'NOT-CHECKABLE');
  const lost=run([S('S',400),T],[edge('S','T','M400 100 L400 190')]);   // stops 10 units short of the face: no face to resolve
  assert.equal(lost.status,'NOT-CHECKABLE');
});

test('routeCornerAnchor: a corner FAIL on one relation is not hidden by an unresolvable one (FAIL wins, NOT-CHECKABLE still listed)',()=>{
  const r=run([S('S1',300),S('S2',400),T],[edge('S1','T','M300 100 L300 200'),edge('S2','T','M400 100 Q400 150 405 200')]);
  assert.equal(r.status,'FAIL');
  assert.equal(r.evidence.notCheckable.length,1);
});

// ---- wiring through the real auditor (needs the browser environment) ----------------------------
const defs='<defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs>';
const node=(id,x,y,w,h)=>`<g data-node="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" stroke="black"/><text x="${x+14}" y="${y+h/2+4}" fill="#000000" font-weight="400">N</text></g>`;
const path=(s,t,d)=>`<path data-source="${s}" data-target="${t}" d="${d}" stroke="black" fill="none" marker-end="url(#arrow)"/>`;
const doc=(...p)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320">${defs}${p.join('')}</svg>`;
const SRC='flowchart LR\n A[N] --> B[N]\n';
const A=node('A',10,50,200,60),B=node('B',10,200,200,60);

test('auditAgentSvg: routeCornerAnchor FAILs a connector ending at a rectangle corner and PASSes the midpoint twin',{skip:!enabled},async()=>{
  const bad=await auditAgentSvg(SRC,doc(A,B,path('A','B','M10 110 L10 200')));
  assert.equal(bad.checks.routeCornerAnchor.status,'FAIL');
  assert.equal(bad.status,'FAIL');
  const good=await auditAgentSvg(SRC,doc(A,B,path('A','B','M110 110 L110 200')));
  assert.equal(good.checks.routeCornerAnchor.status,'PASS');
});

test('auditAgentSvg: routeCornerAnchor leaves a diamond vertex alone and marks a curved endpoint NOT-CHECKABLE',{skip:!enabled},async()=>{
  const diamond='<g data-node="A"><polygon points="110,40 170,80 110,120 50,80" fill="#fff" stroke="black"/><text x="95" y="85">N</text></g>';
  const d=await auditAgentSvg(SRC,doc(diamond,B,path('A','B','M110 120 L110 200')));
  assert.notEqual(d.checks.routeCornerAnchor.status,'FAIL');
  const c=await auditAgentSvg(SRC,doc(A,B,path('A','B','M110 110 Q110 150 112 200')));
  assert.equal(c.checks.routeCornerAnchor.status,'NOT-CHECKABLE');
});

// ---- gate integration ---------------------------------------------------------------------------
test('a candidate whose only defect is a corner anchor is not REVIEWED: blocking early finding and gate failure, not waivable',{skip:!enabled},async()=>{
  const audit=await auditAgentSvg(SRC,doc(A,B,path('A','B','M10 110 L10 200')));
  const failing=Object.entries(audit.checks).filter(([,c])=>c.status==='FAIL').map(([k])=>k);
  assert.deepEqual(failing,['routeCornerAnchor']);   // the only defect
  const early=earlyFindings({svgText:'<svg/>',audit});
  assert.deepEqual(early.filter(f=>f.severity==='blocking').map(f=>f.rule),['routeCornerAnchor']);   // a midpoint-only lowerBend minor may ride along
  assert.match(early.find(f=>f.rule==='routeCornerAnchor').suggestion,/10%/);
  const gate=evaluateGate({reviewedHash:'a',finalHash:'a',renderedHash:'a',audit,forbidden:[],review:{ok:true,verdict:'accept'},openBlocking:0});
  assert.equal(gate.pass,false);
  assert.match(gate.reasons.map(r=>r.detail).join(),/routeCornerAnchor/);
});

test('routeCornerAnchor is an early measured rule and a FAIL blocks the gate even with a clean review',()=>{
  assert.ok(EARLY_MEASURED_RULES.includes('routeCornerAnchor'));
  const audit={status:'FAIL',checks:{
    routeCornerAnchor:{status:'FAIL',evidence:{method:'m',violations:[{edge:'A->B',end:'target',node:'B',face:'top',distance:0,threshold:20,repairHint:{anchor:110,text:'move to 110'}}]}},
    semanticPreservation:{status:'PASS',evidence:'x'}}};
  assert.equal(auditToFindings(audit).length,1);
  assert.deepEqual(earlyFindings({svgText:'<svg/>',audit}).map(f=>f.rule),['routeCornerAnchor']);
  assert.equal(auditGateReasons({audit,forbidden:[]})[0].code,'AUDIT_FAIL');
  assert.equal(evaluateGate({reviewedHash:'a',finalHash:'a',renderedHash:'a',audit,forbidden:[],review:{ok:true},openBlocking:0}).pass,false);
});
