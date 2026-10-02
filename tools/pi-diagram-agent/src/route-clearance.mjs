// Rule 6 for containers (Diagram Rules, connector rule 6: "Leave whitespace between a route and every non-target box or container. A
// connector must not graze or ride along an unrelated outline.") and B5 for containers (an edge label lives in open space).
// Pure geometry over measured browser data: straight SVG spans of each route, container rectangles, node boxes, resolved label boxes.
//
// Thresholds (SVG units):
//   GRAZE_DISTANCE 8     a straight span this close to a container border runs along it. Rule 14 asks 10 between parallel routes and the
//                        12-unit route-to-border check (geometry.mjs) covers nearness to a border; 8 is the stricter "riding on the outline" band,
//                        so the two do not double-report and a 10-unit gutter on each side stays legal.
//   GRAZE_MIN_LENGTH 24  a shorter parallel run is a fillet or a crossing wobble, not a ride-along (twice the 12-unit crossing allowance).
//   CROSS_ALLOWANCE 12   along a border a connector that must cross it may stay within 12 of the crossing point (fillet + marker approach).
//   LABEL_BORDER_MARGIN 4  an edge label box may not overlap a container border or sit within 4 of it (B5 itself only tests overlap).
//
// Ancestors: a connector MUST cross the border of a container holding exactly one of its endpoints, so only the crossing point (+-12) is
// exempt there. A container holding both endpoints, or the source/target container where the connector merely runs inside along the inner
// border, is not crossed by the connector: a ride-along there is still a graze, because rule 6 forbids riding along an outline and the
// "non-target" wording protects only the target's own arrival face, which is a node border, not a container border.
export const GRAZE_DISTANCE=8;
export const GRAZE_MIN_LENGTH=24;
export const CROSS_ALLOWANCE=12;
export const LABEL_BORDER_MARGIN=4;
// GUTTER_MAX 40 (ADVISORY ONLY, never FAIL): a long run between two facing container borders at most 40 apart rides a channel with under
// 20 units of whitespace each side. Calibration: the pipeline's own standard gutters are 30-40 units and every long inter-column connector
// uses one, so as a FAIL it condemned 4 of the 5 candidates the coordinator judged clean or minor-only (and a 15/15 gutter run of 571 units that the
// coordinator called a defect is geometrically the same as an accepted 422-unit one). It is therefore reported in evidence.advisories only.
export const GUTTER_MAX=40;
const EPS=1e-6;
const round=v=>Math.round(v*10)/10;
const inside=(outer,inner)=>inner.x>=outer.x-1&&inner.y>=outer.y-1&&inner.x+inner.w<=outer.x+outer.w+1&&inner.y+inner.h<=outer.y+outer.h+1;

function sidesOf(b){
  return [
    {side:'top',axis:'h',fixed:b.y,lo:b.x,hi:b.x+b.w},
    {side:'bottom',axis:'h',fixed:b.y+b.h,lo:b.x,hi:b.x+b.w},
    {side:'left',axis:'v',fixed:b.x,lo:b.y,hi:b.y+b.h},
    {side:'right',axis:'v',fixed:b.x+b.w,lo:b.y,hi:b.y+b.h},
  ];
}

/** Longest contiguous part of [lo,hi] left after removing the exempt intervals. */
function longestRemaining(lo,hi,exempt){
  let best=0,cursor=lo;
  for(const [a,b] of [...exempt].sort((p,q)=>p[0]-q[0])){
    if(a>cursor)best=Math.max(best,Math.min(a,hi)-cursor);
    cursor=Math.max(cursor,b);
    if(cursor>=hi)break;
  }
  if(cursor<hi)best=Math.max(best,hi-cursor);
  return best;
}

/** Gap between a box and a rectangle's outline: 0 when it straddles or touches the border, else distance to the nearest side. */
function outlineGap(box,r){
  const L=box.x,R=box.x+box.w,T=box.y,B=box.y+box.h;
  const dx=Math.max(r.x-R,0,L-(r.x+r.w)),dy=Math.max(r.y-B,0,T-(r.y+r.h));
  if(dx>0||dy>0)return Math.hypot(dx,dy);                                   // wholly outside
  const margin=Math.min(L-r.x,r.x+r.w-R,T-r.y,r.y+r.h-B);                   // inside (negative when it straddles)
  return Math.max(0,margin);
}

/** @param input {groups:[{id,outline,box}], nodes:[{id,bbox}], edges:[{source,target,spans}], labels:[{edge,box}], unresolvedLabels:[edge id]} */
export function checkRouteContainerClearance({groups,nodes,edges,labels,unresolvedLabels=[]}){
  const violations=[],labelViolations=[],notCheckable=[],advisories=[];
  const method=`straight spans of each drawn route (SVG path, fillet-trimmed) versus every container rectangle: a span parallel to a border and within ${GRAZE_DISTANCE} units of it for more than ${GRAZE_MIN_LENGTH} units is a graze, except within ${CROSS_ALLOWANCE} units of a point where the connector must cross that border (a container holding exactly one endpoint); riding inside along the border of a source or target container still counts. a straight run longer than ${GRAZE_MIN_LENGTH} units between two facing container borders at most ${GUTTER_MAX} apart is listed as an advisory (not a failure). Edge-label boxes (tagged, or untagged and uniquely matched to one source edge label) must not overlap a container border or sit within ${LABEL_BORDER_MARGIN} units of it`;
  if(!groups.length)return {status:'PASS',evidence:{method,violations,labelViolations,notCheckable,advisories,checkedContainers:0,checkedRelations:edges.length,checkedLabels:labels.length}};
  const rects=[];
  for(const g of groups){
    if(!g.box||g.outline!=='rect'){notCheckable.push({container:g.id,reason:'container has no measurable rectangular outline'});continue}
    rects.push(g);
  }
  const nodeById=new Map((nodes??[]).map(n=>[n.id,n]));
  for(const e of edges){
    const id=`${e.source}->${e.target}`;
    if(!e.spans){notCheckable.push({edge:id,reason:'route straight spans unavailable (unsupported path grammar)'});continue}
    const S=nodeById.get(e.source)?.bbox,T=nodeById.get(e.target)?.bbox;
    for(const g of rects){
      const hasS=!!S&&inside(g.box,S),hasT=!!T&&inside(g.box,T);
      const mustCross=hasS!==hasT;
      const relation=hasS&&hasT?'both-ancestor':hasS?'source-ancestor':hasT?'target-ancestor':'unrelated';
      for(const b of sidesOf(g.box)){
        const exempt=[];
        if(mustCross)for(const p of e.spans)if(p.axis!==b.axis&&p.fixed>=b.lo-EPS&&p.fixed<=b.hi+EPS&&p.lo-EPS<=b.fixed&&p.hi+EPS>=b.fixed)exempt.push([p.fixed-CROSS_ALLOWANCE,p.fixed+CROSS_ALLOWANCE]);
        for(const s of e.spans){
          if(s.axis!==b.axis)continue;
          const distance=Math.abs(s.fixed-b.fixed);
          if(distance>GRAZE_DISTANCE+EPS)continue;
          const lo=Math.max(s.lo,b.lo),hi=Math.min(s.hi,b.hi);
          if(hi-lo<=EPS)continue;
          const length=longestRemaining(lo,hi,exempt);
          if(length>GRAZE_MIN_LENGTH+EPS)violations.push({edge:id,kind:'graze',container:g.id,side:b.side,relation,distance:round(distance),length:round(length)});
        }
      }
    }
  }
  for(const e of edges){
    if(!e.spans)continue;
    const id=`${e.source}->${e.target}`;
    for(const s of e.spans){
      const near=[];
      for(const g of rects)for(const b of sidesOf(g.box)){
        if(b.axis!==s.axis)continue;
        const lo=Math.max(s.lo,b.lo),hi=Math.min(s.hi,b.hi);
        if(hi-lo>GRAZE_MIN_LENGTH+EPS)near.push({id:g.id,fixed:b.fixed,lo,hi});
      }
      const below=near.filter(b=>b.fixed<s.fixed-EPS).sort((p,q)=>q.fixed-p.fixed)[0],above=near.filter(b=>b.fixed>s.fixed+EPS).sort((p,q)=>p.fixed-q.fixed)[0];
      if(!below||!above||below.id===above.id)continue;
      const width=above.fixed-below.fixed,lo=Math.max(below.lo,above.lo),hi=Math.min(below.hi,above.hi);
      if(width<=GUTTER_MAX+EPS&&hi-lo>GRAZE_MIN_LENGTH+EPS)advisories.push({edge:id,kind:'gutter',containers:[below.id,above.id],width:round(width),length:round(hi-lo),distances:[round(s.fixed-below.fixed),round(above.fixed-s.fixed)]});
    }
  }
  for(const l of labels){
    for(const g of rects){
      const gap=outlineGap(l.box,g.box);
      if(gap<LABEL_BORDER_MARGIN-EPS)labelViolations.push({edge:l.edge,container:g.id,gap:round(gap)});
    }
  }
  for(const edge of unresolvedLabels)notCheckable.push({edge,reason:'edge label box unavailable (not drawn, untagged and ambiguous, or source labels unknown)'});
  const status=violations.length||labelViolations.length?'FAIL':notCheckable.length?'NOT-CHECKABLE':'PASS';
  return {status,evidence:{method,thresholds:{gutterMax:GUTTER_MAX,grazeDistance:GRAZE_DISTANCE,grazeMinLength:GRAZE_MIN_LENGTH,crossAllowance:CROSS_ALLOWANCE,labelBorderMargin:LABEL_BORDER_MARGIN},violations,labelViolations,notCheckable,advisories,checkedContainers:rects.length,checkedRelations:edges.filter(e=>e.spans).length,checkedLabels:labels.length}};
}
