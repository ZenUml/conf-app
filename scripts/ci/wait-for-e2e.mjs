import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

export function dispatchBody(env) {
  return {
    ref: env.DISPATCH_REF || env.GITHUB_REF_NAME,
    inputs: {
      'parent-run-id': env.GITHUB_RUN_ID,
      'parent-attempt': env.GITHUB_RUN_ATTEMPT,
      'source-sha': env.SOURCE_SHA,
      grep: env.GREP || '',
      ...(env.CHILD_KIND === 'pr' ? { mode: env.MODE } : {
        suite: env.SUITE || 'insert',
        timeout: env.TEST_TIMEOUT || '11',
      }),
    },
  };
}

export function findChild(runs, title) {
  // The title includes the tested SHA. The dispatch branch can advance while
  // queued; checkout in the child uses source-sha, not its workflow head SHA.
  return runs.find(run => run.display_title === title);
}

export function verifyParent(parent, attempt) {
  if (parent.status !== 'in_progress' || String(parent.run_attempt) !== attempt ||
      !['.github/workflows/build-test-deploy.yml', '.github/workflows/pr-validation.yml'].includes(parent.path)) {
    throw new Error('Child E2E requires an active staging parent for this attempt');
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
    verifyParent(api(`actions/runs/${env.PARENT_RUN_ID}`), env.PARENT_ATTEMPT);
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
    if (interrupted) throw new Error('Parent cancelled');
    const url = child.html_url;
    console.log(`Child E2E run: ${url}`);
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### [E2E details](${url})\n\n`);
    const finishDeadline = Date.now() + 30 * 60000;
    while (child.status !== 'completed' && !interrupted && Date.now() < finishDeadline) {
      await pause();
      child = api(`actions/runs/${child.id}`);
    }
    appendFileSync(env.GITHUB_STEP_SUMMARY, `Result: **${child.conclusion || child.status}**\n`);
    if (child.status !== 'completed') {
      throw new Error(interrupted ? 'Parent cancelled' : 'Child E2E exceeded the 30-minute wait limit');
    }
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
