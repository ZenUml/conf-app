#!/usr/bin/env node
import { aggregateRegression } from './regression-results.mjs';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const WINDOW_MS = 36 * 60 * 60 * 1000;
// A rerun retains its creation ID, so completion order must take precedence.
const latestCompletedFirst = (a, b) => (Date.parse(b.updated_at) || Infinity) - (Date.parse(a.updated_at) || Infinity) || Number(b.id) - Number(a.id);
export async function findBaseline(runs, { sourceSha, rootRunId, isAncestor }) {
  for (const run of [...runs].sort(latestCompletedFirst)) {
    if ((rootRunId && Number(run.id) >= Number(rootRunId)) || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success' || !SHA.test(run.head_sha || '') || run.head_sha === sourceSha) continue;
    if (await isAncestor(run.head_sha, sourceSha)) return { 'base-sha': run.head_sha, 'force-full': 'false' };
  }
  return { 'base-sha': '', 'force-full': 'true' };
}
export async function evaluateGate(runs, { sourceSha, now = Date.now(), isAncestor, targetSha, rootEvent, bypass, bypassReason, lookupError, executionEvidence }) {
  const run = [...runs].filter(r => r.head_branch === 'main' && r.status === 'completed').sort(latestCompletedFirst)[0];
  const result = (allowed, reason) => ({ allowed: String(allowed), 'gate-reason': reason, 'regression-run-url': run?.html_url || '' });
  // Provenance for these inputs is checked by the trusted caller against the root run.
  if (bypass === true || bypass === 'true') {
    if (rootEvent !== 'workflow_dispatch') return result(false, 'Bypass requires a manual root workflow run');
    if (typeof bypassReason !== 'string' || !bypassReason.trim()) return result(false, 'Bypass requires a nonempty reason');
    return result(true, 'Regression freshness gate bypassed by an explicit manual root run');
  }
  if (lookupError) return result(false, 'Regression lookup failed');
  if (!run) return result(false, 'No completed main regression run');
  if (run.conclusion !== 'success') return result(false, `Latest completed main regression did not succeed (${run.conclusion || 'unknown'})`);
  const completed = Date.parse(run.updated_at);
  if (!Number.isFinite(completed) || completed > now || now - completed > WINDOW_MS) return result(false, 'Latest completed main regression is older than 36 hours or has invalid completion time');
  const sha = await targetSha(run);
  if (!SHA.test(sha || '') || !await isAncestor(sha, sourceSha)) return result(false, 'Regression target is not a verified ancestor of this main source');
  if (!executionEvidence || !await executionEvidence(run, sha, now)) return result(false, 'Daily regression lacks complete fresh execution evidence for all four variants; start a new full regression run');
  return result(true, 'Latest completed main regression succeeded within 36 hours on a verified ancestor');
}
export function freshRegressionCoverage(run, jobs, sha, now) {
  const evidence = aggregateRegression(run, jobs, { sha });
  if (evidence.variants.length !== 4 || evidence.variants.some(v => v.deployment !== 'success' || v.version !== 'success' || v.tests !== 'success' || v.failures.length)) return false;
  const executed = jobs.filter(job => /^(Lite|Full|Diagramly|AsyncAPI) \/.*\/ (?:plan concrete tests|shard \d+\/\d+|aggregate concrete evidence)$/.test(job.name));
  return executed.length > 0 && executed.every(job => {
    const completed = Date.parse(job.completed_at);
    return Number.isFinite(completed) && completed <= now && now - completed <= WINDOW_MS
      && (job.run_attempt === undefined || Number(job.run_attempt) === Number(run.run_attempt));
  });
}
const execFileAsync = promisify(execFile);
const ghAsync = async args => (await execFileAsync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024 })).stdout;
const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const PAGE_SIZE = 100, MAX_PAGES = 100, MAX_IN_FLIGHT = 6;
// Page 1 reveals total_count; pages 2..N are then requested together (at most MAX_IN_FLIGHT at once) and joined in page order,
// so callers see exactly the array the former one-page-at-a-time loop produced.
//
// GitHub caps a filtered listing: "This endpoint will return up to 1,000 results for each search when using the following
// parameters: actor, branch, check_suite_id, created, event, head_sha, status."
// (https://docs.github.com/en/rest/actions/workflow-runs, "List workflow runs for a workflow"). Unbounded, branch=main would
// eventually exceed 1,000 runs and fail as an incomplete inventory, so only the last BASELINE_WINDOW_DAYS days are listed.
// `gh api` passes the path verbatim, hence ">=" is sent percent-encoded.
export const BASELINE_WINDOW_DAYS = 60;
export async function fetchRuns(api, workflow, repo, { now = new Date() } = {}) {
  const since = new Date(new Date(now).getTime() - BASELINE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const fetchPage = async page => {
    const response = await api(`repos/${repo}/actions/workflows/${workflow}/runs?branch=main&created=%3E%3D${since}&per_page=${PAGE_SIZE}&page=${page}`);
    if (!Array.isArray(response.workflow_runs) || !Number.isInteger(response.total_count)) throw new Error('Invalid workflow run inventory');
    return response;
  };
  const first = await fetchPage(1);
  const runs = [...first.workflow_runs];
  if (runs.length >= first.total_count) return runs;
  if (first.workflow_runs.length < PAGE_SIZE) throw new Error('Incomplete workflow run inventory');
  const pageCount = Math.ceil(first.total_count / PAGE_SIZE);
  if (pageCount > MAX_PAGES) throw new Error('Workflow run inventory exceeds safe pagination limit');
  const rest = new Array(pageCount - 1);
  // Runs deleted during the fetch lower total_count; the smallest value seen is the target, as the sequential loop's early return was.
  let minTotal = first.total_count, next = 2, aborted = false;
  const worker = async () => {
    while (!aborted && next <= pageCount) {
      const page = next++;
      try {
        const response = await fetchPage(page);
        minTotal = Math.min(minTotal, response.total_count);
        rest[page - 2] = response.workflow_runs;
      } catch (error) { aborted = true; throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, pageCount - 1) }, worker));
  for (const pageRuns of rest) {
    if (runs.length >= minTotal) return runs;
    if (pageRuns.length < PAGE_SIZE && runs.length + pageRuns.length < minTotal) throw new Error('Incomplete workflow run inventory');
    runs.push(...pageRuns);
  }
  if (runs.length < minTotal) throw new Error('Incomplete workflow run inventory');
  return runs;
}
const ancestry = (base, head) => {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('Invalid ancestry SHA');
  try { execFileSync('git', ['merge-base', '--is-ancestor', base, head], { stdio: 'ignore' }); return true; }
  catch (error) { if (error.status === 1) return false; throw error; }
};
function regressionTarget(run, repo) {
  const dir = mkdtempSync(join(tmpdir(), 'main-regression-'));
  try {
    gh(['run', 'download', String(run.id), '--repo', repo, '--name', `regression-target-${run.id}`, '--dir', dir]);
    return JSON.parse(readFileSync(join(dir, 'regression-target.json'), 'utf8')).sha;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function main() {
  const mode = process.argv[2];
  if (!['--baseline', '--gate'].includes(mode)) throw new Error('Use --baseline or --gate');
  const sourceSha = process.env.SOURCE_SHA;
  if (!SHA.test(sourceSha || '')) throw new Error('SOURCE_SHA must be a full commit SHA');
  const repo = process.env.GITHUB_REPOSITORY || 'ZenUml/conf-app';
  const api = async endpoint => JSON.parse(await ghAsync(['api', endpoint]));
  let output;
  try {
    const runs = await fetchRuns(api, mode === '--baseline' ? 'build-test-deploy.yml' : 'daily-regression.yml', repo);
    output = mode === '--baseline' ? await findBaseline(runs, { sourceSha, rootRunId: process.env.ROOT_RUN_ID, isAncestor: ancestry }) : await evaluateGate(runs, { sourceSha, isAncestor: ancestry, targetSha: run => regressionTarget(run, repo), executionEvidence: (run, sha, now) => {
      const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`]));
      if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.jobs))) throw new Error('Incomplete regression job evidence');
      return freshRegressionCoverage(run, pages.flatMap(page => page.jobs), sha, now);
    }, rootEvent: process.env.ROOT_EVENT, bypass: process.env.BYPASS_REGRESSION_GATE, bypassReason: process.env.BYPASS_REASON });
  } catch {
    output = mode === '--baseline' ? { 'base-sha': '', 'force-full': 'true' } : await evaluateGate([], { sourceSha, lookupError: true, rootEvent: process.env.ROOT_EVENT, bypass: process.env.BYPASS_REGRESSION_GATE, bypassReason: process.env.BYPASS_REASON });
  }
  for (const [key, value] of Object.entries(output)) {
    const safe = String(value).replace(/[\r\n]/g, ' ');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${safe}\n`);
  }
  console.log(JSON.stringify(output));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Main ${mode.slice(2)} policy\n\n${output['gate-reason'] || (output['force-full'] === 'true' ? 'No verified successful prior main baseline; full validation required.' : `Verified prior successful main baseline: ${output['base-sha']}`)}\n\n${mode === '--gate' ? 'To refresh: open Actions → Daily Full Staging Regression → Run workflow, choose main, and leave SHA empty (or supply the candidate main SHA). Wait for success, then re-run this root validation. For an urgent override, open Actions → Build, Test and Draft Release → Run workflow on main, enable the regression gate bypass, and provide a reason. The bypass applies only to regression freshness; selected validation failures still block drafts.\n' : ''}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
