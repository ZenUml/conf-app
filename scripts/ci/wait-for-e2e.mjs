import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

export function dispatchBody(env) {
  const inputs = {
    'parent-run-id': env.GITHUB_RUN_ID,
    'parent-attempt': env.GITHUB_RUN_ATTEMPT,
    'source-sha': env.SOURCE_SHA,
  };
  if (env.CHILD_KIND === 'phase') {
    inputs.version = env.VERSION;
    if (env.ARTIFACT_RUN_ID) inputs['artifact-run-id'] = env.ARTIFACT_RUN_ID;
    if (env.STAGING_RUN_ID) inputs['staging-run-id'] = env.STAGING_RUN_ID;
  } else {
    inputs.grep = env.GREP || '';
    if (env.CHILD_KIND === 'pr') inputs.mode = env.MODE;
    else {
      inputs.suite = env.SUITE || 'insert';
      inputs.timeout = env.TEST_TIMEOUT || '11';
      if (env.ROOT_RUN_ID) {
        inputs['root-run-id'] = env.ROOT_RUN_ID;
        inputs['root-attempt'] = env.ROOT_ATTEMPT;
      }
    }
  }
  return { ref: env.DISPATCH_REF || env.GITHUB_REF_NAME, inputs };
}

export function findChild(runs, title) {
  // The title includes the tested SHA. The dispatch branch can advance while
  // queued; checkout in the child uses source-sha, not its workflow head SHA.
  return runs.find(run => run.display_title === title);
}

export function verifyChildRun(actor, attempt) {
  if (actor !== 'github-actions[bot]' || String(attempt) !== '1') {
    throw new Error('Child workflows must be dispatched once by their parent; rerun the root workflow');
  }
}

export function verifyParent(parent, attempt, jobs, expectedJobs, provenance = {}) {
  const dispatcherRunning = jobs.some(job => expectedJobs.includes(job.name) && job.status === 'in_progress');
  if (!['in_progress', 'pending'].includes(parent.status) || !dispatcherRunning || String(parent.run_attempt) !== attempt ||
      !['.github/workflows/build-test-deploy.yml', '.github/workflows/pr-validation.yml', '.github/workflows/main-staging-validation.yml'].includes(parent.path)) {
    throw new Error('Child E2E requires an active staging parent for this attempt');
  }
  if (parent.path === '.github/workflows/main-staging-validation.yml') {
    if (!provenance.root) throw new Error('Staging phase requires root provenance');
    verifyParent(provenance.root, provenance.rootAttempt, provenance.rootJobs, ['Staging validation']);
    const title = `Staging validation · parent ${provenance.rootId} · attempt ${provenance.rootAttempt} · source ${provenance.sourceSha}`;
    if (provenance.root.path !== '.github/workflows/build-test-deploy.yml' ||
        provenance.root.head_sha !== provenance.sourceSha || parent.display_title !== title) {
      throw new Error('Staging phase source does not match its root');
    }
  } else if (parent.path === '.github/workflows/build-test-deploy.yml' && provenance.sourceSha && parent.head_sha !== provenance.sourceSha) {
    throw new Error('Phase source does not match its root');
  }
}

export async function closeChild(api, title, workflow, pause, deadline = Date.now() + 8 * 60000, expected = false) {
  // Look up again even if the dispatch step was interrupted before it saw the ID.
  let child;
  const discoveryDeadline = Math.min(deadline, Date.now() + 60000);
  do {
    try {
      child = findChild(api(`actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100`).workflow_runs, title);
    } catch (error) { console.error(`Retrying child discovery: ${error.message}`); }
    if (!child) await pause();
  } while (!child && Date.now() < discoveryDeadline);
  if (!child) {
    if (expected) throw new Error(`Dispatched child not found during cleanup: ${title}`);
    return;
  }
  if (child.status === 'completed') return;
  let cancellationRequested = false;
  while (Date.now() < deadline) {
    if (!cancellationRequested) {
      try {
        api(`actions/runs/${child.id}/cancel`, ['--method', 'POST']);
        cancellationRequested = true;
      } catch (error) { console.error(`Retrying child cancellation: ${error.message}`); }
    }
    await pause();
    try { child = api(`actions/runs/${child.id}`); }
    catch (error) { console.error(`Retrying child status: ${error.message}`); continue; }
    if (child.status === 'completed') return;
  }
  throw new Error(`Child E2E has not stopped: ${child.html_url}`);
}

async function main() {
  const env = process.env;
  const repo = `repos/${env.GITHUB_REPOSITORY}`;
  const workflow = env.CHILD_WORKFLOW;
  const title = `${env.CHILD_TITLE} · parent ${env.GITHUB_RUN_ID} · attempt ${env.GITHUB_RUN_ATTEMPT} · source ${env.SOURCE_SHA}`;
  const api = (path, args = [], input) => {
    const output = execFileSync('gh', ['api', `${repo}/${path}`, ...args], {
      encoding: 'utf8', input, timeout: 30000,
    });
    return output.trim() ? JSON.parse(output) : null;
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, 5000));
  const dispatchMarker = `${env.RUNNER_TEMP || '/tmp'}/e2e-dispatched-${workflow}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  if (process.argv.includes('--verify-parent')) {
    verifyChildRun(env.GITHUB_ACTOR, env.GITHUB_RUN_ATTEMPT);
    const parent = api(`actions/runs/${env.PARENT_RUN_ID}`);
    const jobs = api(`actions/runs/${env.PARENT_RUN_ID}/attempts/${env.PARENT_ATTEMPT}/jobs?per_page=100`).jobs;
    const provenance = { sourceSha: env.SOURCE_SHA };
    if (env.ROOT_RUN_ID) {
      Object.assign(provenance, {
        rootId: env.ROOT_RUN_ID, rootAttempt: env.ROOT_ATTEMPT,
        root: api(`actions/runs/${env.ROOT_RUN_ID}`),
        rootJobs: api(`actions/runs/${env.ROOT_RUN_ID}/attempts/${env.ROOT_ATTEMPT}/jobs?per_page=100`).jobs,
      });
    }
    verifyParent(parent, env.PARENT_ATTEMPT, jobs, JSON.parse(env.EXPECTED_PARENT_JOBS), provenance);
    return;
  }
  if (process.argv.includes('--cleanup')) {
    await closeChild(api, title, workflow, pause, undefined, existsSync(dispatchMarker));
    return;
  }
  let child;
  let interrupted = false;
  const cancelChild = () => {
    if (child && child.status !== 'completed') {
      api(`actions/runs/${child.id}/cancel`, ['--method', 'POST']);
    }
  };
  const onSignal = () => { interrupted = true; };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    api(`actions/workflows/${workflow}/dispatches`, ['--method', 'POST', '--input', '-'], JSON.stringify(dispatchBody(env)));
    writeFileSync(dispatchMarker, title);
    const createdDeadline = Date.now() + 120000;
    while (!child && Date.now() < createdDeadline) {
      const result = api(`actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100`);
      child = findChild(result.workflow_runs, title);
      if (!child) await pause();
    }
    if (!child) throw new Error(`No matching child run created: ${title}`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `run-id=${child.id}\n`);
    if (interrupted) throw new Error('Parent cancelled');
    const url = child.html_url;
    console.log(`Child workflow run: ${url}`);
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### [${env.CHILD_TITLE} details](${url})\n\n`);
    const waitMinutes = Number(env.WAIT_MINUTES || 30);
    if (!Number.isFinite(waitMinutes) || waitMinutes < 1 || waitMinutes > 60) throw new Error('Invalid child wait limit');
    const finishDeadline = Date.now() + waitMinutes * 60000;
    while (child.status !== 'completed' && !interrupted && Date.now() < finishDeadline) {
      await pause();
      child = api(`actions/runs/${child.id}`);
    }
    appendFileSync(env.GITHUB_STEP_SUMMARY, `Result: **${child.conclusion || child.status}**\n`);
    if (child.status !== 'completed') {
      throw new Error(interrupted ? 'Parent cancelled' : `Child workflow exceeded the ${waitMinutes}-minute wait limit`);
    }
    if (child.run_attempt !== undefined && child.run_attempt !== 1) throw new Error('Child workflow was rerun outside its parent');
    if (child.conclusion !== 'success') throw new Error(`Child E2E ${child.conclusion}: ${url}`);
  } catch (error) {
    try { cancelChild(); } catch (cancelError) { console.error(`Child cancellation failed: ${cancelError.message}`); }
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
