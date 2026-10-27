import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const E2E_STAGES = ['e2e-auth-lite', 'preview-e2e', 'export-e2e', 'pr-e2e-validation'];
const RUN_PRECONDITIONS = ['gate', 'build', 'staging-lite'];

// `controller` is 'present' | 'absent' | 'unknown', measured on the default branch.
// Bootstrap is the single state where the trusted controller does not exist yet,
// so no decision can be authorized: every browser E2E stage must have stayed
// skipped, and everything that does not need the controller must have succeeded.
export function evaluateOutcome(results, controller) {
  const failed = Object.values(results).some(value => ['failure', 'cancelled'].includes(value.result));
  const complete = ['select', 'pr-e2e-validation', 'preview-e2e', 'export-e2e'].every(job => results[job]?.result === 'success');
  if (!failed && complete) return { pass: true, bootstrap: false };
  const bootstrap = controller === 'absent'
    && results.select?.result === 'failure'
    && RUN_PRECONDITIONS.every(job => results[job]?.result === 'success')
    && E2E_STAGES.every(job => results[job]?.result === 'skipped');
  return { pass: bootstrap, bootstrap };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = JSON.parse(process.env.RESULTS);
  const { pass, bootstrap } = evaluateOutcome(results, process.env.CONTROLLER_STATE);
  const rows = Object.entries(results).map(([job, value]) => `| ${job} | ${value.result} |`);
  const note = bootstrap
    ? '**BOOTSTRAP: the trusted E2E controller is not on the default branch yet. No browser E2E was authorized or run; this green result covers build, unit tests and the staging deploy only.**'
    : `E2E selection: **${process.env.MODE || 'not resolved'}**. Open **E2E validation** for the child run link and shard details.`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Pipeline outcome\n\n${note}\n\n| Stage | Result |\n|---|---|\n${rows.join('\n')}\n`);
  if (bootstrap) console.log('::warning title=Bootstrap::Trusted E2E controller absent on the default branch; browser E2E was not run.');
  if (!pass) process.exitCode = 1;
}
