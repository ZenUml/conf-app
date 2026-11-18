import {isSharedTrunkJoin} from './trunk.mjs';
const EPS=1e-6;
// Count actual visible intersections once, retaining every logical relationship pair.
// A family id alone never waives a crossing before a proved continuous shared suffix.
export function visibleRouteCrossings(routes){
  const byPoint=new Map();let logicalCrossings=0,joinsExcluded=0;
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
    const A=routes[i],B=routes[j];
    for(const a of A.spans??[])for(const b of B.spans??[]){
      if(a.axis===b.axis)continue;
      const h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;
      if(!(v.fixed>h.lo+EPS&&v.fixed<h.hi-EPS&&h.fixed>v.lo+EPS&&h.fixed<v.hi-EPS))continue;
      const point={x:v.fixed,y:h.fixed};
      if(isSharedTrunkJoin(A,B,point)){joinsExcluded++;continue}
      logicalCrossings++;
      const key=`${point.x.toFixed(6)},${point.y.toFixed(6)}`;
      const hit=byPoint.get(key)??{edgeA:A.edge,edgeB:B.edge,...point,edgePairs:[]};
      const edgeAId=A.id??A.edge,edgeBId=B.id??B.edge;
      if(!hit.edgePairs.some(p=>p.edgeAId===edgeAId&&p.edgeBId===edgeBId))hit.edgePairs.push({edgeA:A.edge,edgeB:B.edge,edgeAId,edgeBId});
      byPoint.set(key,hit);
    }
  }
  return {crossings:[...byPoint.values()],logicalCrossings,joinsExcluded};
}
