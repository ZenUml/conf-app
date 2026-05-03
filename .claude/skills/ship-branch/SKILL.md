---
name: ship-branch
description: Ship the current branch from local validation through to merged on master with staging deployed and draft releases created. Orchestrates validate-branch, submit-branch, and land-pr in sequence. Use when the user says "ship", "ship it", "ship this branch", "merge this", or wants to go from local branch to merged in one command. Stops at the first failure. Does NOT deploy to production — use /release-app after shipping.
---

# Ship Branch

Orchestrate the full path from local branch to merged on master. This skill composes sub-skills in sequence, stopping at the first failure.

**Note:** This gets your code to master with staging deployed and draft releases created. Production deployment is a separate step via `/release-app`.

## Flow

```
on trunk with dirty tree? → YES → branch or stay (meta-only), selective stage, commit
     | NO (already on feature branch, clean tree)
     ↓
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

### Step 0 (conditional): Uncommitted work on trunk

Skip if already on a feature branch with a clean worktree. Otherwise, if `git status` shows any modified, untracked, or staged-but-not-committed files **and** the current branch is the default trunk (`main` or `master`):

1. **Branch vs trunk — decide first:**
   - **Repo-wide meta only — may stay on trunk:** If **all** scoped changes are skill updates (e.g. `.claude/skills/**`) and/or documentation that applies to the **whole repo** (not tied to a specific product feature), you **may** commit directly on `main`/`master` and ship from there — no separate feature branch required.
   - **Feature or product code:** Create a feature branch first. Do not commit product/feature work directly on the trunk. Pick a short descriptive name aligned with the work being shipped.
2. **Do not** run `git add -A`, `git add .`, or otherwise stage everything by default.
3. **Decide the changeset from conversation history:** infer which files and edits belong to the task the user asked to ship (this session and prior turns). Stage **only** those paths with explicit `git add <path> …`. Untracked junk, unrelated edits, or parallel experiments stay out unless the user clearly included them.
4. **If it is ambiguous** which dirty files belong to this ship (e.g. mixed topics, unclear scope, or many unrelated diffs), **stop and ask** what to include before branching or committing.

Once the right branch is active and the intentional paths are staged, commit with a message that matches the scoped work.

### Step 1: Validate locally

Invoke `/validate-branch`. If it reports FAIL, stop and show the failure. Fix locally before shipping.

### Step 2: Submit as PR — Ready, not Draft

Invoke `/submit-branch` with explicit intent to open as **Ready for Review** (not Draft). Ship-branch means immediate landing intent — Draft would only force a redundant `ready_for_review` flip later, triggering two CI runs unnecessarily.

Pass the instruction: *"submit as ready"* so submit-branch omits `--draft`. If a PR already exists for this branch and is still Draft, flip it: `gh pr ready <PR>`.

On success, note the PR number and URL.

### Step 3: Get CI green

Invoke `/babysit-pr` with the PR number from Step 2. It will monitor CI (E2E runs because the PR is Ready from the start), diagnose failures, attempt fixes (up to 3 retries), and report back.

If babysit-pr exhausts all 3 retry attempts, stop and report "CI blocked" with the babysit report.

### Step 4: Land and verify

Invoke `/land-pr` with the PR number. If merge is blocked, stop and report.

**Exception — babysit-pr pushed fixes:** If Step 3 required babysit-pr to commit code changes to get CI green, pause before merging. Summarise what was changed and ask the user to confirm before proceeding.

On success, report the draft releases created and suggest `/release-app` if the user wants to go to production.

## Rules

- **Trunk + dirty tree:** Stage only conversation-scoped files; ask when scope is unclear. Branch off for feature work; **skills-only or repo-wide docs-only** may commit on `main`/`master` and ship from trunk.
- **Each step is a hard boundary.** No step reaches back to retry a previous step.
- **No auto-rollback.** Stop and report on any failure. The developer decides next steps.

## Output

Final report:

```
## Ship Report: <branch-name>
- Validation: PASS
- PR: #<number> (<url>)
- CI: GREEN
- Merge: MERGED into master (<sha>)
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
