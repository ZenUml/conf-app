---
name: release-app
description: >
  Release ZenUML Forge apps (lite, full, and/or diagramly) to production via the full CI/CD pipeline.
  Triggers the build workflow by pushing a changelog to master, waits for draft releases,
  publishes releases to production, and verifies with production smoke tests.
  Use when the user wants to release, deploy, ship, or push the lite, full, or diagramly Forge app to
  production. Triggers on "release lite", "release full", "release diagramly", "deploy to prod",
  "ship forge app", "push to production", "release forge app", "release app", or any request to
  promote staging builds to production for the conf-app project.
---

# Release Forge App to Production

End-to-end release pipeline for ZenUML Forge apps (lite, full, and/or diagramly) in the conf-app project.

## Arguments

Usage: `/release-app [lite] [full] [diagramly]`

- If no variant specified, release **all three** (lite, full, and diagramly).
- User can specify one or more variants to release only those.

## Variant Configuration

| Variant | Staging Site | Production Site | Draft Tag Pattern |
|---------|-------------|-----------------|-------------------|
| lite | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-lite` |
| full | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-full` |
| diagramly | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-diagramly` |

All three variants are Forge apps deployed to the same Confluence sites. On production (`zenuml.atlassian.net`), all three coexist — they're distinguished by their addon keys and macro names.

## Pipeline Steps

Execute these steps sequentially. Stop and report to the user if any step fails.

### Step 1: Trigger the Build Workflow

The "Build, Test and Draft Release" workflow (`build-test-deploy.yml`) triggers on push to any branch. To retrigger on master, create a changelog commit:

1. `cd` to the conf-app project root
2. Create or append to `CHANGELOG.md` with today's date and a release entry:
   ```
   ## [YYYY-MM-DD] - Release
   - Triggered release pipeline for {variants}
   ```
3. Stage, commit (message: `chore: trigger release pipeline`), and push to master
4. The push triggers the "Build, Test and Draft Release" workflow automatically

### Step 2: Wait for Build Workflow

1. Use `gh run list --workflow=build-test-deploy.yml --branch=master -L 1` to find the latest run
2. Poll with `gh run watch <run-id>` or periodic `gh run view <run-id>` until it completes
3. Verify the run succeeded — if it failed, report the failure and stop

The workflow runs these jobs on master:
- Build and unit test
- Deploy 3 variants to staging (lite, full, diagramly)
- E2E tests on all 3 staging variants
- Create 3 draft releases (lite, full, diagramly)

All must pass before draft releases are created.

### Step 3: Publish the Draft Release

For each variant being released:

1. Find the draft release: `gh release list --exclude-drafts=false | grep "Draft"` and look for the tag matching `v{version}-{variant}`
2. Publish it: `gh release edit <tag> --draft=false`
3. This triggers the Release workflow (`release.yml`) which:
   - Builds and publishes to Cloudflare production
   - Deploys to Forge production

If releasing multiple variants, publish them one at a time and wait for each Release workflow to complete before publishing the next.

### Step 4: Wait for Release Workflow

1. The Release workflow triggers automatically when the draft release is published
2. Monitor with `gh run list --workflow=release.yml -L 1` then `gh run watch <run-id>`
3. Verify it succeeded — if it failed, report and stop

### Step 5: Smoke Test on Production (MANDATORY)

**This step is NOT optional. Always run it immediately after the release workflow succeeds. Do NOT ask the user whether to run it — just do it.**

For each variant released, run the production smoke test:

- **Lite**: `/smoke-test on zenuml lite`
- **Full**: `/smoke-test on zenuml full`
- **Diagramly**: `/smoke-test on zenuml diagramly`

Test all macros. Report results to the user.

### Step 6: Report

Summarize the release:
- Variants released
- Release tags published
- Production smoke test results
- Any issues encountered

## Error Handling

- **Build workflow fails**: Report which job failed, link to the run, stop
- **Release workflow fails**: Report the failure, link to the run — the draft release was already published so the user may need to investigate manually
- **Production smoke test fails**: Report which macros failed — this is a post-deploy issue that needs immediate attention

## Important Notes

- The build workflow has no `workflow_dispatch` — a push to master is required to trigger it
- Draft releases are only created on the `master` branch (not on PRs or other branches)
- All three variants (lite, full, diagramly) are Forge apps deployed to the same production site (`zenuml.atlassian.net`)
- Always confirm with the user before pushing to master or publishing releases
