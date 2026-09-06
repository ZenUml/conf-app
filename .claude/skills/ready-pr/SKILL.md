---
name: ready-pr
description: Mark a Draft PR as Ready for Review on ZenUml/conf-app so the next CI run includes E2E. Use when the user says "mark ready", "ready PR", "ready for review", "trigger e2e", "run e2e on this PR", "open it up for review", or wants to verify with E2E without committing to a merge yet. Useful mid-development when you don't want to wait until the last minute to find out if E2E passes.
---

# Ready PR

Flip a Draft PR to Ready for Review on `ZenUml/conf-app`. This kicks off a fresh `Build, Test and Draft Release` CI run that includes `E2E: Lite` (which is gated to only run on non-Draft PRs).

## When to use

- You want E2E to verify your changes but you're not yet committing to a merge.
- You want to share the PR with a reviewer.
- The CI signal you'd otherwise wait until merge time for.

## When NOT to use

- You're ready to merge — use `/ship-branch` or `/land-pr` instead. Both auto-flip Draft → Ready as part of their flow.
- You want to rebuild without changing PR state — push an empty commit or re-run the workflow manually.

## Steps

### 1. Resolve which PR

In priority order:
1. Explicit PR number from the user (e.g. `#123`).
2. PR for the current branch: `gh pr view --json number,isDraft,headRefName`.

If no PR is found, tell the user and stop.

### 2. Check current state

```bash
gh pr view <PR_NUMBER> --json number,isDraft,title,url --repo ZenUml/conf-app
```

If `isDraft === false`, the PR is already Ready — report that and stop. (No need to spend a CI run for nothing.)

### 3. Mark Ready

```bash
gh pr ready <PR_NUMBER> --repo ZenUml/conf-app
```

### 4. Babysit CI (always)

The whole point of flipping to Ready is the `E2E: Lite` signal, so **always** carry through to that
signal — invoke the `babysit-pr` skill with the PR number:

```
/babysit-pr <PR_NUMBER>
```

It monitors the new `Build, Test and Draft Release` run, diagnoses any failure, and attempts fixes
(up to 3 attempts). On a Ready PR the expected jobs are `Build and Unit Test`, `Deploy: Lite / deploy`
and `E2E: Lite / test` — all three must reach success; Full/Diagramly/AsyncAPI still skip on a feature
branch. Do not stop at "marked Ready"; carry through until babysit-pr reports PASSED or exhausts its
retry budget.

Skip this step only if the user explicitly said "don't babysit" / "just mark it ready".

### 5. Report

Tell the user:

- The PR is now Ready for Review (with the URL).
- The full pipeline including `E2E: Lite` takes ~14 min wall-clock.
- **The babysit-pr result** (PASSED / failures + fixes / retries exhausted).

## Does NOT

- Push commits (use `/submit-branch`)
- Merge (use `/land-pr` or `/ship-branch`)
- Convert back to Draft — that's a separate action; use `gh pr ready --undo <PR>` directly if needed

CI watching and fixing is delegated to `babysit-pr` in Step 4, not done by this skill directly.
