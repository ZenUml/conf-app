import {verifyPlan} from './verify-plan.mjs';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
export function createEvidence(plan, results) {
  const ids = new Set(plan.tests.map(t => t.id));
  const executed = results.filter(r => ids.has(r.id));
  const complete = plan.tests.every(t => executed.some(r => r.id === t.id && r.status === 'passed')) && results.filter(r=>!r.setup).every(r=>ids.has(r.id)) && new Set(executed.map(r=>r.id)).size === ids.size;
  return {schema_version:1, tested_tree:plan.tested_tree, category_version:plan.category_version,policy_version:plan.policy_version,variant:plan.variant,coverage:plan.coverage,plan_fingerprint:plan.plan_fingerprint,complete,results:executed};
}
export function canReuse(evidence, plan) {
  return evidence.complete === true && ['tested_tree','category_version','policy_version','variant','plan_fingerprint'].every(k=> evidence[k]===plan[k]) && plan.tests.every(t=>evidence.results.some(r=>r.id===t.id && r.status==='passed'));
}
export default class EvidenceReporter {
  results = new Map();
  onBegin() {if (process.env.TEST_PLAN_PATH) verifyPlan(JSON.parse(fs.readFileSync(process.env.TEST_PLAN_PATH)));}
  onTestEnd(test,result) {this.results.set(test.id,{id:test.id,status:result.status,duration_ms:result.duration,retry:result.retry,setup:['auth','pages'].includes(test.parent.project().name)});}
  onEnd(result) {if (!process.env.TEST_PLAN_PATH) return; const plan=JSON.parse(fs.readFileSync(process.env.TEST_PLAN_PATH)); verifyPlan(plan); const evidence=createEvidence(plan,[...this.results.values()]); evidence.run_status=result.status; evidence.complete &&= result.status==='passed'; fs.writeFileSync(process.env.TEST_EVIDENCE_PATH ?? 'test-evidence.json',JSON.stringify(evidence,null,2));}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>x.startsWith('--')?[...a,[x.slice(2),all[i+1]]]:a,[]));
 const plan=JSON.parse(fs.readFileSync(args.plan)); const reports=args.reports.split(',').map(p=>JSON.parse(fs.readFileSync(p)));
 const evidence=createEvidence(plan,reports.flatMap(r=>r.results)); evidence.complete &&= reports.every(r=>r.run_status==='passed' && ['tested_tree','category_version','policy_version','variant','plan_fingerprint'].every(k=>r[k]===plan[k]));
 fs.writeFileSync(args.output ?? 'test-evidence.json',JSON.stringify(evidence,null,2));
}
