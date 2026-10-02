// Independent lower-bend / midpoint-anchor witness search (Diagram Rules: "Mandatory lower-bend route search",
// connector rules 1-2, 6, 12-14). Pure geometry over measured browser data; no DOM and no source semantics.
//
// Soundness model: every obstacle is either certain (measured, blocks a candidate) or uncertain (a curve hull of
// another route, an unparsed route, an unbound label). A candidate is "yes" only when feasible against certain AND
// uncertain obstacles, "maybe" when feasible against certain obstacles only. FAIL needs a "yes" witness; PASS needs
// that no candidate is even "maybe"; anything between is NOT-CHECKABLE. Overall status can therefore never become
// PASS because of an unmeasured obstacle.
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
    for(let i=0;i<n;i++){
      const s=segs[i];
      for(const node of ctx.nodes)if(hits(s,node,GUARD))return 0;
      if(i>0&&hits(s,ctx.source,GUARD))return 0;
      if(i<n-1&&hits(s,ctx.target,GUARD))return 0;
      for(const box of ctx.unrelatedGroups)if(hits(s,box,GUARD))return 0;
      for(const box of ctx.headings)if(hits(s,box,HEADING_GUARD))return 0;
      for(const box of ctx.labels)if(hits(s,box,GUARD))return 0;
    }
    for(const a of trimmed)for(const b of ctx.otherSpans){
      if(a.axis===b.axis){
        if(Math.min(a.hi,b.hi)-Math.max(a.lo,b.lo)>EPS&&Math.abs(a.fixed-b.fixed)<PARALLEL_CLEARANCE-EPS)return 0;
      }else{
        const h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;
        if(v.fixed>h.lo+EPS&&v.fixed<h.hi-EPS&&h.fixed>v.lo+EPS&&h.fixed<v.hi-EPS)return 0;
      }
    }
    let level=ctx.unknown?1:2;
    if(level===2)for(const s of segs)for(const hull of ctx.hulls)if(hits(s,hull,0)){level=1;break}
    return level;
  };
}

function values(face,extras){
  const lo=face.ilo,hi=face.ihi,clamp=v=>Math.min(hi,Math.max(lo,v)),out=[clamp(face.mid),lo,hi];
  for(const e of extras)if(Number.isFinite(e))out.push(clamp(e));
  if(hi-lo>EPS){const step=Math.max(SAMPLE_STEP,(hi-lo)/MAX_SAMPLES);for(let v=lo;v<hi-EPS;v+=step)out.push(v)}
  return [...new Set(out.map(round3))].sort((a,b)=>a-b);
}

function enumerate(S,T,sFaces,tFaces,extrasFor,maxBends){
  const out=[];
  for(const fs of sFaces)for(const ft of tFaces){
    if(fs.axis===ft.axis){
      if(maxBends<0||fs.normal[0]!==-ft.normal[0]||fs.normal[1]!==-ft.normal[1])continue;
      const k=fs.axis==='x'?1:0;
      if((ft.fixed-fs.fixed)*fs.normal[k]<=EPS)continue;
      const lo=Math.max(fs.ilo,ft.ilo),hi=Math.min(fs.ihi,ft.ihi);
      if(lo>hi+EPS)continue;
      const cands=[...values(fs,extrasFor(fs)),...values(ft,extrasFor(ft)),(lo+hi)/2].filter(v=>v>=lo-EPS&&v<=hi+EPS).map(round3);
      for(const v of new Set(cands))out.push({faces:[fs,ft],points:[pointOn(fs,v),pointOn(ft,v)]});
    }else if(maxBends>=1){
      const sv=values(fs,extrasFor(fs)),tv=values(ft,extrasFor(ft));
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

/** @param input {nodes,groups,edges,labelBoxes,unboundLabels}
 * nodes: [{id,kind:'rect'|'unsupported',reason,outline,cornerRadius,bbox}]
 * groups: [{id,outline,box,headings:[box]}]
 * edges: [{source,target,tag,path,axialLength,spans,hulls}]  (spans/hulls from the audit's strict path readers)
 */
export function checkRouteLowerBend({nodes,groups,edges,labelBoxes=[],unboundLabels=[]}){
  const relations=[],violations=[],notCheckable=[];
  const nodeById=new Map();for(const n of nodes)if(!nodeById.has(n.id))nodeById.set(n.id,n);
  const groupProblem=groups.find(g=>!g.box||g.outline!=='rect');
  const routes=edges.map(e=>e.tag==='path'?parseOrthogonalRoute(e.path):{error:'relationship is not a path element'});
  const unboundKeys=new Set(unboundLabels);
  const labels=labelBoxes.map(l=>l.box).filter(Boolean);
  for(let i=0;i<edges.length;i++){
    const e=edges[i],id=`${e.source}->${e.target}`,route=routes[i];
    const nc=reason=>{relations.push({edge:id,status:'NOT-CHECKABLE',reason});notCheckable.push({edge:id,reason})};
    const S=nodeById.get(e.source),T=nodeById.get(e.target);
    if(!S||!T){nc('endpoint node is not drawn');continue}
    if(e.source===e.target){nc('self relationship');continue}
    if(S.kind!=='rect'||T.kind!=='rect'){nc(`unsupported endpoint shape: ${[S,T].filter(n=>n.kind!=='rect').map(n=>`${n.id} (${n.reason})`).join('; ')}`);continue}
    if(route.error){nc(route.error);continue}
    if(unboundKeys.has(id)){nc('edge label is not tagged, so label exclusion bounds are unavailable');continue}
    if(!Number.isFinite(e.axialLength)){nc('marker axial length unavailable');continue}
    if(groupProblem){nc(`container ${groupProblem.id} has no measurable rectangular outline`);continue}
    const others=nodes.filter(n=>n.id!==e.source&&n.id!==e.target);
    if(others.some(n=>!n.bbox)){nc('an unrelated node has no measurable geometry');continue}
    const fs0=facesOf(S.outline,S.cornerRadius,'S'),ft0=facesOf(T.outline,T.cornerRadius,'T');
    const p0=route.points[0],pn=route.points.at(-1),dIn=unit(p0,route.points[1]),dOut=unit(route.points.at(-2),pn);
    const near=(f,p)=>Math.abs((f.axis==='x'?p[1]:p[0])-f.fixed)<=1&&alongOf(f,p)>=f.lo-1&&alongOf(f,p)<=f.hi+1;
    const fsD=fs0.find(f=>near(f,p0)&&f.normal[0]===dIn[0]&&f.normal[1]===dIn[1]);
    const ftD=ft0.find(f=>near(f,pn)&&f.normal[0]===-dOut[0]&&f.normal[1]===-dOut[1]);
    if(!fsD||!ftD){nc('drawn route does not leave the source and arrive at the target perpendicular to a rectangular face');continue}
    const others2=edges.map((o,j)=>({o,j,route:routes[j]})).filter(x=>x.j!==i);
    const otherSpans=[],hulls=[];let unknown=unboundLabels.length>0;
    for(const {o} of others2){
      if(!o.spans||!o.hulls){unknown=true;continue}
      otherSpans.push(...o.spans);hulls.push(...o.hulls);
    }
    const ancestor=g=>contains(g.box,S.outline)||contains(g.box,T.outline);
    const ctx={source:S.bbox,target:T.bbox,nodes:others.map(n=>n.bbox),unrelatedGroups:groups.filter(g=>!ancestor(g)).map(g=>g.box),headings:groups.flatMap(g=>g.headings),labels,otherSpans,hulls,unknown,trim:route.trim,axial:e.axialLength};
    const evaluate=makeEvaluator(ctx);
    const midDist=(fs,ft,a,b)=>Math.abs(alongOf(fs,a)-fs.mid)+Math.abs(alongOf(ft,b)-ft.mid);
    const drawnDist=midDist(fsD,ftD,p0,pn);
    // Projected alignment points: the other node's centre and extremes plus both drawn anchors, along this face's axis.
    const extrasFor=face=>{
      const ax=face.axis==='x'?0:1,other=(face.owner==='S'?T:S).outline;
      const lo=ax===0?other.x:other.y,len=ax===0?other.w:other.h;
      return [lo+len/2,lo,lo+len,p0[ax],pn[ax]];
    };
    const record={edge:id,drawnBends:route.bends,faces:{source:fsD.name,target:ftD.name}};
    // 1) lower-bend witness: straight (0) and L (1) candidates with fewer bends than drawn.
    const lower=route.bends>=1?enumerate(S.outline,T.outline,fs0,ft0,extrasFor,Math.min(1,route.bends-1)):[];
    const scored=lower.map(c=>({c,level:evaluate(c.points),bends:c.points.length-2,dist:midDist(c.faces[0],c.faces[1],c.points[0],c.points.at(-1))}));
    const best=list=>list.sort((a,b)=>a.bends-b.bends||a.dist-b.dist)[0];
    const yes=scored.filter(x=>x.level===2),maybe=scored.filter(x=>x.level===1);
    if(yes.length){
      const w=best(yes);
      violations.push({...record,kind:'lowerBend',drawnBends:route.bends,witnessBends:w.bends,witness:fmt(w.c,w.dist)});
      relations.push({edge:id,status:'FAIL',reason:`feasible ${w.bends}-bend route exists for a ${route.bends}-bend drawing`});continue;
    }
    if(maybe.length){nc('a lower-bend route is blocked only by unmeasured or uncertain geometry (curve hull, unparsed route or unbound label)');continue}
    // 2) midpoint closeness among equal-bend candidates (needs a crossing-free drawn route for equal-crossing comparison).
    const drawnSegs=toSegs(route.points),n=drawnSegs.length;
    const drawnTrimmed=drawnSegs.map((s,k)=>{const a=s.s0+(k>0?s.dir*route.trim:0),b=s.s1-(k<n-1?s.dir*route.trim:0);return {axis:s.axis,fixed:s.fixed,lo:Math.min(a,b),hi:Math.max(a,b)}});
    const drawnCrosses=drawnTrimmed.some(a=>otherSpans.some(b=>a.axis!==b.axis&&(()=>{const h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;return v.fixed>h.lo+EPS&&v.fixed<h.hi-EPS&&h.fixed>v.lo+EPS&&h.fixed<v.hi-EPS})()));
    if(drawnCrosses){nc('drawn route crosses another route, so the equal-crossing midpoint comparison is undefined');continue}
    let equal;
    if(route.bends<=1)equal=enumerate(S.outline,T.outline,fs0,ft0,extrasFor,route.bends).filter(c=>c.points.length-2===route.bends);
    else{
      equal=[];
      const ia=fsD.axis==='x'?0:1,ib=ftD.axis==='x'?0:1,P=route.points,m=P.length;
      for(const a of values(fsD,extrasFor(fsD)))for(const b of values(ftD,extrasFor(ftD))){
        const pts=P.map(p=>[...p]);pts[0][ia]=a;pts[1][ia]=a;pts[m-1][ib]=b;pts[m-2][ib]=b;
        const same=pts.slice(0,-1).every((p,k)=>{const u=unit(p,pts[k+1]),v=unit(P[k],P[k+1]);return u[0]===v[0]&&u[1]===v[1]});
        if(same)equal.push({faces:[fsD,ftD],points:pts});
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
    relations.push({edge:id,status:'PASS',drawnBends:route.bends});
  }
  const status=violations.length?'FAIL':notCheckable.length||!edges.length?'NOT-CHECKABLE':'PASS';
  return {status,evidence:{
    method:'actual SVG path reconstructed into logical bends (fillet = one bend); straight (0) and L (1) candidates over face midpoints, projected alignment points, drawn-anchor projections and a 4-unit face sweep, kept only when perpendicular, clear of unrelated nodes/containers/headings/labels, free of non-shared crossings, >=10 from parallel spans, and long enough for fillet trim + marker axial length + 8; equal-bend midpoint comparison against enumerated L/straight candidates or anchor-shifted copies of the drawn route',
    relations,violations,notCheckable,
    checkedRelations:relations.filter(r=>r.status!=='NOT-CHECKABLE').length,
    limitations:'only rectangular nodes; bend counts below drawn are tried for 0 and 1 bends only (no 2-bend Z/U candidates when the drawing has 3+); equal-bend midpoint for 2+ bends shifts the drawn route anchors only; declared port order, badge exclusions and other relationship-specific constraints are not read; uncertain obstacles block witnesses but never support a PASS'
  }};
}
