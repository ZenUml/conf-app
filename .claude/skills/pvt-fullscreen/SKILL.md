---
name: pvt-fullscreen
description: >
  Focused production validation for macro fullscreen / expanded viewer (Forge fullscreen modal
  bridge). Opens fullscreen from the viewer toolbar, verifies the diagram remains usable, then exits
  cleanly. Invoked by release-app Step 5.5 when fullscreen-related commits are detected.
  Triggers on "pvt-fullscreen", "test fullscreen", "validate fullscreen viewer".
---

# PVT — Fullscreen viewer

Focused post-release validation for **fullscreen / expanded macro viewing** on `zenuml.atlassian.net` (production).

## Arguments

Usage: `/pvt-fullscreen [lite] [full] [diagramly]`

### Which product (variant) to test

1. **Explicit flags** — If the user names `lite`, `full`, and/or `diagramly`, test **only** those, in order.
2. **Infer from conversation** — If no flags: derive variant from the thread (release tag, `/release-app …`, Step 5.5 parent release, user saying Lite/Full/Diagramly, branch/PR hints). Test **that** variant only.
3. **If still ambiguous** — Ask: lite, full, or diagramly? **Do not** run all three by default.

Site: always production (`zenuml.atlassian.net`).

Space/parent for creating scratch pages: **ZEN** / parent **`247136259`** (`Test pages`) — see `smoke-test` skill.

## Prerequisites

- Logged into production Confluence in the browser session (Playwright MCP or headed runner).
- **Forge iframe only:** interact via `page.locator('[data-testid="hosted-resources-iframe"]').contentFrame()` or frame walk — see `CLAUDE.md` / `smoke-test` skill.
- A **published** page that already contains a diagram macro for the target variant (sequence or mermaid is fine). Alternatively create one page via `/smoke-test on zenuml <variant> mermaid` first.

## Confluence page title (when creating a scratch page)

Any **new** page created for this test must use **`smoke-test` § Page title format** (`Smoke Test <lite|full|diagramly> <YYYY-MM-DD HH:mm> (<label>)`) so product and datetime appear in the title.

## What to validate

After recent fullscreen work, Confluence may host the expanded UI in a dedicated fullscreen modal layer. Useful selectors (verify in DevTools if a deploy changes labels):

- Forge app iframe: `[data-testid="hosted-resources-iframe"]`
- Fullscreen shell (when used): `[data-testid="custom-ui-fullscreen-modal-dialog"]` — presence varies by entry path; **fail only if** fullscreen action produces a blank screen, thrown overlay error, or unusable diagram area.

## Steps

### 1. Navigate to a viewer page

Open a published Confluence URL under `zenuml.atlassian.net` where the chosen variant’s macro renders (toolbar shows version like `vYYYY.MM.DDHHMM-<variant>`).

Confirm the **macro toolbar** is visible inside the iframe (Fullscreen / Edit / Export region — exact labels may vary slightly by macro type).

### 2. Enter fullscreen

Inside the **Forge iframe**, click the control that enters fullscreen / expands the viewer (commonly labeled **Fullscreen** or uses a fullscreen icon).

**Expected:**

- A fullscreen or maximized presentation opens (may be the fullscreen modal dialog or Confluence fullscreen chrome).
- Diagram content remains visible (not empty canvas).
- No uncaught error toast in the parent page.

**Fail if:** click does nothing after ~15s, iframe goes blank, or Confluence shows a generic error page.

### 3. Exercise minimal interaction

While fullscreen:

- Scroll or zoom if the UI exposes it — diagram should stay coherent.
- Optionally trigger **Edit** from fullscreen only if that is the usual product path; otherwise skip to avoid overlapping with `/pvt-edit`.

**Fail if:** hard crash, permanent loading spinner, or diagram disappears.

### 4. Exit fullscreen

Use the **visible exit** control (Close, Exit fullscreen, or **Escape** if documented for this surface).

**Expected:** returns to normal embedded viewer; page still functional.

**Fail if:** stuck in fullscreen, duplicate modal layers, or viewer iframe fails to recover.

### 5. Version sanity

After exit, re-read the iframe toolbar line — version token should still match the release under test (same `v…​-lite|-full|-diagramly` pattern as `/pvt`).

## Optional cheap automation

When the full conf-app repo and Playwright auth state are available:

```bash
cd tests/e2e-tests
APP=zenuml-<variant>@prod pnpm exec playwright test --grep fullscreen
```

(Run only if a dedicated test exists; otherwise manual MCP steps above are the source of truth.)

## Pass/Fail Report

```
## pvt-fullscreen: PASS | FAIL
- Variant(s): lite | full | diagramly
- Step 2 (enter fullscreen): PASS | FAIL — <note>
- Step 3 (interaction): PASS | FAIL | SKIPPED — <note>
- Step 4 (exit): PASS | FAIL — <note>
- Step 5 (version still visible): PASS | FAIL — <version string>
```
