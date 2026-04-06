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

**Always re-snapshot before using refs** — refs become stale after DOM changes (page load,
macro insert, panel open). Call `browser_snapshot` and use the fresh refs.

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

### Step 1: Create a new child page

```
browser_navigate url="https://{domain}/wiki/create-content/page?spaceKey={spaceKey}&parentPageId={parentPageId}"
```

Wait for the editor to load (screenshot to confirm title input visible), then fill the title:
```
browser_snapshot   ← get ref for "Give this page a title" textbox
browser_type ref=<title-ref> element="Give this page a title" text="Smoke Test {timestamp} {random}"
```

### Step 2: Insert macros

Repeat this pattern for each macro. **Take a fresh snapshot before every click.**

#### 2a. Open the slash menu

```
browser_snapshot   ← get ref for "Page editing area" textbox (e.g. e1193)
browser_type ref=<editor-ref> element="Page editing area" text="/"
browser_wait_for text="View more" timeout=5000
```

#### 2b. Open Browse dialog and search

```
browser_evaluate function="() => {
  const btn = Array.from(document.querySelectorAll('button'))
    .find(b => /View more|View all elements/.test(b.textContent || ''));
  btn?.click();
  return btn?.textContent;
}"
```

Wait 2s, then search for the macro:
```
browser_evaluate function="() => {
  const dialog = Array.from(document.querySelectorAll('[role=dialog]'))
    .find(d => d.getAttribute('aria-label') === 'Browse');
  const input = dialog?.querySelector('input');
  if (!input) return 'no input';
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, 'zenuml');   // ← use 'graph' or 'openapi' for other macros
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'searched';
}"
```

Wait 2s, then click the matching option:
```
browser_evaluate function="() => {
  const dialog = Array.from(document.querySelectorAll('[role=dialog]'))
    .find(d => d.getAttribute('aria-label') === 'Browse');
  const options = dialog?.querySelectorAll('[role=option], [role=gridcell] button');
  // Full/Diagramly: match without 'Lite'; Lite: match with ' Lite'
  const match = Array.from(options || [])
    .find(o => o.textContent?.includes('Diagram (Mermaid') && !o.textContent?.includes('Lite'));
  match?.click();
  return match?.textContent?.trim().slice(0, 60);
}"
```

#### 2c. Interact with the Forge modal

Wait 5s for the modal to load, then snapshot to get iframe refs:
```
browser_take_screenshot   ← confirm modal is open
browser_snapshot          ← get f9e* refs for tabs, title input, Publish button
```

The iframe elements appear in the snapshot under `dialog [active]` → `iframe` → `generic`.
Key refs to look for:
- `tab "Sequence"` → click to switch tab
- `tab "PlantUML"` → click to switch tab  
- `textbox "Name your diagram…"` → title input (required before Publish enables)
- `button "Publish" [disabled]` → becomes enabled after title is filled

```
browser_click ref=<sequence-tab-ref> element="Sequence"    ← for Sequence macro
browser_click ref=<title-input-ref> element="Name your diagram…"
browser_type ref=<title-input-ref> element="Name your diagram…" text="Test Sequence"
browser_click ref=<publish-ref> element="Publish"
```

For PlantUML — same flow but click PlantUML tab first:
```
browser_click ref=<plantuml-tab-ref> element="PlantUML"
browser_type ref=<title-ref> element="Name your diagram…" text="Test PlantUML"
browser_click ref=<publish-ref> element="Publish"
```

For Mermaid — but click Mermaid tab first:
```
browser_type ref=<title-ref> element="Name your diagram…" text="Test Mermaid"
browser_click ref=<publish-ref> element="Publish"
```

For Graph (DrawIO) — search term `graph`, wait 8s for editor, title label is "Name your graph…":
```
browser_snapshot          ← iframe has nested structure: app frame → DrawIO iframe
browser_type ref=<graph-title-ref> element="Name your graph…" text="Test Graph"
```
The Publish button is in the inner DrawIO iframe — snapshot will show it as a nested ref.

For OpenAPI — search term `openapi`, wait 5s, title label is "Title":
```
browser_type ref=<title-ref> element="Title" text="Test OpenAPI"
browser_click ref=<publish-ref> element="Publish"
```

#### 2d. Reposition cursor between macros

After each macro publishes, click the page title to escape the modal frame:
```
browser_snapshot   ← get ref for "Give this page a title"
browser_click ref=<page-title-ref> element="Give this page a title"
```

Then use evaluate to focus the editor and move cursor to end:
```
browser_evaluate function="() => {
  const editor = document.querySelector('[contenteditable=true][role=textbox]');
  if (!editor) return 'not found';
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return 'cursor at end';
}"
browser_press_key key="Enter"
```

Then take a fresh snapshot and repeat from step 2a for the next macro.

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
