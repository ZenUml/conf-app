# Staging Release Process

End-to-end workflow for shipping a change from local development to staging verification and merge.

## Overview

```
commit -> push -> PR -> pipeline (build + deploy to staging) -> verify on zenuml-stg -> merge PR
```

## 1. Commit

Create a feature or fix branch and commit your changes locally.

```bash
git checkout -b fix/short-name
# make changes
git add -A
git commit -m "fix: description of the change"
```

Branch naming: keep it short -- `fix/diagram-render`, `feat/oauth2-auth`.

## 2. Push

```bash
git push -u origin HEAD
```

This triggers the **Build, Test and Draft Release** workflow (`.github/workflows/build-test-deploy.yml`) on every push to any branch.

## 3. Create a Pull Request

```bash
gh pr create --title "fix: description" --body "Summary of changes"
```

Or create the PR through the GitHub UI. Target branch is `master`.

## 4. Monitor the Pipeline

The push triggers the following pipeline stages:

### Stage 1 -- Build & Unit Test

Runs `pnpm test:unit`. All staging jobs depend on this passing.

### Stage 2 -- Deploy to Staging (parallel)

Three jobs run in parallel after build succeeds:

| Job | What it does |
|-----|-------------|
| **Lite / Deploy** | Builds Lite variant, deploys to `conf-stg-lite` on Cloudflare Pages, deploys to Forge staging, installs on `zenuml-stg` |
| **Full / Deploy** | Builds Full variant, deploys to `conf-stg-full` on Cloudflare Pages, deploys to Forge staging |
| **Diagramly / Deploy** | Builds Diagramly variant, deploys to `conf-stg-lite` on Cloudflare Pages, deploys to Forge staging |

Each deploy job:
1. Runs `pnpm build:<variant>`
2. Applies D1 database migrations
3. Publishes to Cloudflare Pages (`wrangler pages deploy`)
4. Deploys and installs on Forge staging

### Stage 3 -- E2E Tests on Staging (parallel)

After each deploy completes, Playwright E2E tests run against `zenuml-stg`:

| Job | Environment |
|-----|------------|
| **Lite - E2E Test on Staging** | `IS_LITE=true IS_FORGE=true` |
| **Full - E2E Test on Staging** | `IS_FORGE=true` |
| **Diagramly - E2E Test on Staging** | `IS_FORGE=true` |

### Stage 4 -- Draft Release (master only)

On `master` branch pushes only (not PRs), draft releases are created after E2E tests pass:
- `v{YYYY.MM.DDHHMM}-lite`
- `v{YYYY.MM.DDHHMM}-full`
- `v{YYYY.MM.DDHHMM}-diagramly`

### Monitoring

Check pipeline status:

```bash
# Watch the latest workflow run
gh run list --limit 5

# Watch a specific run
gh run watch <run-id>

# View logs for a failed job
gh run view <run-id> --log-failed
```

Or monitor directly on GitHub Actions: `https://github.com/ZenUml/conf-app/actions`

## 5. Verify on zenuml-stg

Once the staging deploy jobs succeed, verify the change manually on `https://zenuml-stg.atlassian.net/wiki`.

### Functional verification

1. Open Confluence pages with relevant diagram types (Sequence, Mermaid, Graph, OpenAPI)
2. Confirm diagrams render correctly
3. Test the specific change introduced by the PR

### Console check

Open the browser developer console and verify no new errors originating from ZenUML code. Errors from Atlassian's own scripts can be ignored.

### Analytics verification (if applicable)

If the change affects event tracking, verify events in Mixpanel:

```bash
# Query Mixpanel Export API for today's events
source <(grep -v '^#' .env.mixpanel | sed 's/^/export /') && \
curl -s "https://data.mixpanel.com/api/2.0/export?from_date=$(date +%Y-%m-%d)&to_date=$(date +%Y-%m-%d)&event=%5B%22EVENT_NAME%22%5D" \
  -u "$API_Secret:" \
  --header "Accept: application/json"
```

Filter for `client_domain=zenuml-stg` to isolate staging events from production.

## 6. Merge the PR

After verification passes:

```bash
gh pr merge <PR_NUMBER> --merge
```

Once merged to `master`, the pipeline runs again on `master`, deploys to staging a final time, and creates draft releases for production.

## What Happens Next (Production)

Production deployment is a separate process triggered by publishing a GitHub Release:

1. Go to [GitHub Releases](https://github.com/ZenUml/conf-app/releases)
2. Find the draft release (e.g., `v2026.02.201135-full`)
3. Edit and publish it
4. The **Release** workflow (`.github/workflows/release.yml`) deploys to production Cloudflare Pages and Forge

## Quick Reference

| Environment | Backend URL | Confluence Instance |
|------------|-------------|-------------------|
| Staging Full | `conf-stg-full.zenuml.com` | `zenuml-stg.atlassian.net` |
| Staging Lite | `conf-stg-lite.zenuml.com` | `zenuml-stg.atlassian.net` |
| Production Full | `conf-full.zenuml.com` | Customer instances |
| Production Lite | `conf-lite.zenuml.com` | Customer instances |

| Tool | Purpose |
|------|---------|
| `gh` | GitHub CLI for PRs, runs, releases |
| `wrangler` | Cloudflare Pages/D1 management |
| `forge` | Forge CLI for deploy/install/tunnel |
| Mixpanel Export API | Event verification (`client_domain=zenuml-stg` for staging) |
