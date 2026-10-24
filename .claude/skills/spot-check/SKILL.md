---
name: spot-check
description: >
  Ad hoc, AI-driven verification of a specific behavior — not a checked-in E2E test.
  Use after developing a feature, fixing a bug, validating a branch, or post-release.
  Drives agent-browser for Forge iframe UI, or CLI for backend/analytics signals.
  Triggers on "spot check", "run a spot check on X", "spot check this fix",
  "spot check on staging", "spot check zenuml-lite@stg", "verify on staging".
---

# Spot Check

A **spot check** is an ad hoc, AI-driven, ephemeral verification of a specific behavior. It is not a pre-written test case and not meant for long-term use.

**What it is NOT:** a pre-written `.spec.ts` file, a comprehensive regression test, or a repeatable automated test.

## Key principles

- **Lightweight** — reuse what already exists. If a page with the relevant macro is already available, use it. Navigate directly to the macro when you know which one matters.
- **AI-driven** — use `agent-browser --session conf-app --restore=stg` to improvise steps. It reaches inside Forge cross-origin iframes (including nested ones); ego lite and Playwright MCP also work, Kimi WebBridge / Claude in Chrome / cursor-ide-browser reach page chrome only. No script is checked in.
- **Ephemeral** — test steps are not saved. Screenshots go under `/tmp/spot-check/conf-app/` (`mkdir -p` first); a relative `screenshot foo.png` writes to cwd (the repo root).
- **Targeted** — verify the specific behavior being checked, not a full regression.
- **Real world** — verify the behaviour on a confluence site, not a local fixture or unit test.
- **Forge tunnel** — use forge tunnel (separate skill) and `lite-dev.atlassian.net` by default.

## Write the plan first

**STOP.** Do not open the browser or run queries until the plan is written.

Each planned check must name:

1. **Behavior** — what changed or what you are verifying
2. **Observable signal** — UI element, Mixpanel event + property, network response, D1 row, etc.
3. **Method** — Playwright step, request intercept, `curl`, `wrangler`, etc.

Each item must be independently pass/fail checkable before you run it.

### Treat create and edit as separate paths

Never use a successful check on existing content as evidence that creating new content works.
Create and edit often use different initialization paths: an existing document hydrates persisted
state, while a new document may render a default value in the UI before its store, globals, or save
payload have been initialized.

For behavior involving editor state, default content, validation, AI actions, drafts, titles, or
persistence:

1. Plan **create/new** and **edit/existing** as separate assertions unless the requested scope
   explicitly excludes one.
2. Exercise the create path through the real editor UI when testing initialization or first save.
   An API-created fixture or an existing macro does not cover that path.
3. Assert the value after initial mount, after the triggering interaction, and after first save when
   persistence is involved.
4. If only one lifecycle path is tested, list the other under `Skipped` with the reason. Never imply
   that one path covers the other.

### A missing signal is NOT a failed assertion

**NEVER conclude "it didn't happen" from "I couldn't find it."** Every signal type here has a
window in which absence means nothing:

| Signal | Why absence lies | What proves the negative |
|---|---|---|
| Mixpanel event | `mixpanel.track` **batches** (several events per `POST /track/`) and ingestion lags minutes | Capture the network (`browser_network_requests` filtered on `api-js.mixpanel.com`, then `browser_network_request … request-body`) — the payload is send-side ground truth |
| Attachment on a page | A macro saved on a **not-yet-published** page 404s by construction; the write lands later via view-time backfill | Re-check after the page is published AND viewed; see the 404 note in `src/model/Attachment.ts` |
| Code path "unreachable in variant X" | One guard is rarely the only entry | `grep -rn "<entryFn>" src/ \| grep -v spec` and check the guard on EACH hit; if telemetry exists, query it first |

Rule: when an assertion depends on a *negative*, name in the plan how you will distinguish
"did not happen" from "not observed yet" — otherwise the check is not pass/fail checkable.
(2026-07-18: this exact mistake was made three times in one session — a benign new-page 404 read as
"endpoint unreachable" cost two production releases; a single `isLite()` guard produced two wrong
"not testable in this variant" verdicts; batched analytics read as "the event never fired".)

```
Spot check plan: <short title>

Target: <site / page URL / API path>
  - [ ] <specific observable assertion>  [method]
  - [ ] <specific observable assertion>  [method]

Skipped: <anything out of scope> — <reason>
```

For **post-release** spot checks (release delta, commit triage, N/A rules), follow Step 2.6 in the **release-app** skill — it extends this plan format.

For **branch validation** before push (Forge tunnel vs dev site), follow Step 2 in the **validate-branch** skill after writing the plan here.

## Choosing the environment

| Situation                              | Target environment                                                |
|----------------------------------------|-------------------------------------------------------------------|
| New feature not yet deployed           | Forge tunnel → `lite-dev.atlassian.net` (see **validate-branch**) |
| Deployed to staging / failing pipeline | Staging site (`lite-stg.atlassian.net`)                           |
| Reproducing a production issue         | Production site directly (zenuml.atlassian.net)                   |
| Post-release validation                | Production — same variant as the release                          |
| Backend-only (webhook, API, D1)        | `curl` / wrangler against staging or prod                         |
| Validating the workflow itself         | Any appropriate env                                               |

App profiles and credentials: `tests/e2e-tests/config/apps.ts`, `.env.forge.local`.

## Verification methods

Use whichever signals the behavior requires. Mix freely — e.g. drive the browser, then query D1, then check Mixpanel.

| Signal                          | How                                                                                |
|---------------------------------|------------------------------------------------------------------------------------|
| UI behavior                     | `agent-browser` — `frame "@<ref>"` per iframe layer, then plain `eval` / `click`  |
| Analytics events                | `mcp__mixpanel__Run-Query` with `project_id=3373228`                               |
| Forge logs                      | `forge logs --environment staging` / `forge logs --environment production`         |
| Cloudflare Pages Functions logs | `wrangler pages deployment tail --project-name <project> --environment production` |
| Cloudflare Workers logs         | `wrangler tail`                                                                    |
| D1 database state               | `wrangler d1 execute <db> --remote --command "SELECT ..."`                         |
| R2 object storage               | `wrangler r2 object get <bucket>/<key>`                                            |

Analytics reference: [docs/analytics-reference.md](../../../docs/analytics-reference.md).

## Workflow

1. **Plan** — behavior, target page/macro or data path, expected signal per assertion (see above).
2. **Navigate** — open the target Confluence site if UI is involved. Reuse the Chrome logged-in session when possible.
3. **Choose the lifecycle fixture** — reuse an existing page only for edit/view checks. For editor
   initialization or first-save checks, create the macro through the real UI. Use the
   **create-test-page** skill only for API-only rendering checks that intentionally bypass creation.
4. **Execute** — run each planned check. Capture evidence after key steps to `/tmp/spot-check/conf-app/` (never the repo). Report pass / fail / skipped per assertion.

## Forge iframe tooling

Forge Custom UI renders in sandboxed cross-origin iframes (OOPIFs). Three tools cross that boundary.

**Default to `agent-browser`** — it is the only one without a global single-pairing failure mode (see `CLAUDE.md` § "Browser automation and Forge iframes" for the measured comparison):

```bash
mkdir -p /tmp/spot-check/conf-app
A(){ agent-browser --session conf-app --restore=stg --screenshot-dir /tmp/spot-check/conf-app "$@"; }
A open <url>
A snapshot                    # find the Iframe ref
A frame "@e151"               # enter the OOPIF
A eval "location.host"        # verify you are inside
A screenshot 01-page-loaded.png   # lands in /tmp/spot-check/conf-app/
A console                     # includes OOPIF logs
```

| Tool                    | Forge iframe access      |
|-------------------------|--------------------------|
| **agent-browser**       | ✅ Yes — `frame @<ref>` (default) |
| **ego lite**            | ✅ Yes — `cdp` + `sessionId` |
| **Playwright MCP**      | ✅ Yes — `frameLocator()` / snapshot `ref` as `target` |
| **Kimi WebBridge**      | ❌ No — snapshot omits OOPIFs, `cdp` rejects `Target.*` |
| **chrome-devtools-mcp** | ❌ No                     |
| **cursor-ide-browser**  | ❌ No — page chrome only  |
| **claude-in-chrome**    | ❌ No                     |

**Common gotchas:**

- `--restore=stg` is required on every agent-browser call — without it the session starts blank and lands on the Atlassian login page.
- Confirm frame entry with `eval "location.host"` — it must return the `cdn.prod.atlassian-dev.net` host, not `*.atlassian.net`. Older agent-browser builds reported `✓ Done` while staying in the top frame.
- Nested frames (a DrawIO editor inside the macro OOPIF) need one `frame` call per layer, with a fresh `snapshot` between them — refs are scoped to the frame they were read in.
- `@e` refs are per-snapshot. Re-read the ref after any navigation.
- Selectors from the top frame miss Forge UI — scope to the iframe.
- Paywall state: use the macro toolbar `Preset:` dropdown (Bystander/Owner/etc.) for deterministic variants.
- Version label in the macro toolbar confirms which build you hit (`vYYYY.MM…` = public deploy; branch SHA = tunnel/dev).

**Before testing — mandatory pre-flight:**

1. **Enable `zenumlDebug`** — open the browser console on the target Confluence page and run `localStorage.setItem('zenumlDebug', 'true')`, then reload. This unlocks the debug toolbar and version label inside the macro. Without it, key diagnostic signals are invisible.
2. **Confirm the commit** — read the version label in the macro toolbar and match it against the expected commit SHA or release tag. GitHub PR commits use a merge commit hash (e.g. `abc1234` from the "Merge pull request" commit) that differs from the branch HEAD — always verify against the *actual* deployed SHA, not the PR's branch tip.

## Related skills

| Skill                                 | When                                                                        |
|---------------------------------------|-----------------------------------------------------------------------------|
| **repro**                             | Confirm a bug exists before fixing                                          |
| **validate-branch**                   | Pre-push branch smoke via tunnel or dev site                                |
| **release-app**                       | Step 2.6 — release-delta spot check after PVT                               |
| **pvt** / **pvt-***                   | Reusable production recipes — methods, not substitutes for writing assertions |
| **create-test-page**                  | API-only page setup when you need specific macro content without the editor |
| **graph-macro**, **copy-macro**, etc. | Focused recipes for specific macro flows                                    |
