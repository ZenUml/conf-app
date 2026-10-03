import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSpec,validateSpec,SPEC_SHAPES} from '../src/spec-render.mjs';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {parseMermaid} from '../src/parser.mjs';
import {shapeClass,swatchGeometryClass} from '../src/layout-checks.mjs';
import {specModeParagraph} from '../src/spec-tool.mjs';

const PAL={step:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Process step'}};
// canonical shape -> {rect, data-shape, outline matcher, label box, one outline point per face (top, right, bottom, left)}
// The rect is [300,200,200,90] unless stated; s = h/3 = 30 (parallelograms, trapezoids), p = h/4 = 22.5 (hexagon, flag notch).
const R=[300,200,200,90];
const CASES={
  subroutine:{rect:R,lb:[324,212,152,66],outline:/<rect [^>]*rx="4"/,bars:true,faces:[[400,200],[500,245],[400,290],[300,245]]},
  circle:{rect:[300,200,120,120],lb:[326.5,226.5,67,67],outline:/<ellipse cx="360" cy="260" rx="60" ry="60"/,faces:[[360,200],[420,260],[360,320],[300,260]]},
  doublecircle:{rect:[300,200,140,140],lb:[333.5,233.5,73,73],outline:/<ellipse cx="370" cy="270" rx="70" ry="70"[^>]*\/><ellipse cx="370" cy="270" rx="64" ry="64"/,faces:[[370,200],[440,270],[370,340],[300,270]]},
  hexagon:{rect:R,lb:[334.5,212,131,66],outline:/<polygon points="322.5,200 477.5,200 500,245 477.5,290 322.5,290 300,245"/,faces:[[400,200],[500,245],[400,290],[300,245]]},
  parallelogram:{rect:R,lb:[342,212,116,66],outline:/<polygon points="330,200 500,200 470,290 300,290"/,faces:[[415,200],[485,245],[385,290],[315,245]]},
  parallelogram_alt:{rect:R,lb:[342,212,116,66],outline:/<polygon points="300,200 470,200 500,290 330,290"/,faces:[[385,200],[485,245],[415,290],[315,245]]},
  trapezoid:{rect:R,lb:[342,212,116,66],outline:/<polygon points="330,200 470,200 500,290 300,290"/,faces:[[400,200],[485,245],[400,290],[315,245]]},
  trapezoid_alt:{rect:R,lb:[342,212,116,66],outline:/<polygon points="300,200 500,200 470,290 330,290"/,faces:[[400,200],[485,245],[400,290],[315,245]]},
  asymmetric:{rect:R,lb:[334.5,212,153.5,66],outline:/<polygon points="300,200 500,200 500,290 300,290 322.5,245"/,faces:[[400,200],[500,245],[400,290],[311.25,222.5]]},
};
const OUT=[[0,-1],[1,0],[0,1],[-1,0]];
const ghost=(p,[dx,dy])=>({rect:[p[0]+dx*100+(dx>0?0:dx<0?-80:-40),p[1]+dy*100+(dy>0?0:dy<0?-50:-25),80,50],start:[p[0]+dx*100,p[1]+dy*100]});
const one=(shape,c=CASES[shape]??{rect:R})=>({canvas:{w:800,h:600,title:'t',desc:'d'},palette:PAL,
  nodes:[{id:'N',shape,rect:c.rect,text:'Node',role:'step'}],edges:[]});
const withEdge=(shape,face,point=CASES[shape].faces[face],via=null)=>{
  const s=one(shape),g=ghost(point,OUT[face]);
  s.nodes.push({id:'G',shape:'rect',rect:g.rect,text:'g',role:'step'});
  s.edges.push({source:'G',target:'N',points:via??[g.start,point]});
  return s;
};
const find=(r,rule)=>r.findings.filter(f=>f.rule===rule);
const ALL=Object.keys(CASES);

test('SPEC_SHAPES lists every parser shape once, with the aliases accepted besides',()=>{
  for(const s of ['rect','capsule','decision','cylinder','subroutine','circle','doublecircle','hexagon','parallelogram','parallelogram_alt','trapezoid','trapezoid_alt','asymmetric'])assert.ok(SPEC_SHAPES.includes(s),s);
  for(const a of ['store','queue','stadium','parallelogram-alt','trapezoid-alt'])assert.deepEqual(validateSpec({...one('rect'),nodes:[{id:'N',shape:a,rect:R,text:'x',role:'step'}]}),[],a);
  assert.equal(validateSpec({...one('rect'),nodes:[{id:'N',shape:'blob',rect:R,text:'x',role:'step'}]})[0].path,'nodes[0].shape');
});

for(const shape of ALL)test(`${shape}: outline, data-shape and label box`,()=>{
  const c=CASES[shape],r=renderSpec(one(shape));
  assert.deepEqual(r.findings,[],JSON.stringify(r.findings));
  assert.match(r.svg,new RegExp(`<g data-node="N" data-shape="${shape}" data-label-box="${c.lb.join(' ')}">`));
  assert.match(r.svg,c.outline);
  if(c.bars)assert.match(r.svg,/<path d="M 312 200 L 312 290 M 488 200 L 488 290"[^>]*fill="none"/);
});

test('centre + tier sizes: the label box is the tier and the outline adds fixed padding',()=>{
  const lbOf=(shape,tier='M')=>{const s=one(shape);s.nodes[0]={id:'N',shape,centre:[400,300],tier,text:'Node',role:'step'};const r=renderSpec(s);assert.deepEqual(r.findings,[],shape+JSON.stringify(r.findings));return /data-label-box="([^"]+)"/.exec(r.svg)[1].split(' ').map(Number)};
  for(const shape of ALL)for(const tier of ['S','M','L','XL']){
    const [,,w,h]=lbOf(shape,tier),[tw,th]={S:[96,40],M:[200,80],L:[320,120],XL:[480,160]}[tier];
    if(shape==='circle'||shape==='doublecircle'){assert.ok(w<=tw+1e-6&&h<=th+1e-6&&w>0,`${shape} ${tier}`)}
    else{assert.equal(w,tw,`${shape} ${tier} w`);assert.equal(h,th,`${shape} ${tier} h`)}
  }
  const [x,y,w,h]=lbOf('subroutine');assert.deepEqual([w,h],[200,80]);assert.equal(x,400-(200+48)/2+24);assert.equal(y,300-(80+24)/2+12);
});

test('aliases render the canonical shape: store=cylinder, queue=subroutine, stadium=capsule',()=>{
  const svg=shape=>{const s=one('rect');s.nodes[0].shape=shape;return renderSpec(s).svg};
  assert.equal(svg('store'),svg('cylinder'));assert.equal(svg('queue'),svg('subroutine'));assert.equal(svg('stadium'),svg('capsule'));
  assert.equal(svg('parallelogram-alt'),svg('parallelogram_alt'));assert.equal(svg('trapezoid-alt'),svg('trapezoid_alt'));
  assert.match(svg('queue'),/data-shape="subroutine"/);assert.match(svg('store'),/data-shape="cylinder"/);
  assert.doesNotMatch(svg('queue'),/<path d="M [\d.]+ [\d.]+ C/); // no cylinder arcs
});

for(const shape of ALL)for(const face of [0,1,2,3])test(`${shape}: an endpoint on the ${['top','right','bottom','left'][face]} face is accepted`,()=>{
  const r=renderSpec(withEdge(shape,face));
  assert.deepEqual(r.findings,[],JSON.stringify(r.findings));
});

for(const shape of ALL)test(`${shape}: an endpoint off the outline is reported, as is a leg that is not perpendicular to the face`,()=>{
  const p=CASES[shape].faces[0];
  const gi=ghost(p,OUT[0]),si=one(shape);si.nodes.push({id:'G',shape:'rect',rect:gi.rect,text:'g',role:'step'});si.edges.push({source:'G',target:'N',points:[gi.start,[p[0],p[1]+10]]});
  const inside=renderSpec(si);
  assert.equal(find(inside,'endpoint-on-face').length,1,JSON.stringify(inside.findings));
  const g=ghost(p,[-1,0]);
  const s=one(shape);s.nodes.push({id:'G',shape:'rect',rect:g.rect,text:'g',role:'step'});s.edges.push({source:'G',target:'N',points:[g.start,p]});
  assert.equal(find(renderSpec(s),'port-direction').length,1,JSON.stringify(renderSpec(s).findings));
});

test('source [[x]] with spec subroutine (or its alias queue) gives no shape-change; a cylinder or a rect does',()=>{
  const model=parseMermaid('flowchart LR\n  A[[Job]] --> B[(Db)]\n');
  const spec=shape=>{const s=one('rect');s.nodes=[{id:'A',shape,rect:[100,100,248,104],text:'Job',role:'step'},{id:'B',shape:'cylinder',centre:[600,152],tier:'S',text:'Db',role:'step'}];
    s.edges=[{source:'A',target:'B',points:[[348,152],[588,152]]}];return s};
  for(const ok of ['subroutine','queue'])assert.deepEqual(find(renderSpec(spec(ok),{model}),'shape-change'),[],ok);
  for(const bad of ['cylinder','store','rect','capsule','decision']){
    const f=find(renderSpec(spec(bad),{model}),'shape-change');
    assert.equal(f.length,1,bad);assert.equal(f[0].severity,'blocking');assert.deepEqual(f[0].elements,['A']);assert.match(f[0].measured,/subroutine/);
  }
});
test('shape-change covers rect, capsule, decision, cylinder; source shapes with no notation are never checked',()=>{
  const src='flowchart LR\n  A[a] --> B(b)\n  B --> C{c}\n  C --> D[(d)]\n  D --> E((e))\n  E --> F{{f}}\n  F --> G[/g/]\n';
  const model=parseMermaid(src);
  const mk=shapes=>({canvas:{w:2000,h:300,title:'t',desc:'d'},palette:PAL,nodes:Object.entries(shapes).map(([id,shape],i)=>({id,shape,rect:[20+i*260,100,200,90],text:id.toLowerCase(),role:'step'})),edges:[]});
  const good={A:'rect',B:'capsule',C:'decision',D:'cylinder',E:'rect',F:'rect',G:'rect'};
  assert.deepEqual(find(renderSpec(mk(good),{model}),'shape-change').map(f=>f.elements[0]),[]);
  const bad={...good,A:'capsule',B:'rect',C:'rect',D:'subroutine'};
  assert.deepEqual(find(renderSpec(mk(bad),{model}),'shape-change').map(f=>f.elements[0]).sort(),['A','B','C','D']);
  // the exact notations also pass for the shapes that have no rule notation
  assert.deepEqual(find(renderSpec(mk({...good,E:'circle',F:'hexagon',G:'parallelogram'}),{model}),'shape-change'),[]);
  assert.equal(parseMermaid('flowchart LR\n A([x])\n').nodes[0].shape,'stadium');
});

// ---- legend swatches ----
const legendSvg=shape=>{const s=one('rect');s.nodes=[];s.legend={x:20,y:20,entries:[{kind:'node',role:'step',label:`Key ${shape}`,shape}]};s.nodes=[{id:'N',shape:'rect',rect:[300,200,200,90],text:'n',role:'step'}];return renderSpec(s).svg};
const marksOf=svg=>{const body=/<g data-legend="[^"]*">(.*?)<text/.exec(svg)[1];return body};
test('legend entries draw every shape as its own glyph',()=>{
  assert.match(marksOf(legendSvg('subroutine')),/<rect [^>]*width="24" height="18"[^>]*\/><path d="M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ M [\d.]+ [\d.]+ L [\d.]+ [\d.]+"[^>]*fill="none"/);
  assert.match(marksOf(legendSvg('queue')),/ M /);
  assert.match(marksOf(legendSvg('circle')),/<circle /);
  assert.match(marksOf(legendSvg('doublecircle')),/<circle [^>]*\/><circle /);
  assert.match(marksOf(legendSvg('hexagon')),/<polygon points="([\d.,]+ ){5}[\d.,]+"/);
  assert.match(marksOf(legendSvg('parallelogram')),/<polygon /);
  assert.match(marksOf(legendSvg('cylinder')),/ C /);
  assert.match(marksOf(legendSvg('store')),/ C /);
});
test('shapeClass maps data-shape values to the legend classes, one class per notation',()=>{
  const c=n=>shapeClass(n);
  assert.equal(c('subroutine'),'subroutine');assert.equal(c('queue'),'subroutine');assert.equal(c('cylinder'),'cylinder');assert.equal(c('store'),'cylinder');
  assert.equal(c('circle'),'circle');assert.equal(c('doublecircle'),'circle');assert.equal(c('hexagon'),'decision');
  assert.equal(c('parallelogram'),'parallelogram');assert.equal(c('parallelogram_alt'),'parallelogram');assert.equal(c('trapezoid'),'trapezoid');assert.equal(c('trapezoid_alt'),'trapezoid');
  assert.equal(c('asymmetric'),'asymmetric');
});
test('swatchGeometryClass recognises the new polygon swatches',()=>{
  const poly=points=>swatchGeometryClass({tag:'polygon',points,w:24,h:18});
  assert.equal(poly('6,0 24,0 18,18 0,18'),'parallelogram');
  assert.equal(poly('0,0 18,0 24,18 6,18'),'parallelogram');
  assert.equal(poly('6,0 18,0 24,18 0,18'),'trapezoid');
  assert.equal(poly('0,0 24,0 18,18 6,18'),'trapezoid');
  assert.equal(poly('0,0 24,0 24,18 0,18 6,9'),'asymmetric');
  assert.equal(poly('0,0 24,0 30,9 24,18 0,18'),null); // a convex pentagon (arrow) stays unclassified
  assert.equal(poly('6,0 18,0 24,9 18,18 6,18 0,9'),'decision');
  assert.equal(poly('12,0 24,9 12,18 0,9'),'decision');
  assert.equal(poly('0,0 24,0 24,18 0,18'),'rect');
});

test('every shape swatch is accepted by the independent legend check when a node is drawn that way',{skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
  for(const shape of [...ALL,'cylinder','capsule','decision']){
    const rect=shape in CASES?CASES[shape].rect:[300,200,200,90];
    const s={canvas:{w:800,h:600,title:'t',desc:'d'},palette:PAL,nodes:[{id:'N',shape,rect,text:'Node',role:'step'}],edges:[],
      legend:{x:20,y:20,entries:[{kind:'node',role:'step',label:`Key`,shape}]}};
    const r=renderSpec(s);
    const result=await auditAgentSvg('flowchart LR\n N[Node]\n',Buffer.from(r.svg));
    const lc=result.checks.legendCompleteness;
    assert.equal(lc.status,'PASS',`${shape}: ${JSON.stringify(lc.evidence)}`);
    assert.ok(!lc.evidence.minorFindings,`${shape} swatch not recognised: ${JSON.stringify(lc.evidence.minorFindings)}`);
  }
});
test('the independent audit passes text fit, intrusion, markers and shaft for every shape drawn with face endpoints',{skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
  for(const shape of ALL){
    const r=renderSpec(withEdge(shape,1));
    assert.deepEqual(r.findings,[],shape);
    const result=await auditAgentSvg('flowchart LR\n G[g] --> N[Node]\n',Buffer.from(r.svg));
    for(const id of ['textFit','routeNodeIntrusion','markerDrawing','arrowShaft'])assert.equal(result.checks[id].status,'PASS',`${shape} ${id}: ${JSON.stringify(result.checks[id].evidence)}`);
  }
});

test('the required-mode prompt lists every spec shape and the source-to-shape mapping',()=>{
  const p=specModeParagraph({runDir:'/tmp/x',jobId:'j',required:true});
  for(const s of ['rect','capsule','decision','cylinder','subroutine','circle','doublecircle','hexagon','parallelogram','parallelogram_alt','trapezoid','trapezoid_alt','asymmetric'])assert.ok(p.includes(s),s);
  assert.match(p,/\[\[\.\.\]\] subroutine/);assert.match(p,/\[\(\.\.\)\] cylinder/);assert.doesNotMatch(p,/\[\[\.\.\]\] queue/);
});
