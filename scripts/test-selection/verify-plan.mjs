import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export function verifyPlan(plan, cwd = process.cwd()) {
  const {plan_fingerprint, ...body} = plan;
  const actual = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if (!plan_fingerprint || actual !== plan_fingerprint) throw new Error('Invalid test plan fingerprint');
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {cwd, encoding:'utf8'}).trim();
  if (tree !== plan.tested_tree) throw new Error('Test plan does not match checkout tree');
  try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], {cwd, stdio:'ignore'}); }
  catch { throw new Error('Tracked checkout modifications invalidate test plan'); }
  return true;
}
