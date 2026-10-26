#!/usr/bin/env node
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { authorize, githubApi } from './pr-decision.mjs';

// A request label starts a fresh PR-associated run. It grants no test permission.
// workflow_dispatch on main would attach the result to main, leaving stale PR checks.
export async function requestPrE2E(api, pr) {
  const approved = await authorize(api, pr);
  const label = 'test:run';
  const labels = await api('/labels?per_page=100');
  if (!labels.some(item => item.name === label)) {
    try { await api('/labels', 'POST', { name: label, color: 'ededed', description: 'Request PR E2E; current commit decision is still required' }); }
    catch {
      // Only tolerate a concurrent creator if the specific label now exists.
      await api(`/labels/${encodeURIComponent(label)}`);
    }
  }
  const current = await api(`/issues/${pr}/labels?per_page=100`);
  if (current.some(item => item.name === label)) await api(`/issues/${pr}/labels/${encodeURIComponent(label)}`, 'DELETE');
  // Revalidate after preparation; a push must not reuse the previous approval.
  await authorize(api, pr, { candidate: approved.candidate, expectedDecision: approved.result.comment_id });
  await api(`/issues/${pr}/labels`, 'POST', { labels: [label] });
  return { requested: true, pr_number: Number(pr), head_sha: approved.context.pr.head.sha, candidate: approved.candidate, decision_id: approved.result.comment_id };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs, []));
  const repo = args.repo || process.env.GITHUB_REPOSITORY || execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim();
  console.log(JSON.stringify(await requestPrE2E(githubApi(repo), args.pr)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
