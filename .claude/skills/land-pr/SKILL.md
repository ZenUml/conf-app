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

Before merging, verify ALL of these:

1. **PR is NOT a Draft** — Draft PRs skip `E2E: Lite` by design, so a "green" Draft PR has not actually been E2E-verified. Refuse to merge a Draft.
2. **All CI checks green** — no pending or failed checks (and `E2E: Lite` is among them, not skipped)
3. **No pending reviews** — no requested changes outstanding
4. **Branch is up to date** — no merge conflicts with master
5. **PR is the right one** — confirm PR number with the user if ambiguous

```bash
gh pr view <PR_NUMBER> --json state,isDraft,mergeable,statusCheckRollup,reviewDecision
```

If `isDraft` is `true`, stop with this message:

> **REFUSED: PR #N is a Draft.** `E2E: Lite` was skipped because of the Draft gate, so this PR has not been verified end-to-end. Mark it Ready for Review (`gh pr ready <PR>`) and wait for the resulting CI run to go green, or run `/ship-branch` which handles this automatically.

If any other precondition fails, report which one and stop.

## Steps

### 1. Verify readiness

Run the precondition checks above. If anything is not green, stop and report.

### 2. Merge

Use the repo's default merge strategy — do not pass `--squash` or `--rebase` unless the user explicitly requests it.

```bash
gh pr merge <PR_NUMBER> --auto --delete-branch
```

Using `--auto` arms auto-merge so GitHub merges when all checks pass.

### 3. Wait for merge

```bash
gh pr view <PR_NUMBER> --json state
```

Poll until state is `MERGED`. Timeout after 5 minutes.

### 4. Monitor CI on master

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
