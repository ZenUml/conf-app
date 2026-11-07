// Node-move hints for topological crossings (Diagram Rules, "Route-aware node placement"). When no alternative route for either crossing edge
// exists with every node fixed, try single-node translations to the rule's candidate positions (median connection axis of the neighbours and
// direct alignments with each neighbour's axis, snapped to the grid, clamped inside the node's container), re-route only the edges incident
// to the moved node with the existing feasible-route search (every other route fixed) and keep the layout with the fewest crossings.
// Evidence only: the drawing is never modified.
import {checkRouteLowerBend,parseOrthogonalRoute} from './route-lower-bend.mjs';

const EPS=1e-6;
const MARGIN=8;              // container interior / canvas margin kept around a moved node
const NODE_GAP=2;            // minimum clear gap between a moved node and any other node (no overlap, no touching)
const LABEL_GAP=4,HEADING_GAP=4,ROUTE_GAP=8;
export const MAX_NODES=6,MAX_CANDIDATES=200,TIME_CAP_MS=12000,TOTAL_CAP_MS=30000;
const round3=v=>Math.round(v*1000)/1000;
const sign=v=>v>EPS?1:v<-EPS?-1:0;
const median=list=>{const a=[...list].sort((x,y)=>x-y),m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2};
const grow=(b,g)=>({x:b.x-g,y:b.y-g,w:b.w+2*g,h:b.h+2*g});
const overlap=(a,b)=>a.x<b.x+b.w-EPS&&b.x<a.x+a.w-EPS&&a.y<b.y+b.h-EPS&&b.y<a.y+a.h-EPS;
const inside=(outer,inner)=>inner.x>=outer.x-0.25&&inner.y>=outer.y-0.25&&inner.x+inner.w<=outer.x+outer.w+0.25&&inner.y+inner.h<=outer.y+outer.h+0.25;
const shift=(b,dx,dy)=>b&&({...b,x:b.x+dx,y:b.y+dy});
const translate=(n,dx,dy)=>({...n,bbox:shift(n.bbox,dx,dy),outline:shift(n.outline,dx,dy),...(n.samples?{samples:n.samples.map(p=>[p[0]+dx,p[1]+dy])}:{})});

/** Straight spans of a polyline (untrimmed centerlines), in the shape the route search reads. */
function spansOf(points){
  const spans=[];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],axis=Math.abs(a[1]-b[1])<EPS?'h':'v';
    const lo=axis==='h'?Math.min(a[0],b[0]):Math.min(a[1],b[1]),hi=axis==='h'?Math.max(a[0],b[0]):Math.max(a[1],b[1]);
    if(hi-lo>EPS)spans.push({axis,fixed:axis==='h'?a[1]:a[0],lo,hi,length:hi-lo});
  }
  spans.lastCommand='L';
  return spans;
}
function crossings(spanLists){
  let n=0;
  for(let i=0;i<spanLists.length;i++)for(let j=i+1;j<spanLists.length;j++)
    for(const a of spanLists[i]||[])for(const b of spanLists[j]||[]){
      if(a.axis===b.axis)continue;
      const h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;
      if(v.fixed>h.lo+EPS&&v.fixed<h.hi-EPS&&h.fixed>v.lo+EPS&&h.fixed<v.hi-EPS)n++;
    }
  return n;
}
const pairCrosses=(A,B)=>crossings([A||[],B||[]])>0;

/** Largest of 40/20/10/5 that divides at least 70% of the node bounding-box origins, else 10. */
export function gridSpacing(nodes){
  const vals=nodes.flatMap(n=>n.bbox?[n.bbox.x,n.bbox.y]:[]);
  if(!vals.length)return 10;
  for(const g of [40,20,10,5])if(vals.filter(v=>{const r=Math.abs(v/g-Math.round(v/g));return r*g<0.5}).length>=0.7*vals.length)return g;
  return 10;
}

/** @returns {Array<{node,dx,dy}>} candidate translations for one node, nearest first, deduplicated. */
function candidatesFor(node,neighbours,groupBox,canvas,grid,headings){
  const b=node.bbox,cx=b.x+b.w/2,cy=b.y+b.h/2;
  const nx=neighbours.map(n=>n.bbox.x+n.bbox.w/2),ny=neighbours.map(n=>n.bbox.y+n.bbox.h/2);
  const xs=[...(nx.length?[median(nx)]:[]),...nx],ys=[...(ny.length?[median(ny)]:[]),...ny];
  const frame=groupBox?{x:groupBox.x+MARGIN,y:groupBox.y+MARGIN,w:groupBox.w-2*MARGIN,h:groupBox.h-2*MARGIN}
    :canvas?{x:canvas.x+MARGIN,y:canvas.y+MARGIN,w:canvas.w-2*MARGIN,h:canvas.h-2*MARGIN}:null;
  const snap=v=>Math.round(v/grid)*grid;
  const fit=(left,top)=>{
    left=snap(left);top=snap(top);
    if(frame){
      const loX=Math.ceil((frame.x)/grid)*grid,hiX=Math.floor((frame.x+frame.w-b.w)/grid)*grid;
      const loY=Math.ceil((frame.y)/grid)*grid,hiY=Math.floor((frame.y+frame.h-b.h)/grid)*grid;
      if(loX>hiX||loY>hiY)return null;
      left=Math.min(Math.max(left,loX),hiX);top=Math.min(Math.max(top,loY),hiY);
    }
    return [left,top];
  };
  const out=new Map();
  const add=(tx,ty)=>{
    const p=fit(tx-b.w/2,ty-b.h/2);if(!p)return;
    const dx=round3(p[0]-b.x),dy=round3(p[1]-b.y);
    if(Math.abs(dx)<EPS&&Math.abs(dy)<EPS)return;
    out.set(`${dx},${dy}`,{dx,dy});
  };
  // an alignment keeps its axis; the free axis may also slide a few grid steps so the node clears whatever stands at the aligned spot
  const step=Math.max(grid,20),SLIDES=[0,1,-1,2,-2,3,-3].map(k=>k*step/grid);
  for(const x of xs)for(const k of SLIDES)add(x,cy+k*grid);
  for(const y of ys)for(const k of SLIDES)add(cx+k*grid,y);
  for(const x of xs.slice(0,1))for(const y of ys.slice(0,1))add(x,y);
  for(const x of nx)for(const y of ny)add(x,y);
  return [...out.values()].sort((a,c)=>Math.abs(a.dx)+Math.abs(a.dy)-Math.abs(c.dx)-Math.abs(c.dy));
}

/**
 * Attach `moveHint` to routeCrossings violations whose repairHint is null.
 * moveHint:{node,dx,dy,reroutes:[{edge,points}],crossingsBefore,crossingsAfter} or null with `moveHintReason`.
 */
export function attachNodeMoveHints(input,violations,{canvas=null,maxCandidates=MAX_CANDIDATES,timeCapMs=TIME_CAP_MS,totalCapMs=TOTAL_CAP_MS,now=()=>Date.now()}={}){
  const {nodes,groups,labelBoxes=[]}=input;
  const edges=input.edges.map(e=>{const r=e.tag==='path'?parseOrthogonalRoute(e.path):null;return {...e,routePoints:r&&!r.error?r:null}});
  input={...input,edges};
  const todo=violations.filter(v=>!v.repairHint);
  if(!todo.length)return violations;
  const nodeById=new Map(nodes.map(n=>[n.id,n]));
  const edgeId=e=>`${e.source}->${e.target}`;
  const spansBefore=edges.map(e=>e.spans||[]);
  const before=crossings(spansBefore);
  const grid=gridSpacing(nodes);
  const labels=labelBoxes.map(l=>l.box).filter(Boolean);
  const proper=groups.filter(g=>g.box);
  const t0=now();
  for(const v of todo){
    v.moveHint=null;
    try{
      const started=now(),cap=Math.max(0,Math.min(timeCapMs,totalCapMs-(started-t0)));
      let tried=0,best=null,why=null;
      const ends=[...new Set([v.edgeA,v.edgeB].flatMap(id=>id.split('->')))].filter(id=>nodeById.has(id));
      const neighboursOf=id=>[...new Set(edges.flatMap(e=>e.source===id?[e.target]:e.target===id?[e.source]:[]))].filter(x=>x!==id&&nodeById.get(x)?.bbox);
      const pool=[...ends];
      for(const id of ends)for(const nb of neighboursOf(id))if(!pool.includes(nb)&&pool.length<MAX_NODES)pool.push(nb);
      const order=pool.slice(0,MAX_NODES);
      const perNode=order.map(id=>({id,list:[]}));
      for(const slot of perNode){
        const n=nodeById.get(slot.id);
        if(!n?.bbox||!n.outline&&n.kind==='rect'){continue}
        const nbs=neighboursOf(slot.id).map(x=>nodeById.get(x));
        const home=proper.filter(g=>g.id!==n.id&&inside(g.box,n.bbox)).sort((a,b)=>a.box.w*a.box.h-b.box.w*b.box.h)[0];
        slot.list=candidatesFor(n,nbs,home?.box??null,home?null:canvas,grid);
      }
      // interleave nodes so the candidate cap does not starve later nodes
      const queue=[];
      for(let k=0;perNode.some(s=>k<s.list.length);k++)for(const s of perNode)if(k<s.list.length)queue.push({id:s.id,...s.list[k]});
      for(const cand of queue){
        if(tried>=maxCandidates){why=`candidate cap ${maxCandidates} reached`;break}
        if(now()-started>=cap){why=`time cap ${cap} ms reached`;break}
        tried++;
        const r=tryMove({input,nodeById,edges,grid,labels,proper,canvas,cand,spansBefore,before,pair:[v.edgeA,v.edgeB]});
        if(!r)continue;
        const key=[r.crossingsAfter,r.bends,r.length,Math.abs(cand.dx)+Math.abs(cand.dy)];
        if(!best||cmp(key,best.key)<0)best={key,hint:{node:cand.id,dx:cand.dx,dy:cand.dy,reroutes:r.reroutes,crossingsBefore:before,crossingsAfter:r.crossingsAfter}};
      }
      if(best)v.moveHint=best.hint;
      else v.moveHintReason=`no single-node move found: ${tried} candidate translation${tried===1?'':'s'} of ${order.length} node${order.length===1?'':'s'} (${order.join(', ')}) tried; none keeps every incident edge routable and reduces crossings${why?`; ${why}`:''}`;
    }catch(error){v.moveHint=null;v.moveHintReason=`no single-node move found: node-move search failed: ${error?.message??error}`}
  }
  return violations;
}
const cmp=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0};

function tryMove({input,nodeById,edges,grid,labels,proper,canvas,cand,spansBefore,before,pair}){
  const {nodes}=input;
  const n=nodeById.get(cand.id),{dx,dy}=cand;
  const moved=translate(n,dx,dy),mb=moved.bbox;
  // placement: canvas, container interior, other nodes, labels, headings, other containers, fixed routes
  if(canvas&&!inside({x:canvas.x+MARGIN,y:canvas.y+MARGIN,w:canvas.w-2*MARGIN,h:canvas.h-2*MARGIN},mb))return null;
  const homeBefore=proper.filter(g=>g.id!==n.id&&inside(g.box,n.bbox));
  for(const g of proper){
    if(g.id===n.id)continue;
    const was=homeBefore.includes(g);
    if(was){if(!inside({x:g.box.x+MARGIN,y:g.box.y+MARGIN,w:g.box.w-2*MARGIN,h:g.box.h-2*MARGIN},mb))return null;for(const h of g.headings||[])if(overlap(grow(mb,HEADING_GAP),h))return null}
    else{if(overlap(g.box,mb))return null;for(const h of g.headings||[])if(overlap(grow(mb,HEADING_GAP),h))return null}
  }
  for(const o of nodes){if(o.id===n.id||!o.bbox)continue;if(overlap(grow(mb,NODE_GAP/2),grow(o.bbox,NODE_GAP/2)))return null;if(proper.some(g=>g.id===o.id&&overlap(g.box,mb)))return null}
  for(const l of labels)if(overlap(grow(mb,LABEL_GAP),l))return null;
  const incident=edges.map((e,i)=>({e,i})).filter(({e})=>e.source===n.id||e.target===n.id);
  if(!incident.length)return null;
  if(incident.some(({e})=>e.trunk))return null;
  const inc=new Set(incident.map(x=>x.i));
  for(let i=0;i<edges.length;i++){
    if(inc.has(i))continue;
    for(const s of spansBefore[i]){
      const r=grow(mb,ROUTE_GAP);
      const hit=s.axis==='h'?s.fixed>r.y&&s.fixed<r.y+r.h&&Math.min(s.hi,r.x+r.w)-Math.max(s.lo,r.x)>EPS:s.fixed>r.x&&s.fixed<r.x+r.w&&Math.min(s.hi,r.y+r.h)-Math.max(s.lo,r.y)>EPS;
      if(hit)return null;
    }
    const hulls=edges[i].hulls||[];
    for(const h of hulls)if(overlap(mb,h))return null;
  }
  // moved geometry + incident routes: each incident route is re-searched with the previous ones fixed and the not-yet-searched ones removed
  const movedNodes=nodes.map(o=>o.id===n.id?moved:o);
  const newSpans=spansBefore.map((s,i)=>inc.has(i)?[]:s);
  const reroutes=[];let bends=0,length=0;
  const routes=new Map();
  for(const {e,i} of incident){
    const id=`${e.source}->${e.target}`;
    const base=e.routePoints;
    if(!base)return null;
    const P=base.points,m=P.length;
    const srcMoved=e.source===n.id,tgtMoved=e.target===n.id;
    const dIn=[sign(P[1][0]-P[0][0]),sign(P[1][1]-P[0][1])],dOut=[sign(P[m-1][0]-P[m-2][0]),sign(P[m-1][1]-P[m-2][1])];
    const S=srcMoved?[P[0][0]+dx,P[0][1]+dy]:P[0],T=tgtMoved?[P[m-1][0]+dx,P[m-1][1]+dy]:P[m-1];
    // a synthetic drawn route that keeps the endpoint anchors and leaving/arriving directions; the search uses only these
    const pts=[S,[S[0]+dIn[0],S[1]+dIn[1]],[T[0]-dOut[0],T[1]-dOut[1]],T];
    routes.set(id,{points:pts,bends:2,trim:base.trim,measuredTrim:base.measuredTrim});
  }
  for(const {e,i} of incident){
    const id=`${e.source}->${e.target}`;
    const probe=edges.map((o,j)=>j===i?o:{...o,spans:newSpans[j],hulls:inc.has(j)&&!reroutes.some(r=>r.i===j)?[]:o.hulls});
    const res=checkRouteLowerBend({...input,nodes:movedNodes,edges:probe},{mode:'hint',hintEdges:[id],canvas,routeOverrides:routes}).hints[id];
    if(!res?.hint){if(process.env.NMH_DEBUG)console.error('NOROUTE',cand.id,cand.dx,cand.dy,id,res?.reason);return null}
    newSpans[i]=spansOf(res.hint.points);
    reroutes.push({i,edge:id,points:res.hint.points});
    bends+=res.hint.bends;length+=res.hint.length;
  }
  const after=crossings(newSpans);
  if(!(after<before)){if(process.env.NMH_DEBUG)console.error('NOGAIN',cand.id,cand.dx,cand.dy,after,before);return null}
  const ia=edges.findIndex(e=>edgeKey(e)===pair[0]),ib=edges.findIndex(e=>edgeKey(e)===pair[1]);
  if(ia>=0&&ib>=0&&pairCrosses(newSpans[ia],newSpans[ib]))return null;
  return {crossingsAfter:after,bends,length,reroutes:reroutes.map(({edge,points})=>({edge,points:points.map(p=>p.map(round3))}))};
}
const edgeKey=e=>`${e.source}->${e.target}`;
