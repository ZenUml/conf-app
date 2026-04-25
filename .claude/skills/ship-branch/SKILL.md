---
name: ship-branch
description: Ship the current branch from local validation through to merged on master with staging deployed and draft releases created. Orchestrates validate-branch, submit-branch, and land-pr in sequence. Use when the user says "ship", "ship it", "ship this branch", "merge this", or wants to go from local branch to merged in one command. Stops at the first failure. Does NOT deploy to production — use /release-app after shipping.
---

# Ship Branch

Orchestrate the full path from local branch to merged on master. This skill composes sub-skills in sequence, stopping at the first failure.

**Note:** This gets your code to master with staging deployed and draft releases created. Production deployment is a separate step via `/release-app`.

## Flow

```
validate-branch → FAIL → stop, report
     | PASS
submit-branch → FAIL → stop, report
     | PR ready (Draft by default)
mark Ready for Review → so E2E will run on the next CI cycle
     |
babysit-pr → EXHAUSTED → stop, "CI blocked"
     | GREEN (incl. E2E)
land-pr → BLOCKED → stop, report
     | MERGED
     done → suggest /release-app if production deploy is needed
```

## Steps

### Step 1: Validate locally

Invoke `/validate-branch`. If it reports FAIL, stop and show the failure. Fix locally before shipping.

### Step 2: Submit as PR

Invoke `/submit-branch`. If it reports FAILED, stop and show what went wrong (dirty worktree, push conflict, etc.).

On success, note the PR number and URL. The PR is created as Draft (so iterative pushes don't trigger E2E).

### Step 3: Mark Ready for Review

`/ship-branch` means "I want this merged" — so flip the PR out of Draft now. This triggers a fresh CI run that includes `E2E: Lite`, which `/land-pr` requires before merge.

```bash
gh pr ready <PR_NUMBER> --repo ZenUml/confluence-plugin-cloud
```

If the PR is already Ready, this is a no-op — proceed.

### Step 4: Get CI green

Invoke `/babysit-pr` with the PR number from Step 2. It will monitor CI (now including E2E since the PR is Ready), diagnose failures, attempt fixes (up to 3 retries), and report back.

If babysit-pr exhausts all 3 retry attempts, stop and report "CI blocked" with the babysit report.

### Step 5: Land and verify

**Confirm with the user before merging** unless they explicitly said "ship it".

Invoke `/land-pr` with the PR number. If merge is blocked, stop and report.

On success, report the draft releases created and suggest `/release-app` if the user wants to go to production.

## Rules

- **Each step is a hard boundary.** No step reaches back to retry a previous step.
- **No auto-rollback.** Stop and report on any failure. The developer decides next steps.
- **Confirm before merge.** Pause and confirm with the user before Step 4 unless they explicitly said "ship it".

## Output

Final report:

```
## Ship Report: <branch-name>
- Validation: PASS
- PR: #<number> (<url>)
- CI: GREEN
- Merge: SQUASHED into master (<sha>)
- Staging: Deployed (lite, full, full-forge, diagramly)
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
