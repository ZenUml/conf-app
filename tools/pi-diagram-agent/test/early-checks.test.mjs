import test from 'node:test';
import assert from 'node:assert/strict';
import {scanForbidden,earlyFindings,regionSignature,applyCoverage,REVIEW_RULES} from '../src/early-checks.mjs';
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
  for(const r of ['reading-order','label-ownership','detour','legend','text-overflow','balance','route-node-intrusion','route-crossing','heading-overlap','label-clearance'])assert.ok(REVIEW_RULES.includes(r),r);
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
