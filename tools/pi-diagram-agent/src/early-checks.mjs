// Early mechanical checks (run at every diagram_inspect and at every submit), region signatures, and the reviewer-vs-auditor coverage table.
import {createHash} from 'node:crypto';
import {makeFinding,auditToFindings} from './findings.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const tagsOf=text=>text.match(/<[a-zA-Z][^<>]*>/g)??[];

/** Forbidden SVG constructs. Tag-level checks look at tags only (text content is never a construct); the paint keywords are matched anywhere. */
export function scanForbidden(svgText){
  const counts=new Map(),add=name=>counts.set(name,(counts.get(name)??0)+1);
  for(const tag of tagsOf(svgText)){
    const name=/^<\s*([A-Za-z][\w:-]*)/.exec(tag)[1].toLowerCase();
    if(name==='script')add('script');
    if(name==='foreignobject')add('foreignObject');
    if(name==='iframe')add('iframe');
    if(name==='image')add('image');
    if(/\son[a-z]+\s*=/i.test(tag))add('event-handler');
    if(/\s(?:xlink:)?href\s*=/i.test(tag))add('href');
  }
  for(const m of svgText.matchAll(/context-(stroke|fill)/g))add(`context-${m[1]}`);
  return [...counts].map(([construct,count])=>({construct,count}));
}

const FORBIDDEN_FIX={
  'context-stroke':'Use an explicit solid hex colour for the arrowhead marker fill (matching the edge stroke); Safari renders context-stroke black.',
  'context-fill':'Use an explicit solid hex colour instead of context-fill.',
  script:'Remove the <script> element; the SVG must be static.',
  foreignObject:'Remove <foreignObject>; draw text with <text>.',
  iframe:'Remove the <iframe> element.',
  image:'Remove the <image> element; draw with vector shapes.',
  'event-handler':'Remove on* event-handler attributes.',
  href:'Remove href/xlink:href attributes; the SVG must not link out.',
};

const BINDING_FIX={
  nodeIdentity:'Wrap each node in g[data-node="<source id>"] so the auditor can bind it to the source.',
  relations:'Give each relation path data-source="<id>" and data-target="<id>" so it binds to the source edge.',
  groups:'Give each group container a neutral group id (g[data-group="<id>"]) so it binds to the source subgraph.',
};
/** Audit rules that count as early binding checks (reported at every inspect, not only at the gate). */
export const EARLY_AUDIT_RULES=['nodeIdentity','relations','groups'];
/** Layout and style rules the auditor measures from the drawn SVG (src/layout-checks.mjs); a FAIL is reported as an early finding at every inspect, not only at the gate. */
export const EARLY_MEASURED_RULES=['connectorStrokeWidth','filletUniformity','markerUniformity','textContrast','labelFontWeight','legendCompleteness'];

export function earlyFindings({svgText,audit}){
  const out=[];
  const hits=scanForbidden(svgText);
  if(hits.length)out.push(makeFinding({source:'early',severity:'blocking',rule:'forbidden-construct',elements:hits.map(h=>h.construct),
    evidence:{measured:hits.map(h=>`${h.construct} x${h.count}`).join(', '),threshold:'0 occurrences of script, foreignObject, iframe, image, href, on* handlers, context-stroke, context-fill'},
    suggestion:hits.map(h=>FORBIDDEN_FIX[h.construct]).join(' ')}));
  for(const f of auditToFindings(audit))if(EARLY_AUDIT_RULES.includes(f.rule)||EARLY_MEASURED_RULES.includes(f.rule))out.push(makeFinding({...f,source:'early'}));
  // No bindings at all is NOT-CHECKABLE for the auditor (it cannot FAIL what it cannot see), but for the gate it is a missing binding.
  for(const rule of EARLY_AUDIT_RULES){
    const c=audit?.checks?.[rule];
    if(c?.status!=='NOT-CHECKABLE'||typeof c.evidence!=='string'||/source parser/i.test(c.evidence)||!/binding/i.test(c.evidence))continue;
    out.push(makeFinding({source:'early',severity:'blocking',rule,elements:[],evidence:{measured:`no ${rule==='nodeIdentity'?'node':rule==='relations'?'relation':'group'} binding found in the SVG (${c.evidence})`,threshold:'every source node, relation and group is bound in the SVG'},suggestion:BINDING_FIX[rule]}));
  }
  return out;
}

// ---- region signatures -------------------------------------------------------------------------
const num=v=>{const n=Number.parseFloat(v);return Number.isFinite(n)?n:null};
const attr=(tag,name)=>new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)?.slice(1).find(v=>v!==undefined)??null;
function boxOfTag(tag){
  const name=/^<\s*([A-Za-z][\w:-]*)/.exec(tag)[1].toLowerCase();
  const n=k=>num(attr(tag,k));
  if(name==='rect'&&n('x')!==null&&n('y')!==null&&n('width')!==null&&n('height')!==null)return {x:n('x'),y:n('y'),w:n('width'),h:n('height')};
  if(name==='circle'&&n('cx')!==null&&n('cy')!==null&&n('r')!==null)return {x:n('cx')-n('r'),y:n('cy')-n('r'),w:2*n('r'),h:2*n('r')};
  if(name==='ellipse'&&n('cx')!==null&&n('cy')!==null&&n('rx')!==null&&n('ry')!==null)return {x:n('cx')-n('rx'),y:n('cy')-n('ry'),w:2*n('rx'),h:2*n('ry')};
  if(name==='text'&&n('x')!==null&&n('y')!==null)return {x:n('x'),y:n('y'),w:0,h:0};
  let pts=null;
  const d=attr(tag,'d'),points=attr(tag,'points');
  if(d){
    pts=[];
    for(const seg of d.match(/[MLHVQCSTAZmlhvqcstaz][^MLHVQCSTAZmlhvqcstaz]*/g)??[]){
      const c=seg[0],a=(seg.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)??[]).map(Number);
      if(c==='H'&&a.length)pts.push([a[0],pts.at(-1)?.[1]??0]);
      else if(c==='V'&&a.length)pts.push([pts.at(-1)?.[0]??0,a[0]]);
      else if(/[MLQCST]/.test(c))for(let i=0;i+1<a.length;i+=2)pts.push([a[i],a[i+1]]);
      else if(c==='A'&&a.length>=7)pts.push([a[5],a[6]]);
    }
  }else if(points){const a=(points.match(/-?\d*\.?\d+/g)??[]).map(Number);pts=[];for(let i=0;i+1<a.length;i+=2)pts.push([a[i],a[i+1]])}
  else if(name==='line'&&['x1','y1','x2','y2'].every(k=>n(k)!==null))pts=[[n('x1'),n('y1')],[n('x2'),n('y2')]];
  if(pts?.length){const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}}
  return null;
}
const intersects=(a,b)=>a.x<=b.x+b.w&&b.x<=a.x+a.w&&a.y<=b.y+b.h&&b.y<=a.y+a.h;

/** Hash of the SVG fragments that belong to a finding: tags owned by its element ids (data-node, data-group, edge source/target) plus tags whose box meets its region. */
export function regionSignature(svgText,{elements=[],region=null}){
  const want=new Set(elements.map(String)),parts=[],stack=[];
  const tokens=svgText.match(/<[^<>]+>|[^<]+/g)??[];
  let lastMatched=false;
  for(const tok of tokens){
    if(tok[0]!=='<'){if(lastMatched){const t=tok.trim();if(t)parts.push(t)}continue}
    if(tok.startsWith('</')||tok.startsWith('<!')||tok.startsWith('<?')){if(tok.startsWith('</'))stack.pop();lastMatched=false;continue}
    const name=/^<\s*([A-Za-z][\w:-]*)/.exec(tok)[1];
    const self=/\/\s*>$/.test(tok);
    const s=attr(tok,'data-source')??attr(tok,'data-edge-label-source'),t=attr(tok,'data-target')??attr(tok,'data-edge-label-target');
    const own=attr(tok,'data-node')??attr(tok,'data-node-id')??attr(tok,'data-group')??attr(tok,'data-container-id')??(s&&t?`${s}->${t}`:null);
    const owner=own??stack.at(-1)??null;
    if(!self)stack.push(owner);
    let match=owner!==null&&want.has(owner);
    if(!match&&region){const b=boxOfTag(tok);match=!!b&&intersects(b,region)}
    lastMatched=match;
    if(match)parts.push(tok.replace(/\s+/g,' '));
  }
  return parts.length?sha(parts.join('\n')):sha('whole:'+svgText); // nothing resolvable: any change to the SVG counts
}

/** A reviewer blocking finding that is new in this review although the geometry it is about is unchanged since the previous review is reviewer
 *  instability (it appears in only one of two consecutive reviews). It is LOGGED, never downgraded: per-run reviewer recall is ~67%, so
 *  "missed last time, caught now" is usually a real defect, and downgrading it would let the gate pass a defect the reviewer just named. */
export function applyStability(findings,{previous,svgText}){
  if(!previous)return findings;
  return findings.map(f=>{
    if(f.source!=='review'||f.severity!=='blocking'||previous.keys.has(f.key))return f;
    if(regionSignature(previous.svgText,f)!==regionSignature(svgText,f))return f;
    return {...f,unstable:{reason:'reported in only one of two consecutive reviews on unchanged geometry'}};
  });
}

// ---- reviewer findings vs auditor coverage -----------------------------------------------------
export const REVIEW_RULES=['reading-order','label-ownership','detour','legend','shape-change','text-overflow','balance','route-node-intrusion','route-crossing','heading-overlap','label-clearance','other'];

/** A reviewer rule is "covered" only for the geometry the named audit check measures. Everything not listed here is NOT covered and the finding stands.
 *  curveSafe=false: the check measures straight spans only (curves and fillets are outside it), so any curved named edge leaves the finding standing. */
export const COVERAGE={
  'route-node-intrusion':{check:'routeNodeIntrusion',kind:'edge',curveSafe:true,count:'checkedEdges',total:m=>m.edges.length},
  'heading-overlap':{check:'routeHeadingClearance',kind:'edge',curveSafe:true,count:'checkedEdges',total:m=>m.edges.length},
  'route-crossing':{check:'routeCrossings',kind:'edge',curveSafe:false,count:'checkedEdges',total:m=>m.edges.length},
  'label-clearance':{check:'labelClearance',kind:'edge',curveSafe:true,count:null},
  'text-overflow':{check:'textFit',kind:'node',curveSafe:true,count:'checkedNodes',total:m=>m.nodes.length},
  // global: the check measures every node fill, shape and dashed connector against every legend key, so it covers the reviewer's legend finding whatever elements it names.
  legend:{check:'legendCompleteness',kind:'global'},
};

function edgePathHasCurve(svgText,source,target){
  for(const tag of tagsOf(svgText)){
    if(attr(tag,'data-source')!==source||attr(tag,'data-target')!==target)continue;
    const d=attr(tag,'d');
    if(d===null)return null;
    return /[QCSTAqcsta]/.test(d);
  }
  return null;
}

export function applyCoverage(findings,{audit,svgText,model}){
  return findings.map(f=>{
    const rule=COVERAGE[f.rule];
    if(f.severity!=='blocking'||f.source!=='review'||!rule||!model||(rule.kind!=='global'&&!f.elements.length))return f;
    const check=audit?.checks?.[rule.check];
    if(check?.status!=='PASS')return f;
    const ev=typeof check.evidence==='object'?check.evidence:{};
    if(rule.count&&!(Number.isFinite(ev[rule.count])&&ev[rule.count]>=rule.total(model)))return f;
    for(const id of rule.kind==='global'?[]:f.elements){
      if(rule.kind==='node'){if(!model.nodes.some(n=>n.id===id))return f;continue}
      const m=/^(.+)->(.+)$/.exec(id);
      if(!m||!model.edges.some(e=>e.source===m[1]&&e.target===m[2]))return f;
      if(!rule.curveSafe){const curved=edgePathHasCurve(svgText,m[1],m[2]);if(curved!==false)return f}
    }
    return {...f,severity:'minor',downgraded:{by:rule.check,reason:`auditor ${rule.check} PASS on exactly these elements; method covers this geometry`}};
  });
}
