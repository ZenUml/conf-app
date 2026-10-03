// routeCornerAnchor (Diagram Rules, connector rule 2 "do not land on a box corner"): a connector endpoint that lies on a rectangular
// node face must keep at least max(8 units, 10% of the face length) from the nearer end of that face. Measured on the drawn route
// (actual SVG path endpoints) against the measured node outline; pure geometry, no source semantics.
//
// Scope: rectangles and rounded rectangles (face length and ends are the STRAIGHT edge, so an endpoint inside a rounded corner is at a
// negative distance and fails). Fixed-port shapes (diamond/decision, circle, cylinder, capsule and every other non-rectangular shape the
// auditor classifies as kind 'shape') are excluded: their ports are fixed points by design. An endpoint that cannot be resolved to a
// rectangular face (curved or diagonal path, endpoint not on a face, unmeasured node) is NOT-CHECKABLE for that relation, never PASS.
import {parseOrthogonalRoute} from './route-lower-bend.mjs';

export const CORNER_MIN_UNITS=8;
export const CORNER_MIN_FRACTION=0.1;
const FACE_TOLERANCE=1;   // endpoint-to-outline tolerance, same as the lower-bend face matcher
const EPS=1e-6;
const round3=v=>Math.round(v*1000)/1000;
const sign=v=>v>EPS?1:v<-EPS?-1:0;
const unit=(a,b)=>[sign(b[0]-a[0]),sign(b[1]-a[1])];

const facesOf=rect=>{
  const mk=(name,normal,axis,fixed,lo,hi)=>({name,normal,axis,fixed,lo,hi});
  return [mk('top',[0,-1],'x',rect.y,rect.x,rect.x+rect.w),mk('right',[1,0],'y',rect.x+rect.w,rect.y,rect.y+rect.h),
    mk('bottom',[0,1],'x',rect.y+rect.h,rect.x,rect.x+rect.w),mk('left',[-1,0],'y',rect.x,rect.y,rect.y+rect.h)];
};
const alongOf=(f,p)=>f.axis==='x'?p[0]:p[1];
const onFace=(f,p)=>Math.abs((f.axis==='x'?p[1]:p[0])-f.fixed)<=FACE_TOLERANCE&&alongOf(f,p)>=f.lo-FACE_TOLERANCE&&alongOf(f,p)<=f.hi+FACE_TOLERANCE;

/** @param input {nodes:[{id,kind,outline,cornerRadius}], edges:[{source,target,tag,path,trunk}]} */
export function checkRouteCornerAnchor({nodes,edges}){
  const method=`actual route endpoints (SVG path, first and last point) that lie on a face of a rectangular or rounded-rectangular node (face length and ends measured on the straight edge): distance to the nearer end of that face must be at least max(${CORNER_MIN_UNITS} units, ${CORNER_MIN_FRACTION*100}% of the face length); fixed-port shapes (diamond, circle, cylinder and other non-rectangular outlines) are excluded; an endpoint that cannot be resolved to a rectangular face is NOT-CHECKABLE`;
  const nodeById=new Map();for(const n of nodes)if(!nodeById.has(n.id))nodeById.set(n.id,n);
  const ends=[],notCheckable=[];let excludedEnds=0;
  for(const e of edges){
    const id=`${e.source}->${e.target}`;
    const roles=[['source',e.source],['target',e.target]];
    const kinds=roles.map(([,nid])=>nodeById.get(nid)?.kind);
    const rectRoles=roles.filter((_,i)=>kinds[i]!=='shape');
    excludedEnds+=roles.length-rectRoles.length;
    if(!rectRoles.length)continue;                              // both ends are fixed-port shapes
    const route=e.tag==='path'?parseOrthogonalRoute(e.path):{error:'relationship is not a path element'};
    if(route.error){notCheckable.push({edge:id,reason:`endpoints cannot be resolved to a face: ${route.error}`});continue}
    const pts=route.points,dIn=unit(pts[0],pts[1]),dOut=unit(pts.at(-2),pts.at(-1));
    for(const [role,nid] of rectRoles){
      const n=nodeById.get(nid);
      if(!n||n.kind!=='rect'||!n.outline){notCheckable.push({edge:id,end:role,node:nid,reason:`node outline unsupported (${n?.reason??'not measured'})`});continue}
      const p=role==='source'?pts[0]:pts.at(-1),dir=role==='source'?dIn:[-dOut[0],-dOut[1]];
      const face=facesOf(n.outline).find(f=>onFace(f,p)&&f.normal[0]===dir[0]&&f.normal[1]===dir[1]);
      if(!face){notCheckable.push({edge:id,end:role,node:nid,reason:'endpoint does not lie on a face of its node, or does not meet it perpendicularly'});continue}
      const m=Math.max(0,Math.min(n.cornerRadius||0,Math.min(n.outline.w,n.outline.h)/2));
      ends.push({edge:id,end:role,node:nid,face:face.name,axis:face.axis,fixed:face.fixed,lo:face.lo+m,hi:face.hi-m,along:alongOf(face,p),trunk:role==='target'?e.trunk||null:null,target:e.target});
    }
  }
  // Attachments per node face (a declared shared trunk entering one face is a single attachment); needed only for the repair hint slots.
  const groups=new Map();
  for(const x of ends){const k=`${x.node}|${x.face}`;(groups.get(k)??groups.set(k,[]).get(k)).push(x)}
  for(const list of groups.values()){
    const att=[],seen=new Map();
    for(const x of list){
      if(x.trunk){const k=`${x.trunk}|${x.target}`;if(seen.has(k)){x.attachment=seen.get(k);continue}seen.set(k,x)}
      x.attachment=x;att.push(x);
    }
    att.sort((a,b)=>a.along-b.along);
    for(const x of list)x.sharedBy=att.length,x.rank=att.indexOf(x.attachment)+1;
  }
  const violations=[];
  for(const x of ends){
    const len=x.hi-x.lo,threshold=Math.max(CORNER_MIN_UNITS,CORNER_MIN_FRACTION*len);
    const distance=Math.min(x.along-x.lo,x.hi-x.along);
    if(distance>=threshold-EPS)continue;
    const n=x.sharedBy,k=x.rank;
    let anchor=n===1?(x.lo+x.hi)/2:x.lo+len*k/(n+1),slot=n===1?'midpoint':`${k}/${n+1}`;
    if(len>=2*threshold&&n>1){const clamped=Math.min(x.hi-threshold,Math.max(x.lo+threshold,anchor));if(Math.abs(clamped-anchor)>EPS){anchor=clamped;slot+=' (clamped to the threshold)'}}
    const point=x.axis==='x'?[round3(anchor),x.fixed]:[x.fixed,round3(anchor)];
    violations.push({edge:x.edge,end:x.end,node:x.node,face:x.face,distance:round3(distance),threshold:round3(threshold),faceLength:round3(len),anchor:round3(x.along),sharedBy:n,
      repairHint:{anchor:round3(anchor),point,slot,text:`move the ${x.end} end of ${x.edge} on the ${x.face} face of ${x.node} to ${x.axis}=${round3(anchor)} (${slot} of the ${round3(len)}-unit face; keep at least ${round3(threshold)} units from the face ends)`}});
  }
  const status=violations.length?'FAIL':notCheckable.length?'NOT-CHECKABLE':'PASS';
  return {status,evidence:{method,thresholds:{minUnits:CORNER_MIN_UNITS,minFraction:CORNER_MIN_FRACTION},violations,notCheckable,checkedEnds:ends.length,excludedEnds,checkedRelations:edges.length}};
}
