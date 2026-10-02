// Deterministic gate. No model opinion enters here except "the reviewer ran and left no open blocking finding".
const OK_SEMANTICS=['PASS','ADJUDICATED'];
const IDENTITY_CHECKS=['nodeIdentity','nodeText','relations','relationStyle'];

/** The auditor leaves originalGroupParity/semanticPreservation NOT-CHECKABLE for a source without groups (no membership to compare).
 *  For such a source the identity checks are the whole semantic claim; with groups, only PASS or ADJUDICATED counts. */
function semanticsEstablished(audit,sourceGroupCount){
  const s=audit.checks.semanticPreservation?.status;
  if(OK_SEMANTICS.includes(s))return true;
  return s==='NOT-CHECKABLE'&&sourceGroupCount===0&&IDENTITY_CHECKS.every(k=>audit.checks[k]?.status==='PASS');
}

/** Conditions on the audit and the SVG itself (everything except review results and hash identity). A FAIL check is reported as a finding, not here. */
export function auditGateReasons({audit,forbidden,sourceGroupCount}){
  const reasons=[];
  if(!audit||!audit.checks)reasons.push({code:'AUDIT_MISSING',detail:'no audit result for the final bytes'});
  else{
    const failed=Object.entries(audit.checks).filter(([,c])=>c?.status==='FAIL').map(([k])=>k);
    if(failed.length)reasons.push({code:'AUDIT_FAIL',detail:failed.join(', ')});
    else if(!semanticsEstablished(audit,sourceGroupCount))reasons.push({code:'SEMANTICS_NOT_ESTABLISHED',detail:`semanticPreservation is ${audit.checks.semanticPreservation?.status??'absent'}; it must be PASS or ADJUDICATED`});
  }
  if(forbidden?.length)reasons.push({code:'FORBIDDEN_CONSTRUCT',detail:forbidden.map(h=>h.construct).join(', ')});
  return reasons;
}

export function evaluateGate({reviewedHash,finalHash,renderedHash,audit,forbidden,review,openBlocking,sourceGroupCount}){
  const reasons=[];
  if(!reviewedHash||reviewedHash!==finalHash||finalHash!==renderedHash)reasons.push({code:'HASH_MISMATCH',detail:`reviewed ${reviewedHash} / final ${finalHash} / rendered ${renderedHash}`});
  reasons.push(...auditGateReasons({audit,forbidden,sourceGroupCount}));
  if(!review||review.ok!==true)reasons.push({code:'REVIEW_MISSING',detail:review?.error??'the reviewer did not return a valid result'});
  if(openBlocking>0)reasons.push({code:'OPEN_BLOCKING',detail:`${openBlocking} open blocking finding(s)`});
  return {pass:reasons.length===0,reasons};
}
