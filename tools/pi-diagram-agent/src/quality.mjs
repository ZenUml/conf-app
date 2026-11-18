import {AGENT_DONE_REASONS,STRUCTURAL_NOT_CHECKABLE} from '../bench/bench-lib.mjs';
export function classifyQuality(run){
 const audit=run?.audit;
 const reviewed=!!(AGENT_DONE_REASONS.includes(run?.doneReason)&&!run?.agentError&&!run?.rateLimited&&audit&&!audit.error&&['PASS','NOT-CHECKABLE'].includes(audit.status)&&Array.isArray(audit.fail)&&audit.fail.length===0&&!run.auditGateMismatch&&run.finalSvgInspected===true&&/^[a-f0-9]{64}$/.test(run.finalSvgSha256??'')&&run.finalSvgSha256===run.v2?.finalSvgSha256&&run.v2?.gateStatus==='REVIEWED');
 return {status:reviewed?'REVIEWED_CANDIDATE':'INCOMPLETE',accepted:false,certified:false,finalSvgSha256:run?.finalSvgSha256??null,reviewedSvgSha256:run?.v2?.finalSvgSha256??null,finalSvgInspected:run?.finalSvgInspected===true,audit:audit??null,gate:run?.v2?.gateStatus??null,reason:run?.doneReason??'NO_RUN',notCheckable:[...new Set([...STRUCTURAL_NOT_CHECKABLE,...(audit?.notCheckable??[])])],limitations:'Review is evidence of a candidate, not certification or human acceptance. Inspect audit evidence, advisory findings and comparison before use.'};
}
