import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync, existsSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';

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
  if (!['in_progress', 'pending', 'queued'].includes(parent.status) || !dispatcherRunning || String(parent.run_attempt) !== attempt ||
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

export function rootOptions(env) {
  const manual = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const options = { root_run_id: env.GITHUB_RUN_ID, root_attempt: env.GITHUB_RUN_ATTEMPT,
    source_sha: env.GITHUB_SHA, root_event: env.GITHUB_EVENT_NAME,
    full_tests: manual && env.FULL_TESTS === 'true',
    bypass_regression_gate: manual && env.BYPASS_REGRESSION_GATE === 'true',
    bypass_reason: manual ? (env.BYPASS_REASON || '').trim() : '' };
  if (options.bypass_regression_gate && !options.bypass_reason) throw new Error('Daily regression bypass requires a reason');
  return options;
}

export function verifyRootOptions(options, root, id, attempt, sha) {
  if (root.path !== '.github/workflows/build-test-deploy.yml' || String(root.id) !== String(id) ||
      String(root.run_attempt) !== String(attempt) || root.head_sha !== sha ||
      String(options.root_run_id) !== String(id) || String(options.root_attempt) !== String(attempt) ||
      options.source_sha !== sha || options.root_event !== root.event ||
      typeof options.full_tests !== 'boolean' || typeof options.bypass_regression_gate !== 'boolean' ||
      typeof options.bypass_reason !== 'string' ||
      (root.event !== 'workflow_dispatch' && (options.full_tests || options.bypass_regression_gate || options.bypass_reason)) ||
      (options.bypass_regression_gate && !options.bypass_reason.trim())) {
    throw new Error('Root options do not match the verified root source and attempt');
  }
  return options;
}

export function verifyDailyGate(gate, producer, rootId, attempt, source, producerId) {
  const title = `Draft preparation · parent ${rootId} · attempt ${attempt} · source ${source}`;
  if (String(producer.id) !== String(producerId) || producer.path !== '.github/workflows/main-draft-preparation.yml' ||
      producer.display_title !== title || producer.status !== 'completed' || producer.run_attempt !== 1 ||
      producer.event !== 'workflow_dispatch' || producer.actor?.login !== 'github-actions[bot]' ||
      String(gate.producer_run_id) !== String(producerId) || String(gate.root_run_id) !== String(rootId) ||
      String(gate.root_attempt) !== String(attempt) || gate.source_sha !== source ||
      !['true', 'false'].includes(gate.allowed) || typeof gate['gate-reason'] !== 'string') {
    throw new Error('Daily gate artifact does not match this root source and draft producer');
  }
  return gate;
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
  if (process.argv.includes('--record-root-options')) {
    const options = rootOptions(env);
    writeFileSync('main-root-options.json', JSON.stringify(options, null, 2));
    appendFileSync(env.GITHUB_STEP_SUMMARY, `Manual controls: Actions → Build, Test and Draft Release → Run workflow → main. Select full-tests for complete suites. To bypass the daily draft gate once, select bypass-regression-gate and enter bypass-reason. Staging tests always run.\n\nFull tests: ${options.full_tests}. Daily gate bypass: ${options.bypass_regression_gate}. Reason: ${options.bypass_reason || 'none'}.\n`);
    return;
  }
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
    if (parent.path === '.github/workflows/build-test-deploy.yml') {
      const directory = mkdtempSync(join(tmpdir(), 'main-root-options-'));
      execFileSync('gh', ['run', 'download', env.PARENT_RUN_ID, '--repo', env.GITHUB_REPOSITORY,
        '--name', `main-root-options-${env.PARENT_ATTEMPT}`, '--dir', directory]);
      const options = verifyRootOptions(JSON.parse(readFileSync(join(directory, 'main-root-options.json'), 'utf8')),
        parent, env.PARENT_RUN_ID, env.PARENT_ATTEMPT, env.SOURCE_SHA);
      writeFileSync('verified-root-options.json', JSON.stringify(options));
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT,
        `full-tests=${options.full_tests}\nbypass-regression-gate=${options.bypass_regression_gate}\nroot-event=${options.root_event}\n`);
    }
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
    if (!Number.isFinite(waitMinutes) || waitMinutes < 1 || waitMinutes > 300) throw new Error('Invalid child wait limit');
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
