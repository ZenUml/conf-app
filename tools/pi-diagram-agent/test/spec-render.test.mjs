import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSpec,validateSpec,SpecError,measureText} from '../src/spec-render.mjs';
import {auditAgentSvg} from '../src/agent-audit.mjs';

const SOURCE='flowchart LR\n  A[Start] --> B{Ready}\n  B -- "Yes" --> C[(Store)]\n  B -.-> D(Skip)\n';
// Decision tips are pulled in by the 10-unit outline fillet: left/right 4.505, top/bottom 2.169 (S-tier diamond 216x104).
const baseSpec=()=>({
  canvas:{w:760,h:400,title:'Synthetic flow',desc:'Four synthetic nodes.'},
  palette:{
    step:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Process step'},
    data:{fill:'#e9f7ef',stroke:'#1e7a46',text:'#14432a',meaning:'Data store'}},
  nodes:[
    {id:'A',shape:'rect',rect:[20,128,120,64],text:'Start',role:'step'},
    {id:'B',shape:'decision',centre:[330,160],tier:'S',text:'Ready',role:'step'},
    {id:'C',shape:'store',centre:[600,160],tier:'S',text:'Store',role:'data'},
    {id:'D',shape:'capsule',rect:[540,280,120,64],text:'Skip',role:'step'}],
  edges:[
    {source:'A',target:'B',points:[[140,160],[226.5,160]]},
    {source:'B',target:'C',points:[[433.5,160],[540,160]],label:{text:'Yes',x:487,y:142}},
    {source:'B',target:'D',dashed:true,points:[[330,209.83],[330,312],[540,312]]}],
  legend:{x:20,y:20,entries:[{kind:'node',role:'step',label:'Process step'},{kind:'line',role:'step',label:'Dashed relation',dashed:true}]}});
const clone=o=>structuredClone(o);
const rules=r=>r.findings.map(f=>f.rule);
const find=(r,rule,el)=>r.findings.filter(f=>f.rule===rule&&(!el||f.elements.includes(el)));
const pathOf=(svg,s,t)=>new RegExp(`<path[^>]*data-source="${s}" data-target="${t}"[^>]* d="([^"]+)"`).exec(svg)?.[1]??new RegExp(`<path[^>]*d="([^"]+)"[^>]*data-source="${s}" data-target="${t}"`).exec(svg)?.[1];

test('the baseline spec renders with no findings and exact tagging for the auditor',()=>{
  const r=renderSpec(baseSpec());
  assert.deepEqual(r.findings,[],JSON.stringify(r.findings,null,1));
  for(const id of ['A','B','C','D'])assert.match(r.svg,new RegExp(`<g data-node="${id}"[^>]* data-label-box="[\\d. ]+"`));
  assert.match(r.svg,/data-source="B" data-target="D"/);
  assert.match(r.svg,/<g data-edge-label-source="B" data-edge-label-target="C">/);
  assert.equal(r.stats.nodes,4);assert.equal(r.stats.edges,3);
});

test('connector bends use one uniform r=5 fillet and the path is exactly the given points',()=>{
  const r=renderSpec(baseSpec());
  assert.equal(pathOf(r.svg,'B','D'),'M 330,209.83 L 330,307 Q 330,312 335,312 L 540,312');
  assert.equal(pathOf(r.svg,'A','B'),'M 140,160 L 226.5,160');
  assert.match(r.svg,/stroke-width="1"/);
});

test('one fixed userSpaceOnUse marker per colour, no context-stroke',()=>{
  const r=renderSpec(baseSpec());
  const markers=r.svg.match(/<marker [^>]*>/g);
  assert.equal(markers.length,2);
  for(const m of markers){assert.match(m,/markerUnits="userSpaceOnUse"/);assert.match(m,/markerWidth="10" markerHeight="10"/);assert.match(m,/refX="10" refY="5"/)}
  assert.match(r.svg,/<marker id="arrow-2563a8"/);assert.match(r.svg,/<marker id="arrow-1e7a46"/);
  assert.match(r.svg,/marker-end="url\(#arrow-1e7a46\)"/); // destination colour by default (C2)
  assert.doesNotMatch(r.svg,/context-stroke/);
  assert.match(r.svg,/<path d="M0,0 L10,5 L0,10 Z" fill="#2563a8"\/>/);
});

test('edge label pill: centred on the given point, canvas background, even width, bound to the edge',()=>{
  const r=renderSpec(baseSpec());
  const m=/<g data-edge-label-source="B" data-edge-label-target="C"><rect x="([\d.]+)" y="([\d.]+)" width="(\d+)" height="24" rx="12" fill="#ffffff" stroke="none"\/><text x="([\d.]+)" y="([\d.]+)"/.exec(r.svg);
  assert.ok(m,r.svg);
  const [x,y,w,tx,ty]=[1,2,3,4,5].map(i=>Number(m[i]));
  assert.equal(w%2,0);assert.equal(y,130);assert.equal(x+w/2,487);assert.equal(tx,487);assert.equal(ty,142);
});

test('a legend, palette comment and title/desc are emitted',()=>{
  const r=renderSpec(baseSpec());
  assert.match(r.svg,/<!-- semantic-palette \| step:.*Process step.*\| data:.*Data store/);
  assert.match(r.svg,/data-legend="Process step"/);assert.match(r.svg,/data-legend="Dashed relation"/);
  assert.match(r.svg,/<title>Synthetic flow<\/title>/);
});

// ---- never raises, never moves: a violating spec renders exactly what it says ----
test('violations never throw and the drawn path keeps the offending point',()=>{
  const s=baseSpec();s.edges[0].points=[[140,160],[226.5,170]];
  const r=renderSpec(s);
  assert.equal(pathOf(r.svg,'A','B'),'M 140,160 L 226.5,170');
  assert.ok(rules(r).includes('orthogonal'));
});
test('accepts a JSON string and parses it',()=>{
  assert.equal(renderSpec(JSON.stringify(baseSpec())).findings.length,0);
});

// ---- findings: each violation type, failing then passing ----
const finding=(r,rule,el)=>{const f=find(r,rule,el)[0];assert.ok(f,`expected ${rule} for ${el}; got ${rules(r)}`);
  for(const k of ['id','severity','rule','elements','region','measured','threshold','suggestion'])assert.ok(f[k]!==undefined,`${rule}.${k}`);
  assert.ok(['blocking','minor'].includes(f.severity));assert.ok(Array.isArray(f.elements));return f};

test('finding: non-orthogonal segment',()=>{
  const s=baseSpec();s.edges[0].points=[[140,160],[226.5,170]];
  const f=finding(renderSpec(s),'orthogonal','e1');
  assert.match(f.measured,/dx=86\.5.*dy=10/);assert.match(f.suggestion,/corner/i);
});
test('finding: endpoint off the target face and off the source face',()=>{
  let s=baseSpec();s.edges[0].points=[[140,160],[200,160]];
  let f=finding(renderSpec(s),'endpoint-on-face','e1');assert.match(f.measured,/end.*B.*outline/i);
  s=baseSpec();s.edges[0].points=[[150,160],[226.5,160]];
  f=finding(renderSpec(s),'endpoint-on-face','e1');assert.match(f.measured,/start.*A/i);
});
test('finding: a decision tip endpoint at the nominal vertex is off the filleted outline, with the exact point suggested',()=>{
  const s=baseSpec();s.edges[0].points=[[140,160],[222,160]];
  const f=finding(renderSpec(s),'endpoint-on-face','e1');
  assert.match(f.suggestion,/226\.5/);
});
test('finding: leaving a face sideways (not perpendicular)',()=>{
  const s=baseSpec();s.edges[2].points=[[330,209.83],[400,209.83],[400,312],[540,312]];
  const r=renderSpec(s);const f=finding(r,'port-direction','e3');assert.match(f.measured,/B/);
});
test('finding: final leg shorter than rule 13 (fillet 5 + arrowhead 10 + shaft 8 = 23); 23 passes',()=>{
  let s=baseSpec();s.nodes[3].rect=[347.9,280,120,64];s.edges[2].points=[[330,209.83],[330,312],[347.9,312]];
  const f=finding(renderSpec(s),'final-leg','e3');
  assert.match(f.measured,/17\.9/);assert.match(f.threshold,/23/);
  s=baseSpec();s.nodes[3].rect=[353,280,120,64];s.edges[2].points=[[330,209.83],[330,312],[353,312]];
  assert.equal(find(renderSpec(s),'final-leg').length,0);
});
test('finding: a route without bends needs a final leg of only 18',()=>{
  let s=baseSpec();s.nodes[0].rect=[20,128,206.4,64]; // right face at 226.4: leg of 0.1 into B
  s.edges[0].points=[[226.4,160],[226.5,160]];
  const f=finding(renderSpec(s),'final-leg','e1');assert.match(f.threshold,/18/);
  s=baseSpec();s.nodes[0].rect=[20,128,188.5,64]; // right face at 208.5: leg of 18 into B
  s.edges[0].points=[[208.5,160],[226.5,160]];
  assert.equal(find(renderSpec(s),'final-leg').length,0);
});
test('finding: legs too short for r=5 fillets are drawn with a clamped fillet and reported',()=>{
  const s=baseSpec();s.edges[2].points=[[330,209.83],[330,250],[336,250],[336,312],[540,312]];
  const r=renderSpec(s);const f=finding(r,'fillet-room','e3');assert.match(f.measured,/6/);assert.match(f.threshold,/10/);
  assert.ok(pathOf(r.svg,'B','D'));
});
test('finding: reversal and duplicate points are reported, not repaired',()=>{
  const s=baseSpec();s.edges[2].points=[[330,209.83],[330,260],[330,240],[330,312],[540,312]];
  assert.ok(find(renderSpec(s),'reversal','e3').length);
  const t=baseSpec();t.edges[0].points=[[140,160],[140,160],[226.5,160]];
  const r=renderSpec(t);assert.ok(find(r,'degenerate-route','e1').length);assert.equal(pathOf(r.svg,'A','B'),'M 140,160 L 226.5,160');
});
test('finding: node text too long for its labelBox (width and height)',()=>{
  let s=baseSpec();s.nodes[0].text=['Supercalifragilisticexpialidocious_unbreakable_word'];
  let f=finding(renderSpec(s),'text-fit','A');assert.match(f.measured,/width/i);
  s=baseSpec();s.nodes[0].text='one two three four five six seven eight nine ten eleven';
  f=finding(renderSpec(s),'text-fit','A');assert.match(f.measured,/height|lines/i);assert.match(f.suggestion,/tier|taller|larger/i);
  s=baseSpec();s.nodes[0].tier=undefined;s.nodes[0].rect=[20,100,120,120];s.nodes[0].text='one two three four five six';
  assert.equal(find(renderSpec(s),'text-fit','A').length,0);
});
test('string text is wrapped inside the labelBox; array text is kept exactly',()=>{
  const s=baseSpec();s.nodes[0].rect=[20,100,224,128];s.nodes[0].text='alpha beta gamma delta epsilon zeta';
  const r=renderSpec(s);
  const lines=[...r.svg.matchAll(/<g data-node="A"[\s\S]*?<\/g>/g)][0][0].match(/<text /g).length;
  assert.ok(lines>=2);
  const t=baseSpec();t.nodes[0].text=['Start','here'];
  assert.equal([...renderSpec(t).svg.matchAll(/<g data-node="A"[\s\S]*?<\/g>/g)][0][0].match(/<text /g).length,2);
});
test('finding: parallel straight spans closer than 10 (9 fails, 10 passes)',()=>{
  const two=gap=>({canvas:{w:700,h:300},palette:{p:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Step'}},
    nodes:[{id:'P',shape:'rect',rect:[20,80,120,160],text:'P',role:'p'},{id:'Q',shape:'rect',rect:[400,80,120,160],text:'Q',role:'p'}],
    edges:[{id:'x',source:'P',target:'Q',points:[[140,140],[400,140]]},{id:'y',source:'P',target:'Q',points:[[140,140+gap],[400,140+gap]]}]});
  const f=finding(renderSpec(two(9)),'parallel-clearance','x');assert.ok(f.elements.includes('y'));assert.match(f.measured,/9/);assert.match(f.threshold,/10/);
  assert.equal(find(renderSpec(two(10)),'parallel-clearance').length,0);
});
test('finding: connector crossing between two logical relationships',()=>{
  const s={canvas:{w:700,h:400},palette:{p:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Step'}},
    nodes:[{id:'P1',shape:'rect',rect:[20,120,120,64],text:'P1',role:'p'},{id:'P2',shape:'rect',rect:[400,120,120,64],text:'P2',role:'p'},
      {id:'Q1',shape:'rect',rect:[210,20,120,64],text:'Q1',role:'p'},{id:'Q2',shape:'rect',rect:[210,260,120,64],text:'Q2',role:'p'}],
    edges:[{id:'h',source:'P1',target:'P2',points:[[140,152],[400,152]]},{id:'v',source:'Q1',target:'Q2',points:[[270,84],[270,260]]}]};
  const f=finding(renderSpec(s),'crossing','h');assert.ok(f.elements.includes('v'));assert.match(f.measured,/270.*152/);
});
test('finding: route through an unrelated node',()=>{
  const s=baseSpec();s.nodes.push({id:'E',shape:'rect',rect:[420,300,60,50],text:'E',role:'step'});
  s.edges[2].points=[[330,209.83],[330,325],[540,325]];s.nodes[3].rect=[540,293,120,64];
  const f=finding(renderSpec(s),'node-intrusion','e3');assert.ok(f.elements.includes('E'));
});
test('finding: node overlap',()=>{
  const s=baseSpec();s.nodes[3].rect=[540,190,120,64];
  assert.ok(find(renderSpec(s),'node-overlap').length);
});
const groupSpec=()=>{const s=baseSpec();s.groups=[{id:'G1',label:'Left',rect:[10,80,440,170]}];
  s.nodes[0].group='G1';s.nodes[1].group='G1';return s};
test('groups: membership, heading clearance and unrelated-container transit',()=>{
  const ok=renderSpec(groupSpec());
  assert.deepEqual(ok.findings,[],JSON.stringify(ok.findings));
  assert.match(ok.svg,/<g data-group="G1" data-container-id="G1">/);
  let s=groupSpec();s.groups[0].rect=[10,80,300,170]; // B no longer inside
  assert.ok(find(renderSpec(s),'group-membership','B').length);
  s=groupSpec();s.nodes[2].group='G1'; // declared member drawn outside
  assert.ok(find(renderSpec(s),'group-membership','C').length);
  s=groupSpec();s.groups.push({id:'G2',label:'Mid',rect:[460,110,60,100]});
  assert.ok(find(renderSpec(s),'group-transit','e2').length);
  const h={canvas:{w:600,h:320},palette:{p:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Step'}},
    groups:[{id:'G',label:'Group heading text',rect:[10,20,520,260]}],
    nodes:[{id:'P',group:'G',shape:'rect',rect:[20,100,120,64],text:'P',role:'p'},{id:'Q',group:'G',shape:'rect',rect:[360,100,120,64],text:'Q',role:'p'}],
    edges:[{source:'P',target:'Q',points:[[80,100],[80,44],[420,44],[420,100]]}]};
  assert.ok(find(renderSpec(h),'heading-intrusion','e1').length);
  h.edges[0].points=[[140,132],[360,132]];
  assert.equal(find(renderSpec(h),'heading-intrusion').length,0);
});
test('finding: edge label touching a node outline or sitting on another route; detached label',()=>{
  let s=baseSpec();s.edges[1].label={text:'Yes',x:540,y:160};
  assert.ok(find(renderSpec(s),'label-clearance','e2').length);
  s=baseSpec();s.edges[1].label={text:'Yes',x:487,y:312}; // on the B->D route
  assert.ok(find(renderSpec(s),'label-on-route','e2').length||find(renderSpec(s),'label-detached','e2').length);
  s=baseSpec();s.edges[1].label={text:'Yes',x:487,y:60};
  const f=finding(renderSpec(s),'label-detached','e2');assert.equal(f.severity,'minor');
});
test('finding: contrast below 4.5:1 and elements outside the canvas',()=>{
  let s=baseSpec();s.palette.step.text='#e0eaf5';
  assert.ok(find(renderSpec(s),'contrast').length);
  s=baseSpec();s.nodes[2].centre=[900,160];s.edges[1].points=[[433.5,160],[840,160]];
  assert.ok(find(renderSpec(s),'out-of-canvas','C').length);
});
test('finding: explicit labelBox outside its shape',()=>{
  const s=baseSpec();s.nodes[1].labelBox=[200,100,200,80];
  assert.ok(find(renderSpec(s),'label-box','B').length);
});

test('census findings compare against the parsed source model when supplied',async()=>{
  const {parseMermaid}=await import('../src/parser.mjs');
  const model=parseMermaid(SOURCE);
  assert.deepEqual(renderSpec(baseSpec(),{model}).findings,[]);
  const s=baseSpec();s.edges.pop();s.nodes[0].text='Begin';s.nodes[3].id='Z';s.edges[0].dashed=true;
  s.edges[1].label.text='No';
  const r=renderSpec(s,{model});
  const c=find(r,'census').map(f=>f.measured).join('\n');
  assert.match(c,/missing relation B->D/);assert.match(c,/text .*A/);assert.match(c,/missing node D/);assert.match(c,/extra node Z/);assert.match(c,/A->B is dashed/);assert.match(c,/label.*B->C/);
});

// ---- schema errors: precise path + message, and nothing else fails ----
const errs=(s)=>{try{renderSpec(s);return []}catch(e){assert.ok(e instanceof SpecError,String(e));return e.errors}};
test('malformed JSON reports a position',()=>{
  const e=errs('{"canvas": {');assert.equal(e[0].path,'$');assert.match(e[0].message,/invalid JSON/);
});
test('schema errors name the path and what is wrong',()=>{
  let s=baseSpec();delete s.canvas.w;assert.deepEqual(errs(s).map(e=>e.path),['canvas.w']);assert.match(errs(s)[0].message,/number/);
  s=baseSpec();s.nodes[1].role='nope';let e=errs(s);assert.equal(e[0].path,'nodes[1].role');assert.match(e[0].message,/unknown palette role "nope".*step, data/);
  s=baseSpec();s.edges[0].source='Q';e=errs(s);assert.equal(e[0].path,'edges[0].source');assert.match(e[0].message,/unknown node "Q"/);
  s=baseSpec();s.edges[0].points[1]=[1];e=errs(s);assert.equal(e[0].path,'edges[0].points[1]');assert.match(e[0].message,/\[x, y\]/);
  s=baseSpec();s.edges[0].points=[[1,1]];e=errs(s);assert.equal(e[0].path,'edges[0].points');assert.match(e[0].message,/at least 2/);
  s=baseSpec();s.nodes[0].colour='red';e=errs(s);assert.equal(e[0].path,'nodes[0].colour');assert.match(e[0].message,/not a recognised key/);
  s=baseSpec();delete s.nodes[0].rect;e=errs(s);assert.equal(e[0].path,'nodes[0]');assert.match(e[0].message,/rect.*centre/);
  s=baseSpec();s.nodes[1].tier='XXL';e=errs(s);assert.equal(e[0].path,'nodes[1].tier');assert.match(e[0].message,/S, M, L, XL/);
  s=baseSpec();s.nodes[0].shape='blob';e=errs(s);assert.equal(e[0].path,'nodes[0].shape');
  s=baseSpec();s.palette.step.fill='blue';e=errs(s);assert.equal(e[0].path,'palette.step.fill');assert.match(e[0].message,/#rrggbb/);
  s=baseSpec();s.palette.step.meaning='';e=errs(s);assert.equal(e[0].path,'palette.step.meaning');
  s=baseSpec();s.nodes.push({...s.nodes[0]});e=errs(s);assert.equal(e[0].path,'nodes[4].id');assert.match(e[0].message,/duplicate/);
  s=baseSpec();s.edges[1].label={text:'Yes',x:'a',y:1};e=errs(s);assert.equal(e[0].path,'edges[1].label.x');
});
test('several schema errors are reported together',()=>{
  const s=baseSpec();delete s.canvas.w;s.nodes[1].role='nope';
  assert.equal(validateSpec(s).length,2);
});

// ---- the independent auditor on a spec-rendered SVG ----
test('a spec-rendered synthetic SVG passes relations, relationStyle, textFit, labelClearance, markers, shaft and routes in the independent audit',
  {skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
    const r=renderSpec(baseSpec());
    const result=await auditAgentSvg(SOURCE,Buffer.from(r.svg));
    for(const id of ['nodeIdentity','nodeText','relations','relationStyle','textFit','labelClearance','markerDrawing','arrowShaft','routeNodeIntrusion','routePairClearance','routeCrossings'])
      assert.equal(result.checks[id].status,'PASS',`${id}: ${JSON.stringify(result.checks[id].evidence)}`);
  });
test('a spec with groups passes group identity and membership in the audit',
  {skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
    const src='flowchart LR\n  subgraph G1["Left"]\n    A[Start]\n    B{Ready}\n  end\n  C[(Store)]\n  A --> B\n  B -- "Yes" --> C\n';
    const s=groupSpec();s.nodes.pop();s.edges.pop();
    const r=renderSpec(s);
    const result=await auditAgentSvg(src,Buffer.from(r.svg));
    for(const id of ['groups','groupMembership','textFit','labelClearance'])assert.equal(result.checks[id].status,'PASS',`${id}: ${JSON.stringify(result.checks[id].evidence)}`);
  });

// ---- shared trunk (rule 10): optional edge.trunk, same contract as the auditor ----
const trunkSpec=(t1,t2,e2End=[500,142])=>({
  canvas:{w:700,h:300,title:'Synthetic trunk',desc:'Two synthetic sources converging.'},
  palette:{step:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Process step'}},
  nodes:[{id:'S1',shape:'rect',rect:[20,20,120,64],text:'One',role:'step'},{id:'S2',shape:'rect',rect:[20,200,120,64],text:'Two',role:'step'},{id:'T',shape:'rect',rect:[500,110,120,64],text:'Target',role:'step'}],
  edges:[{id:'e1',source:'S1',target:'T',...(t1?{trunk:t1}:{}),points:[[140,52],[300,52],[300,142],[500,142]]},
         {id:'e2',source:'S2',target:'T',...(t2?{trunk:t2}:{}),points:[[140,232],[300,232],[300,142],e2End]}],
  legend:{x:20,y:120,entries:[{kind:'node',role:'step',label:'Process step'}]}});

test('undeclared coincident final legs still raise parallel-clearance',()=>{
  const r=renderSpec(trunkSpec());
  assert.equal(find(r,'parallel-clearance').length,1,JSON.stringify(r.findings));
});

test('a declared trunk with one id on same-target connectors is accepted and tagged in the SVG',()=>{
  const r=renderSpec(trunkSpec('t1','t1'));
  assert.equal(find(r,'parallel-clearance').length,0,JSON.stringify(r.findings));
  assert.equal((r.svg.match(/data-shared-trunk="t1"/g)||[]).length,2);
});

test('mismatched trunk ids or a missing id still raise parallel-clearance',()=>{
  assert.equal(find(renderSpec(trunkSpec('t1','t2')),'parallel-clearance').length,1);
  assert.equal(find(renderSpec(trunkSpec('t1',null)),'parallel-clearance').length,1);
});

test('trunk must be a non-empty string',()=>{
  const s=trunkSpec('t1','t1');s.edges[0].trunk=5;
  assert.throws(()=>renderSpec(s),SpecError);
});

const sameSide=()=>{const s=trunkSpec('t1','t1');s.nodes[1].rect=[20,90,120,40];s.edges[1].points=[[140,110],[250,110],[250,142],[500,142]];return s};
test('a spec-rendered same-side trunk passes the independent auditor',{skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
  const r=renderSpec(sameSide());
  const a=await auditAgentSvg('flowchart LR\n S1[One] --> T[Target]\n S2[Two] --> T\n',r.svg);
  assert.equal(a.checks.routePairClearance.status,'PASS',JSON.stringify(a.checks.routePairClearance.evidence));
  assert.equal(a.checks.routePairClearance.evidence.trunks[0].id,'t1');
});
test('a spec-rendered opposite-side trunk is rejected by the independent auditor',{skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
  const r=renderSpec(trunkSpec('t1','t1'));
  const a=await auditAgentSvg('flowchart LR\n S1[One] --> T[Target]\n S2[Two] --> T\n',r.svg);
  assert.equal(a.checks.routePairClearance.status,'FAIL');
  assert.deepEqual(a.checks.routePairClearance.evidence.violations.map(v=>v.kind),['opposite-side merge']);
});

// ---- inset 8 and the font-fill rule ----
const nodeG=(svg,id)=>new RegExp(`<g data-node="${id}"[\\s\\S]*?</g>`).exec(svg)[0];
const fontsOf=(svg,id)=>[...nodeG(svg,id).matchAll(/font-size="([\d.]+)"/g)].map(m=>Number(m[1]));
const fillSpec=nodes=>({canvas:{w:900,h:400},palette:{step:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Process step'},data:{fill:'#e9f7ef',stroke:'#1e7a46',text:'#14432a',meaning:'Data store'}},nodes,edges:[]});

test('rectangle and capsule labelBox inset is 8: a tier node is the tier plus 16 and its labelBox is exactly the tier',()=>{
  const r=renderSpec(fillSpec([{id:'A',shape:'rect',centre:[200,100],tier:'M',text:'Start',role:'step'},{id:'B',shape:'capsule',centre:[500,100],tier:'S',text:'End',role:'step'},{id:'C',shape:'rect',rect:[20,200,120,64],text:'Hi',role:'step'}]));
  assert.match(nodeG(r.svg,'A'),/<rect x="92" y="52" width="216" height="96"/);
  assert.match(nodeG(r.svg,'A'),/data-label-box="100 60 200 80"/);
  assert.match(nodeG(r.svg,'B'),/width="112" height="56"/);
  assert.match(nodeG(r.svg,'B'),/data-label-box="452 80 96 40"/);
  assert.match(nodeG(r.svg,'C'),/data-label-box="28 208 104 48"/); // an explicit rect keeps its size; the labelBox grows to inset 8
});
test('decision, hexagon and the other shapes keep their previous insets',()=>{
  const r=renderSpec(fillSpec([{id:'D',shape:'decision',centre:[200,150],tier:'S',text:'Ok',role:'step'},{id:'H',shape:'decision',centre:[500,150],tier:'M',text:'Ok',role:'step'},{id:'S',shape:'subroutine',centre:[200,320],tier:'S',text:'Ok',role:'step'}]));
  assert.match(nodeG(r.svg,'D'),/data-label-box="[\d. ]+ 96 40"/);
  assert.match(nodeG(r.svg,'H'),/data-label-box="400 110 200 80"/); // x+40, y+30 inside a (tier+80) x (tier+60) hexagon
  assert.match(nodeG(r.svg,'S'),/data-label-box="[\d.]+ [\d.]+ 96 40"/);
});
test('a node without a font gets the largest whole font (14 to 28) at which its text fits the labelBox',()=>{
  const r=renderSpec(fillSpec([{id:'A',shape:'rect',centre:[200,100],tier:'M',text:'Start',role:'step'},{id:'B',shape:'rect',centre:[500,100],tier:'S',text:'Fairly long label',role:'step'}]));
  assert.deepEqual(fontsOf(r.svg,'A'),[28]);
  const [b]=fontsOf(r.svg,'B');
  assert.ok(Number.isInteger(b)&&b>=14&&b<28,`B font ${b}`);
  assert.deepEqual(r.findings.filter(f=>f.rule==='text-fit'),[]);
  assert.ok(measureText('Fairly long label',b)>0);
});
test('comparable nodes (same tier, same role) share the smallest of their maxima; another role does not',()=>{
  const r=renderSpec(fillSpec([
    {id:'A',shape:'rect',centre:[150,100],tier:'M',text:'OK',role:'step'},
    {id:'B',shape:'rect',centre:[400,100],tier:'M',text:'A considerably longer label that needs several lines of text here',role:'step'},
    {id:'C',shape:'rect',centre:[650,100],tier:'M',text:'OK',role:'data'}]));
  const [a]=fontsOf(r.svg,'A'),[b]=fontsOf(r.svg,'B'),[c]=fontsOf(r.svg,'C');
  assert.equal(a,b);assert.ok(a<28);
  assert.equal(c,28);
});
test('an explicit font is kept and never joins the peer minimum',()=>{
  const r=renderSpec(fillSpec([{id:'A',shape:'rect',centre:[150,100],tier:'M',text:'OK',role:'step',font:16},{id:'B',shape:'rect',centre:[400,100],tier:'M',text:'OK',role:'step'}]));
  assert.deepEqual(fontsOf(r.svg,'A'),[16]);
  assert.deepEqual(fontsOf(r.svg,'B'),[28]);
});
test('node label text is tagged data-role="label"',()=>{
  const r=renderSpec(fillSpec([{id:'A',shape:'rect',centre:[150,100],tier:'M',text:'OK',role:'step'}]));
  assert.match(nodeG(r.svg,'A'),/<text [^>]*data-role="label"/);
});
