---
name: pvt-drawio
description: >
  Focused production validation for the Graph (DrawIO) macro: nested Forge + DrawIO iframes,
  title field, at least one shape on the canvas (required — avoids false PASS on empty diagrams),
  Publish from inner editor, and verified rendered geometry on the Confluence page. Invoked by
  release-app Step 5.5 when graph/drawio-related commits are detected.
  Triggers on "pvt-drawio", "test drawio", "validate graph macro".
---

# PVT — Graph (DrawIO) macro

Focused post-release validation for **Graph (DrawIO)** on `zenuml.atlassian.net` (production).

## Arguments

Usage: `/pvt-drawio [lite] [full] [diagramly]`

### Which product (variant) to test

1. **Explicit flags** — If the user names one or more of `lite`, `full`, `diagramly` on the command line, test **only** those, in order.
2. **Infer from conversation** — If no flags were given, **decide from context** before running anything:
   - **Release thread:** e.g. `/release-app diagramly`, a published tag like `v….-lite`, or “we’re shipping Full” → test that variant only.
   - **`release-app` Step 5.5:** When this skill is invoked from the release workflow, use the **same variant as that release** (e.g. releasing diagramly → `/pvt-drawio diagramly`).
   - **User wording:** “Lite macro”, “Diagramly”, “Full Forge”, branch/PR names containing `lite`, `full`, `diagramly`.
3. **If still ambiguous** — Ask one question: which variant: lite, full, or diagramly? **Do not** assume “test all three” or pick a random default.

**Lite** macro names include **Lite**; Full and Diagramly do not — see `smoke-test` skill.

Site: always production.

## Prerequisites

- Logged into production.
- Macro available for variant (Diagramly staging/prod profiles sometimes omit graph from API-render tests — UI insert still targets Forge when the macro is installed).

## Confluence page title (scratch pages)

When **creating** a Confluence page for this run (not when reusing an existing smoke page), set the title **before** inserting the macro — same rule as **`smoke-test` § Page title format**:

```text
Smoke Test <lite|full|diagramly> <YYYY-MM-DD HH:mm> (Graph)
```

Use the **resolved variant** for this skill invocation (`lite`, `full`, or `diagramly`) and **local** clock for `YYYY-MM-DD HH:mm` (24-hour). Add **seconds** to the time only if Confluence rejects a duplicate title.

## Critical: double iframe

DrawIO uses **nested** iframes:

1. Confluence → Forge **`[data-testid="hosted-resources-iframe"]`** (outer)
2. Outer iframe → **inner** DrawIO canvas iframe — **Publish** for the graph lives in the **inner** frame per `smoke-test` skill.

**Fail if** automation targets the wrong frame (timeouts on Publish, or title filled in wrong context).

## Why “add a shape” is required

Title + Publish alone can save a **valid but empty** diagram. Toolbar text and version strings then **PASS** while the canvas is blank. **PASS** for this skill requires **at least one** drawable element on the canvas before Publish, plus a **geometry** check on the published page (not toolbar text alone).

## Steps (aligned with smoke-test)

### 1. Create and insert macro

- Parent page: ZEN / `247136259` unless using an existing smoke page.
- Set the **Confluence page title** per § Confluence page title (scratch pages) — include **product** + **datetime** + `(Graph)`.
- Browse → search `graph` → select **Graph (DrawIO)** with correct app label for variant.
- Insert and wait **≥ 8s** for DrawIO shell (slow load is normal).

### 2. Fill title (outer iframe)

In the **outer** hosted-resources iframe, use `getByRole('textbox', { name: 'Name your graph…' })` (label text may vary slightly — use snapshot).

### 3. Add one visible shape (inner iframe) — **required**

Focus the **inner** DrawIO iframe (see § Critical: double iframe).

- **Manual:** Open the **General** shape library (left sidebar), **drag a Rectangle** onto the canvas, **or** choose the rectangle tool and **click once** on the canvas so a box appears.
- **Automation (Playwright):** Prefer acting inside `outer.locator('iframe').first().contentFrame()` — wait for the diagram surface, then simulate drag from a sidebar shape to the canvas center, or use DrawIO’s click-to-insert flow if exposed. Exact selectors vary by Draw.io build; use `browser_snapshot` and stable roles where possible.

**Fail if** the canvas remains empty (no new shape) before step 4.

### 4. Publish from inner iframe

Locate **inner** iframe under outer, then `getByRole('button', { name: 'Publish' })` inside inner.

### 5. Publish Confluence page

Use Confluence **Publish** / confirmation pattern from `smoke-test`.

### 6. Verify rendered output (strict)

On the **published** page, wait **≥ 8s**, scroll the macro into view, then confirm **diagram geometry**, not only the Forge toolbar:

| Check | How |
|--------|-----|
| **Geometry present** | Inside the viewer’s **`hosted-resources-iframe`**, evaluate e.g. `document.querySelectorAll('svg path, svg rect, svg ellipse, svg g[transform]').length` (threshold: **≥ 1** meaningful node — tune if DrawIO wraps decor only). Alternatively count cells if DrawIO exposes them in DOM. |
| **Visual fallback** | `browser_take_screenshot` of the macro viewport — **Fail** if the diagram area is uniformly blank white with no shapes (same as human “empty graph”). |
| **Lazy load** | If inner iframe count is **0** on view, wait up to **15s** and re-check — some sites render a static preview without the editor iframe. |

**Fail if:** only toolbar/version text is present in `innerText` but **no** SVG geometry (or screenshot shows empty canvas).

**Note:** `body.innerText` often **misses** canvas/SVG content; do **not** rely on text length alone.

## Optional automation

```bash
cd tests/e2e-tests
APP=zenuml-lite@prod pnpm exec playwright test tests/insert/graph.spec.ts --project=insert
```

The stock insert test may **not** add a shape — if it only sets title + Publish, treat automation as **layout smoke** and still run **steps 3 + 6** manually or extend the test to drop one rectangle before Publish.

## Pass/Fail Report

```
## pvt-drawio: PASS | FAIL | SKIPPED
- Variant(s): lite | full | diagramly
- Insert + title (outer frame): PASS | FAIL — <note>
- Step 3 (≥1 shape on canvas before Publish): PASS | FAIL — <note>
- Publish (inner frame): PASS | FAIL — <note>
- Published page (geometry or screenshot): PASS | FAIL — <note>
- Version string in toolbar (if shown): <string or N/A>
```
