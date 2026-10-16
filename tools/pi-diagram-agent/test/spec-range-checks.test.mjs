import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSpec,validateSpec,SpecError} from '../src/spec-render.mjs';
import {parseMermaid} from '../src/parser.mjs';
import {baseSpec,rulesOf} from './helpers/label-fixtures.mjs';

// "Declare ranges, reject out-of-range": every value of layout.json has a declared range, and a value outside it is a blocking finding that names the element and the range.
// Synthetic fixtures only.
const RANGE_SOURCE='flowchart LR\n  subgraph G1[Intake]\n    A[Start] --> B[Mid]\n  end\n  subgraph G2[Review]\n    C[Check]\n  end\n  B --> C\n';
const rangeSpec=()=>({
  canvas:{w:900,h:400,title:'Synthetic groups',desc:'Two groups.'},
  palette:{p:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Step'}},
  groups:[{id:'G1',label:'Intake',rect:[10,10,400,300]},{id:'G2',label:'Review',rect:[500,10,380,300]}],
  nodes:[{id:'A',group:'G1',shape:'rect',rect:[30,120,120,64],text:'Start',role:'p'},{id:'B',group:'G1',shape:'rect',rect:[240,120,120,64],text:'Mid',role:'p'},{id:'C',group:'G2',shape:'rect',rect:[620,120,120,64],text:'Check',role:'p'}],
  edges:[{source:'A',target:'B',points:[[150,152],[240,152]]},{source:'B',target:'C',points:[[360,152],[620,152]]}]});

// ---- (f) independent sibling groups never overlap ----
test('group-overlap: two sibling containers that overlap are a blocking finding naming both groups and the overlap size',()=>{
  const s=rangeSpec();s.groups=[{id:'G1',label:'Intake',rect:[20,20,300,200]},{id:'G2',label:'Review',rect:[240,50,300,220]}];s.nodes=s.nodes.map(n=>({...n,group:undefined}));
  const f=rulesOf(renderSpec(s),'group-overlap');
  assert.equal(f.length,1);assert.equal(f[0].severity,'blocking');assert.deepEqual([...f[0].elements].sort(),['G1','G2']);
  assert.match(f[0].measured,/G1 and G2 overlap 80x170 at \(240, 50\)/);assert.match(f[0].threshold,/disjoint/);
});
test('group-overlap: disjoint, touching and properly nested groups are accepted',()=>{
  const s=rangeSpec();s.groups.push({id:'G3',label:'Inner',rect:[20,40,150,250]},{id:'G4',label:'Edge',rect:[880,10,10,300]});s.groups[1].rect=[410,10,470,300]; // G2 touches G1 at x=410; G3 sits inside G1; G4 touches G2 at x=880
  s.nodes=s.nodes.map(n=>({...n,group:undefined}));
  assert.deepEqual(rulesOf(renderSpec(s),'group-overlap'),[]);
});
test('group-overlap: a nested group that sticks out of its parent is an overlap, not nesting',()=>{
  const s=rangeSpec();s.groups.push({id:'G3',label:'Inner',rect:[300,40,200,100]}); // crosses the right border of G1 (x=410) and ends before G2 (x=500)
  const f=rulesOf(renderSpec(s),'group-overlap');
  assert.deepEqual(f.map(x=>[...x.elements].sort().join('+')),['G1+G3']);
});

// ---- (b) every node, group, label and route point lies inside the canvas; blocking, names the value and the range ----
test('out-of-canvas: blocking, names the element, the value and the canvas range',()=>{
  let s=rangeSpec();s.nodes[2].rect=[620,350,120,64];s.nodes[2].group=undefined;
  let f=rulesOf(renderSpec(s),'out-of-canvas').find(x=>x.elements.includes('C'));
  assert.ok(f);assert.equal(f.severity,'blocking');assert.match(f.measured,/node C: y\+h=414 outside canvas 0\.\.400/);
  s=rangeSpec();s.groups[0].rect=[-12,10,400,300];
  f=rulesOf(renderSpec(s),'out-of-canvas').find(x=>x.elements.includes('G1'));
  assert.ok(f);assert.equal(f.severity,'blocking');assert.match(f.measured,/group G1: x=-12 outside canvas 0\.\.900/);
  s=rangeSpec();s.edges[1].points=[[360,152],[620,152]];s.edges[1].label={text:'go',x:800,y:410};
  f=rulesOf(renderSpec(s),'out-of-canvas').find(x=>x.measured.includes('label of'));
  assert.ok(f);assert.equal(f.severity,'blocking');assert.match(f.measured,/y\+h=422 outside canvas 0\.\.400/);
  s=rangeSpec();s.edges[0].points=[[150,152],[150,-20],[240,-20],[240,152]];
  f=rulesOf(renderSpec(s),'out-of-canvas').find(x=>x.measured.includes('route'));
  assert.ok(f);assert.equal(f.severity,'blocking');assert.match(f.measured,/y=-20 outside canvas 0\.\.400/);
});
test('out-of-canvas: the legend origin and explicit legend entries are inside the canvas too',()=>{
  const s=rangeSpec();s.legend={x:850,y:420,entries:[{kind:'node',role:'p',label:'Step'}]};
  const f=rulesOf(renderSpec(s),'out-of-canvas').find(x=>x.elements.includes('legend'));
  assert.ok(f);assert.equal(f.severity,'blocking');assert.match(f.measured,/legend: y=420 outside canvas 0\.\.400/);
  const ok=rangeSpec();ok.legend={x:20,y:340,entries:[{kind:'node',role:'p',label:'Step'}]};
  assert.deepEqual(rulesOf(renderSpec(ok),'out-of-canvas'),[]);
});
test('out-of-canvas: a layout entirely inside the canvas has no finding',()=>{
  assert.deepEqual(rulesOf(renderSpec(rangeSpec()),'out-of-canvas'),[]);
  assert.deepEqual(rulesOf(renderSpec(baseSpec()),'out-of-canvas'),[]);
});

// ---- (d) conservation: nodes, relations (exist) and group membership equal the source facts ----
test('census: group conservation against the source (missing, invented, wrong membership)',()=>{
  const model=parseMermaid(RANGE_SOURCE);
  assert.deepEqual(renderSpec(rangeSpec(),{model}).findings.filter(f=>f.rule==='census'),[]);
  const text=r=>rulesOf(r,'census').map(f=>`${f.severity} ${f.measured}`).join('\n');
  let s=rangeSpec();s.groups.pop();s.nodes[2].group=undefined;
  assert.match(text(renderSpec(s,{model})),/blocking missing group G2/);
  s=rangeSpec();s.groups.push({id:'G9',label:'Invented',rect:[420,320,100,60]});
  assert.match(text(renderSpec(s,{model})),/blocking extra group G9/);
  s=rangeSpec();s.nodes[1].group='G2';
  assert.match(text(renderSpec(s,{model})),/blocking node B is declared in group G2, source says G1/);
  s=rangeSpec();s.nodes[0].group=undefined;
  assert.match(text(renderSpec(s,{model})),/blocking node A is declared in no group, source says G1/);
});

// ---- (a) every number is finite (guards; this check existed before: the schema rejects NaN, Infinity and strings) ----
test('schema: non-finite and non-numeric numbers are rejected by path',()=>{
  const bad=JSON.stringify(rangeSpec()).replace('"w":900','"w":1e999').replace('[30,120,120,64]','[30,"120",120,64]');
  assert.throws(()=>renderSpec(bad),e=>e instanceof SpecError&&e.errors.some(x=>x.path==='canvas.w')&&e.errors.some(x=>x.path==='nodes[0].rect'));
  const s=rangeSpec();s.edges[0].points[1][0]=NaN;
  assert.ok(validateSpec(s).some(x=>x.path==='edges[0].points[1]'));
  const t=rangeSpec();t.nodes[0].rect=[30,120,0,64];
  assert.ok(validateSpec(t).some(x=>x.path==='nodes[0].rect'),'zero width rejected');
});
