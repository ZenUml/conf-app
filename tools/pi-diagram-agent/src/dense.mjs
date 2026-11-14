// Dense-diagram policy (user decision 2026-10-03): from this many SOURCE relations up, zero crossings is no longer the goal.
// Crossings stay measured and reported, but they are minor (non-blocking) and never need a waiver.
export const DENSE_RELATIONS_DEFAULT=20;

/** Threshold in source relations; PI_DIAGRAM_DENSE_RELATIONS overrides it (a positive integer, anything else is ignored). */
export function denseRelationThreshold(env=process.env){
  const raw=env?.PI_DIAGRAM_DENSE_RELATIONS;
  if(raw===undefined||raw===null||String(raw).trim()==='')return DENSE_RELATIONS_DEFAULT;
  const n=Number(raw);
  return Number.isInteger(n)&&n>0?n:DENSE_RELATIONS_DEFAULT;
}

/** null when the diagram is not dense, else {relations,threshold,reason}. */
export function denseInfo(relations,env=process.env){
  const threshold=denseRelationThreshold(env);
  return Number.isFinite(relations)&&relations>=threshold?{relations,threshold,reason:`dense: ${relations} relations >= ${threshold}`}:null;
}
