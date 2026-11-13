---
name: land-pr
description: Merge a green PR to main and verify CI succeeds (staging deploy + draft releases). Use when the user says "merge", "land", "land PR", "merge this", or when a PR has passed CI and is ready to merge. This does NOT deploy to production — use /release-app for that.
---

# Land PR

Merge a green PR to `main` and verify CI succeeds. In this repo, **merge to main triggers staging deploys and creates draft releases** — it does NOT deploy to production. Production release is a separate step via `/release-app`.

## What happens on merge to main

1. Build + unit tests
2. Deploy all 3 variants (lite, full, diagramly) to Cloudflare staging
3. Run E2E tests against staging Confluence instances
4. Create draft GitHub releases for each variant (lite, full, diagramly)

Production deployment requires manually publishing those draft releases (or using `/release-app`).

## Preconditions

```bash
gh pr view <PR_NUMBER> --json state,isDraft,mergeable,statusCheckRollup,reviewDecision
```

Verify ALL of these:

1. **PR is the right one** — confirm PR number with the user if ambiguous
2. **No pending reviews** — no requested changes outstanding
3. **Branch is up to date** — no merge conflicts with main
4. **Current test decision is executable and its CI is green** — see Steps 1–2 below

If a precondition fails (other than Draft), report which one and stop.

## Steps

### 1. Verify the test decision, then mark Ready if needed

Reconcile the current decision before any Ready or merge action:

```bash
node scripts/test-selection/pr-decision.mjs sync --pr <PR_NUMBER> --repo ZenUml/conf-app
```

If it is missing or stale, use `pr-labeling` for the current commit. If the result is `test:triage`, keep the PR Draft and report **MERGE BLOCKED — manual test triage required**. A landing request does not automatically invoke `pr-triage` or approve full coverage.

With an executable decision, `/land-pr` authorizes marking Draft → Ready:

```bash
gh pr ready <PR_NUMBER> --repo ZenUml/conf-app
```

Skip this mutation if already Ready. E2E can already have run while Draft; readiness does not grant test permission.

### 2. Verify current-commit CI green

Use `babysit-pr` to verify the current decision's PR validation and E2E results. Require the matching candidate's `Pipeline outcome` and authorized E2E execution to succeed. A skipped E2E path or passing build/unit tests alone does not satisfy the E2E gate. Recheck the decision after any push; full approval requires fresh manual triage for the new commit.

Re-run the preconditions. If the decision or required checks are unresolved, stop and report before merging.

### 3. Merge

Fetch the repo's enabled merge strategies and pick the right flag (GitHub requires one when multiple strategies are enabled):

```bash
MERGE_FLAG=$(gh api repos/ZenUml/conf-app \
  --jq 'if .allow_squash_merge and (.allow_merge_commit | not) and (.allow_rebase_merge | not) then "--squash"
        elif .allow_rebase_merge and (.allow_merge_commit | not) and (.allow_squash_merge | not) then "--rebase"
        else "--merge" end')

gh pr merge <PR_NUMBER> --auto --delete-branch $MERGE_FLAG
```

Logic: use `--squash` if only squash is enabled, `--rebase` if only rebase is enabled, otherwise `--merge` (GitHub's default when multiple strategies are on). Do not override with `--squash` or `--rebase` unless the user explicitly requests it.

**NEVER pass `--delete-branch` while another open PR uses this branch as its base.** Deleting the base branch makes GitHub **close** the stacked child PR, and a closed PR can be neither reopened (`reopenPullRequest` fails) nor retargeted (`Cannot change the base branch of a closed pull request`) — the only recovery is recreating it, losing its number, review history, and comments. Check first, and drop the flag if anything comes back:

```bash
HEAD_REF=$(gh pr view <PR_NUMBER> --repo ZenUml/conf-app --json headRefName -q .headRefName)
gh pr list --repo ZenUml/conf-app --state open --base "$HEAD_REF" --json number,title
```

Correct order for a stack: merge the parent **without** `--delete-branch` → retarget each child (`gh api -X PATCH repos/ZenUml/conf-app/pulls/<child> -f base=main`; the `gh pr edit --base` path can silently no-op) → then `git push origin --delete "$HEAD_REF"`.

_(2026-07-29: merging #409 with `--delete-branch` closed stacked #410; it had to be recreated as #412.)_

Using `--auto` arms auto-merge so GitHub merges when all checks pass.

### 4. Wait for merge

```bash
gh pr view <PR_NUMBER> --json state
```

Poll until state is `MERGED`. Timeout after 5 minutes.

### 5. Monitor CI on main

After merge, the `Build, Test and Draft Release` workflow runs on main. Watch it:

```bash
gh run list --repo ZenUml/conf-app --branch main --limit 1 --json databaseId,status,conclusion
gh run watch <RUN_ID> --repo ZenUml/conf-app
```

### 5. Verify draft releases created

```bash
gh release list --repo ZenUml/conf-app --limit 4
```

Confirm draft releases were created for the expected variants.

### 6. Name the next release step in canary order

Before offering any production release, invoke the **release-app** skill in `preflight` mode (read-only) and read its canary order ("Variants & gates"). Do not compose release options from memory.

The order is **diagramly → lite → full**: Diagramly first (canary, fewest users); Lite only after Diagramly is published for the same commit SHA (same session allowed); Full only ≥ 24 hours after Lite for that SHA, never in the same session. AsyncAPI is independent. Offer the release options in that order, recommend Diagramly first, and never offer Lite or Full as the first step. Publishing still needs an explicit user trigger.

_(2026-09-15: after landing #689 the report offered "release Lite" first, skipping the Diagramly canary.)_

## Output

Report one of:

- **LANDED** — merged, staging deployed, draft releases created; next release step named per Step 6
- **MERGE BLOCKED** — which precondition failed
- **CI FAILED** — merged but CI failed on main, with error details

## On CI failure on main

**Do NOT auto-rollback.** Report:

1. The merge commit SHA
2. The failing workflow run URL
3. Which job failed (build, staging deploy, E2E, or draft release)
4. The error output

The user decides whether to hotfix or revert.

## Does NOT

- Deploy to production (use `/release-app` for that)
- Fix CI failures
- Create PRs (use `/submit-branch`)
- Run local tests (use `/validate-branch`)
