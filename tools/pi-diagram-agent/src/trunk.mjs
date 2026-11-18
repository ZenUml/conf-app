// Shared-trunk convention (diagram rule 10). One documented attribute, no inferred or invented names.
export const TRUNK_ATTR='data-shared-trunk';
export const TRUNK_TOLERANCE=0.5;
export const TRUNK_HINT=`Only ${TRUNK_ATTR}="<id>" (same id on every member, same target, same entry direction) declares a shared trunk; other trunk-like attributes are ignored.`;

/** Attributes on a connector that look like a trunk declaration but are not the documented one. */
export function unrecognisedTrunkAttributes(attributes){
  return attributes.filter(a=>a.name!==TRUNK_ATTR&&/bus|trunk|merge|junction|shared/i.test(a.name));
}

const EPS=1e-6;
const close=(a,b)=>Math.abs(a-b)<=EPS;
const pointClose=(a,b)=>a&&b&&close(a[0],b[0])&&close(a[1],b[1]);
function routePoints(r){
  let points=r.points;
  if(!points&&r.spans?.length){
    // Legacy measured straight spans: Q fillet corners are supplied by the SVG
    // reader. A caller with logical SVG-parsed points should pass those instead.
    const spans=r.spans;
    points=[spans[0].axis==='h'?[spans[0].start,spans[0].fixed]:[spans[0].fixed,spans[0].start]];
    for(let i=0;i<spans.length;i++){
      const a=spans[i],b=spans[i+1];
      if(b&&a.axis!==b.axis){if(!close(a.corner,b.fixed))return null;points.push(a.axis==='h'?[b.fixed,a.fixed]:[a.fixed,b.fixed])}
      else points.push(a.axis==='h'?[a.end,a.fixed]:[a.fixed,a.end]);
    }
  }
  if(!points||points.length<2||points.some(p=>!p||p.length!==2||!p.every(Number.isFinite)))return null;
  const out=[];
  for(const p of points){if(out.length&&pointClose(out.at(-1),p))continue;out.push([...p]);while(out.length>=3){const [a,b,c]=out.slice(-3),ab=[b[0]-a[0],b[1]-a[1]],bc=[c[0]-b[0],c[1]-b[1]];if(Math.abs(ab[0]*bc[1]-ab[1]*bc[0])>EPS)break;if(ab[0]*bc[0]+ab[1]*bc[1]<=0)return null;out.splice(-2,1)}}
  if(out.some((p,i)=>i&&Math.abs(p[0]-out[i-1][0])>EPS&&Math.abs(p[1]-out[i-1][1])>EPS))return null;
  return out;
}
const segment=(a,b)=>{const axis=Math.abs(a[1]-b[1])<=EPS?'h':'v',k=axis==='h'?0:1;return {axis,fixed:a[1-k],lo:Math.min(a[k],b[k]),hi:Math.max(a[k],b[k]),dir:Math.sign(b[k]-a[k])}};
/** Continuous same-direction suffix ending at one target; no earlier overlap is
 * accepted after a split/rejoin. Points must be reconstructed from actual SVG. */
export function sharedSuffix(A,B){
  if(!A.trunk||A.trunk!==B.trunk||A.target!==B.target)return null;
  if(A.style&&B.style&&!sameStyle(A.style,B.style))return null;
  if((A.lastCommand??A.spans?.lastCommand??'L')!=='L'||(B.lastCommand??B.spans?.lastCommand??'L')!=='L')return null;
  const ap=routePoints(A),bp=routePoints(B);if(!ap||!bp||!pointClose(ap.at(-1),bp.at(-1)))return null;
  let i=ap.length-1,j=bp.length-1,end=[...ap.at(-1)];const backwards=[end];
  while(i>0&&j>0){const a=segment(ap[i-1],end),b=segment(bp[j-1],end);if(a.axis!==b.axis||a.dir!==b.dir||!close(a.fixed,b.fixed))break;
    const k=a.axis==='h'?0:1,start=[...end];start[k]=a.dir>0?Math.max(ap[i-1][k],bp[j-1][k]):Math.min(ap[i-1][k],bp[j-1][k]);
    if(Math.abs(start[k]-end[k])<=EPS)break;backwards.push(start);
    const finishA=pointClose(start,ap[i-1]),finishB=pointClose(start,bp[j-1]);end=start;
    if(finishA)i--;if(finishB)j--;if(!finishA||!finishB)break;
  }
  if(backwards.length<2)return null;if(backwards.length>2&&Number.isFinite(A.trim)&&Number.isFinite(B.trim)&&Math.abs(A.trim-B.trim)>EPS)return null;const points=backwards.reverse(),sections=points.slice(1).map((p,k)=>segment(points[k],p));
  return {points,sections,join:points[0],length:sections.reduce((n,s)=>n+s.hi-s.lo,0)};
}
const spanDirection=s=>s.dir??(Number.isFinite(s.end)?(close(s.end,s.hi)?1:-1):null);
export function isAcceptedTrunkOverlap(A,B,a,b){
  const dir=spanDirection(a);if(dir===null)return false;
  if(a.axis!==b.axis||!close(a.fixed,b.fixed)||dir!==spanDirection(b))return false;
  const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);if(hi-lo<=EPS)return false;
  const suffix=sharedSuffix(A,B);return !!suffix?.sections.some(s=>s.axis===a.axis&&s.dir===dir&&close(s.fixed,a.fixed)&&lo>=s.lo-EPS&&hi<=s.hi+EPS);
}
/** Only a proved suffix entry/corner is a merge join, never every intersection of
 * two declared members. Caller still reports unrelated/premerge crossings. */
export function isSharedTrunkJoin(A,B,{x,y}){const suffix=sharedSuffix(A,B);return !!suffix?.points.slice(0,-1).some(p=>pointClose(p,[x,y]));}
/** Advisory opportunities only. Threshold affects advice, never validity. */
export function earlyMergeAdvisories({routes,minParallelLength=80}){
  const out=[];
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
    const A=routes[i],B=routes[j];if(!A.trunk||A.trunk!==B.trunk||A.target!==B.target||A.style&&B.style&&!sameStyle(A.style,B.style))continue;const suffix=sharedSuffix(A,B);
    for(const a of A.spans??[])for(const b of B.spans??[]){
      if(isAcceptedTrunkOverlap(A,B,a,b))continue;
      if(a.axis===b.axis&&a.dir===b.dir){const length=Math.min(a.hi,b.hi)-Math.max(a.lo,b.lo),separation=Math.abs(a.fixed-b.fixed);if(length>=minParallelLength&&separation>TRUNK_TOLERANCE&&separation<=40)out.push({kind:'early-merge',reason:'long duplicate premerge parallel lanes',edgeA:A.edge,edgeB:B.edge,length,separation,join:suffix?.join??null})}
      else if(a.axis!==b.axis){const h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;if(v.fixed>h.lo+EPS&&v.fixed<h.hi-EPS&&h.fixed>v.lo+EPS&&h.fixed<v.hi-EPS&&!isSharedTrunkJoin(A,B,{x:v.fixed,y:h.fixed}))out.push({kind:'early-merge',reason:'same-family premerge crossing',edgeA:A.edge,edgeB:B.edge,x:v.fixed,y:h.fixed,join:suffix?.join??null})}
    }
  }
  return [...new Map(out.map(v=>[JSON.stringify(v),v])).values()];
}

/** Group accepted pairs into per-trunk evidence. */
export function summariseTrunks(accepted){
  const byId=new Map();
  for(const {id,target,edgeA,edgeB,overlap} of accepted){
    const t=byId.get(id)??byId.set(id,{id,target,edges:new Set(),sharedLength:0}).get(id);
    t.edges.add(edgeA);t.edges.add(edgeB);t.sharedLength=Math.max(t.sharedLength,overlap);
  }
  return [...byId.values()].map(t=>({id:t.id,target:t.target,edges:[...t.edges],sharedLength:t.sharedLength}));
}

export const TRUNK_LABEL_CLEARANCE=4;
const JUNCTION_GAP=10.5; // two fillets (r=5) plus measurement slack
const dirKey=span=>`${span.axis}${span.dir>0?'+':'-'}`;
const sameStyle=(a,b)=>a.dash===b.dash&&a.width===b.width&&a.stroke===b.stroke;

/**
 * Semantics a declared trunk must satisfy beyond coincident geometry (rules 9, 10, 11, B5), plus the head-on T-junction test for undeclared meetings.
 * routes: [{edge,trunk,target,spans,style:{dash,width,stroke}}]; labelBoxes: [{label,box:{x,y,w,h}}]. Returns violations [{kind,...}].
 */
export function checkTrunkSemantics({routes,labelBoxes=[]}){
  const out=[];
  const groups=new Map();
  for(const r of routes)if(r.trunk&&r.spans?.length)(groups.get(`${r.trunk}\0${r.target}`)??groups.set(`${r.trunk}\0${r.target}`,[]).get(`${r.trunk}\0${r.target}`)).push(r);
  const declared=new Map();for(const r of routes)if(r.trunk)(declared.get(r.trunk)??declared.set(r.trunk,[]).get(r.trunk)).push(r);
  for(const [trunk,members] of declared)if(new Set(members.map(m=>m.target)).size>1)out.push({kind:'mixed-target trunk',trunk,edges:members.map(m=>m.edge)});
  for(const members of groups.values()){
    if(members.length<2)continue;
    const id=members[0].trunk,edges=members.map(m=>m.edge);
    if(members.some(m=>!sameStyle(m.style,members[0].style)))out.push({kind:'mixed-style trunk',trunk:id,edges,styles:members.map(m=>({edge:m.edge,...m.style}))});
    const entries=members.flatMap(m=>{const fin=m.spans.at(-1),pre=m.spans.length>1?m.spans.at(-2):null;return pre&&pre.axis!==fin.axis?[{edge:m.edge,side:dirKey(pre)}]:[]});
    if(new Set(entries.map(e=>e.side)).size>1&&members.every(m=>members.some(o=>o!==m&&(sharedSuffix(m,o)?.sections.length??0)===1)))out.push({kind:'opposite-side merge',trunk:id,edges,entries});
    const portions=[];
    for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++){const suffix=sharedSuffix(members[i],members[j]);if(suffix)portions.push(...suffix.sections)}
    for(const p of portions)for(const l of labelBoxes){
      const g=TRUNK_LABEL_CLEARANCE,b=l.box;if(!b)continue;
      const hit=p.axis==='h'?p.fixed>=b.y-g&&p.fixed<=b.y+b.h+g&&p.hi>=b.x-g&&p.lo<=b.x+b.w+g:p.fixed>=b.x-g&&p.fixed<=b.x+b.w+g&&p.hi>=b.y-g&&p.lo<=b.y+b.h+g;
      if(hit&&!out.some(v=>v.kind==='label on shared trunk'&&v.label===l.label&&v.trunk===id))out.push({kind:'label on shared trunk',trunk:id,label:l.label,edges,clearance:g});
    }
  }
  // Undeclared (or differently declared) connectors into one target whose legs meet head-on on one line read as a link between their sources.
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
    const A=routes[i],B=routes[j];
    if(A.target!==B.target||!A.spans||!B.spans||(A.trunk&&A.trunk===B.trunk))continue;
    const hit=A.spans.some(a=>B.spans.some(b=>a.axis===b.axis&&a!==A.spans.at(-1)&&b!==B.spans.at(-1)&&Math.abs(a.fixed-b.fixed)<=TRUNK_TOLERANCE&&a.dir===-b.dir&&(b.corner-a.corner)*a.dir>=-TRUNK_TOLERANCE&&(b.corner-a.corner)*a.dir<=JUNCTION_GAP));
    if(hit)out.push({kind:'ambiguous junction',edgeA:A.edge,edgeB:B.edge});
  }
  return out;
}
