---
name: ship-branch
description: Ship the current branch from local validation through to merged on master with staging deployed and draft releases created. Orchestrates validate-branch, submit-branch, and land-pr in sequence. Use when the user says "ship", "ship it", "ship this branch", "merge this", or wants to go from local branch to merged in one command. Stops at the first failure. Does NOT deploy to production — use /release-app after shipping.
---

# Ship Branch

Orchestrate the full path from local branch to merged on master. This skill composes sub-skills in sequence, stopping at the first failure.

**Note:** This gets your code to master with staging deployed and draft releases created. Production deployment is a separate step via `/release-app`.

## Pre-flight: uncommitted work on `main` or `master`

Before Step 1, if `git status` shows uncommitted changes **and** the current branch is the default trunk (`main` or `master` — whichever this repo uses):

1. **Do not** run `git add -A`, `git add .`, or otherwise stage all unstaged files by default.
2. **Decide the changeset from conversation history:** infer which files and edits belong to the task the user asked to ship (this session and prior turns). Stage **only** those paths with explicit `git add <path> …`. Untracked junk, unrelated edits, or parallel experiments stay out unless the user clearly included them.
3. **If it is ambiguous** which dirty files belong to this ship (e.g. mixed topics, unclear scope, or many unrelated diffs), **stop and ask** what to include before branching or committing.
4. **Branch vs trunk:**
   - **Repo-wide meta only — may stay on trunk:** If **all** scoped changes are skill updates (e.g. `.claude/skills/**`) and/or documentation that applies to the **whole repo** (not tied to a specific product feature), you **may** commit directly on `main`/`master` and ship **from that branch** — no separate feature branch required.
   - **Feature or product code:** Otherwise **create a feature branch first** — do not commit product/feature work directly on the trunk. Pick a short descriptive name aligned with the work being shipped.

After you know whether you are on trunk (allowed case) or on a feature branch, and the intentional paths are staged, commit with a message that matches the scoped work, then continue with the flow below.

## Flow

```
validate-branch → FAIL → stop, report
     | PASS
submit-branch (as Ready, not Draft) → FAIL → stop, report
     | single CI run with E2E included
babysit-pr → EXHAUSTED → stop, "CI blocked"
     | GREEN (incl. E2E)
land-pr → BLOCKED → stop, report
     | MERGED
     done → suggest /release-app if production deploy is needed
```

## Steps

### Step 1: Validate locally

Invoke `/validate-branch`. If it reports FAIL, stop and show the failure. Fix locally before shipping.

### Step 2: Submit as PR — Ready, not Draft

Push the branch and create the PR as **Ready for Review** (omit `--draft`). Ship-branch means immediate landing intent — there's no iterative phase, so Draft would only generate a redundant `ready_for_review` event when we flip it, triggering two CI runs unnecessarily.

```bash
git push -u origin <branch>
gh pr create --base master --title "<title>" --body "..."
```

Note: `/submit-branch` defaults to Draft. Override it here by running `gh pr create` directly without `--draft`. If a PR already exists for the branch, check its draft state — if Draft, flip it Ready now (`gh pr ready <PR>`), then proceed.

On success, note the PR number and URL.

### Step 3: Get CI green

Invoke `/babysit-pr` with the PR number from Step 2. It will monitor CI (E2E runs because the PR is Ready from the start), diagnose failures, attempt fixes (up to 3 retries), and report back.

If babysit-pr exhausts all 3 retry attempts, stop and report "CI blocked" with the babysit report.

### Step 4: Land and verify

**Confirm with the user before merging** unless they explicitly said "ship it".

Invoke `/land-pr` with the PR number. If merge is blocked, stop and report.

On success, report the draft releases created and suggest `/release-app` if the user wants to go to production.

## Rules

- **Trunk + dirty tree:** Stage only conversation-scoped files; ask when scope is unclear. Branch off for feature work; **skills-only or repo-wide docs-only** may commit on `main`/`master` and ship from trunk.
- **Each step is a hard boundary.** No step reaches back to retry a previous step.
- **No auto-rollback.** Stop and report on any failure. The developer decides next steps.
- **Confirm before merge.** Pause and confirm with the user before the land-pr step unless they explicitly said "ship it".

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
