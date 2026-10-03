// Layout and style checks of the canonical Diagram Rules that the independent auditor measures from the DRAWN SVG:
// connectorStrokeWidth (rule 8), filletUniformity (rule 3 + script-first), markerUniformity (rule 7), textContrast (colours),
// labelFontWeight (T4) and legendCompleteness (C1/C5). Facts come from the browser (computed styles and geometry, never the
// author's own metadata beyond neutral tags); every verdict is computed here. NOT-CHECKABLE never becomes PASS.

export const FILLET_RADIUS=5;
export const CONTRAST_MIN=4.5;
const eps=1e-6;

/** Runs inside Chromium (page.evaluate): self-contained, no outer references. Returns plain facts. */
export const collectLayoutFacts=([input,GROUP,PREFILTER=true])=>{
  const doc=new DOMParser().parseFromString(input,'image/svg+xml');
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')return {parseError:true};
  const root=document.importNode(doc.documentElement,true);
  document.body.appendChild(root);
  try{
    const NODE='g[data-node],g[data-node-id]';
    const nodeIdOf=el=>el.getAttribute('data-node')??el.getAttribute('data-node-id');
    const groupIdOf=el=>el.getAttribute('data-group')??el.getAttribute('data-container-id')??el.id?.slice(6);
    const hex2=n=>Math.round(n).toString(16).padStart(2,'0');
    const parseColor=value=>{const m=/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(value??'');if(!m)return null;const a=m[4]===undefined?1:m[4].endsWith('%')?Number.parseFloat(m[4])/100:Number(m[4]);return {hex:'#'+hex2(+m[1])+hex2(+m[2])+hex2(+m[3]),alpha:a}};
    const opacityChain=el=>{let a=1;for(let n=el;n&&n.nodeType===1;n=n.parentElement){const o=Number(getComputedStyle(n).opacity);if(Number.isFinite(o))a*=o}return a};
    const inDefs=el=>!!el.closest('defs,marker,clipPath,mask,pattern,symbol');
    const rootBox=el=>{
      const m=root.getScreenCTM().inverse().multiply(el.getScreenCTM()),r=el.getBBox();
      const pts=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
      const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
      return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
    };
    const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
    const ownerOf=el=>{
      const node=el.closest(NODE);if(node)return nodeIdOf(node);
      const label=el.closest('g[data-edge-label-source][data-edge-label-target]');if(label)return `label:${label.getAttribute('data-edge-label-source')}->${label.getAttribute('data-edge-label-target')}`;
      const group=el.closest(GROUP);if(group)return `group:${groupIdOf(group)}`;
      const legend=el.closest('[data-legend]');if(legend)return `legend:${legend.getAttribute('data-legend')}`;
      return 'canvas';
    };
    // ---- connectors and markers
    const edgeEls=[...root.querySelectorAll('[data-source][data-target]')];
    const edges=edgeEls.map(el=>{
      const st=getComputedStyle(el),dash=st.strokeDasharray;
      const markerRef=/^url\(#([^()]+)\)$/.exec(el.getAttribute('marker-end')??'')?.[1]??null;
      return {source:el.getAttribute('data-source'),target:el.getAttribute('data-target'),tag:el.localName,d:el.getAttribute('d'),points:el.getAttribute('points'),
        line:el.localName==='line'?['x1','y1','x2','y2'].map(k=>Number(el.getAttribute(k))):null,
        strokeWidth:Number.parseFloat(st.strokeWidth),emphasis:el.getAttribute('data-emphasis'),
        dashed:dash!=='none'&&(dash.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)??[]).some(v=>Number(v)>0),markerRef};
    });
    const markerIds=[...new Set(edges.map(e=>e.markerRef).filter(Boolean))];
    const contextPaint=el=>[...el.attributes].some(a=>/context-(?:stroke|fill)/.test(a.value));
    const markers=markerIds.map(id=>{
      const marker=root.querySelector(`marker#${CSS.escape(id)}`);
      if(!marker)return {id,found:false};
      const kids=[...marker.querySelectorAll('path,rect,ellipse,polygon,polyline,line,circle')].map(k=>{
        const st=getComputedStyle(k),box=k instanceof SVGGraphicsElement?k.getBBox():null;
        return {tag:k.localName,signature:norm(k.getAttribute('d')??k.getAttribute('points')??['x','y','width','height','cx','cy','r','rx','ry','x1','y1','x2','y2'].map(a=>k.getAttribute(a)).join(',')),
          fill:st.fill,context:contextPaint(k)||st.fill.includes('context-')||st.stroke.includes('context-'),transformed:k.hasAttribute('transform'),
          box:box?{x:box.x,y:box.y,w:box.width,h:box.height}:null};
      });
      return {id,found:true,units:marker.getAttribute('markerUnits'),width:marker.markerWidth.baseVal.value,height:marker.markerHeight.baseVal.value,
        refX:marker.refX.baseVal.value,refY:marker.refY.baseVal.value,orient:marker.getAttribute('orient'),viewBox:marker.getAttribute('viewBox'),markerContext:contextPaint(marker),kids};
    });
    // ---- text, backgrounds, weights
    const shapeSelector='rect,path,polygon,ellipse,circle';
    const painted=[...root.querySelectorAll(shapeSelector)].filter(s=>s instanceof SVGGeometryElement&&!inDefs(s)).map(shape=>{
      const st=getComputedStyle(shape);
      if(st.display==='none'||st.visibility!=='visible'||st.fill==='none')return null;
      const colour=parseColor(st.fill);
      const alpha=(colour?.alpha??1)*Number(st.fillOpacity)*opacityChain(shape);
      if(colour&&alpha===0)return null;
      return {shape,hex:colour?.hex??null,alpha,paint:st.fill};
    }).filter(Boolean);
    const sample=(pt,text)=>{
      let top=null;
      for(const p of painted){
        if(!(p.shape.compareDocumentPosition(text)&Node.DOCUMENT_POSITION_FOLLOWING))continue;
        // Prefilter: a point outside the shape's root-space bbox (the transformed local bbox) is outside its fill.
        if(PREFILTER){
          if(p.box===undefined){try{p.box=rootBox(p.shape)}catch{p.box=null}}
          const b=p.box;
          if(b&&[b.x,b.y,b.w,b.h].every(Number.isFinite)&&(pt.x<b.x-1e-3||pt.x>b.x+b.w+1e-3||pt.y<b.y-1e-3||pt.y>b.y+b.h+1e-3))continue;
        }
        const local=new DOMPoint(pt.x,pt.y).matrixTransform(root.getScreenCTM().inverse().multiply(p.shape.getScreenCTM()).inverse());
        if(p.shape.isPointInFill(local))top=p;
      }
      if(!top)return {none:true};
      if(!top.hex)return {unresolved:`background paint ${top.paint} is not a solid colour`};
      if(top.alpha<0.999)return {unresolved:'background shape is translucent'};
      return {hex:top.hex};
    };
    const texts=[...root.querySelectorAll('text')].filter(t=>!inDefs(t)&&norm(t.textContent)).map(t=>{
      const st=getComputedStyle(t),owner=ownerOf(t),content=norm(t.textContent).slice(0,60);
      const base={elementId:owner,text:content};
      if(st.display==='none'||st.visibility!=='visible'||st.fill==='none')return {...base,skip:true};
      const colour=parseColor(st.fill);
      if(!colour)return {...base,unresolved:`text paint ${st.fill} is not a solid colour`};
      const b=rootBox(t);
      if(!(b.w>0&&b.h>0))return {...base,skip:true};
      const cy=b.y+b.h/2,points=[{x:b.x+Math.min(1,b.w/4),y:cy},{x:b.x+b.w/2,y:cy},{x:b.x+b.w-Math.min(1,b.w/4),y:cy}];
      return {...base,foreground:colour.hex,alpha:colour.alpha*Number(st.fillOpacity)*opacityChain(t),backgrounds:points.map(p=>sample(p,t))};
    });
    const weightOf=el=>{const w=getComputedStyle(el).fontWeight;return w==='normal'?400:w==='bold'?700:Number(w)};
    const nodeTexts=[],headings=[];
    for(const t of root.querySelectorAll('text')){
      if(inDefs(t)||!norm(t.textContent))continue;
      const node=t.closest(NODE);
      if(node){nodeTexts.push({nodeId:nodeIdOf(node),text:norm(t.textContent).slice(0,60),fontWeight:weightOf(t),role:t.closest('[data-role]')?.getAttribute('data-role')??null});continue}
      const group=t.closest(GROUP);
      if(group)headings.push({groupId:groupIdOf(group),fontWeight:weightOf(t)});
    }
    // ---- node tagging and legend
    const nodes=[...root.querySelectorAll(NODE)].map(g=>{
      const fills=[...g.querySelectorAll(shapeSelector)].filter(s=>s instanceof SVGGeometryElement).map(s=>{const st=getComputedStyle(s),c=parseColor(st.fill),b=s.getBBox();return st.fill!=='none'&&c&&c.alpha>0?{hex:c.hex,area:b.width*b.height}:null}).filter(Boolean).sort((a,b)=>b.area-a.area);
      return {id:nodeIdOf(g),shape:g.getAttribute('data-shape')?.trim()||null,fill:fills[0]?.hex??null};
    });
    // ---- legend detection: (a) explicit tag, (b) a heading from the legend vocabulary, (c) structure (a cluster of >=2 swatch+caption pairs)
    const HEADING=/^(?:(?:(?:diagram|colou?r|shape|line|flow|connector|node|arrow|edge|symbol|notation)s?\s+)?(?:legend|key)|notation|symbols?|how to read(?:\s+(?:this|the)(?:\s+diagram)?)?|reading guide)\s*:?$/i;
    const ELSEWHERE=NODE+','+GROUP+',g[data-edge-label-source],[data-source][data-target]';
    const inEls=(el,list)=>list.some(s=>s.els.some(x=>x===el||x.contains(el)));
    const isGeom=el=>el instanceof SVGGeometryElement&&!inDefs(el);
    const isGeomLate=isGeom;
    const scopes=[];// {els:[container or element], via, authoritative}
    for(const el of root.querySelectorAll('[data-legend],[data-legend-item]'))scopes.push({els:[el],via:'tag',authoritative:true});
    // a legend drawn as a group (its entries are tagged nodes whose data-parent-group names it)
    for(const gr of root.querySelectorAll(GROUP)){
      const gid=groupIdOf(gr)??'';
      const head=[...gr.querySelectorAll(':scope > text')].some(t=>HEADING.test(norm(t.textContent)));
      if(!(/(?:^|[\s_-])(?:legend|key)(?:[\s_-]|$)/i.test(gid)||head))continue;
      const members=gid?[...root.querySelectorAll(NODE)].filter(n=>n.getAttribute('data-parent-group')===gid):[];
      if(members.length||[...gr.querySelectorAll('*')].some(isGeomLate))scopes.push({els:[gr,...members],via:'group',authoritative:true});
    }
    for(const el of root.querySelectorAll('g[id],g[aria-label],g[class]')){
      if(inDefs(el)||el.matches(ELSEWHERE)||el.closest(ELSEWHERE)||inEls(el,scopes))continue;
      if([el.getAttribute('id'),el.getAttribute('aria-label'),el.getAttribute('class')].some(v=>/(?:^|[\s_-])(?:legend|key)(?:[\s_-]|$)/i.test(v??'')))scopes.push({els:[el],via:'tag',authoritative:true});
    }
    const titled=[...root.querySelectorAll('text')].filter(t=>!inDefs(t)&&!t.closest(NODE)&&!t.closest('g[data-edge-label-source]')&&HEADING.test(norm(t.textContent)));
    const headingTexts=[];
    for(const t of titled){
      if(inEls(t,scopes)){headingTexts.push(norm(t.textContent));continue}
      const g=t.parentElement;
      if(g&&g.localName==='g'&&!g.matches(ELSEWHERE+',svg')&&!g.querySelector(ELSEWHERE)&&[...g.querySelectorAll('*')].some(isGeom)){scopes.push({els:[g],via:'heading',authoritative:true});headingTexts.push(norm(t.textContent))}
      else headingTexts.push(norm(t.textContent));
    }
    const headingUnscoped=titled.filter(t=>!inEls(t,scopes));
    // free marks and captions: everything outside nodes, groups, edges, edge labels, defs and the scopes above
    const free=el=>!inDefs(el)&&!el.closest(ELSEWHERE)&&!inEls(el,scopes);
    const boxOf=el=>{try{return rootBox(el)}catch{return null}};
    const freeGeom=[...root.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line')].filter(el=>isGeom(el)&&free(el)).map(el=>({el,b:boxOf(el)})).filter(m=>m.b);
    const freeText=[...root.querySelectorAll('text')].filter(t=>free(t)&&norm(t.textContent)&&norm(t.textContent).length<=48).map(el=>({el,b:boxOf(el)})).filter(m=>m.b);
    const contains=(o,i)=>o!==i&&i.b.x>=o.b.x-1&&i.b.y>=o.b.y-1&&i.b.x+i.b.w<=o.b.x+o.b.w+1&&i.b.y+i.b.h<=o.b.y+o.b.h+1&&(o.b.w*o.b.h>i.b.w*i.b.h||o.b.w>i.b.w||o.b.h>i.b.h);
    const sampleLine=m=>m.b.w>=12&&m.b.w<=140&&m.b.h<=2.5;
    const swatchOk=m=>m.b.w<=90&&m.b.h<=60&&(m.b.w>=4||sampleLine(m))&&(m.b.h>=4||sampleLine(m));
    const prim=freeGeom.filter(m=>swatchOk(m)&&!freeGeom.some(o=>o!==m&&swatchOk(o)&&contains(o,m)));
    const decorOf=m=>freeGeom.filter(d=>d!==m&&contains(m,d));
    const taken=new Set(),pairs=[];
    for(const sw of prim){
      const cy=sw.b.y+sw.b.h/2;
      const cands=freeText.filter(t=>!taken.has(t)&&t.b.x>=sw.b.x+sw.b.w-3&&t.b.x<=sw.b.x+sw.b.w+70&&Math.abs(t.b.y+t.b.h/2-cy)<=Math.max(12,sw.b.h*0.75)).sort((a,b)=>a.b.x-b.b.x);
      if(cands[0]){taken.add(cands[0]);pairs.push({sw,text:cands[0]})}
    }
    const gap=(a,b)=>({dx:Math.max(0,Math.max(a.x,b.x)-Math.min(a.x+a.w,b.x+b.w)),dy:Math.max(0,Math.max(a.y,b.y)-Math.min(a.y+a.h,b.y+b.h))});
    const pbox=p=>{const x=Math.min(p.sw.b.x,p.text.b.x),y=Math.min(p.sw.b.y,p.text.b.y);return {x,y,w:Math.max(p.sw.b.x+p.sw.b.w,p.text.b.x+p.text.b.w)-x,h:Math.max(p.sw.b.y+p.sw.b.h,p.text.b.y+p.text.b.h)-y}};
    const comp=pairs.map((_,i)=>i);const find=i=>comp[i]===i?i:(comp[i]=find(comp[i]));
    for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++){const g=gap(pbox(pairs[i]),pbox(pairs[j]));if(g.dx<=100&&g.dy<=60)comp[find(i)]=find(j)}
    const clusters=new Map();pairs.forEach((p,i)=>{const r=find(i);if(!clusters.has(r))clusters.set(r,[]);clusters.get(r).push(p)});
    const used=new Set();
    for(const group of clusters.values()){
      if(group.length<2)continue;
      const els=[];
      for(const p of group){els.push(p.sw.el,p.text.el,...decorOf(p.sw).map(d=>d.el));used.add(p)}
      // a vocabulary heading just above or beside the cluster belongs to it
      const cb=group.map(pbox).reduce((a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)}));
      let heading=false;
      for(const t of headingUnscoped){const tb=boxOf(t);if(tb){const g=gap(tb,cb);if(g.dx<=150&&g.dy<=60){els.push(t);heading=true}}}
      scopes.push({els,via:heading?'heading+structure':'structure',authoritative:heading});
    }
    // a loose pair beside a tagged/titled legend (same row or column, within reach) is one of its entries
    for(const p of pairs){
      if(used.has(p))continue;
      const pb=pbox(p);
      const host=scopes.find(sc=>sc.authoritative&&sc.els.some(e=>{const eb=boxOf(e);if(!eb)return false;const g=gap(pb,eb);return g.dx<=100&&g.dy<=40}));
      if(host){host.els.push(p.sw.el,p.text.el,...decorOf(p.sw).map(d=>d.el));used.add(p)}
    }
    const looseSwatches=prim.filter(m=>!pairs.some(p=>p.sw===m&&used.has(p))).length;
    // fills drawn outside every legend scope (nodes, containers, label pills, canvas): the only fills a legend swatch can honestly explain
    const usedFills=[...new Set([...root.querySelectorAll('path,rect,circle,ellipse,polygon,polyline')].filter(el=>el instanceof SVGGeometryElement&&!inDefs(el)&&!inEls(el,scopes)).map(el=>{const st=getComputedStyle(el),c=parseColor(st.fill);return st.fill!=='none'&&c&&c.alpha>0?c.hex:null}).filter(Boolean))];
    const legend={usedFills,present:scopes.length>0||titled.length>0,scoped:scopes.length>0,authoritative:scopes.some(s=>s.authoritative),via:[...new Set(scopes.map(s=>s.via))],headings:headingTexts.slice(0,4),ambiguousSwatches:looseSwatches,fills:[],dataShapes:[],captions:[],marks:[],dashed:false};
    let scopeIndex=-1;
    for(const scope of scopes){
      scopeIndex++;
      for(const top of scope.els)for(const el of [top,...top.querySelectorAll('*')]){
        if(el.hasAttribute('data-shape'))legend.dataShapes.push(el.getAttribute('data-shape'));
        if(el.hasAttribute('data-legend-item'))legend.captions.push(norm(el.getAttribute('data-legend-item')));
        if(el.localName==='text'){legend.captions.push(norm(el.textContent));continue}
        if(!(el instanceof SVGGeometryElement))continue;
        const st=getComputedStyle(el),c=parseColor(st.fill),dash=st.strokeDasharray;
        if(st.fill!=='none'&&c&&c.alpha>0)legend.fills.push(c.hex);
        const isDashed=dash!=='none'&&(dash.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)??[]).some(v=>Number(v)>0);
        if(isDashed)legend.dashed=true;
        const b=el.getBBox();
        legend.marks.push({tag:el.localName,d:el.getAttribute('d'),points:el.getAttribute('points'),x:b.x,y:b.y,w:b.width,h:b.height,rx:Number(el.getAttribute('rx')||0),ry:Number(el.getAttribute('ry')||0),painted:st.fill!=='none'&&!!c&&c.alpha>0,fill:st.fill!=='none'&&c&&c.alpha>0?c.hex:null,dashed:isDashed,scope:scopeIndex});
      }
    }
    legend.fills=[...new Set(legend.fills)];
    return {parseError:false,edges,markers,texts,nodeTexts,headings,nodes,legend};
  }finally{root.remove()}
};

// ---------------------------------------------------------------- path measurement (fillets)
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const axisOf=v=>Math.abs(v[1])<eps&&Math.abs(v[0])>eps?'h':Math.abs(v[0])<eps&&Math.abs(v[1])>eps?'v':null;
const near=(a,b,tol=1e-3)=>Math.abs(a-b)<=tol;

function tokenise(d){
  const out=[];let at=0;
  const token=/\s*,?\s*([MmLlHhVvQqCcAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;
  while(at<d.length){if(!d.slice(at).trim())break;token.lastIndex=at;const m=token.exec(d);if(!m)return null;out.push(m[1]);at=token.lastIndex}
  return out;
}
const ARITY={M:2,L:2,H:1,V:1,Q:4,C:6,A:7,Z:0};

/** Parse an SVG path into straight and curved segments in absolute coordinates; null on grammar it cannot read. */
export function parsePathSegments(d){
  const tokens=tokenise(d??'');
  if(!tokens?.length)return null;
  const segments=[];let point=null,start=null,i=0,command=null;
  while(i<tokens.length){
    if(/^[A-Za-z]$/.test(tokens[i])){command=tokens[i++];if(/[Zz]/.test(command)){if(point&&start&&dist(point,start)>eps){segments.push({type:'L',from:point,to:start});point=start}continue}}
    else if(command===null||/[Mm]/.test(command))return null;
    const abs=command.toUpperCase(),rel=command!==abs,arity=ARITY[abs];
    if(arity===undefined||i+arity>tokens.length)return null;
    const a=tokens.slice(i,i+arity).map(Number);i+=arity;
    if(!a.every(Number.isFinite))return null;
    const ox=rel&&point?point[0]:0,oy=rel&&point?point[1]:0;
    if(abs==='M'){point=[a[0]+ox,a[1]+oy];start=point;command=rel?'l':'L';continue}
    if(!point)return null;
    if(abs==='L'){const to=[a[0]+ox,a[1]+oy];if(dist(point,to)>eps)segments.push({type:'L',from:point,to});point=to}
    else if(abs==='H'){const to=[a[0]+ox,point[1]];if(dist(point,to)>eps)segments.push({type:'L',from:point,to});point=to}
    else if(abs==='V'){const to=[point[0],a[0]+oy];if(dist(point,to)>eps)segments.push({type:'L',from:point,to});point=to}
    else if(abs==='Q'){const to=[a[2]+ox,a[3]+oy];segments.push({type:'Q',from:point,ctrl:[a[0]+ox,a[1]+oy],to});point=to}
    else if(abs==='C'){const to=[a[4]+ox,a[5]+oy];segments.push({type:'C',from:point,ctrl:[a[0]+ox,a[1]+oy],ctrl2:[a[2]+ox,a[3]+oy],to});point=to}
    else if(abs==='A'){const to=[a[5]+ox,a[6]+oy];segments.push({type:'A',from:point,rx:a[0],ry:a[1],rotation:a[2],large:a[3],sweep:a[4],to});point=to}
  }
  return segments;
}

/** A 90-degree corner replaced by one curve: returns {radius,entry,exit} (axes) or {reason} when the curve is not an orthogonal fillet. */
function filletOf(seg){
  const v=(a,b)=>[b[0]-a[0],b[1]-a[1]];
  if(seg.type==='Q'){
    const a=v(seg.from,seg.ctrl),b=v(seg.ctrl,seg.to),ea=axisOf(a),eb=axisOf(b);
    if(!ea||!eb||ea===eb)return {reason:'quadratic curve is not an axis-aligned right-angle corner'};
    if(!near(Math.hypot(...a),Math.hypot(...b)))return {reason:'quadratic corner legs are unequal (not a circular-style fillet)'};
    return {radius:Math.hypot(...a),entry:ea,exit:eb};
  }
  if(seg.type==='C'){
    const a=v(seg.from,seg.ctrl),b=v(seg.ctrl2,seg.to),chord=v(seg.from,seg.to),ea=axisOf(a),eb=axisOf(b);
    if(!ea||!eb||ea===eb)return {reason:'cubic curve is not a right-angle corner with axis-aligned end tangents'};
    if(!near(Math.abs(chord[0]),Math.abs(chord[1])))return {reason:'cubic curve spans unequal horizontal and vertical distances (a spline, not a corner)'};
    return {radius:Math.abs(chord[0]),entry:ea,exit:eb};
  }
  if(seg.type==='A'){
    if(!near(seg.rx,seg.ry)||seg.rx<=0||seg.large!==0)return {reason:'arc is not a minor circular arc'};
    const chord=v(seg.from,seg.to);
    if(!near(Math.abs(chord[0]),seg.rx)||!near(Math.abs(chord[1]),seg.rx))return {reason:'arc is not a quarter circle between axis-aligned tangents'};
    // Two candidate centres; the sweep flag picks the one the arc turns about.
    const centres=[[seg.from[0],seg.to[1]],[seg.to[0],seg.from[1]]];
    const centre=centres.find(c=>{const p=v(c,seg.from),q=v(c,seg.to);return (p[0]*q[1]-p[1]*q[0]>0)===(seg.sweep===1)});
    if(!centre)return {reason:'arc direction cannot be established'};
    const entry=near(centre[0],seg.from[0])?'h':'v';
    return {radius:seg.rx,entry,exit:entry==='h'?'v':'h'};
  }
  return {reason:`unsupported curve ${seg.type}`};
}

/** Corner radii of one connector: [{radius}] or {notCheckable:reason}. A sharp 90-degree corner has radius 0. */
export function measureBends(edge){
  let segments;
  if(edge.tag==='polyline'||edge.tag==='polygon'){
    const n=(edge.points??'').match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)?.map(Number)??[];
    if(n.length<4||n.length%2)return {notCheckable:'polyline points unreadable'};
    segments=[];for(let i=2;i+1<n.length;i+=2)segments.push({type:'L',from:[n[i-2],n[i-1]],to:[n[i],n[i+1]]});
  }else if(edge.tag==='line')return {radii:[]};
  else{segments=parsePathSegments(edge.d);if(!segments)return {notCheckable:'path grammar unsupported or unreadable'}}
  const radii=[];let heading=null;
  for(const seg of segments){
    if(seg.type==='L'){
      const axis=axisOf([seg.to[0]-seg.from[0],seg.to[1]-seg.from[1]]);
      if(!axis)return {notCheckable:'non-orthogonal straight segment'};
      if(heading&&heading!==axis)radii.push(0);
      heading=axis;continue;
    }
    const f=filletOf(seg);
    if(f.reason)return {notCheckable:f.reason};
    if(heading&&heading!==f.entry)return {notCheckable:'curve tangent does not continue the preceding straight segment'};
    radii.push(f.radius);heading=f.exit;
  }
  return {radii};
}

// ---------------------------------------------------------------- checks
const edgeId=e=>`${e.source}->${e.target}`;
const round3=n=>Math.round(n*1000)/1000;
const unavailable=reason=>({status:'NOT-CHECKABLE',evidence:{reason}});

export function connectorStrokeWidth(facts,svgText){
  const method='computed stroke-width of every bound connector; != 1 only with a data-emphasis role named, with its meaning, in an SVG palette comment';
  if(!facts.edges.length)return unavailable('no bound connectors in the SVG');
  const comments=[...String(svgText).matchAll(/<!--([\s\S]*?)-->/g)].map(m=>m[1]);
  const documented=role=>{const re=new RegExp(`(^|[^A-Za-z0-9_-])${role.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^A-Za-z0-9_-])`,'i');return comments.some(c=>/emphasis/i.test(c)&&re.test(c))};
  const failures=[],emphasised=[];
  for(const e of facts.edges){
    if(!Number.isFinite(e.strokeWidth)){failures.push({edge:edgeId(e),strokeWidth:null,reason:'stroke-width is not a number'});continue}
    if(Math.abs(e.strokeWidth-1)<1e-6)continue;
    const role=e.emphasis?.trim();
    if(role&&documented(role)){emphasised.push({edge:edgeId(e),strokeWidth:e.strokeWidth,role});continue}
    failures.push({edge:edgeId(e),strokeWidth:e.strokeWidth,reason:role?`data-emphasis "${role}" has no meaning in a palette comment`:'no data-emphasis role'});
  }
  return {status:failures.length?'FAIL':'PASS',evidence:{method,failures,emphasised,checkedEdges:facts.edges.length}};
}

export function filletUniformity(facts){
  const method=`radius of every bend measured from the actual path: Q/A/C fillet geometry, sharp L-L corner = 0; all must equal r=${FILLET_RADIUS}; non-orthogonal curves are NOT-CHECKABLE for that edge`;
  if(!facts.edges.length)return unavailable('no bound connectors in the SVG');
  const failures=[],notCheckableEdges=[],all=[];
  for(const e of facts.edges){
    const m=measureBends(e);
    if(m.notCheckable){notCheckableEdges.push({edge:edgeId(e),reason:m.notCheckable});continue}
    for(const r of m.radii){all.push(round3(r));if(Math.abs(r-FILLET_RADIUS)>1e-3)failures.push({edge:edgeId(e),radius:round3(r)})}
  }
  const radii=[...new Set(all)].sort((a,b)=>a-b);
  return {status:failures.length?'FAIL':notCheckableEdges.length?'NOT-CHECKABLE':'PASS',evidence:{method,required:FILLET_RADIUS,radii,failures,notCheckableEdges,checkedBends:all.length,checkedEdges:facts.edges.length-notCheckableEdges.length}};
}

export function markerUniformity(facts){
  const method='marker elements referenced by connectors: markerUnits userSpaceOnUse, no context-stroke/context-fill paint, refX at the shape tip (max x), and identical markerWidth/markerHeight/refY/geometry across markers (fill colour may differ)';
  const refs=facts.edges.filter(e=>e.markerRef);
  if(!refs.length)return unavailable('no connector references a marker-end');
  const failures=[],unresolved=[],resolved=[];
  for(const m of facts.markers){
    if(!m.found){unresolved.push({markerId:m.id,reason:'referenced marker element does not exist'});continue}
    const problems=[];
    if(m.units!=='userSpaceOnUse')problems.push(`markerUnits is ${m.units===null?'absent (strokeWidth)':m.units}, not userSpaceOnUse`);
    if(m.markerContext||m.kids.some(k=>k.context))problems.push('paint uses context-stroke/context-fill (Safari renders it black)');
    if(m.kids.length!==1){unresolved.push({markerId:m.id,reason:`${m.kids.length} marker shapes; exactly one is required to measure`});if(problems.length)failures.push({markerId:m.id,problem:problems.join('; ')});continue}
    const kid=m.kids[0];
    if(kid.transformed||!kid.box)unresolved.push({markerId:m.id,reason:'marker shape is transformed; tip cannot be measured'});
    else{
      const tip=kid.box.x+kid.box.w;
      if(Math.abs(m.refX-tip)>0.01)problems.push(`refX ${round3(m.refX)} is not at the tip x ${round3(tip)}`);
      resolved.push({markerId:m.id,signature:JSON.stringify([m.width,m.height,m.refY,kid.tag,kid.signature,m.viewBox??null,m.orient??null]),width:m.width,height:m.height});
    }
    if(problems.length)failures.push({markerId:m.id,problem:problems.join('; ')});
  }
  const counts=new Map();for(const r of resolved)counts.set(r.signature,(counts.get(r.signature)??0)+1);
  if(counts.size>1){
    const reference=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
    for(const r of resolved)if(r.signature!==reference)failures.push({markerId:r.markerId,problem:`size/geometry differs from the majority marker (${r.width}x${r.height}); all arrowheads must be identical`});
  }
  return {status:failures.length?'FAIL':unresolved.length?'NOT-CHECKABLE':'PASS',evidence:{method,failures,unresolved,checkedMarkers:facts.markers.length}};
}

const toRgb=hex=>[1,3,5].map(i=>Number.parseInt(hex.slice(i,i+2),16));
const luminance=hex=>{const [r,g,b]=toRgb(hex).map(c=>{const s=c/255;return s<=0.03928?s/12.92:((s+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b};
export const contrastRatio=(fg,bg)=>{const a=luminance(fg),b=luminance(bg),hi=Math.max(a,b),lo=Math.min(a,b);return (hi+0.05)/(lo+0.05)};
const blend=(fg,bg,alpha)=>'#'+toRgb(fg).map((c,i)=>Math.round(c*alpha+toRgb(bg)[i]*(1-alpha)).toString(16).padStart(2,'0')).join('');

export function textContrast(facts){
  const method=`WCAG contrast of each text element's computed fill against the top-most solid painted shape under its left, centre and right mid-line (document order, canvas included), threshold ${CONTRAST_MIN}:1; gradients, translucent or absent backgrounds are NOT-CHECKABLE`;
  const failures=[],unresolved=[];let checked=0;
  for(const t of facts.texts){
    if(t.skip)continue;
    if(t.unresolved){unresolved.push({elementId:t.elementId,text:t.text,reason:t.unresolved});continue}
    const bad=t.backgrounds.find(b=>b.none||b.unresolved);
    if(bad){unresolved.push({elementId:t.elementId,text:t.text,reason:bad.none?'no painted shape or canvas rectangle under the text':bad.unresolved});continue}
    checked++;
    let worst=null;
    for(const bg of new Set(t.backgrounds.map(b=>b.hex))){
      const fg=t.alpha<0.999?blend(t.foreground,bg,t.alpha):t.foreground,ratio=contrastRatio(fg,bg);
      if(!worst||ratio<worst.ratio)worst={ratio,foreground:fg,background:bg};
    }
    if(worst.ratio<CONTRAST_MIN-1e-9)failures.push({elementId:t.elementId,text:t.text,foreground:worst.foreground,background:worst.background,ratio:Math.round(worst.ratio*100)/100});
  }
  if(!checked&&!unresolved.length&&!failures.length)return unavailable('no visible text');
  return {status:failures.length?'FAIL':unresolved.length?'NOT-CHECKABLE':'PASS',evidence:{method,threshold:CONTRAST_MIN,failures,unresolved,checkedTexts:checked}};
}

export function labelFontWeight(facts){
  const method='computed font-weight of every text bound to a node (labels and descriptions must be 400); texts that are direct group headings (container membership) or carry data-role="ordinal" may be heavier';
  if(!facts.nodeTexts.length)return unavailable('no text bound to a node');
  const failures=[],exempt=facts.nodeTexts.filter(t=>t.role==='ordinal').length;
  for(const t of facts.nodeTexts)if(t.role!=='ordinal'&&t.fontWeight!==400)failures.push({nodeId:t.nodeId,text:t.text,fontWeight:t.fontWeight});
  return {status:failures.length?'FAIL':'PASS',evidence:{method,failures,checkedTexts:facts.nodeTexts.length,headingsExempt:facts.headings.filter(h=>h.fontWeight!==400).length,ordinalsExempt:exempt}};
}

// ---- legend
const RECT_LIKE=/^(?:rect|rectangle|process|box|square|rounded|round-?rect|task|step)$/i;
/** Canonical shape class of a data-shape value; 'rect' needs no legend key. Diamond and the long-text hexagon are one 'decision' notation. */
export function shapeClass(name){
  const s=String(name??'').trim().toLowerCase();
  if(!s)return null;
  if(RECT_LIKE.test(s))return 'rect';
  if(/diamond|decision|gateway|hexagon/.test(s))return 'decision';
  if(/cylinder|^cyl$|store|database|^db$/.test(s))return 'cylinder';
  if(/parallelogram/.test(s))return 'parallelogram'; // both slants are one notation
  if(/trapezoid/.test(s))return 'trapezoid';
  if(/circle/.test(s))return 'circle'; // circle and doublecircle
  if(/queue|subroutine/.test(s))return 'subroutine'; // [[x]] is drawn as a rectangle with two bars; the diagrams call it queue or subroutine
  if(/capsule|stadium|pill|terminator|^(?:start|end)$/.test(s))return 'capsule';
  return s;
}
const CAPTION_SHAPES=[[/diamond|decision|gateway|hexagon/,'decision'],[/cylinder|database|data ?store|datastore|storage|\bstore\b/,'cylinder'],[/queue|subroutine/,'subroutine'],[/capsule|stadium|terminator/,'capsule'],[/parallelogram/,'parallelogram'],[/trapezoid/,'trapezoid']];
/** A path made only of M/L vertical lines (one or more bars of a subroutine glyph). */
function isVerticalBars(m){
  if(m.tag==='line')return m.w<1&&m.h>0.5; // a bar drawn as its own <line>
  if(m.tag==='rect')return m.w<=3&&m.h>5;  // or as a thin rectangle
  if(m.tag!=='path'||!m.d||/[^MLHVZmlhvz\d\s.,+-]/.test(m.d))return false;
  const segs=parsePath(m.d);
  return !!segs&&segs.length>=1&&segs.every(g=>g.k==='L'&&!g.z&&Math.abs(g.to[0]-g.from[0])<1e-6&&Math.abs(g.to[1]-g.from[1])>0.5);
}
const nums=str=>(String(str??'').match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)??[]).map(Number);
/** Absolute-coordinate path parser (M L H V Q C A Z). Returns null for anything else so the caller reports "cannot classify". */
function parsePath(d){
  if(!d||/[^MLHVQCAZmlhvqcaz\d\s.,+-eE]/.test(d)||/[a-z]/.test(d.replace(/[eE]/g,'')))return null;
  const segs=[];let cur=null,start=null;
  for(const m of d.matchAll(/([MLHVQCAZ])([^MLHVQCAZ]*)/g)){
    const c=m[1],n=nums(m[2]);
    if(c==='Z'){if(cur&&start&&Math.hypot(cur[0]-start[0],cur[1]-start[1])>1e-6)segs.push({k:'L',from:cur,to:start,z:true});cur=start;continue}
    let pts;
    if(c==='M'){cur=start=[n[0],n[1]];continue}
    if(c==='H')pts={k:'L',to:[n[0],cur[1]]};
    else if(c==='V')pts={k:'L',to:[cur[0],n[0]]};
    else if(c==='L')pts={k:'L',to:[n[0],n[1]]};
    else if(c==='Q')pts={k:'Q',ctrl:[n[0],n[1]],to:[n[2],n[3]]};
    else if(c==='C')pts={k:'C',to:[n[4],n[5]]};
    else pts={k:'A',to:[n[5],n[6]]};
    if(!cur||pts.to.some(v=>!Number.isFinite(v)))return null;
    segs.push({...pts,from:cur});cur=pts.to;
  }
  return segs.length?segs:null;
}
/** Corner vertices of an all-straight/filleted path: line ends followed by a fillet are dropped, a fillet contributes its control point. */
function cornersOf(segs){
  const pts=[];
  segs.forEach((g,i)=>{
    if(g.k==='Q'){pts.push(g.ctrl);return}
    if(g.k==='L'){if(g.z)return;const next=segs[i+1];if(next?.k!=='Q')pts.push(g.to);return}
  });
  const first=segs[0]?.from;
  if(first&&segs[0].k!=='Q'&&!(segs.at(-1).k==='Q'&&Math.hypot(segs.at(-1).to[0]-first[0],segs.at(-1).to[1]-first[1])<1e-6))pts.unshift(first);
  return pts.filter((p,i)=>i===0||Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1])>1e-6).filter((p,i,a)=>!(i===a.length-1&&i>0&&Math.hypot(p[0]-a[0][0],p[1]-a[0][1])<1e-6));
}
/** The drawn shape class of one legend swatch (same classes shapeClass() gives data-shape values), from its geometry only. Returns null when it cannot be classified. */
export function swatchGeometryClass(m){
  if(m.tag==='circle')return 'circle';
  if(m.tag==='ellipse')return Math.abs(m.w-m.h)<1?'circle':'ellipse';
  if(m.tag==='rect')return m.rx>0&&m.rx>=m.h/2-0.5?'capsule':'rect';
  if(m.tag==='polygon'||m.tag==='polyline'){
    const n=nums(m.points);const pts=[];for(let i=0;i+1<n.length;i+=2)pts.push([n[i],n[i+1]]);
    return polygonClass(pts);
  }
  if(m.tag!=='path')return null;
  const segs=parsePath(m.d);
  if(!segs)return null;
  const curved=segs.filter(g=>g.k==='C'||g.k==='A');
  if(!curved.length)return polygonClass(cornersOf(segs));
  const straight=segs.filter(g=>g.k==='L'&&Math.hypot(g.to[0]-g.from[0],g.to[1]-g.from[1])>0.5);
  const vertical=straight.filter(g=>Math.abs(g.to[0]-g.from[0])<0.5),horizontal=straight.filter(g=>Math.abs(g.to[1]-g.from[1])<0.5);
  const wide=curved.some(g=>Math.abs(g.to[0]-g.from[0])>=0.7*m.w),tall=curved.some(g=>Math.abs(g.to[1]-g.from[1])>=0.7*m.h);
  if(curved.length>=2&&vertical.length>=2&&wide&&!tall)return 'cylinder';
  if(curved.length>=2&&horizontal.length>=2&&tall&&!wide)return 'capsule';
  if(curved.length>=4&&!wide&&!tall&&vertical.length>=2&&horizontal.length>=2)return 'rect'; // arc-cornered rectangle
  return null;
}
function polygonClass(pts){
  if(pts.length===4){
    if(pts.every((p,i)=>{const q=pts[(i+1)%4];return Math.abs(p[0]-q[0])<0.5||Math.abs(p[1]-q[1])<0.5}))return 'rect';
    // two horizontal edges and two slanted ones: equal lengths = parallelogram, unequal = trapezoid (a diamond has no horizontal edge)
    const horizontal=pts.map((p,i)=>({p,q:pts[(i+1)%4]})).filter(({p,q})=>Math.abs(p[1]-q[1])<0.5);
    if(horizontal.length===2)return Math.abs(Math.abs(horizontal[0].p[0]-horizontal[0].q[0])-Math.abs(horizontal[1].p[0]-horizontal[1].q[0]))<0.5?'parallelogram':'trapezoid';
    return 'decision';
  }
  if(pts.length===5){ // the flag: a rectangle with a notch in one side, i.e. a concave pentagon (a convex pentagon, such as an arrow, stays unclassified)
    const turn=pts.map((p,i)=>{const a=pts[(i+4)%5],b=pts[(i+1)%5];return Math.sign((p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]))});
    return Math.min(turn.filter(t=>t>0).length,turn.filter(t=>t<0).length)===1?'asymmetric':null;
  }
  if(pts.length===6)return 'decision';
  return null;
}
/** An unpainted path made of two vertical sides and a curved base: the body of a cylinder whose lid is drawn as a separate ellipse. */
function swatchBodyIsCylinder(m){
  const segs=parsePath(m.d);if(!segs)return false;
  return segs.filter(g=>g.k==='L'&&Math.abs(g.to[0]-g.from[0])<0.5&&Math.abs(g.to[1]-g.from[1])>0.5).length>=2&&segs.some(g=>g.k==='C'||g.k==='A'||g.k==='Q');
}
/** An open path of straight segments only (a bar or a line sample): its default black fill paints no area. */
function openStraightPath(m){return m.tag==='path'&&!/z\s*$/i.test(m.d??'')&&!/[CcQqAaSsTt]/.test(m.d??'')}
/** Classify every painted swatch in the legend; a rectangle swatch with vertical bars inside it is one subroutine glyph, not two things. */
function classifySwatches(marks){
  const bars=marks.filter(isVerticalBars);
  const inside=(a,b)=>a!==b&&a.scope===b.scope&&a.x>=b.x-1&&a.y>=b.y-1&&a.x+a.w<=b.x+b.w+1&&a.y+a.h<=b.y+b.h+1;
  // an ellipse inside another swatch of the same entry is that swatch's own decoration (the lid of a cylinder), not a second key
  const swatches=marks.filter(m=>!isVerticalBars(m)&&!(m.tag==='ellipse'&&marks.some(o=>o.tag==='path'&&inside(m,o)))&&(m.painted||m.tag==='polygon'||m.tag==='circle'||m.tag==='ellipse'||(m.tag==='path'&&/z\s*$/i.test(m.d??''))));
  return swatches.map(m=>{
    let cls=swatchGeometryClass(m);
    if(cls==='ellipse'&&marks.some(p=>p!==m&&p.scope===m.scope&&p.tag==='path'&&!p.painted&&Math.abs(p.x-m.x)<1.5&&Math.abs(p.w-m.w)<1.5&&swatchBodyIsCylinder(p)))cls='cylinder'; // lid ellipse + open body path
    if(cls==='rect'&&marks.some(o=>o!==m&&o.scope===m.scope&&o.tag==='rect'&&o.x>m.x+1&&o.y>m.y+1&&o.x+o.w<m.x+m.w-1&&o.y+o.h<m.y+m.h-1&&o.x-m.x<=8&&o.y-m.y<=8&&m.x+m.w-o.x-o.w<=8&&m.y+m.h-o.y-o.h<=8))cls='subroutine'; // double-border rectangle
    if(cls==='rect'&&bars.some(b=>b.scope===m.scope&&b.x>=m.x-1&&b.x+b.w<=m.x+m.w+1&&b.y>=m.y-1&&b.y+b.h<=m.y+m.h+1))cls='subroutine';
    return {cls,mark:m};
  });
}

/** Shape classes shapeClass() and swatchGeometryClass() both know; a node outside this set (e.g. a parallelogram) makes a drawn swatch class unreliable. */
const KNOWN_CLASSES=new Set(['rect','decision','cylinder','subroutine','capsule','circle','ellipse','parallelogram','trapezoid','asymmetric']);
const roundish=c=>c==='circle'||c==='ellipse';
/** A legend is optional (rules C1/C5 only ask that a drawn legend stays aligned with actual use).
 *  - no legend drawn: PASS, basis "no legend; legend is optional".
 *  - legend drawn, an entry contradicts actual use and the drawn geometry shows it (dashed key with no dashed connector, fill swatch no drawn node/container uses, shape swatch no node is drawn as): FAIL, wrongEntries.
 *  - legend drawn, some fill role / shape / line style in use has no key: PASS with evidence.minorFindings (never blocking).
 *  Contradictions the geometry cannot show are left to the reviewer. */
export function legendCompleteness(facts){
  const method='node fill roles (computed fill of the largest painted node shape), node shape classes (data-shape) and dashed connectors (computed stroke-dasharray) versus the entries of a drawn legend (an explicit g[data-legend] tag, a heading such as Legend/Key/Notation/Colour key/Diagram key, or a structural cluster of two or more swatch+caption pairs); a legend shape key is recognised only by the drawn geometry of one swatch (one shape class per swatch; captions and data-shape claims do not count), a fill key by swatch fill, a dashed key by a dashed sample or a dash/dotted caption. A legend is optional: only an entry that contradicts the drawn diagram fails; missing keys are minor findings';
  const nodes=facts.nodes;
  if(!nodes.length)return unavailable('no node tagging (g[data-node]) to derive fill roles or shapes');
  const fillNodes=new Map();
  for(const n of nodes)if(n.fill){if(!fillNodes.has(n.fill))fillNodes.set(n.fill,[]);fillNodes.get(n.fill).push(n.id)}
  const shapeNodes=new Map();
  for(const n of nodes){const c=shapeClass(n.shape);if(c&&c!=='rect'){if(!shapeNodes.has(c))shapeNodes.set(c,[]);shapeNodes.get(c).push(n.id)}}
  const dashedEdges=facts.edges.filter(e=>e.dashed).map(edgeId);
  const untagged=nodes.filter(n=>!n.shape).map(n=>n.id);
  const multiRole=fillNodes.size>1;
  const base={method,fillRoles:[...fillNodes.keys()],specialShapes:[...shapeNodes.keys()],dashedEdges};
  const L=facts.legend;
  const ambiguous=!!L.ambiguousSwatches&&!L.authoritative;
  if(!L.present||!L.scoped){
    if(!L.present||ambiguous)return {status:'PASS',evidence:{...base,basis:'no legend; legend is optional',...(ambiguous?{looseSwatches:L.ambiguousSwatches}:{})}};
    return {status:'PASS',evidence:{...base,basis:'a legend heading exists but its swatch+caption entries cannot be delimited; a legend is optional and entries the code cannot read are left to the reviewer'}};
  }
  const swatches=classifySwatches(L.marks);
  const declared=new Set(swatches.map(x=>x.cls).filter(Boolean));
  const dashedKey=!!(L.dashed||L.captions.some(c=>/dash|dotted/i.test(c)));
  // ---- entries that contradict actual use (blocking). Only what the drawn legend geometry shows; skipped when legend detection is ambiguous.
  const wrongEntries=[];
  if(!ambiguous){
    const lineSample=m=>m.dashed&&!m.painted&&(m.tag==='line'||(m.tag==='path'&&!/z\s*$/i.test(m.d??'')));
    if(facts.edges.length&&!dashedEdges.length&&L.marks.some(lineSample))wrongEntries.push({kind:'dashed',value:'dashed',reason:'the legend has a dashed line key but no connector is drawn dashed'});
    if(Array.isArray(L.usedFills)){
      const used=new Set([...L.usedFills,'#ffffff']),seen=new Set();
      const decor=m=>L.marks.some(o=>o!==m&&o.scope===m.scope&&o.tag==='path'&&m.tag==='ellipse'&&m.x>=o.x-1&&m.y>=o.y-1&&m.x+m.w<=o.x+o.w+1&&m.y+m.h<=o.y+o.h+1);
      const nested=m=>L.marks.some(o=>o!==m&&o.scope===m.scope&&o.painted&&o.fill&&o.fill!==m.fill&&o.x>=m.x-1&&o.y>=m.y-1&&o.x+o.w<=m.x+m.w+1&&o.y+o.h<=m.y+m.h+1);
      for(const m of L.marks){
        if(!m.painted||!m.fill||m.w<3||m.h<3||m.w>90||m.h>60||m.tag==='line'||isVerticalBars(m)||openStraightPath(m)||decor(m)||nested(m)||used.has(m.fill)||seen.has(m.fill))continue;
        seen.add(m.fill);
        wrongEntries.push({kind:'fill',value:m.fill,reason:`a legend swatch is filled ${m.fill} but no node, container or label in the diagram uses that fill`});
      }
    }
    const classes=new Set(nodes.map(n=>shapeClass(n.shape)));
    if(!untagged.length&&[...classes].every(c=>KNOWN_CLASSES.has(c))){
      const seenCls=new Set();
      // a mark whose centre lies inside another swatch of the same entry is that swatch's decoration (a cylinder lid drawn as its own ellipse), not a key of its own
      const inside=(m,o)=>o!==m&&o.scope===m.scope&&m.x+m.w/2>=o.x-2&&m.x+m.w/2<=o.x+o.w+2&&m.y+m.h/2>=o.y-2&&m.y+m.h/2<=o.y+o.h+2;
      for(const {cls,mark} of swatches){
        if(!cls||cls==='rect'||seenCls.has(cls)||swatches.some(o=>inside(mark,o.mark)))continue;
        if(classes.has(cls)||(roundish(cls)&&[...classes].some(roundish)))continue;
        seenCls.add(cls);
        wrongEntries.push({kind:'shape',value:cls,reason:`a legend swatch is drawn as a ${cls} but no node is that shape`});
      }
    }
  }
  if(wrongEntries.length)return {status:'FAIL',evidence:{...base,detection:L.via,wrongEntries,reason:`legend entry contradicts actual use: ${wrongEntries.map(w=>w.reason).join('; ')}`,legendFills:L.fills}};
  // ---- keys missing from a drawn legend: minor, never blocking
  const unclassified=swatches.filter(x=>!x.cls);
  const claimed=new Set([...L.dataShapes.map(shapeClass),...L.captions.flatMap(c=>CAPTION_SHAPES.filter(([re])=>re.test(c.toLowerCase())).map(([,cls])=>cls))].filter(Boolean));
  const minorFindings=[];
  if(!ambiguous){
    if(multiRole)for(const [fill,ids] of fillNodes)if(!L.fills.includes(fill))minorFindings.push({kind:'fill',value:fill,nodeIds:ids});
    for(const [cls,ids] of shapeNodes)if(!declared.has(cls)&&!(unclassified.length&&claimed.has(cls)))minorFindings.push({kind:'shape',value:cls,nodeIds:ids});
    if(dashedEdges.length&&!dashedKey)minorFindings.push({kind:'dashed',value:'dashed',edge:dashedEdges});
  }
  const evidence={...base,detection:L.via,legendFills:L.fills,legendShapes:[...declared].filter(c=>c!=='rect'),legendDashed:dashedKey,nodeShapes:Object.fromEntries(nodes.filter(n=>n.shape).map(n=>[n.id,shapeClass(n.shape)])),nodeFills:Object.fromEntries(nodes.filter(n=>n.fill).map(n=>[n.id,n.fill]))};
  if(minorFindings.length)return {status:'PASS',evidence:{...evidence,basis:`legend drawn; no entry contradicts the diagram; keys missing for ${minorFindings.map(k=>k.kind+':'+k.value).join(', ')} (minor: a legend is optional)`,minorFindings}};
  return {status:'PASS',evidence:{...evidence,basis:'legend drawn; no entry contradicts the diagram and every fill role, shape and line style in use has a key'}};
}

/** All six checks from one browser fact collection. */
export function layoutChecks(facts,svgText){
  return {
    connectorStrokeWidth:connectorStrokeWidth(facts,svgText),
    filletUniformity:filletUniformity(facts),
    markerUniformity:markerUniformity(facts),
    textContrast:textContrast(facts),
    labelFontWeight:labelFontWeight(facts),
    legendCompleteness:legendCompleteness(facts),
  };
}
export const LAYOUT_CHECK_NAMES=['connectorStrokeWidth','filletUniformity','markerUniformity','textContrast','labelFontWeight','legendCompleteness'];
export const layoutChecksUnavailable=reason=>Object.fromEntries(LAYOUT_CHECK_NAMES.map(n=>[n,unavailable(reason)]));
