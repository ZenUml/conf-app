---
name: ship-branch
description: Create a branch, run local validation, create a PR and **merge** on main 
  with staging deployed and draft releases created. Use when the user says "ship", "ship it", "ship this branch",
  "merge this", or wants to go from local branch to merged in one command. Fixes actionable local validation
  failures in a bounded loop, then stops at the first unrecoverable failure.
  Does NOT deploy to production — use /release-app after shipping.
---

# Ship Branch

Orchestrate the full path from local branch to merged on main. This skill composes sub-skills in sequence, stopping at the first failure.

**Note:** This gets your code to main with staging deployed and draft releases created. Production deployment is a separate step via `/release-app`.

**Markdown-only exception:** If the entire PR diff is Markdown files only, and does not include `CHANGELOG.md`, the repo's `Build, Test and Draft Release` workflow is intentionally skipped by `paths-ignore`. In that case, do not wait for green CI and do not require `/land-pr`'s `E2E: Lite` precondition. Run local validation, submit the PR as Ready, verify the PR is mergeable, merge it directly, and report CI/staging/draft releases as skipped by path filters.

## Flow

```
validate-branch → FAIL → fix local issue → revalidate (max 3 attempts)
     | unrecoverable/exhausted → stop, report
     | PASS
submit-branch (as Ready, not Draft) → FAIL → stop, report
     | single CI run with E2E included
babysit-pr → EXHAUSTED → stop, "CI blocked"
     | GREEN (incl. E2E)
land-pr → BLOCKED → stop, report
     | MERGED
     done → suggest /release-app if production deploy is needed
```

Markdown-only flow:

```
validate-branch → FAIL → fix local issue → revalidate (max 3 attempts)
     | unrecoverable/exhausted → stop, report
     | PASS
submit-branch (as Ready, not Draft) → FAIL → stop, report
     | PR mergeable
merge directly → MERGED
     done → report CI/staging/draft releases skipped by path filters
```

## Steps

### Step 0: Create branch

If the current branch is main, create a new branch from it.

### Step 1: Validate locally

Invoke `/validate-branch`.

If it reports FAIL, diagnose and fix actionable repository-local issues before stopping:

1. Confirm the failure is reproducible and identify the exact files or commands involved.
2. Make the smallest safe fix. Do not skip checks, weaken assertions, disable lint rules, or hide failures.
3. Re-run `/validate-branch` from the beginning after the fix.
4. Repeat for at most 3 fix-and-revalidate attempts.

The shipping request authorizes these minimal local validation fixes, including pre-existing lint,
test, type, or build issues encountered on the branch. Keep them separate from the feature change
when practical and report them in the PR body.

Stop and report validation as blocked when any of these applies:

- 3 fix attempts are exhausted;
- the fix needs credentials, external coordination, destructive action, or a product decision;
- the required change is materially broader than making the current branch pass validation.

### Step 2: Submit as PR — Ready, not Draft

Push the branch and create the PR as **Ready for Review** (omit `--draft`). Ship-branch means immediate landing intent — there's no iterative phase, so Draft would only generate a redundant `ready_for_review` event when we flip it, triggering two CI runs unnecessarily.

```bash
git push -u origin <branch>
gh pr create --base main --title "<title>" --body "..."
```

Note: `/submit-branch` defaults to Draft. Override it here by running `gh pr create` directly without `--draft`. If a PR already exists for the branch, check its draft state — if Draft, flip it Ready now (`gh pr ready <PR>`), then proceed.

On success, note the PR number and URL.

### Step 3: Get CI green

Before invoking `/babysit-pr`, check whether the PR is Markdown-only:

```bash
gh pr diff <PR_NUMBER> --name-only
```

If every changed file ends in `.md` and none is `CHANGELOG.md`, skip `/babysit-pr`. The main workflow has `paths-ignore` for Markdown docs, so there is no green CI to wait for. Record `CI: SKIPPED — markdown-only path filters`.

Invoke `/babysit-pr` with the PR number from Step 2. It will monitor CI (E2E runs because the PR is Ready from the start), diagnose failures, attempt fixes (up to 3 retries), and report back.

If babysit-pr exhausts all 3 retry attempts, stop and report "CI blocked" with the babysit report.

### Step 4: Land and verify

**Confirm with the user before merging** unless they explicitly said "ship it".

For non-Markdown changes, invoke `/land-pr` with the PR number. If merge is blocked, stop and report.

For Markdown-only changes, do not invoke `/land-pr`; its E2E precondition cannot be satisfied because CI is intentionally skipped. Instead:

1. Verify the PR is Ready, mergeable, and has no requested-changes review:
   ```bash
   gh pr view <PR_NUMBER> --json state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
   ```
2. Fetch the repo's enabled merge strategies and merge directly:
   ```bash
   MERGE_FLAG=$(gh api repos/ZenUml/conf-app \
     --jq 'if .allow_squash_merge and (.allow_merge_commit | not) and (.allow_rebase_merge | not) then "--squash"
           elif .allow_rebase_merge and (.allow_merge_commit | not) and (.allow_squash_merge | not) then "--rebase"
           else "--merge" end')

   gh pr merge <PR_NUMBER> --delete-branch $MERGE_FLAG
   ```

   **Drop `--delete-branch` if any open PR is stacked on this branch** — deleting the base
   closes the child PR permanently (it can't be reopened or retargeted; #410 → #412, 2026-07-29).
   Check with `gh pr list --state open --base "$(gh pr view <PR_NUMBER> --json headRefName -q .headRefName)"`.
   Full recovery order: see the **land-pr** skill.
3. Verify the PR state is `MERGED`.
4. Report `Staging` and `Draft releases` as `SKIPPED — markdown-only path filters`.

On success, report the draft releases created and suggest `/release-app` if the user wants to go to production.

## Rules

- **Each step is a hard boundary.** Only Step 1's bounded local-fix loop and Step 3's CI-fix loop may retry within their own step.
- **No auto-rollback.** Stop and report on any failure. The developer decides next steps.
- **Confirm before merge.** Pause and confirm with the user before the land-pr step unless they explicitly said "ship it".

## Output

Final report:

```
## Ship Report: <branch-name>
- Validation: PASS
- PR: #<number> (<url>)
- CI: GREEN
- Merge: SQUASHED into main (<sha>)
- Staging: Deployed (lite, full, diagramly)
- Draft releases: Created
- Production: Not yet — run /release-app to deploy to production
```

Markdown-only report:

```
## Ship Report: <branch-name>
- Validation: PASS
- PR: #<number> (<url>)
- CI: SKIPPED — markdown-only path filters
- Merge: MERGED into main (<sha>)
- Staging: SKIPPED — markdown-only path filters
- Draft releases: SKIPPED — markdown-only path filters
- Production: Not needed for docs-only changes
```

Or on failure:

```
## Ship Report: <branch-name>
- Validation: PASS
- PR: #<number>
- CI: FAILED — <job name>
- Stopped at: <step name>
- Details: <failure summary>
```
