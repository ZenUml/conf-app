---
name: babysit-pr
description: Monitor and fix failing GitHub Actions CI checks on PRs for ZenUml/conf-app. Use when the user says "babysit PR", "check PR status", "fix CI", "PR is failing", "watch this PR", "why is CI red", or when used with /loop to continuously monitor a PR. Also use when staging deploy failures, E2E test flakiness, lint issues, or unit test failures block merging. Triggers on any PR monitoring, CI failure diagnosis, or automated fix-and-retry workflow.
---

# Babysit PR

Monitor a GitHub Actions PR, diagnose failures, attempt fixes, and retry — up to 3 times total.

## Scope

This skill targets **ZenUml/conf-app** (conf-app). All commands run from the conf-app directory.

## CI Pipeline Overview

Read the current PR workflow and matching run rather than inferring execution from Draft state. Build, type-check and unit-test jobs retain their own rules. PR E2E requires a trusted current-commit test decision; it may run while Draft. Main, daily regression and release workflows retain their separate policies.

## Step 1: Find the PR

Resolve which PR to babysit, in this priority order:

1. **Explicit PR number** — if the user provided one (e.g., `#123`), use it
2. **Current branch PR** — run `gh pr view --json number,title,headRefName,state,isDraft,statusCheckRollup`
   > **WARNING**: Do NOT add `--repo` to this command. `gh pr view` without `--repo` infers the repo from the current directory's git remote, which is correct. Adding `--repo` requires an explicit PR number/branch argument and breaks branch inference, causing "argument required when using the --repo flag".
3. **Recently failed PR** — if no PR on current branch, find the most recent failed PR:
   ```bash
   gh run list --repo ZenUml/conf-app --status failure --limit 5 --json databaseId,headBranch,event,createdAt,conclusion,name
   ```
   Filter to runs created within the last 10 minutes. If multiple, pick the most recent.

If no PR is found, tell the user and stop.

### Verify the current test decision

```bash
node scripts/test-selection/pr-decision.mjs sync --pr <PR_NUMBER> --repo ZenUml/conf-app
```

Use the validated decision and candidate identity to build the expected-job set. Labels alone do not authorize tests.

- **Executable subset or approved full:** expect the corresponding preview/staging E2E path and `Pipeline outcome` to succeed, together with the independent basic checks. Draft and Ready have the same test authorization.
- **Missing, stale or triage:** keep/return the PR to Draft. Monitor independent build/unit-test checks, then report **TRIAGE — E2E blocked** with the reason. Do not call `pr-triage` automatically, substitute full coverage, or mark the PR Ready to force execution.

For a missing or stale decision after a push in this workflow, run `pr-labeling`. Stop waiting for E2E if it queues manual triage. A full-suite approval never transfers to a new commit.

## Step 2: Check CI Status

```bash
gh pr checks <PR_NUMBER> --repo ZenUml/conf-app
```

Find the PR-associated validation run for the decision's current candidate. If it needs a fresh run, use `node scripts/test-selection/request-pr-e2e.mjs --pr <PR_NUMBER> --repo ZenUml/conf-app`. A diagnostic workflow dispatch on `main` cannot replace the PR's required checks. Derive expected stages from that run's selected plan, including legitimate empty scopes; do not treat an unexplained E2E skip as a pass.

### Evaluate

- **All expected jobs passed** with an executable current decision and actual E2E evidence: report success and stop. Report independent basic-check success separately when E2E is blocked.
- **Some expected jobs still pending/in_progress**: wait. Use `gh run watch <RUN_ID> --repo ZenUml/conf-app` (10-minute timeout). Then re-evaluate.

> **NEVER trust `gh run watch`'s exit code.** Observed twice on 2026-07-26 on the same run: it exited **0** while the run's conclusion was `failure`, then exited **1** on a re-run whose conclusion was `success`. Believing it would have reported a red main as green. After any watch, always re-read the authoritative value:
> ```bash
> gh run view <RUN_ID> --repo ZenUml/conf-app --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
> gh run view <RUN_ID> --repo ZenUml/conf-app --json jobs \
>   --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | "\(.conclusion)\t\(.name)\t\(.databaseId)"'
> ```
> The same applies to `gh pr checks`, which lists the **cancelled duplicate `push` run's** jobs as `fail`. Resolve the authoritative PR-associated validation run for the current candidate first. On `main`, use the `push` run for the candidate SHA.
- **An expected job failed**: proceed to Step 3.
- **An expected executable E2E stage was unexpectedly skipped:** inspect decision validation, candidate identity, plan and workflow conditions. Report the unexplained skip as a blocker, regardless of Draft/Ready state.

## Step 3: Diagnose Failures

For each failed check, pull the logs:

```bash
gh run view <RUN_ID> --repo ZenUml/conf-app --log-failed
```

Categorize the failure:

| Category | Indicators |
|----------|-----------|
| **Unit test failure** | Failures in `pnpm test:unit`, vitest output |
| **Lint failure** | ESLint errors |
| **Build failure** | Vite build errors, missing imports, TypeScript errors |
| **Staging deploy failure** | Cloudflare Pages publish errors, wrangler errors |
| **E2E test failure** | Playwright failures against staging Confluence — timeouts, element not found, assertion errors |
| **E2E flaky / Confluence infra** | Confluence login failures, OAuth/OTP errors, intermittent network issues, `net::ERR_` errors |
| **Merge conflict** | `CONFLICT`, `merge conflict`, cannot rebase cleanly |
| **Infra/runner** | Network timeouts, runner issues, npm/pnpm cache failures |

## Step 4: Attempt Fix

Before fixing, inspect `git status` and the PR head. Follow the repository worktree policy: use the matching feature worktree, or create an isolated one when the current checkout contains unrelated edits. Fetch the PR branch without moving or stashing another session's changes.

### Fix by Category

#### Unit Test Failure

1. **Reproduce locally**:
   ```bash
   pnpm test:unit
   ```
2. **Fix the code or test**
3. **Verify**: `pnpm test:unit`
4. **Commit and push**

#### Lint Failure

1. **Auto-fix**:
   ```bash
   pnpm lint --fix
   ```
2. **Verify no remaining issues**:
   ```bash
   pnpm lint
   ```
3. **Commit and push** the formatting fixes

#### Build Failure

1. **Reproduce locally** — build the failing variant:
   ```bash
   pnpm build:lite    # or build:full, build:diagramly
   ```
2. **Read the error** — usually missing imports, Vite config issues, or env var problems
3. **Fix, verify locally, commit and push**

#### Staging Deploy Failure

1. **Read the Cloudflare Pages publish error** in the logs
2. Common causes:
   - **Wrangler auth** — usually a CI secret issue, report to user
   - **D1 migration failure** — check `functions/migrations/` for issues
   - **Build artifact missing** — build step may have silently failed
3. If it's a code issue, fix and push. If it's infra/secrets, report to user.

#### E2E Test Failure

E2E tests run against live Confluence staging instances, which makes them inherently more flaky than local tests.

> **Re-run authorization:** reconcile the current test decision before re-running PR E2E. It must still match the PR head and base. A re-run may reuse only the corresponding trusted decision artifacts; missing or mismatched artifacts must block execution rather than run full coverage. If the decision is stale, run `pr-labeling`; full approval requires a new manual triage. Main runs must be re-run whole because their root artifacts are attempt-bound (`gh run rerun <RUN_ID>` without `--failed`); see `docs/ops/pipeline-graphs.md`.

Distinguish between:

- **Deterministic failure** (same test fails consistently, error points to a code bug): Fix the code, not the test. You cannot reproduce these locally easily since they need a deployed staging app + Confluence auth.
- **Flaky failure** (test passed before, no code changes in test area): Re-run the failed jobs (PR run; a `main` run is re-run whole, see above):
  ```bash
  gh run rerun <RUN_ID> --repo ZenUml/conf-app --failed
  ```

Common E2E failure patterns:
- **Macro not found in browser** — macro key or appLabel mismatch after renaming
- **Timeout waiting for iframe** — staging deploy may not have completed, or Confluence is slow
- **Login/auth failure** — OTP rotation or Confluence session issues (infra, not code)
- **Visual snapshot mismatch** — rendering change in the app

#### E2E Flaky / Confluence Infra

**`page.goto: Timeout ... exceeded` is infra, not code.** The navigation itself never completed, so nothing the app does inside the macro iframe can be the cause — do not go looking for a code culprit. Confirmed pattern (2026-07-26): three retries all timing out identically at `page.goto`, *different shards* failing across two runs of near-identical code, and a shard that was green on the PR's own run going red on main. Re-run and move on.

1. **Re-run the failed jobs** (PR run; a `main` run is re-run whole, see the re-run rule above):
   ```bash
   gh run rerun <RUN_ID> --repo ZenUml/conf-app --failed
   ```
2. If it fails again with the same infra error, report to user — this is outside our control.

#### Merge Conflict

1. **Report to user** — do NOT auto-resolve merge conflicts. Show what's conflicting and ask for guidance.

#### Infra/Runner

1. **Re-run the failed job** (PR run; a `main` run is re-run whole, see the re-run rule above):
   ```bash
   gh run rerun <RUN_ID> --repo ZenUml/conf-app --failed
   ```
2. If it fails again with the same infra error, report to user.

## Step 5: Push and Monitor

After applying a fix:

1. **Run local validation** before pushing (when the failure category allows local reproduction):
   ```bash
   pnpm lint          # lint
   pnpm test:unit     # unit tests
   pnpm build:lite    # build check
   ```
2. **Commit with a clear message**:
   ```bash
   git add <specific files>
   git commit -m "fix: <what was fixed> to pass CI"
   ```
3. **Push**:
   ```bash
   git push origin <PR_BRANCH>
   ```
4. **Re-label the new commit** — invoke `pr-labeling`. If it queues manual triage, finish basic checks and report E2E blocked.
5. **Wait for authorized CI** — use `gh run watch` on the new matching run.
6. **Evaluate result** — go back to Step 2

## Step 6: Retry Budget

Track attempts. Each "attempt" is one push-and-wait cycle (or one re-run for flaky failures).

- **Maximum 3 attempts total**
- After each failed attempt, re-diagnose from scratch (Step 3) — the failure mode may have changed
- **If a test passes on retry without code changes**, flag it as potentially flaky:
  > "Test `<name>` passed on retry without changes — likely flaky. Consider investigating stability."
- **After 3 failed attempts**, stop and report:
  - What was tried
  - What the current failure is
  - Your best theory for root cause
  - Suggested next steps for the user

## Step 7: Summary Report

After babysitting completes (success or exhausted retries), produce a brief report:

```
## PR #<number> Babysit Report
- **Status**: [PASSED | TRIAGE — E2E blocked | FAILED after N attempts]
- **Failures found**: <list of categories>
- **Fixes applied**: <list of commits pushed>
- **Flaky tests**: <any tests that passed on retry without changes>
- **Manual attention needed**: <anything unresolved>
```

## Safety Rules

- **Never force-push** — always regular `git push`
- **Never resolve merge conflicts automatically** — report and ask
- **Never push while CI is still running** from a previous attempt — wait for it to finish first
- **Always verify fixes locally** before pushing (except E2E which requires deployed staging)
- **Check for in-progress CI** before pushing — avoid wasting CI minutes on runs that will be superseded
