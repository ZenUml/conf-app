---
name: smoke-test
description: >
  [on <site>] [lite|full|diagramly] [macros...]
  Sites: zenuml-stg (default), zenuml, lite-stg, full-stg, dia-stg, diagramly.
  Smoke test ZenUML Confluence Cloud macros (ZenUML, PlantUML, Mermaid, Graph/DrawIO, OpenAPI).
  Uses the Playwright MCP to create a test page, insert macros, publish, and verify rendering.
  Triggers on "smoke test confluence", "test macros on staging", "verify ZenUML on confluence",
  "run smoke test on zenuml-stg", "test lite macros", or any macro validation request.
---

# Confluence Smoke Test — ZenUML Macros

Drive the smoke test using the available Playwright MCP tools (`mcp__playwright__*`).

## Arguments

Usage: `/smoke-test [on <site>] [lite|full|diagramly] [macros to test]`

- **Site**: `zenuml-stg` (default), `zenuml` (prod), `lite-stg`, `full-stg`, `dia-stg`, `diagramly`
- **Variant**: `lite` (Forge), `full` (Forge), or `diagramly` (Forge)
- **Macros**: Default = all. User can request a subset.

## Sites

| Name | URL | Space | Parent Page ID | Default Variant |
|------|-----|-------|----------------|-----------------|
| zenuml-stg | zenuml-stg.atlassian.net | ZS | `177176629` | full |
| zenuml (prod) | zenuml.atlassian.net | ZEN | `247136259` | full |
| lite-stg | lite-stg.atlassian.net | SD | (discover) | lite |
| full-stg | full-stg.atlassian.net | SD | `229492` | full |
| dia-stg | dia-stg.atlassian.net | SD | `1736705` | diagramly |
| diagramly (prod) | diagramly.atlassian.net | TEAM | `205422593` | diagramly |

If parentPageId is unknown, discover it (see Step 0).

## Variant Differences

All three variants use the **Forge fullscreen modal** pattern (verified 2026-06-04 on zenuml.atlassian.net for Lite, Full, and Diagramly):
- Dialog: `[data-testid="custom-ui-fullscreen-modal-dialog"]`  ← ALL variants; `custom-ui-modal-dialog` is obsolete
- App iframe: `[data-testid="hosted-resources-iframe"]`

**Always scope the iframe locator to the modal wrapper** to avoid strict-mode violations on multi-install sites (e.g. `zenuml.atlassian.net` has all 3 apps installed, so 3 `hosted-resources-iframe` elements exist simultaneously):
```js
page.locator('[data-testid="custom-ui-fullscreen-modal-dialog"] [data-testid="hosted-resources-iframe"]').contentFrame()
```

Lite appends " Lite" to macro names. Diagramly and Full do not.
Staging apps append " (Staging)" — this is fine, matching handles it automatically.

### Disambiguating Full vs Diagramly when both are installed

Production site `zenuml.atlassian.net` has **all three apps installed side-by-side**, so the Diagram macro appears in the macro browser as:

| # | Name (search match) | Description (disambiguator) | Module key |
|---|---------------------|------------------------------|------------|
| 1 | `Diagram (Mermaid, PlantUML & ZenUML)` | `Diagramly for Confluence` | `gpt-diagram-macro` |
| 2 | `Diagram (Mermaid, PlantUML & ZenUML)` | `ZenUML for Confluence` | `zenuml-sequence-macro` |
| 3 | `Diagram (Mermaid, PlantUML & ZenUML) Lite` | `ZenUML for Confluence Lite` | `zenuml-sequence-macro-lite` |

Full and Diagramly share the exact same display name, so `.filter({ hasText: 'Diagram (Mermaid' }).filter({ hasNotText: 'Lite' }).first()` non-deterministically picks one — usually the wrong one. Always disambiguate by **description text** when targeting a specific variant:

| Variant | Filter chain (use these exact filters) |
|---------|----------------------------------------|
| Lite | `.filter({ hasText: 'Diagram (Mermaid' }).filter({ hasText: 'Lite' })` |
| Full | `.filter({ hasText: 'Diagram (Mermaid' }).filter({ hasText: 'ZenUML for Confluence' }).filter({ hasNotText: 'Lite' })` |
| Diagramly | `.filter({ hasText: 'Diagram (Mermaid' }).filter({ hasText: 'Diagramly for Confluence' })` |

**Verification before clicking**: when in doubt, enumerate the options first and confirm which index matches your target — the wrong variant produces a successful save with the wrong app's bundle, debug bar, and D1 row. The toolbar version label (e.g. `…-full:e34a…` vs `…-diagramly:e34a…`) is the after-the-fact tell.

Same disambiguation applies to **Graph (DrawIO)** and **OpenAPI** macros — on multi-install sites, expect 2–3 entries per macro type; pick by description text. If a variant's macro browser entry isn't observable, the app likely isn't installed on that site.

## Lite paywall on over-limit test spaces (e.g. `lite-stg` / `SD`)

`lite-stg`'s `SD` space is deliberately kept over the Lite 100-macro limit (thousands of macros) as
shared paywall test data (see the **paywall** skill). Every macro-editor mount there shows the
`UpgradePrompt` modal INSIDE the Forge iframe — handle it unconditionally right after locating the
modal frame, before any tab/title interaction:

```js
const draftBanner = frame.locator('[data-zenuml-draft-banner]');
if (await draftBanner.isVisible({ timeout: 1000 }).catch(() => false)) {
  await draftBanner.locator('button', { hasText: 'Discard' }).click();  // stale in-progress edit from a prior aborted session
  await page.waitForTimeout(500);
}
const paywallBtn = frame.locator('button', { hasText: 'Continue editing' });
if (await paywallBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
  await paywallBtn.first().click();
  await page.waitForTimeout(500);
}
```

**Do NOT locate this button with `getByRole('button', { name: ... })`** — it has an
`aria-label` ("You have N temporary continue attempt left...") that differs entirely from its
visible text ("Continue editing without upgrading (N)"), so role-based name matching never
resolves and hangs for the full timeout with no error. Plain tag+text locators bypass this
(verified 2026-07-27).

**The counter is cumulative, not per test run.** It's `localStorage`-keyed
`paywallContinueAttempts:<domain>:<spaceKey>:<accountId>` inside the **Forge iframe's origin**
(`*.cdn.prod.atlassian-dev.net`), default 15, decremented once per click across *all* smoke-test
runs and manual testing against that (domain, space) pair — a single 5-macro run does not reset it.
If it hits 0, the button is replaced by non-clickable "Request extension" text. Reset it proactively
at the start of a run (cheap) rather than discovering exhaustion mid-run:

```js
const forgeFrame = page.frames().find(f => f.url().includes('cdn.prod.atlassian-dev.net'));
const keys = await forgeFrame.evaluate(() => Object.keys(localStorage));
const key = keys.find(k => k.startsWith('paywallContinueAttempts:'));  // find the actual accountId suffix first
if (key) await forgeFrame.evaluate((k) => localStorage.removeItem(k), key);
```

## Page title format (required)

Whenever this skill **creates a new Confluence page**, set the **page title** to:

```text
Smoke Test <lite|full|diagramly> <YYYY-MM-DD HH:mm> (<short label>)
```

| Part | Meaning |
|------|---------|
| `Smoke Test` | Fixed prefix so runs are easy to search in Confluence. |
| Product (`lite`, `full`, or `diagramly`) | Forge **variant** for this run — must match the smoke-test variant. |
| `<YYYY-MM-DD HH:mm>` | **Local** date and time, 24-hour clock, minutes zero-padded. Example: `2026-05-11 14:30`. |
| `<short label>` | Macro slot from the table below: `Sequence`, `Mermaid`, `PlantUML`, `Graph`, `OpenAPI`. |

**Example:** `Smoke Test diagramly 2026-05-11 14:30 (Graph)`.

If Confluence reports a **duplicate title** (same variant + same minute), append **seconds** (`YYYY-MM-DD HH:mm:ss`) or a short random suffix, then retry.

## Critical Playwright MCP Behaviors (learned from testing)

**Forge iframe elements are exposed in the a11y tree** — after `browser_snapshot`, iframe
elements appear with `f9e*` ref prefixes. Using `browser_click ref=f9e22` or
`browser_type ref=f9e22 text="..."` automatically generates correct `contentFrame()` code.
This solves cross-origin iframe interaction without any special handling.

**NEVER use `browser_press_key('/')` in the Confluence editor** — it disconnects the Playwright
MCP extension every time (CDP crash). Instead, type "/" via `browser_type ref=<editor-ref> text="/"`.
`browser_type` uses `fill()` which DOES trigger the slash menu on Confluence (confirmed).

**`fill('/')` only works reliably when the editor is empty or contains only plain text** — after
a macro node is inserted, ProseMirror's document structure is complex (macro nodes are atom nodes).
`fill()` may not position the cursor correctly after existing macro nodes and can silently insert
"/" as garbage text without triggering the slash menu. For the 2nd macro onwards, use `slowly: true`
(`pressSequentially`) instead — it fires keydown/keypress/keyup events that ProseMirror handles correctly.

**Always re-snapshot before using refs** — refs become stale after DOM changes (page load,
macro insert, panel open). Call `browser_snapshot` and use the fresh refs.

**Editor textbox ref changes after macro insert** — after a macro is published and the modal closes,
take a fresh snapshot to get the new textbox ref. The textbox will show `[active]` only after you
click the editor area. Use `browser_click ref=<editor-area>` first, then snapshot, then find the
new `textbox "Page editing area..."` ref before typing.

**`browser_wait_for text="..."` cannot see iframe text** — use `browser_take_screenshot` + a
fixed wait instead of waiting for text that lives inside the Forge CDN iframe.

**If browser disconnects** — call `browser_close` then `browser_navigate` back to the edit URL.
Auto-save recovers all content including partially-inserted macros.

## Smoke Test Steps

### Step 0: Navigate, login if needed, discover parent page

Credentials live in `tests/e2e-tests/.env`:
- `ZENUML_STAGE_USERNAME`, `ZENUML_STAGE_PASSWORD`, `ATLASSIAN_OTP` (TOTP secret)

```
browser_navigate url="https://{domain}/wiki/home"
browser_take_screenshot   ← check if on login page
```

If on login page, fill credentials using `browser_snapshot` to get input refs, then
`browser_type` for username/password. For OTP, generate it via shell:
```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app/tests/e2e-tests
node -e "const o = require('./utils/otp.js'); console.log(o.generateOtp())"
```
Then `browser_type` the OTP into the verification input.

If parentPageId is unknown, navigate to the REST search endpoint directly and read the JSON:
```
browser_navigate url="https://{domain}/wiki/rest/api/content/search?cql=space%3DSD%20AND%20title%20~%20%22Smoke%20Test%22&expand=ancestors&limit=3"
browser_take_screenshot   ← read ancestors[last].id from JSON
```

### Step 1–2: One page per macro

**Each macro gets its own page.** This is the most reliable approach — it eliminates all cursor
repositioning problems. The slash menu always works reliably on a fresh/empty editor.

**Macro list — create one page for each:**

| # | Macro | Search term | Tab / action | Page title (see § Page title format) |
|---|-------|-------------|--------------|----------------------------------------|
| 1 | Diagram Lite — Sequence (ZenUML) | `zenuml` | Click "Sequence" tab | `Smoke Test <variant> <YYYY-MM-DD HH:mm> (Sequence)` |
| 2 | Diagram Lite — Mermaid | `zenuml` | Click "Mermaid" tab | `Smoke Test <variant> <YYYY-MM-DD HH:mm> (Mermaid)` |
| 3 | Diagram Lite — PlantUML | `zenuml` | Click "PlantUML" tab | `Smoke Test <variant> <YYYY-MM-DD HH:mm> (PlantUML)` |
| 4 | Graph (DrawIO) Lite | `graph` | Wait 8s, title = "Name your graph…" | `Smoke Test <variant> <YYYY-MM-DD HH:mm> (Graph)` |
| 5 | OpenAPI Lite | `openapi` | Wait 5s, title = "Title" | `Smoke Test <variant> <YYYY-MM-DD HH:mm> (OpenAPI)` |

For Full/Diagramly variants, macro names do not include "Lite" — adjust the search match accordingly.

**Important:** Each page title includes **product type** (`lite` / `full` / `diagramly`) and **datetime** (`YYYY-MM-DD HH:mm`) per § Page title format. Add seconds only if Confluence rejects a duplicate.

**For each macro, repeat this flow:**

#### Create a page

```
browser_navigate url="https://{domain}/wiki/create-content/page?spaceKey={spaceKey}&parentPageId={parentPageId}"
```

Wait 3s, then set the page title via evaluate (more reliable than snapshot+type). Substitute `{variant}` (`lite` \| `full` \| `diagramly`) and `{macro label}` (`Sequence`, `Mermaid`, etc.) for the current macro:
```
browser_evaluate function="() => {
  // Selector: textarea[name='editpages-title']  (NOT [placeholder='Give this page a title'] — that doesn't match)
  const t = document.querySelector('textarea[name=\"editpages-title\"]');
  if (!t) return 'not found';
  t.focus();
  const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const variant = '{variant}';  // lite | full | diagramly — must match this smoke-test run
  const macroLabel = '{macro label}';  // e.g. Mermaid, Graph
  s.call(t, 'Smoke Test ' + variant + ' ' + stamp + ' (' + macroLabel + ')');
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return 'set';
}"
```

If publish fails with duplicate title, re-run evaluate with `stamp` including seconds: append `':' + pad(d.getSeconds())` inside the datetime string.

**Note:** Uniqueness comes from variant + minute-level timestamp; use seconds only on collision.

#### Open slash menu, browse, and insert macro — all in one script

Use `browser_run_code` to open the editor, trigger the slash menu, search the Browse dialog,
and interact with the Forge modal in a **single tool call** per macro. This avoids repeated
`browser_snapshot` → grep → ref cycles.

**For Diagram macros (Sequence / Mermaid / PlantUML):**

```
browser_run_code code="async (page) => {
  // Activate editor and open slash menu
  await page.locator('[data-testid=\"ak-editor-fp-content-area\"]').click();
  await page.getByRole('textbox', { name: 'Page editing area, start' }).fill('/');
  await page.getByText('View more').first().waitFor({ state: 'visible', timeout: 10000 });

  // Open Browse dialog
  await page.getByText('View more').first().click();
  await page.waitForTimeout(2000);

  // Search for macro (use 'zenuml', 'graph', or 'openapi')
  const dialog = page.locator('[role=dialog][aria-label=\"Browse\"]');
  const input = dialog.locator('input');
  await input.focus();
  await input.fill('zenuml');
  await input.dispatchEvent('input');
  await input.dispatchEvent('change');
  await page.waitForTimeout(2000);

  // Click matching option — disambiguate by description text (see "Disambiguating Full vs Diagramly" above):
  //   Lite:      .filter({ hasText: 'Lite' })
  //   Full:      .filter({ hasText: 'ZenUML for Confluence' }).filter({ hasNotText: 'Lite' })
  //   Diagramly: .filter({ hasText: 'Diagramly for Confluence' })
  // The example below targets Full — substitute the line for the variant you are testing.
  const options = dialog.locator('[role=option], [role=gridcell] button');
  const match = options
    .filter({ hasText: 'Diagram (Mermaid' })
    .filter({ hasText: 'ZenUML for Confluence' })
    .filter({ hasNotText: 'Lite' })
    .first();
  await match.click();
  await page.waitForTimeout(500);
  // REQUIRED: Browse dialog selects on click but needs Insert button to confirm
  await page.getByTestId('ModalElementBrowser__insert-button').click();

  // Wait for Forge modal and interact with iframe
  // All variants use custom-ui-fullscreen-modal-dialog. Scope to modal to avoid strict-mode violations.
  await page.waitForTimeout(5000);
  const frame = page.locator('[data-testid=\"custom-ui-fullscreen-modal-dialog\"] [data-testid=\"hosted-resources-iframe\"]').contentFrame();

  // Handle stale-draft banner + Lite paywall (see \"Lite paywall\" section above) — do NOT use getByRole here
  const draftBanner = frame.locator('[data-zenuml-draft-banner]');
  if (await draftBanner.isVisible({ timeout: 1000 }).catch(() => false)) {
    await draftBanner.locator('button', { hasText: 'Discard' }).click();
    await page.waitForTimeout(500);
  }
  const paywallBtn = frame.locator('button', { hasText: 'Continue editing' });
  if (await paywallBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await paywallBtn.first().click();
    await page.waitForTimeout(500);
  }

  await frame.locator('button', { hasText: 'Sequence' }).click();  // change tab name as needed
  await frame.getByRole('textbox', { name: 'Name your diagram…' }).fill('Test Sequence');
  await frame.locator('button', { hasText: 'Publish' }).first().click();

  // Publish the Confluence page
  // The 'Publish page' confirmation modal may intercept clicks on the toolbar publish-button.
  await page.waitForTimeout(2000);
  await page.getByTestId('publish-button').click();
  await page.waitForTimeout(1500);
  const dialogPublish = page.locator('button', { hasText: 'Publish' }).last();
  if (await dialogPublish.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dialogPublish.click({ timeout: 5000 });
  }
  await page.waitForURL(u => !u.toString().includes('edit-v2'), { timeout: 30000 });
  return page.url();
}"
```

Change `tab: 'Sequence'` → `'Mermaid'` or `'PlantUML'` and title accordingly per macro.
Use `frame.locator('button', { hasText: ... })` for tabs and Publish buttons throughout —
`getByRole('tab'/'button', { name })` is unreliable in this app (confirmed 2026-07-27: the tab
buttons and the page-level "Publish page" confirmation button both intermittently fail role-based
name matching even though they resolve fine via a plain tag+text locator).
Swap the variant filter chain per the per-variant recipe in the snippet comments — always include the description-text filter when running on a multi-install site like `zenuml.atlassian.net` (production) where Full and Diagramly share the same display name.

**For Graph (DrawIO):**

```
browser_run_code code="async (page) => {
  await page.locator('[data-testid=\"ak-editor-fp-content-area\"]').click();
  await page.getByRole('textbox', { name: 'Page editing area, start' }).fill('/');
  await page.getByText('View more').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('View more').first().click();
  await page.waitForTimeout(2000);

  const dialog = page.locator('[role=dialog][aria-label=\"Browse\"]');
  const input = dialog.locator('input');
  await input.focus();
  await input.fill('graph');
  await input.dispatchEvent('input');
  await input.dispatchEvent('change');
  await page.waitForTimeout(2000);

  // Disambiguate variants by description text on multi-install sites (e.g. zenuml.atlassian.net prod):
  //   Lite:      .filter({ hasText: 'Lite' })
  //   Full:      .filter({ hasText: 'ZenUML for Confluence' }).filter({ hasNotText: 'Lite' })
  //   Diagramly: .filter({ hasText: 'Diagramly for Confluence' })
  // Example below targets Full.
  const match = dialog.locator('[role=option], [role=gridcell] button')
    .filter({ hasText: 'Graph (DrawIO)' })
    .filter({ hasText: 'ZenUML for Confluence' })
    .filter({ hasNotText: 'Lite' })
    .first();
  await match.click();
  await page.waitForTimeout(500);
  await page.getByTestId('ModalElementBrowser__insert-button').click();

  // DrawIO: double-nested iframe — title in outer, canvas + Publish in inner
  await page.waitForTimeout(8000);
  const outerFrame = page.locator('[data-testid=\"custom-ui-fullscreen-modal-dialog\"] [data-testid=\"hosted-resources-iframe\"]').contentFrame();

  // Handle stale-draft banner + Lite paywall (see \"Lite paywall\" section above) — do NOT use getByRole here
  const draftBanner = outerFrame.locator('[data-zenuml-draft-banner]');
  if (await draftBanner.isVisible({ timeout: 1000 }).catch(() => false)) {
    await draftBanner.locator('button', { hasText: 'Discard' }).click();
    await page.waitForTimeout(500);
  }
  const paywallBtn = outerFrame.locator('button', { hasText: 'Continue editing' });
  if (await paywallBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await paywallBtn.first().click();
    await page.waitForTimeout(500);
  }

  await outerFrame.getByRole('textbox', { name: 'Name your graph…' }).fill('Test Graph');
  const innerFrame = outerFrame.locator('iframe').contentFrame();

  // REQUIRED: draw a shape, else the graph publishes EMPTY (the default DrawIO
  // canvas has no cells, so the macro renders blank and doesn't exercise the
  // graph renderer). Double-click the canvas to open DrawIO's shape picker,
  // then click the first shape item with a REAL Playwright click — synthetic
  // dispatched MouseEvents do NOT register with DrawIO's handlers; only a real
  // CDP mouse click inserts the shape. Verified 2026-06-05 on zenuml prod.
  await innerFrame.locator('.geDiagramContainer').first().dblclick({ position: { x: 500, y: 350 } });
  await page.waitForTimeout(1500);
  await innerFrame.locator('.geShapePicker .geItem').first().click();  // real click → inserts shape
  await page.waitForTimeout(1200);
  await page.keyboard.type('Test Graph', { delay: 40 });  // label the new shape
  await page.keyboard.press('Escape');                    // commit the label
  await page.waitForTimeout(800);

  // Re-read the title before publishing — the shape-label typing above can land in the
  // title field instead if focus didn't move as expected (see paywall skill's Graph gotcha).
  const titleAfter = await outerFrame.getByRole('textbox', { name: 'Name your graph…' }).inputValue().catch(() => null);
  if (titleAfter !== 'Test Graph') await outerFrame.getByRole('textbox', { name: 'Name your graph…' }).fill('Test Graph');

  await innerFrame.locator('button', { hasText: 'Publish' }).click();

  await page.waitForTimeout(2000);
  await page.getByTestId('publish-button').click();
  await page.waitForTimeout(1500);
  const dialogPublish = page.locator('button', { hasText: 'Publish' }).last();
  if (await dialogPublish.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dialogPublish.click({ timeout: 5000 });
  }
  await page.waitForURL(u => !u.toString().includes('edit-v2'), { timeout: 30000 });
  return page.url();
}"
```

**For OpenAPI:**

```
browser_run_code code="async (page) => {
  await page.locator('[data-testid=\"ak-editor-fp-content-area\"]').click();
  await page.getByRole('textbox', { name: 'Page editing area, start' }).fill('/');
  await page.getByText('View more').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('View more').first().click();
  await page.waitForTimeout(2000);

  const dialog = page.locator('[role=dialog][aria-label=\"Browse\"]');
  const input = dialog.locator('input');
  await input.focus();
  await input.fill('openapi');
  await input.dispatchEvent('input');
  await input.dispatchEvent('change');
  await page.waitForTimeout(2000);

  // Disambiguate variants by description text on multi-install sites (e.g. zenuml.atlassian.net prod):
  //   Lite:      .filter({ hasText: 'Lite' })
  //   Full:      .filter({ hasText: 'ZenUML for Confluence' }).filter({ hasNotText: 'Lite' })
  //   Diagramly: .filter({ hasText: 'Diagramly for Confluence' })
  // Example below targets Full.
  const match = dialog.locator('[role=option], [role=gridcell] button')
    .filter({ hasText: 'OpenAPI' })
    .filter({ hasText: 'ZenUML for Confluence' })
    .filter({ hasNotText: 'Lite' })
    .first();
  await match.click();
  await page.waitForTimeout(500);
  await page.getByTestId('ModalElementBrowser__insert-button').click();

  await page.waitForTimeout(5000);
  // MUST scope to the modal wrapper — a bare [data-testid="hosted-resources-iframe"] locator
  // throws a strict-mode violation here: the page banner also renders one (confirmed 2026-07-27).
  const frame = page.locator('[data-testid=\"custom-ui-fullscreen-modal-dialog\"] [data-testid=\"hosted-resources-iframe\"]').contentFrame();

  // Handle stale-draft banner + Lite paywall (see \"Lite paywall\" section above) — do NOT use getByRole here
  const draftBanner = frame.locator('[data-zenuml-draft-banner]');
  if (await draftBanner.isVisible({ timeout: 1000 }).catch(() => false)) {
    await draftBanner.locator('button', { hasText: 'Discard' }).click();
    await page.waitForTimeout(500);
  }
  const paywallBtn = frame.locator('button', { hasText: 'Continue editing' });
  if (await paywallBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await paywallBtn.first().click();
    await page.waitForTimeout(500);
  }

  await frame.getByRole('textbox', { name: 'Title' }).fill('Test OpenAPI');
  await frame.locator('button', { hasText: 'Publish' }).first().click();

  await page.waitForTimeout(2000);
  await page.getByTestId('publish-button').click();
  await page.waitForTimeout(1500);
  const dialogPublish = page.locator('button', { hasText: 'Publish' }).last();
  if (await dialogPublish.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dialogPublish.click({ timeout: 5000 });
  }
  await page.waitForURL(u => !u.toString().includes('edit-v2'), { timeout: 30000 });
  return page.url();
}"
```

#### Verify and move to PVT

The `browser_run_code` script above already publishes the page and waits for the URL to change.
After it returns, take a screenshot to confirm rendering, then move to PVT:

```
browser_take_screenshot   ← confirm macro rendered
```

```
browser_evaluate function="async () => {
  // ... PVT move code (see Step 5)
}"
```

Then navigate to a new page and repeat for the next macro.

### Step 3: Publish the page

```
browser_snapshot   ← get ref for "Publish..." button in toolbar
browser_click ref=<publish-btn-ref> element="Publish..."
```

If a confirmation dialog appears, click the final Publish button:
```
browser_evaluate function="() => {
  const btns = Array.from(document.querySelectorAll('button'))
    .filter(b => b.textContent?.trim() === 'Publish');
  btns[btns.length - 1]?.click();
  return btns.length;
}"
```

Wait for the URL to change to a published page URL (no longer contains `edit-v2`):
```
browser_wait_for text="Edit" timeout=30000   ← "Edit" button appears on published page
```

### Step 4: Verify macros rendered

```
browser_take_screenshot   ← full page screenshot
browser_snapshot          ← count ForgeExtensionContainer iframes
```

Look for `[data-testid="ForgeExtensionContainer"]` elements in the snapshot. Each inserted macro
should produce one container. Report the count.

### Step 5: Move page to PVT folder

Extract the page ID from the current URL (`/pages/{pageId}/`), then:

**Important:** Do not use the v1 `/wiki/rest/api/content/{parentId}/child/page?title=...`
endpoint to look up folders by name. The `title=` filter is fuzzy and limited to a page of
children, so it can silently miss the real `PVT` page when the parent has many children.
Combined with `createFolder` swallowing the resulting 400 ("page already exists"), the move
ends up calling `movePage(pageId, undefined)` which returns 200 without re-parenting — a
silent failure. Use the v2 space-scoped lookup with an exact-title + parentId filter instead.

**Second gotcha (confirmed 2026-07-27 on `lite-stg`/`SD`): the top-level `PVT` folder may not be
a direct child of `parentId` at all.** Confluence page titles are unique per-*space*, not
per-parent, so an existing `PVT` page can be nested arbitrarily deep under some other historical
parent (e.g. found under `Software Development → Before release test pages → PVT` instead of
directly under `Software Development`). A parent-scoped lookup for `PVT` correctly finds nothing,
then `createFolder('PVT', parentId)` correctly 400s ("already exists") against the space-wide
title — the failure isn't pagination this time, it's a wrong assumption about nesting depth.
**Find the existing `PVT` page space-wide by CQL before ever attempting to create one:**

```
browser_navigate url="https://{domain}/wiki/rest/api/content/search?cql=space%3D{spaceKey}%20AND%20title%3D%22PVT%22&expand=ancestors&limit=5"
```

Read the single result's `id` and use it directly as `pvtId` for the year/month lookups below —
only fall back to `createFolder('PVT', parentId)` if this search genuinely returns zero results.

```
browser_evaluate function="async () => {
  const pageId = location.pathname.match(/\/pages\/(\d+)\//)?.[1];
  const parentId = '{parentPageId}';
  const spaceKey = '{spaceKey}';  // e.g. 'SD', 'ZS', 'ZEN'

  // Resolve numeric space id from the space key (v2 API needs the id, not the key)
  const sr = await fetch('/wiki/api/v2/spaces?keys=' + spaceKey, {headers: {'Accept': 'application/json'}});
  const spaceId = (await sr.json()).results[0].id;

  async function findExact(title, parent) {
    const r = await fetch('/wiki/api/v2/spaces/' + spaceId + '/pages?title=' + encodeURIComponent(title) + '&limit=50', {headers: {'Accept': 'application/json'}});
    if (!r.ok) throw new Error('findExact ' + title + ' failed: ' + r.status);
    const j = await r.json();
    return (j.results || []).find(p => p.title === title && (!parent || p.parentId === parent));
  }

  async function createFolder(title, parent) {
    const r = await fetch('/wiki/api/v2/pages', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({spaceId, status: 'current', title, parentId: parent, body: {representation: 'storage', value: ''}})});
    if (!r.ok) throw new Error('createFolder ' + title + ' failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return (await r.json()).id;
  }

  async function movePage(pid, newParentId) {
    // Use the purpose-built move endpoint — simpler and doesn't require version+body fetch
    const r = await fetch('/wiki/rest/api/content/' + pid + '/move/append/' + newParentId, {method: 'PUT', headers: {'Accept': 'application/json', 'Content-Type': 'application/json'}});
    if (!r.ok) throw new Error('movePage failed: ' + r.status);
  }

  const year = new Date().getFullYear().toString();
  const month = year + '-' + String(new Date().getMonth() + 1).padStart(2, '0');

  let pvt = await findExact('PVT', parentId);
  if (!pvt) pvt = {id: await createFolder('PVT', parentId)};
  let yr = await findExact(year, pvt.id);
  if (!yr) yr = {id: await createFolder(year, pvt.id)};
  let mo = await findExact(month, yr.id);
  if (!mo) mo = {id: await createFolder(month, yr.id)};
  await movePage(pageId, mo.id);
  return 'Moved to PVT / ' + year + ' / ' + month;
}"
```

### Step 6: Report results

Summarize:
- Which macros were inserted successfully (and which tab was tested)
- How many ForgeExtensionContainers rendered on the published page
- PVT folder path where the page was moved
- Any disconnects or errors encountered
- Screenshot

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Browser disconnects when trying to type "/" | Use `browser_type ref=<editor-ref> text="/"` — NEVER `browser_press_key('/')` |
| `browser_type` fails with "ref required" | Take `browser_snapshot` first to get current refs |
| Refs are stale (wrong element clicked) | Always re-snapshot after any DOM change |
| `browser_wait_for text="Sequence"` times out | "Sequence" is in the iframe — use `browser_take_screenshot` + wait instead |
| Publish button stays disabled | Title input is empty — fill it first with `browser_type` |
| Details panel opens instead of editor | Stale ref — re-snapshot and use fresh editor ref |
| CSAT survey blocks title input | Look for Dismiss button ref in snapshot, click it |
| Macro search returns 0 results | App not installed — report and skip |
| Browser disconnects after macro insert | `browser_close` then `browser_navigate` back to edit URL — draft is auto-saved |
| Garbage text (e.g. "/hel") appears in editor | Remove via `browser_evaluate` querying `[contenteditable] p` containing the text |
| `fill('/')` inserts "/" as text without triggering slash menu | Editor already has macro nodes — use `slowly: true` (pressSequentially) instead of fill |
| Slash menu doesn't appear after `slowly: true` | Use toolbar "Insert elements" button (find its ref in snapshot) as fallback |
| Second/third macro not visible on published page | Cursor repositioning (Step 2d) failed — editor was not active when typing "/". Always verify `[contenteditable=true]` before proceeding |
| DrawIO editor needs depth ≥ 10 snapshot | DrawIO is double-nested: outer `hosted-resources-iframe` (f72e*) + inner DrawIO canvas iframe (f74e*). Title is in outer (f72e*), Publish button is in inner (f74e*) |
| OpenAPI title field is "Title" not "Name your diagram…" | OpenAPI modal uses different label — search for `textbox "Title"` in snapshot, not "Name your diagram…" |
| `hosted-resources-iframe` strict mode violation | Multi-install site OR a page banner also rendering one — always scope with `[data-testid="custom-ui-fullscreen-modal-dialog"] [data-testid="hosted-resources-iframe"]`, never the bare selector (hit even on single-variant `lite-stg`, 2026-07-27) |
| iframe not found with `custom-ui-modal-dialog` | Obsolete — all variants now use `custom-ui-fullscreen-modal-dialog` (verified 2026-06-04, Lite + Full + Diagramly) |
| Page title `[placeholder="Give this page a title"]` returns null | Use `textarea[name="editpages-title"]` instead |
| `publish-button` click blocked by blanket overlay | "Publish page" confirmation modal is open — click its Publish button via `page.locator('button', { hasText: 'Publish' }).last()`, not `getByRole` (see next row) |
| `getByRole('button'/'tab', { name })` times out with no "intercepted" trace, element confirmed to exist via plain locator | Role-based name matching is unreliable across this app's buttons/tabs (the paywall's Continue button has a mismatched `aria-label`; other buttons intermittently fail for unclear reasons) — default to `locator('button', { hasText: ... })` everywhere in this skill, not just for the paywall |
| Lite paywall modal appears at macro-editor mount, blocking the tab/title interaction | See **Lite paywall** section above — `lite-stg`/`SD` is intentionally over the 100-macro limit; handle unconditionally, don't treat as an error |
| Paywall "Continue editing" button is gone, replaced by "Request extension" text | Counter (`paywallContinueAttempts:...`) hit 0 — it's cumulative across all past sessions, not per-run. Delete the key from the **Forge iframe origin's** localStorage (see **Lite paywall** section) to reset to 15 |
| "Unsaved changes from N mins ago — these were preserved when the modal closed" banner blocks the tab click | A prior aborted/interrupted script run left an in-progress edit. Click its `Discard` button (see **Lite paywall** section snippet) before proceeding |
| `createFolder('PVT', parentId)` 400s "already exists" even though a parent-scoped search found nothing | The existing `PVT` page isn't a direct child of `parentId` — Confluence titles are unique per-space, not per-parent. Find it space-wide by CQL first (see Step 5's second gotcha) instead of assuming nesting depth |
