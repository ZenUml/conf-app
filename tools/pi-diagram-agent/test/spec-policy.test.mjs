import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSpec, validateSpec, TIERS, SIZE_TIERS} from '../src/spec-render.mjs';
import {BOX_RULES_PROFILE} from '../src/rules-profile.mjs';
import {specModeParagraph} from '../src/spec-tool.mjs';
import {RELAXED_PARAGRAPH} from '../src/agent-led.mjs';

const palette={p:{fill:'#ffffff',stroke:'#123456',text:'#123456',meaning:'Process'}};
const node=(id,rect,extra={})=>({id,rect,text:id,role:'p',...extra});
const spec=(extra={})=>({canvas:{w:800,h:600},palette,nodes:[node('A',[40,100,112,56]),node('B',[500,100,112,56])],edges:[],...extra});
const findings=(s,rule)=>renderSpec(s).findings.filter(f=>f.rule===rule);

test('size vocabulary comes from one code-owned profile, and neutral tags never alter an explicit rectangle',()=>{
  assert.deepEqual(Object.values(TIERS),BOX_RULES_PROFILE.sizingContract.tiers);
  assert.deepEqual(Object.values(SIZE_TIERS),BOX_RULES_PROFILE.sizingContract.tiers);
  const s=spec();s.nodes[0]={...s.nodes[0],sizeFamily:'service',sizeTier:'compact',layer:'application'};
  const r=renderSpec(s);
  assert.match(r.svg,/data-node="A"[^>]*data-size-family="service"[^>]*data-size-tier="compact"[^>]*data-layer="application"/);
  assert.match(r.svg,/<rect x="40" y="100" width="112" height="56"/);
  assert.equal(findings(s,'node-size-tier').length,0);
  s.nodes[0].rect[2]=113;
  assert.equal(findings(s,'node-size-tier').length,1,'off-grid declaration is a finding, never a repair');
  assert.match(renderSpec(s).svg,/<rect x="40" y="100" width="113" height="56"/);
  s.nodes[0].rect[2]=116;s.nodes[0].sizeExtension={width:1,height:0};
  assert.equal(findings(s,'node-size-tier').length,0,'profile-grid enlargement is allowed');
});

test('a named size tier can define centre-based geometry without a competing size standard',()=>{
  const s=spec();s.nodes[0]={id:'A',centre:[200,200],sizeTier:'standard',text:'A',role:'p'};
  const r=renderSpec(s);
  assert.match(r.svg,/data-node="A"[^>]*data-label-box="100 160 200 80"/);
  assert.match(r.svg,/<rect x="92" y="152" width="216" height="96"/);
});

test('border riding fails even for an endpoint ancestor; transverse crossings pass',()=>{
  const s=spec({groups:[{id:'G',label:'Group',rect:[10,20,300,300]}]});s.nodes[0].group='G';
  s.edges=[{source:'A',target:'B',points:[[152,128],[250,128],[250,20],[450,20],[450,128],[500,128]]}];
  const ride=findings(s,'group-border-riding');assert.equal(ride.length,1);assert.equal(ride[0].severity,'blocking');
  s.edges[0].points=[[152,128],[500,128]];
  assert.equal(findings(s,'group-border-riding').length,0);
});

test('positive border riding has no former long-run threshold',()=>{
  const s=spec({groups:[{id:'G',label:'Group',rect:[250,20,100,300]}]});
  s.edges=[{source:'A',target:'B',points:[[152,128],[240,128],[240,20],[266,20],[266,128],[500,128]]}];
  const ride=findings(s,'group-border-riding');assert.equal(ride.length,1);assert.match(ride[0].measured,/11 units/);
});

test('routing over a group heading is allowed while a node covering heading text still fails',()=>{
  const s=spec({groups:[{id:'G',label:'Heading',rect:[10,20,650,300]}]});
  for(const n of s.nodes)n.group='G';
  s.edges=[{source:'A',target:'B',points:[[96,100],[96,44],[556,44],[556,100]]}];
  assert.equal(findings(s,'heading-intrusion').length,0);
  s.nodes[0].rect=[40,30,112,56];
  assert.equal(findings(s,'heading-intrusion').filter(f=>f.elements.includes('A')).length,1);
});

test('sibling overlap fails; explicit nested groups preserve ancestor membership',()=>{
  const s=spec({groups:[{id:'G',label:'Outer',rect:[10,20,650,400]},{id:'H',label:'Inner',rect:[20,80,250,250]}]});
  s.nodes[0].group='H';s.nodes[1].group='G';
  assert.equal(findings(s,'group-overlap').length,1);
  s.groups[1].parent='G';
  assert.equal(findings(s,'group-overlap').length,0);
  assert.equal(findings(s,'group-membership').length,0);
  assert.match(renderSpec(s).svg,/data-group="H"[^>]*data-parent-group="G"/);
  s.groups[1].rect[2]=700;
  assert.ok(findings(s,'group-membership').some(f=>f.elements.includes('H')));
});

test('invalid nesting and invalid metadata are schema errors with exact paths',()=>{
  const s=spec({groups:[{id:'G',label:'G',rect:[10,20,200,200],parent:'H'},{id:'H',label:'H',rect:[20,30,100,100],parent:'G'}]});
  assert.ok(validateSpec(s).some(e=>e.path==='groups[0].parent'&&/cycle/.test(e.message)));
  s.nodes[0].sizeTier='invented';s.nodes[0].layer=3;s.presentation={mode:'mobile',scale:0};
  const paths=validateSpec(s).map(e=>e.path);
  for(const p of ['nodes[0].sizeTier','nodes[0].layer','presentation.mode','presentation.scale'])assert.ok(paths.includes(p));
});

test('presentation font measurement accepts native, fit dimensions and explicit scale',()=>{
  const s=spec({canvas:{w:2400,h:1420}});for(const n of s.nodes)n.font=18;
  assert.equal(findings(s,'label-font-legibility').length,2,'default fit makes 18-unit labels 9 px');
  s.presentation={mode:'native'};assert.equal(findings(s,'label-font-legibility').length,0);
  s.presentation={mode:'fit',width:2400,height:1420};assert.equal(findings(s,'label-font-legibility').length,0);
  s.presentation.scale=0.5;assert.equal(findings(s,'label-font-legibility').length,0,'fit derives scale from dimensions; scale is native-only');
  s.presentation={mode:'native',scale:0.5};assert.equal(findings(s,'label-font-legibility').length,2);
});

test('crossings count visible locations rather than duplicate logical routes',()=>{
  const s=spec({nodes:[node('A',[20,180,112,56]),node('B',[600,180,112,56]),node('C',[250,20,112,56]),node('D',[250,450,112,56])]});
  s.edges=[{id:'h1',source:'A',target:'B',points:[[132,208],[600,208]]},{id:'h2',source:'A',target:'B',points:[[132,208],[600,208]]},{id:'v',source:'C',target:'D',points:[[306,76],[306,450]]}];
  const cross=findings(s,'crossing');assert.equal(cross.length,1);assert.deepEqual(new Set(cross[0].elements),new Set(['h1','h2','v']));
});

test('spec accepts a continuous multi-bend declared suffix but rejects earlier unshared overlap',()=>{
  const s=spec({nodes:[node('A',[20,50,112,56]),node('B',[20,200,112,56]),node('T',[600,300,112,56])]});
  s.edges=[{id:'a',source:'A',target:'T',trunk:'t',points:[[132,78],[250,78],[250,250],[450,250],[450,328],[600,328]]},{id:'b',source:'B',target:'T',trunk:'t',points:[[132,228],[250,228],[250,250],[450,250],[450,328],[600,328]]}];
  assert.equal(findings(s,'parallel-clearance').length,0);
  assert.match(renderSpec(s).svg,/data-shared-trunk="t"/);
  delete s.edges[1].trunk;assert.ok(findings(s,'parallel-clearance').length);
});

test('author/schema/relaxed wording shares the reviewed policies without a final-leg-only limitation',()=>{
  const p=specModeParagraph({runDir:'/tmp/run',jobId:'job'});
  for(const word of ['sizeFamily','sizeTier','layer','presentation','continuous downstream suffix','whole family','Group headings','Sibling','border'])assert.ok(p.toLowerCase().includes(word.toLowerCase()),word);
  assert.doesNotMatch(p,/only the coincident final leg/);
  assert.match(RELAXED_PARAGRAPH,/route riding along any group border/);
  assert.match(RELAXED_PARAGRAPH,/overlapping sibling groups/);
  assert.doesNotMatch(RELAXED_PARAGRAPH,/node or route overlapping group heading/);
});
