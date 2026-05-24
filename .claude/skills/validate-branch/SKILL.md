---
name: validate-branch
description: Run local validation checks on the current branch before shipping. Use when the user says "validate", "check branch", "am I good", "run tests", "preflight", "is this ready", or wants to verify their branch passes all checks before pushing or creating a PR. Also use as a precondition check before invoking submit-branch or ship-branch.
---

# Validate Branch

Verify the current branch passes all local checks. Run anytime before shipping, or just to check your work.

## Steps

Run from the repo's root directory. Stop on first failure.

### 1. Lint, unit tests, and build

Run the following in order.

**Lint**

```bash
pnpm lint
```

This lints all of `src/` (not just `.vue` files). If lint fails, report the errors and stop.

**Unit tests**

```bash
pnpm test:unit
```

If tests fail, report the failing test names and stop.

**Build**

Build at least one variant to catch bundling and import errors:

```bash
pnpm build:lite
```

If working on a specific variant, build that one instead (`pnpm build:full`, `pnpm build:diagramly`). If lint and tests passed but build fails, it's usually a missing import or Vite config issue.

### 2. Feature smoke test

After Step 1 passes, exercise the feature against a real Confluence site. This is the only step that proves the user-visible behavior actually works.

**When to skip:** docs-only, build/CI config.

#### 2a. Write a spot check plan first

> See **Spot Checks** in `CLAUDE.md` for the full definition — environment selection rules, key principles, and workflow.

Before touching the browser, read the changes and write down:
- The user-visible behavior the change affects (e.g. "clicking Fullscreen on a multi-page DrawIO diagram should show prev/next page navigation")
- The target site and a specific Confluence page URL that has the relevant macro
- 2–4 concrete interactions that exercise that behavior (button clicks, ESC key, form input, etc.)
- The **expected** outcome of each interaction

Do not skip this. A plan written before opening the browser is a contract — it makes PASS/FAIL unambiguous.

#### 2b. Choose how to test

**Option A — Forge tunnel (for unreleased frontend changes)**

Use when your changes have not been deployed to any dev site yet.

1. Invoke the `forge-tunnel` skill — it handles build, deploy, install, and starts the tunnel. Wait until the tunnel logs `Listening for requests on local port`.
2. Target `lite-dev.atlassian.net` (default in `.env.forge.local` `ATLASSIAN_SITE`) or another pre-connected dev site. Do **not** test on production (`zenuml.atlassian.net` or `*.prod.atlassian.net`).
3. Verify the version label in the macro toolbar matches the current branch (e.g. `claude/<branch>:<sha>`). If it shows a `vYYYY.MM…` tag, you're hitting the public deploy, not the tunnel.

**Option B — Direct dev site (for already-deployed dev builds)**

Use when the branch has been deployed to staging/dev (e.g. a recent push to `fix/*` or `chore/*` is running on `lite-dev`). No tunnel needed.

1. Navigate directly to `lite-dev.atlassian.net` (or the relevant dev site) in Playwright.
2. Confirm the version label in the macro debug bar shows the expected build SHA or branch name.

#### 2c. Execute the test plan

Use Playwright MCP (`mcp__playwright__*`) — it's the only tool that can reach into Forge cross-origin iframes. Ad-hoc reproduction: use Playwright MCP directly; do not write spec files.

For each interaction in your test plan:
1. Perform the interaction
2. Take a screenshot
3. Assert the actual outcome matches the expected outcome

If every interaction matches: Step 2 **PASS**.
If any diverges: Step 2 **FAIL** — include the screenshot path + which assertion failed. Fix the underlying code, then re-run from Step 1.

**Common gotchas:**

- *Tunnel serves stale code.* If you edited code without rebuilding, you'll see old behavior. Re-run `pnpm build:<variant>` and hard-refresh (Cmd+Shift+R).
- *Wrong site.* A `v2026.…` version tag means you're on a public deploy, not the tunnel or dev site.
- *Paywall state not reproducible.* Use the `Preset:` dropdown in the macro toolbar (Bystander/Owner/etc.) to force deterministic paywall variants.
- *Iframe selectors don't resolve from the top frame.* Forge Custom UI lives in a cross-origin iframe. Use `page.frameLocator(...)` or `browser_run_code_unsafe` — not plain CSS selectors from the top frame.

## Output

Report one of:

- **PASS** — Step 1 (lint, unit tests, build) and Step 2 passed; branch is ready to push
- **FAIL** — which part failed (lint vs unit tests vs build vs Step 2), the error output (or failing interaction + screenshot for Step 2), and a one-line suggestion

If Step 2 was skipped, say so explicitly: "Step 2 skipped — docs-only or build/CI config (per **When to skip** above)."

## What CI does beyond this

After you push, CI runs lint/unit/build plus:
- Deploys all 3 variants (lite, full, diagramly) to staging
- Runs E2E tests against staging Confluence instances
- On main only: creates draft releases for each variant

The forge-tunnel smoke step in Step 2 catches Confluence-integration regressions earlier — before they burn 6+ minutes of CI time.
