import test from 'node:test';
import assert from 'node:assert/strict';
import {scanForbidden,earlyFindings,regionSignature,applyCoverage,applyStability,REVIEW_RULES,EARLY_MEASURED_RULES} from '../src/early-checks.mjs';
import {makeFinding} from '../src/findings.mjs';

const svg=(body)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">${body}</svg>`;

test('scanForbidden flags context-stroke, context-fill, script, foreignObject, event handlers, iframe/image/href',()=>{
  const cases={
    'context-stroke':svg('<defs><marker id="a"><path d="M0 0" fill="context-stroke"/></marker></defs>'),
    'context-fill':svg('<path fill="context-fill" d="M0 0"/>'),
    script:svg('<script>1</script>'),
    foreignObject:svg('<foreignObject><div/></foreignObject>'),
    'event-handler':svg('<rect onclick="x()" width="1" height="1"/>'),
    iframe:svg('<iframe/>'),
    image:svg('<image href="x.png"/>'),
    href:svg('<a href="http://x"><rect/></a>'),
  };
  for(const [name,text] of Object.entries(cases)){
    const hits=scanForbidden(text);
    assert.ok(hits.some(h=>h.construct===name),`${name}: ${JSON.stringify(hits)}`);
  }
  assert.deepEqual(scanForbidden(svg('<rect width="1" height="1"/><text>script onclick context-stroke words</text>')).map(h=>h.construct).sort(),['context-stroke']); // text content: only the literal paint keyword is flagged
});

test('scanForbidden clean svg returns nothing; counts occurrences',()=>{
  assert.deepEqual(scanForbidden(svg('<rect width="1" height="1"/>')),[]);
  const hits=scanForbidden(svg('<path stroke="context-stroke"/><path fill="context-stroke"/>'));
  assert.equal(hits.length,1);assert.equal(hits[0].count,2);
});

test('earlyFindings: forbidden constructs and missing bindings become blocking early findings',()=>{
  const audit={checks:{
    nodeIdentity:{status:'FAIL',evidence:{missing:['C'],extra:[]}},
    relations:{status:'FAIL',evidence:{expected:2,drawn:1,malformedEdges:[]}},
    groups:{status:'PASS',evidence:{}},
    routeCrossings:{status:'FAIL',evidence:{violations:[]}},
  }};
  const out=earlyFindings({svgText:svg('<path stroke="context-stroke"/>'),audit});
  assert.deepEqual(out.map(x=>x.rule).sort(),['forbidden-construct','nodeIdentity','relations']);
  assert.ok(out.every(x=>x.source==='early'&&x.severity==='blocking'));
  const fc=out.find(x=>x.rule==='forbidden-construct');
  assert.deepEqual(fc.elements,['context-stroke']);
  assert.match(fc.suggestion,/solid|explicit|hex|colour|color/i);
});

test('regionSignature changes when elements in the finding region or bound to its element ids change, not otherwise',()=>{
  const a=svg('<g data-node="A"><rect x="10" y="10" width="50" height="30"/></g><g data-node="B"><rect x="400" y="100" width="50" height="30"/></g><path data-source="A" data-target="B" d="M60 25 L400 25 L400 100"/>');
  const bMoved=svg('<g data-node="A"><rect x="10" y="10" width="50" height="30"/></g><g data-node="B"><rect x="400" y="120" width="50" height="30"/></g><path data-source="A" data-target="B" d="M60 25 L400 25 L400 100"/>');
  const fa={elements:['A'],region:{x:0,y:0,w:100,h:60}};
  assert.equal(regionSignature(a,fa),regionSignature(bMoved,fa)); // B moved, region around A untouched
  const fb={elements:['B'],region:null};
  assert.notEqual(regionSignature(a,fb),regionSignature(bMoved,fb));
  const edge={elements:['A->B'],region:null};
  assert.equal(regionSignature(a,edge),regionSignature(bMoved,edge));
  const edgeMoved=a.replace('L400 100','L400 110');
  assert.notEqual(regionSignature(a,edge),regionSignature(edgeMoved,edge));
  const reg={elements:[],region:{x:380,y:90,w:100,h:60}};
  assert.notEqual(regionSignature(a,reg),regionSignature(bMoved,reg));
});

test('REVIEW_RULES is the fixed reviewer vocabulary from the checklist',()=>{
  for(const r of ['reading-order','label-ownership','detour','legend','shape-change','text-overflow','balance','route-node-intrusion','route-crossing','heading-overlap','label-clearance'])assert.ok(REVIEW_RULES.includes(r),r);
});

const rf=(rule,elements)=>makeFinding({source:'review',severity:'blocking',rule,elements,region:null,evidence:{measured:'m',threshold:'t'},suggestion:'s'});
const model={nodes:[{id:'A'},{id:'B'},{id:'C'}],edges:[{source:'A',target:'B'},{source:'B',target:'C'}],groups:[]};
const edgesSvg=(d1)=>svg(`<path data-source="A" data-target="B" d="${d1}"/><path data-source="B" data-target="C" d="M0 0 L10 0"/>`);
const auditPass=(name,extra={})=>({checks:{[name]:{status:'PASS',evidence:{method:'straight spans',checkedEdges:2,violations:[],...extra}}}});

test('applyCoverage: reviewer blocking is downgraded only when the auditor measured those exact elements with a covering method',()=>{
  const findings=[rf('route-crossing',['A->B','B->C'])];
  const covered=applyCoverage(findings,{audit:auditPass('routeCrossings'),svgText:edgesSvg('M0 0 L100 0'),model});
  assert.equal(covered[0].severity,'minor');assert.equal(covered[0].downgraded.by,'routeCrossings');
});

test('applyCoverage: curved edges are not covered by straight-span checks, so the finding stands (Case B)',()=>{
  const findings=[rf('route-crossing',['A->B'])];
  const out=applyCoverage(findings,{audit:auditPass('routeCrossings'),svgText:edgesSvg('M0 0 Q50 50 100 0'),model});
  assert.equal(out[0].severity,'blocking');assert.equal(out[0].downgraded,undefined);
});

test('applyCoverage: audit not PASS, elements unknown, unmapped rule, or partial checked count all leave the finding standing',()=>{
  const base={svgText:edgesSvg('M0 0 L100 0'),model};
  assert.equal(applyCoverage([rf('route-crossing',['A->B'])],{...base,audit:{checks:{routeCrossings:{status:'NOT-CHECKABLE',evidence:'x'}}}})[0].severity,'blocking');
  assert.equal(applyCoverage([rf('route-crossing',['A->Z'])],{...base,audit:auditPass('routeCrossings')})[0].severity,'blocking');
  assert.equal(applyCoverage([rf('reading-order',['A'])],{...base,audit:auditPass('routeCrossings')})[0].severity,'blocking'); // default = not covered
  assert.equal(applyCoverage([rf('label-ownership',['A->B'])],{...base,audit:auditPass('labelClearance')})[0].severity,'blocking');
  assert.equal(applyCoverage([rf('route-crossing',['A->B'])],{...base,audit:auditPass('routeCrossings',{checkedEdges:1})})[0].severity,'blocking');
});

test('applyCoverage: node-level text-overflow is covered by textFit PASS on the named nodes (all curve-independent)',()=>{
  const out=applyCoverage([rf('text-overflow',['B'])],{audit:auditPass('textFit',{checkedNodes:3}),svgText:svg(''),model});
  assert.equal(out[0].severity,'minor');assert.equal(out[0].downgraded.by,'textFit');
});

test('applyCoverage: route-node-intrusion is covered even for curves (sampled actual path), minor findings pass through untouched',()=>{
  const out=applyCoverage([rf('route-node-intrusion',['A->B']),{...rf('legend',['legend']),severity:'minor'}],{audit:auditPass('routeNodeIntrusion',{endpointErrors:[],intrusions:[]}),svgText:edgesSvg('M0 0 Q50 50 100 0'),model});
  assert.equal(out[0].severity,'minor');assert.equal(out[1].severity,'minor');assert.equal(out[1].downgraded,undefined);
});

test('earlyFindings: a candidate with NO bindings (auditor says NOT-CHECKABLE: no neutral binding) is a blocking early finding; a source-parser limitation is not',()=>{
  const audit={checks:{
    nodeIdentity:{status:'NOT-CHECKABLE',evidence:'no neutral per-node semantic binding; SVG may still be visually valid'},
    relations:{status:'NOT-CHECKABLE',evidence:'no neutral per-relation semantic binding; SVG may still be visually valid'},
    groups:{status:'NOT-CHECKABLE',evidence:'group geometry has no neutral binding'},
  }};
  const out=earlyFindings({svgText:svg(''),audit});
  assert.deepEqual(out.map(x=>x.rule).sort(),['groups','nodeIdentity','relations']);
  for(const x of out){assert.equal(x.severity,'blocking');assert.equal(x.source,'early');assert.match(x.evidence.measured,/no .*binding/i);assert.match(x.suggestion,/data-node|data-source|group/i)}
  const parser={checks:{nodeIdentity:{status:'NOT-CHECKABLE',evidence:'source parser cannot establish independent semantic bindings: UNSUPPORTED'}}};
  assert.deepEqual(earlyFindings({svgText:svg(''),audit:parser}),[]);
});

test('regionSignature falls back to the whole SVG when a finding matches no element or region (any change counts as a change)',()=>{
  const a=svg('<g data-node="A"><rect x="1" y="1" width="5" height="5"/></g>'),b=svg('<g data-node="A"><rect x="1" y="1" width="6" height="5"/></g>');
  const legend={elements:['legend'],region:null};
  assert.equal(regionSignature(a,legend),regionSignature(a,legend));
  assert.notEqual(regionSignature(a,legend),regionSignature(b,legend));
});

const prevOf=(svgText,keys)=>({svgText,keys:new Set(keys)});
const blockingReview=(rule,elements)=>makeFinding({source:'review',severity:'blocking',rule,elements,region:null,evidence:{measured:'m',threshold:'t'},suggestion:'s'});
test('applyStability: a reviewer blocking finding new on unchanged geometry is logged unstable but stays blocking (fail closed)',()=>{
  const a=svg('<g data-node="A"><rect x="1" y="1" width="5" height="5"/></g><g data-node="B"><rect x="50" y="1" width="5" height="5"/></g>');
  const f=blockingReview('balance',['A']);
  const out=applyStability([f],{previous:prevOf(a,[]),svgText:a});
  assert.equal(out[0].severity,'blocking');assert.match(out[0].unstable.reason,/two consecutive reviews/);
  // B changed, A did not: a finding about A is flagged unstable; a finding about B is not flagged
  const a2=a.replace('x="50"','x="60"');
  assert.ok(applyStability([blockingReview('balance',['A'])],{previous:prevOf(a,[]),svgText:a2})[0].unstable);
  assert.equal(applyStability([blockingReview('balance',['B'])],{previous:prevOf(a,[]),svgText:a2})[0].unstable,undefined);
  for(const x of [applyStability([blockingReview('balance',['A'])],{previous:prevOf(a,[]),svgText:a2})[0]])assert.equal(x.severity,'blocking');
});
test('applyStability leaves standing: persistent findings, first reviews, audit/early findings, minors',()=>{
  const a=svg('<g data-node="A"><rect x="1" y="1" width="5" height="5"/></g>');
  const f=blockingReview('balance',['A']);
  assert.equal(applyStability([f],{previous:prevOf(a,[f.key]),svgText:a})[0].severity,'blocking'); // reported twice: persistent
  assert.equal(applyStability([f],{previous:null,svgText:a})[0].severity,'blocking'); // no earlier review to compare
  const audit=makeFinding({source:'audit',severity:'blocking',rule:'textFit',elements:['A'],evidence:{},suggestion:''});
  assert.equal(applyStability([audit],{previous:prevOf(a,[]),svgText:a})[0].severity,'blocking');
  const minor=makeFinding({source:'review',severity:'minor',rule:'balance',elements:['A'],evidence:{},suggestion:''});
  assert.equal(applyStability([minor],{previous:prevOf(a,[]),svgText:a})[0].unstable,undefined);
});

// ---- layout checks (connectorStrokeWidth ... legendCompleteness) in the v2 loop
const LAYOUT=['connectorStrokeWidth','filletUniformity','markerUniformity','textContrast','labelFontWeight','legendCompleteness'];
test('earlyFindings: a measured layout FAIL is a blocking early finding; NOT-CHECKABLE and PASS are not',()=>{
  const audit={checks:{
    textContrast:{status:'FAIL',evidence:{method:'m',failures:[{elementId:'B',foreground:'#aaaaaa',background:'#ffffff',ratio:2.32}]}},
    filletUniformity:{status:'NOT-CHECKABLE',evidence:{reason:'non-orthogonal'}},
    labelFontWeight:{status:'PASS',evidence:{method:'m'}},
  }};
  const out=earlyFindings({svgText:svg(''),audit});
  assert.deepEqual(out.map(x=>[x.rule,x.source,x.severity]),[['textContrast','early','blocking']]);
  assert.deepEqual(out[0].elements,['B']);
  assert.ok(EARLY_MEASURED_RULES.every(r=>LAYOUT.includes(r))&&LAYOUT.every(r=>EARLY_MEASURED_RULES.includes(r)));
});
test('applyCoverage: a reviewer legend finding is downgraded only when legendCompleteness PASSed; other layout rules are not covered by it',()=>{
  const legend=makeFinding({source:'review',severity:'blocking',rule:'legend',elements:['legend'],evidence:{measured:'m',threshold:'t'},suggestion:'s'});
  const pass={checks:{legendCompleteness:{status:'PASS',evidence:{method:'fill roles, shapes, dashes versus legend keys'}}}};
  const down=applyCoverage([legend],{audit:pass,svgText:svg(''),model});
  assert.equal(down[0].severity,'minor');assert.equal(down[0].downgraded.by,'legendCompleteness');
  const nc=applyCoverage([legend],{audit:{checks:{legendCompleteness:{status:'NOT-CHECKABLE',evidence:{reason:'x'}}}},svgText:svg(''),model});
  assert.equal(nc[0].severity,'blocking');
  const balance=makeFinding({source:'review',severity:'blocking',rule:'balance',elements:['canvas'],evidence:{measured:'m',threshold:'t'},suggestion:'s'});
  assert.equal(applyCoverage([balance],{audit:pass,svgText:svg(''),model})[0].severity,'blocking');
});
