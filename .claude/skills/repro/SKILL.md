---
name: repro
description: >
  Reproduce a bug in the conf-app. Extract the bug from the current conversation
  or user prompt, then try to reproduce it in the simplest available environment.
  Use when the user says "repro", "reproduce", "can you repro this", "reproduce the bug",
  "verify this bug", or describes a bug they want confirmed.
  Try environments in strict order: local dev server first, then conf-stg-lite.zenuml.com,
  then conf-lite.zenuml.com, then real Confluence as last resort.
---

# Repro Skill

Reproduce a bug by gathering context from the conversation and exercising the simplest
available environment.

## Step 1 — Extract the Bug

Read the conversation and/or the user's prompt to identify:

- **Trigger**: The exact action(s) that cause the bug (clicks, navigation, state)
- **Observed**: What actually happens (wrong behavior)
- **Expected**: What should happen instead
- **Component**: Which UI component or flow is involved

If key details are missing, ask one focused question before proceeding.

## Step 2 — Choose the Right Environment

Pick the simplest environment that can exercise the affected code path:

| Bug type | First try |
|----------|-----------|
| GenericViewer header, paywall dialog, edit button, Continue editing, UpgradePrompt variants | Local SPA (`viewer-preview.html`) |
| Forge modal editor, save/load, content provider, fullscreen | Confluence (Forge) |
| Cloudflare Worker endpoints (API, webhook, D1) | `curl` locally or against staging |
| Visual / rendering issues in the macro itself | Local SPA or staging Confluence |

When in doubt, start local.

## Step 3 — Environment Priority Order

### A. Local SPA (`viewer-preview.html`)

This is a Vite dev server that mounts GenericViewer directly — no Confluence, no Forge auth.
It mocks the paywall state via localStorage:
- `?noBlock=0` → paywall ACTIVE (macroCount=120, CSS flag on, spacePaid=false) ← default
- `?noBlock=1` → paywall INACTIVE (macroCount=60)

**Check if running:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/viewer-preview.html
```

**If 200:** Use Playwright to interact with `http://127.0.0.1:8080/viewer-preview.html`.

**If not running:** Start it from the project or worktree directory:
```bash
pnpm start:local &
sleep 4
```
Then re-check and proceed.

Use `mcp__playwright__*` tools to automate browser interactions.
Take a screenshot after each key interaction to document what you observe.

**Track the EventBus edit counter exposed by the harness:**
```js
// After page load
page.evaluate(() => window.__editFiredCount)
// Should be 0 initially; increments each time EventBus.$emit('edit') fires
```

### B. Staging hosted app (`conf-stg-lite.zenuml.com`)

For bugs that need the Cloudflare Workers backend but not a Confluence page.
Navigate directly to `https://conf-stg-lite.zenuml.com/<path>`.

### C. Production hosted app (`conf-lite.zenuml.com`)

Only if the bug is not reproducible on staging (e.g., production-only data or config).

### D. Confluence (last resort)

Use the Playwright smoke-test pattern to open the macro on a Confluence test page.
See `/smoke-test` for the full playbook.
Suitable Confluence instances: `lite-stg.atlassian.net` (staging), `zenuml.atlassian.net` (prod).

## Step 4 — Reproduce and Document

Walk through the trigger steps one at a time. After each step:
- Take a screenshot
- Note what changed in the UI

At the end, state clearly:
- **Reproduced**: Yes / No
- **Environment used**: which one worked
- **Exact steps**: numbered list
- **Evidence**: what you saw (screenshots, console output, counter values)

If the bug is NOT reproduced, explain what you tried and why you believe it didn't trigger,
then suggest the next environment to try or ask the user for more context.

## Playwright Tips for This App

The Playwright MCP (`mcp__playwright__*`) is the right tool for browser automation.

- The local SPA (`viewer-preview.html`) is NOT inside a Forge iframe, so standard
  `browser_click`, `browser_snapshot`, etc. work directly.
- For elements behind the paywall modal, the modal renders via `<Teleport to="body">` —
  it's in the DOM but outside the main component tree. Use `data-testid` attributes:
  - `[data-testid="continue-editing-btn"]` — "Continue editing without upgrading" button
- To inspect Vue state without browser DevTools, evaluate JS:
  ```js
  window.__editFiredCount  // EventBus edit counter
  ```
- If an element isn't found, call `browser_snapshot` first to see the current a11y tree.
