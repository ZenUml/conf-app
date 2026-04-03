---
name: deploy-stg
description: >
  Deploy the current branch to staging directly from the local machine, bypassing CI.
  Supports two modes: "pages" (Cloudflare Pages + D1 migrations) and "forge" (Forge app only).
  Builds the specified variant (lite, full, or diagramly) and deploys to the appropriate target.
  Use when the user says "deploy to staging", "deploy to lite-stg", "deploy to full-stg",
  "deploy stg", "publish to staging", "push to stg", "wrangler deploy", "forge deploy",
  "deploy forge app", "deploy and test", or wants to manually deploy to staging without waiting
  for CI. Also use when the user wants to test changes on a live Confluence staging instance
  before merging.
---

# Deploy to Staging

Deploy the current branch directly to staging from the local machine. This bypasses CI for fast iteration — use it when you need to test changes on a live Confluence instance without waiting for the full pipeline.

## Arguments

Usage: `/deploy-stg [lite|full|diagramly] [--forge-only] [--pages-only]`

- If no variant specified, default to **lite**.
- `--forge-only` — skip Cloudflare Pages deploy, only deploy the Forge app
- `--pages-only` — skip Forge deploy, only deploy to Cloudflare Pages
- No flag — deploy both Pages and Forge (full pipeline)

## Variant Configuration

| Variant | Build Command | Pages Project | Forge Staging Site | Forge Deploy Script |
|---------|--------------|---------------|--------------------|---------------------|
| lite | `pnpm build:lite` | `conf-stg-lite` | `lite-stg.atlassian.net` | `pnpm forge:deploy:lite:staging` |
| full | `pnpm build:full` | `conf-stg-full` | `full-stg.atlassian.net` | `pnpm forge:deploy:full:staging` |
| diagramly | `pnpm build:diagramly` | `conf-stg-lite` | `dia-stg.atlassian.net` | `pnpm forge:deploy:diagramly:staging` |

Note: Diagramly shares the `conf-stg-lite` Pages project with lite.

## Prerequisites

- **wrangler** CLI installed (check with `wrangler --version`) — needed for Pages deploy
- **forge** CLI installed (check with `forge --version`) — needed for Forge deploy
- **yq** installed (check with `yq --version`) — needed for manifest edits
- **Cloudflare auth** — either `CLOUDFLARE_API_TOKEN` env var or logged in via `wrangler login`
- **Forge auth** — logged in via `forge login` (uses `FORGE_EMAIL` + `FORGE_API_TOKEN` or interactive)
- The Cloudflare account ID is `8d5fc7ce04adc5096f52485cce7d7b3d` (hardcoded in package.json scripts)

---

## Pages Deploy Steps

Skip this section if using `--forge-only`.

Execute these steps sequentially. Stop and report on any failure.

### Step P1: Build

```bash
pnpm build:<variant>
```

Where `<variant>` is `lite`, `full`, or `diagramly`. This produces output in `dist/`.

If the build fails, report the error and stop. Common issues:
- Missing dependencies → run `pnpm install`
- TypeScript errors → fix before deploying
- Out of memory → retry with `NODE_OPTIONS="--max-old-space-size=8192" pnpm build:<variant>`

### Step P2: Prepare wrangler config

Create a temporary `wrangler.toml` from the staging template with the correct project name:

```bash
sed "s/name=\"conf-stg\"/name=\"<pages-project>\"/" wrangler-stg.toml > wrangler.toml
```

Where `<pages-project>` is from the variant table above (e.g., `conf-stg-lite`).

### Step P3: Apply D1 migrations

```bash
CLOUDFLARE_ACCOUNT_ID=8d5fc7ce04adc5096f52485cce7d7b3d \
  wrangler d1 migrations apply DB --remote --env production
```

This applies any pending database migrations to the staging D1 database (`conf-zenuml-stg`).

If no new migrations, this is a no-op and safe to run.

### Step P4: Deploy to Cloudflare Pages

```bash
CLOUDFLARE_ACCOUNT_ID=8d5fc7ce04adc5096f52485cce7d7b3d \
  wrangler pages deploy dist --branch production --project-name=<pages-project>
```

This uploads the built `dist/` directory to Cloudflare Pages.

### Step P5: Cleanup

```bash
rm -f wrangler.toml
```

Always clean up the generated wrangler.toml.

---

## Forge Deploy Steps

Skip this section if using `--pages-only`.

Forge deploy publishes the Forge app manifest + bundled resources to Atlassian. This is needed when the `dist/` content or `manifest.yml` changes.

### Step F1: Build (if not already built)

```bash
pnpm build:<variant>
```

The Forge app bundles the `dist/` directory as its resources (`resources.path: dist/`). If dist/ is already fresh from a Pages deploy, skip this step.

### Step F2: Backup manifest

```bash
cp manifest.yml manifest.yml.bak
```

The manifest needs variant-specific edits before deploy. Always back it up first.

### Step F3: Edit manifest for variant

**Lite:**
```bash
yq eval 'del(.modules["confluence:contentBylineItem"])' -i manifest.yml
yq eval 'del(.app.licensing)' -i manifest.yml
```

**Diagramly:**
```bash
yq eval 'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"])' -i manifest.yml
yq eval 'del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))' -i manifest.yml
```

**Full:** No manifest edits needed.

### Step F4: Deploy to Forge staging

```bash
pnpm forge:deploy:enable-analytics
pnpm forge:deploy:<variant>:staging
```

Where `<variant>` is `lite`, `full`, or `diagramly`. This uploads the app to Forge staging environment.

### Step F5: Install/upgrade on staging site

```bash
pnpm forge:upgrade:<variant>:staging
```

| Variant | Staging Site |
|---------|-------------|
| lite | `lite-stg.atlassian.net` |
| full | `full-stg.atlassian.net` |
| diagramly | `dia-stg.atlassian.net` |

If the app isn't installed yet, use `pnpm forge:install:<variant>:staging` instead.

### Step F6: Restore manifest

```bash
mv manifest.yml.bak manifest.yml
```

**Always restore** — never leave the manifest in an edited state.

---

## Output

Report:

```
## Deploy Report
- Variant: <lite|full|diagramly>
- Mode: <pages-only|forge-only|full>
- Pages: <OK / Skipped> — https://<pages-project>.pages.dev/
- Forge: <OK / Skipped> — v<version> deployed to staging
- Site: <staging-site>.atlassian.net — upgraded
- To test: Open a macro on the staging site
```

Or on failure:

```
## Deploy Report
- Variant: <variant>
- Stopped at: <step>
- Error: <details>
```

## Quick Reference

**Pages-only (lite):**

```bash
pnpm build:lite && pnpm wrangler:publish:stg:lite
```

**Forge-only (lite):**

```bash
pnpm build:lite && \
  cp manifest.yml manifest.yml.bak && \
  yq eval 'del(.modules["confluence:contentBylineItem"])' -i manifest.yml && \
  yq eval 'del(.app.licensing)' -i manifest.yml && \
  pnpm forge:deploy:enable-analytics && \
  pnpm forge:deploy:lite:staging && \
  pnpm forge:upgrade:lite:staging ; \
  mv manifest.yml.bak manifest.yml
```

**Full deploy (lite — both Pages + Forge):**

```bash
pnpm build:lite && \
  pnpm wrangler:publish:stg:lite && \
  cp manifest.yml manifest.yml.bak && \
  yq eval 'del(.modules["confluence:contentBylineItem"])' -i manifest.yml && \
  yq eval 'del(.app.licensing)' -i manifest.yml && \
  pnpm forge:deploy:enable-analytics && \
  pnpm forge:deploy:lite:staging && \
  pnpm forge:upgrade:lite:staging ; \
  mv manifest.yml.bak manifest.yml
```

## Does NOT

- Deploy to production — use `/release-app` for that
- Run E2E tests — test manually on staging or wait for CI
- Handle Connect (non-Forge) full variant — that uses pluploader in CI

## Important Notes

- **Diagramly and lite share `conf-stg-lite`** — deploying diagramly overwrites lite on staging and vice versa. Deploy the one you need to test.
- **D1 staging database is shared** across all variants. Migrations are safe to run multiple times.
- **Always restore `manifest.yml`** after Forge deploy — the edits are variant-specific and should not be committed.
- **CI will overwrite** your staging deploy on the next push to any branch. Your manual deploy is temporary.
- **Forge auth**: If `forge deploy` fails with auth errors, run `forge login` or ensure `FORGE_EMAIL` and `FORGE_API_TOKEN` are set.
