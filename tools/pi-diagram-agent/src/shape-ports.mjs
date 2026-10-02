// Ports and a convex obstacle for a non-rectangular node, derived only from its drawn outline (dense samples of the painted
// outline in root user space). No shape name is read: a silhouette is supported when it is convex and, on each of the four
// sides, either ends in a single apex or has one flat face, and that apex/face sits at the middle of the bounding box.
// That covers diamond (4 apexes), long-text decision hexagon (top/bottom apex + flat sides), cylinder/store (flat sides +
// top/bottom ellipse apex), queue (flat top/bottom + end apexes), capsule/stadium (flat top/bottom + end apexes) and
// circle/ellipse (4 cardinal apexes). Anything else (triangle, parallelogram, L-shape, star...) is reported as an error so
// the caller marks the relationship NOT-CHECKABLE instead of guessing a port.
const FLAT_TOLERANCE=0.005;   // sample distance from the extreme that still counts as lying on it
const FLAT_MIN_SPAN=4;        // an extreme run shorter than this is a curved apex, not a face
const FLAT_INSET=1;           // keep anchors off the tangent ends of a flat face that meets a curve
const HULL_TOLERANCE=0.6;     // every sample must lie on its convex hull for the outline to count as convex
const APEX_WINDOW=1;          // samples within this depth of an apex are fitted with a parabola to locate it between samples
const CENTRE_TOLERANCE=1;     // plus 1% of the dimension: apex/face must sit at the bounding-box middle

const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
export function convexHull(points){
  const pts=[...new Map(points.map(p=>[`${p[0]},${p[1]}`,p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(pts.length<3)return pts;
  const lower=[],upper=[];
  for(const p of pts){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}
  for(const p of [...pts].reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
const segDistance=(p,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};

// Least-squares parabola v = a*u^2 + b*u + c over [along, depth] pairs; returns the vertex.
function fitApex(pairs){
  if(pairs.length<3)return null;
  const mean=pairs.reduce((t,p)=>t+p[0],0)/pairs.length,U=pairs.map(p=>p[0]-mean),V=pairs.map(p=>p[1]);
  if(Math.max(...U)-Math.min(...U)<1e-6)return null;
  const sum=(f)=>U.reduce((t,u,i)=>t+f(u,V[i]),0),n=U.length;
  const s1=sum(u=>u),s2=sum(u=>u*u),s3=sum(u=>u**3),s4=sum(u=>u**4),t0=sum((u,v)=>v),t1=sum((u,v)=>u*v),t2=sum((u,v)=>u*u*v);
  // Normal equations for [a b c] solved by Cramer's rule.
  const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const M=[[s4,s3,s2],[s3,s2,s1],[s2,s1,n]],D=det(M);
  if(Math.abs(D)<1e-12)return null;
  const a=det([[t2,s3,s2],[t1,s2,s1],[t0,s1,n]])/D,b=det([[s4,t2,s2],[s3,t1,s1],[s2,t0,n]])/D,c=det([[s4,s3,t2],[s3,s2,t1],[s2,s1,t0]])/D;
  if(Math.abs(a)<1e-9)return null;
  const u=-b/(2*a);
  return Number.isFinite(u)?{along:mean+u,depth:c-b*b/(4*a)}:null;
}

export function derivePorts(samples){
  if(!Array.isArray(samples)||samples.length<8||!samples.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))return {error:'outline could not be sampled'};
  const xs=samples.map(p=>p[0]),ys=samples.map(p=>p[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),w=x1-x0,h=y1-y0;
  if(!(w>0&&h>0))return {error:'degenerate outline'};
  const hull=convexHull(samples);
  if(hull.length<3)return {error:'degenerate outline'};
  for(const p of samples){
    let d=Infinity;
    for(let i=0;i<hull.length;i++)d=Math.min(d,segDistance(p,hull[i],hull[(i+1)%hull.length]));
    if(d>HULL_TOLERANCE)return {error:'non-convex outline (no supported port definition)'};
  }
  const faces=[],mid={x:(x0+x1)/2,y:(y0+y1)/2};
  const side=(name,normal,axis,fixed,pick,centre,dimension)=>{
    const run=samples.filter(p=>Math.abs(pick(p)-fixed)<=FLAT_TOLERANCE).map(p=>axis==='x'?p[0]:p[1]);
    const lo=Math.min(...run),hi=Math.max(...run),flat=hi-lo>=FLAT_MIN_SPAN;
    let along=(lo+hi)/2,apexFixed=fixed;
    if(!flat){
      const fit=fitApex(samples.filter(p=>Math.abs(pick(p)-fixed)<=APEX_WINDOW).map(p=>axis==='x'?[p[0],p[1]]:[p[1],p[0]]));
      if(fit&&Math.abs(fit.depth-fixed)<0.05){along=fit.along;apexFixed=fit.depth}
    }
    if(Math.abs(along-centre)>CENTRE_TOLERANCE+0.01*dimension)return {error:`${name} ${flat?'face':'apex'} is not centred on the outline (no supported port definition)`};
    const ilo=flat?lo+FLAT_INSET:along,ihi=flat?hi-FLAT_INSET:along;
    return {name,normal,axis,fixed:apexFixed,lo:flat?lo:along,hi:flat?hi:along,ilo,ihi,mid:along,kind:flat?'flat':'apex',...(flat?{}:{point:axis==='x'?[along,apexFixed]:[apexFixed,along]})};
  };
  for(const f of [
    side('top',[0,-1],'x',y0,p=>p[1],mid.x,w),
    side('right',[1,0],'y',x1,p=>p[0],mid.y,h),
    side('bottom',[0,1],'x',y1,p=>p[1],mid.x,w),
    side('left',[-1,0],'y',x0,p=>p[0],mid.y,h)]){
    if(f.error)return f;
    faces.push(f);
  }
  return {faces,hull,bbox:{x:x0,y:y0,w,h},descriptor:faces.map(f=>`${f.name}:${f.kind}`).join(' ')};
}

/** Extent of a convex polygon along one axis at a fixed perpendicular coordinate, widened by `guard` on every side. */
export function hullSpanAt(hull,axis,fixed,guard){
  const f=axis==='h'?1:0,s=1-f;       // f = index of the fixed coordinate: a horizontal segment (y fixed) spans along x
  const probes=[fixed-guard,fixed,fixed+guard,...hull.map(p=>p[f]).filter(v=>v>fixed-guard&&v<fixed+guard)];
  let lo=Infinity,hi=-Infinity;
  for(const c of probes){
    for(let i=0;i<hull.length;i++){
      const a=hull[i],b=hull[(i+1)%hull.length];
      if((a[f]-c)*(b[f]-c)>0||a[f]===b[f]&&a[f]!==c)continue;
      if(a[f]===b[f]){lo=Math.min(lo,a[s],b[s]);hi=Math.max(hi,a[s],b[s]);continue}
      const t=(c-a[f])/(b[f]-a[f]),v=a[s]+t*(b[s]-a[s]);lo=Math.min(lo,v);hi=Math.max(hi,v);
    }
  }
  return lo<=hi?[lo-guard,hi+guard]:null;
}
