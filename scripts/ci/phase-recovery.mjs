import { execFileSync } from 'node:child_process';

const phaseWorkflows = {
  'Build preparation': 'main-build-preparation.yml',
  'Staging validation': 'main-staging-validation.yml',
};
const draftPhase = { name: 'Draft preparation', workflow: 'main-draft-preparation.yml' };
const draftGate = 'Draft gate outcome';
const unverified = 'Unverified phase failure';
const variants = 'Lite|Full|Diagramly|AsyncAPI';

const isFailed = job => ['failure', 'timed_out'].includes(job.conclusion);

// The jobs of the one completed, first-attempt child run a root dispatched for `name`;
// null when that run is missing, ambiguous, still running or was rerun on its own.
function phaseJobs(name, workflow, root, api) {
  const title = `${name} · parent ${root.id} · attempt ${root.run_attempt} · source ${root.head_sha}`;
  const matches = api(`actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100`).workflow_runs
    .filter(run => run.display_title === title);
  if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].run_attempt !== 1) return null;
  return api(`actions/runs/${matches[0].id}/attempts/1/jobs?per_page=100`).jobs;
}

function expandPhase(name, root, api) {
  const jobs = phaseJobs(name, phaseWorkflows[name], root, api);
  const failed = jobs ? jobs.filter(isFailed).map(job => job.name) : [];
  return failed.length ? failed : [unverified];
}

// Variants whose E2E validation failed, read from the expanded failure names: a job
// of the variant's called `Validate: <Variant>` lane (`Validate: Full / regression /
// shard 2/4`), or the `E2E auth: <Variant>` bootstrap that stops it from starting.
// Lower case, to compare with a draft job's variant.
export function failedValidationVariants(names) {
  return new Set(names.flatMap(name => {
    const match = name.match(new RegExp(`^(?:Validate: (${variants})(?: / .+)?|E2E auth: (${variants}) / auth bootstrap)$`));
    return match ? [(match[1] || match[2]).toLowerCase()] : [];
  }));
}

// Draft preparation fails whenever its child's "Draft gate outcome" does, and that job
// fails on ANY draft job that is not green, skipped ones included. A variant whose
// staging validation failed has its draft skipped by design, so for that variant the
// skip and the gate failure only repeat the E2E failure that is already on the list.
// What recovery must still refuse is everything else the draft child can show: a draft
// that really failed, root ownership or draft eligibility that failed, a cancelled job,
// and a draft skipped although its variant validated (a closed daily regression gate, a
// failed build or migration). Those come back as their own names, none of them E2E.
export function expandDraftFailures(jobs, failedVariants, log = () => {}) {
  if (!jobs) return [unverified];
  const blockers = new Set();
  const skippedForE2e = [];
  for (const job of jobs) {
    if (job.conclusion === 'success' || (job.name === draftGate && isFailed(job))) continue;
    const draft = job.name.match(new RegExp(`^Draft: (${variants})$`));
    if (isFailed(job)) blockers.add(job.name);
    else if (job.conclusion === 'skipped' && draft && failedVariants.has(draft[1].toLowerCase())) skippedForE2e.push(job.name);
    else if (job.conclusion === 'skipped' && draft) blockers.add(`${job.name} (skipped although its validation did not fail)`);
    else blockers.add(unverified);
  }
  const gateFailed = jobs.some(job => job.name === draftGate && isFailed(job));
  if (blockers.size) return [...blockers];
  if (!gateFailed || !skippedForE2e.length) return [unverified];
  log(`${draftPhase.name}: ${skippedForE2e.join(', ')} skipped because the E2E validation of ${[...failedVariants].join(', ')} failed; "${draftGate}" only repeats that, so it is not a separate failure`);
  return [];
}

export function expandPhaseFailures(failures, root, api, log = () => {}) {
  const expanded = new Map();
  for (const name of failures) {
    if (name !== draftPhase.name && !expanded.has(name)) expanded.set(name, phaseWorkflows[name] ? expandPhase(name, root, api) : [name]);
  }
  // The draft verdict depends on which validations failed, so it is read last.
  if (failures.includes(draftPhase.name)) {
    const jobs = phaseJobs(draftPhase.name, draftPhase.workflow, root, api);
    expanded.set(draftPhase.name, expandDraftFailures(jobs, failedValidationVariants([...expanded.values()].flat()), log));
  }
  return failures.flatMap(name => expanded.get(name));
}

// One graph: the phases are called workflows of the root, so a phase job is a root
// job named "<Phase> / <job>". Strip the prefix and apply the same rules as above to
// the root's own jobs; no child run is looked up.
const phasePrefix = new RegExp(`^(${[...Object.keys(phaseWorkflows), draftPhase.name].join('|')}) / (.+)$`);

export function isOneGraph(jobs) {
  return jobs.some(job => phasePrefix.test(job.name));
}

export function expandRootJobs(jobs, log = () => {}) {
  const inPhase = phase => jobs.flatMap(job => {
    const match = job.name.match(phasePrefix);
    return match && match[1] === phase ? [{ ...job, name: match[2] }] : [];
  });
  const draftJobs = inPhase(draftPhase.name);
  const validationFailures = Object.keys(phaseWorkflows).flatMap(phase => inPhase(phase).filter(isFailed).map(job => job.name));
  const result = [];
  let draftDone = false;
  for (const job of jobs.filter(isFailed)) {
    const match = job.name.match(phasePrefix);
    if (!match) result.push(job.name);
    else if (match[1] !== draftPhase.name) result.push(match[2]);
    else if (!draftDone) {
      draftDone = true;
      result.push(...expandDraftFailures(draftJobs, failedValidationVariants(validationFailures), log));
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  // A 100-run listing exceeds Node's default 1 MiB maxBuffer; see wait-for-e2e.mjs.
  const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/${path}`], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }));
  const log = message => console.error(message);
  // All pages: a one-graph root has more than 100 jobs. `filter=latest` (the default)
  // gives the jobs of the run's latest attempt.
  const pages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.RUN_ID}/jobs?per_page=100`],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }));
  const rootJobs = Array.isArray(pages) ? pages.flatMap(page => page.jobs ?? []) : (pages.jobs ?? []);
  // stdout is the machine-readable list; the explanation goes to the step log.
  if (isOneGraph(rootJobs)) console.log(JSON.stringify(expandRootJobs(rootJobs, log)));
  else {
    // A root started before the one-graph change still dispatched child runs.
    const root = api(`actions/runs/${process.env.RUN_ID}`);
    console.log(JSON.stringify(expandPhaseFailures(JSON.parse(process.env.FAILED), root, api, log)));
  }
}
