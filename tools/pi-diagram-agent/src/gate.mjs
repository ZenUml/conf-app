// Deterministic gate. No model opinion enters here except "the reviewer ran and left no open blocking finding".
// Semantics: PASS or ADJUDICATED only. A group-less source gets its PASS from the auditor (no groups declared and no clusters rendered), not from a gate exception.
const OK_SEMANTICS=['PASS','ADJUDICATED'];
/** Conditions on the audit and the SVG itself (everything except review results and hash identity). A FAIL check is reported as a finding, not here. */
export function auditGateReasons({audit,forbidden,waived=[]}){
  const reasons=[];
  if(!audit||!audit.checks)reasons.push({code:'AUDIT_MISSING',detail:'no audit result for the final bytes'});
  else{
    const failed=Object.entries(audit.checks).filter(([k,c])=>c?.status==='FAIL'&&!waived.includes(k)).map(([k])=>k); // waived: a validated escalation waiver (REVIEWED_WITH_EXCEPTIONS) for exactly these checks
    if(failed.length)reasons.push({code:'AUDIT_FAIL',detail:failed.join(', ')});
    else if(!OK_SEMANTICS.includes(audit.checks.semanticPreservation?.status))reasons.push({code:'SEMANTICS_NOT_ESTABLISHED',detail:`semanticPreservation is ${audit.checks.semanticPreservation?.status??'absent'}; it must be PASS or ADJUDICATED`});
  }
  if(forbidden?.length)reasons.push({code:'FORBIDDEN_CONSTRUCT',detail:forbidden.map(h=>h.construct).join(', ')});
  return reasons;
}

export function evaluateGate({reviewedHash,finalHash,renderedHash,audit,forbidden,review,openBlocking,waived=[]}){
  const reasons=[];
  if(!reviewedHash||reviewedHash!==finalHash||finalHash!==renderedHash)reasons.push({code:'HASH_MISMATCH',detail:`reviewed ${reviewedHash} / final ${finalHash} / rendered ${renderedHash}`});
  reasons.push(...auditGateReasons({audit,forbidden,waived}));
  if(!review||review.ok!==true)reasons.push({code:'REVIEW_MISSING',detail:review?.error??'the reviewer did not return a valid result'});
  if(openBlocking>0)reasons.push({code:'OPEN_BLOCKING',detail:`${openBlocking} open blocking finding(s)`});
  return {pass:reasons.length===0,reasons};
}
