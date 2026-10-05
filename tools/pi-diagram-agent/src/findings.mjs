// Findings format, ledger, and audit-to-findings mapping for the v2 loop. Pure code: no model, no browser.
import {createHash} from 'node:crypto';
import {splitAuditFail} from './relaxed.mjs';

export const FINDING_SOURCES=['audit','review','early'];
export const FINDING_SEVERITIES=['blocking','minor'];

export const findingKey=(rule,elements)=>`${rule}|${[...new Set(elements.map(String))].sort().join(',')}`;

const clip=(v,n=400)=>{const s=typeof v==='string'?v:JSON.stringify(v);return s.length>n?s.slice(0,n-1)+'…':s};
const finiteRegion=r=>r&&['x','y','w','h'].every(k=>Number.isFinite(r[k]))?{x:r.x,y:r.y,w:r.w,h:r.h}:null;

/** Findings format shared by auditor, early checks and reviewer: {id,key,source,severity,rule,elements,region,evidence:{measured,threshold},suggestion}. */
export function makeFinding({source,severity,rule,elements=[],region=null,evidence={},suggestion=''}){
  if(!FINDING_SOURCES.includes(source))throw Error(`FINDING_SOURCE: ${source}`);
  if(!FINDING_SEVERITIES.includes(severity))throw Error(`FINDING_SEVERITY: ${severity}`);
  if(typeof rule!=='string'||!rule)throw Error('FINDING_RULE_REQUIRED');
  const ids=[...new Set(elements.map(String))].sort(),key=findingKey(rule,ids);
  return {id:'F-'+createHash('sha256').update(key).digest('hex').slice(0,8),key,source,severity,rule,elements:ids,region:finiteRegion(region),
    evidence:{...evidence,measured:evidence.measured??null,threshold:evidence.threshold??null},suggestion:String(suggestion)};
}

/** Findings ledger across rounds. States: open | fixed | regressed. Only the sources that ran in a round can mark their findings fixed. */
export function createLedger(){
  const entries=new Map();
  return {
    update(round,findings,{sources=['audit','review','early'],sigOf=null}={}){
      const present=new Map(findings.map(x=>[x.key,x]));
      for(const [key,x] of present){
        const e=entries.get(key);
        if(e&&e.lastSeenRound===round)continue; // idempotent within a round
        const sig=sigOf?sigOf(x):null;
        if(!e){entries.set(key,{key,state:'open',finding:x,firstRound:round,lastSeenRound:round,oscillations:0,falseBlockCandidate:false,lastSig:sig,history:[{round,state:'open'}]});continue}
        const next=e.state==='fixed'||e.state==='regressed'?'regressed':'open';
        if(e.state==='fixed')e.oscillations++;
        e.state=next;e.finding=x;e.lastSeenRound=round;e.lastSig=sig;e.history.push({round,state:next});
      }
      for(const [key,e] of entries){
        if(present.has(key)||e.state==='fixed'||!sources.includes(e.finding.source))continue;
        e.state='fixed';e.history.push({round,state:'fixed'});
        if(e.finding.source==='review'&&e.finding.severity==='blocking'&&sigOf&&e.lastSig!=null&&sigOf(e.finding)===e.lastSig)e.falseBlockCandidate=true;
      }
    },
    get:key=>entries.get(key),
    entries:()=>[...entries.values()],
    open:()=>[...entries.values()].filter(e=>e.state!=='fixed'),
    openBlocking:()=>[...entries.values()].filter(e=>e.state!=='fixed'&&e.finding.severity==='blocking'),
    snapshot:()=>[...entries.values()].map(e=>({key:e.key,id:e.finding.id,source:e.finding.source,severity:e.finding.severity,rule:e.finding.rule,elements:e.finding.elements,state:e.state,firstRound:e.firstRound,lastSeenRound:e.lastSeenRound,oscillations:e.oscillations,falseBlockCandidate:e.falseBlockCandidate,unstable:!!e.finding.unstable,history:e.history})),
  };
}

const rank=e=>(e.state==='regressed'?0:10)+(e.finding.source==='review'?2:e.finding.source==='early'?0:1);

/** At most `max` open blocking findings, regressed first, then mechanical (early, audit) before review. Minor findings are counted, not sent. */
export function selectForAuthor(ledger,{max=5}={}){
  const blocking=ledger.openBlocking().map((e,i)=>({e,i})).sort((a,b)=>rank(a.e)-rank(b.e)||a.i-b.i).map(x=>x.e);
  const minorCount=ledger.open().filter(e=>e.finding.severity==='minor').length;
  return {sent:blocking.slice(0,max).map(e=>({...e.finding,state:e.state})),omittedBlocking:Math.max(0,blocking.length-max),minorCount};
}

export function formatForAuthor(selection){
  return {findings:selection.sent.map(({id,source,severity,rule,elements,region,evidence,suggestion,state,repairHints,moveHints})=>({id,source,severity,rule,elements,region,evidence,suggestion,state,...(repairHints?{repairHints}:{}),...(moveHints?{moveHints}:{})})),omittedBlocking:selection.omittedBlocking,minorCount:selection.minorCount};
}

// ---- audit -> findings -------------------------------------------------------------------------
const ID_KEYS=new Set(['nodeId','nodeIds','edge','edgeA','edgeB','groupId','groupIds','missing','extra','mismatchedNodeIds','mismatchedEdges','unadjudicatedNodeIds','edges','unboundLabels','malformedEdges','intrudedNodeIds','source','target','elementId','markerId','coveredEdge']);
function collectIds(value,out,key=null){
  if(value==null)return;
  if(typeof value==='string'){if(key&&ID_KEYS.has(key)&&value.length<=120)out.add(value);return}
  if(Array.isArray(value)){for(const v of value)collectIds(v,out,key);return}
  if(typeof value==='object'){
    if(typeof value.source==='string'&&typeof value.target==='string'){out.add(`${value.source}->${value.target}`);return}
    for(const [k,v] of Object.entries(value))collectIds(v,out,k);
  }
}
const SUGGESTIONS={
  svgWellFormed:'Fix the SVG so it parses as well-formed XML, then re-render.',
  nodeIdentity:'Draw every source node exactly once as g[data-node="<id>"]; remove drawn nodes that are not in the source.',
  nodeText:'Make the drawn node text match the source label exactly (whitespace-normalized).',
  relations:'Draw each source relation as one visible path with data-source/data-target bound to its endpoints; remove extra or malformed ones.',
  relationStyle:'Match the source edge style: dashed source relations need a dash array, solid ones none.',
  groups:'Draw each source group as a container with its group id; do not add or drop groups.',
  groupMembership:'Move the listed nodes inside their group outline, or outside it if they are not members.',
  originalGroupParity:'Keep the original render\'s visible group membership; or ask the user for an adjudication.',
  semanticPreservation:'Keep the original visible group membership for the listed nodes (the user has not adjudicated a change).',
  sourceDefinitionConflicts:'The source defines the listed nodes more than once with different text or shape. Draw the last definition, as Mermaid does; the ambiguity stays a failure until the user fixes the source.',
  textFit:'Enlarge the node or shorten line breaks so all text sits inside the outline inset by 8 units. Text must also keep 4 units from every drawn stroke of its node, and a declared data-label-box must not contain one: for a cylinder/store put the label box and text entirely below the lid arc (its lowest point, not its top edge), for a queue or subroutine keep them between the inner bars; grow the node if needed.',
  labelFontFit:'At the caller-declared fit viewport or native zoom, every primary label must be at least 12 effective px. Enlarge comparable fonts together within their boxes or select a larger common box tier; for fit presentation, fold or relayout to reduce the canvas. Do not change SVG metadata to claim a different display scale.',
  nodeHeadingClearance:'Move the listed node (and its group if needed) so its outline keeps at least 8 units from the group heading/subtitle text and at least 8 units from the border of its container; reserve a heading band at the top of the container.',
  labelClearance:'Move the edge label so its box does not touch any node or container outline.',
  labelCoversRoute:'An edge label background must never hide another route or any arrowhead, its own included (a label on its own arrowhead: move the label along its own route away from the arrowhead): widen the gap or spread the ports so the label can sit on its own route (centred on a straight segment) or beside it without touching a neighbouring route; never push the label away from its own route.',
  edgeLabelStyle:'An edge label has no border and always has a background: remove every stroke from the label pill or background shape (stroke="none"), and put an opaque fill (alpha 1, no fill-opacity or group opacity) matching the canvas behind the text, covering the whole text.',
  routeNodeIntrusion:'Re-route the edge so it stays out of unrelated nodes and starts/ends on its own node outlines.',
  routeHeadingClearance:'Group heading crossings are allowed; do not detour just to avoid a group title. Keep node and edge-label text readable.',
  routeBoundaryCoincidence:'Move the route off the group border. A transverse border crossing is allowed; riding along any container border is forbidden even for a short span.',
  siblingGroupOverlap:'Separate sibling containers; only source-declared ancestor nesting is allowed. Preserve node membership and reroute affected edges.',
  boxSizeConsistency:'Use the shared code-owned box tiers, grow on the common grid for long text, and keep comparable nodes in one family/layer/shape at one consistent size. Add explicit sizeFamily and sizeTier declarations; do not clip text to force a tier.',
  routeEarlyMerge:'Join semantically related incoming connectors before their premerge crossings or duplicate parallel lanes when a whole-family feasible layout exists. Preserve each complete relation and the entire downstream shared suffix.',
  routeUnrelatedContainerTransit:'Re-route the edge so it does not cross a container that contains neither endpoint.',
  arrowEndStartClearance:'Separate the incoming arrow end from every other connector start port and first shaft; move a port or reroute locally. Do not remove a relation or waive this overlap in dense diagrams.',
  markerDrawing:'Give the arrowhead marker a visible fill matching the edge stroke (no context-stroke).',
  routePairClearance:'Separate the listed parallel route spans to at least the required clearance. A declared shared trunk must carry one relation style (dash, width, colour), no edge label on or within 4 units of the shared run, and a proved continuous same-direction suffix reaching the common target; branches may join incrementally before shared bends. Otherwise give each connector its own port or route (no head-on T-junction between two sources).',
  routeCrossings:'Re-route so the listed edges do not cross; move a bend or port.',
  connectorStrokeWidth:'Draw every connector at stroke-width 1; a heavier line needs a data-emphasis role whose meaning is written in the SVG palette comment.',
  filletUniformity:'Round every connector bend with one uniform r=5 fillet (a Q/A corner with 5-unit legs); no sharp 90-degree corners, no other radii.',
  markerUniformity:'Use one arrowhead marker geometry for every connector: markerUnits="userSpaceOnUse", identical markerWidth/markerHeight and path, refX at the tip, explicit hex fill (no context-stroke).',
  textContrast:'Change the listed text or its background to a documented subtle/bold pair that reaches 4.5:1, keeping the semantic hue.',
  labelFontWeight:'Use font-weight 400 for node labels and descriptions; express hierarchy with size. Only group headings may be heavier.',
  legendCompleteness:'A legend is optional, but a drawn legend must match actual use. Fix or remove each entry listed in wrongEntries (a dashed key with no dashed connector, a fill no node uses, a shape no node is drawn as); do not add a legend.',
  routeDetour:'Preserve the approved whole shared suffix and compare feasible family routes before shortening the listed route: a much shorter feasible route exists (see the witness in the evidence); do not wrap a connector around other nodes or the canvas when a direct leg is free; move a node or the port if needed.',
  routeContainerClearance:'Move the listed route or edge label so it keeps at least 8 units (at least 12 units for a run longer than 100) from every container border it does not need to cross (routes may only cross a border at its entry or exit point), and keep edge labels at least 4 units from a container border; widen a narrow gutter between containers.',
  arrowShaft:'Lengthen the final straight segment before the arrowhead to the required visible shaft.',
};
const fallbackSuggestion=rule=>`Resolve the ${rule} failure shown in the evidence, then re-render.`;

const pt=p=>`(${p[0]},${p[1]})`;
// Concise author-facing text for routeCrossings repair hints: the hint is evidence (the SVG is never changed for the author).
function crossingHintText(violations){
  const lines=[];
  for(const v of violations){
    const h=v.repairHint;
    if(h){const mid=h.points.slice(1,-1).map(pt),via=mid.length?(mid.length>4?`${mid.slice(0,2).join(' ')}…${mid.at(-1)}`:mid.join(' ')):`${pt(h.points[0])}…${pt(h.points.at(-1))}`;lines.push(`reroute ${h.edge} via ${via}, ${h.bends} bend${h.bends===1?'':'s'}`)}
    else if(v.reason)lines.push(`${v.edgeA} x ${v.edgeB}: ${v.reason}`);
    const m=v.moveHint;
    if(!h&&m)lines.push(`move ${m.node} by (${m.dx},${m.dy}) and reroute ${m.reroutes.map(r=>r.edge).join(', ')}: crossings ${m.crossingsBefore} -> ${m.crossingsAfter}`);
    else if(!h&&v.moveHintReason)lines.push(`${v.edgeA} x ${v.edgeB}: ${v.moveHintReason}`);
  }
  return [...new Set(lines)].join('; ');
}
// Concise author-facing text for labelCoversRoute: a free stretch of the label's own route, or the reason there is none (evidence, the author decides).
function labelHintText(violations){
  return [...new Set(violations.map(v=>v.repairHint
    ?`the label of ${v.edge} fits on its own route centred at (${v.repairHint.x}, ${v.repairHint.y})${v.repairHint.vertical?', drawn vertical':''}, clear of every other route and every arrowhead`
    :`${v.edge}: ${v.reason??'no free stretch of its own route was found'}; change the layout (widen the gap, spread the ports)`))].join('; ');
}
const fx=v=>v?`${v.offset} units (${v.fraction===null?'n/a':v.fraction} of the ${v.faceLength}-unit face)`:'n/a';
function lowerBendMinorFinding(m){
  return makeFinding({source:'audit',severity:'minor',rule:'routeLowerBend',elements:[m.edge],
    evidence:{measured:`anchors off the face midpoints: drawn source ${fx(m.drawn?.source)}, target ${fx(m.drawn?.target)}; same-bend witness source ${fx(m.witness?.source)}, target ${fx(m.witness?.target)}`,threshold:'non-blocking: anchors closer to the face midpoints exist with the same bends and crossings'},
    suggestion:'Optional: move the anchors toward the face midpoints when it costs nothing; this does not block acceptance.'});
}
function fontFitHintText(violations){
  return violations.map(v=>v.fixByFont
    ?`enlarge the font of ${v.nodeId} to ${v.neededSize} or more (up to ${v.maxFittingSize} fits its labelBox); it is ${v.size} units now, ${v.effective} px at the page fit (scale ${v.pageScale})`
    :v.presentation?.mode==='native'?`${v.nodeId} needs readable text at native zoom ${v.presentation.scale}; enlarge the common box tier and font, or change the actual viewer zoom, not just SVG metadata`
    :`${v.nodeId} cannot reach 12 px inside its box (${v.size} units, ${v.effective} px at scale ${v.pageScale}${v.maxFittingSize?`; at most ${v.maxFittingSize} fits`:''})${v.maxCanvas?`: reduce the canvas width to about ${v.maxCanvas.width} units or less (or the height to ${v.maxCanvas.height}) by folding or relayout, or use a smaller tier with a larger font`:': use a smaller tier with a larger font, or reduce the canvas by folding or relayout'}`).join('; ');
}
function fontFitMinorFinding(m){
  return makeFinding({source:'audit',severity:'minor',rule:'labelFontFit',elements:[m.nodeId],
    evidence:{measured:`primary label of ${m.nodeId} is ${m.size} units; ${m.maxFittingSize} would still fit its labelBox [${m.box.join(', ')}]`,threshold:'non-blocking: a label that could be 4 or more units larger inside its labelBox should use the larger font (font-fill rule)'},
    suggestion:`Optional: enlarge the font of ${m.nodeId} from ${m.size} to ${m.maxFittingSize} (shared with comparable nodes: the smallest of their maxima); this does not block acceptance.`});
}
function legendMinorFinding(ev){
  const keys=ev.minorFindings.map(k=>`${k.kind}:${k.value}`);
  return makeFinding({source:'audit',severity:'minor',rule:'legendCompleteness',elements:['legend'],
    evidence:{measured:`the drawn legend has no key for ${keys.join(', ')}`,threshold:'non-blocking: a legend is optional and an incomplete legend never blocks acceptance'},
    suggestion:'Optional: add a key for the listed fill roles, shapes or line styles, or leave the legend as it is; this does not block acceptance.'});
}
function denseCrossingMinorFinding(ev){
  const edges=ev.minorFindings.flatMap(v=>[v.edgeA,v.edgeB]);
  return makeFinding({source:'audit',severity:'minor',rule:'routeCrossings',elements:edges,
    evidence:{measured:`${ev.crossings} crossing(s) measured; ${ev.dense.reason}`,threshold:'non-blocking: in a dense diagram zero crossings is not the goal (Diagram Rules, dense diagrams)'},
    suggestion:'Optional: reduce crossings with port order and routing lanes where it costs nothing; do not chase zero. This does not block acceptance and never needs a waiver.'});
}
/** Every FAIL check of an auditAgentSvg result becomes one blocking finding; routeLowerBend midpoint-only witnesses become minor findings. NOT-CHECKABLE and PASS produce no blocking findings. */
export function auditToFindings(audit,{relaxed=false}={}){
  if(!audit||!audit.checks)return [];
  const out=[];
  // One blocking-or-advice finding from (a part of) a FAIL check's evidence. Hints only travel with the check's own evidence, so they follow the part they came from.
  const build=(rule,ev,severity)=>{
    const ids=new Set();collectIds(ev,ids);
    const method=typeof ev==='object'&&ev&&typeof ev.method==='string'?ev.method:null;
    const detail=typeof ev==='string'?ev:Object.fromEntries(Object.entries(ev??{}).filter(([k])=>k!=='method'&&k!=='reasons'));
    const hintText=rule==='routeCrossings'&&Array.isArray(ev?.violations)?crossingHintText(ev.violations):rule==='labelCoversRoute'&&Array.isArray(ev?.violations)?labelHintText(ev.violations):'';
    const fontHint=rule==='labelFontFit'&&Array.isArray(ev?.violations)?fontFitHintText(ev.violations.map(v=>({...v,presentation:ev.presentation}))):'';
    const hints=rule==='routeCrossings'&&Array.isArray(ev?.violations)?[...new Map(ev.violations.filter(v=>v.repairHint).map(v=>[`${v.repairHint.edge}|${JSON.stringify(v.repairHint.points)}`,v.repairHint])).values()]:[];
    const f=makeFinding({source:'audit',severity,rule,elements:[...ids],region:null,
      evidence:{measured:clip(detail),threshold:method?clip(method,240):'rule check passes (see Diagram Rules)'},
      suggestion:(SUGGESTIONS[rule]??fallbackSuggestion(rule))+(hintText?` Repair hint (evidence from a route search with all other routes fixed; you decide): ${hintText}.`:'')+(fontHint?` Hint: ${fontHint}.`:'')});
    if(hints.length)f.repairHints=hints;
    const moves=rule==='routeCrossings'&&Array.isArray(ev?.violations)?[...new Map(ev.violations.filter(v=>v.moveHint).map(v=>[JSON.stringify(v.moveHint),v.moveHint])).values()]:[];
    if(moves.length)f.moveHints=moves;
    return f;
  };
  for(const [rule,check] of Object.entries(audit.checks)){
    // Non-blocking minor findings travel with a PASSing (or any) check: routeLowerBend midpoint-only witnesses (decision 2, 2026-10-03).
    if(rule==='routeLowerBend'&&Array.isArray(check?.evidence?.minorFindings))for(const m of check.evidence.minorFindings)out.push(lowerBendMinorFinding(m));
    // An incomplete (but not contradicting) legend is a minor finding that travels with the PASSing legendCompleteness check: a legend is optional.
    if(rule==='labelFontFit'&&Array.isArray(check?.evidence?.minorFindings))for(const m of check.evidence.minorFindings)out.push(fontFitMinorFinding(m));
    if(rule==='legendCompleteness'&&check?.status==='PASS'&&Array.isArray(check.evidence?.minorFindings)&&check.evidence.minorFindings.length)out.push(legendMinorFinding(check.evidence));
    // A dense diagram's crossings travel with the PASSing routeCrossings check as one minor finding (never a FAIL, never waived).
    if(rule==='routeCrossings'&&check?.status==='PASS'&&check.evidence?.dense&&Array.isArray(check.evidence.minorFindings)&&check.evidence.minorFindings.length)out.push(denseCrossingMinorFinding(check.evidence));
    if(rule==='boxSizeConsistency'&&Array.isArray(check?.evidence?.advisories)&&check.evidence.advisories.length)out.push(build(rule,{method:check.evidence.method,advisories:check.evidence.advisories},'minor'));
    if(check?.status!=='FAIL')continue;
    if(!relaxed){out.push(build(rule,check.evidence,'blocking'));continue}
    // Relaxed gate: only the part of a FAIL that makes the diagram wrong or unreadable blocks; the rest is advice (see relaxed.mjs).
    const {blocking,advice}=splitAuditFail(rule,check.evidence);
    if(blocking!==null)out.push(build(rule,blocking,'blocking'));
    if(advice!==null){const f=build(rule,advice,'minor');if(!out.some(x=>x.key===f.key))out.push(f)}
  }
  return out;
}

/** The `max` most valuable open advice findings (minor, highest impact first). `total` counts all open advice. */
export function selectAdvice(ledger,{max=3}={}){
  const minors=ledger.open().filter(e=>e.finding.severity==='minor').map((e,i)=>({e,i}))
    .sort((a,b)=>(b.e.finding.impact??0)-(a.e.finding.impact??0)||a.i-b.i).map(x=>x.e.finding);
  return {sent:minors.slice(0,max).map(toAdviceItem),total:minors.length};
}
/** Compact author-facing form of one advice finding. */
export const toAdviceItem=({id,rule,elements,evidence,suggestion,impact})=>({id,rule,elements,measured:evidence?.measured??null,suggestion,impact:impact??null});
