import fs from 'node:fs';
import {collectArrowEndStartFacts,checkArrowEndStartClearance} from './arrow-end-start.mjs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {parseMermaid,NOT_CHECKABLE_SHAPES} from './parser.mjs';
import {checkRouteLowerBend,attachCrossingRepairHints} from './route-lower-bend.mjs';
import {attachNodeMoveHints} from './node-move-hints.mjs';
import {checkRouteContainerClearance} from './route-clearance.mjs';
import {GROUP_SELECTOR} from './svg-selectors.mjs';
import {checkNodeHeadingClearance} from './node-heading-clearance.mjs';
import {resolveLabels} from './geometry.mjs';
import {collectLayoutFacts,layoutChecks,layoutChecksUnavailable} from './layout-checks.mjs';
import {denseInfo,denseRelationThreshold} from './dense.mjs';
import {isAcceptedTrunkOverlap,summariseTrunks,checkTrunkSemantics,unrecognisedTrunkAttributes,TRUNK_HINT} from './trunk.mjs';

const require=createRequire(import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const norm=value=>String(value??'').replace(/<br\s*\/?\s*>/gi,' ').replace(/\s+/g,' ').trim();
const multiset=items=>{const m=new Map();for(const x of items)m.set(x,(m.get(x)??0)+1);return m};
const equalSets=(a,b)=>a.size===b.size&&[...a].every(([k,v])=>b.get(k)===v);
const eps=1e-6;

// Read the SVG path itself, never the agent's optional waypoint metadata.
// Curves consume their endpoint but do not count as straight centerline spans.
function actualStraightSpans(d){
  const tokens=[];let at=0;
  const token=/\s*,?\s*([MLQA]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;
  while(at<d.length){if(!d.slice(at).trim())break;token.lastIndex=at;const m=token.exec(d);if(!m)return null;tokens.push(m[1]);at=token.lastIndex}
  const spans=[];let point=null,lastCommand=null,pending=null,endDir=null;
  const unitDir=(from,to)=>{const dx=to[0]-from[0],dy=to[1]-from[1],l=Math.hypot(dx,dy);return l>eps?[dx/l,dy/l]:null};
  for(let i=0;i<tokens.length;){
    const command=tokens[i++],arity={M:2,L:2,Q:4,A:7}[command];
    lastCommand=command;
    if(!arity||i+arity>tokens.length)return null;
    const args=tokens.slice(i,i+arity).map(Number);i+=arity;
    if(!args.every(Number.isFinite))return null;
    const next=command==='A'?[args[5],args[6]]:[args.at(-2),args.at(-1)];
    if(command==='M'){point=next;pending=null;endDir=null;continue}
    if(!point)return null;
    // Direction at the drawn end (where marker-end sits): a line's own direction, a quadratic's end tangent, unknown after an arc.
    endDir=command==='L'?unitDir(point,next)??endDir:command==='Q'?unitDir([args[0],args[1]],next)??unitDir(point,next):null;
    // A fillet's control point is the logical corner of the straight span before it.
    if(command==='Q'&&pending)pending.corner=pending.axis==='h'?args[0]:args[1];
    pending=null;
    if(command==='L'){
      const axis=Math.abs(point[1]-next[1])<eps?'h':Math.abs(point[0]-next[0])<eps?'v':null;
      if(!axis)return null;
      const lo=axis==='h'?Math.min(point[0],next[0]):Math.min(point[1],next[1]);
      const hi=axis==='h'?Math.max(point[0],next[0]):Math.max(point[1],next[1]);
      if(hi-lo>eps){
        const start=axis==='h'?point[0]:point[1],end=axis==='h'?next[0]:next[1];
        spans.push(pending={axis,fixed:axis==='h'?point[1]:point[0],lo,hi,length:hi-lo,start,end,dir:Math.sign(end-start),corner:end});
      }
    }
    point=next;
  }
  spans.lastCommand=lastCommand;
  spans.endPoint=point;
  spans.endDir=endDir;
  return spans;
}

// Conservative envelopes: a quadratic stays in its control-point hull; a
// supported circular arc stays within two radii of either endpoint. An
// overlapping envelope is unknown, never evidence that the curve intrudes.
function actualCurveEnvelopes(d){
  const tokens=[];let at=0;
  const token=/\s*,?\s*([MLQA]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;
  while(at<d.length){if(!d.slice(at).trim())break;token.lastIndex=at;const m=token.exec(d);if(!m)return null;tokens.push(m[1]);at=token.lastIndex}
  const curves=[];let point=null;
  for(let i=0;i<tokens.length;){
    const command=tokens[i++],arity={M:2,L:2,Q:4,A:7}[command];
    if(!arity||i+arity>tokens.length)return null;
    const a=tokens.slice(i,i+arity).map(Number);i+=arity;
    if(!a.every(Number.isFinite))return null;
    const next=command==='A'?[a[5],a[6]]:[a.at(-2),a.at(-1)];
    if(command==='M'){point=next;continue}
    if(!point)return null;
    if(command==='Q'){
      const xs=[point[0],a[0],next[0]],ys=[point[1],a[1],next[1]];
      curves.push({x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)});
    }
    if(command==='A'){
      const [rx,ry,rotation,large,sweep]=a;
      if(rx<=0||Math.abs(rx-ry)>eps||Math.abs(rotation)>eps||large!==0||![0,1].includes(sweep)||Math.hypot(next[0]-point[0],next[1]-point[1])>2*rx+eps)return null;
      const xs=[point[0],next[0]],ys=[point[1],next[1]],pad=2*rx;
      curves.push({x:Math.min(...xs)-pad,y:Math.min(...ys)-pad,w:Math.max(...xs)-Math.min(...xs)+2*pad,h:Math.max(...ys)-Math.min(...ys)+2*pad});
    }
    point=next;
  }
  return curves;
}


// A user adjudication of a declared-vs-rendered membership conflict. It is bound to the exact source bytes and never upgrades a check to PASS.
const wellFormedAdjudication=r=>r&&typeof r==='object'&&typeof r.nodeId==='string'&&r.nodeId&&['declaredGroup','renderedGroup','chosenGroup'].every(k=>r[k]===null||typeof r[k]==='string')&&typeof r.authorisedBy==='string'&&r.authorisedBy.trim()&&typeof r.timestamp==='string'&&Number.isFinite(Date.parse(r.timestamp))&&/^[a-f0-9]{64}$/.test(r.sourceHash);

/** Audit model bindings in an independently authored SVG without requiring the old renderer schema.
 * No PASS here implies an optimal route, appropriate palette meaning, or good visual quality.
 */
const rootViewBox=text=>{const m=/<svg\b[^>]*?\sviewBox\s*=\s*["']([^"']+)["']/i.exec(text??''),n=m?.[1].trim().split(/[\s,]+/).map(Number);return n?.length===4&&n.every(Number.isFinite)?{x:n[0],y:n[1],w:n[2],h:n[3]}:null};
export async function auditAgentSvg(source,svg,{originalSvg=null,playwrightModulePath=process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE,browserExecutablePath=process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE,adjudications=[],timing=false,prefilter=true}={}){
  const wall=performance.now(),timings={},timed=(name,fn)=>{const t=performance.now();try{return fn()}finally{timings[name]=(timings[name]??0)+performance.now()-t}};
  const adjudicationList=(Array.isArray(adjudications)?adjudications:[adjudications]).filter(r=>r!=null);
  const sourceBytes=Buffer.isBuffer(source)?source:Buffer.from(source,'utf8');
  const sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(sourceBytes);
  if(!Buffer.from(sourceText,'utf8').equals(sourceBytes))throw Error('SOURCE_NOT_EXACT_UTF8');
  const svgBytes=Buffer.isBuffer(svg)?svg:Buffer.from(svg,'utf8');
  if(svgBytes.length===0||svgBytes.length>2_000_000)throw Error('SVG_SIZE_LIMIT');
  const svgText=new TextDecoder('utf-8',{fatal:true}).decode(svgBytes);
  if(/<\s*(?:script|foreignObject|iframe|image)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=/i.test(svgText))throw Error('SVG_ACTIVE_CONTENT_UNSUPPORTED');
  let model=null,modelError=null;
  try{model=parseMermaid(sourceText)}catch(error){modelError=String(error?.message??error)}
  let playwright;try{playwright=require(playwrightModulePath||'playwright')}catch{throw Error('PLAYWRIGHT_RUNTIME_UNAVAILABLE')}
  const browser=await playwright.chromium.launch({headless:true,...(browserExecutablePath?{executablePath:browserExecutablePath}:{})});
  let drawn,layoutFacts=null,originalDrawn=null,originalSvgHash=null,arrowEndStartClearance=null;
  try{
    const page=await browser.newPage({javaScriptEnabled:false});
    await page.route('**/*',route=>route.abort('blockedbyclient'));
    const evalStart=performance.now();
    drawn=await page.evaluate(([input,GROUP,PREFILTER])=>{
      // Optional per-section timing (browser side); reported only when auditAgentSvg is called with {timing:true}.
      const T={};let tl=performance.now();const lap=name=>{const t=performance.now();T[name]=(T[name]??0)+t-tl;tl=t};
      const doc=new DOMParser().parseFromString(input,'image/svg+xml');
      if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')return {parseError:true};
      const root=document.importNode(doc.documentElement,true);
      document.body.appendChild(root);
      const box=el=>{const r=el.getBBox();return {x:r.x,y:r.y,w:r.width,h:r.height}};
      const nodes=[...root.querySelectorAll('g[data-node],g[data-node-id]')].map(el=>({id:el.getAttribute('data-node')??el.getAttribute('data-node-id'),text:[...el.querySelectorAll('text')].map(t=>t.textContent).join(' '),shapeCount:el.querySelectorAll('rect,path,ellipse,polygon').length,box:box(el)}));
      // Bounding-box prefilter (sound, never changes a result): a point outside a shape's local bbox is outside its fill, so isPointInFill is skipped.
      const BBOX_EPS=1e-3,bboxOf=shape=>{const r=shape.getBBox();return [r.x,r.y,r.x+r.width,r.y+r.height]};
      const nodeShapes=new Map([...root.querySelectorAll('g[data-node],g[data-node-id]')].map(el=>[el.getAttribute('data-node')??el.getAttribute('data-node-id'),[...el.querySelectorAll('rect,path,ellipse,polygon')].filter(shape=>shape instanceof SVGGeometryElement&&getComputedStyle(shape).fill!=='none')]));
      const headingBoxes=[...root.querySelectorAll(GROUP)].flatMap(group=>[...group.querySelectorAll(':scope > text')].map(text=>({groupId:group.getAttribute('data-group')??group.getAttribute('data-container-id')??group.id?.slice(6),box:box(text)})));
      const nodeBoxes=new Map();
      // Text boxes per node (same local coordinates as the sampled path points): the relaxed gate blocks a route only where it crosses node text.
      const nodeTexts=new Map([...root.querySelectorAll('g[data-node],g[data-node-id]')].map(el=>[el.getAttribute('data-node')??el.getAttribute('data-node-id'),[...el.querySelectorAll('text')].map(t=>box(t))]));
      const within=(p,r)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;
      const edges=[...root.querySelectorAll('[data-source][data-target]')].map(el=>{
        const source=el.getAttribute('data-source'),target=el.getAttribute('data-target');
        const result={source,target,sourceKind:el.getAttribute('data-source-kind'),targetKind:el.getAttribute('data-target-kind'),tag:el.localName,path:el.getAttribute('d')??el.getAttribute('points')??'',marker:el.getAttribute('marker-end'),trunk:el.getAttribute('data-shared-trunk'),trunkLikeAttributes:[...el.attributes].filter(x=>/bus|trunk|merge|junction|shared/i.test(x.name)).map(x=>({name:x.name,value:x.value}))};
        const dash=getComputedStyle(el).strokeDasharray;
        result.style={dash:dash==='none'?'':dash.replace(/\s+/g,''),width:Number.parseFloat(getComputedStyle(el).strokeWidth),stroke:getComputedStyle(el).stroke};
        result.dashed=dash!=='none'&&(dash.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)??[]).some(value=>Number(value)>0);
        const markerId=/^url\(#([^()]+)\)$/.exec(result.marker??'')?.[1];
        const marker=markerId?root.querySelector(`marker#${CSS.escape(markerId)}`):null;
        const markerChildren=marker?[...marker.querySelectorAll('path,rect,ellipse,polygon,polyline,line')]:[];
        const markerShape=markerChildren.length===1?markerChildren[0]:null;
        const markerStyle=markerShape?getComputedStyle(markerShape):null;
        const markerBox=markerShape instanceof SVGGraphicsElement?markerShape.getBBox():null;
        const markerMatrix=markerShape instanceof SVGGraphicsElement?markerShape.getCTM():null;
        const markerDeterminant=markerMatrix?markerMatrix.a*markerMatrix.d-markerMatrix.b*markerMatrix.c:0;
        const edgeStroke=getComputedStyle(el).stroke;
        const refX=Number(marker?.getAttribute('refX'));
        const strokeWidth=Number.parseFloat(getComputedStyle(el).strokeWidth);
        const viewBox=marker?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
        const viewBoxUnit=viewBox?.length===4&&viewBox.every(Number.isFinite)&&Math.abs(viewBox[0])<1e-8&&Math.abs(viewBox[1])<1e-8&&Math.abs(viewBox[2]-Number(marker?.getAttribute('markerWidth')))<1e-8&&Math.abs(viewBox[3]-Number(marker?.getAttribute('markerHeight')))<1e-8;
        const markerScale=marker?.hasAttribute('viewBox')&&!viewBoxUnit?NaN:marker?.getAttribute('markerUnits')==='userSpaceOnUse'?1:strokeWidth;
        const axialLength=markerBox&&Number.isFinite(refX)&&Number.isFinite(markerScale)?Math.max(0,(refX-markerBox.x)*markerScale):null;
        // Head footprint around the path end, measured from the same marker box and scale: back/forward along the end direction, perpendicular extent beside it.
        const head=markerBox&&Number.isFinite(refX)&&Number.isFinite(markerScale)&&Number.isFinite(Number(marker?.getAttribute('refY')??0))?(()=>{const refY=Number(marker.getAttribute('refY')??0);return {back:Math.max(0,(refX-markerBox.x)*markerScale),forward:Math.max(0,(markerBox.x+markerBox.width-refX)*markerScale),perpLo:(markerBox.y-refY)*markerScale,perpHi:(markerBox.y+markerBox.height-refY)*markerScale}})():null;
        result.markerDrawing={found:!!marker,head,shapeCount:markerChildren.length,visible:!!markerStyle&&markerStyle.fill!=='none'&&markerStyle.fill!=='rgba(0, 0, 0, 0)'&&markerStyle.display!=='none'&&markerStyle.visibility==='visible'&&Number(markerStyle.opacity)>0&&!!markerBox&&markerBox.width>0&&markerBox.height>0&&Math.abs(markerDeterminant)>1e-8,colorMatches:!!markerStyle&&(markerStyle.fill===edgeStroke||markerStyle.fill==='context-stroke'),axialLength};
        if(!(el instanceof SVGGeometryElement))return result;
        const length=el.getTotalLength();
        const start=el.getPointAtLength(0),end=el.getPointAtLength(length);
        const touches=(id,point)=>nodeShapes.get(id)?.some(shape=>shape.isPointInStroke(point))??false;
        const intruded=new Set(),headingIntrusions=new Set(),textIntruded=new Set(),headingOverlaps=new Set();
        if(PREFILTER)for(const shapes of nodeShapes.values())for(const shape of shapes)if(!nodeBoxes.has(shape))nodeBoxes.set(shape,bboxOf(shape));
        const count=Math.min(10000,Math.max(1,Math.ceil(length/2)));
        for(let i=0;i<=count;i++){
          const at=length*i/count;
          const point=el.getPointAtLength(at);
          for(const [id,shapes] of nodeShapes){
            if((id===source&&at<8)||(id===target&&length-at<12))continue;
            if(shapes.some(shape=>{if(PREFILTER){const b=nodeBoxes.get(shape);if(point.x<b[0]-BBOX_EPS||point.x>b[2]+BBOX_EPS||point.y<b[1]-BBOX_EPS||point.y>b[3]+BBOX_EPS)return false}return shape.isPointInFill(point)})){intruded.add(id);if((nodeTexts.get(id)??[]).some(r=>within(point,r)))textIntruded.add(id)}
          }
          for(const heading of headingBoxes){const r=heading.box;if(point.x>=r.x-2&&point.x<=r.x+r.w+2&&point.y>=r.y-2&&point.y<=r.y+r.h+2){headingIntrusions.add(heading.groupId);if(within(point,r))headingOverlaps.add(heading.groupId)}}
        }
        result.geometry={length,step:length/count,startOnSource:touches(source,start),endOnTarget:touches(target,end),intrudedNodeIds:[...intruded],intrudedHeadingGroupIds:[...headingIntrusions],intrudedTextNodeIds:[...textIntruded],overlapHeadingGroupIds:[...headingOverlaps]};
        return result;
      });
      lap('browser.edgeSampling');
      const groups=[...root.querySelectorAll(GROUP)].map(el=>{const shape=el.querySelector(':scope > rect,:scope > path,:scope > polygon');return {id:el.getAttribute('data-group')??el.getAttribute('data-container-id')??el.getAttribute('id')?.slice(6),box:shape?box(shape):null,outline:shape?.localName,cornerRadius:shape?.localName==='rect'?Math.max(Number(shape.getAttribute('rx')||0),Number(shape.getAttribute('ry')||0)):null,nestedNodeIds:[...el.querySelectorAll('g[data-node],g[data-node-id]')].map(n=>n.getAttribute('data-node')??n.getAttribute('data-node-id'))}});
      // Geometry for textFit/labelClearance is measured in root user space so node transforms and the viewBox cannot change the 8-unit inset.
      const rootBox=el=>{
        const m=root.getScreenCTM().inverse().multiply(el.getScreenCTM()),r=el.getBBox();
        const pts=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
        const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
        return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),axisAligned:Math.abs(m.b)<1e-6&&Math.abs(m.c)<1e-6};
      };
      const union=boxes=>{const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y}};
      const shapeSelector='rect,path,ellipse,polygon,circle';
      const fitEls=[...root.querySelectorAll('g[data-node],g[data-node-id]')];
      const fitNodes=fitEls.map(el=>{
        const id=el.getAttribute('data-node')??el.getAttribute('data-node-id');
        // Only painted shapes form an outline; an invisible larger rect must not widen the inset box.
        const painted=shape=>{const st=getComputedStyle(shape);return st.display!=='none'&&st.visibility==='visible'&&(st.fill!=='none'||st.stroke!=='none')};
        const shapes=[...el.querySelectorAll(shapeSelector)].filter(painted),rects=shapes.filter(s=>s.localName==='rect').map(rootBox);
        const texts=[...el.querySelectorAll('text')].map(rootBox);
        const declared=el.getAttribute('data-label-box')?.trim().split(/[\s,]+/).map(Number);
        const labelBox=declared?.length===4&&declared.every(Number.isFinite)&&declared[2]>0&&declared[3]>0?{x:declared[0],y:declared[1],w:declared[2],h:declared[3]}:null;
        const result={id,texts,kind:'unsupported',reason:'no node shape'};
        if(!shapes.length)return result;
        if(!texts.length)return {...result,reason:'no text bound to the node'};
        if(rects.length===shapes.length){
          const outline=rects.sort((a,b)=>b.w*b.h-a.w*a.h)[0];
          return rects.every(r=>r.axisAligned)?{id,texts,kind:'rect',outline}:{...result,reason:'transformed rectangle'};
        }
        if(!labelBox)return {...result,reason:'non-rectangular shape without declared labelBox'};
        // Every labelBox corner must lie in a painted shape's fill (or stroke), not merely the shapes' bounding box: a diamond's bbox corners are outside the diamond.
        // Exact for convex outlines (diamond, hexagon, ellipse); a concave outline could still admit a box whose edge leaves the shape.
        const inShape=(x,y)=>shapes.some(shape=>{if(!(shape instanceof SVGGeometryElement))return false;const p=new DOMPoint(x,y).matrixTransform(root.getScreenCTM().inverse().multiply(shape.getScreenCTM()).inverse());return shape.isPointInFill(p)||shape.isPointInStroke(p)});
        const inside=[[labelBox.x,labelBox.y],[labelBox.x+labelBox.w,labelBox.y],[labelBox.x,labelBox.y+labelBox.h],[labelBox.x+labelBox.w,labelBox.y+labelBox.h]].every(([x,y])=>inShape(x,y));
        return inside?{id,texts,kind:'declared',labelBox}:{...result,reason:'declared labelBox lies outside its node shape'};
      });
      // T1/T2 structure: sample every painted outline and interior stroke (cylinder lid arcs, queue/subroutine bars, decision outline) in root user space.
      // Nothing is inferred from a label box: the text bboxes and the declared labelBox are measured against the drawn path geometry itself.
      const structureShapes='rect,path,ellipse,polygon,circle,line,polyline';
      const rectGap=(p,r)=>Math.hypot(Math.max(r.x-p.x,0,p.x-(r.x+r.w)),Math.max(r.y-p.y,0,p.y-(r.y+r.h)));
      // Smallest distance between two axis-aligned rectangles (a lower bound for any point of one to the other).
      const rectGapBoxes=(a,r)=>Math.hypot(Math.max(r.x-(a.x+a.w),0,a.x-(r.x+r.w)),Math.max(r.y-(a.y+a.h),0,a.y-(r.y+r.h)));
      fitNodes.forEach((result,i)=>{
        const el=fitEls[i];
        const structure={unknown:false,textGap:null,textStroke:null,labelBoxOverlap:null};
        result.structure=structure;
        if(!result.texts.length)return;
        // A declared box is judged against the drawn structure for every shape class (a queue is a rect plus bar lines, so its outline kind is 'rect').
        const decl=el.getAttribute('data-label-box')?.trim().split(/[\s,]+/).map(Number);
        const labelBox=result.kind==='declared'?result.labelBox:decl?.length===4&&decl.every(Number.isFinite)&&decl[2]>0&&decl[3]>0?{x:decl[0],y:decl[1],w:decl[2],h:decl[3]}:null;
        for(const shape of el.querySelectorAll(structureShapes)){
          const st=getComputedStyle(shape);
          if(st.display==='none'||st.visibility!=='visible')continue;
          const sw=st.stroke!=='none'?Number.parseFloat(st.strokeWidth)||0:0;
          if(st.stroke==='none'&&st.fill==='none')continue;
          if(!(shape instanceof SVGGeometryElement)){structure.unknown=true;continue}
          const total=shape.getTotalLength();
          if(!(total>0)||total>100000){structure.unknown=true;continue}
          const m=root.getScreenCTM().inverse().multiply(shape.getScreenCTM()),scale=Math.sqrt(Math.abs(m.a*m.d-m.b*m.c))||1,half=sw*scale/2;
          const step=Math.max(0.5,total/4000);
          // Prefilter: every sampled point lies in the shape's root bbox, so its gap to a text is at least the bbox-to-text gap; a shape that cannot beat the
          // current best (strictly) and whose bbox stays beyond the label box cannot change the outcome.
          if(PREFILTER&&structure.textGap!==null){
            const sb=rootBox(shape),slack=0.01+Math.abs(half)*1e-6;
            if([sb.x,sb.y,sb.w,sb.h].every(Number.isFinite)){
              let lower=Infinity;for(const t of result.texts)lower=Math.min(lower,rectGapBoxes(sb,t));
              if(lower-half-slack>=structure.textGap&&(!labelBox||structure.labelBoxOverlap||rectGapBoxes(sb,labelBox)-slack>half))continue;
            }
          }
          for(let at=0;at<=total+step/2;at+=step){
            const q=shape.getPointAtLength(Math.min(at,total)).matrixTransform(m);
            let g=Infinity;for(const t of result.texts)g=Math.min(g,rectGap(q,t));
            g-=half;
            if(structure.textGap===null||g<structure.textGap){structure.textGap=g;structure.textStroke=shape.localName}
            if(labelBox&&!structure.labelBoxOverlap&&rectGap(q,labelBox)<=half)structure.labelBoxOverlap={stroke:shape.localName,x:q.x,y:q.y};
          }
        }
      });
      lap('browser.textFitStructure');
      // labelFontFit facts: the texts tagged data-role="label" of each node, with their font size and box in root user space.
      const labelFacts=fitEls.map((el,i)=>{
        const id=fitNodes[i].id,all=[...el.querySelectorAll('text')],tagged=all.filter(t=>t.closest('[data-role]')?.getAttribute('data-role')==='label');
        return {id,textCount:all.length,labels:tagged.map(t=>{const m=root.getScreenCTM().inverse().multiply(t.getScreenCTM()),k=Math.sqrt(Math.abs(m.a*m.d-m.b*m.c))||1;return {size:Number.parseFloat(getComputedStyle(t).fontSize)*k,box:rootBox(t)}})};
      });
      // B5: an edge label is its text plus any background rect; outlines are node and container shape strokes.
      const labelEpsilon=0.5,sampleStep=0.5;
      const labelElements=[...root.querySelectorAll('g[data-edge-label-source][data-edge-label-target]')].map(el=>({source:el.getAttribute('data-edge-label-source'),target:el.getAttribute('data-edge-label-target'),label:`${el.getAttribute('data-edge-label-source')}->${el.getAttribute('data-edge-label-target')}`,parts:[...el.querySelectorAll('text,rect')].map(rootBox)})).filter(l=>l.parts.length);
      const outlineShapes=[
        ...[...root.querySelectorAll('g[data-node],g[data-node-id]')].flatMap(g=>[...g.querySelectorAll(shapeSelector)].map(shape=>({name:`node:${g.getAttribute('data-node')??g.getAttribute('data-node-id')}`,shape}))),
        ...[...root.querySelectorAll(GROUP)].flatMap(g=>[...g.querySelectorAll(':scope > rect,:scope > path,:scope > polygon')].map(shape=>({name:`group:${g.getAttribute('data-group')??g.getAttribute('data-container-id')??g.id?.slice(6)}`,shape})))
      ];
      const labelViolations=[],labelUnsupported=[],outlineFacts=new Map();
      for(const item of labelElements){
        const box=union(item.parts);
        for(const {name,shape} of outlineShapes){
          // Per-outline facts are label-independent; measured once per outline instead of once per label x outline pair.
          let facts=outlineFacts.get(shape);
          if(!facts){const style=getComputedStyle(shape);facts={style,sw:style.stroke!=='none'?Number.parseFloat(style.strokeWidth)||0:0,b:rootBox(shape)};outlineFacts.set(shape,facts)}
          const {style,sw,b}=facts,half=sw/2+labelEpsilon;
          const overlaps=(a,c)=>a.x<c.x+c.w&&a.x+a.w>c.x&&a.y<c.y+c.h&&a.y+a.h>c.y;
          let hit;
          if(shape.localName==='rect'&&b.axisAligned&&!Number(shape.getAttribute('rx')||0)&&!Number(shape.getAttribute('ry')||0)){
            const outer={x:b.x-half,y:b.y-half,w:b.w+2*half,h:b.h+2*half},inner={x:b.x+half,y:b.y+half,w:b.w-2*half,h:b.h-2*half};
            const insideInner=inner.w>0&&inner.h>0&&box.x>=inner.x&&box.y>=inner.y&&box.x+box.w<=inner.x+inner.w&&box.y+box.h<=inner.y+inner.h;
            // A label inside a container is in open space; a label inside a node box is not (B5: labels live in open space).
            hit=overlaps(box,outer)&&(!insideInner||name.startsWith('node:'));
          }else if(shape instanceof SVGGeometryElement){
            const cols=Math.ceil((box.w+2*labelEpsilon)/sampleStep),rows=Math.ceil((box.h+2*labelEpsilon)/sampleStep);
            if(cols*rows>400000){labelUnsupported.push({label:item.label,outline:name,reason:'label too large to sample'});continue}
            // Prefilter: the grid lies inside the label box grown by labelEpsilon+sampleStep; a hit needs a stroke point (within the stroke's reach of the
            // geometry bbox) or a fill point (inside the bbox). isPointInStroke ignores the stroke paint, so the raw stroke-width counts even for stroke:none.
            // Reach = half width * max(miterlimit,1.5) (miter tip / square cap), scaled to root space by an upper bound of the matrix norm. Skipped when the
            // bbox or matrix is not finite or the stroke is non-scaling.
            if(PREFILTER&&style.vectorEffect!=='non-scaling-stroke'){
              const cm=facts.cm??=root.getScreenCTM().inverse().multiply(shape.getScreenCTM());
              const reach=facts.reach??=(Number.parseFloat(style.strokeWidth)||0)/2*Math.max(Number.parseFloat(style.strokeMiterlimit)||4,1.5)*(Math.hypot(cm.a,cm.b)+Math.hypot(cm.c,cm.d))+1e-3;
              const pad=labelEpsilon+sampleStep+1e-3;
              if([b.x,b.y,b.w,b.h,box.x,box.y,box.w,box.h,reach].every(Number.isFinite)&&!overlaps({x:box.x-pad,y:box.y-pad,w:box.w+2*pad,h:box.h+2*pad},{x:b.x-reach,y:b.y-reach,w:b.w+2*reach,h:b.h+2*reach}))continue;
            }
            const inverse=root.getScreenCTM().inverse().multiply(shape.getScreenCTM()).inverse();
            let stroke=false,inFill=false,outFill=false;
            for(let i=0;i<=cols&&!stroke;i++)for(let j=0;j<=rows;j++){
              const point=new DOMPoint(box.x-labelEpsilon+i*sampleStep,box.y-labelEpsilon+j*sampleStep).matrixTransform(inverse);
              if(shape.isPointInStroke(point)){stroke=true;break}
              if(shape.isPointInFill(point))inFill=true;else outFill=true;
            }
            hit=stroke||(sw===0&&inFill&&outFill)||(name.startsWith('node:')&&inFill);
          }else{labelUnsupported.push({label:item.label,outline:name,reason:'outline is not a geometry element'});continue}
          if(hit){const nodeTextBoxes=name.startsWith('node:')?(fitNodes.find(n=>n.id===name.slice(5))?.texts??[]):[];labelViolations.push({label:item.label,outline:name,labelBox:box,coversNodeText:nodeTextBoxes.some(t=>overlaps(box,t))})}
        }
      }
      lap('browser.labelClearance');
      // R3 inputs: per tagged edge label, every shape in its group with its computed stroke/fill facts, and whether it covers the label's text (root user space, so a rotated label is judged as drawn).
      const alphaOf=c=>{const m=/^rgba?\(([^)]*)\)$/.exec(c);if(!m)return c==='transparent'?0:1;const p=m[1].split(/[,\s/]+/).filter(Boolean);return p.length>=4?Number(p[3]):1};
      const effectiveOpacity=shape=>{let o=1;for(let n=shape;n instanceof Element&&n!==root.parentNode;n=n.parentElement){const v=Number.parseFloat(getComputedStyle(n).opacity);if(Number.isFinite(v))o*=v}return o};
      const labelStyleFacts=[...root.querySelectorAll('g[data-edge-label-source][data-edge-label-target]')].map(el=>{
        const texts=[...el.querySelectorAll('text')].filter(t=>(t.textContent||'').trim());
        const textBox=texts.length?union(texts.map(rootBox)):null;
        const shapes=[...el.querySelectorAll('rect,path,ellipse,polygon,circle')].map(shape=>{
          const st=getComputedStyle(shape),visible=st.display!=='none'&&st.visibility==='visible',b=rootBox(shape);
          const strokeVisible=visible&&st.stroke!=='none'&&(Number.parseFloat(st.strokeWidth)||0)>0&&Number(st.strokeOpacity)>0&&alphaOf(st.stroke)>0;
          const fillOpaque=visible&&st.fill!=='none'&&alphaOf(st.fill)>=1&&Number(st.fillOpacity)>=1&&effectiveOpacity(shape)>=1;
          const covers=!!textBox&&b.x<=textBox.x+0.5&&b.y<=textBox.y+0.5&&b.x+b.w>=textBox.x+textBox.w-0.5&&b.y+b.h>=textBox.y+textBox.h-0.5;
          return {tag:shape.localName,strokeVisible,fillOpaque,covers};
        });
        return {label:`${el.getAttribute('data-edge-label-source')}->${el.getAttribute('data-edge-label-target')}`,hasText:!!textBox,shapes};
      });
      // routeLowerBend inputs, all in root user space: node outlines/bounds, container outlines and heading text, edge-label boxes.
      const lbNodes=[...root.querySelectorAll('g[data-node],g[data-node-id]')].map(el=>{
        const id=el.getAttribute('data-node')??el.getAttribute('data-node-id');
        const painted=shape=>{const st=getComputedStyle(shape);return st.display!=='none'&&st.visibility==='visible'&&(st.fill!=='none'||st.stroke!=='none')};
        const shapes=[...el.querySelectorAll(shapeSelector)].filter(painted),parts=[...shapes,...el.querySelectorAll('text')].map(rootBox);
        const result={id,kind:'unsupported',reason:'no node shape',bbox:parts.length?union(parts):null};
        if(!shapes.length)return result;
        const sized=shapes.map(s=>({s,box:rootBox(s)})).sort((x,y)=>y.box.w*y.box.h-x.box.w*x.box.h);
        const {s,box}=sized[0];
        if(sized.some(r=>!r.box.axisAligned))return {...result,reason:s.localName==='rect'?'transformed rectangle':'transformed shape'};
        const inside=r=>r.box.x>=box.x-0.25&&r.box.y>=box.y-0.25&&r.box.x+r.box.w<=box.x+box.w+0.25&&r.box.y+r.box.h<=box.y+box.h+0.25;
        const rectOnly=sized.every(r=>r.s.localName==='rect');
        // Decoration inside the outline (subroutine bars, a cylinder's top-ellipse line) is allowed; a second outline elsewhere is not.
        if(!rectOnly&&!sized.every(inside))return {...result,reason:'several separate shapes'};
        const local=s.getBBox(),scale=local.width>0?box.w/local.width:1;
        const corner=s.localName==='rect'?Math.max(Number(s.getAttribute('rx')||0),Number(s.getAttribute('ry')||0))*scale:0;
        if(s.localName==='rect'&&corner<Math.min(box.w,box.h)/2-0.01)return {...result,kind:'rect',reason:null,outline:{x:box.x,y:box.y,w:box.w,h:box.h},cornerRadius:corner};
        // Any other outline: sample the drawn geometry in root user space; the Node side derives ports and a convex obstacle.
        if(!(s instanceof SVGGeometryElement))return {...result,reason:'outline is not a geometry element'};
        const total=s.getTotalLength();
        if(!(total>0)||total>100000)return {...result,reason:'outline length unavailable'};
        const m=root.getScreenCTM().inverse().multiply(s.getScreenCTM()),step=Math.max(0.5,total/2000),samples=[];
        for(let at=0;at<total;at+=step){const p=s.getPointAtLength(at).matrixTransform(m);samples.push([p.x,p.y])}
        const end=s.getPointAtLength(total).matrixTransform(m);samples.push([end.x,end.y]);
        return {...result,kind:'shape',reason:null,samples};
      });
      lap('browser.lbNodeSamples');
      const lbGroups=[...root.querySelectorAll(GROUP)].map(el=>{
        const shape=el.querySelector(':scope > rect,:scope > path,:scope > polygon');
        return {id:el.getAttribute('data-group')??el.getAttribute('data-container-id')??el.getAttribute('id')?.slice(6),isNode:el.matches('g[data-node],g[data-node-id]'),outline:shape?.localName??null,box:shape?(({x,y,w,h})=>({x,y,w,h}))(rootBox(shape)):null,headings:[...el.querySelectorAll(':scope > text')].map(t=>(({x,y,w,h})=>({x,y,w,h}))(rootBox(t))),headingTexts:[...el.querySelectorAll('text')].filter(t=>t.closest('g[data-node],g[data-node-id],g[data-edge-label-source],g[data-group],g[data-container-id],g[id^="group-"]')===el||(t.getAttribute('data-role')==='heading'||t.getAttribute('data-role')==='subtitle')).map(t=>(({x,y,w,h})=>({x,y,w,h}))(rootBox(t)))};
      });
      const labelBoxes=labelElements.map(l=>({label:l.label,source:l.source,target:l.target,box:union(l.parts)}));
      // Untagged edge-label drawings (class edge-label / data-owner-edge): matched to a source label by text on the Node side (geometry.mjs resolveLabels).
      const untaggedLabels=[...root.querySelectorAll('.edge-label,[data-owner-edge]')].filter(g=>!(g.hasAttribute('data-edge-label-source')&&g.hasAttribute('data-edge-label-target'))&&!g.parentElement?.closest('.edge-label,[data-owner-edge],[data-edge-label-source]')).map(g=>({text:(g.textContent||'').replace(/\s+/g,' ').trim(),box:(({x,y,w,h})=>({x,y,w,h}))(rootBox(g))}));
      const textCount=root.querySelectorAll('text').length;
      root.remove();
      lap('browser.rest');
      return {timing:T,parseError:false,nodes,edges,groups,textCount,fitNodes,labelFacts,labelCount:labelElements.length,boundLabels:labelElements.map(l=>l.label),labelViolations,labelUnsupported,labelStyleFacts,lbNodes,lbGroups,labelBoxes,untaggedLabels};
    },[svgText,GROUP_SELECTOR,prefilter]);
    timings['browser.drawnTotal']=performance.now()-evalStart;
    arrowEndStartClearance=drawn.parseError?null:checkArrowEndStartClearance(await page.evaluate(collectArrowEndStartFacts,svgText));
    const layoutStart=performance.now();
    layoutFacts=drawn.parseError?null:await page.evaluate(collectLayoutFacts,[svgText,GROUP_SELECTOR,prefilter]);
    timings['browser.layoutFacts']=performance.now()-layoutStart;
    if(originalSvg!==null){
      const originalBytes=Buffer.isBuffer(originalSvg)?originalSvg:Buffer.from(originalSvg,'utf8');
      if(originalBytes.length===0||originalBytes.length>2_000_000)throw Error('ORIGINAL_SVG_SIZE_LIMIT');
      const originalText=new TextDecoder('utf-8',{fatal:true}).decode(originalBytes);
      if(/<\s*(?:script|iframe)\b|\bon[a-z]+\s*=/i.test(originalText))throw Error('ORIGINAL_SVG_ACTIVE_CONTENT_UNSUPPORTED');
      originalSvgHash=hash(originalBytes);
      originalDrawn=await page.evaluate(input=>{
        // Mermaid's browser outerHTML may contain HTML labels that are not XML-well-formed.
        // Parse as the product browser does; scripts remain disabled and requests blocked.
        const doc=new DOMParser().parseFromString(input,'text/html');
        const svg=doc.querySelector('svg');
        if(!svg)return {parseError:true};
        const root=document.importNode(svg,true);
        document.body.appendChild(root);
        const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
        const groups=[...root.querySelectorAll('g.cluster')].map(el=>({id:el.id,box:box(el)}));
        const nodes=[...root.querySelectorAll('g.node[id*="-flowchart-"]')].map(el=>({id:el.id,box:box(el)}));
        root.remove();
        return {parseError:false,nodes,groups};
      },originalText);
    }
  }finally{await browser.close()}
  if(drawn.parseError)return {status:'FAIL',sourceHash:hash(sourceBytes),svgHash:hash(svgBytes),checks:{svgWellFormed:{status:'FAIL',evidence:'SVG XML parser rejected source'}}};
  // Layout and style rules measured from the drawn SVG; none depends on the Mermaid model.
  const layout=layoutFacts&&!layoutFacts.parseError?timed('node.layoutChecks',()=>layoutChecks(layoutFacts,svgText)):layoutChecksUnavailable('layout facts could not be collected');
  // T2/labelBox: rectangles and capsules use the node outline inset by 8 units; other shapes need an explicitly declared labelBox.
  const textFit=(()=>{
    const inset=8,tolerance=0.01,clearance=4,overflows=[],notCheckableNodeIds=[],reasons={},structureOverlaps=[],labelBoxWarnings=[],unknownStructureNodeIds=[];
    for(const node of drawn.fitNodes){
      // Structure is measured on the drawn path geometry independently of any label box; a label box cannot hide text that sits on the lid arc.
      const st=node.structure;
      if(st&&st.textGap!==null&&st.textGap<clearance)structureOverlaps.push({nodeId:node.id,gap:Math.round(st.textGap*100)/100,required:clearance,stroke:st.textStroke,reason:'text is closer than 4 units to a drawn outline or interior stroke'});
      if(st?.labelBoxOverlap)labelBoxWarnings.push({nodeId:node.id,stroke:st.labelBoxOverlap.stroke,blocking:false,reason:'label box overlaps shape structure (a drawn outline or interior stroke such as a cylinder lid or queue bar passes through the declared data-label-box); non-blocking because the actual text keeps its clearance'});
      if(st?.unknown)unknownStructureNodeIds.push(node.id);
      if(node.kind==='unsupported'){notCheckableNodeIds.push(node.id);reasons[node.id]=node.reason;continue}
      const box=node.kind==='rect'?{x:node.outline.x+inset,y:node.outline.y+inset,w:node.outline.w-2*inset,h:node.outline.h-2*inset}:node.labelBox;
      const left=Math.max(0,box.x-Math.min(...node.texts.map(t=>t.x))),top=Math.max(0,box.y-Math.min(...node.texts.map(t=>t.y)));
      const right=Math.max(0,Math.max(...node.texts.map(t=>t.x+t.w))-(box.x+box.w)),bottom=Math.max(0,Math.max(...node.texts.map(t=>t.y+t.h))-(box.y+box.h));
      if(node.texts.length&&[left,top,right,bottom].some(v=>v>tolerance))overflows.push({nodeId:node.id,left,top,right,bottom});
    }
    for(const id of unknownStructureNodeIds)if(!notCheckableNodeIds.includes(id)){notCheckableNodeIds.push(id);reasons[id]='a drawn shape has no measurable geometry (structure unknown)'}
    const method='browser getBBox of every text bound to the node versus the node outline inset by 8 units (rect/capsule) or its declared data-label-box; non-rect shapes without a declared labelBox are never inferred. Independently, every painted outline and interior stroke of the node (cylinder lid/bottom arcs, queue and subroutine bars, decision outline) is sampled at <=0.5-unit steps from the drawn path geometry: text bboxes must keep >= 4 units from the stroke edge and a declared labelBox that contains a stroke is reported as a non-blocking labelBoxWarnings entry (label box overlaps shape structure) and never fails the check on its own';
    const status=overflows.length||structureOverlaps.length?'FAIL':notCheckableNodeIds.length||!drawn.fitNodes.length?'NOT-CHECKABLE':'PASS';
    return {status,evidence:{method,inset,structureClearance:clearance,overflows,structureOverlaps,labelBoxWarnings,notCheckableNodeIds,reasons,checkedNodes:drawn.fitNodes.length-notCheckableNodeIds.length}};
  })();
  // Font-fill rule and page-width legibility: after the whole SVG is scaled to fit 1200x710 (contain), a primary node label (data-role="label") must be at least 12 px;
  // a label that could be 4 or more units larger inside its labelBox is a minor finding. Untagged labels are not checkable.
  const labelFontFit=(()=>{
    const MIN_PX=12,PAGE_W=1200,PAGE_H=710,MAX_FONT=28,MINOR_GAIN=4,inset=8;
    const method=`computed font-size of every text tagged data-role="label" in a node, in root user space, times the 1200x710 contain-fit scale min(1200/viewBoxWidth, 710/viewBoxHeight): FAIL below ${MIN_PX} px; independently, the largest whole font size (cap ${MAX_FONT}) at which the tagged text block would still fit its labelBox (rect/capsule: outline inset by ${inset}; other shapes: declared data-label-box) is measured, and a label that could be ${MINOR_GAIN} or more units larger is a non-blocking minor finding; nodes with no tagged label text are not checkable`;
    const vb=rootViewBox(svgText);
    if(!vb||!(vb.w>0&&vb.h>0))return {status:'NOT-CHECKABLE',evidence:{method,reason:'the root svg has no usable viewBox, so the page-fit scale cannot be established'}};
    const pageScale=Math.min(PAGE_W/vb.w,PAGE_H/vb.h),r2=v=>Math.round(v*100)/100;
    const violations=[],minorFindings=[],untaggedNodeIds=[],effectives=[];
    drawn.labelFacts.forEach((f,i)=>{
      if(!f.labels.length){untaggedNodeIds.push(f.id);return}
      const size=Math.min(...f.labels.map(l=>l.size)),effective=size*pageScale,fit=drawn.fitNodes[i];
      effectives.push(effective);
      const box=fit.kind==='rect'?[fit.outline.x+inset,fit.outline.y+inset,fit.outline.w-2*inset,fit.outline.h-2*inset]:fit.kind==='declared'?[fit.labelBox.x,fit.labelBox.y,fit.labelBox.w,fit.labelBox.h]:null;
      let maxFittingSize=null;
      if(box){
        const x0=Math.min(...f.labels.map(l=>l.box.x)),y0=Math.min(...f.labels.map(l=>l.box.y)),x1=Math.max(...f.labels.map(l=>l.box.x+l.box.w)),y1=Math.max(...f.labels.map(l=>l.box.y+l.box.h));
        const ratio=Math.min(box[2]/Math.max(x1-x0,1e-6),box[3]/Math.max(y1-y0,1e-6));
        maxFittingSize=Math.min(MAX_FONT,Math.floor(size*ratio+1e-6));
      }
      if(effective<MIN_PX-1e-6){
        const neededSize=Math.ceil(MIN_PX/pageScale-1e-6),fixByFont=maxFittingSize!==null&&maxFittingSize>=neededSize&&neededSize<=MAX_FONT;
        const reach=maxFittingSize?MIN_PX/maxFittingSize:null; // the page scale a label at its maximum size needs to reach 12 px
        violations.push({nodeId:f.id,size:r2(size),effective:r2(effective),pageScale:r2(pageScale),neededSize,maxFittingSize,fixByFont,...(box?{box:box.map(r2)}:{}),...(!fixByFont&&reach?{maxCanvas:{width:Math.floor(PAGE_W/reach),height:Math.floor(PAGE_H/reach)}}:{})});
      }else if(maxFittingSize!==null&&maxFittingSize-size>=MINOR_GAIN-1e-6)minorFindings.push({nodeId:f.id,size:r2(size),maxFittingSize,box:box.map(r2),effective:r2(effective)});
    });
    const sorted=[...effectives].sort((a,b)=>a-b),median=sorted.length?(sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2):null;
    const evidence={method,minEffectivePx:MIN_PX,pageFit:{width:PAGE_W,height:PAGE_H},pageScale:r2(pageScale),checkedNodes:effectives.length,medianEffective:median===null?null:r2(median),minEffective:sorted.length?r2(sorted[0]):null,violations,minorFindings,untaggedNodeIds};
    const status=violations.length?'FAIL':untaggedNodeIds.length||!effectives.length?'NOT-CHECKABLE':'PASS';
    return {status,evidence:untaggedNodeIds.length&&status==='NOT-CHECKABLE'?{...evidence,reason:'a node label carries no data-role="label" tag, so it cannot be told from a description'}:evidence};
  })();
  const nodeHeadingClearance=timed('node.nodeHeadingClearance',()=>checkNodeHeadingClearance({nodes:drawn.lbNodes,groups:drawn.lbGroups}));
  // B5: label text+background bbox versus every node/container outline stroke. Epsilon 0.5 units each side absorbs sub-pixel measurement; it is not a design clearance.
  const labelClearance=(()=>{
    const method='browser bbox of edge-label text and background rect (g[data-edge-label-source][data-edge-label-target]) versus node and container outline strokes, 0.5-unit epsilon; rounded or non-rect outlines sampled at 0.5 units';
    const violations=drawn.labelViolations,unsupported=drawn.labelUnsupported;
    // Every labelled source edge needs its own bound label drawing; a partially tagged candidate cannot PASS on the labels it chose to tag.
    let unboundLabels=null;
    if(model){const bound=multiset(drawn.boundLabels);unboundLabels=[];for(const e of [...model.edges,...(model.groupEdges??[])].filter(e=>norm(e.label))){const key=`${e.source}->${e.target}`;if(bound.get(key))bound.set(key,bound.get(key)-1);else unboundLabels.push(key)}}
    const unbound=!model||unboundLabels.length>0;
    const status=violations.length?'FAIL':unbound||unsupported.length?'NOT-CHECKABLE':'PASS';
    return {status,evidence:{method,epsilon:0.5,violations,unsupported,checkedLabels:drawn.labelCount,...(unbound?{unboundLabels,reason:model?'a labelled source edge has no bound edge-label drawing':'source labels cannot be established'}:{})}};
  })();
  // R3 (user decision 2026-10-03): an edge label has no border (no visible stroke on its background shapes) and always has an opaque background behind its text.
  const edgeLabelStyle=(()=>{
    const method='computed stroke/fill/opacity of every shape inside each tagged edge-label group (g[data-edge-label-source][data-edge-label-target]): FAIL on a visible stroke, or when no shape with an opaque fill (alpha 1, fill-opacity 1, group opacity 1) covers the label text; untagged or unbound labels are not checkable';
    const violations=[],unsupported=[];
    for(const f of drawn.labelStyleFacts){
      if(!f.hasText){unsupported.push({label:f.label,reason:'the tagged label group has no text'});continue}
      const stroked=f.shapes.filter(x=>x.strokeVisible);
      if(stroked.length)violations.push({edge:f.label,label:f.label,problem:'visible stroke',shapes:stroked.map(x=>x.tag)});
      if(!f.shapes.some(x=>x.fillOpaque&&x.covers))violations.push({edge:f.label,label:f.label,problem:'no opaque background behind the text',shapes:f.shapes.map(x=>({tag:x.tag,fillOpaque:x.fillOpaque,coversText:x.covers}))});
    }
    const unbound=!model||(labelClearance.evidence.unboundLabels?.length??0)>0;
    const status=violations.length?'FAIL':unbound||unsupported.length?'NOT-CHECKABLE':'PASS';
    return {status,evidence:{method,violations,unsupported,checkedLabels:drawn.labelStyleFacts.length,...(unbound?{unboundLabels:labelClearance.evidence.unboundLabels??[],reason:model?'a labelled source edge has no tagged edge-label drawing':'source labels cannot be established'}:{})}};
  })();
  if(!model){
    const unresolved={status:'NOT-CHECKABLE',evidence:`source parser cannot establish independent semantic bindings: ${modelError}`};
    return {status:[textFit,labelFontFit,labelClearance,edgeLabelStyle,nodeHeadingClearance,...Object.values(layout)].some(c=>c.status==='FAIL')?'FAIL':'NOT-CHECKABLE',sourceHash:hash(sourceBytes),svgHash:hash(svgBytes),checks:{svgWellFormed:{status:'PASS',evidence:'browser XML parser'},arrowEndStartClearance:{status:'NOT-CHECKABLE',evidence:'source parser cannot establish connector bindings'},nodeIdentity:unresolved,nodeText:unresolved,relations:unresolved,groups:unresolved,groupMembership:unresolved,textFit,labelFontFit,labelClearance,edgeLabelStyle,labelCoversRoute:{status:'NOT-CHECKABLE',evidence:'source parser cannot establish which relations and labels exist, so label ownership against routes is unavailable'},nodeHeadingClearance,...layout,routeLowerBend:{status:'NOT-CHECKABLE',evidence:'source parser cannot establish which edge labels exist, so label exclusion bounds are unavailable'},routeDetour:{status:'NOT-CHECKABLE',evidence:'source parser cannot establish which edge labels exist, so label exclusion bounds are unavailable'},routeContainerClearance:{status:'NOT-CHECKABLE',evidence:'source parser cannot establish which edge labels exist, so label boxes are unavailable'},routeGeometry:{status:'NOT-CHECKABLE',evidence:'independent geometry proof unavailable'},visualQuality:{status:'NOT-CHECKABLE',evidence:'requires original/candidate visual inspection'}},drawnCounts:{nodes:drawn.nodes.length,edges:drawn.edges.length,groups:drawn.groups.length,text:drawn.textCount},...(timing?{timing:{...timings,...Object.fromEntries(Object.entries(drawn.timing??{})),totalMs:performance.now()-wall}}:{})};
  }
  const expectedNodes=multiset(model.nodes.map(n=>n.id)),actualNodes=multiset(drawn.nodes.map(n=>n.id));
  const nodeIdentity=drawn.nodes.length?{status:equalSets(expectedNodes,actualNodes)?'PASS':'FAIL',evidence:{expected:model.nodes.length,drawn:drawn.nodes.length,missing:model.nodes.filter(n=>!actualNodes.has(n.id)).map(n=>n.id),extra:drawn.nodes.filter(n=>!expectedNodes.has(n.id)).map(n=>n.id)}}:{status:'NOT-CHECKABLE',evidence:'no neutral per-node semantic binding; SVG may still be visually valid'};
  const textMismatches=drawn.nodes.filter(n=>{const sourceNode=model.nodes.find(x=>x.id===n.id);return sourceNode&&norm(sourceNode.text)!==norm(n.text)}).map(n=>n.id);
  const nodeText=nodeIdentity.status==='PASS'?{status:textMismatches.length?'FAIL':'PASS',evidence:{mismatchedNodeIds:textMismatches,method:'actual text descendants; whitespace-normalized'}}:{status:'NOT-CHECKABLE',evidence:'node identities unavailable or mismatched'};
  // Node-to-group relations (Mermaid `A --> SomeGroup`, model.groupEdges): an end binds to a group when the drawing says data-*-kind="group", or, without that
  // attribute, when its id is a source group id and not a node id (the parser refuses node/subgraph id collisions). They are split off drawn.edges HERE, before
  // any route check: every check below indexes node-to-node routes by position and looks endpoints up among nodes. Group relations are verified by binding
  // (relations), arrowhead (markerDrawing) and dashing (relationStyle).
  const sourceGroupIds=new Set(model.groups.map(g=>g.id)),sourceNodeIds=new Set(model.nodes.map(n=>n.id));
  const groupEnd=(kind,id)=>kind==='group'||(kind!=='node'&&sourceGroupIds.has(id)&&!sourceNodeIds.has(id));
  for(const e of drawn.edges){e.sourceIsGroup=groupEnd(e.sourceKind,e.source);e.targetIsGroup=groupEnd(e.targetKind,e.target)}
  drawn.groupEdges=drawn.edges.filter(e=>e.sourceIsGroup||e.targetIsGroup);
  drawn.edges=drawn.edges.filter(e=>!(e.sourceIsGroup||e.targetIsGroup));
  const relKey=e=>`${e.source}${e.sourceIsGroup?' (group)':''}->${e.target}${e.targetIsGroup?' (group)':''}`;
  const expectedEdges=multiset(model.edges.map(e=>`${e.source}\0${e.target}`)),actualEdges=multiset(drawn.edges.map(e=>`${e.source}\0${e.target}`));
  const malformed=e=>!['path','polyline','line'].includes(e.tag)||!e.path&&e.tag!=='line'||!e.marker;
  const malformedEdges=[...drawn.edges,...drawn.groupEdges].filter(malformed).map(relKey);
  const sourceGroupEdges=model.groupEdges??[],groupPool=multiset(sourceGroupEdges.map(relKey)),missingGroupEdges=[],extraGroupEdges=[];
  for(const e of drawn.groupEdges){const k=relKey(e);if(groupPool.get(k))groupPool.set(k,groupPool.get(k)-1);else extraGroupEdges.push(k)}
  for(const [k,n] of groupPool)for(let i=0;i<n;i++)missingGroupEdges.push(k);
  const groupBinding={groupExpected:sourceGroupEdges.length,groupDrawn:drawn.groupEdges.length,missingGroupEdges,extraGroupEdges};
  // A group-endpoint edge is checkable now (by binding); the remaining caveats (arrowheads other than a normal arrow, bidirectional) still make the node
  // relation set NOT-CHECKABLE, but a missing or extra group relation is a definite defect whatever else the source contains.
  const caveats=(model.notCheckable??[]).filter(c=>c.construct!=='group-endpoint edge');
  const groupBindingFails=missingGroupEdges.length>0||extraGroupEdges.length>0;
  const relations=caveats.length&&!groupBindingFails?{status:'NOT-CHECKABLE',evidence:{reason:'the source has relations the auditor cannot verify against a drawn directed marker (not checkable)',constructs:[...new Set(caveats.map(c=>c.construct))],lines:caveats.map(c=>c.line),...groupBinding}}
    :caveats.length?{status:'FAIL',evidence:{reason:'node-to-group relations are missing or extra; node relations are not checkable (see constructs)',constructs:[...new Set(caveats.map(c=>c.construct))],lines:caveats.map(c=>c.line),...groupBinding,method:'source-target bindings of node-to-group relations'}}
    :drawn.edges.length||drawn.groupEdges.length?{status:equalSets(expectedEdges,actualEdges)&&malformedEdges.length===0&&!groupBindingFails?'PASS':'FAIL',evidence:{expected:model.edges.length,drawn:drawn.edges.length,...groupBinding,malformedEdges,method:'visible path/polyline/line elements with source-target bindings; a group end is data-*-kind="group" or a source group id'}}:{status:'NOT-CHECKABLE',evidence:'no neutral per-relation semantic binding; SVG may still be visually valid'};
  const relationStyle=relations.status==='PASS'?(()=>{
    const mismatches=[],ambiguous=[];
    for(const drawnEdge of [...drawn.edges,...drawn.groupEdges]){
      const expected=[...model.edges,...sourceGroupEdges].filter(e=>relKey(e)===relKey(drawnEdge));
      if(expected.length!==1){ambiguous.push(relKey(drawnEdge));continue}
      if(drawnEdge.dashed!==(expected[0].style==='dashed'))mismatches.push(relKey(drawnEdge));
    }
    const thick=[...model.edges,...sourceGroupEdges].filter(e=>e.thick).map(relKey);
    // Only dashing is measured; a thick source relation drawn thin must not PASS by default.
    return {status:mismatches.length?'FAIL':ambiguous.length||thick.length?'NOT-CHECKABLE':'PASS',evidence:{method:'source Mermaid edge style against actual computed SVG stroke-dasharray; parallel same-endpoint relations require independent ID binding',mismatches,ambiguous,checkedEdges:drawn.edges.length+drawn.groupEdges.length-ambiguous.length,...(thick.length?{thickEdges:thick,reason:'thick source relations: stroke weight is not compared (not checkable)'}:{})}};
  })():{status:'NOT-CHECKABLE',evidence:'directed relation binding unavailable'};
  const markerDrawing=relations.status==='PASS'?(()=>{
    const all=[...drawn.edges,...drawn.groupEdges];
    const mismatches=all.filter(e=>!e.markerDrawing?.found||e.markerDrawing.shapeCount!==1||!e.markerDrawing.visible||!e.markerDrawing.colorMatches).map(relKey);
    return {status:mismatches.length?'FAIL':'PASS',evidence:{method:'actual marker child shape, computed paint/visibility, nonzero transform and path stroke color; marker silhouette and clipping not proved',mismatchedEdges:mismatches,checkedEdges:all.length}};
  })():{status:'NOT-CHECKABLE',evidence:'exact relation binding unavailable'};
  const routeNodeIntrusion=relations.status==='PASS'&&drawn.edges.every(e=>e.geometry)?(()=>{
    const endpointErrors=drawn.edges.filter(e=>!e.geometry.startOnSource||!e.geometry.endOnTarget).map(e=>`${e.source}->${e.target}`);
    const intrusions=drawn.edges.filter(e=>e.geometry.intrudedNodeIds.length).map(e=>({edge:`${e.source}->${e.target}`,nodeIds:e.geometry.intrudedNodeIds}));
    const textIntrusions=drawn.edges.filter(e=>e.geometry.intrudedTextNodeIds?.length).map(e=>({edge:`${e.source}->${e.target}`,nodeIds:e.geometry.intrudedTextNodeIds}));
    return {status:endpointErrors.length||intrusions.length?'FAIL':'PASS',evidence:{method:'Chromium actual SVG path endpoints versus shape strokes; path sampled at <=2 SVG units against actual node fills; source first 8 and target last 12 units exempted',endpointErrors,intrusions,textIntrusions,checkedEdges:drawn.edges.length}};
  })():{status:'NOT-CHECKABLE',evidence:'exact relation binding or SVG geometry API unavailable'};
  const routeHeadingClearance=relations.status==='PASS'&&drawn.edges.every(e=>e.geometry)?(()=>{
    const intrusions=drawn.edges.filter(e=>e.geometry.intrudedHeadingGroupIds.length).map(e=>({edge:`${e.source}->${e.target}`,groupIds:e.geometry.intrudedHeadingGroupIds}));
    const headingOverlaps=drawn.edges.filter(e=>e.geometry.overlapHeadingGroupIds?.length).map(e=>({edge:`${e.source}->${e.target}`,groupIds:e.geometry.overlapHeadingGroupIds}));
    return {status:intrusions.length?'FAIL':'PASS',evidence:{method:'actual SVG path sampled at <=2 units against drawn group heading text bounds plus 2-unit guard',intrusions,headingOverlaps,checkedEdges:drawn.edges.length}};
  })():{status:'NOT-CHECKABLE',evidence:'actual path or group heading bounds unavailable'};
  const routeSpans=drawn.edges.map(e=>({edge:`${e.source}->${e.target}`,spans:actualStraightSpans(e.path)}));
  const routePairClearance=relations.status==='PASS'&&routeSpans.every(e=>e.spans)?(()=>{
    const violations=[],accepted=[];
    const routes=routeSpans.map((e,i)=>({edge:e.edge,spans:e.spans,lastCommand:e.spans.lastCommand,trunk:drawn.edges[i].trunk||null,target:drawn.edges[i].target,style:drawn.edges[i].style}));
    for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
      for(const a of routes[i].spans)for(const b of routes[j].spans){
        if(a.axis!==b.axis)continue;
        const overlap=Math.min(a.hi,b.hi)-Math.max(a.lo,b.lo);
        const separation=Math.abs(a.fixed-b.fixed);
        if(!(overlap>eps&&separation<10-eps))continue;
        if(isAcceptedTrunkOverlap(routes[i],routes[j],a,b)){accepted.push({id:routes[i].trunk,target:routes[i].target,edgeA:routes[i].edge,edgeB:routes[j].edge,overlap});continue}
        violations.push({edgeA:routes[i].edge,edgeB:routes[j].edge,separation,overlap});
      }
    }
    // A declared trunk is accepted only if its members read as one connector family: same style, no label on the shared run, one entry side.
    violations.push(...checkTrunkSemantics({routes,labelBoxes:drawn.labelBoxes??[]}));
    const unrecognisedTrunkAttributes_=drawn.edges.flatMap(e=>unrecognisedTrunkAttributes(e.trunkLikeAttributes??[]).map(a=>({edge:`${e.source}->${e.target}`,attribute:a.name,value:a.value})));
    return {status:violations.length?'FAIL':'PASS',evidence:{method:'strict M/L/Q/A parser of actual SVG d; every drawn straight centerline span pair after curve trims; coincident or sub-10 spans are accepted only as the final portion shared at one target by connectors carrying the same data-shared-trunk id with one relation style, no edge label on or within 4 units of the shared run and one entry side (else mixed-style trunk / label on shared trunk / opposite-side merge); head-on collinear legs of two connectors into one target within 10.5 units are an ambiguous junction; no other bus exception inferred',violations,trunks:summariseTrunks(accepted),unrecognisedTrunkAttributes:unrecognisedTrunkAttributes_,...(unrecognisedTrunkAttributes_.length?{hint:TRUNK_HINT}:{}),checkedEdges:routeSpans.length}};
  })():{status:'NOT-CHECKABLE',evidence:'edge drawing uses unsupported SVG path grammar or exact relation binding unavailable'};
  const routeCrossings=relations.status==='PASS'&&routeSpans.every(e=>e.spans)?(()=>{
    const violations=[];
    for(let i=0;i<routeSpans.length;i++)for(let j=i+1;j<routeSpans.length;j++){
      for(const a of routeSpans[i].spans)for(const b of routeSpans[j].spans){
        if(a.axis===b.axis)continue;
        const h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;
        if(v.fixed>h.lo+eps&&v.fixed<h.hi-eps&&h.fixed>v.lo+eps&&h.fixed<v.hi-eps)violations.push({edgeA:routeSpans[i].edge,edgeB:routeSpans[j].edge,x:v.fixed,y:h.fixed});
      }
    }
    const method='exact interior intersections among actual straight SVG centerline spans after fillet trims; curved portions and declared junction topology remain outside this subcheck';
    // Dense diagram (user decision 2026-10-03): from the threshold up, crossings are measured and reported but are minor findings, not a FAIL, and never need a waiver.
    const relationCount=model.edges.length,dense=denseInfo(relationCount);
    const base={relationCount,denseThreshold:denseRelationThreshold()};
    if(dense&&violations.length)return {status:'PASS',evidence:{method,...base,dense,crossings:violations.length,violations:[],minorFindings:violations,basis:`${dense.reason}: ${violations.length} crossing(s) measured and reported as minor (non-blocking); minimise them with port order and lanes, do not chase zero`,checkedEdges:routeSpans.length}};
    return {status:violations.length?'FAIL':'PASS',evidence:{method,...base,...(dense?{dense}:{}),violations,checkedEdges:routeSpans.length}};
  })():{status:'NOT-CHECKABLE',evidence:'edge drawing uses unsupported SVG path grammar or exact relation binding unavailable'};
  const arrowShaft=relations.status==='PASS'&&routeSpans.every(e=>e.spans?.length&&e.spans.lastCommand==='L')&&drawn.edges.every(e=>Number.isFinite(e.markerDrawing?.axialLength))?(()=>{
    const failures=routeSpans.flatMap((e,i)=>{const required=drawn.edges[i].markerDrawing.axialLength+8;return e.spans.at(-1).length<required-eps?[{edge:e.edge,drawnLastShaft:e.spans.at(-1).length,required}]:[]});
    return {status:failures.length?'FAIL':'PASS',evidence:{method:'actual post-curve final straight segment >= measured simple marker axial length + 8-unit visible shaft; complex viewBox marker stays unresolved',failures,checkedEdges:routeSpans.length}};
  })():{status:'NOT-CHECKABLE',evidence:'actual final straight span or simple marker axial geometry unavailable'};
  const lbInput=drawn.edges.length?{
    nodes:drawn.lbNodes,groups:drawn.lbGroups,labelBoxes:drawn.labelBoxes,unboundLabels:labelClearance.evidence.unboundLabels??[],
    edges:drawn.edges.map((e,i)=>({source:e.source,target:e.target,tag:e.tag,path:e.path,trunk:e.trunk||null,axialLength:e.markerDrawing?.axialLength,spans:routeSpans[i].spans,hulls:e.tag==='path'?actualCurveEnvelopes(e.path):null}))
  }:null;
  if(routeCrossings.status==='FAIL'){
    if(lbInput){timed('node.crossingHints',()=>attachCrossingRepairHints(lbInput,routeCrossings.evidence.violations,{canvas:rootViewBox(svg)}));timed('node.nodeMoveHints',()=>attachNodeMoveHints(lbInput,routeCrossings.evidence.violations,{canvas:rootViewBox(svg)}))}
    else for(const v of routeCrossings.evidence.violations){v.repairHint=null;v.reason='no neutral per-relation binding, so no route search was possible'}
  }
  // R4(b) (user decision 2026-10-03): an edge label's box (its rotated footprint when rotated) must not intersect any route other than its own.
  // User rule 2026-10-05 ("标签覆盖箭头的时候应该判定失败"): it must not cover any arrowhead either, its own route's included; its own straight shaft stays allowed (R2).
  // Node and container outlines are labelClearance's; this check only looks at routes and arrowheads, so nothing is reported twice.
  const labelCoversRoute=timed('node.labelCoversRoute',()=>{
    const method='tagged edge-label box in root user space (rotated footprint when rotated) versus (a) the actual straight SVG centerline spans of every other route and (b) the arrowhead of every route including its own: the measured marker-end footprint (axial length back from the path end, any forward overhang, measured width) aligned with the drawn end direction, 0.5-unit allowance on both; a curve envelope overlap with no straight-span hit, or a label within 20 units of an end whose head geometry cannot be measured, is unknown, not evidence; marker-start is not read (bidirectional edges are not checkable in the parser); node and container outlines belong to labelClearance';
    if(!(relations.status==='PASS'&&routeSpans.every(e=>e.spans)))return {status:'NOT-CHECKABLE',evidence:'edge drawing uses unsupported SVG path grammar or exact relation binding unavailable'};
    const PAD=0.5,STEP=2,TAIL=20;
    const labels=(drawn.labelBoxes??[]).filter(l=>l.box);
    const hulls=drawn.edges.map(e=>e.tag==='path'?actualCurveEnvelopes(e.path):null);
    const hitSpan=(b,sp)=>sp.axis==='h'?sp.fixed>b.y-PAD&&sp.fixed<b.y+b.h+PAD&&sp.hi>b.x-PAD&&sp.lo<b.x+b.w+PAD:sp.fixed>b.x-PAD&&sp.fixed<b.x+b.w+PAD&&sp.hi>b.y-PAD&&sp.lo<b.y+b.h+PAD;
    const hitBox=(a,c,pad=0)=>a.x<c.x+c.w+pad&&a.x+a.w>c.x-pad&&a.y<c.y+c.h+pad&&a.y+a.h>c.y-pad;
    const r1=v=>Math.round(v*10)/10;
    // Arrowhead box per route: the measured head footprint, its axes aligned with the end direction (marker local y = direction rotated +90 degrees).
    const heads=routeSpans.map((route,i)=>{
      const md=drawn.edges[i].markerDrawing,end=route.spans.endPoint,dir=route.spans.endDir;
      if(!md?.found)return {edge:route.edge,box:null,end:null};
      const h=md.head;
      if(!h||!end||!dir)return {edge:route.edge,box:null,end};
      const [dx,dy]=dir,xs=[],ys=[];
      for(const along of [-h.back,h.forward])for(const across of [h.perpLo,h.perpHi]){xs.push(end[0]+along*dx-across*dy);ys.push(end[1]+along*dy+across*dx)}
      return {edge:route.edge,box:{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)},end};
    });
    const violations=[],unknown=[];
    for(const l of labels){
      const own=`${l.source}->${l.target}`,found=new Map(),headHits=new Map();
      routeSpans.forEach((route,i)=>{
        const head=heads[i];
        if(head.box&&hitBox(l.box,head.box,PAD)){const c=head.box,x0=Math.max(l.box.x,c.x),y0=Math.max(l.box.y,c.y);headHits.set(route.edge,{x:x0,y:y0,w:Math.max(0,Math.min(l.box.x+l.box.w,c.x+c.w)-x0),h:Math.max(0,Math.min(l.box.y+l.box.h,c.y+c.h)-y0)})}
        else if(!head.box&&head.end&&hitBox(l.box,{x:head.end[0],y:head.end[1],w:0,h:0},TAIL))unknown.push({edge:own,coveredEdge:route.edge,reason:'the label is near a route end whose arrowhead geometry could not be measured'});
        if(route.edge===own)return;
        for(const sp of route.spans){
          if(!hitSpan(l.box,sp))continue;
          const lo=sp.axis==='h'?Math.max(sp.lo,l.box.x):Math.max(sp.lo,l.box.y),hi=sp.axis==='h'?Math.min(sp.hi,l.box.x+l.box.w):Math.min(sp.hi,l.box.y+l.box.h);
          const o=sp.axis==='h'?{x:lo,y:sp.fixed,w:hi-lo,h:0}:{x:sp.fixed,y:lo,w:0,h:hi-lo};
          const prev=found.get(route.edge);
          if(!prev)found.set(route.edge,o);
          else{const x0=Math.min(prev.x,o.x),y0=Math.min(prev.y,o.y),x1=Math.max(prev.x+prev.w,o.x+o.w),y1=Math.max(prev.y+prev.h,o.y+o.h);found.set(route.edge,{x:x0,y:y0,w:x1-x0,h:y1-y0})}
        }
        if(!found.has(route.edge)&&!headHits.has(route.edge)&&hulls[i]?.some(c=>hitBox(l.box,c)))unknown.push({edge:own,coveredEdge:route.edge,reason:'the label overlaps only the conservative envelope of a curved portion'});
      });
      if(!found.size&&!headHits.size)continue;
      // Repair hint: a stretch of the label's own straight segments where the label, centred on the segment, touches no other route, no arrowhead, node or label.
      const ownSpans=routeSpans.find(e=>e.edge===own)?.spans??[];
      const long=Math.max(l.box.w,l.box.h),short=Math.min(l.box.w,l.box.h);
      const otherLabels=labels.filter(x=>x!==l).map(x=>x.box),nodeBoxes=drawn.lbNodes.map(n=>n.bbox).filter(Boolean),headBoxes=heads.map(h=>h.box).filter(Boolean);
      let hint=null;
      for(const sp of [...ownSpans].sort((a,b)=>b.length-a.length)){
        const horizontal=sp.axis==='h',w=horizontal?long:short,h=horizontal?short:long,half=(horizontal?w:h)/2;
        const lo=sp.lo+half,hi=sp.hi-half-(sp===ownSpans.at(-1)?TAIL:0);
        if(hi<lo)continue;
        const mid=Math.min(hi,Math.max(lo,(sp.lo+sp.hi)/2));
        for(let k=0;k<=Math.ceil((hi-lo)/STEP)&&!hint;k++)for(const pos of k===0?[mid]:[mid-k*STEP,mid+k*STEP]){
          if(pos<lo||pos>hi)continue;
          const b=horizontal?{x:pos-w/2,y:sp.fixed-h/2,w,h}:{x:sp.fixed-w/2,y:pos-h/2,w,h};
          const clear=!routeSpans.some(r=>r.edge!==own&&r.spans.some(o2=>hitSpan(b,o2)))&&!headBoxes.some(c=>hitBox(b,c,PAD))&&!nodeBoxes.some(n=>hitBox(b,n))&&!otherLabels.some(n=>hitBox(b,n));
          if(clear){hint={edge:own,x:r1(horizontal?pos:sp.fixed),y:r1(horizontal?sp.fixed:pos),axis:sp.axis,vertical:!horizontal};break}
        }
        if(hint)break;
      }
      for(const covered of new Set([...found.keys(),...headHits.keys()])){
        const o=found.get(covered),hh=headHits.get(covered);
        const coveredPart=o&&hh?'route and arrowhead':hh?'arrowhead':'route';
        const finding=`label of ${own} covers the ${coveredPart==='route'?'route':coveredPart==='arrowhead'?'arrowhead':'route and the arrowhead'} of ${covered}`;
        const box=hh&&o?{x:Math.min(o.x,hh.x),y:Math.min(o.y,hh.y),w:Math.max(o.x+o.w,hh.x+hh.w)-Math.min(o.x,hh.x),h:Math.max(o.y+o.h,hh.y+hh.h)-Math.min(o.y,hh.y)}:o??hh;
        violations.push({edge:own,coveredEdge:covered,coveredPart,finding,overlap:{x:r1(box.x),y:r1(box.y),w:r1(box.w),h:r1(box.h)},labelBox:{x:r1(l.box.x),y:r1(l.box.y),w:r1(l.box.w),h:r1(l.box.h)},repairHint:hint,...(hint?{}:{reason:'no straight stretch of its own route is long enough and free of other routes, arrowheads, nodes and labels to hold the label'})});
      }
    }
    const unbound=(labelClearance.evidence.unboundLabels?.length??0)>0;
    const status=violations.length?'FAIL':unbound||unknown.length?'NOT-CHECKABLE':'PASS';
    return {status,evidence:{method,violations,unknown,checkedLabels:labels.length,...(unbound?{unboundLabels:labelClearance.evidence.unboundLabels,reason:'a labelled source edge has no tagged edge-label drawing'}:{})}};
  });
  const routeLowerBend=lbInput?timed('node.routeLowerBend',()=>checkRouteLowerBend(lbInput)):{status:'NOT-CHECKABLE',evidence:'no neutral per-relation semantic binding; SVG may still be visually valid'};
  const routeDetour=lbInput?timed('node.routeDetour',()=>checkRouteLowerBend(lbInput,{mode:'detour'})):{status:'NOT-CHECKABLE',evidence:'no neutral per-relation semantic binding; SVG may still be visually valid'};
  // Rule 6 / B5 for containers: grazing spans and edge labels (tagged or text-matched untagged) next to a container border.
  const routeContainerClearance=(()=>{
    const resolved=resolveLabels({labels:drawn.labelBoxes,untaggedLabels:drawn.untaggedLabels},model);
    const have=new Set(resolved.map(l=>`${l.source}->${l.target}`));
    const unresolvedLabels=model.edges.filter(e=>norm(e.label)&&!have.has(`${e.source}->${e.target}`)).map(e=>`${e.source}->${e.target}`);
    return timed('node.routeContainerClearance',()=>checkRouteContainerClearance({groups:drawn.lbGroups,nodes:drawn.lbNodes,edges:drawn.edges.map((e,i)=>({source:e.source,target:e.target,spans:routeSpans[i].spans})),labels:resolved.map(l=>({edge:`${l.source}->${l.target}`,box:l.box})),unresolvedLabels}));
  })();
  const groupIds=new Set(drawn.groups.map(g=>g.id)),expectedGroupIds=new Set(model.groups.map(g=>g.id));
  const groups=drawn.groups.length?{status:groupIds.size===expectedGroupIds.size&&[...expectedGroupIds].every(x=>groupIds.has(x))?'PASS':'FAIL',evidence:{expected:[...expectedGroupIds],drawn:[...groupIds],method:'actual container elements with neutral group ID'}}:{status:model.groups.length?'NOT-CHECKABLE':'PASS',evidence:'group geometry has no neutral binding'};
  let groupMembership={status:'PASS',evidence:'source has no groups'};
  if(model.groups.length){
    const shapeBoxes=drawn.groups.every(g=>g.box&&g.box.w>0&&g.box.h>0)&&drawn.nodes.every(n=>n.box&&n.box.w>0&&n.box.h>0);
    if(groups.status!=='PASS'||nodeIdentity.status!=='PASS'||!shapeBoxes){
      groupMembership={status:'NOT-CHECKABLE',evidence:'group or node drawing lacks an independently measured bounding box and exact source ID binding'};
    }else{
      const contains=(outer,inner)=>inner.x>=outer.x-0.25&&inner.y>=outer.y-0.25&&inner.x+inner.w<=outer.x+outer.w+0.25&&inner.y+inner.h<=outer.y+outer.h+0.25;
      const mismatches=[];
      for(const sourceNode of model.nodes){
        const drawnNode=drawn.nodes.find(n=>n.id===sourceNode.id);
        const actual=drawn.groups.filter(g=>contains(g.box,drawnNode.box)).map(g=>g.id);
        const expected=sourceNode.declaredGroupPath??sourceNode.groupPath??(sourceNode.group?[sourceNode.group]:[]);
        if(actual.length!==expected.length||actual.some(id=>!expected.includes(id)))mismatches.push(sourceNode.id);
      }
      groupMembership={status:mismatches.length?'FAIL':'PASS',evidence:{method:'browser getBBox of actual node drawings inside actual group outline; SVG data-parent ignored',mismatchedNodeIds:mismatches,checkedNodes:model.nodes.length}};
    }
  }
  const routeUnrelatedContainerTransit=relations.status==='PASS'&&groups.status==='PASS'&&nodeIdentity.status==='PASS'&&drawn.groups.every(g=>g.box&&g.box.w>0&&g.box.h>0&&g.outline==='rect'&&Number.isFinite(g.cornerRadius))&&drawn.nodes.every(n=>n.box)&&routeSpans.every(e=>e.spans)?(()=>{
    const contains=(outer,inner)=>inner.x>=outer.x-0.25&&inner.y>=outer.y-0.25&&inner.x+inner.w<=outer.x+outer.w+0.25&&inner.y+inner.h<=outer.y+outer.h+0.25;
    const intersects=(span,box,guard)=>{
      if(span.axis==='h')return span.fixed>box.y+guard&&span.fixed<box.y+box.h-guard&&Math.min(span.hi,box.x+box.w-guard)-Math.max(span.lo,box.x+guard)>eps;
      return span.fixed>box.x+guard&&span.fixed<box.x+box.w-guard&&Math.min(span.hi,box.y+box.h-guard)-Math.max(span.lo,box.y+guard)>eps;
    };
    const overlaps=(a,b)=>a.x<b.x+b.w-eps&&a.x+a.w>b.x+eps&&a.y<b.y+b.h-eps&&a.y+a.h>b.y+eps;
    const violations=[],unresolved=[];
    for(let i=0;i<drawn.edges.length;i++){
      const edge=drawn.edges[i],source=drawn.nodes.find(n=>n.id===edge.source),target=drawn.nodes.find(n=>n.id===edge.target);
      if(!source||!target)continue;
      const curves=actualCurveEnvelopes(edge.path);
      for(const group of drawn.groups){
        if(contains(group.box,source.box)||contains(group.box,target.box))continue;
        const crossingSpans=routeSpans[i].spans.filter(span=>intersects(span,group.box,Math.max(0.25,group.cornerRadius)));
        if(crossingSpans.length)violations.push({edge:`${edge.source}->${edge.target}`,groupId:group.id,straightSpans:crossingSpans});
        else if(routeSpans[i].spans.some(span=>intersects(span,group.box,0.25))||curves===null||curves.some(box=>overlaps(box,group.box)))unresolved.push({edge:`${edge.source}->${edge.target}`,groupId:group.id});
      }
    }
    return {status:violations.length?'FAIL':unresolved.length?'NOT-CHECKABLE':'PASS',evidence:{method:'actual SVG straight spans versus certain rounded-rectangle interior; conservative supported Q/A curve envelopes and uncertain rounded corners retain NOT-CHECKABLE; source/target ancestor groups permit transit',violations,unresolved,checkedEdges:drawn.edges.length}};
  })():{status:'NOT-CHECKABLE',evidence:'exact edge binding, source/target outlines, rectangular container drawing, or strict straight SVG spans unavailable'};
  let originalGroupParity={status:'NOT-CHECKABLE',evidence:'original rendered SVG was not supplied'};
  if(originalDrawn&&!model.groups.length){
    // Vacuous only when both sides agree there is no grouping: the source declares none AND the original render drew no cluster.
    originalGroupParity=originalDrawn.parseError?{status:'NOT-CHECKABLE',evidence:'original renderer XML unavailable'}:
      originalDrawn.groups.length?{status:'NOT-CHECKABLE',evidence:`source declares no groups but the original render has ${originalDrawn.groups.length} cluster(s); membership cannot be compared`}:
      {status:'PASS',evidence:{method:'source declarations and original Mermaid browser SVG clusters',note:'source declares no groups and original render has no clusters',originalSvgHash,mismatchedNodeIds:[],sourceDeclarationConflictNodeIds:[],unresolvedNodeIds:[],checkedNodes:0,nodeMembership:{}}};
  }else if(originalDrawn&&model.groups.length){
    if(originalDrawn.parseError||groups.status!=='PASS'||nodeIdentity.status!=='PASS')originalGroupParity={status:'NOT-CHECKABLE',evidence:'original renderer XML or candidate group/node identity unavailable'};
    else{
      const contains=(outer,inner)=>inner.x>=outer.x-1&&inner.y>=outer.y-1&&inner.x+inner.w<=outer.x+outer.w+1&&inner.y+inner.h<=outer.y+outer.h+1;
      const mismatches=[],sourceConflicts=[],unresolved=[];
      const nodeMembership={};
      for(const node of model.nodes){
        const old=originalDrawn.nodes.filter(n=>/-flowchart-(.+)-\d+$/.exec(n.id)?.[1]===node.id);
        const current=drawn.nodes.find(n=>n.id===node.id);
        if(old.length!==1||!current){unresolved.push(node.id);continue}
        const oldGroups=model.groups.filter(g=>originalDrawn.groups.some(x=>x.id.endsWith(`-${g.id}`)&&contains(x.box,old[0].box))).map(g=>g.id);
        const newGroups=model.groups.filter(g=>drawn.groups.some(x=>x.id===g.id&&contains(x.box,current.box))).map(g=>g.id);
        if(oldGroups.length!==newGroups.length||oldGroups.some(g=>!newGroups.includes(g)))mismatches.push(node.id);
        const declared=node.declaredGroupPath??node.groupPath??(node.group?[node.group]:[]);
        nodeMembership[node.id]={declared,rendered:oldGroups,candidate:newGroups};
        if(oldGroups.length!==declared.length||oldGroups.some(g=>!declared.includes(g)))sourceConflicts.push(node.id);
      }
      originalGroupParity={status:unresolved.length?'NOT-CHECKABLE':mismatches.length?'FAIL':'PASS',evidence:{method:'original Mermaid browser SVG node/cluster screen bounds versus candidate actual node/container bounds; source declarations reported separately',originalSvgHash,mismatchedNodeIds:mismatches,sourceDeclarationConflictNodeIds:sourceConflicts,unresolvedNodeIds:unresolved,checkedNodes:model.nodes.length-unresolved.length,nodeMembership}};
    }
  }
  // Adjudication: a record applies only to a node with a declared-vs-rendered conflict, only for these exact source bytes, and only if the candidate draws the chosen group.
  const sourceHashHex=hash(sourceBytes);
  const adjudicate=(nodeId,detail)=>{
    const records=adjudicationList.filter(r=>r?.nodeId===nodeId);
    if(!records.length)return {ok:false,record:null,reasons:[]};
    const reasons=[];
    if(records.length>1)reasons.push('duplicate records for node');
    const r=records[0];
    if(!wellFormedAdjudication(r))reasons.push('malformed record');
    else{
      if(r.sourceHash!==sourceHashHex)reasons.push('sourceHash does not match audited source');
      if((detail.declared[0]??null)!==r.declaredGroup)reasons.push('declaredGroup does not match source declaration');
      if(!(detail.rendered.length===0?r.renderedGroup===null:detail.rendered.length===1&&detail.rendered[0]===r.renderedGroup))reasons.push('renderedGroup does not match original render');
      if(!(detail.candidate.length===0?r.chosenGroup===null:detail.candidate.length===1&&detail.candidate[0]===r.chosenGroup))reasons.push('candidate membership does not match chosenGroup');
    }
    return {ok:reasons.length===0,record:records[0],reasons};
  };
  const resolveNodes=(nodeIds,nodeMembership,conflictIds)=>{
    const adjudicated=[],rejected=[],unresolved=[];
    for(const id of nodeIds){
      const detail=nodeMembership?.[id];
      const res=detail&&conflictIds.includes(id)?adjudicate(id,detail):{ok:false,record:null,reasons:[]};
      if(res.ok)adjudicated.push(res.record);else{unresolved.push(id);if(res.record||res.reasons.length)rejected.push({nodeId:id,reasons:res.reasons.length?res.reasons:['record present but node has no declared-vs-rendered conflict']})}
    }
    return {adjudicated,rejected,unresolved};
  };
  const semanticPreservation=originalGroupParity.status==='NOT-CHECKABLE'?{status:'NOT-CHECKABLE',evidence:'original rendered membership comparison unavailable'}:(()=>{
    const sourceConflicts=originalGroupParity.evidence.sourceDeclarationConflictNodeIds??[];
    const mismatches=originalGroupParity.evidence.mismatchedNodeIds??[];
    const affected=[...new Set([...sourceConflicts,...mismatches])];
    const resolution=resolveNodes(affected,originalGroupParity.evidence.nodeMembership,sourceConflicts);
    const method='canonical source declaration vs actual original render vs candidate membership; conflict remains a semantic failure unless an explicit hash-bound user adjudication matches declared group, rendered group, source hash and the candidate chosenGroup';
    const base={method,sourceDeclarationConflictNodeIds:sourceConflicts,candidateVsOriginalMismatchNodeIds:mismatches};
    if(!affected.length)return {status:'PASS',evidence:base};
    if(resolution.unresolved.length)return {status:'FAIL',evidence:{...base,unadjudicatedNodeIds:resolution.unresolved,rejectedAdjudications:resolution.rejected}};
    return {status:'ADJUDICATED',evidence:{...base,adjudications:resolution.adjudicated,note:'authorised by a recorded user decision; this is not a PASS and authorisedBy is recorded, not authenticated'}};
  })();
  // groupMembership and originalGroupParity compare against one side only; an adjudicated decision legitimately departs from one of them.
  if(groupMembership.status==='FAIL'&&originalGroupParity.evidence?.nodeMembership){
    const resolution=resolveNodes(groupMembership.evidence.mismatchedNodeIds,originalGroupParity.evidence.nodeMembership,originalGroupParity.evidence.sourceDeclarationConflictNodeIds);
    if(!resolution.unresolved.length)groupMembership={status:'ADJUDICATED',evidence:{...groupMembership.evidence,adjudications:resolution.adjudicated}};
  }
  if(originalGroupParity.status==='FAIL'){
    const resolution=resolveNodes(originalGroupParity.evidence.mismatchedNodeIds,originalGroupParity.evidence.nodeMembership,originalGroupParity.evidence.sourceDeclarationConflictNodeIds);
    if(!resolution.unresolved.length)originalGroupParity={status:'ADJUDICATED',evidence:{...originalGroupParity.evidence,adjudications:resolution.adjudicated}};
  }
  // Mermaid draws the LAST of several differing definitions of one node; the source is ambiguous, so this is a semantic FAIL like an unadjudicated group conflict.
  const definitionConflicts=model.conflicts??[];
  const sourceDefinitionConflicts=definitionConflicts.length?{status:'FAIL',evidence:{method:'parser: a node defined more than once with different text or shape; Mermaid renders the last definition',nodeIds:definitionConflicts.map(c=>c.nodeId),conflicts:definitionConflicts}}:{status:'PASS',evidence:'every node has at most one distinct definition'};
  const nodeShape={status:'NOT-CHECKABLE',evidence:{reason:'the auditor does not compare drawn node shapes with source shapes; the reviewer judges shapes the rules define',notCheckableShapeNodeIds:model.nodes.filter(n=>NOT_CHECKABLE_SHAPES.has(n.shape)).map(n=>n.id)}};
  if(relations.status!=='PASS')arrowEndStartClearance={status:'NOT-CHECKABLE',evidence:'exact source-to-drawn connector bindings unavailable'};
  const checks={svgWellFormed:{status:'PASS',evidence:'browser XML parser'},nodeIdentity,nodeText,nodeShape,sourceDefinitionConflicts,relations,relationStyle,groups,groupMembership,originalGroupParity,semanticPreservation,textFit,labelFontFit,labelClearance,edgeLabelStyle,labelCoversRoute,nodeHeadingClearance,routeNodeIntrusion,routeHeadingClearance,routeUnrelatedContainerTransit,markerDrawing,arrowEndStartClearance,routePairClearance,routeCrossings,arrowShaft,routeLowerBend,routeDetour,routeContainerClearance,...layout,
    routeGeometry:{status:'NOT-CHECKABLE',evidence:'supported checks cover actual path endpoints, sampled node intrusion, unrelated-container straight-span transit, straight-span crossings/parallel clearance, and final shaft; routeLowerBend adds a witness search (see its limitations); continuous curved-path/label exclusion remains unproved'},
    visualQuality:{status:'NOT-CHECKABLE',evidence:'requires Pi to inspect original and candidate full images plus crops'}};
  const status=Object.values(checks).some(c=>c.status==='FAIL')?'FAIL':'NOT-CHECKABLE';
  return {status,sourceHash:model.sourceHash,svgHash:hash(svgBytes),originalSvgHash,checks,drawnCounts:{nodes:drawn.nodes.length,edges:drawn.edges.length+drawn.groupEdges.length,groups:drawn.groups.length,text:drawn.textCount},...(timing?{timing:{...timings,...Object.fromEntries(Object.entries(drawn.timing??{})),totalMs:performance.now()-wall}}:{})};
}
