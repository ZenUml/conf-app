import { execFileSync } from 'node:child_process';

const phaseWorkflows = {
  'Build preparation': 'main-build-preparation.yml',
  'Staging validation': 'main-staging-validation.yml',
};

export function expandPhaseFailures(failures, root, api) {
  return failures.flatMap(name => {
    const workflow = phaseWorkflows[name];
    if (!workflow) return [name];
    const title = `${name} · parent ${root.id} · attempt ${root.run_attempt} · source ${root.head_sha}`;
    const matches = api(`actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100`).workflow_runs
      .filter(run => run.display_title === title);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].run_attempt !== 1) return ['Unverified phase failure'];
    const jobs = api(`actions/runs/${matches[0].id}/attempts/1/jobs?per_page=100`).jobs;
    const failed = jobs.filter(job => ['failure', 'timed_out'].includes(job.conclusion)).map(job => job.name);
    return failed.length ? failed : ['Unverified phase failure'];
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/${path}`], { encoding: 'utf8', timeout: 30000 }));
  const root = api(`actions/runs/${process.env.RUN_ID}`);
  console.log(JSON.stringify(expandPhaseFailures(JSON.parse(process.env.FAILED), root, api)));
}
