#!/usr/bin/env node
// First automation on the auto lane (docs/policies/auto-lane.md): merge at most ONE open Dependabot PR per
// run when scripts/ci/auto-lane-policy.mjs classifies its diff `auto-merge` and every check on its head is green.
//
//   node scripts/ci/auto-lane-merge.mjs [--dry-run]      env: AUTO_LANE_ENABLED, AUTO_LANE_DRY_RUN, GH_TOKEN
//
// The repository is public and `main` has no required checks, so this job is the only guard: every doubt skips.
// Run it from a checkout of `main`, never from a PR head: the classifier is imported from the working tree.
// Node built-ins only. The decision is the pure function `decide`; `main` does the I/O.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildInputFromGit, classifyChange } from "./auto-lane-policy.mjs";

// What `gh pr list|view --json author` prints for Dependabot (verified 2026-11-13: login "app/dependabot",
// is_bot true). The REST API spells it "dependabot[bot]"; gh does not, and this job reads through gh.
export const BOT_LOGIN = "app/dependabot";
export const REQUIRED_CHECKS = ["Build and Unit Test", "E2E validation", "Pipeline outcome"];
export const MAX_MERGES_PER_DAY = 2;
export const MAX_PRS_PER_RUN = 20;
// A green run on an old head says nothing about today's `main`: the PR must have been checked within this window.
export const MAX_CHECK_AGE_DAYS = 7;
// GitHub computes mergeability lazily: the first read after `main` moves answers UNKNOWN, and asking is what
// starts the computation. Ask again a bounded number of times before giving up on the PR for this run.
export const MERGEABLE_READS = 3;
export const MERGEABLE_WAIT_MS = 5_000;
const HOLD_LABEL = "auto-lane:hold";
const LEDGER_LABEL = "auto-lane";
const PIPELINE_WORKFLOW = "build-test-deploy.yml";
const OK_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

const skip = (reason) => ({ action: "skip", reason });

// Latest run per check name. "Latest" = later completed_at, then higher id, then later position in the list.
function latestPerName(checks) {
  const latest = new Map();
  checks.forEach((check, index) => {
    const key = [check.completed_at ?? "", Number(check.id) || 0, index];
    const best = latest.get(check.name);
    if (!best || compareKeys(key, best.key) > 0) latest.set(check.name, { check, key });
  });
  return [...latest.values()].map((v) => v.check);
}
const compareKeys = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2]);

// Pure decision. Skip rules run in the documented order; the first that applies wins.
export function decide(input) {
  try {
    const { enabled, pr, classification, checks, mergedToday, now } = input;
    if (enabled !== "true") return skip("disabled");
    if (!Number.isFinite(mergedToday) || mergedToday >= MAX_MERGES_PER_DAY) return skip("daily-cap");
    if (pr.isDraft !== false) return skip("draft");
    if (pr.author !== BOT_LOGIN || pr.authorIsBot === false) return skip("author");
    if (!pr.headRepoFullName || pr.headRepoFullName !== pr.baseRepoFullName) return skip("fork");
    if (pr.baseRef !== "main") return skip("base");
    if ((pr.labels ?? []).includes(HOLD_LABEL)) return skip("hold");
    if (pr.mergeable === "UNKNOWN") return skip("mergeable-unknown");
    if (pr.mergeable !== "MERGEABLE") return skip("not-mergeable");
    if (!classification || classification.level !== "auto-merge") return skip(`policy:${classification?.lane ?? "error"}`);
    if (!Array.isArray(checks) || checks.length === 0) return skip("no-checks");
    if (checks.some((c) => c.status !== "completed")) return skip("checks-pending");
    const latest = latestPerName(checks);
    const bad = latest.find((c) => !OK_CONCLUSIONS.has(c.conclusion));
    if (bad) return skip(`checks-failed:${bad.name}`);
    for (const name of REQUIRED_CHECKS) {
      if (!latest.some((c) => c.name === name && c.conclusion === "success")) return skip(`required-check:${name}`);
    }
    const oldest = Date.parse(now) - MAX_CHECK_AGE_DAYS * 86_400_000;
    for (const name of REQUIRED_CHECKS) {
      const at = Date.parse(latest.find((c) => c.name === name).completed_at);
      if (!(at >= oldest)) return skip(`checks-stale:${name}`); // NaN on either side skips
    }
    return { action: "merge", reason: "all-conditions-met" };
  } catch {
    return skip("invalid-input");
  }
}

// ---------------------------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------------------------

const run = (cmd) => (args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const defaultDeps = {
  gh: run("gh"),
  git: run("git"),
  classify: (baseSha, headSha) => classifyChange(buildInputFromGit(baseSha, headSha)),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
};

const LIST_FIELDS = "number,isDraft,author,headRefOid,baseRefName,mergeable,labels,isCrossRepository,headRepository,headRepositoryOwner";

const msg = (e) => String(e?.stderr?.toString().trim() || e?.message || e).split("\n")[0].slice(0, 200);

export function main(argv = process.argv.slice(2), env = process.env, out = process.stdout, deps = defaultDeps, err = process.stderr) {
  const { gh, git, classify, sleep } = { ...defaultDeps, ...deps };
  const dryRun = argv.includes("--dry-run") || env.AUTO_LANE_DRY_RUN === "true";
  const unknown = argv.filter((a) => a !== "--dry-run");
  if (unknown.length) {
    err.write(`auto-lane-merge: unknown argument: ${unknown[0]}\n`);
    return 2;
  }
  // The switch is checked before any network call. A dry run reads only, so it may bypass the switch.
  if (!dryRun && env.AUTO_LANE_ENABLED !== "true") {
    out.write("auto lane disabled\n");
    return 0;
  }
  const enabled = dryRun ? "true" : env.AUTO_LANE_ENABLED;
  if (dryRun) out.write("DRY RUN: no label, merge or dispatch will be made\n");

  try {
    const repo = env.GITHUB_REPOSITORY || gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("cannot determine the repository");

    const today = new Date().toISOString().slice(0, 10);
    const mergedToday = JSON.parse(
      gh(["pr", "list", "--repo", repo, "--state", "merged", "--label", LEDGER_LABEL, "--search", `merged:>=${today}`, "--json", "number", "--limit", "100"]),
    ).length;

    const rows = JSON.parse(
      gh(["pr", "list", "--repo", repo, "--state", "open", "--author", BOT_LOGIN, "--base", "main", "--search", "sort:created-asc",
        "--limit", String(MAX_PRS_PER_RUN), "--json", LIST_FIELDS]),
    );
    if (rows.length > 0) git(["fetch", "origin", "main"]);

    let wouldMerge = false; // dry run only: it keeps listing PRs, but a real run stops at its first merge
    for (const row of rows.slice(0, MAX_PRS_PER_RUN)) {
      const line = (action, reason, lane = "-") => out.write(`#${row.number} ${action} ${reason} ${lane}\n`);
      try {
        const headSha = row.headRefOid;
        git(["fetch", "origin", `pull/${row.number}/head`]);
        if (git(["rev-parse", "FETCH_HEAD"]).trim() !== headSha) throw new Error("head-moved");
        const mergeBase = git(["merge-base", "origin/main", headSha]).trim();

        let classification = null;
        try {
          classification = classify(mergeBase, headSha);
        } catch {
          classification = null;
        }
        const checks = gh(["api", "--paginate", `repos/${repo}/commits/${headSha}/check-runs?per_page=100`, "--jq",
          ".check_runs[] | {id,name,status,conclusion,completed_at}"])
          .split("\n").filter(Boolean).map((l) => JSON.parse(l));

        let mergeable = row.mergeable;
        for (let read = 0; mergeable === "UNKNOWN" && read < MERGEABLE_READS; read++) {
          sleep(MERGEABLE_WAIT_MS);
          mergeable = JSON.parse(gh(["pr", "view", String(row.number), "--repo", repo, "--json", "mergeable"])).mergeable;
        }

        const pr = {
          number: row.number,
          isDraft: row.isDraft,
          author: row.author?.login,
          authorIsBot: row.author?.is_bot,
          headRepoFullName: row.isCrossRepository === false && row.headRepositoryOwner?.login && row.headRepository?.name
            ? `${row.headRepositoryOwner.login}/${row.headRepository.name}` : undefined,
          baseRepoFullName: repo,
          baseRef: row.baseRefName,
          headSha,
          mergeable,
          labels: (row.labels ?? []).map((l) => l.name),
        };
        const decision = decide({ enabled, pr, classification, checks, mergedToday, now: new Date().toISOString() });
        if (decision.action === "merge" && wouldMerge) {
          line("skip", "one-merge-per-run (would qualify)", classification?.lane);
          continue;
        }
        line(decision.action, decision.reason, classification?.lane);
        if (decision.action !== "merge") continue;
        if (dryRun) {
          wouldMerge = true;
          continue;
        }

        // The label is the ledger the daily cap reads. The API call creates the label if it does not exist yet.
        gh(["api", "-X", "POST", `repos/${repo}/issues/${row.number}/labels`, "-f", `labels[]=${LEDGER_LABEL}`]);
        gh(["pr", "merge", String(row.number), "--repo", repo, "--merge", "--match-head-commit", headSha]);
        out.write(`#${row.number} merged\n`);
        // A merge made with GITHUB_TOKEN fires no push workflows; workflow_dispatch is allowed.
        try {
          gh(["workflow", "run", PIPELINE_WORKFLOW, "--repo", repo, "--ref", "main"]);
          out.write(`dispatched ${PIPELINE_WORKFLOW} on main\n`);
        } catch (e) {
          err.write(`auto-lane-merge: merged #${row.number} but the pipeline dispatch failed: ${msg(e)}\n`);
          return 1;
        }
        break;
      } catch (e) {
        line("skip", `error:${msg(e)}`);
      }
    }
    return 0;
  } catch (e) {
    err.write(`auto-lane-merge: ${msg(e)}\n`);
    return 1;
  }
}

const isMain = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) process.exitCode = main();
