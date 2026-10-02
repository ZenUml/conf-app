// Measured geometry from the candidate SVG (browser getBBox / path sampling) and the deterministic early checks built on it.
// Numbers here feed two consumers: blocking early findings (label detachment, route-to-border clearance) and the reviewer's <geometry> block.
import {createRequire} from 'node:module';
import {makeFinding} from './findings.mjs';
const require=createRequire(import.meta.url);

export const LABEL_MAX_GAP=25;        // units between an edge label box and its own route
export const AMBIGUITY_MARGIN=1;      // a label must be more than 1 unit nearer its own route than any other, else ownership is ambiguous
export const ROUTE_MIN_CLEARANCE=12;  // units between a route and the border of an unrelated node/container

const round=v=>Math.round(v*10)/10;
const boxArr=b=>[b.x,b.y,b.w,b.h].map(v=>Math.round(v));
const edgeId=(s,t)=>`${s}->${t}`;

/** Euclidean distance from a point to a rect (0 inside or touching). */
export function rectDistance([x,y],r){
  const dx=Math.max(r.x-x,0,x-(r.x+r.w)),dy=Math.max(r.y-y,0,y-(r.y+r.h));
  return Math.hypot(dx,dy);
}
const strictlyInside=([x,y],r)=>x>r.x&&x<r.x+r.w&&y>r.y&&y<r.y+r.h;

/** Minimum distance between a rect and a sampled polyline (Infinity for an empty one). */
export function polylineGap(rect,points){
  let best=Infinity;
  for(const p of points){const d=rectDistance(p,rect);if(d<best)best=d;if(best===0)break}
  return best;
}

const containsBox=(outer,inner)=>inner.x>=outer.x-1&&inner.y>=outer.y-1&&inner.x+inner.w<=outer.x+outer.w+1&&inner.y+inner.h<=outer.y+outer.h+1;

function unrelatedBorders(g,edge){
  const ends=[edge.source,edge.target];
  const endBoxes=g.nodes.filter(n=>ends.includes(n.id)).map(n=>n.box);
  const nodes=g.nodes.filter(n=>!ends.includes(n.id)).map(n=>({id:n.id,kind:'node',box:n.box}));
  const groups=(g.groups??[]).filter(gr=>!endBoxes.some(b=>containsBox(gr.box,b))).map(gr=>({id:gr.id,kind:'group',box:gr.box}));
  return [...nodes,...groups];
}

const normText=t=>String(t??'').replace(/<br\s*\/?>/gi,' ').replace(/\s+/g,' ').trim();

/** Labels the checks can measure: those the author tagged with data-edge-label-source/target, plus untagged label groups whose text equals the
 *  label of exactly one source edge (and no other untagged group shares that text). The author's own ownership attributes are not trusted;
 *  ambiguous or unmatched text stays unresolved, so the edge's label is NOT-CHECKABLE rather than guessed. */
export function resolveLabels(g,model){
  const out=[...(g.labels??[])],tagged=new Set(out.map(l=>edgeId(l.source,l.target)));
  const untagged=(g.untaggedLabels??[]).map(l=>({text:normText(l.text),box:l.box})).filter(l=>l.text);
  const count=new Map();for(const l of untagged)count.set(l.text,(count.get(l.text)??0)+1);
  for(const l of untagged){
    if(count.get(l.text)!==1)continue;
    const owners=(model.edges??[]).filter(e=>normText(e.label)===l.text);
    if(owners.length!==1)continue;
    const id=edgeId(owners[0].source,owners[0].target);
    if(tagged.has(id))continue;
    out.push({source:owners[0].source,target:owners[0].target,box:l.box});tagged.add(id);
  }
  return out;
}

/** Per-label gap to its own route, and per-route nearest unrelated border (a route that enters an unrelated shape is an intrusion, which the auditor owns). */
export function geometryMeasurements(g,model){
  const byId=new Map(g.edges.map(e=>[e.id,e]));
  const labels=resolveLabels(g,model).map(l=>{const id=edgeId(l.source,l.target),e=byId.get(id);return {edge:id,box:l.box,gap:e?round(polylineGap(l.box,e.points)):null}});
  const clearances=g.edges.map(e=>{
    let nearest=null;
    for(const b of unrelatedBorders(g,e)){
      if(e.points.some(p=>strictlyInside(p,b.box)))continue; // the route enters it: that is an intrusion/transit, owned by the auditor
      let d=Infinity;
      for(const p of e.points){const x=rectDistance(p,b.box);if(x<d)d=x}
      if(d<Infinity&&(!nearest||d<nearest.dist))nearest={id:b.id,kind:b.kind,dist:round(d)};
    }
    return {edge:e.id,nearest};
  });
  return {labels,clearances};
}

/** Which measured-geometry checks could not run (they are then NOT-CHECKABLE, never PASS). geometry=null means measurement failed or was skipped. */
export function geometryNotCheckable(g,model){
  if(!g)return ['labelDetachment','routeBorderClearance'];
  const m=geometryMeasurements(g,model),out=[];
  const gaps=new Map(m.labels.filter(l=>l.gap!==null&&Number.isFinite(l.gap)).map(l=>[l.edge,l.gap]));
  if(model.edges.some(e=>e.label&&!gaps.has(edgeId(e.source,e.target))))out.push('labelDetachment');
  const routed=new Set(g.edges.filter(e=>e.points?.length).map(e=>e.id));
  if(model.edges.some(e=>!routed.has(edgeId(e.source,e.target))))out.push('routeBorderClearance');
  return out;
}

export function geometryFindings(g,model){
  const m=geometryMeasurements(g,model),out=[];
  for(const l of m.labels)if(l.gap!==null&&l.gap>LABEL_MAX_GAP)out.push(makeFinding({source:'early',severity:'blocking',rule:'label-detached',elements:[l.edge],
    evidence:{measured:`the label box is ${l.gap} units from its own route (${l.edge})`,threshold:`<= ${LABEL_MAX_GAP} units`},
    suggestion:`Move the label next to ${l.edge}'s own route (within ${LABEL_MAX_GAP} units, not nearer another edge).`}));
  // Ownership: a label nearer a different route than its own reads as that other edge's label (checked only for resolved labels; equal distances, e.g. a shared trunk, are not ambiguous).
  const byId=new Map(g.edges.map(e=>[e.id,e]));
  for(const l of m.labels){
    if(l.gap===null||!Number.isFinite(l.gap))continue;
    let other=null;
    for(const e of g.edges){if(e.id===l.edge||!e.points?.length)continue;const d=polylineGap(l.box,e.points);if(d<l.gap-AMBIGUITY_MARGIN&&(!other||d<other.gap))other={id:e.id,gap:round(d)}}
    if(other&&byId.has(l.edge))out.push(makeFinding({source:'early',severity:'blocking',rule:'label-ambiguous',elements:[l.edge,other.id],
      evidence:{measured:`the label of ${l.edge} is ${l.gap} units from its own route but ${other.gap} units from the route of ${other.id}`,threshold:'own route strictly nearer than every other route'},
      suggestion:`Move the label of ${l.edge} onto or beside its own route, clear of ${other.id}'s route.`}));
  }
  for(const c of m.clearances)if(c.nearest&&c.nearest.dist<ROUTE_MIN_CLEARANCE)out.push(makeFinding({source:'early',severity:'blocking',rule:'route-border-clearance',elements:[c.edge,c.nearest.id],
    evidence:{measured:`${c.edge} passes ${c.nearest.dist} units from the border of unrelated ${c.nearest.kind} ${c.nearest.id}`,threshold:`>= ${ROUTE_MIN_CLEARANCE} units`},
    suggestion:`Move ${c.edge}'s route (or the ${c.nearest.kind}) so the clearance is at least ${ROUTE_MIN_CLEARANCE} units.`}));
  return out;
}

function simplify(points){
  if(points.length<3)return points.map(p=>p.map(round));
  const out=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const a=out.at(-1),b=points[i],c=points[i+1];
    if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>1e-6)out.push(b);
  }
  out.push(points.at(-1));
  return out.map(p=>p.map(round));
}

/** Compact coordinates plus the measurements above, as data for the reviewer prompt. Every id here was read from author-written SVG
 *  attributes, so only ids the source declares (nodes, groups, source->target edges) are passed on; anything else is dropped. */
export function geometryForReviewer(g,model){
  const m=geometryMeasurements(g,model),clear=new Map(m.clearances.map(c=>[c.edge,c.nearest]));
  const gap=new Map(m.labels.map(l=>[l.edge,l.gap]));
  const nodeIds=new Set(model.nodes.map(n=>n.id)),groupIds=new Set((model.groups??[]).map(x=>x.id)),edgeIds=new Set(model.edges.map(e=>edgeId(e.source,e.target)));
  const nearest=n=>n&&(n.kind==='node'?nodeIds:groupIds).has(n.id)?n:null;
  return {units:'SVG user units, origin top-left, measured by code from the candidate SVG',canvas:g.natural,
    nodes:g.nodes.filter(n=>nodeIds.has(n.id)).map(n=>({id:n.id,box:boxArr(n.box)})),groups:(g.groups??[]).filter(x=>groupIds.has(x.id)).map(x=>({id:x.id,box:boxArr(x.box)})),
    labels:resolveLabels(g,model).filter(l=>edgeIds.has(edgeId(l.source,l.target))).map(l=>({edge:edgeId(l.source,l.target),box:boxArr(l.box),gapToOwnEdge:gap.get(edgeId(l.source,l.target))})),
    routes:g.edges.filter(e=>edgeIds.has(e.id)).map(e=>{const vertices=simplify(e.points);return {edge:e.id,vertices,manhattanLength:round(vertices.slice(1).reduce((n,p,i)=>n+Math.abs(p[0]-vertices[i][0])+Math.abs(p[1]-vertices[i][1]),0)),nearestUnrelated:nearest(clear.get(e.id)??null)}})};
}

/** Browser measurement of the candidate SVG (same sandboxing as the auditor: JS disabled, network blocked). */
export async function collectGeometry(svgBytes,{playwrightModulePath=process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE,browserExecutablePath=process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}={}){
  let playwright;try{playwright=require(playwrightModulePath||'playwright')}catch{throw Error('PLAYWRIGHT_RUNTIME_UNAVAILABLE')}
  const browser=await playwright.chromium.launch({headless:true,...(browserExecutablePath?{executablePath:browserExecutablePath}:{})});
  try{
    const page=await browser.newPage({javaScriptEnabled:false});
    await page.route('**/*',route=>route.abort('blockedbyclient'));
    const raw=await page.evaluate(input=>{
      const doc=new DOMParser().parseFromString(input,'image/svg+xml');
      if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')return null;
      const root=document.importNode(doc.documentElement,true);document.body.appendChild(root);
      const view=root.viewBox.baseVal;
      const bb=el=>{const r=el.getBBox();return {x:r.x,y:r.y,w:r.width,h:r.height}};
      const union=els=>{const bs=els.map(bb);if(!bs.length)return null;const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y)),x2=Math.max(...bs.map(b=>b.x+b.w)),y2=Math.max(...bs.map(b=>b.y+b.h));return {x,y,w:x2-x,h:y2-y}};
      const shapes=g=>[...g.querySelectorAll('rect,path,ellipse,polygon,circle')].filter(s=>s instanceof SVGGeometryElement);
      const nodes=[...root.querySelectorAll('g[data-node],g[data-node-id]')].map(g=>({id:g.getAttribute('data-node')??g.getAttribute('data-node-id'),box:union(shapes(g))??bb(g)}));
      const groups=[...root.querySelectorAll('g[data-group],g[data-container-id],g[id^="group-"]')].map(g=>{const rect=g.querySelector(':scope > rect');return {id:g.getAttribute('data-group')??g.getAttribute('data-container-id')??g.id.slice(6),box:rect?bb(rect):bb(g)}});
      const labels=[...root.querySelectorAll('g[data-edge-label-source][data-edge-label-target]')].map(g=>({source:g.getAttribute('data-edge-label-source'),target:g.getAttribute('data-edge-label-target'),box:bb(g)}));
      const untaggedLabels=[...root.querySelectorAll('.edge-label,[data-owner-edge]')].filter(g=>!(g.hasAttribute('data-edge-label-source')&&g.hasAttribute('data-edge-label-target'))&&!g.parentElement?.closest('.edge-label,[data-owner-edge],[data-edge-label-source]')).map(g=>({text:(g.textContent||'').replace(/\s+/g,' ').trim(),box:bb(g)}));
      const edges=[...root.querySelectorAll('[data-source][data-target]')].filter(e=>e instanceof SVGGeometryElement).map(e=>{
        const len=e.getTotalLength(),step=Math.max(2,len/3000),points=[];
        for(let d=0;d<len;d+=step){const p=e.getPointAtLength(d);points.push([p.x,p.y])}
        const last=e.getPointAtLength(len);points.push([last.x,last.y]);
        return {source:e.getAttribute('data-source'),target:e.getAttribute('data-target'),points};
      });
      return {natural:{w:view?.width||root.getBoundingClientRect().width,h:view?.height||root.getBoundingClientRect().height},nodes,groups,labels,untaggedLabels,edges};
    },Buffer.from(svgBytes).toString('utf8'));
    if(!raw)throw Error('GEOMETRY_SVG_UNPARSEABLE');
    return {...raw,edges:raw.edges.map(e=>({...e,id:edgeId(e.source,e.target)}))};
  }finally{await browser.close()}
}
