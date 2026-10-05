import {installInteractiveSvg,INTERACTIVE_SVG_STYLE} from './interactive-runtime.mjs';
export {installInteractiveSvg,INTERACTIVE_SVG_STYLE} from './interactive-runtime.mjs';
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
const STYLE=`html,body{margin:0;background:#f6f7f9;color:#17212e;font:14px system-ui,sans-serif}main{padding:20px}h1{font-size:18px;margin:0 0 12px}#diagram{background:white;overflow:auto;max-height:80vh;border:1px solid #dce2e8;border-radius:8px;padding:12px}#diagram>svg{display:block}.view-controls{display:flex;gap:8px;margin-bottom:12px}.view-controls button{font:inherit;padding:5px 12px;cursor:pointer}#hover-status{min-height:2em;margin:12px 0}${INTERACTIVE_SVG_STYLE}`;
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
