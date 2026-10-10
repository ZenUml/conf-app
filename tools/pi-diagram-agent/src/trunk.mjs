// Shared-trunk convention (diagram rule 10). One documented attribute, no inferred or invented names.
export const TRUNK_ATTR='data-shared-trunk';
export const TRUNK_TOLERANCE=0.5;
export const TRUNK_HINT=`Only ${TRUNK_ATTR}="<id>" (same id on every member, same target, same entry direction) declares a shared trunk; other trunk-like attributes are ignored.`;

/** Attributes on a connector that look like a trunk declaration but are not the documented one. */
export function unrecognisedTrunkAttributes(attributes){
  return attributes.filter(a=>a.name!==TRUNK_ATTR&&/bus|trunk|merge|junction|shared/i.test(a.name));
}

/**
 * True only when span a of connector A and span b of connector B are the coincident final portion of both routes at one target.
 * A,B: {trunk, target, spans, lastCommand?}; each span {axis,fixed,lo,hi,end}. Callers pass the span objects taken from A.spans / B.spans.
 */
export function isAcceptedTrunkOverlap(A,B,a,b){
  if(!A.trunk||A.trunk!==B.trunk||A.target!==B.target)return false;
  if(a!==A.spans.at(-1)||b!==B.spans.at(-1))return false;
  if((A.lastCommand??'L')!=='L'||(B.lastCommand??'L')!=='L')return false;
  if(a.axis!==b.axis||Math.abs(a.fixed-b.fixed)>TRUNK_TOLERANCE)return false;
  return Number.isFinite(a.end)&&Number.isFinite(b.end)&&Math.abs(a.end-b.end)<=TRUNK_TOLERANCE;
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

/** Final spans of two members that coincide: the shared portion of the trunk. */
function sharedPortion(A,B){
  const a=A.spans.at(-1),b=B.spans.at(-1);
  if(!a||!b||a.axis!==b.axis||Math.abs(a.fixed-b.fixed)>TRUNK_TOLERANCE||Math.abs(a.end-b.end)>TRUNK_TOLERANCE)return null;
  const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);
  return hi>lo?{axis:a.axis,fixed:a.fixed,lo,hi}:null;
}

/**
 * Semantics a declared trunk must satisfy beyond coincident geometry (rules 9, 10, 11, B5), plus the head-on T-junction test for undeclared meetings.
 * routes: [{edge,trunk,target,spans,style:{dash,width,stroke}}]; labelBoxes: [{label,box:{x,y,w,h}}]. Returns violations [{kind,...}].
 */
export function checkTrunkSemantics({routes,labelBoxes=[]}){
  const out=[];
  const groups=new Map();
  for(const r of routes)if(r.trunk&&r.spans?.length)(groups.get(`${r.trunk}\0${r.target}`)??groups.set(`${r.trunk}\0${r.target}`,[]).get(`${r.trunk}\0${r.target}`)).push(r);
  for(const members of groups.values()){
    if(members.length<2)continue;
    const id=members[0].trunk,edges=members.map(m=>m.edge);
    if(members.some(m=>!sameStyle(m.style,members[0].style)))out.push({kind:'mixed-style trunk',trunk:id,edges,styles:members.map(m=>({edge:m.edge,...m.style}))});
    const entries=members.flatMap(m=>{const fin=m.spans.at(-1),pre=m.spans.length>1?m.spans.at(-2):null;return pre&&pre.axis!==fin.axis?[{edge:m.edge,side:dirKey(pre)}]:[]});
    if(new Set(entries.map(e=>e.side)).size>1)out.push({kind:'opposite-side merge',trunk:id,edges,entries});
    const portions=[];
    for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++){const p=sharedPortion(members[i],members[j]);if(p)portions.push(p)}
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
