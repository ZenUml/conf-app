import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';

// Synthetic fixtures only. Each new layout check has a failing and a passing fixture; the base diagram is clean for all six.
const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const source='flowchart LR\n  A[Start] --> B[Finish]\n';

function fixture(o={}){
  const {
    stroke='1',edgeAttrs='',d='M160 92 L355 92 Q360 92 360 97 L360 180',
    markerAttrs='markerUnits="userSpaceOnUse"',markerFill='#2f6fad',markerW='10',refX='10',markerPath='M0,0 L10,5 L0,10 Z',extraMarker='',
    fillA='#eaf3ff',fillB='#eaf3ff',textFillA='#173a63',textFillB='#173a63',weightA='400',weightB='400',
    shapeA='rect',shapeB='rect',nodeB=null,comment='<!-- Palette: blue = process step -->',extraDefs='',body='',canvas='<rect width="520" height="320" fill="#ffffff"/>',
  }=o;
  const defs=`<defs><marker id="arrow" ${markerAttrs} markerWidth="${markerW}" markerHeight="10" refX="${refX}" refY="5" orient="auto"><path d="${markerPath}" fill="${markerFill}"/></marker>${extraMarker}${extraDefs}</defs>`;
  const a=`<g data-node="A" data-shape="${shapeA}"><rect x="40" y="60" width="120" height="64" rx="4" fill="${fillA}" stroke="#2f6fad" stroke-width="2"/><text x="100" y="92" text-anchor="middle" dominant-baseline="central" font-size="18" font-weight="${weightA}" fill="${textFillA}">Start</text></g>`;
  const b=nodeB??`<g data-node="B" data-shape="${shapeB}"><rect x="300" y="180" width="120" height="64" rx="4" fill="${fillB}" stroke="#2f6fad" stroke-width="2"/><text x="360" y="212" text-anchor="middle" dominant-baseline="central" font-size="18" font-weight="${weightB}" fill="${textFillB}">Finish</text></g>`;
  const edge=`<path data-source="A" data-target="B" d="${d}" fill="none" stroke="#2f6fad" stroke-width="${stroke}" ${edgeAttrs} marker-end="url(#arrow)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 320">${comment}${defs}${canvas}${body}${edge}${a}${b}</svg>`;
}
const run=svg=>auditAgentSvg(source,svg);
const check=(result,name)=>result.checks[name];

test('base fixture is clean for every layout check',{skip:!enabled},async()=>{
  const r=await run(fixture());
  for(const name of ['connectorStrokeWidth','filletUniformity','markerUniformity','textContrast','labelFontWeight','legendCompleteness'])assert.equal(check(r,name)?.status,'PASS',`${name}: ${JSON.stringify(check(r,name))}`);
});

// 1. connectorStrokeWidth (rule 8)
test('connectorStrokeWidth FAILs a 2-unit connector without a documented emphasis role',{skip:!enabled},async()=>{
  const r=await run(fixture({stroke:'2'}));
  assert.equal(check(r,'connectorStrokeWidth')?.status,'FAIL');
  assert.deepEqual(check(r,'connectorStrokeWidth')?.evidence?.failures?.map(f=>[f.edge,f.strokeWidth]),[['A->B',2]]);
  assert.equal(r.status,'FAIL');
});
test('connectorStrokeWidth: emphasis needs a meaning in the palette comment; documented emphasis passes',{skip:!enabled},async()=>{
  const undocumented=await run(fixture({stroke:'2',edgeAttrs:'data-emphasis="critical-path"'}));
  assert.equal(check(undocumented,'connectorStrokeWidth')?.status,'FAIL');
  const documented=await run(fixture({stroke:'2',edgeAttrs:'data-emphasis="critical-path"',comment:'<!-- Palette: blue = process step. Emphasis: critical-path = the primary flow, drawn at width 2 -->'}));
  assert.equal(check(documented,'connectorStrokeWidth')?.status,'PASS');
  assert.equal(check(documented,'connectorStrokeWidth')?.evidence?.emphasised?.length,1);
});

// 2. filletUniformity (rule 3 + script-first)
test('filletUniformity FAILs a sharp 90-degree corner (r=0)',{skip:!enabled},async()=>{
  const r=await run(fixture({d:'M160 92 L360 92 L360 180'}));
  assert.equal(check(r,'filletUniformity')?.status,'FAIL');
  assert.deepEqual(check(r,'filletUniformity')?.evidence?.failures?.map(f=>[f.edge,f.radius]),[['A->B',0]]);
});
test('filletUniformity FAILs mixed radii and a uniform wrong radius',{skip:!enabled},async()=>{
  const wrong=await run(fixture({d:'M160 92 L357 92 Q360 92 360 95 L360 180'}));
  assert.equal(check(wrong,'filletUniformity')?.status,'FAIL');
  assert.deepEqual(check(wrong,'filletUniformity')?.evidence?.radii,[3]);
  const mixed=await run(fixture({d:'M160 92 L355 92 Q360 92 360 97 L360 130 Q360 135 365 135 L380 135 L380 180'}));
  assert.equal(check(mixed,'filletUniformity')?.status,'FAIL');
  assert.deepEqual(check(mixed,'filletUniformity')?.evidence?.radii,[0,5]);
});
test('filletUniformity PASSes r=5 quadratic, arc and cubic fillets; a straight route has no bends',{skip:!enabled},async()=>{
  const q=await run(fixture());
  assert.equal(check(q,'filletUniformity')?.status,'PASS');
  assert.equal(check(q,'filletUniformity')?.evidence?.checkedBends,1);
  const arc=await run(fixture({d:'M160 92 L355 92 A5 5 0 0 1 360 97 L360 180'}));
  assert.equal(check(arc,'filletUniformity')?.status,'PASS');
  const cubic=await run(fixture({d:'M160 92 L355 92 C357.5 92 360 94.5 360 97 L360 180'}));
  assert.equal(check(cubic,'filletUniformity')?.status,'PASS');
  const straight=await run(fixture({d:'M160 92 L360 92'}));
  assert.equal(check(straight,'filletUniformity')?.evidence?.checkedBends,0);
});
test('filletUniformity: a non-orthogonal curve is NOT-CHECKABLE for that edge, never PASS',{skip:!enabled},async()=>{
  const diag=await run(fixture({d:'M160 92 L360 180'}));
  assert.equal(check(diag,'filletUniformity')?.status,'NOT-CHECKABLE');
  const spline=await run(fixture({d:'M160 92 C260 92 360 120 360 180'}));
  assert.equal(check(spline,'filletUniformity')?.status,'NOT-CHECKABLE');
  assert.deepEqual(check(spline,'filletUniformity')?.evidence?.notCheckableEdges?.map(e=>e.edge),['A->B']);
});

// 3. markerUniformity (rule 7)
test('markerUniformity FAILs a marker that is not userSpaceOnUse',{skip:!enabled},async()=>{
  const r=await run(fixture({markerAttrs:''}));
  assert.equal(check(r,'markerUniformity')?.status,'FAIL');
  assert.match(JSON.stringify(check(r,'markerUniformity')?.evidence?.failures),/userSpaceOnUse/);
});
test('markerUniformity FAILs refX away from the tip, and context-stroke fill (Safari renders black)',{skip:!enabled},async()=>{
  const tip=await run(fixture({refX:'5'}));
  assert.equal(check(tip,'markerUniformity')?.status,'FAIL');
  assert.match(JSON.stringify(check(tip,'markerUniformity')?.evidence?.failures),/refX/);
  const ctx=await run(fixture({markerFill:'context-stroke'}));
  assert.equal(check(ctx,'markerUniformity')?.status,'FAIL');
  assert.match(JSON.stringify(check(ctx,'markerUniformity')?.evidence?.failures),/context-stroke/);
});
test('markerUniformity FAILs two markers whose size or geometry differ; identical geometry in two colours passes',{skip:!enabled},async()=>{
  const second=(w,path)=>`<marker id="arrow2" markerUnits="userSpaceOnUse" markerWidth="${w}" markerHeight="10" refX="10" refY="5" orient="auto"><path d="${path}" fill="#b04a2f"/></marker>`;
  const withSecond=(w,path)=>fixture({extraMarker:second(w,path),body:'<path data-source="A" data-target="B" d="M160 100 L355 100 Q360 100 360 105 L360 180" fill="none" stroke="#b04a2f" stroke-width="1" marker-end="url(#arrow2)"/>'});
  const sized=await run(withSecond('12','M0,0 L10,5 L0,10 Z'));
  assert.equal(check(sized,'markerUniformity')?.status,'FAIL');
  const shaped=await run(withSecond('10','M0,0 L10,5 L0,10 L2,5 Z'));
  assert.equal(check(shaped,'markerUniformity')?.status,'FAIL');
  const recoloured=await run(withSecond('10','M0,0 L10,5 L0,10 Z'));
  assert.equal(check(recoloured,'markerUniformity')?.status,'PASS');
});
test('markerUniformity is NOT-CHECKABLE when no connector has a marker',{skip:!enabled},async()=>{
  const r=await run(fixture().replace(' marker-end="url(#arrow)"',''));
  assert.equal(check(r,'markerUniformity')?.status,'NOT-CHECKABLE');
});

// 4. textContrast (colours section)
test('textContrast FAILs low-contrast text with the pair and the ratio',{skip:!enabled},async()=>{
  const r=await run(fixture({textFillB:'#aaaaaa'}));
  assert.equal(check(r,'textContrast')?.status,'FAIL');
  const f=check(r,'textContrast')?.evidence?.failures?.[0];
  assert.deepEqual([f?.elementId,f?.foreground,f?.background],['B','#aaaaaa','#eaf3ff']);
  assert.ok(f?.ratio>1.5&&f?.ratio<2.5,`ratio ${f?.ratio}`);
});
test('textContrast PASSes the 4.5:1 boundary pairs and FAILs just under',{skip:!enabled},async()=>{
  // #767676 on white is 4.54:1; #777777 is 4.48:1.
  const ok=await run(fixture({fillB:'#ffffff',textFillB:'#767676'}));
  assert.equal(check(ok,'textContrast')?.status,'PASS');
  const bad=await run(fixture({fillB:'#ffffff',textFillB:'#777777'}));
  assert.equal(check(bad,'textContrast')?.status,'FAIL');
});
test('textContrast: an unresolvable background (gradient, or no painted canvas) is NOT-CHECKABLE',{skip:!enabled},async()=>{
  const grad=await run(fixture({fillB:'url(#g)',extraDefs:'<linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>'}));
  assert.equal(check(grad,'textContrast')?.status,'NOT-CHECKABLE');
  const bare=await run(fixture({canvas:'',body:'<text x="20" y="300" font-size="16" fill="#173a63">Footnote on a transparent canvas</text>'}));
  assert.equal(check(bare,'textContrast')?.status,'NOT-CHECKABLE');
});

// 5. labelFontWeight (T4)
test('labelFontWeight FAILs a bold node label',{skip:!enabled},async()=>{
  const r=await run(fixture({weightB:'700'}));
  assert.equal(check(r,'labelFontWeight')?.status,'FAIL');
  assert.deepEqual(check(r,'labelFontWeight')?.evidence?.failures?.map(f=>[f.nodeId,f.fontWeight]),[['B',700]]);
});
test('labelFontWeight allows a heavier group heading (container membership) but not a heavy node text inside the group',{skip:!enabled},async()=>{
  const group='<g data-group="G"><rect x="20" y="40" width="440" height="230" rx="4" fill="#f6f8fa" stroke="#8c959f" stroke-width="1"/><text x="36" y="58" font-size="18" font-weight="600" fill="#173a63">Heading</text></g>';
  const ok=await run(fixture({body:group}));
  assert.equal(check(ok,'labelFontWeight')?.status,'PASS');
  assert.equal(check(ok,'labelFontWeight')?.evidence?.headingsExempt,1);
  const bad=await run(fixture({body:group,weightA:'600'}));
  assert.equal(check(bad,'labelFontWeight')?.status,'FAIL');
});

// 6. legendCompleteness (C1/C5)
const legendFill=(label,fill,x=300)=>`<g data-legend="${label}"><rect x="${x}" y="20" width="24" height="18" rx="4" fill="${fill}" stroke="#2f6fad" stroke-width="2"/><text x="${x+34}" y="29" font-size="16" font-weight="400" dominant-baseline="central" fill="#173a63">${label}</text></g>`;
const cylinderB='<g data-node="B" data-shape="cylinder"><path d="M300 192 C300 176 420 176 420 192 L420 232 C420 248 300 248 300 232 Z" fill="#fff4d6" stroke="#2f6fad" stroke-width="2"/><text x="360" y="214" text-anchor="middle" font-size="18" font-weight="400" fill="#4d3a00">Finish</text></g>';
test('legendCompleteness FAILs two fill roles with no legend',{skip:!enabled},async()=>{
  const r=await run(fixture({fillB:'#fff4d6',textFillB:'#4d3a00'}));
  assert.equal(check(r,'legendCompleteness')?.status,'FAIL');
  assert.match(JSON.stringify(check(r,'legendCompleteness')?.evidence),/no legend/i);
});
test('legendCompleteness FAILs a legend missing a fill key, and PASSes when every fill role has a key',{skip:!enabled},async()=>{
  const two={fillB:'#fff4d6',textFillB:'#4d3a00'};
  const missing=await run(fixture({...two,body:legendFill('Process','#eaf3ff')}));
  assert.equal(check(missing,'legendCompleteness')?.status,'FAIL');
  assert.deepEqual(check(missing,'legendCompleteness')?.evidence?.missingKeys?.map(k=>[k.kind,k.value]),[['fill','#fff4d6']]);
  const complete=await run(fixture({...two,body:legendFill('Process','#eaf3ff')+legendFill('Store','#fff4d6',420)}));
  assert.equal(check(complete,'legendCompleteness')?.status,'PASS');
});
test('legendCompleteness FAILs a special shape without a shape key and PASSes with one (data-shape on the key)',{skip:!enabled},async()=>{
  const noKey=await run(fixture({nodeB:cylinderB,fillB:'#eaf3ff',body:legendFill('Process','#eaf3ff')}));
  // cylinder node uses fill #fff4d6; the legend lacks both that fill and the cylinder shape
  assert.equal(check(noKey,'legendCompleteness')?.status,'FAIL');
  const kinds=check(noKey,'legendCompleteness')?.evidence?.missingKeys?.map(k=>k.kind).sort();
  assert.deepEqual(kinds,['fill','shape']);
  const keyed=await run(fixture({nodeB:cylinderB,body:legendFill('Process','#eaf3ff')+'<g data-legend="Datastore" data-shape="cylinder"><path d="M420 20 C420 14 444 14 444 20 L444 36 C444 42 420 42 420 36 Z" fill="#fff4d6" stroke="#2f6fad" stroke-width="2"/><text x="454" y="29" font-size="16" font-weight="400" fill="#173a63">Datastore</text></g>'}));
  assert.equal(check(keyed,'legendCompleteness')?.status,'PASS',JSON.stringify(check(keyed,'legendCompleteness')));
});
test('legendCompleteness FAILs a dashed connector without a dashed key, and PASSes with one',{skip:!enabled},async()=>{
  const dashed=fixture({edgeAttrs:'stroke-dasharray="6 4"'});
  const noKey=await run(dashed);
  assert.equal(check(noKey,'legendCompleteness')?.status,'FAIL');
  assert.deepEqual(check(noKey,'legendCompleteness')?.evidence?.missingKeys?.map(k=>k.kind),['dashed']);
  const keyed=await run(fixture({edgeAttrs:'stroke-dasharray="6 4"',body:'<g data-legend="Optional flow"><path d="M300 29 L340 29" stroke="#2f6fad" stroke-width="1" stroke-dasharray="6 4" fill="none"/><text x="352" y="29" font-size="16" font-weight="400" fill="#173a63">Optional flow</text></g>'}));
  assert.equal(check(keyed,'legendCompleteness')?.status,'PASS');
});
test('legendCompleteness: a diagram with one fill role, plain rectangles and solid lines needs no legend',{skip:!enabled},async()=>{
  const r=await run(fixture());
  assert.equal(check(r,'legendCompleteness')?.status,'PASS');
});
test('legendCompleteness is NOT-CHECKABLE when shape tagging is missing and nothing else shows a violation',{skip:!enabled},async()=>{
  const untagged=fixture().replaceAll(/ data-shape="[a-z]+"/g,'');
  const r=await run(untagged);
  assert.equal(check(r,'legendCompleteness')?.status,'NOT-CHECKABLE');
  assert.notEqual(r.status,'PASS');
});
test('legendCompleteness recognises a text-titled legend group ("Legend") as the legend scope',{skip:!enabled},async()=>{
  const two={fillB:'#fff4d6',textFillB:'#4d3a00'};
  const group=`<g><text x="300" y="14" font-size="16" font-weight="400" fill="#173a63">Legend</text><rect x="300" y="20" width="24" height="18" fill="#eaf3ff" stroke="#2f6fad"/><rect x="340" y="20" width="24" height="18" fill="#fff4d6" stroke="#2f6fad"/></g>`;
  const r=await run(fixture({...two,body:group}));
  assert.equal(check(r,'legendCompleteness')?.status,'PASS',JSON.stringify(check(r,'legendCompleteness')));
});

// Wiring: any new FAIL fails the whole audit and becomes a blocking audit finding.
test('a new layout FAIL fails the overall audit and maps to a blocking finding with element ids',{skip:!enabled},async()=>{
  const {auditToFindings}=await import('../src/findings.mjs');
  const r=await run(fixture({stroke:'2',weightB:'700'}));
  assert.equal(r.status,'FAIL');
  const findings=auditToFindings(r);
  const rules=findings.map(f=>f.rule);
  assert.ok(rules.includes('connectorStrokeWidth')&&rules.includes('labelFontWeight'),rules.join());
  assert.ok(findings.find(f=>f.rule==='connectorStrokeWidth').elements.includes('A->B'));
  assert.ok(findings.find(f=>f.rule==='labelFontWeight').elements.includes('B'));
  assert.ok(findings.every(f=>f.suggestion&&!/^Resolve the/.test(f.suggestion)));
});

// Calibration findings: legend key forms seen in real candidate output.
const subroutineB='<g data-node="B" data-shape="subroutine"><rect x="300" y="180" width="120" height="64" rx="4" fill="#eaf3ff" stroke="#2f6fad" stroke-width="2"/><path d="M308 180 L308 244 M412 180 L412 244" fill="none" stroke="#2f6fad" stroke-width="2"/><text x="360" y="212" text-anchor="middle" font-size="18" font-weight="400" fill="#173a63">Finish</text></g>';
test('legendCompleteness recognises a subroutine key drawn as a rectangle with two bars, whatever its caption',{skip:!enabled},async()=>{
  const legend=bars=>`<g data-legend="Work queue"><rect x="300" y="20" width="24" height="18" rx="4" fill="#eaf3ff" stroke="#2f6fad" stroke-width="2"/>${bars?'<path d="M305 20 L305 38 M319 20 L319 38" fill="none" stroke="#2f6fad" stroke-width="2"/>':''}<text x="334" y="29" font-size="16" font-weight="400" fill="#173a63">Work queue</text></g>`;
  const keyed=await run(fixture({nodeB:subroutineB,body:legend(true)}));
  assert.equal(check(keyed,'legendCompleteness')?.status,'PASS',JSON.stringify(check(keyed,'legendCompleteness')));
  const plain=await run(fixture({nodeB:subroutineB,body:legend(false)}));
  assert.equal(check(plain,'legendCompleteness')?.status,'FAIL');
});
test('legendCompleteness reads a data-legend-item entry (item name as caption, geometry as mark)',{skip:!enabled},async()=>{
  const hex='<path d="M376 20 Q376 15 381 14 L398 11 L415 14 Q420 15 420 20 L420 34 Q420 39 415 40 L398 43 L381 40 Q376 39 376 34 Z" fill="#eaf3ff" stroke="#2f6fad" stroke-width="2"/>';
  const diamondB=fixture().match(/<g data-node="B"[\s\S]*?<\/g>/)[0].replace('data-shape="rect"','data-shape="hexagon"');
  const keyed=await run(fixture({nodeB:diamondB,body:`<g data-legend-item="decision">${hex}<text x="432" y="29" font-size="16" font-weight="400" fill="#173a63">Check</text></g>`}));
  assert.equal(check(keyed,'legendCompleteness')?.status,'PASS',JSON.stringify(check(keyed,'legendCompleteness')));
  const none=await run(fixture({nodeB:diamondB}));
  assert.equal(check(none,'legendCompleteness')?.status,'FAIL');
});

// T13: a shape key needs a swatch whose drawn geometry is that shape class; a caption word alone no longer counts.
const hexNode=fixture().match(/<g data-node="B"[\s\S]*?<\/g>/)[0].replace('data-shape="rect"','data-shape="hexagon"');
const hexSwatch=(x,cap)=>`<g data-legend="${cap}"><path d="M${x+6} 20 L${x+18} 20 L${x+24} 29 L${x+18} 38 L${x+6} 38 L${x} 29 Z" fill="#eaf3ff" stroke="#2f6fad" stroke-width="2"/><text x="${x+34}" y="29" font-size="16" font-weight="400" fill="#173a63">${cap}</text></g>`;
test('legendCompleteness FAILs a rectangle swatch whose caption merely says decision (T12 f2 false PASS)',{skip:!enabled},async()=>{
  const r=await run(fixture({nodeB:hexNode,body:legendFill('Workflow step / decision','#eaf3ff')}));
  assert.equal(check(r,'legendCompleteness')?.status,'FAIL',JSON.stringify(check(r,'legendCompleteness')));
  assert.deepEqual(check(r,'legendCompleteness')?.evidence?.missingKeys?.map(k=>[k.kind,k.value]),[['shape','decision']]);
});
test('legendCompleteness PASSes a hexagon swatch whatever its caption, and lists it as verified evidence',{skip:!enabled},async()=>{
  const r=await run(fixture({nodeB:hexNode,body:hexSwatch(300,'Branch point')}));
  assert.equal(check(r,'legendCompleteness')?.status,'PASS',JSON.stringify(check(r,'legendCompleteness')));
  assert.deepEqual(check(r,'legendCompleteness').evidence.legendShapes,['decision']);
});
test('legendCompleteness: a single swatch cannot stand for two shape classes',{skip:!enabled},async()=>{
  const r=await run(fixture({nodeB:cylinderB,shapeA:'diamond',body:hexSwatch(300,'Decision / store')}));
  assert.equal(check(r,'legendCompleteness')?.status,'FAIL',JSON.stringify(check(r,'legendCompleteness')));
  assert.deepEqual(check(r,'legendCompleteness')?.evidence?.missingKeys?.filter(k=>k.kind==='shape').map(k=>k.value),['cylinder']);
});
test('legendCompleteness is NOT-CHECKABLE when the swatch geometry cannot be classified',{skip:!enabled},async()=>{
  const odd='<g data-legend="Decision"><path d="M300 20 L324 20 L330 29 L324 38 L300 38 Z" fill="#eaf3ff" stroke="#2f6fad" stroke-width="2"/><text x="340" y="29" font-size="16" font-weight="400" fill="#173a63">Decision</text></g>';
  const r=await run(fixture({nodeB:hexNode,body:odd}));
  assert.equal(check(r,'legendCompleteness')?.status,'NOT-CHECKABLE',JSON.stringify(check(r,'legendCompleteness')));
});

// T13 calibration: real swatch forms found in T9/T12/v2 output that the geometry classifier must recognise.
const sw=(inner,cap)=>`<g data-legend="${cap}">${inner}<text x="460" y="29" font-size="16" font-weight="400" fill="#173a63">${cap}</text></g>`;
const queueB=subroutineB.replace('data-shape="subroutine"','data-shape="queue"');
test('legendCompleteness: bars written with V commands, and a queue node keyed by the rectangle-with-bars glyph',{skip:!enabled},async()=>{
  const glyph='<rect x="300" y="20" width="34" height="20" rx="2" fill="#eaf3ff" stroke="#2f6fad"/><path d="M305 20 V40 M329 20 V40" stroke="#2f6fad"/>';
  for(const node of [subroutineB,queueB]){
    const r=await run(fixture({nodeB:node,body:sw(glyph,'Hand-off')}));
    assert.equal(check(r,'legendCompleteness')?.status,'PASS',JSON.stringify(check(r,'legendCompleteness')));
  }
});
test('legendCompleteness: a cylinder swatch drawn with arcs plus a lid ellipse, or a lid ellipse plus an unpainted body path, is one cylinder',{skip:!enabled},async()=>{
  const arcs='<path d="M300 21 A17 4 0 0 0 334 21 V33 A17 4 0 0 1 300 33 Z" fill="#fff4d6" stroke="#2f6fad"/><ellipse cx="317" cy="21" rx="17" ry="4" fill="#fff4d6" stroke="#2f6fad"/>';
  const lid='<ellipse cx="317" cy="26" rx="24" ry="8" fill="#fff4d6" stroke="#2f6fad"/><path d="M293 26 V38 C293 48 341 48 341 38 V26" fill="none" stroke="#2f6fad"/>';
  for(const g of [arcs,lid]){
    const r=await run(fixture({nodeB:cylinderB,body:legendFill('Process','#eaf3ff',100)+sw(g,'Store')}));
    assert.equal(check(r,'legendCompleteness')?.status,'PASS',JSON.stringify(check(r,'legendCompleteness')));
  }
});
test('legendCompleteness: a plain oval is not a cylinder key',{skip:!enabled},async()=>{
  const oval='<ellipse cx="317" cy="29" rx="14" ry="9" fill="#fff4d6" stroke="#2f6fad"/>';
  const r=await run(fixture({nodeB:cylinderB,body:legendFill('Process','#eaf3ff',100)+sw(oval,'Store')}));
  assert.equal(check(r,'legendCompleteness')?.status,'FAIL');
});
