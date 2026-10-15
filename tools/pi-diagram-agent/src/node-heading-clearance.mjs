// nodeHeadingClearance: every node outline keeps >= 8 units from every group heading/subtitle text box (rule T1: no text collisions incl. borders),
// and >= 8 units from the border of every container that holds it (B10). Pure geometry over the facts the browser collected (lbNodes, lbGroups).
export const HEADING_CLEARANCE=8,CONTAINER_MARGIN=8;
const rectGap=(p,r)=>Math.hypot(Math.max(r.x-p[0],0,p[0]-(r.x+r.w)),Math.max(r.y-p[1],0,p[1]-(r.y+r.h)));
const r2=n=>Math.round(n*100)/100;
function extent(node){
  if(node.kind==='rect'&&node.outline)return node.outline;
  if(node.kind==='shape'&&node.samples?.length){
    const xs=node.samples.map(p=>p[0]),ys=node.samples.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);
    return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
  }
  return null;
}
/** Gap between a node's drawn outline (rect box or sampled path) and a heading box; 0 when they overlap. */
function outlineGap(node,box,bound=null){
  if(node.kind==='rect'){
    const o=node.outline;
    return Math.hypot(Math.max(o.x-(box.x+box.w),0,box.x-(o.x+o.w)),Math.max(o.y-(box.y+box.h),0,box.y-(o.y+o.h)));
  }
  // Prefilter: every sample lies in the sample bbox, so the bbox-to-box gap lower-bounds the outline gap. Callers that only act on a gap below
  // `bound` pass it and get back Infinity when the bbox alone already proves the gap is at least that large.
  if(bound!==null&&node.extent&&Math.max(node.extent.x-(box.x+box.w),0,box.x-(node.extent.x+node.extent.w))**2+Math.max(node.extent.y-(box.y+box.h),0,box.y-(node.extent.y+node.extent.h))**2>=bound*bound+1e-6)return Infinity;
  let best=Infinity;for(const p of node.samples)best=Math.min(best,rectGap(p,box));
  return best;
}
const contains=(outer,inner)=>inner.x>=outer.x-0.25&&inner.y>=outer.y-0.25&&inner.x+inner.w<=outer.x+outer.w+0.25&&inner.y+inner.h<=outer.y+outer.h+0.25;

export function checkNodeHeadingClearance({nodes,groups}){
  const method=`node outline (rect box or drawn path sampled at <=0.5-unit steps) versus every group heading/subtitle text bbox (>= ${HEADING_CLEARANCE} units) and versus the border of each container that holds the node (>= ${CONTAINER_MARGIN} units, B10)`;
  const violations=[],notCheckableNodeIds=[],reasons={};
  const measured=[];
  for(const node of nodes){
    if(!extent(node)){notCheckableNodeIds.push(node.id);reasons[node.id]=node.reason??'outline not measurable';continue}
    measured.push(node.kind==='shape'?{...node,extent:extent(node)}:node);
  }
  groups=groups.filter(g=>!g.isNode); // a node element may carry data-group membership metadata; it is not a container
  const usable=groups.filter(g=>g.box&&g.box.w>0&&g.box.h>0);
  const headingsOf=g=>(g.headingTexts??g.headings??[]).filter(h=>h&&h.w>0&&h.h>0);
  for(const node of measured){
    for(const g of groups){
      for(const h of headingsOf(g)){
        const gap=outlineGap(node,h,HEADING_CLEARANCE);
        if(gap<HEADING_CLEARANCE)violations.push({kind:'heading',nodeId:node.id,groupId:g.id,gap:r2(gap),required:HEADING_CLEARANCE,heading:{x:r2(h.x),y:r2(h.y),w:r2(h.w),h:r2(h.h)}});
      }
    }
    const e=extent(node);
    for(const g of usable){
      if(g.outline!=='rect'||!contains(g.box,e))continue;
      const gap=Math.min(e.x-g.box.x,e.y-g.box.y,g.box.x+g.box.w-(e.x+e.w),g.box.y+g.box.h-(e.y+e.h));
      if(gap<CONTAINER_MARGIN)violations.push({kind:'container-border',nodeId:node.id,groupId:g.id,gap:r2(gap),required:CONTAINER_MARGIN});
    }
  }
  const status=violations.length?'FAIL':notCheckableNodeIds.length||!nodes.length?'NOT-CHECKABLE':'PASS';
  return {status,evidence:{method,violations,notCheckableNodeIds,reasons,checkedNodes:measured.length,checkedGroups:groups.length,headingTexts:groups.reduce((n,g)=>n+headingsOf(g).length,0),
    ...(status==='NOT-CHECKABLE'&&!nodes.length?{reason:'no drawn node outlines'}:{})}};
}
