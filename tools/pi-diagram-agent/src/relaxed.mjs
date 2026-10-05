// Relaxed gate: only defects that make the diagram WRONG or unreadable block; every geometry or style nicety is advice (severity minor + impact score).
// This module is the single source of truth for the blocking set. Pure code: no model, no IO.

export const gateModeFromEnv=(env=process.env)=>String(env.PI_DIAGRAM_GATE??'').trim().toLowerCase()==='strict'?'strict':'relaxed';

/** Audit checks whose FAIL always blocks: what the diagram says (bindings, identity, relations, groups, shapes), a missing or invisible arrowhead, and a label covering another route. */
export const BLOCKING_AUDIT_RULES=['svgWellFormed','nodeIdentity','nodeText','nodeShape','relations','relationStyle','groups','groupMembership','originalGroupParity','semanticPreservation','sourceDefinitionConflicts','markerDrawing','labelCoversRoute','arrowEndStartClearance','routeBoundaryCoincidence','siblingGroupOverlap'];
/** Audit checks that block only for the part of their evidence that is a real defect (see PARTIAL below); the rest of that evidence becomes advice. */
export const PARTIAL_AUDIT_RULES=['textFit','labelClearance','nodeHeadingClearance','routeNodeIntrusion'];
/** Findings that are blocking as constructed (not audit checks): structural failures, forbidden constructs, gate conditions, and label-ambiguous (decided where it is built: blocking only when the label sits on another route). */
export const STRUCTURAL_RULES=['candidate-missing','render-or-audit-failed','forbidden-construct','label-ambiguous','relayout'];
/** Reviewer rules that stay blocking. Every other reviewer rule is advice. */
export const REVIEW_BLOCKING_RULES=['shape-change','label-ownership','text-overflow','boundary-coincidence','group-overlap'];

/** Advice ranking: how much fixing it improves the picture (0..1). Higher goes to the author first. Unlisted rules get DEFAULT_IMPACT. */
export const ADVICE_IMPACT=Object.freeze({
  routeEarlyMerge:0.65,'early-merge':0.65,boxSizeConsistency:0.4,'box-size-consistency':0.4,routeCrossings:0.7,'route-crossing':0.7,routeDetour:0.6,detour:0.6,labelFontFit:0.6,textContrast:0.5,balance:0.5,
  'label-detached':0.5,'label-ambiguous':0.55,routeNodeIntrusion:0.5,'route-node-intrusion':0.5,textFit:0.45,
  labelClearance:0.4,'label-clearance':0.4,nodeHeadingClearance:0.4,'node-heading-clearance':0.4,routeHeadingClearance:0.4,routeUnrelatedContainerTransit:0.4,
  routePairClearance:0.35,edgeLabelStyle:0.35,routeContainerClearance:0.3,'route-border-clearance':0.3,arrowShaft:0.3,other:0.3,
  routeLowerBend:0.2,routeCornerAnchor:0.15,connectorStrokeWidth:0.15,filletUniformity:0.15,markerUniformity:0.15,labelFontWeight:0.1,legendCompleteness:0.1,legend:0.1,
});
export const DEFAULT_IMPACT=0.25;
export const impactOf=rule=>ADVICE_IMPACT[rule]??DEFAULT_IMPACT;

/** Is a FAIL of this audit check (or a finding of this rule) blocking at all, in whole or in part? */
export const isBlockingRule=rule=>BLOCKING_AUDIT_RULES.includes(rule)||PARTIAL_AUDIT_RULES.includes(rule)||STRUCTURAL_RULES.includes(rule)||String(rule).startsWith('gate-');

const num=v=>typeof v==='number'&&Number.isFinite(v);
const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const rest=(ev,patch)=>({...ev,...patch});
// Each splitter returns {blocking, advice}: the evidence subsets to report as a blocking finding and as an advice finding (null when empty).
// Unknown or incomplete evidence fails closed: it stays blocking.
const nonEmpty=(ev,keys)=>keys.some(k=>Array.isArray(ev[k])&&ev[k].length);
const result=(ev,keys,blockingParts,adviceParts)=>({
  blocking:nonEmpty(blockingParts,keys)?rest(ev,{...Object.fromEntries(keys.map(k=>[k,blockingParts[k]??[]]))}):null,
  advice:nonEmpty(adviceParts,keys)?rest(ev,{...Object.fromEntries(keys.map(k=>[k,adviceParts[k]??[]]))}):null,
});
const OUTLINE_MARGIN=8; // textFit measures against the outline inset by 8: text further than 8 units outside that inset box is outside the shape itself

const PARTIAL={
  /** Glyphs outside their shape block (more than the 8-unit inset beyond the measured box, or touching a drawn stroke). Text still inside the shape and label-box-only issues are advice. */
  textFit(ev){
    if(!isObj(ev))return {blocking:ev,advice:null};
    const over=Array.isArray(ev.overflows)?ev.overflows:[],struct=Array.isArray(ev.structureOverlaps)?ev.structureOverlaps:[];
    const inset=num(ev.inset)?ev.inset:OUTLINE_MARGIN;
    const worst=o=>Math.max(...['left','top','right','bottom'].map(k=>num(o?.[k])?o[k]:0));
    const knownOver=o=>['left','top','right','bottom'].some(k=>num(o?.[k]));
    const beyond=o=>!knownOver(o)||worst(o)>inset;
    const touching=s=>!num(s?.gap)||s.gap<=0;
    if(!over.length&&!struct.length)return {blocking:ev,advice:null};
    return result(ev,['overflows','structureOverlaps'],{overflows:over.filter(beyond),structureOverlaps:struct.filter(touching)},{overflows:over.filter(o=>!beyond(o)),structureOverlaps:struct.filter(s=>!touching(s))});
  },
  /** A label box that covers a node's text blocks. A label touching only an outline (node or container) is advice. */
  labelClearance(ev){
    if(!isObj(ev)||!Array.isArray(ev.violations)||!ev.violations.length)return {blocking:ev,advice:null};
    const covers=v=>String(v?.outline??'').startsWith('node:')&&v.coversNodeText!==false;
    return result(ev,['violations'],{violations:ev.violations.filter(covers)},{violations:ev.violations.filter(v=>!covers(v))});
  },
  /** A node outline overlapping heading text (gap 0) blocks. The 8-unit heading and container-border margins are advice. */
  nodeHeadingClearance(ev){
    if(!isObj(ev)||!Array.isArray(ev.violations)||!ev.violations.length)return {blocking:ev,advice:null};
    const overlap=v=>v?.kind==='heading'&&(!num(v.gap)||v.gap<=0);
    return result(ev,['violations'],{violations:ev.violations.filter(overlap)},{violations:ev.violations.filter(v=>!overlap(v))});
  },
  /** A route through another node's text blocks. A route over a node's fill only, or an end that misses its own node, is advice. */
  routeNodeIntrusion(ev){
    if(!isObj(ev))return {blocking:ev,advice:null};
    if(!Array.isArray(ev.textIntrusions))return {blocking:ev,advice:null};
    const through=new Set(ev.textIntrusions.map(x=>x.edge));
    const intr=Array.isArray(ev.intrusions)?ev.intrusions:[],ends=Array.isArray(ev.endpointErrors)?ev.endpointErrors:[];
    const blockingIntr=intr.filter(x=>through.has(x.edge));
    return {
      blocking:blockingIntr.length?rest(ev,{intrusions:blockingIntr,endpointErrors:[]}):null,
      advice:(intr.length>blockingIntr.length||ends.length)?rest(ev,{intrusions:intr.filter(x=>!through.has(x.edge)),textIntrusions:[]}):null,
    };
  },
};

/** Split an audit FAIL into its blocking and advice evidence. Rules outside the partial table are all-blocking or all-advice. */
export function splitAuditFail(rule,evidence){
  if(PARTIAL[rule])return PARTIAL[rule](evidence);
  return BLOCKING_AUDIT_RULES.includes(rule)?{blocking:evidence,advice:null}:{blocking:null,advice:evidence};
}

/** True when a FAIL of this audit check has at least one blocking part (the relaxed gate counts only these). */
export const auditFailBlocks=(rule,check)=>splitAuditFail(rule,check?.evidence).blocking!==null;

const adviceOf=(f,extra={})=>({...f,severity:'minor',impact:f.impact??impactOf(f.rule),...extra});

/** Post-pass over one candidate's findings in relaxed mode. Idempotent.
 *  - review findings: blocking only for REVIEW_BLOCKING_RULES;
 *  - audit/early findings: blocking only for isBlockingRule (the audit builder has already split partial rules);
 *  - every minor finding gets an impact score. */
export function relaxFindings(findings){
  return findings.map(f=>{
    if(f.severity!=='blocking')return f.impact===undefined?adviceOf(f):f;
    const keeps=f.source==='review'?REVIEW_BLOCKING_RULES.includes(f.rule)||f.rule==='relayout':isBlockingRule(f.rule);
    return keeps?f:adviceOf(f,{relaxedFrom:'blocking'});
  });
}
