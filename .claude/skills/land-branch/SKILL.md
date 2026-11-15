---
name: land-branch
description: Create a branch, run local validation, create a PR and **merge** on main 
  with staging deployed and draft releases created. Use when the user says "land", "land it", "land this branch",
  "merge this", or wants to go from local branch to merged in one command. Fixes actionable local validation
  failures in a bounded loop, then stops at the first unrecoverable failure.
  Does NOT deploy to production — use /release-app after shipping.
---

# Land Branch

Orchestrate the full path from local branch to merged on main. This skill composes sub-skills in sequence, stopping at the first failure.

**Note:** This gets your code to main with staging deployed and draft releases created. Production deployment is a separate step via `/release-app`.

**Test decision:** Every PR starts Draft and needs an executable decision for its current head and base before E2E or landing. Independent workflows can still skip documentation-only changes by their own path filters; that does not bypass the test-decision check.

## Flow

```
validate-branch → FAIL → fix local issue → revalidate (max 3 attempts)
     | unrecoverable/exhausted → stop, report
     | PASS
submit-branch (Draft → pr-labeling) → FAIL → stop, report
     | TRIAGE → stop, report E2E blocked
     | executable current-commit decision
babysit-pr → EXHAUSTED → stop, "CI blocked"
     | GREEN (incl. E2E)
land-pr → BLOCKED → stop, report
     | MERGED
     done → suggest /release-app if production deploy is needed
```

## Steps

### Step 0: Create branch

Follow the repository overlap scan and worktree policy. Keep the primary checkout on `main`; use an isolated feature worktree and preserve unrelated edits.

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

### Step 2: Submit as a Draft PR and label the current commit

Invoke `/submit-branch`. It pushes the branch, creates or reuses the PR, invokes `pr-labeling` and monitors executable CI. Every new PR starts Draft, including for immediate landing.

If the result is `test:triage`, keep the PR Draft and report **MERGE BLOCKED — manual test triage required**. A landing request does not invoke `pr-triage` automatically or approve full coverage. Only an explicit user request starts that skill.

On success, record the PR number, URL, current head/base and published decision. Test authorization and Ready for Review are separate: an executable decision permits E2E while Draft.

### Step 3: Get current-commit CI green

Invoke `/babysit-pr` if submission has not already completed that monitoring. Require an executable current decision and the matching PR-associated validation/E2E evidence. Use `request-pr-e2e.mjs` through `pr-labeling` to start fresh PR checks; a diagnostic dispatch on `main` cannot replace them.

After every fix push, invoke `pr-labeling` again. A new full-suite decision requires fresh manual triage; previous approval does not transfer. If babysit-pr exhausts its 3-attempt budget, stop and report "CI blocked" with its report. Marking Ready cannot resolve a blocked test decision.

### Step 4: Land and verify

**Confirm with the user before merging** unless they explicitly said "land it".

Invoke `/land-pr` with the PR number. It rechecks the current decision and required checks, marks Ready when appropriate, and handles merge strategy, stacked-branch deletion safeguards and main CI verification. If merge is blocked, stop and report.

On success, report the draft releases created and suggest `/release-app` if the user wants to go to production.

## Rules

- **Each step is a hard boundary.** Only Step 1's bounded local-fix loop and Step 3's CI-fix loop may retry within their own step.
- **No auto-rollback.** Stop and report on any failure. The developer decides next steps.
- **Confirm before merge.** Pause and confirm with the user before the land-pr step unless they explicitly said "land it".

## Output

Final report:

```
## Ship Report: <branch-name>
- Validation: PASS
- PR: #<number> (<url>)
- CI: GREEN
- Test decision: <selected subset | full approved>, <head SHA>
- Merge: MERGED into main (<sha>)
- Staging: Deployed (lite, full, diagramly)
- Draft releases: Created
- Production: Not yet — run /release-app to deploy to production
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
