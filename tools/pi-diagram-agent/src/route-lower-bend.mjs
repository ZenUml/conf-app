// Independent lower-bend / midpoint-anchor witness search (Diagram Rules: "Mandatory lower-bend route search",
// connector rules 1-2, 6, 12-14). Pure geometry over measured browser data; no DOM and no source semantics.
//
// Soundness model: every obstacle is either certain (measured, blocks a candidate) or uncertain (a curve hull of
// another route, an unparsed route, an unbound label). A candidate is "yes" only when feasible against certain AND
// uncertain obstacles, "maybe" when feasible against certain obstacles only. FAIL needs a "yes" witness; PASS needs
// that no candidate is even "maybe"; anything between is NOT-CHECKABLE. Overall status can therefore never become
// PASS because of an unmeasured obstacle.
//
// Shapes: rectangles use their four faces (inset by the corner radius); any other node supplies sampled outline points and its
// ports come from shape-ports.mjs (apex points / flat faces read from the drawn outline). Unsupported silhouettes make that
// relationship NOT-CHECKABLE. A non-rectangular unrelated node blocks a leg only through its convex hull; a leg that only
// touches its bounding box is "maybe" (never a PASS), and a node with no usable outline falls back to its bounding box as "maybe".
//
// Shared trunks (rule 10): when a connector is an accepted member of a declared data-shared-trunk (its final span coincides with a
// partner's, same target and end), its witness must keep that trunk, so the target anchor is pinned to the drawn trunk entry and the
// final leg may coincide with partners' final spans. A witness that would leave the trunk is not a witness.
import {derivePorts,hullSpanAt} from './shape-ports.mjs';
import {isAcceptedTrunkOverlap} from './trunk.mjs';
const EPS=1e-6;
const GUARD=1;                 // clearance (units) kept between a candidate leg and a node/container/label rectangle
const HEADING_GUARD=2;         // matches the existing heading-clearance guard
const PARALLEL_CLEARANCE=10;   // rule 14
const DEFAULT_TRIM=5;          // rule 3 fillet radius when the drawn route has no fillet to measure
const SHAFT=8;                 // rule 13 visible shaft
const MIDPOINT_TOLERANCE=0.5;  // anchor distance difference below this is measurement noise
const SAMPLE_STEP=4,MAX_SAMPLES=40;

const round3=v=>Math.round(v*1000)/1000;
const tokenRe=/\s*,?\s*([MLQA]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;
function tokenize(d){
  const tokens=[];let at=0;
  while(at<d.length){if(!d.slice(at).trim())break;tokenRe.lastIndex=at;const m=tokenRe.exec(d);if(!m)return null;tokens.push(m[1]);at=tokenRe.lastIndex}
  return tokens;
}
const sign=v=>v>EPS?1:v<-EPS?-1:0;

/** Reconstruct the logical orthogonal route of an actual SVG path. A fillet (Q whose control point is the corner, or a
 * quarter arc) is one bend; a corner split across segments is one bend; anything else is unsupported, never guessed. */
export function parseOrthogonalRoute(d){
  const tokens=typeof d==='string'?tokenize(d):null;
  if(!tokens||!tokens.length)return {error:'path grammar unsupported or empty'};
  const raw=[];let cur=null,trim=0;
  for(let i=0;i<tokens.length;){
    const command=tokens[i++],arity={M:2,L:2,Q:4,A:7}[command];
    if(!arity||i+arity>tokens.length)return {error:'path grammar unsupported'};
    const a=tokens.slice(i,i+arity).map(Number);i+=arity;
    if(!a.every(Number.isFinite))return {error:'path grammar unsupported'};
    if(command==='M'){if(raw.length)return {error:'multiple subpaths'};cur=[a[0],a[1]];raw.push(cur);continue}
    if(!cur)return {error:'path does not start with M'};
    if(command==='L'){
      const next=[a[0],a[1]],dx=next[0]-cur[0],dy=next[1]-cur[1];
      if(Math.abs(dx)>EPS&&Math.abs(dy)>EPS)return {error:'diagonal straight segment'};
      raw.push(next);cur=next;continue;
    }
    if(command==='Q'){
      const c=[a[0],a[1]],e=[a[2],a[3]],d1=[c[0]-cur[0],c[1]-cur[1]],d2=[e[0]-c[0],e[1]-c[1]];
      const axis=v=>Math.abs(v[0])<EPS&&Math.abs(v[1])>EPS?'v':Math.abs(v[1])<EPS&&Math.abs(v[0])>EPS?'h':null;
      if(!axis(d1)||!axis(d2)||axis(d1)===axis(d2))return {error:'curved non-fillet path (quadratic control point is not a right-angle corner)'};
      raw.push(c,e);trim=Math.max(trim,Math.abs(d1[0]+d1[1]),Math.abs(d2[0]+d2[1]));cur=e;continue;
    }
    // A: circular quarter arc fillet only; its corner follows from the incoming direction.
    const [rx,ry,rot,large,sw,ex,ey]=a,dx=ex-cur[0],dy=ey-cur[1];
    if(!(rx>0)||Math.abs(rx-ry)>EPS||Math.abs(rot)>EPS||large!==0||![0,1].includes(sw)||Math.abs(Math.abs(dx)-rx)>1e-3||Math.abs(Math.abs(dy)-rx)>1e-3)return {error:'curved non-fillet path (arc is not a quarter-circle fillet)'};
    let prev=null;for(let k=raw.length-2;k>=0;k--)if(Math.abs(raw[k][0]-cur[0])>EPS||Math.abs(raw[k][1]-cur[1])>EPS){prev=raw[k];break}
    if(!prev)return {error:'arc without an incoming straight segment'};
    const in0=sign(cur[0]-prev[0]),in1=sign(cur[1]-prev[1]);
    let corner,out;
    if(in1===0&&in0!==0&&sign(dx)===in0){corner=[ex,cur[1]];out=[0,sign(dy)]}
    else if(in0===0&&in1!==0&&sign(dy)===in1){corner=[cur[0],ey];out=[sign(dx),0]}
    else return {error:'curved non-fillet path (arc does not turn a right angle)'};
    const cross=in0*out[1]-in1*out[0];
    if((cross>0)!==(sw===1))return {error:'curved non-fillet path (arc bulges away from the corner)'};
    raw.push(corner,[ex,ey]);trim=Math.max(trim,rx);cur=[ex,ey];
  }
  // Drop repeats, then merge collinear runs so each remaining interior vertex is one bend.
  let pts=raw.filter((p,i)=>!i||Math.abs(p[0]-raw[i-1][0])>EPS||Math.abs(p[1]-raw[i-1][1])>EPS);
  for(let changed=true;changed;){
    changed=false;
    for(let i=1;i<pts.length-1;i++){
      const a=pts[i-1],b=pts[i],c=pts[i+1],d1=[sign(b[0]-a[0]),sign(b[1]-a[1])],d2=[sign(c[0]-b[0]),sign(c[1]-b[1])];
      const dot=d1[0]*d2[0]+d1[1]*d2[1];
      if(dot<0)return {error:'route reverses onto itself'};
      if(dot>0){pts.splice(i,1);changed=true;break}
    }
  }
  if(pts.length<2)return {error:'degenerate route'};
  return {points:pts,bends:pts.length-2,trim:trim||DEFAULT_TRIM,measuredTrim:trim>0};
}

const facesOf=(rect,corner,owner)=>{
  const m=Math.max(0,Math.min(corner||0,Math.min(rect.w,rect.h)/2));
  const mk=(name,normal,axis,fixed,lo,hi)=>({name,normal,axis,fixed,lo,hi,ilo:lo+m,ihi:hi-m,mid:(lo+hi)/2,owner});
  return [mk('top',[0,-1],'x',rect.y,rect.x,rect.x+rect.w),mk('right',[1,0],'y',rect.x+rect.w,rect.y,rect.y+rect.h),mk('bottom',[0,1],'x',rect.y+rect.h,rect.x,rect.x+rect.w),mk('left',[-1,0],'y',rect.x,rect.y,rect.y+rect.h)];
};
const pointOn=(f,t)=>f.axis==='x'?[t,f.fixed]:[f.fixed,t];
const alongOf=(f,p)=>f.axis==='x'?p[0]:p[1];
const unit=(a,b)=>[sign(b[0]-a[0]),sign(b[1]-a[1])];
const contains=(outer,inner)=>inner.x>=outer.x-0.25&&inner.y>=outer.y-0.25&&inner.x+inner.w<=outer.x+outer.w+0.25&&inner.y+inner.h<=outer.y+outer.h+0.25;

function toSegs(points){
  const segs=[];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],dx=b[0]-a[0],dy=b[1]-a[1];
    if(Math.abs(dx)>EPS&&Math.abs(dy)>EPS)return null;
    const axis=Math.abs(dy)<EPS?'h':'v',s0=axis==='h'?a[0]:a[1],s1=axis==='h'?b[0]:b[1];
    const length=Math.abs(s1-s0);
    if(length<=EPS)return null;
    segs.push({axis,fixed:axis==='h'?a[1]:a[0],s0,s1,length,dir:Math.sign(s1-s0)});
  }
  return segs;
}
// Open-interior hit of an axis-aligned segment against a guarded rectangle.
const hits=(seg,r,g,lo=Math.min(seg.s0,seg.s1),hi=Math.max(seg.s0,seg.s1))=>seg.axis==='h'
  ?seg.fixed>r.y-g&&seg.fixed<r.y+r.h+g&&Math.min(hi,r.x+r.w+g)-Math.max(lo,r.x-g)>EPS
  :seg.fixed>r.x-g&&seg.fixed<r.x+r.w+g&&Math.min(hi,r.y+r.h+g)-Math.max(lo,r.y-g)>EPS;

// 0 = clear, 1 = touches only uncertain geometry (bounding box of a non-rectangular node), 2 = certain hit.
function nodeHit(seg,node,g){
  if(!hits(seg,node.bbox,g))return 0;
  if(node.kind==='rect')return 2;
  if(!node.hull)return 1;
  const span=hullSpanAt(node.hull,seg.axis,seg.fixed,g);
  const lo=Math.min(seg.s0,seg.s1),hi=Math.max(seg.s0,seg.s1);
  return span&&Math.min(hi,span[1])-Math.max(lo,span[0])>EPS?2:1;
}

function makeEvaluator(ctx){
  const {trim,axial}=ctx;
  return points=>{
    const segs=toSegs(points);
    if(!segs)return 0;
    const n=segs.length;
    for(let i=0;i<n;i++){
      const need=(i>0?trim:0)+(i<n-1?trim:0)+(i===n-1?axial+SHAFT:0);
      if(segs[i].length<need-EPS)return 0;
    }
    const trimmed=segs.map((s,i)=>{
      const a=s.s0+(i>0?s.dir*trim:0),b=s.s1-(i<n-1?s.dir*trim:0);
      return {axis:s.axis,fixed:s.fixed,lo:Math.min(a,b),hi:Math.max(a,b)};
    });
    let soft=false;
    const touch=(s,node)=>{const h=nodeHit(s,node,GUARD);if(h===2)return true;if(h===1)soft=true;return false};
    for(let i=0;i<n;i++){
      const s=segs[i];
      for(const node of ctx.nodes)if(touch(s,node))return 0;
      if(i>0&&touch(s,ctx.source))return 0;
      if(i<n-1&&touch(s,ctx.target))return 0;
      for(const box of ctx.unrelatedGroups)if(hits(s,box,GUARD))return 0;
      for(const box of ctx.headings)if(hits(s,box,HEADING_GUARD))return 0;
      for(const box of ctx.labels)if(hits(s,box,GUARD))return 0;
    }
    for(let i=0;i<trimmed.length;i++)for(const b of ctx.otherSpans){
      const a=trimmed[i];
      if(i===trimmed.length-1&&ctx.trunkFinals.has(b))continue;   // the shared final portion of a declared trunk
      if(a.axis===b.axis){
        if(Math.min(a.hi,b.hi)-Math.max(a.lo,b.lo)>EPS&&Math.abs(a.fixed-b.fixed)<PARALLEL_CLEARANCE-EPS)return 0;
      }else{
        const h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;
        if(v.fixed>h.lo+EPS&&v.fixed<h.hi-EPS&&h.fixed>v.lo+EPS&&h.fixed<v.hi-EPS)return 0;
      }
    }
    if(ctx.strict){
      // Repair hints are stricter than the lower-bend witnesses: the untrimmed candidate may not touch or run beside another route either
      // (the fillet trim above would otherwise let a bend sit exactly on another connector's centerline).
      for(let i=0;i<n;i++){
        const a=segs[i],alo=Math.min(a.s0,a.s1),ahi=Math.max(a.s0,a.s1);
        for(const b of ctx.otherSpans){
          if(i===n-1&&ctx.trunkFinals.has(b))continue;
          if(a.axis===b.axis){if(Math.min(ahi,b.hi)-Math.max(alo,b.lo)>EPS&&Math.abs(a.fixed-b.fixed)<PARALLEL_CLEARANCE-EPS)return 0}
          else if(b.fixed>=alo-EPS&&b.fixed<=ahi+EPS&&a.fixed>=b.lo-EPS&&a.fixed<=b.hi+EPS)return 0;
        }
      }
    }
    let level=ctx.unknown||soft?1:2;
    if(level===2)for(const s of segs)for(const hull of ctx.hulls)if(hits(s,hull,0)){level=1;break}
    return level;
  };
}


// ---- grid shortest-route witness (detour check only) ----------------------------------------------------------------------
// Dijkstra over corners on the Hanan-style grid of obstacle edges (+-2), port anchors, channel mid-lines and 10-unit parallel offsets.
// State = (grid point, axis of the next segment); a transition is one whole straight segment to another grid point, so segment-length rules
// (first >= trim, middle >= 2*trim, last >= trim + marker axial + shaft) are enforced exactly. Blocked intervals per grid line come from
// the same obstacles as the evaluator (conservative: a non-rectangular node blocks its bounding box); the winning path is then re-validated
// by the full evaluator (crossings, parallel clearance, trunk pin) and discarded unless it is a certain "yes" witness.
class MinHeap{
  constructor(){this.a=[]}
  push(k,v){const a=this.a;a.push([k,v]);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=a[i][0])break;[a[p],a[i]]=[a[i],a[p]];i=p}}
  pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;for(;;){let l=2*i+1,r=l+1,m=i;if(l<a.length&&a[l][0]<a[m][0])m=l;if(r<a.length&&a[r][0]<a[m][0])m=r;if(m===i)break;[a[m],a[i]]=[a[i],a[m]];i=m}}return top}
  get size(){return this.a.length}
}
const MAX_GRID=900;
function gridWitness({fs0,ftList,valuesFor,ctx,boxes,evaluate,trim,axial,otherSpans,trunkFinals,GS,GT,bend=1e-3}){
  const pointsOf=f=>valuesFor(f,false).map(v=>pointOn(f,v).map(round3));
  const startPorts=fs0.flatMap(f=>pointsOf(f).map(p=>({f,p}))),endPorts=ftList.flatMap(f=>pointsOf(f).map(p=>({f,p})));
  const xsRaw=[],ysRaw=[];
  for(const b of boxes){xsRaw.push(b.x-GUARD-1,b.x,b.x+b.w,b.x+b.w+GUARD+1);ysRaw.push(b.y-GUARD-1,b.y,b.y+b.h,b.y+b.h+GUARD+1)}
  for(const {p} of [...startPorts,...endPorts]){xsRaw.push(p[0]);ysRaw.push(p[1])}
  const spans=otherSpans.filter(sp=>!trunkFinals.has(sp));
  for(const sp of spans){const c=sp.fixed;if(sp.axis==='h')ysRaw.push(c-PARALLEL_CLEARANCE,c+PARALLEL_CLEARANCE);else xsRaw.push(c-PARALLEL_CLEARANCE,c+PARALLEL_CLEARANCE)}
  const gaps=raw=>{const s=sortedUnique(raw),out=[...s];for(let i=0;i+1<s.length;i++)if(s[i+1]-s[i]>=2*(GUARD+1)+2)out.push((s[i]+s[i+1])/2);return sortedUnique(out)};
  const X=gaps(xsRaw),Y=gaps(ysRaw);
  if(X.length*Y.length>MAX_GRID*MAX_GRID)return null;
  const xi=new Map(X.map((v,i)=>[v,i])),yi=new Map(Y.map((v,i)=>[v,i]));
  const scanCache=new Map();
  const rects=[...ctx.nodes.map(n=>[n.bbox,GUARD]),...ctx.unrelatedGroups.map(b=>[b,GUARD]),...ctx.headings.map(b=>[b,HEADING_GUARD]),...ctx.labels.map(b=>[b,GUARD])];
  const rectIv=(r,g,axis,fixed)=>axis==='h'?(fixed>r.y-g&&fixed<r.y+r.h+g?[r.x-g,r.x+r.w+g]:null):(fixed>r.x-g&&fixed<r.x+r.w+g?[r.y-g,r.y+r.h+g]:null);
  const scan=(axis,fixed)=>{
    const key=axis+fixed;let iv=scanCache.get(key);if(iv)return iv;
    iv=[];
    for(const [r,g] of rects){const x=rectIv(r,g,axis,fixed);if(x)iv.push(x)}
    for(const sp of spans){
      if(sp.axis===axis){if(Math.abs(sp.fixed-fixed)<PARALLEL_CLEARANCE-EPS)iv.push([sp.lo,sp.hi])}
      else if(fixed>sp.lo+EPS&&fixed<sp.hi-EPS)iv.push([sp.fixed-1e-3,sp.fixed+1e-3]);
    }
    scanCache.set(key,iv);return iv;
  };
  const endIv=(obs,axis,fixed)=>{const x=rectIv(obs.bbox,GUARD,axis,fixed);return x?[x]:[]};
  const free=(axis,fixed,a,b,extra=[])=>{
    const lo=Math.min(a,b),hi=Math.max(a,b);
    for(const [p,q] of scan(axis,fixed))if(Math.min(hi,q)-Math.max(lo,p)>EPS)return false;
    for(const [p,q] of extra)if(Math.min(hi,q)-Math.max(lo,p)>EPS)return false;
    return true;
  };
  const sObs=ctx.source,tObs=ctx.target;
  const NX=X.length,NY=Y.length,idx=(i,j,a)=>((i*NY+j)*2+a);
  const dist=new Float64Array(NX*NY*2).fill(Infinity),prev=new Array(NX*NY*2).fill(null);
  const heap=new MinHeap();
  const AX={h:0,v:1};
  const BEND=bend;
  // first runs
  for(const {f,p} of startPorts){
    const axis=f.axis==='x'?'v':'h',dir=f.normal[axis==='v'?1:0],list=axis==='v'?Y:X,fixedCoord=axis==='v'?p[0]:p[1],at=axis==='v'?p[1]:p[0];
    const extra=endIv(tObs,axis,fixedCoord);
    let k=list.findIndex(v=>Math.abs(v-at)<1e-6);if(k<0)continue;
    for(k+=dir;k>=0&&k<list.length;k+=dir){
      const pos=list[k],L=Math.abs(pos-at);
      if(!free(axis,fixedCoord,at,pos,extra))break;
      if(L<trim-EPS)continue;
      const cx=axis==='v'?fixedCoord:pos,cy=axis==='v'?pos:fixedCoord,i=xi.get(cx),j=yi.get(cy);
      if(i===undefined||j===undefined)continue;
      const n=idx(i,j,1-AX[axis]),c=L+BEND;
      if(c<dist[n]){dist[n]=c;prev[n]={start:p,from:null};heap.push(c,n)}
    }
  }
  // targets by (final axis, line coordinate)
  const targets=new Map();
  for(const {f,p} of endPorts){const axis=f.axis==='x'?'v':'h',key=axis+round3(axis==='v'?p[0]:p[1]);if(!targets.has(key))targets.set(key,[]);targets.get(key).push({f,p,axis})}
  let best=null;
  while(heap.size){
    const [d,n]=heap.pop();
    if(d>dist[n]+1e-9)continue;
    if(best&&d>=best.cost)break;
    const a=n&1,cell=n>>1,i=Math.floor(cell/NY),j=cell%NY,axis=a===0?'h':'v',x=X[i],y=Y[j];
    const fixedCoord=axis==='h'?y:x,at=axis==='h'?x:y,list=axis==='h'?X:Y;
    // finish: run into a target port
    for(const t of targets.get(axis+round3(fixedCoord))??[]){
      const pos=axis==='h'?t.p[0]:t.p[1],dirIn=-t.f.normal[axis==='h'?0:1];
      if(Math.sign(pos-at)!==dirIn)continue;
      const L=Math.abs(pos-at);
      if(L<trim+axial+SHAFT-EPS)continue;
      if(!free(axis,fixedCoord,at,pos,endIv(sObs,axis,fixedCoord)))continue;
      const cost=d+L;
      if(!best||cost<best.cost)best={cost,node:n,end:t.p};
    }
    // continue: one more straight segment to another corner
    let k0=list.findIndex(v=>Math.abs(v-at)<1e-6);
    for(const dir of [-1,1]){
      for(let k=k0+dir;k>=0&&k<list.length;k+=dir){
        const pos=list[k],L=Math.abs(pos-at);
        if(!free(axis,fixedCoord,at,pos,[...endIv(sObs,axis,fixedCoord),...endIv(tObs,axis,fixedCoord)]))break;
        if(L<2*trim-EPS)continue;
        const ni=axis==='h'?xi.get(pos):i,nj=axis==='h'?j:yi.get(pos);
        if(ni===undefined||nj===undefined)continue;
        const m=idx(ni,nj,1-a),c=d+L+BEND;
        if(c<dist[m]){dist[m]=c;prev[m]={from:n};heap.push(c,m)}
      }
    }
  }
  if(!best)return null;
  const pts=[];let n=best.node;
  for(;;){
    const cell=n>>1;pts.push([X[Math.floor(cell/NY)],Y[cell%NY]]);
    const pr=prev[n];if(pr.from===null){pts.push(pr.start);break}n=pr.from;
  }
  pts.reverse();pts.push(best.end);
  const level=evaluate(pts);
  return level===2?{points:pts,length:manhattan(pts)}:{invalid:true};
}

function values(face,extras,sweep=true){
  const lo=face.ilo,hi=face.ihi,clamp=v=>Math.min(hi,Math.max(lo,v)),out=[clamp(face.mid),lo,hi];
  for(const e of extras)if(Number.isFinite(e))out.push(clamp(e));
  if(sweep&&hi-lo>EPS){const step=Math.max(SAMPLE_STEP,(hi-lo)/MAX_SAMPLES);for(let v=lo;v<hi-EPS;v+=step)out.push(v)}
  return [...new Set(out.map(round3))].sort((a,b)=>a-b);
}

function enumerate(S,T,sFaces,tFaces,valuesFor,maxBends,channelsFor=()=>[]){
  const out=[];
  for(const fs of sFaces)for(const ft of tFaces){
    if(fs.axis===ft.axis){
      const opposite=fs.normal[0]===-ft.normal[0]&&fs.normal[1]===-ft.normal[1],k=fs.axis==='x'?1:0;
      if(maxBends>=0&&opposite&&(ft.fixed-fs.fixed)*fs.normal[k]>EPS){
        const lo=Math.max(fs.ilo,ft.ilo),hi=Math.min(fs.ihi,ft.ihi);
        if(lo<=hi+EPS){
          const cands=[...valuesFor(fs),...valuesFor(ft),(lo+hi)/2].filter(v=>v>=lo-EPS&&v<=hi+EPS).map(round3);
          for(const v of new Set(cands))out.push({faces:[fs,ft],points:[pointOn(fs,v),pointOn(ft,v)]});
        }
      }
      if(maxBends>=2){
        // Z (opposite faces) and U (same-side faces): leave fs, run along a channel, arrive at ft.
        for(const a of valuesFor(fs,false))for(const b of valuesFor(ft,false)){
          if(Math.abs(a-b)<EPS)continue;
          for(const m of channelsFor(fs.axis)){
            const P0=pointOn(fs,a),P3=pointOn(ft,b),P1=fs.axis==='x'?[a,m]:[m,a],P2=fs.axis==='x'?[b,m]:[m,b];
            const d0=[P1[0]-P0[0],P1[1]-P0[1]],d2=[P3[0]-P2[0],P3[1]-P2[1]];
            if(d0[0]*fs.normal[0]+d0[1]*fs.normal[1]<=EPS||d2[0]*ft.normal[0]+d2[1]*ft.normal[1]>=-EPS)continue;
            out.push({faces:[fs,ft],points:[P0,P1,P2,P3]});
          }
        }
      }
    }else if(maxBends>=1){
      const sv=valuesFor(fs),tv=valuesFor(ft);
      for(const a of sv)for(const b of tv){
        const P0=pointOn(fs,a),P2=pointOn(ft,b),P1=fs.axis==='y'?[b,a]:[a,b];
        const d0=[P1[0]-P0[0],P1[1]-P0[1]],d1=[P2[0]-P1[0],P2[1]-P1[1]];
        if(d0[0]*fs.normal[0]+d0[1]*fs.normal[1]<=EPS||d1[0]*ft.normal[0]+d1[1]*ft.normal[1]>=-EPS)continue;
        out.push({faces:[fs,ft],points:[P0,P1,P2]});
      }
    }
  }
  return out;
}

const fmt=(c,midDist)=>({faces:{source:c.faces[0].name,target:c.faces[1].name},anchors:{source:c.points[0].map(round3),target:c.points.at(-1).map(round3)},segments:c.points.slice(0,-1).map((p,i)=>[p.map(round3),c.points[i+1].map(round3)]),bends:c.points.length-2,anchorOffsetFromMidpoints:round3(midDist)});

export const DETOUR_RATIO=1.15,DETOUR_EXTRA=300;
// A drawn route is an avoidable detour when it is longer than BOTH 1.15x and (shortest + 300) of the shortest feasible route.
// Tuned on calibration (SVG units; the pipeline draws 224x104 nodes, so 300 is about 1.3 node widths): the originally proposed max(1.5x, +200)
// missed both known canvas-edge detours (route/shortest 1.45 and 1.19, +460 and +552) while +200 alone also flags 1.13x loopbacks of long
// links (+219) and short links doubled by one forced bend (+160). The 1.15x floor spares long links, the +300 floor spares short ones.
const detourLimit=best=>Math.max(best*DETOUR_RATIO,best+DETOUR_EXTRA);
const manhattan=pts=>pts.slice(1).reduce((n,p,i)=>n+Math.abs(p[0]-pts[i][0])+Math.abs(p[1]-pts[i][1]),0);
const sortedUnique=list=>[...new Set(list.map(round3))].sort((a,b)=>a-b);

/** @param input {nodes,groups,edges,labelBoxes,unboundLabels}
 * nodes: [{id,kind:'rect'|'shape'|'unsupported',reason,outline,cornerRadius,samples,bbox}]  ('shape' carries sampled outline points)
 * groups: [{id,outline,box,headings:[box]}]
 * edges: [{source,target,tag,path,axialLength,spans,hulls,trunk}]  (spans/hulls from the audit's strict path readers)
 */
export function checkRouteLowerBend({nodes,groups,edges,labelBoxes=[],unboundLabels=[]},{mode='lowerBend',hintEdges=[],canvas=null}={}){
  const relations=[],violations=[],notCheckable=[];
  const hintSet=new Set(hintEdges),hints=new Map();
  const nodeById=new Map();for(const n of nodes)if(!nodeById.has(n.id))nodeById.set(n.id,n);
  const groupProblem=groups.find(g=>!g.box||g.outline!=='rect');
  const routes=edges.map(e=>e.tag==='path'?parseOrthogonalRoute(e.path):{error:'relationship is not a path element'});
  const unboundKeys=new Set(unboundLabels);
  const labels=labelBoxes.map(l=>l.box).filter(Boolean);
  // Repair hints stay inside the canvas: four frame strips (8-unit margin) join the label obstacles in hint mode only.
  if(mode==='hint'&&canvas&&[canvas.x,canvas.y,canvas.w,canvas.h].every(Number.isFinite)){
    const M=8,B=5000,{x,y,w,h}=canvas;
    labels.push({x:x-B,y:y-B,w:B+M-GUARD,h:h+2*B},{x:x+w-M+GUARD,y:y-B,w:B,h:h+2*B},{x:x-B,y:y-B,w:w+2*B,h:B+M-GUARD},{x:x-B,y:y+h-M+GUARD,w:w+2*B,h:B});
  }
  // Per-node geometry: rect faces, or ports derived from the drawn outline. Obstacles use the same knowledge.
  const geoCache=new Map();
  const geoOf=n=>{
    if(geoCache.has(n.id))return geoCache.get(n.id);
    let g;
    if(n.kind==='rect')g={kind:'rect',outline:n.outline,faces:owner=>facesOf(n.outline,n.cornerRadius,owner),bbox:n.bbox};
    else if(n.kind==='shape'){
      const d=derivePorts(n.samples);
      g=d.error?{error:d.error,kind:'unsupported',bbox:n.bbox}:{kind:'shape',outline:d.bbox,faces:owner=>d.faces.map(f=>({...f,owner})),bbox:n.bbox??d.bbox,hull:d.hull,descriptor:d.descriptor};
    }else g={error:n.reason||'unsupported shape',kind:'unsupported',bbox:n.bbox};
    geoCache.set(n.id,g);return g;
  };
  const obstacle=n=>{const g=geoOf(n);return {kind:g.kind==='unsupported'?'unsupported':g.kind,bbox:g.bbox,hull:g.hull}};
  for(let i=0;i<edges.length;i++){
    const e=edges[i],id=`${e.source}->${e.target}`,route=routes[i];
    if(mode==='hint'&&!hintSet.has(id))continue;
    const nc=reason=>{if(mode==='hint'){hints.set(id,{edge:id,hint:null,reason});return}relations.push({edge:id,status:'NOT-CHECKABLE',reason});notCheckable.push({edge:id,reason})};
    const S=nodeById.get(e.source),T=nodeById.get(e.target);
    if(!S||!T){nc('endpoint node is not drawn');continue}
    if(e.source===e.target){nc('self relationship');continue}
    const GS=geoOf(S),GT=geoOf(T);
    if(GS.error||GT.error){nc(`unsupported endpoint shape: ${[[S,GS],[T,GT]].filter(([,g])=>g.error).map(([n,g])=>`${n.id} (${g.error})`).join('; ')}`);continue}
    if(route.error){nc(route.error);continue}
    if(unboundKeys.has(id)){nc('edge label is not tagged, so label exclusion bounds are unavailable');continue}
    if(!Number.isFinite(e.axialLength)){nc('marker axial length unavailable');continue}
    if(groupProblem){nc(`container ${groupProblem.id} has no measurable rectangular outline`);continue}
    const others=nodes.filter(n=>n.id!==e.source&&n.id!==e.target);
    if(others.some(n=>!n.bbox)){nc('an unrelated node has no measurable geometry');continue}
    const fs0=GS.faces('S'),ft0=GT.faces('T');
    const p0=route.points[0],pn=route.points.at(-1),dIn=unit(p0,route.points[1]),dOut=unit(route.points.at(-2),pn);
    const near=(f,p)=>Math.abs((f.axis==='x'?p[1]:p[0])-f.fixed)<=1&&alongOf(f,p)>=f.lo-1&&alongOf(f,p)<=f.hi+1;
    const fsD=fs0.find(f=>near(f,p0)&&f.normal[0]===dIn[0]&&f.normal[1]===dIn[1]);
    const ftD=ft0.find(f=>near(f,pn)&&f.normal[0]===-dOut[0]&&f.normal[1]===-dOut[1]);
    if(!fsD||!ftD){nc('drawn route does not leave the source and arrive at the target perpendicular to a supported face or port');continue}
    const others2=edges.map((o,j)=>({o,j})).filter(x=>x.j!==i);
    const otherSpans=[],hulls=[];let unknown=unboundLabels.length>0;
    for(const {o} of others2){
      if(!o.spans||!o.hulls){unknown=true;continue}
      otherSpans.push(...o.spans);hulls.push(...o.hulls);
    }
    // Shared trunk: accepted membership pins the target anchor to the drawn trunk entry and exempts the shared final portion.
    const me={trunk:e.trunk||null,target:e.target,spans:e.spans,lastCommand:e.spans?.lastCommand};
    const trunkFinals=new Set();
    if(me.trunk&&e.spans?.length)for(const {o} of others2){
      if(o.spans?.length&&isAcceptedTrunkOverlap(me,{trunk:o.trunk||null,target:o.target,spans:o.spans,lastCommand:o.spans.lastCommand},e.spans.at(-1),o.spans.at(-1)))trunkFinals.add(o.spans.at(-1));
    }
    const pinned=trunkFinals.size>0,pinValue=round3(alongOf(ftD,pn));
    const ancestor=g=>contains(g.box,GS.outline)||contains(g.box,GT.outline);
    const ctx={source:obstacle(S),target:obstacle(T),nodes:others.map(obstacle),unrelatedGroups:groups.filter(g=>!ancestor(g)).map(g=>g.box),headings:groups.flatMap(g=>g.headings),labels,otherSpans,hulls,unknown,trim:route.trim,axial:e.axialLength,trunkFinals,strict:mode==='hint'};
    const evaluate=makeEvaluator(ctx);
    const midDist=(fs,ft,a,b)=>Math.abs(alongOf(fs,a)-fs.mid)+Math.abs(alongOf(ft,b)-ft.mid);
    const drawnDist=midDist(fsD,ftD,p0,pn);
    // Projected alignment points: the other node's centre and extremes plus both drawn anchors, along this face's axis.
    const extrasFor=face=>{
      const ax=face.axis==='x'?0:1,other=(face.owner==='S'?GT:GS).outline;
      const lo=ax===0?other.x:other.y,len=ax===0?other.w:other.h;
      return [lo+len/2,lo,lo+len,p0[ax],pn[ax]];
    };
    // A pinned trunk entry is a target face collapsed to the single drawn anchor, so every candidate type must end exactly there.
    const ftSearch=pinned?{...ftD,ilo:pinValue,ihi:pinValue}:ftD;
    const valuesFor=(face,sweep=true)=>values(face,extrasFor(face),sweep);
    const tFacesFor=pinned?[ftSearch]:ft0;
    // Channel coordinates for the middle leg of a Z/U: the middle of the gap between the endpoint faces, every obstacle boundary
    // pushed just clear of it, the middle of each gap between boundaries, and the offsets that keep 10 from a parallel span.
    const channelsFor=axis=>{
      const k=axis==='x'?1:0,boxes=[GS.bbox,GT.bbox,...others.map(n=>n.bbox),...groups.map(g=>g.box),...ctx.headings,...labels].filter(Boolean);
      const edgesAt=boxes.flatMap(b=>k===1?[b.y,b.y+b.h]:[b.x,b.x+b.w]);
      const list=[(fsD.fixed+ftD.fixed)/2,...route.points.slice(1,-1).map(p=>p[k])];
      for(const c of edgesAt)list.push(c-GUARD-1,c+GUARD+1,c-PARALLEL_CLEARANCE,c+PARALLEL_CLEARANCE);
      const sorted=sortedUnique(edgesAt);
      for(let q=0;q+1<sorted.length;q++)if(sorted[q+1]-sorted[q]>=2*(GUARD+1))list.push((sorted[q]+sorted[q+1])/2);
      for(const sp of otherSpans)if((k===1)===(sp.axis==='h'))list.push(sp.fixed-PARALLEL_CLEARANCE,sp.fixed+PARALLEL_CLEARANCE);
      const centre=(fsD.fixed+ftD.fixed)/2;
      return sortedUnique(list).sort((a,b)=>Math.abs(a-centre)-Math.abs(b-centre)).slice(0,160);
    };
    const record={edge:id,drawnBends:route.bends,faces:{source:fsD.name,target:ftD.name},...(pinned?{trunk:me.trunk}:{})};
    if(mode==='hint'){
      // Repair hint: the best crossing-free feasible route for THIS edge with every other drawn route fixed (the evaluator rejects any crossing,
      // parallel clearance breach, node/container/label intrusion, short final leg and trunk mismatch). Fewest bends, then shortest.
      const found=[];
      for(const x of enumerate(GS,GT,fs0,tFacesFor,valuesFor,2,channelsFor)){if(evaluate(x.points)===2)found.push({points:x.points,length:manhattan(x.points)})}
      const g=gridWitness({fs0,ftList:tFacesFor,valuesFor,ctx,evaluate,trim:route.trim,axial:e.axialLength,otherSpans:ctx.otherSpans,trunkFinals,GS,GT,bend:1e6,
        boxes:[GS.bbox,GT.bbox,...others.map(n=>n.bbox),...groups.map(x=>x.box),...ctx.headings,...labels].filter(Boolean)});
      if(g&&g.points)found.push({points:g.points,length:g.length});
      found.sort((a,b)=>a.points.length-b.points.length||a.length-b.length);
      const w=found[0];
      hints.set(id,w?{edge:id,hint:{edge:id,points:w.points.map(p=>p.map(round3)),bends:w.points.length-2,length:round3(w.length)}}:{edge:id,hint:null,reason:'no crossing-free feasible route (orthogonal enumeration and obstacle-grid search) with all other routes fixed'});
      continue;
    }
    if(mode==='detour'){
      // Avoidable detour: the drawn Manhattan length against the shortest feasible witness (same obstacles, clearances and trunk pin).
      const drawnLength=manhattan(route.points);
      const rectGap=(a,b)=>Math.max(a.x-(b.x+b.w),b.x-(a.x+a.w),0)+Math.max(a.y-(b.y+b.h),b.y-(a.y+a.h),0);
      const lowerBound=rectGap(GS.bbox,GT.bbox);   // no route can be shorter than the Manhattan gap between the two shapes
      if(!process.env.PI_DIAGRAM_DETOUR_CALIBRATE&&drawnLength<=detourLimit(lowerBound)+EPS){relations.push({edge:id,status:'PASS',drawnLength:round3(drawnLength),lowerBound:round3(lowerBound),basis:'drawn length is within the limit even against the straight Manhattan gap'});continue}
      const cands=enumerate(GS,GT,fs0,tFacesFor,valuesFor,2,channelsFor).map(c=>({c,level:evaluate(c.points),length:manhattan(c.points)})).filter(x=>x.level>0);
      const yes=cands.filter(x=>x.level===2).sort((a,b)=>a.length-b.length),maybe=cands.filter(x=>x.level===1).sort((a,b)=>a.length-b.length);
      let w=yes[0]?{points:yes[0].c.points,length:yes[0].length,c:yes[0].c}:null;
      if(!w||drawnLength<=detourLimit(w.length)+EPS){
        // enumerated 0-2 bend routes did not already prove a detour: search every orthogonal route on the obstacle grid
        const g=gridWitness({fs0,ftList:tFacesFor,valuesFor,ctx,evaluate,trim:route.trim,axial:e.axialLength,otherSpans:ctx.otherSpans,trunkFinals,GS,GT,
          boxes:[GS.bbox,GT.bbox,...others.map(n=>n.bbox),...groups.map(x=>x.box),...ctx.headings,...labels].filter(Boolean)});
        if(g&&g.points&&(!w||g.length<w.length-EPS))w={points:g.points,length:g.length,grid:true};
      }
      if(!w){nc(maybe.length?'no feasible witness: the only shorter candidates are blocked by unmeasured or uncertain geometry':'no feasible witness route found (0-2 bend candidates and an obstacle-grid search)');continue}
      const limit=detourLimit(w.length);
      if(drawnLength>limit+EPS){
        const pts=w.points;
        violations.push({...record,kind:'detour',drawnLength:round3(drawnLength),witnessLength:round3(w.length),limit:round3(limit),witnessBends:pts.length-2,witness:{anchors:{source:pts[0].map(round3),target:pts.at(-1).map(round3)},segments:pts.slice(0,-1).map((p,k)=>[p.map(round3),pts[k+1].map(round3)]),bends:pts.length-2}});
        relations.push({edge:id,status:'FAIL',reason:`drawn length ${round3(drawnLength)} exceeds ${round3(limit)} (the limit over the shortest feasible route, ${round3(w.length)})`});continue;
      }
      const uncertain=maybe.find(x=>x.length<w.length&&drawnLength>detourLimit(x.length)+EPS);
      if(uncertain){nc('a shorter route that would make this a detour is blocked only by unmeasured or uncertain geometry');continue}
      relations.push({edge:id,status:'PASS',drawnLength:round3(drawnLength),witnessLength:round3(w.length),lowerBound:round3(lowerBound)});continue;
    }
    // 1) lower-bend witness: straight (0), L (1) and, for drawings with 3+ bends, Z/U (2) candidates with fewer bends than drawn.
    const lower=route.bends>=1?enumerate(GS,GT,fs0,tFacesFor,valuesFor,Math.min(2,route.bends-1),channelsFor):[];
    const scored=lower.map(c=>({c,level:evaluate(c.points),bends:c.points.length-2,dist:midDist(c.faces[0],c.faces[1],c.points[0],c.points.at(-1))}));
    const best=list=>list.sort((a,b)=>a.bends-b.bends||a.dist-b.dist)[0];
    const yes=scored.filter(x=>x.level===2),maybe=scored.filter(x=>x.level===1);
    if(yes.length){
      const w=best(yes);
      violations.push({...record,kind:'lowerBend',drawnBends:route.bends,witnessBends:w.bends,witness:fmt(w.c,w.dist)});
      relations.push({edge:id,status:'FAIL',reason:`feasible ${w.bends}-bend route exists for a ${route.bends}-bend drawing${pinned?' (keeps the declared shared trunk)':''}`});continue;
    }
    if(maybe.length){nc('a lower-bend route is blocked only by unmeasured or uncertain geometry (curve hull, unparsed route, unbound label or non-rectangular node bounds)');continue}
    // 2) midpoint closeness among equal-bend candidates (needs a crossing-free drawn route for equal-crossing comparison).
    const drawnSegs=toSegs(route.points),n=drawnSegs.length;
    const drawnTrimmed=drawnSegs.map((s,k)=>{const a=s.s0+(k>0?s.dir*route.trim:0),b=s.s1-(k<n-1?s.dir*route.trim:0);return {axis:s.axis,fixed:s.fixed,lo:Math.min(a,b),hi:Math.max(a,b)}});
    const drawnCrosses=drawnTrimmed.some(a=>otherSpans.some(b=>a.axis!==b.axis&&(()=>{const h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;return v.fixed>h.lo+EPS&&v.fixed<h.hi-EPS&&h.fixed>v.lo+EPS&&h.fixed<v.hi-EPS})()));
    if(drawnCrosses){nc('drawn route crosses another route, so the equal-crossing midpoint comparison is undefined');continue}
    let equal;
    if(route.bends<=1)equal=enumerate(GS,GT,fs0,tFacesFor,valuesFor,route.bends).filter(c=>c.points.length-2===route.bends);
    else{
      equal=[];
      const ia=fsD.axis==='x'?0:1,ib=ftD.axis==='x'?0:1,P=route.points,m=P.length;
      for(const a of valuesFor(fsD))for(const b of valuesFor(ftSearch)){
        const pts=P.map(p=>[...p]);pts[0][ia]=a;pts[1][ia]=a;pts[m-1][ib]=b;pts[m-2][ib]=b;
        const same=pts.slice(0,-1).every((p,k)=>{const u=unit(p,pts[k+1]),v=unit(P[k],P[k+1]);return u[0]===v[0]&&u[1]===v[1]});
        if(same)equal.push({faces:[fsD,ftSearch],points:pts});
      }
    }
    const eq=equal.map(c=>({c,level:evaluate(c.points),bends:route.bends,dist:midDist(c.faces[0],c.faces[1],c.points[0],c.points.at(-1))})).filter(x=>x.level>0&&x.dist<drawnDist-MIDPOINT_TOLERANCE);
    const eyes=eq.filter(x=>x.level===2);
    if(eyes.length){
      const w=best(eyes);
      violations.push({...record,kind:'midpoint',drawnBends:route.bends,witnessBends:w.bends,drawnAnchorOffsetFromMidpoints:round3(drawnDist),witness:fmt(w.c,w.dist)});
      relations.push({edge:id,status:'FAIL',reason:'a feasible route with the same bends has anchors closer to the face midpoints'});continue;
    }
    if(eq.length){nc('a closer-to-midpoint route is blocked only by unmeasured or uncertain geometry');continue}
    if(route.bends>=4){nc('drawn route has 4 or more bends and 3-bend candidates are not searched, so absence of a 0-2 bend witness does not prove minimality');continue}
    relations.push({edge:id,status:'PASS',drawnBends:route.bends,...(pinned?{trunk:me.trunk}:{})});
  }
  if(mode==='hint')return {hints:Object.fromEntries(hints)};
  const status=violations.length?'FAIL':notCheckable.length||!edges.length?'NOT-CHECKABLE':'PASS';
  if(mode==='detour')return {status,evidence:{
    method:`drawn Manhattan route length versus the shortest feasible witness from the same search as routeLowerBend (straight, L, Z/U candidates over face midpoints, alignment points and a face sweep; kept only when perpendicular, clear of unrelated nodes/containers/headings/labels, free of non-shared crossings, >=10 from parallel spans, long enough for fillet trim + marker + shaft, shared-trunk entry pinned); FAIL when the drawn length exceeds max(${DETOUR_RATIO}x, +${DETOUR_EXTRA} units) of the witness; NOT-CHECKABLE when no feasible witness exists`,
    thresholds:{ratio:DETOUR_RATIO,extraUnits:DETOUR_EXTRA},relations,violations,notCheckable,
    checkedRelations:relations.filter(r=>r.status!=='NOT-CHECKABLE').length,
    limitations:'witness routes have at most 2 bends, so a relationship that can only be routed with 3 or more bends is NOT-CHECKABLE; the drawn route itself is never taken as its own witness; uncertain obstacles block witnesses but never support a PASS'}};
  return {status,evidence:{
    method:'actual SVG path reconstructed into logical bends (fillet = one bend); straight (0) and L (1) candidates, plus Z/U (2) candidates when the drawing has 3+ bends, over face midpoints, projected alignment points, drawn-anchor projections and a 4-unit face sweep, kept only when perpendicular, clear of unrelated nodes/containers/headings/labels, free of non-shared crossings, >=10 from parallel spans, and long enough for fillet trim + marker axial length + 8; ports of non-rectangular nodes are the apexes and flat faces measured on the sampled drawn outline; equal-bend midpoint comparison against enumerated L/straight candidates or anchor-shifted copies of the drawn route; a declared shared-trunk member is searched with its target anchor pinned to the trunk entry so every witness still merges validly',
    relations,violations,notCheckable,
    checkedRelations:relations.filter(r=>r.status!=='NOT-CHECKABLE').length,
    limitations:'supported node silhouettes: rectangle (incl. rounded), diamond, long-text decision hexagon, cylinder/store, queue, subroutine, capsule/stadium, circle/ellipse (convex outline with a centred apex or flat face per side); any other shape is NOT-CHECKABLE for its relationships; Z/U channels are a finite candidate set; drawings with 4+ bends can fail on a 0-2 bend witness but never PASS (3-bend candidates are not searched); a trunk member is judged with its trunk entry fixed, so a better route that moves the entry is not proposed; equal-bend midpoint for 2+ bends shifts the drawn route anchors only; declared port order, badge exclusions and other relationship-specific constraints are not read; uncertain obstacles block witnesses but never support a PASS'
  }};
}

/** Attach repair hints to routeCrossings violations. For each violation, search a crossing-free route for each of its two edges with all other
 * routes fixed; keep the better (fewest bends, then shortest) as `repairHint:{edge,points,bends,length}`, else `repairHint:null` with a reason.
 * Evidence only: the drawing is never modified. */
export function attachCrossingRepairHints(input,violations,{canvas=null}={}){
  const ids=[...new Set(violations.flatMap(v=>[v.edgeA,v.edgeB]))];
  let hints={};
  try{hints=checkRouteLowerBend(input,{mode:'hint',hintEdges:ids,canvas}).hints}catch(error){hints=Object.fromEntries(ids.map(id=>[id,{edge:id,hint:null,reason:`hint search failed: ${error?.message??error}`}]))}
  for(const v of violations){
    const per=[v.edgeA,v.edgeB].map(id=>hints[id]??{edge:id,hint:null,reason:'edge not searched'});
    const ok=per.filter(h=>h.hint).sort((a,b)=>a.hint.bends-b.hint.bends||a.hint.length-b.hint.length);
    if(ok.length)v.repairHint=ok[0].hint;
    else{v.repairHint=null;v.reason=`no crossing-free route for either edge with the other routes fixed (${[...new Set(per.map(h=>h.reason))].join('; ')}); a node move is likely needed`}
  }
  return violations;
}
