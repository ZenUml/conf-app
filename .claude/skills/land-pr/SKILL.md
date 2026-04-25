---
name: land-pr
description: Merge a green PR to master and verify CI succeeds (staging deploy + draft releases). Use when the user says "merge", "land", "land PR", "merge this", or when a PR has passed CI and is ready to merge. This does NOT deploy to production — use /release-app for that.
---

# Land PR

Merge a green PR to `master` and verify CI succeeds. In this repo, **merge to master triggers staging deploys and creates draft releases** — it does NOT deploy to production. Production release is a separate step via `/release-app`.

## What happens on merge to master

1. Build + unit tests
2. Deploy all 4 variants (lite, full, full-forge, diagramly) to Cloudflare staging
3. Run E2E tests against staging Confluence instances
4. Create draft GitHub releases for each variant (lite, full, full-forge, diagramly)

Production deployment requires manually publishing those draft releases (or using `/release-app`).

## Preconditions

```bash
gh pr view <PR_NUMBER> --json state,isDraft,mergeable,statusCheckRollup,reviewDecision
```

Verify ALL of these:

1. **PR is the right one** — confirm PR number with the user if ambiguous
2. **No pending reviews** — no requested changes outstanding
3. **Branch is up to date** — no merge conflicts with master
4. **CI is green AFTER the Draft gate is lifted** — see Step 1 below

If a precondition fails (other than Draft), report which one and stop.

## Steps

### 1. Lift the Draft gate if needed

If `isDraft === true`, this PR has not been E2E-verified (the Draft gate skips `E2E: Lite`). `/land-pr` means "I want this merged" — so flip it Ready, wait for the resulting CI run with E2E to go green, then merge. Don't refuse and don't merge without verification.

```bash
gh pr ready <PR_NUMBER> --repo ZenUml/confluence-plugin-cloud
```

Tell the user: "PR is Draft → marking Ready and waiting for CI (~14 min) to verify E2E before merge."

Then delegate to `/babysit-pr <PR>` (or watch inline). If the new CI run fails, stop and report — do not merge.

If `isDraft === false` already, skip this step.

### 2. Verify CI green

Confirm CI is green and `E2E: Lite` is among the passed checks (not skipped). Re-run the precondition checks. If anything is not green, stop and report.

### 3. Merge

Use the repo's default merge strategy — do not pass `--squash` or `--rebase` unless the user explicitly requests it.

```bash
gh pr merge <PR_NUMBER> --auto --delete-branch
```

Using `--auto` arms auto-merge so GitHub merges when all checks pass.

### 4. Wait for merge

```bash
gh pr view <PR_NUMBER> --json state
```

Poll until state is `MERGED`. Timeout after 5 minutes.

### 5. Monitor CI on master

After merge, the `Build, Test and Draft Release` workflow runs on master. Watch it:

```bash
gh run list --repo ZenUml/confluence-plugin-cloud --branch master --limit 1 --json databaseId,status,conclusion
gh run watch <RUN_ID> --repo ZenUml/confluence-plugin-cloud
```

### 5. Verify draft releases created

```bash
gh release list --repo ZenUml/confluence-plugin-cloud --limit 4
```

Confirm draft releases were created for the expected variants.

## Output

Report one of:

- **LANDED** — merged, staging deployed, draft releases created
- **MERGE BLOCKED** — which precondition failed
- **CI FAILED** — merged but CI failed on master, with error details

## On CI failure on master

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
