---
name: validate-branch
description: Run local validation checks on the current branch before shipping. Use when the user says "validate", "check branch", "am I good", "run tests", "preflight", "is this ready", or wants to verify their branch passes all checks before pushing or creating a PR. Also use as a precondition check before invoking submit-branch or ship-branch.
---

# Validate Branch

Verify the current branch passes all local checks. Run anytime before shipping, or just to check your work.

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

### 4. Feature smoke test

After lint/unit/build pass, exercise the feature against a real Confluence site. This is the only step that proves the user-visible behavior actually works.

**When to skip:** docs-only, test-only, build/CI config, or backend-only (`functions/`) changes that have no Custom UI surface. If unsure, run it.

#### 4a. Write a focused test plan first

Before touching the browser, read the changes and write down:
- The user-visible behavior the change affects (e.g. "clicking Fullscreen on a multi-page DrawIO diagram should show prev/next page navigation")
- The target site and a specific Confluence page URL that has the relevant macro
- 2–4 concrete interactions that exercise that behavior (button clicks, ESC key, form input, etc.)
- The **expected** outcome of each interaction

Do not skip this. A test plan written before running Playwright is a contract — it makes PASS/FAIL unambiguous.

#### 4b. Choose how to test

**Option A — Forge tunnel (for unreleased frontend changes)**

Use when your changes have not been deployed to any dev site yet.

1. Invoke the `forge-tunnel` skill — it handles build, deploy, install, and starts the tunnel. Wait until the tunnel logs `Listening for requests on local port`.
2. Target `lite-dev.atlassian.net` (default in `.env.forge.local` `ATLASSIAN_SITE`) or another pre-connected dev site. Do **not** test on production (`zenuml.atlassian.net` or `*.prod.atlassian.net`).
3. Verify the version label in the macro toolbar matches the current branch (e.g. `claude/<branch>:<sha>`). If it shows a `vYYYY.MM…` tag, you're hitting the public deploy, not the tunnel.

**Option B — Direct dev site (for already-deployed dev builds)**

Use when the branch has been deployed to staging/dev (e.g. a recent push to `fix/*` or `chore/*` is running on `lite-dev`). No tunnel needed.

1. Navigate directly to `lite-dev.atlassian.net` (or the relevant dev site) in Playwright.
2. Confirm the version label in the macro debug bar shows the expected build SHA or branch name.

#### 4c. Execute the test plan

Use Playwright MCP (`mcp__playwright__*`) — it's the only tool that can reach into Forge cross-origin iframes. Ad-hoc reproduction: use Playwright MCP directly; do not write spec files.

For each interaction in your test plan:
1. Perform the interaction
2. Take a screenshot
3. Assert the actual outcome matches the expected outcome

If every interaction matches: Step 4 **PASS**.
If any diverges: Step 4 **FAIL** — include the screenshot path + which assertion failed. Fix the underlying code, then re-run from Step 1.

**Common gotchas:**

- *Tunnel serves stale code.* If you edited code without rebuilding, you'll see old behavior. Re-run `pnpm build:<variant>` and hard-refresh (Cmd+Shift+R).
- *Wrong site.* A `v2026.…` version tag means you're on a public deploy, not the tunnel or dev site.
- *Paywall state not reproducible.* Use the `Preset:` dropdown in the macro toolbar (Bystander/Owner/etc.) to force deterministic paywall variants.
- *Iframe selectors don't resolve from the top frame.* Forge Custom UI lives in a cross-origin iframe. Use `page.frameLocator(...)` or `browser_run_code_unsafe` — not plain CSS selectors from the top frame.

## Output

Report one of:

- **PASS** — all 4 checks passed, branch is ready to push
- **FAIL** — which check failed, the error output (or failing interaction + screenshot for Step 4), and a one-line suggestion

If Step 4 was skipped, say so explicitly: "Step 4 skipped — backend-only change, no Custom UI surface."

## What CI does beyond this

After you push, CI runs lint/unit/build plus:
- Deploys all 3 variants (lite, full, diagramly) to staging
- Runs E2E tests against staging Confluence instances
- On main only: creates draft releases for each variant

The forge-tunnel smoke step in Step 4 catches Confluence-integration regressions earlier — before they burn 6+ minutes of CI time.
