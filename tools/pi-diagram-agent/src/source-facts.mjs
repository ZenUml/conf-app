import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

const q=s=>JSON.stringify(String(s));
const num=v=>`${Math.round(v*10)/10}`;
const edgeStyle=e=>`${e.style}${e.thick?' thick':''}${e.arrow&&e.arrow!=='normal'?` arrow:${e.arrow}`:''}${e.bidirectional?' bidirectional':''}`;
const box=b=>b?[b.x,b.y,b.w,b.h].map(num).join(','):'-';

/** Compact, structured facts for the model: the parser's view of the source plus where the ORIGINAL Mermaid render put each element.
 *  `layout` = {canvas:{w,h}, nodes:{id:{x,y,w,h}}, groups:{id:{x,y,w,h}}, renderedGroups:{nodeId:[groupId,...]}} in original SVG user units. */
export function formatSourceFacts(model,layout){
  const L=[];
  L.push('<source-facts>');
  L.push(`Reference only — do not copy this layout. These are the parser's facts about the source, plus where the ORIGINAL Mermaid render put each element (canvas ${num(layout.canvas.w)}x${num(layout.canvas.h)}, original SVG units, origin top-left). They save you the census; you still decide every coordinate, port and route of your own diagram.`);
  L.push(`direction: ${model.direction}`);
  if(model.title)L.push(`title: ${q(model.title)}`);
  L.push(`groups: ${model.groups.length?model.groups.map(g=>`${g.id} ${q(g.label)}${g.parent?` in ${g.parent}`:''}${g.direction?` direction ${g.direction}`:''}`).join('; '):'none'}`);
  if(model.groups.length)L.push(`group boxes in the original: ${model.groups.map(g=>`${g.id} ${box(layout.groups?.[g.id])}`).join('; ')}`);
  L.push(`palette roles: ${Object.entries(model.palette).map(([k,p])=>`${k}: fill ${p.fill} stroke ${p.stroke} text ${p.text}`).join('; ')}`);
  L.push('nodes: id | text | shape | role | declared group (outer>inner) | rendered group | original x,y,w,h');
  const conflicts=[];
  for(const n of model.nodes){
    const rendered=layout.renderedGroups?.[n.id]??[];
    const renderedLabel=rendered.length?rendered.join('+'):'-';
    const path=n.groupPath??(n.group?[n.group]:[]);
    if(path.length!==rendered.length||path.some(g=>!rendered.includes(g)))conflicts.push(`${n.id}: declared ${path.join('>')||'none'}, rendered ${renderedLabel==='-'?'none':rendered.join('>')}`);
    L.push(`${n.id} | ${q(n.text)} | ${n.shape} | ${n.role} | ${path.join('>')||'-'} | ${renderedLabel} | ${box(layout.nodes?.[n.id])}${n.markup?.length?` | markup ${n.markup.join(',')}`:''}`);
  }
  if(model.conflicts?.length)L.push(`conflicting definitions (Mermaid draws the last one; the source is ambiguous and the audit FAILs it): ${model.conflicts.map(c=>`${c.nodeId}: ${c.texts.map((t,i)=>`${q(t)}${c.shapes[i]!==c.shapes[0]||c.kinds.includes('shape')?` ${c.shapes[i]}`:''} (line ${c.lines[i]})`).join(', ')}`).join('; ')}`);
  if(conflicts.length)L.push(`conflict (declared group differs from the original render; the original visible membership is the default): ${conflicts.join('; ')}`);
  L.push('edges: id | source -> target | label | style (thick edges and arrowheads other than a normal arrow are marked)');
  for(const e of model.edges)L.push(`${e.id} | ${e.source} -> ${e.target} | ${e.label?q(e.label):'-'} | ${edgeStyle(e)}`);
  if(model.groupEdges?.length){
    L.push('group edges: id | source -> target | label | style (an endpoint marked (group) is a subgraph, not a node)');
    for(const e of model.groupEdges)L.push(`${e.id} | ${e.source}${e.sourceIsGroup?' (group)':''} -> ${e.target}${e.targetIsGroup?' (group)':''} | ${e.label?q(e.label):'-'} | ${edgeStyle(e)}`);
  }
  if(model.layoutLinks?.length)L.push(`layout links (invisible, not relations): ${model.layoutLinks.map(l=>`${l.source} ~~~ ${l.target}`).join('; ')}`);
  if(model.ignored?.length)L.push(`ignored statements (styling, links and interaction are not drawn semantics here): ${model.ignored.map(x=>`${x.construct} (line ${x.line})`).join('; ')}`);
  if(model.notCheckable?.length)L.push(`not checkable by the auditor: ${model.notCheckable.map(c=>`${c.construct} (line ${c.line})`).join('; ')}`);
  L.push('</source-facts>');
  return L.join('\n');
}

/** Node and cluster boxes of an original Mermaid SVG, in the SVG's own user units with the viewBox origin at (0,0).
 *  Membership is decided as the auditor does: a node is in a cluster when its box lies inside the cluster box. */
export async function collectOriginalLayout(svgBytes,model,{playwrightModulePath=process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE,browserExecutablePath=process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}={}){
  let playwright;try{playwright=require(playwrightModulePath||'playwright')}catch{throw Error('PLAYWRIGHT_RUNTIME_UNAVAILABLE')}
  const browser=await playwright.chromium.launch({headless:true,...(browserExecutablePath?{executablePath:browserExecutablePath}:{})});
  try{
    const page=await browser.newPage({javaScriptEnabled:false});
    await page.route('**/*',route=>route.abort('blockedbyclient'));
    const raw=await page.evaluate(input=>{
      const doc=new DOMParser().parseFromString(input,'text/html'),svg=doc.querySelector('svg');
      if(!svg)return null;
      const root=document.importNode(svg,true);document.body.appendChild(root);
      const view=root.viewBox.baseVal,ox=view?.x??0,oy=view?.y??0,cw=view?.width||root.getBoundingClientRect().width,ch=view?.height||root.getBoundingClientRect().height;
      const inv=root.getScreenCTM().inverse();
      const boxOf=el=>{
        const shape=el.querySelector('rect,polygon,path,circle,ellipse')??el,m=inv.multiply(shape.getScreenCTM()),r=shape.getBBox();
        const pts=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
        const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
        return {x:Math.min(...xs)-ox,y:Math.min(...ys)-oy,w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
      };
      const nodes=[...root.querySelectorAll('g.node[id*="-flowchart-"]')].map(el=>({id:el.id,box:boxOf(el)}));
      const clusters=[...root.querySelectorAll('g.cluster')].map(el=>({id:el.id,box:boxOf(el)}));
      root.remove();
      return {canvas:{w:cw,h:ch},nodes,clusters};
    },Buffer.from(svgBytes).toString('utf8'));
    if(!raw)throw Error('ORIGINAL_SVG_UNPARSEABLE');
    const contains=(o,i)=>i.x>=o.x-1&&i.y>=o.y-1&&i.x+i.w<=o.x+o.w+1&&i.y+i.h<=o.y+o.h+1;
    const layout={canvas:raw.canvas,nodes:{},groups:{},renderedGroups:{}};
    for(const g of model.groups){const c=raw.clusters.find(x=>x.id.endsWith(`-${g.id}`)||x.id===g.id);if(c)layout.groups[g.id]=c.box}
    for(const n of model.nodes){
      const found=raw.nodes.filter(x=>/-flowchart-(.+)-\d+$/.exec(x.id)?.[1]===n.id);
      if(found.length!==1)continue;
      layout.nodes[n.id]=found[0].box;
      layout.renderedGroups[n.id]=model.groups.filter(g=>layout.groups[g.id]&&contains(layout.groups[g.id],found[0].box)).map(g=>g.id);
    }
    return layout;
  }finally{await browser.close()}
}
