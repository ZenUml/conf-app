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

All three variants use the **Forge modal** pattern:
- Dialog: `[data-testid="custom-ui-modal-dialog"]`
- App iframe: `[data-testid="hosted-resources-iframe"]`

Lite appends " Lite" to macro names. Diagramly and Full do not.
Staging apps append " (Staging)" — this is fine, matching handles it automatically.

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

| # | Macro | Search term | Tab / action | Page title suffix |
|---|-------|-------------|--------------|-------------------|
| 1 | Diagram Lite — Sequence (ZenUML) | `zenuml` | Click "Sequence" tab | `(Sequence)` |
| 2 | Diagram Lite — Mermaid | `zenuml` | Click "Mermaid" tab | `(Mermaid)` |
| 3 | Diagram Lite — PlantUML | `zenuml` | Click "PlantUML" tab | `(PlantUML)` |
| 4 | Graph (DrawIO) Lite | `graph` | Wait 8s, title = "Name your graph…" | `(Graph)` |
| 5 | OpenAPI Lite | `openapi` | Wait 5s, title = "Title" | `(OpenAPI)` |

For Full/Diagramly variants, macro names do not include "Lite" — adjust the search match accordingly.

**For each macro, repeat this flow:**

#### Create a page

```
browser_navigate url="https://{domain}/wiki/create-content/page?spaceKey={spaceKey}&parentPageId={parentPageId}"
```

Wait 3s, then set the page title via evaluate (more reliable than snapshot+type):
```
browser_evaluate function="() => {
  const t = document.querySelector('[placeholder=\"Give this page a title\"]');
  if (!t) return 'not found';
  t.focus();
  const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  s.call(t, 'Smoke Test {timestamp} ({macro name})');
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return 'set';
}"
```

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

  // Click matching option — Lite: include 'Lite'; Full/Diagramly: exclude 'Lite'
  const options = dialog.locator('[role=option], [role=gridcell] button');
  const match = options.filter({ hasText: 'Diagram (Mermaid' }).filter({ hasNotText: 'Lite' }).first();
  await match.click();
  await page.waitForTimeout(500);
  // REQUIRED: Browse dialog selects on click but needs Insert button to confirm
  await page.getByTestId('ModalElementBrowser__insert-button').click();

  // Wait for Forge modal and interact with iframe
  await page.waitForTimeout(5000);
  const frame = page.locator('[data-testid=\"hosted-resources-iframe\"]').contentFrame();
  await frame.getByRole('tab', { name: 'Sequence' }).click();  // change tab name as needed
  await frame.getByRole('textbox', { name: 'Name your diagram…' }).fill('Test Sequence');
  await frame.getByRole('button', { name: 'Publish' }).click();

  // Publish the Confluence page
  await page.waitForTimeout(2000);
  await page.getByTestId('publish-button').click();
  await page.waitForTimeout(500);
  try {
    await page.getByRole('button', { name: 'Publish' }).last().click({ timeout: 2000 });
  } catch {}
  await page.waitForURL(u => !u.includes('edit-v2'), { timeout: 30000 });
  return page.url();
}"
```

Change `tab: 'Sequence'` → `'Mermaid'` or `'PlantUML'` and title accordingly per macro.
For **Lite** variant, change the `filter({ hasNotText: 'Lite' })` to `filter({ hasText: 'Lite' })`.

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

  // Lite: include 'Lite'; Full/Diagramly: exclude 'Lite'
  const match = dialog.locator('[role=option], [role=gridcell] button')
    .filter({ hasText: 'Graph (DrawIO)' }).filter({ hasNotText: 'Lite' }).first();
  await match.click();
  await page.waitForTimeout(500);
  await page.getByTestId('ModalElementBrowser__insert-button').click();

  // DrawIO: double-nested iframe — title in outer, Publish in inner
  await page.waitForTimeout(8000);
  const outerFrame = page.locator('[data-testid=\"hosted-resources-iframe\"]').contentFrame();
  await outerFrame.getByRole('textbox', { name: 'Name your graph…' }).fill('Test Graph');
  const innerFrame = outerFrame.locator('iframe').contentFrame();
  await innerFrame.getByRole('button', { name: 'Publish' }).click();

  await page.waitForTimeout(2000);
  await page.getByTestId('publish-button').click();
  try { await page.getByRole('button', { name: 'Publish' }).last().click({ timeout: 2000 }); } catch {}
  await page.waitForURL(u => !u.includes('edit-v2'), { timeout: 30000 });
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

  const match = dialog.locator('[role=option], [role=gridcell] button')
    .filter({ hasText: 'OpenAPI' }).filter({ hasNotText: 'Lite' }).first();
  await match.click();
  await page.waitForTimeout(500);
  await page.getByTestId('ModalElementBrowser__insert-button').click();

  await page.waitForTimeout(5000);
  const frame = page.locator('[data-testid=\"hosted-resources-iframe\"]').contentFrame();
  await frame.getByRole('textbox', { name: 'Title' }).fill('Test OpenAPI');
  await frame.getByRole('button', { name: 'Publish' }).click();

  await page.waitForTimeout(2000);
  await page.getByTestId('publish-button').click();
  try { await page.getByRole('button', { name: 'Publish' }).last().click({ timeout: 2000 }); } catch {}
  await page.waitForURL(u => !u.includes('edit-v2'), { timeout: 30000 });
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

```
browser_evaluate function="async () => {
  const pageId = location.pathname.match(/\/pages\/(\d+)\//)?.[1];
  const parentId = '{parentPageId}';

  async function findChild(pid, title) {
    const r = await fetch('/wiki/rest/api/content/' + pid + '/child/page?title=' + encodeURIComponent(title) + '&limit=25', {headers: {'Accept': 'application/json'}});
    return (await r.json()).results?.find(p => p.title === title);
  }

  async function createFolder(spaceId, pid, title) {
    const r = await fetch('/wiki/api/v2/pages', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({spaceId, status: 'current', title, parentId: pid, body: {representation: 'storage', value: ''}})});
    return (await r.json()).id;
  }

  async function movePage(pid, newParentId) {
    const r = await fetch('/wiki/rest/api/content/' + pid + '?expand=version,body.storage', {headers: {'Accept': 'application/json'}});
    const p = await r.json();
    await fetch('/wiki/rest/api/content/' + pid, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'page', title: p.title, ancestors: [{id: parseInt(newParentId)}], version: {number: p.version.number + 1}, body: {storage: {value: p.body.storage.value, representation: 'storage'}}})});
  }

  const pageRes = await fetch('/wiki/rest/api/content/' + pageId + '?expand=space', {headers: {'Accept': 'application/json'}});
  const spaceId = (await pageRes.json()).space?.id;
  const year = new Date().getFullYear().toString();
  const month = year + '-' + String(new Date().getMonth() + 1).padStart(2, '0');

  let pvt = await findChild(parentId, 'PVT');
  if (!pvt) pvt = {id: await createFolder(spaceId, parentId, 'PVT')};
  let yr = await findChild(pvt.id, year);
  if (!yr) yr = {id: await createFolder(spaceId, pvt.id, year)};
  let mo = await findChild(yr.id, month);
  if (!mo) mo = {id: await createFolder(spaceId, yr.id, month)};
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
