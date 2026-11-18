import test from 'node:test';
import assert from 'node:assert/strict';
import {gateModeFromEnv,isBlockingRule,relaxFindings,BLOCKING_AUDIT_RULES,ADVICE_IMPACT,REVIEW_BLOCKING_RULES} from '../src/relaxed.mjs';
import {auditToFindings,makeFinding,selectAdvice,createLedger} from '../src/findings.mjs';
import {earlyFindings} from '../src/early-checks.mjs';
import {geometryFindings} from '../src/geometry.mjs';
import {auditGateReasons} from '../src/gate.mjs';
import {auditAgentSvg} from '../src/agent-audit.mjs';

const R={relaxed:true};
const fail=(evidence={method:'m',violations:[{edgeA:'A->B',edgeB:'C->D'}]})=>({status:'FAIL',evidence});
const one=(rule,check,opts=R)=>auditToFindings({status:'FAIL',checks:{[rule]:check}},opts);
const sev=(rule,check,opts=R)=>one(rule,check,opts).filter(f=>f.rule===rule).map(f=>f.severity);

test('mode: relaxed is the default; PI_DIAGRAM_GATE=strict selects strict; anything else is relaxed',()=>{
  assert.equal(gateModeFromEnv({}),'relaxed');
  assert.equal(gateModeFromEnv({PI_DIAGRAM_GATE:'strict'}),'strict');
  assert.equal(gateModeFromEnv({PI_DIAGRAM_GATE:'relaxed'}),'relaxed');
  assert.equal(gateModeFromEnv({PI_DIAGRAM_GATE:'nonsense'}),'relaxed');
});

test('relaxed: every semantic, arrowhead and label-over-line audit FAIL stays blocking',()=>{
  for(const rule of ['svgWellFormed','nodeIdentity','nodeText','nodeShape','relations','relationStyle','groups','groupMembership','originalGroupParity','semanticPreservation','sourceDefinitionConflicts','markerDrawing','labelCoversRoute']){
    assert.ok(BLOCKING_AUDIT_RULES.includes(rule),`${rule} listed`);
    assert.deepEqual(sev(rule,fail()),['blocking'],rule);
    assert.equal(isBlockingRule(rule),true);
  }
});

test('relaxed: geometry nicety audit FAILs become minor findings with an impact score; strict keeps them blocking',()=>{
  for(const rule of ['routeContainerClearance','routePairClearance','routeLowerBend','routeCrossings','routeDetour','labelFontFit','legendCompleteness','connectorStrokeWidth','filletUniformity','markerUniformity','textContrast','labelFontWeight','routeCornerAnchor','routeUnrelatedContainerTransit','arrowShaft','edgeLabelStyle']){
    const out=one(rule,fail()).filter(f=>f.rule===rule);
    assert.deepEqual(out.map(f=>f.severity),['minor'],`${rule} relaxed`);
    assert.equal(isBlockingRule(rule),false);
    assert.ok(Number.isFinite(relaxFindings(out)[0].impact)&&relaxFindings(out)[0].impact>0,`${rule} impact`);
    assert.deepEqual(sev(rule,fail(),{}),['blocking'],`${rule} strict`);
  }
  assert.ok(ADVICE_IMPACT.routeCrossings>ADVICE_IMPACT.legendCompleteness);
});

test('textFit: glyphs beyond the outline block; glyphs inside the 8-unit inset margin and label-box-only issues are advice',()=>{
  const beyond=fail({method:'m',inset:8,overflows:[{nodeId:'A',left:12,top:0,right:0,bottom:0}],structureOverlaps:[],labelBoxWarnings:[]});
  assert.deepEqual(sev('textFit',beyond),['blocking']);
  const margin=fail({method:'m',inset:8,overflows:[{nodeId:'A',left:3,top:0,right:0,bottom:0}],structureOverlaps:[]});
  assert.deepEqual(sev('textFit',margin),['minor']);
  const touching=fail({method:'m',overflows:[],structureOverlaps:[{nodeId:'DB',gap:0,required:4}]});
  assert.deepEqual(sev('textFit',touching),['blocking']);
  const near=fail({method:'m',overflows:[],structureOverlaps:[{nodeId:'DB',gap:2.5,required:4}]});
  assert.deepEqual(sev('textFit',near),['minor']);
  const mixed=fail({method:'m',overflows:[{nodeId:'A',left:12,top:0,right:0,bottom:0},{nodeId:'B',left:2,top:0,right:0,bottom:0}],structureOverlaps:[]});
  const out=one('textFit',mixed);
  assert.deepEqual(out.map(f=>[f.severity,f.elements.join()]).sort(),[['blocking','A'],['minor','B']]);
  // unknown shape of evidence fails closed
  assert.deepEqual(sev('textFit',fail('some string')),['blocking']);
});

test('labelClearance blocks only when the label box covers node text; a touch on an outline is advice',()=>{
  const covers=fail({method:'m',violations:[{label:'A->B',outline:'node:B',labelBox:{},coversNodeText:true}]});
  assert.deepEqual(sev('labelClearance',covers),['blocking']);
  const edge=fail({method:'m',violations:[{label:'A->B',outline:'node:B',labelBox:{},coversNodeText:false}]});
  assert.deepEqual(sev('labelClearance',edge),['minor']);
  const group=fail({method:'m',violations:[{label:'A->B',outline:'group:G',labelBox:{},coversNodeText:false}]});
  assert.deepEqual(sev('labelClearance',group),['minor']);
  const unknown=fail({method:'m',violations:[{label:'A->B',outline:'node:B',labelBox:{}}]});
  assert.deepEqual(sev('labelClearance',unknown),['blocking']);
});

test('heading checks block only on actual overlap; the 8-unit and 12-unit margins are advice',()=>{
  const overlap=fail({method:'m',violations:[{kind:'heading',nodeId:'A',groupId:'G',gap:0,required:8}]});
  assert.deepEqual(sev('nodeHeadingClearance',overlap),['blocking']);
  const margin=fail({method:'m',violations:[{kind:'heading',nodeId:'A',groupId:'G',gap:5,required:8}]});
  assert.deepEqual(sev('nodeHeadingClearance',margin),['minor']);
  const border=fail({method:'m',violations:[{kind:'container-border',nodeId:'A',groupId:'G',gap:0,required:8}]});
  assert.deepEqual(sev('nodeHeadingClearance',border),['minor']);
  const routeOverlap=fail({method:'m',intrusions:[{edge:'A->B',groupIds:['G']}],headingOverlaps:[{edge:'A->B',groupIds:['G']}]});
  assert.deepEqual(sev('routeHeadingClearance',routeOverlap),['minor']);
  const routeGuard=fail({method:'m',intrusions:[{edge:'A->B',groupIds:['G']}],headingOverlaps:[]});
  assert.deepEqual(sev('routeHeadingClearance',routeGuard),['minor']);
});

test('routeNodeIntrusion blocks only when the route passes through node text; endpoint and fill-only intrusions are advice',()=>{
  const text=fail({method:'m',endpointErrors:[],intrusions:[{edge:'A->B',nodeIds:['C']}],textIntrusions:[{edge:'A->B',nodeIds:['C']}]});
  assert.deepEqual(sev('routeNodeIntrusion',text),['blocking']);
  const fill=fail({method:'m',endpointErrors:[],intrusions:[{edge:'A->B',nodeIds:['C']}],textIntrusions:[]});
  assert.deepEqual(sev('routeNodeIntrusion',fill),['minor']);
  const endpoint=fail({method:'m',endpointErrors:['A->B'],intrusions:[],textIntrusions:[]});
  assert.deepEqual(sev('routeNodeIntrusion',endpoint),['minor']);
});

test('relaxed early findings: bindings and forbidden constructs stay blocking, measured nicety rules become minor',()=>{
  const audit={status:'FAIL',checks:{nodeIdentity:{status:'NOT-CHECKABLE',evidence:'no data-node binding found'},textFit:fail({method:'m',overflows:[{nodeId:'A',left:2,top:0,right:0,bottom:0}],structureOverlaps:[]}),routeDetour:fail()}};
  const f=earlyFindings({svgText:'<svg><path stroke="context-stroke"/></svg>',audit,relaxed:true});
  assert.deepEqual(Object.fromEntries(f.map(x=>[x.rule,x.severity])),{'forbidden-construct':'blocking',nodeIdentity:'blocking',textFit:'minor',routeDetour:'minor'});
  const strict=earlyFindings({svgText:'<svg/>',audit});
  assert.equal(strict.find(x=>x.rule==='textFit').severity,'blocking');
});

test('gate: advice-only FAILs do not block the relaxed gate; a blocking FAIL still does; strict is unchanged',()=>{
  const audit={checks:{semanticPreservation:{status:'PASS'},routeCrossings:fail(),textFit:fail({method:'m',overflows:[{nodeId:'A',left:1,top:0,right:0,bottom:0}],structureOverlaps:[]})}};
  assert.deepEqual(auditGateReasons({audit,forbidden:[],relaxed:true}),[]);
  assert.equal(auditGateReasons({audit,forbidden:[]})[0].code,'AUDIT_FAIL');
  const blocking={checks:{semanticPreservation:{status:'PASS'},relations:fail()}};
  assert.equal(auditGateReasons({audit:blocking,forbidden:[],relaxed:true})[0].code,'AUDIT_FAIL');
});

test('geometry findings under relaxed: detached and border-clearance are advice; ambiguity blocks only when the label sits on another route',()=>{
  const g={natural:{w:600,h:200},nodes:[],groups:[],
    labels:[{source:'A',target:'B',box:{x:100,y:100,w:40,h:20}}],
    edges:[{id:'A->B',points:[[0,0],[10,0]]},{id:'C->D',points:[[100,110],[140,110]]}]};
  const model={nodes:[{id:'A'},{id:'B'},{id:'C'},{id:'D'}],edges:[{source:'A',target:'B',label:'x'},{source:'C',target:'D'}],groups:[]};
  const strict=geometryFindings(g,model);
  const relaxed=geometryFindings(g,model,{relaxed:true});
  const ambStrict=strict.find(f=>f.rule==='label-ambiguous'),ambRelaxed=relaxed.find(f=>f.rule==='label-ambiguous');
  assert.equal(ambStrict.severity,'blocking');
  assert.equal(ambRelaxed.severity,'blocking'); // the label box touches C->D's route
  assert.equal(strict.find(f=>f.rule==='label-detached').severity,'blocking');
  assert.equal(relaxed.find(f=>f.rule==='label-detached').severity,'minor');
  const g2={...g,edges:[{id:'A->B',points:[[0,0],[10,0]]},{id:'C->D',points:[[100,140],[140,140]]}]};
  const amb2=geometryFindings(g2,model,{relaxed:true}).find(f=>f.rule==='label-ambiguous');
  assert.equal(amb2.severity,'minor');
});

test('reviewer findings under relaxed: semantic errors, border coincidence and group overlap stay blocking',()=>{
  assert.deepEqual([...REVIEW_BLOCKING_RULES].sort(),['boundary-coincidence','group-overlap','label-ownership','layout-intent','shape-change','text-overflow']);
  const mk=(rule,source='review')=>makeFinding({source,severity:'blocking',rule,elements:['A'],evidence:{measured:'x',threshold:'y'},suggestion:'s'});
  const rules=['layout-intent','label-ownership','detour','legend','shape-change','text-overflow','balance','route-node-intrusion','route-crossing','heading-overlap','node-heading-clearance','label-clearance','boundary-coincidence','group-overlap','box-size-consistency','early-merge','other'];
  const out=Object.fromEntries(relaxFindings(rules.map(r=>mk(r))).map(f=>[f.rule,f.severity]));
  for(const r of rules)assert.equal(out[r],REVIEW_BLOCKING_RULES.includes(r)?'blocking':'minor',r);
  const adv=relaxFindings([mk('balance')])[0];
  assert.ok(adv.impact>0);assert.equal(adv.relaxedFrom,'blocking');
});

test('relaxFindings keeps structural early findings blocking and never touches minors that already have an impact',()=>{
  const e=(rule,source='early')=>makeFinding({source,severity:'blocking',rule,elements:['x'],evidence:{measured:'m',threshold:'t'},suggestion:'s'});
  const out=Object.fromEntries(relaxFindings([e('candidate-missing'),e('render-or-audit-failed'),e('forbidden-construct'),e('gate-HASH_MISMATCH'),e('label-ambiguous'),e('label-detached'),e('route-border-clearance')]).map(f=>[f.rule,f.severity]));
  assert.deepEqual(out,{'candidate-missing':'blocking','render-or-audit-failed':'blocking','forbidden-construct':'blocking','gate-HASH_MISMATCH':'blocking','label-ambiguous':'blocking','label-detached':'minor','route-border-clearance':'minor'});
});

test('selectAdvice returns at most N open minor findings, highest impact first, as compact items',()=>{
  const ledger=createLedger();
  const mk=(rule,impact)=>({...makeFinding({source:'audit',severity:'minor',rule,elements:[rule],evidence:{measured:'m',threshold:'t'},suggestion:`fix ${rule}`}),impact});
  ledger.update(1,[mk('a',0.1),mk('b',0.9),mk('c',0.5),mk('d',0.7),mk('e',0.3)]);
  const advice=selectAdvice(ledger,{max:3});
  assert.deepEqual(advice.sent.map(x=>x.rule),['b','d','c']);
  assert.equal(advice.total,5);
  assert.ok(advice.sent[0].suggestion&&advice.sent[0].impact===0.9);
});

// ---- browser evidence (needs Chromium) -----------------------------------------------------
const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const src='flowchart LR\n  A[Start] --> B[Finish]\n';
const base=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><defs><style>rect:not([fill]){fill:#fff}</style><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs><g data-node="A"><rect x="10" y="50" width="100" height="60"/><text x="30" y="85">Start</text></g><g data-node="B"><rect x="400" y="50" width="100" height="60"/><text x="430" y="85">Finish</text></g><path data-source="A" data-target="B" d="M110 80 L400 80" stroke="black" fill="none" marker-end="url(#arrow)"/></svg>`;

test('audit evidence: a route through node text is reported as a text intrusion, a route through only the fill is not',{skip:!enabled},async()=>{
  const labelled='flowchart LR\n  A[Start] --> B[Finish]\n  C[Mid]\n';
  const withC=base.replace('</svg>','<g data-node="C"><rect x="200" y="60" width="100" height="60"/><text x="230" y="95">Mid</text></g></svg>');
  const throughText=await auditAgentSvg(labelled,withC.replace('d="M110 80 L400 80"','d="M110 90 L400 90"'));
  const ev=throughText.checks.routeNodeIntrusion.evidence;
  assert.ok(ev.intrusions.length>0);assert.deepEqual(ev.textIntrusions,[{edge:'A->B',nodeIds:['C']}]);
  const fillOnly=await auditAgentSvg(labelled,withC.replace('d="M110 80 L400 80"','d="M110 65 L400 65"'));
  assert.ok(fillOnly.checks.routeNodeIntrusion.evidence.intrusions.length>0);
  assert.deepEqual(fillOnly.checks.routeNodeIntrusion.evidence.textIntrusions,[]);
});

test('audit evidence: a label covering node text sets coversNodeText; a label touching only the border does not',{skip:!enabled},async()=>{
  const lsrc='flowchart LR\n  A[Start] -->|Go| B[Finish]\n';
  const lab=(x,y)=>`<g data-edge-label-source="A" data-edge-label-target="B"><rect x="${x-3}" y="${y-16}" width="40" height="22" fill="white"/><text x="${x}" y="${y}">Go</text></g>`;
  const sketch=base.replace('<rect x="400" y="50" width="100" height="60"/>','<rect x="400" y="50" width="100" height="60" stroke="black"/>');
  const onText=await auditAgentSvg(lsrc,sketch.replace('</svg>',`${lab(440,85)}</svg>`));
  assert.equal(onText.checks.labelClearance.status,'FAIL');
  assert.equal(onText.checks.labelClearance.evidence.violations[0].coversNodeText,true);
  const onBorder=await auditAgentSvg(lsrc,sketch.replace('</svg>',`${lab(375,70)}</svg>`));
  assert.equal(onBorder.checks.labelClearance.status,'FAIL');
  assert.equal(onBorder.checks.labelClearance.evidence.violations[0].coversNodeText,false);
});

test('audit evidence: a route inside a heading box (not only its 2-unit guard) is a heading overlap',{skip:!enabled},async()=>{
  const gsrc='flowchart LR\n subgraph G[Group]\n  A[Start]\n end\n A --> B[Finish]\n';
  const grouped=base.replace('<g data-node="A">','<g data-group="G"><rect x="0" y="20" width="200" height="130" stroke="black" fill="none"/><text x="140" y="80">Group</text></g><g data-node="A">');
  const r=await auditAgentSvg(gsrc,grouped);
  const ev=r.checks.routeHeadingClearance.evidence;
  assert.equal(r.checks.routeHeadingClearance.status,'PASS');
  assert.equal(ev.allowed,true);
  assert.deepEqual(ev.headingOverlaps,[{edge:'A->B',groupIds:['G']}]);
});

// Node-to-group relations (Mermaid `A --> SomeGroup`) at the gate: a group arrow redrawn to a member node (measured on a real run: 21 node edges +
// 4 group edges drawn as 25 node edges, gate passed) must block in the relaxed gate; the correct drawing must not.
test('gate: a node-to-group relation drawn to a member node instead blocks the relaxed gate through relations; the correct drawing does not',{skip:!enabled},async()=>{
  const {renderSpec}=await import('../src/spec-render.mjs');
  const source='flowchart LR\n  A[Start] --> G\n  subgraph G["Workers"]\n    B[Job]\n  end\n  A --> D[Other]\n';
  const spec=toB=>({canvas:{w:600,h:300},palette:{p:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Step'}},
    groups:[{id:'G',label:'Workers',rect:[240,60,280,200]}],
    nodes:[{id:'A',rect:[20,120,120,64],text:'Start',role:'p'},{id:'B',group:'G',rect:[320,140,120,64],text:'Job',role:'p'},{id:'D',rect:[20,220,120,64],text:'Other',role:'p'}],
    edges:[{source:'A',target:'D',points:[[80,184],[80,220]]},toB?{source:'A',target:'B',points:[[140,152],[320,152]]}:{source:'A',target:'G',points:[[140,152],[240,152]]}]});
  const wrong=await auditAgentSvg(source,Buffer.from(renderSpec(spec(true)).svg));
  assert.equal(wrong.checks.relations.status,'FAIL');
  const reasons=auditGateReasons({audit:wrong,relaxed:true});
  const fail=reasons.find(r=>r.code==='AUDIT_FAIL');
  assert.ok(fail&&fail.detail.split(', ').includes('relations'),JSON.stringify(reasons));
  assert.ok(BLOCKING_AUDIT_RULES.includes('relations'));
  assert.deepEqual(auditToFindings(wrong,R).filter(f=>f.rule==='relations').map(f=>f.severity),['blocking']);
  const right=await auditAgentSvg(source,Buffer.from(renderSpec(spec(false)).svg));
  assert.equal(right.checks.relations.status,'PASS',JSON.stringify(right.checks.relations.evidence));
  const ok=auditGateReasons({audit:right,relaxed:true}).find(r=>r.code==='AUDIT_FAIL');
  assert.ok(!ok||!ok.detail.split(', ').includes('relations'),JSON.stringify(ok));
  assert.deepEqual(auditToFindings(right,R).filter(f=>f.rule==='relations'),[]);
});

// User rule (2026-10-05) "标签覆盖箭头的时候应该判定失败": a label over its own route's arrowhead blocks the relaxed gate through labelCoversRoute
// (measured on a real run: labelCoversRoute PASS, labelClearance FAIL but advisory, so the gate passed). Mid-segment on its own route still passes (R2).
test('gate: a label on its own arrowhead blocks the relaxed gate through labelCoversRoute; mid-segment on its own route does not',{skip:!enabled},async()=>{
  const {H_SRC,hBase,doc,label}=await import('./helpers/label-fixtures.mjs');
  const onHead=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:425,cy:330})));
  const fail=auditGateReasons({audit:onHead,relaxed:true}).find(r=>r.code==='AUDIT_FAIL');
  assert.ok(fail&&fail.detail.split(', ').includes('labelCoversRoute'),JSON.stringify(onHead.checks.labelCoversRoute));
  assert.deepEqual(auditToFindings(onHead,R).filter(f=>f.rule==='labelCoversRoute').map(f=>f.severity),['blocking']);
  const mid=await auditAgentSvg(H_SRC,doc(...hBase(),label({s:'A',t:'B',cx:305,cy:330})));
  assert.equal(mid.checks.labelCoversRoute.status,'PASS',JSON.stringify(mid.checks.labelCoversRoute.evidence));
  // the synthetic fixture's node text is a placeholder, so semantics stay unestablished; what matters is that no audit FAIL blocks
  assert.equal(auditGateReasons({audit:mid,relaxed:true}).find(r=>r.code==='AUDIT_FAIL'),undefined,JSON.stringify(auditGateReasons({audit:mid,relaxed:true})));
});
