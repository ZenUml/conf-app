---
name: release-app
description: >
  Release ZenUML Forge apps (lite, full, and/or diagramly) to production via the full CI/CD pipeline.
  Reuses an existing fresh draft release when available (the common case after a recent merge),
  publishes it to production, and verifies with production smoke tests. Falls back to triggering a
  fresh build via a changelog push only when no recent draft exists.
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

### Step 1: Check for an existing fresh draft release

Most of the time you arrive here right after merging a PR to main, which already triggered `build-test-deploy.yml` and produced fresh draft releases. Reuse those — don't push a fake commit just to re-trigger the build.

For each requested variant:

```bash
gh release list --repo ZenUml/confluence-plugin-cloud --limit 20 \
  | awk '$2=="Draft" && $1 ~ /-{variant}$/ {print $1; exit}'
```

If a draft tag is returned, also confirm it's recent (within the last hour or two) and that its source workflow run succeeded:

```bash
# Get the run that produced the draft (drafts are created at the end of build-test-deploy.yml)
gh run list --repo ZenUml/confluence-plugin-cloud --workflow=build-test-deploy.yml --branch=main --limit 1 \
  --json databaseId,status,conclusion,createdAt
```

- If `status=completed` and `conclusion=success` for the relevant variant's `Deploy: {Variant}` and `Draft: {Variant}` jobs → **skip to Step 3** and publish that draft.
- If `status=in_progress` → **wait for it (Step 2b)**, then publish.
- If no fresh draft exists (last drafts are stale or absent) → fall back to **Step 2a** to trigger a fresh build.

Use `gh run view <run-id> --json jobs` to inspect per-variant job conclusions when there's any doubt.

### Step 2a (fallback): Trigger a fresh build with a changelog push

Only do this if Step 1 found no usable draft. The "Build, Test and Draft Release" workflow has no `workflow_dispatch`, so a push to main is the only way to retrigger it.

1. `cd` to the conf-app project root
2. Append to `CHANGELOG.md` with today's date and a release entry:
   ```
   ## [YYYY-MM-DD] - Release
   - Triggered release pipeline for {variants}
   ```
3. Stage, commit (message: `chore: trigger release pipeline`), and push to main **only after explicit user confirmation**
4. Proceed to Step 2b

### Step 2b: Wait for the Build Workflow run

Whether the run was triggered by a real merge (Step 1) or your changelog push (Step 2a), wait for it to complete:

1. `gh run list --workflow=build-test-deploy.yml --branch=main -L 1` to find the run
2. `gh run watch <run-id>` (foreground) or `gh run watch <run-id> --exit-status` with `run_in_background: true` so you get a single completion notification
3. Verify the run succeeded — if it failed for any variant being released, report the failure and stop

The workflow runs these jobs on main:
- Build and unit test
- Deploy 3 variants to staging (lite, full, diagramly)
- E2E tests on all 3 staging variants
- Create 3 draft releases (lite, full, diagramly)

If only some variants succeeded (e.g. lite is still deploying but full and diagramly are done), you can publish the completed ones immediately.

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

### Step 5: PVT — Production Validation Testing (MANDATORY)

**This step is NOT optional. Always run it immediately after the release workflow succeeds. Do NOT ask the user whether to run it — just do it.**

For each variant released, run PVT:

- **Lite**: `/pvt lite`
- **Full**: `/pvt full`
- **Diagramly**: `/pvt diagramly`

Report PVT results to the user.

### Step 5.5: Focused Feature Test

**This step runs automatically after PVT. Do not skip it.**

1. Find the previous release tag for the variant being released:
   ```bash
   gh release list --repo ZenUml/confluence-plugin-cloud --exclude-drafts \
     --limit 10 --json tagName \
     | jq -r '[.[] | select(.tagName | test("<variant>"))] | .[1].tagName'
   ```
   Example result: `v2026.04.301216-lite`

2. Scan commit messages between the previous tag and the new tag:
   ```bash
   git fetch --tags
   git log <prev-tag>..<new-tag> --oneline
   ```
   Example result:
   ```
   1ee2f655 chore(paywall-skill): move paywall skill from user-level to project
   8fd921ee feat(paywall): add pre-edit gate with explicit Continue editing button
   20574271 fix(paywall): emit upgrade_modal_shown for all prompt variants
   ```

3. Match commit messages (case-insensitive) against the keyword registry:

   | Keywords | Sub-skill |
   |---|---|
   | `paywall`, `upgrade`, `css`, `persona`, `modal` | `/pvt-paywall` |
   | `editor`, `editor-ui`, `codemirror` | `/pvt-editor` |
   | `swagger`, `openapi` | `/pvt-swagger` |
   | `graph`, `drawio` | `/pvt-drawio` |

4. For each matched sub-skill: invoke it with the variant as argument (e.g., `/pvt-paywall lite`). Deduplicate — each sub-skill runs at most once per release. Run sequentially. If a matched sub-skill file does not exist (not yet implemented), log a warning (`sub-skill /pvt-X not yet implemented`) and skip it — treat as skipped, not as FAIL.

5. If no keywords match, log "No focused test registered for this release" and proceed to Step 6 — this is not an error.

6. Collect pass/fail from each sub-skill and carry results forward to the Step 6 report.

### Step 6: Report

Summarize the release:

```
## Release Report: v{version}-{variant}
- Draft published: ✓
- Release workflow: ✓
- PVT (Mermaid smoke): PASS | FAIL
- Focused tests:
  - pvt-paywall: PASS | FAIL — <failing step if FAIL>
  (one line per invoked sub-skill; omitted if sub-skill was not invoked or not yet implemented)
  (or: "No focused test registered for this release")
```

## Error Handling

- **Build workflow fails**: Report which job failed, link to the run, stop
- **Release workflow fails**: Report the failure, link to the run — the draft release was already published so the user may need to investigate manually
- **PVT fails**: Report which variant failed and the error — this is a post-deploy issue that needs immediate attention
- **Focused test fails**: Report which sub-skill failed and which step — this is a post-deploy issue. Do NOT roll back or block future releases. The app is already live; investigation is the next action.

## Important Notes

- **Always check for an existing fresh draft first (Step 1).** A merge to main that completed in the last hour or so already produced the drafts you need — reuse them. Pushing a `chore: trigger release pipeline` changelog commit when fresh drafts exist wastes ~15 min of CI, pollutes main history, and gains nothing.
- The build workflow has no `workflow_dispatch` — a push to main is the only fallback if no fresh draft exists
- Draft releases are only created on the `main` branch (not on PRs or other branches)
- All three variants (lite, full, diagramly) are Forge apps deployed to the same production site (`zenuml.atlassian.net`)
- Always confirm with the user before pushing to main or publishing releases
