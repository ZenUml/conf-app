#!/usr/bin/env node
// Refresh a PR's test decision after only the base moved.
//
// PR validation checks the decision when its run gets the staging lock, often 30+ minutes after the push.
// A merge to main in that window makes the decision stale (`missing-or-stale-decision`). The manual fix is:
// merge main into the branch, wait for GitHub to rebuild the merge ref, inspect, publish, request E2E.
// This script runs that loop. It reuses ONLY a previous collaborator `selected` decision whose diff and
// catalogs are unchanged; anything else exits 2 and needs manual `pr-triage`.
//
//   node refresh-decision.mjs --pr <N> [--repo owner/name] [--no-request] [--confirm]
//
// Without --confirm nothing is changed on GitHub (a temporary clean checkout of origin/main is created and removed).
// With --confirm it may push a merge of main into the PR branch, publish a decision under the current `gh`
// login (must be a collaborator), and request the PR E2E run.
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_ROUNDS = 4;
const MERGE_REF_POLLS = 24;
const POLL_MS = 10000;

/** Decide what to do with the newest collaborator decision. Pure; no network. */
export function reuseVerdict(found, context, catalog) {
  if (found.valid) return { action: 'current' };
  const old = found.decision;
  if (!old) return { action: 'manual', reason: found.reason || 'no-reusable-decision' };
  if (old.mode !== 'selected') return { action: 'manual', reason: `previous decision is ${old.mode}; only a selected decision can be refreshed` };
  if (Object.entries(catalog).some(([key, value]) => old[key] !== value)) return { action: 'manual', reason: 'catalog-or-policy-changed' };
  if (old.diff_fingerprint !== context.diff_fingerprint) return { action: 'manual', reason: 'diff-changed' };
  if (found.reason !== 'missing-or-stale-decision') return { action: 'manual', reason: found.reason };
  return { action: 'refresh', decision: old };
}

/** The new decision keeps the reviewed substance and takes the current head/base identity. */
export function refreshedInput(old, context) {
  return {
    schema_version: 2, pr_number: context.pr.number, head_sha: context.pr.head.sha, base_sha: context.pr.base.sha,
    mode: 'selected', source: old.source, scenarios: old.scenarios, reason: old.reason, evidence: old.evidence,
  };
}

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
  const result = { confirm: false, noRequest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--confirm') result.confirm = true;
    else if (arg === '--no-request') result.noRequest = true;
    else if (arg === '--pr' || arg === '--repo') result[arg.slice(2)] = argv[++i];
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!/^[1-9][0-9]*$/.test(String(result.pr))) throw new Error('Usage: refresh-decision.mjs --pr NUMBER [--repo owner/name] [--no-request] [--confirm]');
  return result;
}

async function mergeRefReady(api, pr, tip, head) {
  const pull = await api(`/pulls/${pr}`);
  if (pull.head.sha !== head || !pull.merge_commit_sha) return false;
  const commit = await api(`/commits/${pull.merge_commit_sha}`);
  const parents = commit.parents.map(parent => parent.sha);
  return parents.includes(tip) && parents.includes(head);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const repo = a.repo || execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim();
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    git(['fetch', '-q', 'origin', 'main']);
    const tip = git(['rev-parse', 'origin/main']);
    const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'conf-app-pr-controller.'));
    git(['worktree', 'add', '-q', '--detach', dir, tip]);
    try {
      // Trusted controller code comes from the target branch tip, never from the PR branch.
      const load = file => import(pathToFileURL(join(dir, 'scripts/test-selection', file)).href);
      const [controller, requester] = await Promise.all([load('pr-decision.mjs'), load('request-pr-e2e.mjs')]);
      const api = controller.githubApi(repo);
      const context = await controller.readContext(api, a.pr);
      const found = await controller.findDecision(api, context);
      const verdict = reuseVerdict(found, context, controller.catalog);
      if (verdict.action === 'current') { console.log(JSON.stringify({ outcome: 'current', head_sha: context.pr.head.sha, base_sha: context.pr.base.sha, decision_id: found.comment_id })); return; }
      if (verdict.action === 'manual') { console.log(JSON.stringify({ outcome: 'manual-triage-needed', reason: verdict.reason })); process.exitCode = 2; return; }

      const head = context.pr.head.sha;
      const compare = await api(`/compare/${encodeURIComponent(context.pr.base.ref)}...${head}`);
      const plan = compare.behind_by > 0 ? ['update-branch', 'wait-merge-ref', 'publish', 'request'] : ['wait-merge-ref', 'publish', 'request'];
      if (!a.confirm) { console.log(JSON.stringify({ outcome: 'dry-run', round, behind_by: compare.behind_by, plan: a.noRequest ? plan.slice(0, -1) : plan })); return; }

      if (compare.behind_by > 0) {
        await api(`/pulls/${a.pr}/update-branch`, 'PUT', { expected_head_sha: head });
        console.error(`round ${round}: merged ${tip.slice(0, 8)} into the PR branch; re-reading identity`);
        for (let i = 0; i < MERGE_REF_POLLS && (await api(`/pulls/${a.pr}`)).head.sha === head; i++) await sleep(POLL_MS);
        continue; // head changed: restart from a fresh tip and context
      }
      let ready = false;
      for (let i = 0; i < MERGE_REF_POLLS && !(ready = await mergeRefReady(api, a.pr, tip, head)); i++) await sleep(POLL_MS);
      if (!ready) { console.error(`round ${round}: merge ref not rebuilt on ${tip.slice(0, 8)}; retrying`); continue; }
      git(['fetch', '-q', 'origin', 'main']);
      if (git(['rev-parse', 'origin/main']) !== tip) { console.error(`round ${round}: main moved during the wait; retrying`); continue; }

      const published = await controller.publish(api, context, refreshedInput(verdict.decision, context));
      const requested = a.noRequest ? null : await requester.requestPrE2E(api, a.pr);
      console.log(JSON.stringify({ outcome: 'refreshed', round, head_sha: head, base_sha: tip, published, requested }));
      return;
    } finally {
      try { git(['worktree', 'remove', '--force', dir]); } catch { /* a leftover temp checkout is harmless */ }
    }
  }
  console.log(JSON.stringify({ outcome: 'gave-up', reason: `main kept moving for ${MAX_ROUNDS} rounds` }));
  process.exitCode = 3;
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
