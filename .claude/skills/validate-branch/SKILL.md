---
name: validate-branch
description: Run local validation checks on the current branch before shipping. Use when the user says "validate", "check branch", "am I good", "run tests", "preflight", "is this ready", or wants to verify their branch passes all checks before pushing or creating a PR. Also use as a precondition check before invoking submit-branch or ship-branch.
---

# Validate Branch

Verify the current branch passes all local checks. Run anytime before shipping, or just to check your work.

## Why this order matters

Checks run fastest-first so you get feedback quickly. Lint catches syntax issues in seconds. Unit tests catch logic errors in a few seconds. Build is slowest and catches bundling/type issues. No point waiting for build if lint fails.

Note: E2E tests are NOT part of local validation — they run against live Confluence staging instances in CI. Local validation covers what you can check without a deployed app.

## Steps

Run from the `conf-app` directory. Stop on first failure.

### 1. Lint

```bash
pnpm lint
```

This lints all of `src/` (not just `.vue` files). If lint fails, report the errors and stop.

### 2. Unit tests

```bash
pnpm test:unit
```

If tests fail, report the failing test names and stop.

### 3. Build

Build at least one variant to catch bundling and import errors:

```bash
pnpm build:lite
```

If working on a specific variant, build that one instead (`pnpm build:full`, `pnpm build:diagramly`). If lint and tests passed but build fails, it's usually a missing import or Vite config issue.

## Output

Report one of:

- **PASS** — all 3 checks passed, branch is ready to push
- **FAIL** — which check failed, the error output, and a one-line suggestion

## What CI does beyond this

After you push, CI runs all of the above plus:
- Deploys all 4 variants (lite, full, full-forge, diagramly) to staging
- Runs E2E tests against staging Confluence instances
- On master only: creates draft releases for each variant
