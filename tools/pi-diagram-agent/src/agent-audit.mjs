import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {parseMermaid,NOT_CHECKABLE_SHAPES} from './parser.mjs';
import {isAcceptedTrunkOverlap,summariseTrunks,unrecognisedTrunkAttributes,TRUNK_HINT} from './trunk.mjs';

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
  const spans=[];let point=null,lastCommand=null;
  for(let i=0;i<tokens.length;){
    const command=tokens[i++],arity={M:2,L:2,Q:4,A:7}[command];
    lastCommand=command;
    if(!arity||i+arity>tokens.length)return null;
    const args=tokens.slice(i,i+arity).map(Number);i+=arity;
    if(!args.every(Number.isFinite))return null;
    const next=command==='A'?[args[5],args[6]]:[args.at(-2),args.at(-1)];
    if(command==='M'){point=next;continue}
    if(!point)return null;
    if(command==='L'){
      const axis=Math.abs(point[1]-next[1])<eps?'h':Math.abs(point[0]-next[0])<eps?'v':null;
      if(!axis)return null;
      const lo=axis==='h'?Math.min(point[0],next[0]):Math.min(point[1],next[1]);
      const hi=axis==='h'?Math.max(point[0],next[0]):Math.max(point[1],next[1]);
      if(hi-lo>eps)spans.push({axis,fixed:axis==='h'?point[1]:point[0],lo,hi,length:hi-lo,end:axis==='h'?next[0]:next[1]});
    }
    point=next;
  }
  spans.lastCommand=lastCommand;
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
export async function auditAgentSvg(source,svg,{originalSvg=null,playwrightModulePath=process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE,browserExecutablePath=process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE,adjudications=[]}={}){
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
  let drawn,originalDrawn=null,originalSvgHash=null;
  try{
    const page=await browser.newPage({javaScriptEnabled:false});
    await page.route('**/*',route=>route.abort('blockedbyclient'));
    drawn=await page.evaluate(input=>{
      const doc=new DOMParser().parseFromString(input,'image/svg+xml');
      if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')return {parseError:true};
      const root=document.importNode(doc.documentElement,true);
      document.body.appendChild(root);
      const box=el=>{const r=el.getBBox();return {x:r.x,y:r.y,w:r.width,h:r.height}};
      const nodes=[...root.querySelectorAll('g[data-node],g[data-node-id]')].map(el=>({id:el.getAttribute('data-node')??el.getAttribute('data-node-id'),text:[...el.querySelectorAll('text')].map(t=>t.textContent).join(' '),shapeCount:el.querySelectorAll('rect,path,ellipse,polygon').length,box:box(el)}));
      const nodeShapes=new Map([...root.querySelectorAll('g[data-node],g[data-node-id]')].map(el=>[el.getAttribute('data-node')??el.getAttribute('data-node-id'),[...el.querySelectorAll('rect,path,ellipse,polygon')].filter(shape=>shape instanceof SVGGeometryElement&&getComputedStyle(shape).fill!=='none')]));
      const headingBoxes=[...root.querySelectorAll('g[data-group],g[data-container-id],g[id^="group-"]')].flatMap(group=>[...group.querySelectorAll(':scope > text')].map(text=>({groupId:group.getAttribute('data-group')??group.getAttribute('data-container-id')??group.id?.slice(6),box:box(text)})));
      const edges=[...root.querySelectorAll('[data-source][data-target]')].map(el=>{
        const source=el.getAttribute('data-source'),target=el.getAttribute('data-target');
        const result={source,target,tag:el.localName,path:el.getAttribute('d')??el.getAttribute('points')??'',marker:el.getAttribute('marker-end'),trunk:el.getAttribute('data-shared-trunk'),trunkLikeAttributes:[...el.attributes].filter(x=>/bus|trunk|merge|junction|shared/i.test(x.name)).map(x=>({name:x.name,value:x.value}))};
        const dash=getComputedStyle(el).strokeDasharray;
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
        result.markerDrawing={found:!!marker,shapeCount:markerChildren.length,visible:!!markerStyle&&markerStyle.fill!=='none'&&markerStyle.fill!=='rgba(0, 0, 0, 0)'&&markerStyle.display!=='none'&&markerStyle.visibility==='visible'&&Number(markerStyle.opacity)>0&&!!markerBox&&markerBox.width>0&&markerBox.height>0&&Math.abs(markerDeterminant)>1e-8,colorMatches:!!markerStyle&&(markerStyle.fill===edgeStroke||markerStyle.fill==='context-stroke'),axialLength};
        if(!(el instanceof SVGGeometryElement))return result;
        const length=el.getTotalLength();
        const start=el.getPointAtLength(0),end=el.getPointAtLength(length);
        const touches=(id,point)=>nodeShapes.get(id)?.some(shape=>shape.isPointInStroke(point))??false;
        const intruded=new Set(),headingIntrusions=new Set();
        const count=Math.min(10000,Math.max(1,Math.ceil(length/2)));
        for(let i=0;i<=count;i++){
          const at=length*i/count;
          const point=el.getPointAtLength(at);
          for(const [id,shapes] of nodeShapes){
            if((id===source&&at<8)||(id===target&&length-at<12))continue;
            if(shapes.some(shape=>shape.isPointInFill(point)))intruded.add(id);
          }
          for(const heading of headingBoxes){const r=heading.box;if(point.x>=r.x-2&&point.x<=r.x+r.w+2&&point.y>=r.y-2&&point.y<=r.y+r.h+2)headingIntrusions.add(heading.groupId)}
        }
        result.geometry={length,step:length/count,startOnSource:touches(source,start),endOnTarget:touches(target,end),intrudedNodeIds:[...intruded],intrudedHeadingGroupIds:[...headingIntrusions]};
        return result;
      });
      const groups=[...root.querySelectorAll('g[data-group],g[data-container-id],g[id^="group-"]')].map(el=>{const shape=el.querySelector(':scope > rect,:scope > path,:scope > polygon');return {id:el.getAttribute('data-group')??el.getAttribute('data-container-id')??el.getAttribute('id')?.slice(6),box:shape?box(shape):null,outline:shape?.localName,cornerRadius:shape?.localName==='rect'?Math.max(Number(shape.getAttribute('rx')||0),Number(shape.getAttribute('ry')||0)):null,nestedNodeIds:[...el.querySelectorAll('g[data-node],g[data-node-id]')].map(n=>n.getAttribute('data-node')??n.getAttribute('data-node-id'))}});
      // Geometry for textFit/labelClearance is measured in root user space so node transforms and the viewBox cannot change the 12-unit inset.
      const rootBox=el=>{
        const m=root.getScreenCTM().inverse().multiply(el.getScreenCTM()),r=el.getBBox();
        const pts=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
        const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
        return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),axisAligned:Math.abs(m.b)<1e-6&&Math.abs(m.c)<1e-6};
      };
      const union=boxes=>{const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y}};
      const shapeSelector='rect,path,ellipse,polygon,circle';
      const fitNodes=[...root.querySelectorAll('g[data-node],g[data-node-id]')].map(el=>{
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
      // B5: an edge label is its text plus any background rect; outlines are node and container shape strokes.
      const labelEpsilon=0.5,sampleStep=0.5;
      const labelElements=[...root.querySelectorAll('g[data-edge-label-source][data-edge-label-target]')].map(el=>({label:`${el.getAttribute('data-edge-label-source')}->${el.getAttribute('data-edge-label-target')}`,parts:[...el.querySelectorAll('text,rect')].map(rootBox)})).filter(l=>l.parts.length);
      const outlineShapes=[
        ...[...root.querySelectorAll('g[data-node],g[data-node-id]')].flatMap(g=>[...g.querySelectorAll(shapeSelector)].map(shape=>({name:`node:${g.getAttribute('data-node')??g.getAttribute('data-node-id')}`,shape}))),
        ...[...root.querySelectorAll('g[data-group],g[data-container-id],g[id^="group-"]')].flatMap(g=>[...g.querySelectorAll(':scope > rect,:scope > path,:scope > polygon')].map(shape=>({name:`group:${g.getAttribute('data-group')??g.getAttribute('data-container-id')??g.id?.slice(6)}`,shape})))
      ];
      const labelViolations=[],labelUnsupported=[];
      for(const item of labelElements){
        const box=union(item.parts);
        for(const {name,shape} of outlineShapes){
          const style=getComputedStyle(shape),sw=style.stroke!=='none'?Number.parseFloat(style.strokeWidth)||0:0,half=sw/2+labelEpsilon;
          const b=rootBox(shape);
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
            const inverse=root.getScreenCTM().inverse().multiply(shape.getScreenCTM()).inverse();
            let stroke=false,inFill=false,outFill=false;
            for(let i=0;i<=cols&&!stroke;i++)for(let j=0;j<=rows;j++){
              const point=new DOMPoint(box.x-labelEpsilon+i*sampleStep,box.y-labelEpsilon+j*sampleStep).matrixTransform(inverse);
              if(shape.isPointInStroke(point)){stroke=true;break}
              if(shape.isPointInFill(point))inFill=true;else outFill=true;
            }
            hit=stroke||(sw===0&&inFill&&outFill)||(name.startsWith('node:')&&inFill);
          }else{labelUnsupported.push({label:item.label,outline:name,reason:'outline is not a geometry element'});continue}
          if(hit)labelViolations.push({label:item.label,outline:name,labelBox:box});
        }
      }
      const textCount=root.querySelectorAll('text').length;
      root.remove();
      return {parseError:false,nodes,edges,groups,textCount,fitNodes,labelCount:labelElements.length,boundLabels:labelElements.map(l=>l.label),labelViolations,labelUnsupported};
    },svgText);
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
  // T2/labelBox: rectangles and capsules use the node outline inset by 12 units; other shapes need an explicitly declared labelBox.
  const textFit=(()=>{
    const inset=12,tolerance=0.01,overflows=[],notCheckableNodeIds=[],reasons={};
    for(const node of drawn.fitNodes){
      if(node.kind==='unsupported'){notCheckableNodeIds.push(node.id);reasons[node.id]=node.reason;continue}
      const box=node.kind==='rect'?{x:node.outline.x+inset,y:node.outline.y+inset,w:node.outline.w-2*inset,h:node.outline.h-2*inset}:node.labelBox;
      const left=Math.max(0,box.x-Math.min(...node.texts.map(t=>t.x))),top=Math.max(0,box.y-Math.min(...node.texts.map(t=>t.y)));
      const right=Math.max(0,Math.max(...node.texts.map(t=>t.x+t.w))-(box.x+box.w)),bottom=Math.max(0,Math.max(...node.texts.map(t=>t.y+t.h))-(box.y+box.h));
      if(node.texts.length&&[left,top,right,bottom].some(v=>v>tolerance))overflows.push({nodeId:node.id,left,top,right,bottom});
    }
    const method='browser getBBox of every text bound to the node versus the node outline inset by 12 units (rect/capsule) or its declared data-label-box; non-rect shapes without a declared labelBox are never inferred';
    const status=overflows.length?'FAIL':notCheckableNodeIds.length||!drawn.fitNodes.length?'NOT-CHECKABLE':'PASS';
    return {status,evidence:{method,inset,overflows,notCheckableNodeIds,reasons,checkedNodes:drawn.fitNodes.length-notCheckableNodeIds.length}};
  })();
  // B5: label text+background bbox versus every node/container outline stroke. Epsilon 0.5 units each side absorbs sub-pixel measurement; it is not a design clearance.
  const labelClearance=(()=>{
    const method='browser bbox of edge-label text and background rect (g[data-edge-label-source][data-edge-label-target]) versus node and container outline strokes, 0.5-unit epsilon; rounded or non-rect outlines sampled at 0.5 units';
    const violations=drawn.labelViolations,unsupported=drawn.labelUnsupported;
    // Every labelled source edge needs its own bound label drawing; a partially tagged candidate cannot PASS on the labels it chose to tag.
    let unboundLabels=null;
    if(model){const bound=multiset(drawn.boundLabels);unboundLabels=[];for(const e of model.edges.filter(e=>norm(e.label))){const key=`${e.source}->${e.target}`;if(bound.get(key))bound.set(key,bound.get(key)-1);else unboundLabels.push(key)}}
    const unbound=!model||unboundLabels.length>0;
    const status=violations.length?'FAIL':unbound||unsupported.length?'NOT-CHECKABLE':'PASS';
    return {status,evidence:{method,epsilon:0.5,violations,unsupported,checkedLabels:drawn.labelCount,...(unbound?{unboundLabels,reason:model?'a labelled source edge has no bound edge-label drawing':'source labels cannot be established'}:{})}};
  })();
  if(!model){
    const unresolved={status:'NOT-CHECKABLE',evidence:`source parser cannot establish independent semantic bindings: ${modelError}`};
    return {status:[textFit,labelClearance].some(c=>c.status==='FAIL')?'FAIL':'NOT-CHECKABLE',sourceHash:hash(sourceBytes),svgHash:hash(svgBytes),checks:{svgWellFormed:{status:'PASS',evidence:'browser XML parser'},nodeIdentity:unresolved,nodeText:unresolved,relations:unresolved,groups:unresolved,groupMembership:unresolved,textFit,labelClearance,routeGeometry:{status:'NOT-CHECKABLE',evidence:'independent geometry proof unavailable'},visualQuality:{status:'NOT-CHECKABLE',evidence:'requires original/candidate visual inspection'}},drawnCounts:{nodes:drawn.nodes.length,edges:drawn.edges.length,groups:drawn.groups.length,text:drawn.textCount}};
  }
  const expectedNodes=multiset(model.nodes.map(n=>n.id)),actualNodes=multiset(drawn.nodes.map(n=>n.id));
  const nodeIdentity=drawn.nodes.length?{status:equalSets(expectedNodes,actualNodes)?'PASS':'FAIL',evidence:{expected:model.nodes.length,drawn:drawn.nodes.length,missing:model.nodes.filter(n=>!actualNodes.has(n.id)).map(n=>n.id),extra:drawn.nodes.filter(n=>!expectedNodes.has(n.id)).map(n=>n.id)}}:{status:'NOT-CHECKABLE',evidence:'no neutral per-node semantic binding; SVG may still be visually valid'};
  const textMismatches=drawn.nodes.filter(n=>{const sourceNode=model.nodes.find(x=>x.id===n.id);return sourceNode&&norm(sourceNode.text)!==norm(n.text)}).map(n=>n.id);
  const nodeText=nodeIdentity.status==='PASS'?{status:textMismatches.length?'FAIL':'PASS',evidence:{mismatchedNodeIds:textMismatches,method:'actual text descendants; whitespace-normalized'}}:{status:'NOT-CHECKABLE',evidence:'node identities unavailable or mismatched'};
  const expectedEdges=multiset(model.edges.map(e=>`${e.source}\0${e.target}`)),actualEdges=multiset(drawn.edges.map(e=>`${e.source}\0${e.target}`));
  const malformedEdges=drawn.edges.filter(e=>!['path','polyline','line'].includes(e.tag)||!e.path&&e.tag!=='line'||!e.marker).map(e=>`${e.source}->${e.target}`);
  const caveats=model.notCheckable??[];
  const relations=caveats.length?{status:'NOT-CHECKABLE',evidence:{reason:'the source has relations the auditor cannot verify against a drawn directed marker (not checkable)',constructs:[...new Set(caveats.map(c=>c.construct))],lines:caveats.map(c=>c.line)}}:drawn.edges.length?{status:equalSets(expectedEdges,actualEdges)&&malformedEdges.length===0?'PASS':'FAIL',evidence:{expected:model.edges.length,drawn:drawn.edges.length,malformedEdges,method:'visible path/polyline/line elements with source-target bindings'}}:{status:'NOT-CHECKABLE',evidence:'no neutral per-relation semantic binding; SVG may still be visually valid'};
  const relationStyle=relations.status==='PASS'?(()=>{
    const mismatches=[],ambiguous=[];
    for(const drawnEdge of drawn.edges){
      const expected=model.edges.filter(e=>e.source===drawnEdge.source&&e.target===drawnEdge.target);
      if(expected.length!==1){ambiguous.push(`${drawnEdge.source}->${drawnEdge.target}`);continue}
      if(drawnEdge.dashed!==(expected[0].style==='dashed'))mismatches.push(`${drawnEdge.source}->${drawnEdge.target}`);
    }
    const thick=model.edges.filter(e=>e.thick).map(e=>`${e.source}->${e.target}`);
    // Only dashing is measured; a thick source relation drawn thin must not PASS by default.
    return {status:mismatches.length?'FAIL':ambiguous.length||thick.length?'NOT-CHECKABLE':'PASS',evidence:{method:'source Mermaid edge style against actual computed SVG stroke-dasharray; parallel same-endpoint relations require independent ID binding',mismatches,ambiguous,checkedEdges:drawn.edges.length-ambiguous.length,...(thick.length?{thickEdges:thick,reason:'thick source relations: stroke weight is not compared (not checkable)'}:{})}};
  })():{status:'NOT-CHECKABLE',evidence:'directed relation binding unavailable'};
  const markerDrawing=relations.status==='PASS'?(()=>{
    const mismatches=drawn.edges.filter(e=>!e.markerDrawing?.found||e.markerDrawing.shapeCount!==1||!e.markerDrawing.visible||!e.markerDrawing.colorMatches).map(e=>`${e.source}->${e.target}`);
    return {status:mismatches.length?'FAIL':'PASS',evidence:{method:'actual marker child shape, computed paint/visibility, nonzero transform and path stroke color; marker silhouette and clipping not proved',mismatchedEdges:mismatches,checkedEdges:drawn.edges.length}};
  })():{status:'NOT-CHECKABLE',evidence:'exact relation binding unavailable'};
  const routeNodeIntrusion=relations.status==='PASS'&&drawn.edges.every(e=>e.geometry)?(()=>{
    const endpointErrors=drawn.edges.filter(e=>!e.geometry.startOnSource||!e.geometry.endOnTarget).map(e=>`${e.source}->${e.target}`);
    const intrusions=drawn.edges.filter(e=>e.geometry.intrudedNodeIds.length).map(e=>({edge:`${e.source}->${e.target}`,nodeIds:e.geometry.intrudedNodeIds}));
    return {status:endpointErrors.length||intrusions.length?'FAIL':'PASS',evidence:{method:'Chromium actual SVG path endpoints versus shape strokes; path sampled at <=2 SVG units against actual node fills; source first 8 and target last 12 units exempted',endpointErrors,intrusions,checkedEdges:drawn.edges.length}};
  })():{status:'NOT-CHECKABLE',evidence:'exact relation binding or SVG geometry API unavailable'};
  const routeHeadingClearance=relations.status==='PASS'&&drawn.edges.every(e=>e.geometry)?(()=>{
    const intrusions=drawn.edges.filter(e=>e.geometry.intrudedHeadingGroupIds.length).map(e=>({edge:`${e.source}->${e.target}`,groupIds:e.geometry.intrudedHeadingGroupIds}));
    return {status:intrusions.length?'FAIL':'PASS',evidence:{method:'actual SVG path sampled at <=2 units against drawn group heading text bounds plus 2-unit guard',intrusions,checkedEdges:drawn.edges.length}};
  })():{status:'NOT-CHECKABLE',evidence:'actual path or group heading bounds unavailable'};
  const routeSpans=drawn.edges.map(e=>({edge:`${e.source}->${e.target}`,spans:actualStraightSpans(e.path)}));
  const routePairClearance=relations.status==='PASS'&&routeSpans.every(e=>e.spans)?(()=>{
    const violations=[],accepted=[];
    const routes=routeSpans.map((e,i)=>({edge:e.edge,spans:e.spans,lastCommand:e.spans.lastCommand,trunk:drawn.edges[i].trunk||null,target:drawn.edges[i].target}));
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
    const unrecognisedTrunkAttributes_=drawn.edges.flatMap(e=>unrecognisedTrunkAttributes(e.trunkLikeAttributes??[]).map(a=>({edge:`${e.source}->${e.target}`,attribute:a.name,value:a.value})));
    return {status:violations.length?'FAIL':'PASS',evidence:{method:'strict M/L/Q/A parser of actual SVG d; every drawn straight centerline span pair after curve trims; coincident or sub-10 spans are accepted only as the final portion shared at one target by connectors carrying the same data-shared-trunk id; no other bus exception inferred',violations,trunks:summariseTrunks(accepted),unrecognisedTrunkAttributes:unrecognisedTrunkAttributes_,...(unrecognisedTrunkAttributes_.length?{hint:TRUNK_HINT}:{}),checkedEdges:routeSpans.length}};
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
    return {status:violations.length?'FAIL':'PASS',evidence:{method:'exact interior intersections among actual straight SVG centerline spans after fillet trims; curved portions and declared junction topology remain outside this subcheck',violations,checkedEdges:routeSpans.length}};
  })():{status:'NOT-CHECKABLE',evidence:'edge drawing uses unsupported SVG path grammar or exact relation binding unavailable'};
  const arrowShaft=relations.status==='PASS'&&routeSpans.every(e=>e.spans?.length&&e.spans.lastCommand==='L')&&drawn.edges.every(e=>Number.isFinite(e.markerDrawing?.axialLength))?(()=>{
    const failures=routeSpans.flatMap((e,i)=>{const required=drawn.edges[i].markerDrawing.axialLength+8;return e.spans.at(-1).length<required-eps?[{edge:e.edge,drawnLastShaft:e.spans.at(-1).length,required}]:[]});
    return {status:failures.length?'FAIL':'PASS',evidence:{method:'actual post-curve final straight segment >= measured simple marker axial length + 8-unit visible shaft; complex viewBox marker stays unresolved',failures,checkedEdges:routeSpans.length}};
  })():{status:'NOT-CHECKABLE',evidence:'actual final straight span or simple marker axial geometry unavailable'};
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
        const expected=sourceNode.groupPath??(sourceNode.group?[sourceNode.group]:[]);
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
        const declared=node.groupPath??(node.group?[node.group]:[]);
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
  const checks={svgWellFormed:{status:'PASS',evidence:'browser XML parser'},nodeIdentity,nodeText,nodeShape,sourceDefinitionConflicts,relations,relationStyle,groups,groupMembership,originalGroupParity,semanticPreservation,textFit,labelClearance,routeNodeIntrusion,routeHeadingClearance,routeUnrelatedContainerTransit,markerDrawing,routePairClearance,routeCrossings,arrowShaft,
    routeGeometry:{status:'NOT-CHECKABLE',evidence:'supported checks cover actual path endpoints, sampled node intrusion, unrelated-container straight-span transit, straight-span crossings/parallel clearance, and final shaft; continuous curved-path/label exclusion and finite lower-bend/midpoint optimality witnesses remain unproved'},
    visualQuality:{status:'NOT-CHECKABLE',evidence:'requires Pi to inspect original and candidate full images plus crops'}};
  const status=Object.values(checks).some(c=>c.status==='FAIL')?'FAIL':'NOT-CHECKABLE';
  return {status,sourceHash:model.sourceHash,svgHash:hash(svgBytes),originalSvgHash,checks,drawnCounts:{nodes:drawn.nodes.length,edges:drawn.edges.length,groups:drawn.groups.length,text:drawn.textCount}};
}
