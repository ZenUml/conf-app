---
name: validate-branch
description: Run local validation checks on the current branch before shipping. Use when the user says "validate", "check branch", "am I good", "run tests", "preflight", "is this ready", or wants to verify their branch passes all checks before pushing or creating a PR. Also use as a precondition check before invoking submit-branch or ship-branch.
---

# Validate Branch

Verify the current branch passes all local checks. Run anytime before shipping, or just to check your work.

## Why this order matters

Checks run fastest-first so you get feedback quickly. Lint catches syntax issues in seconds. Unit tests catch logic errors in a few seconds. Build catches bundling/type issues. The feature smoke test on a live Confluence instance is the slowest and most expensive — but it's the only step that proves the feature actually works for real users. No point running the smoke test if any earlier step fails.

Note: CI E2E tests run against staging Confluence instances post-push. The forge-tunnel smoke test in Step 4 is a faster, pre-push equivalent — it exercises real Confluence with your local code via tunnel.

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

### 4. Feature smoke test (forge tunnel)

After lint/unit/build pass, exercise the feature against a real Confluence site via forge tunnel. This is the only step that proves the user-visible behavior actually works.

**When to skip:** docs-only, test-only, build/CI config, or backend-only (`functions/`) changes that have no Custom UI surface. If unsure, run it.

**How to run:**

1. **Identify what to test.** Read the changes (`git diff master...HEAD`, recent commits, plan file if present) and write down:
   - The user-visible behavior the change affects (e.g. "clicking Edit when paywalled should open the editor paywall, not double-gate from viewer")
   - 2–4 concrete interactions that exercise that behavior (button clicks, ESC key, form input)
   - The expected outcome of each interaction

2. **Bring up the tunnel.** Invoke the `forge-tunnel` skill — it handles build, deploy, install, and starting the tunnel. Wait until the tunnel logs `Listening for requests on local port`.

3. **Drive a real Confluence page.** Use Playwright (the only browser tool that can reach into Forge cross-origin iframes — see `CLAUDE.md` Browser Automation table). Navigate to a page on the tunnel-connected site (per `.env.forge.local` `ATLASSIAN_SITE`) that hosts the relevant macro. Verify the version label in the macro toolbar matches the current branch (e.g. `claude/<branch>:<sha>`) — if it shows a deployed `vYYYY.MM…` tag instead, you're hitting the public site, not the tunnel.

4. **Exercise each interaction from step 1.** Take a screenshot after each one. Compare what you see to the expected outcome.

5. **Decide.** If every interaction matches the expectation, mark Step 4 PASS. If any diverges, mark FAIL and include the screenshot path + which assertion failed in the report. Don't try to "patch around" a divergence — fix the underlying code, then re-run from Step 1.

**Common gotchas:**

- *Tunnel serves stale code.* `forge-tunnel` auto-serves `dist/` for frontend changes, but if you edited code without rebuilding, you'll see old behavior. Re-run `pnpm build:<variant>` and hard-refresh (Cmd+Shift+R).
- *Wrong site.* If the macro version label shows a `v2026.…` tag, you're on a deployed site (e.g. `zenuml.atlassian.net`), not the tunnel target. Switch to the host in `.env.forge.local`.
- *Paywall state not reproducible.* Some features only manifest at a specific macro count or with specific KV flags set. The `Preset:` dropdown in the macro toolbar (Bystander/Owner/etc.) lets you force a paywall variant on dev sites — use it to drive deterministic states.
- *Iframe selectors don't resolve from the top frame.* Forge Custom UI lives in a cross-origin iframe; iterate `page.frames()` (or use `frameLocator`) when finding buttons inside the macro.

## Output

Report one of:

- **PASS** — all 4 checks passed, branch is ready to push
- **FAIL** — which check failed, the error output (or failing interaction + screenshot for Step 4), and a one-line suggestion

If Step 4 was skipped, say so explicitly: "Step 4 skipped — backend-only change, no Custom UI surface."

## What CI does beyond this

After you push, CI runs lint/unit/build plus:
- Deploys all 4 variants (lite, full, full-forge, diagramly) to staging
- Runs E2E tests against staging Confluence instances
- On master only: creates draft releases for each variant

The forge-tunnel smoke step in Step 4 catches Confluence-integration regressions earlier — before they burn 6+ minutes of CI time.
