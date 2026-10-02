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
