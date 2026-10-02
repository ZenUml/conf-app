import {verifyPlan} from './verify-plan.mjs';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const IDENTITY_FIELDS = ['tested_tree','category_version','policy_version','variant','plan_fingerprint'];
export function createEvidence(plan, results) {
  const ids = new Set(plan.tests.map(t => t.id));
  const executed = results.filter(r => ids.has(r.id));
  const errors = [];
  if (plan.tests.some(t => !executed.some(r => r.id === t.id))) errors.push('missing-test-results');
  if (results.filter(r => !r.setup).some(r => !ids.has(r.id))) errors.push('unexpected-test-results');
  if (new Set(executed.map(r => r.id)).size !== executed.length) errors.push('duplicate-test-results');
  if (executed.some(r => !['passed','skipped','failed','timedOut','interrupted'].includes(r.status))) errors.push('invalid-test-status');
  const valid = errors.length === 0;
  const execution_succeeded = valid && executed.every(r => ['passed','skipped'].includes(r.status));
  const complete = valid && executed.every(r => r.status === 'passed');
  return {schema_version:1, tested_tree:plan.tested_tree, category_version:plan.category_version,policy_version:plan.policy_version,variant:plan.variant,coverage:plan.coverage,plan_fingerprint:plan.plan_fingerprint,complete,execution_succeeded,validation:{valid,errors},results:results.filter(r => !r.setup)};
}
export function aggregateEvidence(plan, reports) {
  const evidence = createEvidence(plan, reports.flatMap(r => r.results ?? []));
  const errors = [...evidence.validation.errors];
  if (reports.some(r => r.schema_version !== 1 || IDENTITY_FIELDS.some(k => r[k] !== plan[k]))) errors.push('mismatched-report-identity');
  if (reports.some(r => r.run_status !== 'passed')) errors.push('unsuccessful-execution');
  const shardIndexes = reports.map(r => r.shard_index);
  if (new Set(shardIndexes).size !== shardIndexes.length || plan.shards.some(s => !shardIndexes.includes(s.index))) errors.push('missing-or-duplicate-shard');
  if (reports.some(r => {
    const shard = plan.shards.find(s => s.index === r.shard_index);
    return !shard || (r.results ?? []).some(t => !shard.test_ids.includes(t.id)) || shard.test_ids.some(id => !(r.results ?? []).some(t => t.id === id));
  })) errors.push('invalid-shard-coverage');
  evidence.validation = {valid:errors.length === 0, errors};
  evidence.execution_succeeded &&= evidence.validation.valid;
  evidence.complete &&= evidence.validation.valid;
  return evidence;
}
export function canReuse(evidence, plan) {
  return evidence.complete === true && evidence.validation?.valid === true && IDENTITY_FIELDS.every(k=> evidence[k]===plan[k]) && plan.tests.every(t=>evidence.results.some(r=>r.id===t.id && r.status==='passed'));
}
export default class EvidenceReporter {
  results = new Map();
  onBegin() {if (process.env.TEST_PLAN_PATH) verifyPlan(JSON.parse(fs.readFileSync(process.env.TEST_PLAN_PATH)));}
  onTestEnd(test,result) {this.results.set(test.id,{id:test.id,status:result.status,duration_ms:result.duration,retry:result.retry,setup:['auth','pages'].includes(test.parent.project().name)});}
  onEnd(result) {
    if (!process.env.TEST_PLAN_PATH) return;
    const plan=JSON.parse(fs.readFileSync(process.env.TEST_PLAN_PATH)); verifyPlan(plan);
    const evidence=createEvidence(plan,[...this.results.values()]);
    evidence.run_status=result.status;
    evidence.shard_index=Number(process.env.TEST_SHARD);
    evidence.complete &&= result.status==='passed';
    evidence.execution_succeeded &&= result.status==='passed';
    fs.writeFileSync(process.env.TEST_EVIDENCE_PATH ?? 'test-evidence.json',JSON.stringify(evidence,null,2));
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>x.startsWith('--')?[...a,[x.slice(2),all[i+1]]]:a,[]));
 const plan=JSON.parse(fs.readFileSync(args.plan)); const reports=args.reports.split(',').map(p=>JSON.parse(fs.readFileSync(p)));
 fs.writeFileSync(args.output ?? 'test-evidence.json',JSON.stringify(aggregateEvidence(plan,reports),null,2));
}
