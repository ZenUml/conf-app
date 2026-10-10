// Escalation policy for the two-phase gate: what may ever be waived. Pure code; no model opinion decides this.
// When the last allowed diagram_build_check of a round still FAILs, the reviewer is called in DIAGNOSIS mode. Its only powers are:
//   - a WAIVER request, honoured by code only for border grazing (routePairClearance, routeContainerClearance) and for routeCrossings
//     the code itself confirmed has no repair (every crossing: repairHint null AND moveHint null);
//   - RELAYOUT advice (layout-level, sent to the author).
// Semantic failures are never waived and never reach the reviewer.

/** Checks that carry meaning (what the diagram says), plus the structural findings that make a candidate unrenderable or unauditable. */
export const SEMANTIC_RULES=['svgWellFormed','nodeIdentity','nodeText','relations','relationStyle','groups','groupMembership','originalGroupParity','semanticPreservation','sourceDefinitionConflicts'];
const STRUCTURAL_RULES=['forbidden-construct','candidate-missing','render-or-audit-failed'];

/** A FAIL that is rejected without asking the reviewer. */
export const isHardRule=rule=>SEMANTIC_RULES.includes(rule)||STRUCTURAL_RULES.includes(rule)||String(rule).startsWith('gate-');

/** The only checks a waiver can ever cover. Everything else (routeNodeIntrusion, labelClearance, arrowShaft, label-detached/ambiguous, textFit,
 *  nodeHeadingClearance, non-midpoint routeLowerBend, routeDetour, legendCompleteness, layout checks) stays a failure. */
export const WAIVABLE_RULES=['routeCrossings','routePairClearance','routeContainerClearance'];

/** routeCrossings is code-confirmed unrepairable only when the audit evidence lists violations and none carries a repairHint or a moveHint. */
export function crossingsUnrepairable(audit,finding){
  if(finding?.repairHints?.length||finding?.moveHints?.length)return false;
  const v=audit?.checks?.routeCrossings?.evidence?.violations;
  return Array.isArray(v)&&v.length>0&&v.every(x=>!x?.repairHint&&!x?.moveHint);
}

/** Why this finding can not be waived, or null when code permits a waiver request for it. */
export function whyNotWaivable(finding,audit){
  if(!WAIVABLE_RULES.includes(finding.rule))return `${finding.rule} is not waivable (only ${WAIVABLE_RULES.join(', ')} can be)`;
  if(finding.rule==='routeCrossings'&&!crossingsUnrepairable(audit,finding))return 'routeCrossings still carries a repairHint or moveHint: code found a repair, so the crossing is not waivable';
  return null;
}
export const waivableByCode=(finding,audit)=>whyNotWaivable(finding,audit)===null;

/** Checks the reviewer's waivers against the blocking script findings. Every blocking finding needs its own permitted waiver with a reason.
 *  @returns {{accepted:Array,rejected:Array}} accepted: [{finding,reason}] (finding is the finding object); rejected: [{finding:id,rule,reason}] */
export function validateWaivers(blocking,waivers,audit){
  const byId=new Map((waivers??[]).map(w=>[w.finding,w]));
  const accepted=[],rejected=[];
  for(const f of blocking){
    const w=byId.get(f.id);
    if(!w){rejected.push({finding:f.id,rule:f.rule,reason:'the reviewer gave no waiver for this finding'});continue}
    const why=whyNotWaivable(f,audit);
    if(why){rejected.push({finding:f.id,rule:f.rule,reason:why});continue}
    if(String(w.reason??'').trim().length<10){rejected.push({finding:f.id,rule:f.rule,reason:'the waiver reason is missing or too short'});continue}
    accepted.push({finding:f,reason:w.reason.trim()});
  }
  return {accepted,rejected};
}
