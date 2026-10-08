#!/usr/bin/env node
import { aggregateRegression } from './regression-results.mjs';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const WINDOW_MS = 36 * 60 * 60 * 1000;
export async function findBaseline(runs, { sourceSha, rootRunId, isAncestor }) {
  for (const run of [...runs].sort((a, b) => Number(b.id) - Number(a.id))) {
    if ((rootRunId && Number(run.id) >= Number(rootRunId)) || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success' || !SHA.test(run.head_sha || '') || run.head_sha === sourceSha) continue;
    if (await isAncestor(run.head_sha, sourceSha)) return { 'base-sha': run.head_sha, 'force-full': 'false' };
  }
  return { 'base-sha': '', 'force-full': 'true' };
}
export async function evaluateGate(runs, { sourceSha, now = Date.now(), isAncestor, targetSha, rootEvent, bypass, bypassReason, lookupError, executionEvidence }) {
  const run = [...runs].filter(r => r.head_branch === 'main' && r.status === 'completed').sort((a, b) => (Date.parse(b.updated_at) || Infinity) - (Date.parse(a.updated_at) || Infinity) || Number(b.id) - Number(a.id))[0];
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
const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
export async function fetchRuns(api, workflow, repo) {
  const runs = [];
  for (let page = 1; page <= 100; page++) {
    const response = await api(`repos/${repo}/actions/workflows/${workflow}/runs?branch=main&per_page=100&page=${page}`);
    if (!Array.isArray(response.workflow_runs) || !Number.isInteger(response.total_count)) throw new Error('Invalid workflow run inventory');
    runs.push(...response.workflow_runs);
    if (runs.length >= response.total_count) return runs;
    if (response.workflow_runs.length < 100) throw new Error('Incomplete workflow run inventory');
  }
  throw new Error('Workflow run inventory exceeds safe pagination limit');
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
  const api = endpoint => JSON.parse(gh(['api', endpoint]));
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
