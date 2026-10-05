import {createHash} from 'node:crypto';
// Deterministic standalone interaction over static semantic SVG. No model or IO.
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decodeAttribute=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(parseInt(v.slice(v[1].toLowerCase()==='x'?2:1),v[1].toLowerCase()==='x'?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v.toLowerCase()]));
function validateSvg(bytes){
  const buffer=typeof bytes==='string'?Buffer.from(bytes,'utf8'):Buffer.from(bytes);
  if(!buffer.length||buffer.length>2_000_000)throw Error('SVG_SIZE_LIMIT');
  const svg=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  // Match the audit's static-content restriction, and close stylesheet/animation
  // escape routes. SVG is carried as escaped script data, never raw HTML markup.
  if(/<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|image|animate\w*|set|a|use)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=|@import|expression\s*\(/i.test(svg))throw Error('SVG_ACTIVE_CONTENT_UNSUPPORTED');
  const clean=svg.replace(/<!--[\s\S]*?-->/g,'').replace(/^\s*<\?xml[^?]*\?>/,'');
  if(!/^\s*<svg\b/i.test(clean)||!/<\/svg>\s*$/i.test(clean))throw Error('SVG_ROOT_REQUIRED');
  const allowed=new Set(['svg','g','path','rect','ellipse','circle','polygon','polyline','line','text','tspan','defs','marker','style','title','desc','clipPath','mask','linearGradient','radialGradient','stop','pattern']);
  for(const m of clean.matchAll(/<\/?\s*([\w:-]+)/g))if(!allowed.has(m[1]))throw Error('SVG_ELEMENT_UNSUPPORTED');
  for(const m of clean.matchAll(/url\s*\(([^)]*)\)/gi))if(!/^\s*['"]?#[\w.:-]+['"]?\s*$/.test(m[1]))throw Error('SVG_EXTERNAL_REFERENCE_UNSUPPORTED');
  if(/<style\b[^>]*>[\s\S]*?\\[\s\S]*?<\/style>|\bstyle\s*=\s*(["'])[^"']*\\/i.test(clean))throw Error('SVG_CSS_ESCAPE_UNSUPPORTED');
  const rootTag=clean.match(/^\s*<svg\b(?:[^"'>]|"[^"]*"|'[^']*')*>/i)?.[0];if(!rootTag||!/\bxmlns\s*=\s*(["'])http:\/\/www\.w3\.org\/2000\/svg\1/.test(rootTag))throw Error('SVG_NAMESPACE_INVALID');
  const stack=[];let roots=0;const xml=clean.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,'');
  for(const tag of xml.matchAll(/<(\/?)([\w:-]+)\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g)){if(tag[1]){if(!new RegExp('^</'+tag[2]+'\\s*>$').test(tag[0])||stack.pop()!==tag[2])throw Error('SVG_XML_INVALID')}else{const tail=tag[0].slice(tag[0].indexOf(tag[2])+tag[2].length).replace(/\/?>$/,'');const attr=/\s+([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/y,names=new Set();let at=0;while(tail.slice(at).trim()){attr.lastIndex=at;const hit=attr.exec(tail);if(!hit||names.has(hit[1])||hit[2].includes('<')||/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(hit[2]))throw Error('SVG_XML_ATTRIBUTE_INVALID');names.add(hit[1]);at=attr.lastIndex}if(!stack.length){roots++;if(tag[2]!=='svg')throw Error('SVG_ROOT_REQUIRED')}if(!/\/\s*>$/.test(tag[0]))stack.push(tag[2])}}
  if(stack.length||roots!==1)throw Error('SVG_XML_INVALID');
  const edges=new Set(),reserved=new Set(),bound=[];
  for(const tag of clean.match(/<path\b[^>]*>/g)||[]){const attrs=new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m=>[m[1],decodeAttribute(m[3])]));if(attrs.has('data-edge')){const id=attrs.get('data-edge');if(!id||reserved.has(id))throw Error('SVG_EDGE_BINDING_INVALID');reserved.add(id)}if(attrs.has('data-source')&&attrs.has('data-target')){if(!attrs.get('data-source')||!attrs.get('data-target'))throw Error('SVG_EDGE_BINDING_INVALID');bound.push(attrs);if(attrs.has('data-edge'))edges.add(attrs.get('data-edge'))}}
  for(const [i,attrs] of bound.entries())if(!attrs.has('data-edge')){let id='__interaction-edge-'+i;while(reserved.has(id))id+='_';reserved.add(id);edges.add(id)}
  return {svg,edges};
}
function validateSections(sections,edges){
  if(!Array.isArray(sections)||sections.length>10000)throw Error('SHARED_SECTIONS_INVALID');
  const ids=new Set();
  return sections.map(s=>{
    if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||typeof s.family!=='string'||!s.family||!Array.isArray(s.members)||s.members.length<2||new Set(s.members).size!==s.members.length||s.members.some(id=>typeof id!=='string'||!edges.has(id))||!Array.isArray(s.points)||s.points.length!==2||s.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v))))throw Error('SHARED_SECTION_INVALID');
    const [a,b]=s.points;if(a[0]===b[0]&&a[1]===b[1]||a[0]!==b[0]&&a[1]!==b[1])throw Error('SHARED_SECTION_GEOMETRY_INVALID');
    ids.add(s.id);return {id:s.id,family:s.family,members:[...s.members],points:s.points.map(p=>[...p])};
  });
}
export function installInteractiveSvg(svg,sharedSections=[],status=null){
  const ns='http://www.w3.org/2000/svg',nodes=new Map(),edges=new Map(),sections=new Map(sharedSections.map(s=>[s.id,s]));
  for(const n of svg.querySelectorAll('g[data-node]')){if(nodes.has(n.dataset.node))throw Error('Duplicate node binding');nodes.set(n.dataset.node,n)}
  const boundPaths=[...svg.querySelectorAll('path[data-source][data-target]')],reserved=new Set([...svg.querySelectorAll('path[data-edge]')].map(e=>e.dataset.edge));
  for(const [i,e] of boundPaths.entries())if(!e.hasAttribute('data-edge')){let id='__interaction-edge-'+i;while(reserved.has(id))id+='_';reserved.add(id);e.dataset.edge=id}
  for(const e of boundPaths){if(edges.has(e.dataset.edge))throw Error('Duplicate edge binding');edges.set(e.dataset.edge,{element:e,source:e.dataset.source,target:e.dataset.target})}
  for(const s of sections.values())if(s.members.some(id=>!edges.has(id)))throw Error('Unknown shared section member');
  const label=id=>nodes.get(id)?.querySelector('[data-role="label"]')?.textContent.trim()||nodes.get(id)?.textContent.trim().replace(/\s+/g,' ')||id;
  const element=name=>document.createElementNS(ns,name),hits=element('g'),overlays=element('g');hits.classList.add('interaction-hit-layer');overlays.classList.add('interaction-overlay-layer');overlays.setAttribute('pointer-events','none');
  // Root layers sit above nested container fills and coincident inactive paths.
  // A final node hit/paint layer restores endpoint priority without moving the
  // semantic SVG elements out of their original groups.
  const nodePaint=element('g'),nodeHits=element('g');nodePaint.classList.add('interaction-node-overlay-layer');nodePaint.setAttribute('pointer-events','none');nodeHits.classList.add('interaction-node-hit-layer');svg.append(hits,overlays,nodePaint,nodeHits);
  let hover=null,focus=null,selection=null;
  const same=(a,b)=>a&&b&&a.kind===b.kind&&a.id===b.id;
  const rootTransform=(source,clone)=>{const root=svg.getScreenCTM(),matrix=source.getScreenCTM();if(!root||!matrix)throw Error('SVG transform unavailable');const m=root.inverse().multiply(matrix);clone.setAttribute('transform',`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`)};
  const all=[...nodes.values(),...[...edges.values()].map(e=>e.element)];
  function paint(){
    const current=selection||hover||focus;svg.classList.toggle('focus-on',!!current);svg.dataset.focusKind=current?.kind||'none';svg.dataset.focusId=current?.id||'';svg.dataset.selectionKind=selection?.kind||'none';svg.dataset.selectionId=selection?.id||'';
    for(const el of all)el.classList.remove('is-active','interaction-inactive');for(const el of svg.querySelectorAll('.has-active-descendant'))el.classList.remove('has-active-descendant');overlays.replaceChildren();nodePaint.replaceChildren();
    if(!current){if(status)status.textContent='Hover or focus an item to trace connections. Click, Enter or Space locks selection; Escape clears it.';return}
    const activeEdges=new Set(),activeNodes=new Set();
    if(current.kind==='node'){activeNodes.add(current.id);for(const [id,e] of edges)if(e.source===current.id||e.target===current.id)activeEdges.add(id)}
    else if(current.kind==='edge')activeEdges.add(current.id);
    else for(const id of sections.get(current.id)?.members||[])activeEdges.add(id);
    for(const id of activeEdges){const e=edges.get(id);activeNodes.add(e.source);activeNodes.add(e.target)}
    for(const el of all)el.classList.add('interaction-inactive');
    const activate=el=>{if(!el)return;el.classList.remove('interaction-inactive');el.classList.add('is-active');for(let parent=el.parentElement;parent&&parent!==svg;parent=parent.parentElement){parent.classList.add('has-active-descendant');parent.classList.remove('interaction-inactive')}};
    for(const id of activeNodes){const node=nodes.get(id);activate(node);if(node){const copy=node.cloneNode(true),originals=[node,...node.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];for(let i=0;i<clones.length;i++){const el=clones[i],computed=getComputedStyle(originals[i]);for(const a of [...el.attributes])if(a.name==='id'||a.name.startsWith('data-')||['class','style','tabindex','role','aria-label'].includes(a.name))el.removeAttribute(a.name);for(const key of ['fill','fill-opacity','stroke','stroke-width','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline','letter-spacing','visibility'])el.style.setProperty(key,computed.getPropertyValue(key));if(i){el.style.setProperty('transform',computed.getPropertyValue('transform'));el.style.setProperty('transform-origin',computed.getPropertyValue('transform-origin'))}el.setAttribute('pointer-events','none');el.setAttribute('aria-hidden','true')}rootTransform(node,copy);copy.classList.add('active-node-overlay');nodePaint.append(copy)}}
    for(const id of activeEdges){const original=edges.get(id).element;activate(original);const copy=original.cloneNode(false),style=getComputedStyle(original);for(const a of [...copy.attributes])if(a.name==='id'||a.name.startsWith('data-')||['class','style','tabindex','role','aria-label'].includes(a.name))copy.removeAttribute(a.name);rootTransform(original,copy);copy.classList.add('active-edge-overlay');for(const key of ['stroke','stroke-width','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','fill','vector-effect','marker-start','marker-mid','marker-end'])copy.style.setProperty(key,style.getPropertyValue(key));copy.setAttribute('pointer-events','none');copy.setAttribute('aria-hidden','true');overlays.append(copy)}
    const drawnNodes=[...activeNodes].filter(id=>nodes.has(id)),lock=selection?'Selected':'Tracing';
    if(status)status.textContent=current.kind==='node'?`${lock} node ${label(current.id)}: ${activeEdges.size} incident connectors; ${drawnNodes.filter(id=>id!==current.id).length} neighboring nodes.`:current.kind==='edge'?`${lock} connector ${label(edges.get(current.id).source)} → ${label(edges.get(current.id).target)}: 1 connector; ${drawnNodes.length} endpoint nodes.`:`${lock} shared section: ${activeEdges.size} connectors; ${new Set([...activeEdges].map(id=>edges.get(id).source).filter(id=>nodes.has(id))).size} source nodes; ${drawnNodes.length} endpoint nodes.`;
  }
  const reset=()=>{selection=null;hover=null;focus=null;paint()};
  function bind(el,item,keyboard=true){if(keyboard){el.setAttribute('tabindex','0');el.setAttribute('role','button');el.setAttribute('aria-label',item.kind==='node'?`Trace node ${label(item.id)}`:item.kind==='edge'?`Trace connector ${item.id}`:`Trace shared section ${item.id}`);}else el.setAttribute('aria-hidden','true');el.addEventListener('pointerenter',()=>{hover=item;paint()});el.addEventListener('pointerleave',()=>{if(same(hover,item))hover=null;paint()});el.addEventListener('focus',()=>{focus=item;paint()});el.addEventListener('blur',()=>{if(same(focus,item))focus=null;paint()});const toggle=()=>{if(same(selection,item)){selection=null;hover=null;focus=null}else selection=item;paint()};el.addEventListener('click',event=>{event.stopPropagation();toggle()});el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();toggle()}})}
  const configure=hit=>{for(const name of ['id','class','style','marker-start','marker-mid','marker-end','data-edge','data-source','data-target'])hit.removeAttribute(name);hit.classList.add('interaction-hit');hit.setAttribute('fill','none');hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width','14');hit.setAttribute('stroke-dasharray','none');hit.setAttribute('vector-effect','non-scaling-stroke');hit.setAttribute('pointer-events','stroke')};
  for(const [id,e] of edges){e.element.setAttribute('pointer-events','none');const hit=e.element.cloneNode(false);rootTransform(e.element,hit);configure(hit);hit.classList.add('edge-hit');hit.dataset.hitEdge=id;bind(hit,{kind:'edge',id});hits.append(hit)}
  // Later section hits win overlap hit-testing; all hit/overlay layers remain
  // below node groups, so node interaction wins over nearby stroke targets.
  for(const s of sections.values()){const hit=element('path');configure(hit);hit.setAttribute('d',`M${s.points[0].join(' ')} L${s.points[1].join(' ')}`);hit.classList.add('trunk-hit');hit.dataset.hitSection=s.id;bind(hit,{kind:'trunk',id:s.id});hits.append(hit)}
  for(const [id,node] of nodes){bind(node,{kind:'node',id});const box=node.getBBox(),hit=element('path');hit.setAttribute('d',`M${box.x} ${box.y} L${box.x+box.width} ${box.y} L${box.x+box.width} ${box.y+box.height} L${box.x} ${box.y+box.height} Z`);rootTransform(node,hit);hit.classList.add('node-hit');hit.setAttribute('fill','transparent');hit.setAttribute('stroke','none');hit.setAttribute('pointer-events','all');hit.dataset.hitNode=id;bind(hit,{kind:'node',id},false);nodeHits.append(hit)}
  svg.addEventListener('pointerleave',()=>{hover=null;paint()});svg.addEventListener('click',reset);svg.parentElement?.addEventListener('click',e=>{if(e.target===svg.parentElement)reset()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();reset();document.activeElement?.blur?.()}});paint();return {reset};
}
const STYLE=`html,body{margin:0;background:#f6f7f9;color:#17212e;font:14px system-ui,sans-serif}main{padding:20px}h1{font-size:18px;margin:0 0 12px}#diagram{background:white;overflow:auto;max-height:80vh;border:1px solid #dce2e8;border-radius:8px;padding:12px}#diagram>svg{display:block}.view-controls{display:flex;gap:8px;margin-bottom:12px}.view-controls button{font:inherit;padding:5px 12px;cursor:pointer}#hover-status{min-height:2em;margin:12px 0}.focus-on .interaction-inactive{opacity:.18!important}.focus-on .is-active,.focus-on .has-active-descendant{opacity:1!important}.interaction-hit{cursor:pointer}.interaction-hit:focus-visible{outline:none;stroke:#4d90fe;stroke-opacity:.18}.is-active:focus-visible{outline:2px solid #4d90fe;outline-offset:2px}.active-edge-overlay{pointer-events:none}`;
export function createInteractiveHtml(svgBytes,{title='Interactive diagram',sharedSections=[]}={}){
  const {svg,edges}=validateSvg(svgBytes),sections=validateSections(sharedSections,edges),data=JSON.stringify({svg,sections}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const script=`
const data=${data};
const doc=new DOMParser().parseFromString(data.svg,'image/svg+xml');
if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg'||doc.documentElement.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('SVG_XML_INVALID');
const svg=document.importNode(doc.documentElement,true);document.getElementById('diagram').append(svg);
(${installInteractiveSvg.toString()})(svg,data.sections,document.getElementById('hover-status'));
const box=svg.viewBox?.baseVal;const nativeWidth=box?.width||parseFloat(svg.getAttribute('width'))||800,nativeHeight=box?.height||parseFloat(svg.getAttribute('height'))||600;
const native=()=>{svg.style.width=nativeWidth+'px';svg.style.height=nativeHeight+'px';svg.style.maxWidth='none';};
document.getElementById('view-native').addEventListener('click',native);document.getElementById('view-fit').addEventListener('click',()=>{svg.style.width='100%';svg.style.height='auto';svg.style.maxWidth='100%';});native();
`;
  const scriptHash=createHash('sha256').update(script).digest('base64'),policy=`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'`;
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main><h1>${escapeHtml(title)}</h1><div class="view-controls"><button type="button" id="view-fit">Fit</button><button type="button" id="view-native">100%</button></div><div id="diagram"></div><p id="hover-status" role="status" aria-live="polite"></p></main><script>${script}</script></body></html>\n`;
}
