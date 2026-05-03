---
name: babysit-pr
description: Monitor and fix failing GitHub Actions CI checks on PRs for ZenUml/confluence-plugin-cloud. Use when the user says "babysit PR", "check PR status", "fix CI", "PR is failing", "watch this PR", "why is CI red", or when used with /loop to continuously monitor a PR. Also use when staging deploy failures, E2E test flakiness, lint issues, or unit test failures block merging. Triggers on any PR monitoring, CI failure diagnosis, or automated fix-and-retry workflow.
---

# Babysit PR

Monitor a GitHub Actions PR, diagnose failures, attempt fixes, and retry — up to 3 times total.

## Scope

This skill targets **ZenUml/confluence-plugin-cloud** (conf-app). All commands run from the conf-app directory.

## CI Pipeline Overview

The `Build, Test and Draft Release` workflow runs on every push and does:

1. **Build + unit tests** — `pnpm install` + `pnpm test:unit`
2. **Staging deploy** — 4 variants (lite, full, full-forge, diagramly) deployed to Cloudflare Pages
3. **Staging E2E** — Playwright tests run against live Confluence staging instances for each variant
4. **Draft releases** — created on main only (lite, full, full-forge, diagramly)

Steps 2-4 run in parallel per variant. E2E depends on its variant's staging deploy + build passing.

## Step 1: Find the PR

Resolve which PR to babysit, in this priority order:

1. **Explicit PR number** — if the user provided one (e.g., `#123`), use it
2. **Current branch PR** — run `gh pr view --json number,title,headRefName,state,isDraft,statusCheckRollup`
   > **WARNING**: Do NOT add `--repo` to this command. `gh pr view` without `--repo` infers the repo from the current directory's git remote, which is correct. Adding `--repo` requires an explicit PR number/branch argument and breaks branch inference, causing "argument required when using the --repo flag".
3. **Recently failed PR** — if no PR on current branch, find the most recent failed PR:
   ```bash
   gh run list --repo ZenUml/confluence-plugin-cloud --status failure --limit 5 --json databaseId,headBranch,event,createdAt,conclusion,name
   ```
   Filter to runs created within the last 10 minutes. If multiple, pick the most recent.

If no PR is found, tell the user and stop.

### Note the PR's draft state

After finding the PR, check `isDraft`. This affects which jobs are expected to run:

| State | Jobs that run | Jobs that are `skipped` (and that's fine) |
|---|---|---|
| **Draft** | `Build and Unit Test`, `Deploy: Lite` | `E2E: Lite` (and Full/Diagramly variants — those skip on any feature branch) |
| **Ready for Review** | `Build`, `Deploy: Lite`, `E2E: Lite` | Full/Diagramly variants only |

When watching a Draft PR, do NOT wait for `E2E: Lite` — it will be `skipped`, which is the designed behaviour, not a failure. If the user expected E2E to run, suggest marking the PR Ready for Review (`gh pr ready <PR>`) or running `/ship-branch`.

## Step 2: Check CI Status

```bash
gh pr checks <PR_NUMBER> --repo ZenUml/confluence-plugin-cloud
```

### Build the expected-jobs set FIRST, based on draft state

This is the most important step — your evaluation of "did CI pass?" depends on it.

- **`isDraft === true`**: expected jobs = `Build and Unit Test`, `Deploy: Lite / deploy`. `E2E: Lite / test` is **expected to be `skipped`** — treat that as success, not failure, and never wait for it. (Full/Diagramly variants always skip on feature branches regardless of draft state.)
- **`isDraft === false` (Ready)**: expected jobs = `Build and Unit Test`, `Deploy: Lite / deploy`, `E2E: Lite / test`. All three must reach success. Full/Diagramly skip as today.

### Evaluate

- **All expected jobs passed** (and skipped jobs are the right ones): report success and stop.
- **Some expected jobs still pending/in_progress**: wait. Use `gh run watch <RUN_ID> --repo ZenUml/confluence-plugin-cloud` (10-minute timeout). Then re-evaluate.
- **An expected job failed**: proceed to Step 3.
- **An expected job was unexpectedly `skipped`** (e.g. `E2E: Lite` skipped on a Ready PR): this is a configuration bug, not a normal failure. Report it: "Expected `E2E: Lite` to run on this Ready PR but it was skipped — check the workflow `if:` condition or the PR's draft state."

## Step 3: Diagnose Failures

For each failed check, pull the logs:

```bash
gh run view <RUN_ID> --repo ZenUml/confluence-plugin-cloud --log-failed
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

**Important**: Before fixing, make sure the local branch is up to date with the PR branch:
```bash
git fetch origin && git checkout <PR_BRANCH> && git pull origin <PR_BRANCH>
```

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

E2E tests run against live Confluence staging instances, which makes them inherently more flaky than local tests. Distinguish between:

- **Deterministic failure** (same test fails consistently, error points to a code bug): Fix the code, not the test. You cannot reproduce these locally easily since they need a deployed staging app + Confluence auth.
- **Flaky failure** (test passed before, no code changes in test area): Re-run the failed jobs:
  ```bash
  gh run rerun <RUN_ID> --repo ZenUml/confluence-plugin-cloud --failed
  ```

Common E2E failure patterns:
- **Macro not found in browser** — macro key or appLabel mismatch after renaming
- **Timeout waiting for iframe** — staging deploy may not have completed, or Confluence is slow
- **Login/auth failure** — OTP rotation or Confluence session issues (infra, not code)
- **Visual snapshot mismatch** — rendering change in the app

#### E2E Flaky / Confluence Infra

1. **Re-run the failed jobs**:
   ```bash
   gh run rerun <RUN_ID> --repo ZenUml/confluence-plugin-cloud --failed
   ```
2. If it fails again with the same infra error, report to user — this is outside our control.

#### Merge Conflict

1. **Report to user** — do NOT auto-resolve merge conflicts. Show what's conflicting and ask for guidance.

#### Infra/Runner

1. **Re-run the failed job**:
   ```bash
   gh run rerun <RUN_ID> --repo ZenUml/confluence-plugin-cloud --failed
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
4. **Wait for CI** — use `gh run watch` on the new run
5. **Evaluate result** — go back to Step 2

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
- **Status**: [PASSED | FAILED after N attempts]
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
