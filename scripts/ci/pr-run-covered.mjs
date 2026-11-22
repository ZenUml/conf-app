#!/usr/bin/env node
// Says whether an earlier PR validation run already covers this one.
//
// One commit often gets several runs: the push, the `test:run` request and
// Ready for Review each start one. They queue on the single PR slot, and each
// would deploy and run E2E again for the same commit and the same test decision.
// A run is covered when an earlier run of the same head passed E2E after it read
// the test decision that is still the newest one.
//
// Writes `covered-by=<run id>` (or empty) to GITHUB_OUTPUT and always exits 0.
// Any doubt means "not covered": running twice wastes minutes, skipping loses coverage.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DECISION_MARKER = '<!-- pr-test-decision:';
const passed = (jobs, name) => jobs.find(job => job.name === name && job.conclusion === 'success');

export async function coveringRun({ runId, attempt, event, headSha, pr, listRuns, listJobs, listComments, log = console.log }) {
  // A manual dispatch or a re-run is an explicit request to validate again.
  if (event !== 'pull_request' || String(attempt) !== '1' || !/^[1-9][0-9]*$/.test(String(pr)) || !/^[a-f0-9]{40}$/.test(String(headSha))) return null;
  try {
    const earlier = (await listRuns(headSha))
      .filter(run => run.id < Number(runId) && run.event === 'pull_request' && run.status === 'completed' && run.conclusion === 'success' && run.head_sha === headSha)
      .sort((a, b) => b.id - a.id);
    if (!earlier.length) return null;
    const decisions = (await listComments(pr)).filter(comment => comment.body?.startsWith(DECISION_MARKER));
    const newest = Math.max(...decisions.flatMap(comment => [Date.parse(comment.created_at), Date.parse(comment.updated_at)]));
    if (!decisions.length || !Number.isFinite(newest)) return null;
    for (const run of earlier) {
      const jobs = await listJobs(run.id);
      const select = passed(jobs, 'Select E2E for this PR');
      if (!select || !passed(jobs, 'E2E validation') || !passed(jobs, 'Pipeline outcome')) continue;
      // The earlier run must have read the decision that is still the newest record.
      if (!(newest < Date.parse(select.started_at))) continue;
      log(`Run ${run.id} already passed E2E for ${headSha} under the current test decision.`);
      return run.id;
    }
    return null;
  } catch (error) {
    log(`Could not look for an earlier run, validating anyway: ${error.message}`);
    return null;
  }
}

async function github(path) {
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const response = await fetch(`${api}/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return response.json();
}

async function pages(path, pick = body => body) {
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const batch = pick(await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`));
    if (!Array.isArray(batch)) throw new Error('Unexpected GitHub response');
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error('Too many pages');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const covered = await coveringRun({
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, event: process.env.GITHUB_EVENT_NAME,
    headSha: process.env.EXPECTED_SHA, pr: process.env.PR_NUMBER,
    listRuns: sha => pages(`/actions/workflows/pr-validation.yml/runs?head_sha=${sha}&status=success`, body => body.workflow_runs),
    listJobs: id => pages(`/actions/runs/${id}/jobs?filter=latest`, body => body.jobs),
    listComments: number => pages(`/issues/${number}/comments`),
  });
  console.log(`covered-by=${covered ?? ''}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `covered-by=${covered ?? ''}\n`);
}
