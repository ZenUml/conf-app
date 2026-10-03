import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';

// Synthetic fixtures only. Connectors that converge on T share one final trunk (rule 10).
const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const src2='flowchart LR\n A[Start] --> T[Target]\n B[Other] --> T\n';
const src3='flowchart LR\n A[Start] --> T[Target]\n B[Other] --> T\n C[Third] --> T\n';
const node=(id,x,y,w,h,text)=>`<g data-node="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><text x="${x+30}" y="${y+35}">${text}</text></g>`;
const edge=(s,t,d,extra='')=>`<path data-source="${s}" data-target="${t}" d="${d}"${extra?' '+extra:''} stroke="black" fill="none" marker-end="url(#arrow)"/>`;
const wrap=body=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs>${body}</svg>`;
const nodes=node('A',10,20,100,60,'Start')+node('B',10,120,100,60,'Other')+node('T',400,70,100,60,'Target');
const dA='M110 50 L255 50 Q260 50 260 55 L260 95 Q260 100 265 100 L400 100';
const dB='M110 150 L255 150 Q260 150 260 145 L260 105 Q260 100 265 100 L400 100';
const dC='M110 250 L295 250 Q300 250 300 245 L300 105 Q300 100 305 100 L400 100';
const nodes3=nodes+node('C',10,220,100,60,'Third');
// Same-side fixtures (rule 10): both feeds drop in from above and meet one trunk into T at y=180; C enters straight.
const nodesS=node('A',10,10,100,40,'Start')+node('B',10,70,100,40,'Other')+node('T',400,150,100,60,'Target');
const nodesS3=nodesS+node('C',10,150,100,60,'Third');
const sA='M110 30 L255 30 Q260 30 260 35 L260 175 Q260 180 265 180 L400 180';
const sB='M110 90 L215 90 Q220 90 220 95 L220 175 Q220 180 225 180 L400 180';
const sC='M110 180 L400 180';
const label=(s,t,x,y,w=60,h=16)=>`<g data-edge-label-source="${s}" data-edge-label-target="${t}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/><text x="${x+4}" y="${y+12}">lbl</text></g>`;
const attr=(id,name='data-shared-trunk')=>`${name}="${id}"`;
const pair=async(srcText,svgText)=>(await auditAgentSvg(srcText,svgText)).checks;

test('a declared trunk shared by two connectors into one target passes and is reported',{skip:!enabled},async()=>{
  const c=await pair(src2,wrap(nodesS+edge('A','T',sA,attr('t1'))+edge('B','T',sB,attr('t1'))));
  assert.equal(c.routePairClearance.status,'PASS');
  assert.deepEqual(c.routePairClearance.evidence.trunks.map(t=>({id:t.id,target:t.target,edges:t.edges})),[{id:'t1',target:'T',edges:['A->T','B->T']}]);
  assert.equal(c.routeCrossings.status,'PASS');
});

test('the same merge without a declaration still fails',{skip:!enabled},async()=>{
  const c=await pair(src2,wrap(nodes+edge('A','T',dA)+edge('B','T',dB)));
  assert.equal(c.routePairClearance.status,'FAIL');
  assert.equal(c.routePairClearance.evidence.violations[0].separation,0);
  assert.deepEqual(c.routePairClearance.evidence.trunks,[]);
});

test('a three-way trunk with one id passes',{skip:!enabled},async()=>{
  const c=await pair(src3,wrap(nodesS3+edge('A','T',sA,attr('t1'))+edge('B','T',sB,attr('t1'))+edge('C','T',sC,attr('t1'))));
  assert.equal(c.routePairClearance.status,'PASS');
  assert.deepEqual(c.routePairClearance.evidence.trunks.map(t=>t.edges),[['A->T','B->T','C->T']]);
});

test('a three-way trunk where one member lacks the id fails',{skip:!enabled},async()=>{
  const c=await pair(src3,wrap(nodes3+edge('A','T',dA,attr('t1'))+edge('B','T',dB,attr('t1'))+edge('C','T',dC)));
  assert.equal(c.routePairClearance.status,'FAIL');
});

test('the same id on connectors with different targets fails',{skip:!enabled},async()=>{
  const two='flowchart LR\n A[Start] --> T[Target]\n B[Other] --> U[Mid]\n';
  const n=nodes+node('U',320,100,40,30,'Mid');
  const c=await pair(two,wrap(n+edge('A','T',dA,attr('t1'))+edge('B','U',dB.replace('L400 100','L360 100'),attr('t1'))));
  assert.equal(c.routePairClearance.status,'FAIL');
});

test('the same id with an overlap that is not the final portion ending at the target fails',{skip:!enabled},async()=>{
  const n=node('A',10,20,100,60,'Start')+node('B',10,70,100,60,'Other')+node('T',400,70,100,60,'Target');
  const bEarly='M110 100 L295 100 Q300 100 300 105 L300 115 Q300 120 305 120 L400 120';
  const c=await pair(src2,wrap(n+edge('A','T','M110 50 L255 50 Q260 50 260 55 L260 95 Q260 100 265 100 L400 100',attr('t1'))+edge('B','T',bEarly,attr('t1'))));
  assert.equal(c.routePairClearance.status,'FAIL');
});

test('earlier non-final spans of trunk members still need ten units of separation',{skip:!enabled},async()=>{
  const n=node('A',10,0,100,60,'Start')+node('B',10,20,100,60,'Other')+node('T',400,70,100,60,'Target');
  const dA2='M110 30 L255 30 Q260 30 260 35 L260 95 Q260 100 265 100 L400 100';
  const dB2='M110 50 L253 50 Q258 50 258 55 L258 95 Q258 100 263 100 L400 100';
  const c=await pair(src2,wrap(n+edge('A','T',dA2,attr('t1'))+edge('B','T',dB2,attr('t1'))));
  assert.equal(c.routePairClearance.status,'FAIL');
  assert.deepEqual(c.routePairClearance.evidence.violations.map(v=>v.separation),[2]);
});

test('legacy data-shared-bus is not accepted and is listed as an unrecognised trunk-like attribute',{skip:!enabled},async()=>{
  const bus=attr('close','data-shared-bus');
  const c=await pair(src2,wrap(nodes+edge('A','T',dA,bus)+edge('B','T',dB,bus)));
  assert.equal(c.routePairClearance.status,'FAIL');
  assert.deepEqual(c.routePairClearance.evidence.unrecognisedTrunkAttributes,[{edge:'A->T',attribute:'data-shared-bus',value:'close'},{edge:'B->T',attribute:'data-shared-bus',value:'close'}]);
  assert.match(c.routePairClearance.evidence.hint,/data-shared-trunk/);
});

// ---- trunk semantics (T11): style, label and entry-side must agree for a declared trunk ----
const kinds=c=>c.routePairClearance.evidence.violations.map(v=>v.kind).filter(Boolean);

test('mixed-style trunk: a dashed member merged with a solid member fails',{skip:!enabled},async()=>{
  const c=await pair(src2,wrap(nodesS+edge('A','T',sA,attr('t1'))+edge('B','T',sB,attr('t1')+' stroke-dasharray="6 4"')));
  assert.equal(c.routePairClearance.status,'FAIL');
  assert.deepEqual(kinds(c),['mixed-style trunk']);
});

test('mixed-style trunk: stroke width and colour must also agree',{skip:!enabled},async()=>{
  const w=await pair(src2,wrap(nodesS+edge('A','T',sA,attr('t1'))+edge('B','T',sB,attr('t1')+' stroke-width="2"')));
  assert.deepEqual(kinds(w),['mixed-style trunk']);
  const col=await pair(src2,wrap(nodesS+edge('A','T',sA,attr('t1'))+edge('B','T',sB,attr('t1')+' style="stroke:#c00"')));
  assert.deepEqual(kinds(col),['mixed-style trunk']);
});

test('label on shared trunk: an edge label on or within 4 units of the shared run fails; a label 20 units away passes',{skip:!enabled},async()=>{
  const base=nodesS+edge('A','T',sA,attr('t1'))+edge('B','T',sB,attr('t1'));
  const on=await pair(src2,wrap(base+label('A','T',320,172)));
  assert.equal(on.routePairClearance.status,'FAIL');assert.deepEqual(kinds(on),['label on shared trunk']);
  const near=await pair(src2,wrap(base+label('A','T',320,160)));   // box bottom 176 = 4 units above y=180
  assert.deepEqual(kinds(near),['label on shared trunk']);
  const far=await pair(src2,wrap(base+label('A','T',320,144)));    // box bottom 160 = 20 units above
  assert.equal(far.routePairClearance.status,'PASS');
});

test('opposite-side merge: members entering the trunk from opposite sides fail even when declared',{skip:!enabled},async()=>{
  const c=await pair(src2,wrap(nodes+edge('A','T',dA,attr('t1'))+edge('B','T',dB,attr('t1'))));
  assert.equal(c.routePairClearance.status,'FAIL');
  assert.deepEqual(kinds(c),['opposite-side merge']);
});

test('opposite-side merge: three feeds, one from below and one straight, still fail',{skip:!enabled},async()=>{
  const c=await pair(src3,wrap(nodes3+edge('A','T',dA,attr('t1'))+edge('B','T',dB,attr('t1'))+edge('C','T',dC,attr('t1'))));
  assert.equal(c.routePairClearance.status,'FAIL');
  assert.ok(kinds(c).includes('opposite-side merge'));
});

test('ambiguous junction: undeclared head-on T-junction fails even with zero overlap length',{skip:!enabled},async()=>{
  // Both horizontal legs run along y=50 and turn down at x=250 / x=260; the stems are 10 apart so no span overlaps
  // (zero overlap length), yet the two legs form one continuous line between the sources.
  const n=node('A',10,20,100,60,'Start')+node('B',400,20,100,60,'Other')+node('T',200,200,100,60,'Target');
  const a='M110 50 L245 50 Q250 50 250 55 L250 200';
  const b='M400 50 L265 50 Q260 50 260 55 L260 200';
  const c=await pair(src2.replace('B[Other] --> T','B[Other] --> T'),wrap(n+edge('A','T',a)+edge('B','T',b)));
  assert.equal(c.routePairClearance.status,'FAIL');
  assert.deepEqual(kinds(c),['ambiguous junction']);
});

test('undeclared legs with the same target that do not face each other are not an ambiguous junction',{skip:!enabled},async()=>{
  const c=await pair(src2,wrap(nodesS+edge('A','T',sA)+edge('B','T',sB)));
  assert.ok(!kinds(c).includes('ambiguous junction'));
});
