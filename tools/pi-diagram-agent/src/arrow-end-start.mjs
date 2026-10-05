// Actual SVG geometry only. Supported filled convex straight-sided marker silhouettes
// are compared with the other connector's painted first straight shaft (butt/round/square
// caps are unsupported; a butt rectangle would underbound them). No spacing margin is imposed.
export function collectArrowEndStartFacts(input){
  const doc=new DOMParser().parseFromString(input,'image/svg+xml'),svg=doc.documentElement;
  if(svg.localName!=='svg'||doc.querySelector('parsererror'))return {edges:[],unsupported:['invalid SVG']};
  const root=document.importNode(svg,true);document.body.append(root);
  const edges=[],unsupported=[],point=(m,p)=>{const q=new DOMPoint(p[0],p[1]).matrixTransform(m);return [q.x,q.y]};
  // Explicit commands and repeated straight coordinate tuples; curves are consumed but
  // cannot supply a checkable first shaft or terminal marker tangent.
  const parse=(d,closedOnly=false)=>{
    const token=/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/y,t=[];let cursor=0;while(cursor<d.length){if(/[\s,]/.test(d[cursor])){cursor++;continue}token.lastIndex=cursor;const hit=token.exec(d);if(!hit)return null;t.push(hit[0]);cursor=token.lastIndex}
    let i=0,c=null,p=[0,0],start=null,segments=[],vertices=[];
    const sizes={M:2,L:2,H:1,V:1,Q:4,C:6,S:4,T:2,A:7};
    while(i<t.length){
      if(/^[a-zA-Z]$/.test(t[i]))c=t[i++];
      if(!c)return null;const u=c.toUpperCase(),relative=c!==u;
      if(u==='Z'){if(!start)return null;segments.push({from:p,to:start,straight:true});p=start;c=null;continue}
      const n=sizes[u];if(!n||i+n>t.length)return null;
      const v=t.slice(i,i+n).map(Number);if(v.some(x=>!Number.isFinite(x)))return null;i+=n;
      let q=u==='H'?[relative?p[0]+v[0]:v[0],p[1]]:u==='V'?[p[0],relative?p[1]+v[0]:v[0]]:v.slice(-2);
      if(relative&&u!=='H'&&u!=='V')q=[q[0]+p[0],q[1]+p[1]];
      if(u==='M'){if(start)return null;start=q;vertices.push(q);c=relative?'l':'L'}
      else {const straight=['L','H','V'].includes(u);if(closedOnly&&!straight)return null;segments.push({from:p,to:q,straight});vertices.push(q)}p=q;
    }
    return {segments:segments.filter(s=>Math.hypot(s.to[0]-s.from[0],s.to[1]-s.from[1])>1e-9),vertices,closed:/[zZ]\s*$/.test(d)};
  };
  try {for(const [index,el] of [...root.querySelectorAll('path[data-source][data-target],polyline[data-source][data-target],line[data-source][data-target]')].entries()){
    const e={edge:el.getAttribute('data-edge')||el.id||`drawn-edge-${index}`,index,trunk:el.getAttribute('data-shared-trunk'),source:el.getAttribute('data-source'),target:el.getAttribute('data-target'),start:null,end:null,shaft:null,head:null,arrow:false,reasons:[]};edges.push(e);
    const m=root.getScreenCTM()?.inverse().multiply(el.getScreenCTM());
    if(!m||![m.a,m.b,m.c,m.d,m.e,m.f].every(Number.isFinite)||Math.abs(m.a*m.d-m.b*m.c)<1e-12){e.reasons.push('noninvertible connector transform');continue}
    let route;
    if(el.localName==='path')route=parse(el.getAttribute('d')||'');
    else {const pts=el.localName==='line'?[[el.x1.baseVal.value,el.y1.baseVal.value],[el.x2.baseVal.value,el.y2.baseVal.value]]:[...el.points].map(p=>[p.x,p.y]);route={segments:pts.slice(1).map((p,i)=>({from:pts[i],to:p,straight:true}))}}
    if(!route?.segments.length){e.reasons.push('unsupported connector grammar');continue}
    const first=route.segments[0],last=route.segments.at(-1);const length=el.getTotalLength(),actualStart=el.getPointAtLength(0),actualEnd=el.getPointAtLength(length);if(!(length>0)||[actualStart.x-first.from[0],actualStart.y-first.from[1]].some((v,i)=>Math.abs(v)>Math.max(1e-4,Math.abs(first.from[i])*2e-7))||[actualEnd.x-last.to[0],actualEnd.y-last.to[1]].some((v,i)=>Math.abs(v)>Math.max(1e-4,Math.abs(last.to[i])*2e-7))){e.reasons.push('connector parser disagrees with browser geometry');continue}e.start=point(m,first.from);e.end=point(m,last.to);
    const style=getComputedStyle(el),width=parseFloat(style.strokeWidth);
    if(first.straight&&width>0&&style.stroke!=='none'&&style.vectorEffect!=='non-scaling-stroke'){
      const [a,b]=[first.from,first.to],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),nx=-dy/len*width/2,ny=dx/len*width/2;
      e.shaft=[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]].map(p=>point(m,p));
      if(style.strokeLinecap!=='butt')e.reasons.push('unsupported first shaft cap');
    }else e.reasons.push('unsupported first shaft or stroke');
    const markerValue=style.markerEnd||el.getAttribute('marker-end')||'none';if(markerValue==='none')continue;e.arrow=true;
    const id=markerValue.match(/#([^"')]+)["']?\)$/)?.[1],marker=id?[...root.querySelectorAll('marker')].find(x=>x.id===id):null;
    if(!marker||!last.straight){e.reasons.push('missing marker or curved terminal tangent');continue}
    if(marker.hasAttribute('viewBox')||marker.hasAttribute('transform')||getComputedStyle(marker).transform!=='none'||marker.getAttribute('preserveAspectRatio')){e.reasons.push('unsupported marker viewBox/transform');continue}
    const children=[...marker.children];const shape=children[0];
    if(children.length!==1||!shape||shape.hasAttribute('transform')||getComputedStyle(shape).transform!=='none'||!['path','polygon'].includes(shape.localName)){e.reasons.push('unsupported marker children/transform');continue}
    const paint=getComputedStyle(shape);
    if(paint.fill==='none'||paint.stroke!=='none'||parseFloat(paint.opacity)!==1||parseFloat(paint.fillOpacity)!==1){e.reasons.push('unsupported marker paint');continue}
    let poly=shape.localName==='polygon'?[...shape.points].map(p=>[p.x,p.y]):(()=>{const p=parse(shape.getAttribute('d')||'',true);return p?.closed?p.vertices:null})();
    if(poly){poly=poly.filter((p,i)=>i===0||Math.hypot(p[0]-poly[i-1][0],p[1]-poly[i-1][1])>1e-9);if(poly.length>1&&Math.hypot(poly[0][0]-poly.at(-1)[0],poly[0][1]-poly.at(-1)[1])<=1e-9)poly.pop()}
    if(!poly||poly.length<3){e.reasons.push('unsupported marker silhouette');continue}
    let sign=0,convex=true;for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],c=poly[(j+2)%poly.length],z=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(z)>1e-9){if(sign&&Math.sign(z)!==sign)convex=false;sign=Math.sign(z)}}
    if(poly.some((a,j)=>{const b=poly[(j+1)%poly.length];return poly.some(c=>sign*((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])) < -1e-9)}))convex=false;
    if(!convex||!sign){e.reasons.push('nonconvex marker');continue}
    const orient=marker.getAttribute('orient')||'0';let angle;
    if(orient==='auto'||orient==='auto-start-reverse')angle=Math.atan2(last.to[1]-last.from[1],last.to[0]-last.from[0]);
    else if(/^[-+]?(?:\d+\.?\d*|\.\d+)(?:deg)?$/.test(orient))angle=parseFloat(orient)*Math.PI/180;
    else {e.reasons.push('unsupported marker orientation');continue}
    const scale=marker.getAttribute('markerUnits')==='userSpaceOnUse'?1:width,rx=marker.refX.baseVal.value,ry=marker.refY.baseVal.value;
    if(!(scale>0)||!(marker.markerWidth.baseVal.value>0&&marker.markerHeight.baseVal.value>0)){e.reasons.push('invalid marker size');continue}
    // Visible overflow avoids uncertain clipping; hidden markers are checkable only
    // when every silhouette vertex is within the actual marker viewport.
    if(getComputedStyle(marker).overflow!=='visible'&&poly.some(p=>p[0]<0||p[1]<0||p[0]>marker.markerWidth.baseVal.value||p[1]>marker.markerHeight.baseVal.value)){e.reasons.push('unsupported clipped marker');continue}
    e.head=poly.map(p=>{const x=(p[0]-rx)*scale,y=(p[1]-ry)*scale;return point(m,[last.to[0]+x*Math.cos(angle)-y*Math.sin(angle),last.to[1]+x*Math.sin(angle)+y*Math.cos(angle)])});
  }}finally{root.remove()}
  return {edges,unsupported};
}
const EPS=1e-6;
const overlap=(a,b)=>[a,b].every(poly=>poly.every((p,i)=>{const q=poly[(i+1)%poly.length],nx=p[1]-q[1],ny=q[0]-p[0],project=r=>r.map(v=>v[0]*nx+v[1]*ny),aa=project(a),bb=project(b);return Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))>EPS*Math.hypot(nx,ny)}));
// A start strictly inside the painted silhouette is a conflict independently of
// a shared incoming terminal trunk. Boundary-only contact is not area overlap.
const inside=(p,poly)=>{let sign=0;return poly.every((a,i)=>{const b=poly[(i+1)%poly.length],z=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);if(Math.abs(z)<=EPS*Math.hypot(b[0]-a[0],b[1]-a[1]))return false;const next=Math.sign(z);if(sign&&sign!==next)return false;sign=next;return true})};
export function checkArrowEndStartClearance(facts){
  const violations=[],unsupported=[...(facts?.unsupported||[])],edges=facts?.edges||[];
  for(const e of edges){if(e.reasons?.length)unsupported.push({edge:e.edge,reasons:e.reasons});if(!e.arrow)continue;
    for(const s of edges){if(e.index===s.index)continue;const pair={edgeA:e.edge,edgeB:s.edge,sourceA:e.source,targetA:e.target,sourceB:s.source,targetB:s.target,end:e.end,start:s.start};
      if(e.end&&s.start&&Math.hypot(e.end[0]-s.start[0],e.end[1]-s.start[1])<=EPS)violations.push({...pair,reason:'arrow end shares connector start port'});
      else if(e.head&&s.start&&inside(s.start,e.head))violations.push({...pair,reason:'connector start lies inside painted arrowhead',head:e.head});
      else if(!(e.trunk&&e.trunk===s.trunk&&e.target===s.target&&e.end&&s.end&&Math.hypot(e.end[0]-s.end[0],e.end[1]-s.end[1])<=EPS)&&e.head&&s.shaft&&overlap(e.head,s.shaft))violations.push({...pair,reason:'painted arrowhead overlaps connector first shaft',head:e.head,firstShaft:s.shaft});
    }
  }
  return {status:violations.length?'FAIL':unsupported.length?'NOT-CHECKABLE':'PASS',evidence:{method:'actual SVG root-coordinate endpoints and convex filled straight-sided marker silhouette against painted first straight shaft; positive-area overlap, no minimum gap; unsupported caps, marker viewBox, transforms on marker children, clipping and curved terminal tangents stay unresolved',violations,unsupported,checkedEdges:edges.length}};
}
