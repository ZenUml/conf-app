#!/usr/bin/env node
// Says whether a queued PR run still validates the commit the PR points at.
// Writes `current=true|false` to GITHUB_OUTPUT and always exits 0: the caller
// decides what to skip, and a failed lookup must not turn into a red check.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function prRunIsCurrent({ pr, expectedSha, fetchPull, log = console.log }) {
  if (!pr) return true;
  try {
    const pull = await fetchPull(pr);
    if (pull.state !== 'open') {
      log(`PR #${pr} is ${pull.state}; ${expectedSha} no longer needs validation.`);
      return false;
    }
    if (pull.head.sha !== expectedSha) {
      log(`PR #${pr} moved to ${pull.head.sha}; ${expectedSha} is stale.`);
      return false;
    }
    return true;
  } catch (error) {
    // Validating a stale commit wastes minutes. Skipping a current one loses coverage.
    log(`Could not read PR #${pr}, validating anyway: ${error.message}`);
    return true;
  }
}

async function fetchPullFromGitHub(pr) {
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const response = await fetch(`${api}/repos/${process.env.GITHUB_REPOSITORY}/pulls/${pr}`, {
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return response.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = await prRunIsCurrent({
    pr: process.env.PR_NUMBER,
    expectedSha: process.env.EXPECTED_SHA,
    fetchPull: fetchPullFromGitHub,
  });
  console.log(`current=${current}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `current=${current}\n`);
}
