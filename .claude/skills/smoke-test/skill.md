---
name: smoke-test
description: >
  [on <site>] [lite|full|diagramly] [macros...]
  Sites: zenuml-stg (default), zenuml, lite-stg, full-stg, dia-stg, diagramly.
  Smoke test ZenUML Confluence Cloud macros (ZenUML, PlantUML, Mermaid, Graph/DrawIO, OpenAPI).
  Uses agent-browser to create a test page, insert macros, publish, and verify rendering.
  Triggers on "smoke test confluence", "test macros on staging", "verify ZenUML on confluence",
  "run smoke test on zenuml-stg", "test lite macros", or any macro validation request.
---

# Confluence Smoke Test — ZenUML Macros

Drive the smoke test with `agent-browser`. Every call carries `--session conf-app --restore=stg`
(see `CLAUDE.md` § "Browser automation and Forge iframes"). Shorthand used throughout this file:

```bash
A(){ agent-browser --session conf-app --restore=stg "$@"; }
```

**Verification status (2026-08-17 migration from Playwright MCP).** Verified by running them:
`frame` into the Forge modal OOPIF and into the nested DrawIO frame, `eval` in both layers,
`console` reaching the macro OOPIF's logs. Translated from the Playwright steps but **not yet
re-run end-to-end under agent-browser**: the slash-menu keystroke path, the Browse-dialog search,
the mark-then-click selections, the DrawIO shape insert, and both Publish steps. The selectors,
waits, and gotchas are unchanged from the Playwright version that did run; the command spellings
are new. Treat a failure in those steps as a possible translation defect and fix this file.

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

**Always scope the iframe selector to the modal wrapper.** A bare
`[data-testid="hosted-resources-iframe"]` matches several elements on multi-install sites
(`zenuml.atlassian.net` has all 3 apps installed) and also matches the page banner's iframe on
single-variant sites:

```bash
A frame "[data-testid=\"custom-ui-fullscreen-modal-dialog\"] [data-testid=\"hosted-resources-iframe\"]"
A eval "location.host"    # must return the cdn.prod.atlassian-dev.net host
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

Full and Diagramly share the exact same display name, so name-only matching picks one
non-deterministically — usually the wrong one. Always disambiguate by **description text**:

| Variant | Text conditions on the option element |
|---------|----------------------------------------|
| Lite | contains `Lite` |
| Full | contains `ZenUML for Confluence`, does NOT contain `Lite` |
| Diagramly | contains `Diagramly for Confluence` |

Same disambiguation applies to **Graph (DrawIO)** and **OpenAPI** macros — on multi-install sites, expect 2–3 entries per macro type; pick by description text. If a variant's macro browser entry isn't observable, the app likely isn't installed on that site.

The wrong variant produces a successful save with the wrong app's bundle, debug bar, and D1 row. The toolbar version label (e.g. `…-full:e34a…` vs `…-diagramly:e34a…`) is the after-the-fact tell.

### The mark-then-click pattern (use this instead of role/name matching)

agent-browser has no locator-filter chain, and role-based name matching is unreliable across this
app (see Troubleshooting). Select the element in JavaScript, tag it with an attribute, then issue a
real click against that attribute. The click is a genuine CDP mouse event, so DrawIO and ProseMirror
handlers fire:

```bash
A eval "(() => {
  const dlg = document.querySelector('[role=dialog][aria-label=\"Browse\"]');
  const opts = [...dlg.querySelectorAll('[role=option], [role=gridcell] button')];
  const m = opts.find(o => o.textContent.includes('Diagram (Mermaid')
                        && o.textContent.includes('ZenUML for Confluence')
                        && !o.textContent.includes('Lite'));
  if (!m) return 'NO MATCH — options: ' + opts.map(o => o.textContent.trim()).join(' | ');
  document.querySelectorAll('[data-ab-pick]').forEach(e => e.removeAttribute('data-ab-pick'));
  m.setAttribute('data-ab-pick', '1');
  return 'marked: ' + m.textContent.trim();
})()"
A click "[data-ab-pick]"
```

On no match the return value enumerates every option, which is the diagnostic you need anyway.

## Lite paywall on over-limit test spaces (e.g. `lite-stg` / `SD`, and `zenuml` / `ZEN`)

**Production `zenuml` / `ZEN` is over the limit too** (measured 2026-09-02 during the
`v2026.09.021021-lite` PVT: banner read "2142 of 100"). Every Lite run on production hits both
the over-limit banner and the macro-editor paywall modal, so handle them exactly as below —
this is not specific to staging.

`lite-stg`'s `SD` space is deliberately kept over the Lite 100-macro limit (thousands of macros) as
shared paywall test data (see the **paywall** skill). Every macro-editor mount there shows the
`UpgradePrompt` modal INSIDE the Forge iframe — handle it unconditionally right after entering the
modal frame, before any tab/title interaction:

```bash
# already inside the Forge modal frame
A eval "(() => {
  const banner = document.querySelector('[data-zenuml-draft-banner]');
  if (banner) {
    const d = [...banner.querySelectorAll('button')].find(b => b.textContent.includes('Discard'));
    if (d) { d.setAttribute('data-ab-pick','1'); return 'draft-banner'; }
  }
  const p = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Continue editing'));
  if (p) { p.setAttribute('data-ab-pick','1'); return 'paywall'; }
  return 'none';
})()"
# if the result is 'draft-banner' or 'paywall':
A click "[data-ab-pick]"; A wait 500
# re-run the eval — a stale draft banner and the paywall can both be present
```

**Do NOT locate the paywall button by accessible name** — it has an `aria-label`
("You have N temporary continue attempt left…") that differs entirely from its visible text
("Continue editing without upgrading (N)"), so name matching never resolves and hangs for the full
timeout with no error. Text matching in `eval` bypasses this (verified 2026-07-27).

**The counter is cumulative, not per test run.** It's `localStorage`-keyed
`paywallContinueAttempts:<domain>:<spaceKey>:<accountId>` inside the **Forge iframe's origin**
(`*.cdn.prod.atlassian-dev.net`), default 3 since 2026-08-16 (was 15), decremented once per click
across *all* smoke-test runs and manual testing against that (domain, space) pair — a single 5-macro
run does not reset it. If it hits 0, the button is replaced by non-clickable "Request extension"
text. Reset it proactively at the start of a run (cheap) rather than discovering exhaustion mid-run.
Run this **inside the Forge iframe frame context**, not the top page:

```bash
A eval "(() => {
  const k = Object.keys(localStorage).find(k => k.startsWith('paywallContinueAttempts:'));
  if (!k) return 'no key';
  localStorage.removeItem(k);
  return 'cleared ' + k;
})()"
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

## Critical browser-automation behaviors (learned from testing)

**Forge iframe content is inlined in the snapshot** — `A snapshot` shows the `Iframe` node with its
subtree, and the `@e*` refs inside it work directly with `click` / `fill`. To scope `eval` into the
frame, `A frame "<selector-or-@ref>"` first; confirm with `A eval "location.host"`, which must
return the `cdn.prod.atlassian-dev.net` host. `A frame main` returns to the top document.

**Nested frames need one `frame` call per layer** — the DrawIO editor sits inside the Forge modal
OOPIF. Take a fresh `snapshot` *inside* layer 1 to read layer 2's ref; `@e` refs are per-snapshot
and per-frame. Requires agent-browser ≥ the 2026-08-17 nested-frame patch.

**Slash menu needs real keystrokes** — `A fill` sets the value directly and ProseMirror (Confluence's
editor) never sees the `input` events, so the menu does not open. Use `A keyboard type "/"`, which
emits genuine keydown/keypress/keyup. This holds for the **first** macro and every subsequent one;
after a macro node exists, ProseMirror treats it as an atom and a value-set can land the caret in
the wrong place and insert "/" as plain text.

(This replaces an older Playwright-MCP-specific workaround where `browser_press_key('/')` crashed the
extension via CDP and `fill()` was the workaround. Neither applies to agent-browser — no extension
relay to crash, and `fill` is the thing to avoid.)

**Always re-snapshot before using refs** — refs become stale after DOM changes (page load, macro
insert, panel open, any `frame` switch). Call `A snapshot` and use the fresh refs.

**Editor textbox ref changes after macro insert** — after a macro is published and the modal closes,
take a fresh snapshot. The textbox shows `[active]` only after you click the editor area. Click
`[data-testid="ak-editor-fp-content-area"]` first, then snapshot, then use the new
`textbox "Page editing area…"` ref.

**`A wait --text "…"` cannot see iframe text** — text inside the Forge CDN iframe is invisible to
top-frame text waits. Use `A frame <iframe>` + `A wait <selector>`, or a fixed `A wait <ms>` plus
`A screenshot`.

**If the browser session breaks** — `A close` then `A open <edit-url>`. Auto-save recovers all
content including partially-inserted macros.

**Batch multi-step sequences** — `A batch --bail "cmd1" "cmd2" …` runs commands in one process and
stops at the first error, which keeps a 10-step insert flow to a single tool call.

## Smoke Test Steps

### Step 0: Navigate, login if needed, discover parent page

`--restore=stg` restores the saved robot1yanhui session, so login is normally not needed.

```bash
A open "https://{domain}/wiki/home"
A screenshot /tmp/step0.png    # check whether the login page appeared instead
```

If the restored state has expired, credentials live in `tests/e2e-tests/.env`
(`ZENUML_STAGE_USERNAME`, `ZENUML_STAGE_PASSWORD`, `ATLASSIAN_OTP`). Fill the fields from a fresh
snapshot, and generate the OTP via shell:

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app/tests/e2e-tests
node -e "const o = require('./utils/otp.js'); console.log(o.generateOtp())"
```

If parentPageId is unknown, read the REST search result as text — no browser rendering needed:

```bash
A open "https://{domain}/wiki/rest/api/content/search?cql=space%3DSD%20AND%20title%20~%20%22Smoke%20Test%22&expand=ancestors&limit=3"
A get text "body"    # read ancestors[last].id from the JSON
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

```bash
A open "https://{domain}/wiki/create-content/page?spaceKey={spaceKey}&parentPageId={parentPageId}"
A wait 3000
```

Set the page title via `eval` — the native setter plus a dispatched `input` event is more reliable
than snapshot+type here. Substitute `{variant}` (`lite` \| `full` \| `diagramly`) and
`{macro label}` (`Sequence`, `Mermaid`, …):

```bash
A eval "(() => {
  // Selector: textarea[name='editpages-title']  (NOT [placeholder='Give this page a title'] — that does not match)
  const t = document.querySelector('textarea[name=\"editpages-title\"]');
  if (!t) return 'not found';
  t.focus();
  const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  s.call(t, 'Smoke Test {variant} ' + stamp + ' ({macro label})');
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return 'set';
})()"
```

If publish fails with duplicate title, re-run with `stamp` including seconds: append
`':' + pad(d.getSeconds())` inside the datetime string. Uniqueness comes from variant +
minute-level timestamp; use seconds only on collision.

#### Open the slash menu, browse, and insert the macro

**For Diagram macros (Sequence / Mermaid / PlantUML):**

```bash
# 1. Activate the editor and open the slash menu — keystrokes, not fill
A batch --bail \
  "click [data-testid=\"ak-editor-fp-content-area\"]" \
  "keyboard type /" \
  "wait --text \"View more\"" \
  "find text \"View more\" click" \
  "wait 2000"

# 2. Search the Browse dialog. The input needs real keystrokes too.
A batch --bail \
  "click [role=dialog][aria-label=\"Browse\"] input" \
  "keyboard type zenuml" \
  "wait 2000"

# 3. Pick the right variant (mark-then-click; see § The mark-then-click pattern)
A eval "(() => {
  const dlg = document.querySelector('[role=dialog][aria-label=\"Browse\"]');
  const opts = [...dlg.querySelectorAll('[role=option], [role=gridcell] button')];
  //   Lite:      t.includes('Lite')
  //   Full:      t.includes('ZenUML for Confluence') && !t.includes('Lite')
  //   Diagramly: t.includes('Diagramly for Confluence')
  const m = opts.find(o => { const t = o.textContent;
    return t.includes('Diagram (Mermaid') && t.includes('ZenUML for Confluence') && !t.includes('Lite'); });
  if (!m) return 'NO MATCH — options: ' + opts.map(o => o.textContent.trim()).join(' | ');
  m.setAttribute('data-ab-pick', '1');
  return 'marked: ' + m.textContent.trim();
})()"
A batch --bail \
  "click [data-ab-pick]" \
  "wait 500" \
  "find testid ModalElementBrowser__insert-button click" \
  "wait 5000"
```

> The Browse dialog **selects** on click but needs the Insert button to confirm. Skipping it leaves
> the dialog open with nothing inserted.

```bash
# 4. Enter the Forge modal frame and clear any draft banner / paywall
A frame "[data-testid=\"custom-ui-fullscreen-modal-dialog\"] [data-testid=\"hosted-resources-iframe\"]"
A eval "location.host"     # must be the cdn.prod.atlassian-dev.net host
# → run the draft-banner / paywall eval from § Lite paywall, then click [data-ab-pick] if it matched

# 5. Pick the tab, name the diagram, publish the macro
A eval "(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Sequence');
  if (!b) return 'no tab';
  b.setAttribute('data-ab-pick-tab', '1');
  return 'ok';
})()"
A batch --bail \
  "click [data-ab-pick-tab]" \
  "fill input[placeholder=\"Untitled diagram\"] \"Test Sequence\"" \
  "wait 500"
A eval "(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Publish'));
  if (!b) return 'no publish';
  b.setAttribute('data-ab-pub', '1');
  return 'ok';
})()"
A click "[data-ab-pub]"

# 6. Publish the Confluence page
A frame main
A batch --bail \
  "wait 2000" \
  "find testid publish-button click" \
  "wait 1500"
A eval "(() => {
  const bs = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Publish');
  const b = bs[bs.length - 1];
  if (!b) return 'no confirm dialog';
  b.setAttribute('data-ab-pub2', '1');
  return 'ok';
})()"
# only if the previous eval returned 'ok':
A click "[data-ab-pub2]"
A wait --url "!*edit-v2*"    # or poll: A get url
```

Change the tab name (`Sequence` → `Mermaid` / `PlantUML`) and the diagram title per macro, and swap
the variant condition in the option-picking eval.

> **Never match these buttons by accessible name.** Role-based name matching is unreliable across
> this app's buttons and tabs (confirmed 2026-07-27: the tab buttons and the page-level
> "Publish page" confirmation button both intermittently fail name matching even though a plain
> text scan resolves them). The mark-then-click pattern is the default here.

**For Graph (DrawIO):**

Same steps 1–4, with search term `graph` and the option condition `t.includes('Graph (DrawIO)')`.
Wait 8000 ms after Insert instead of 5000 — DrawIO is slower to mount. Then:

```bash
# in the outer Forge modal frame
A fill "input[placeholder*=\"Name your graph\"]" "Test Graph"

# enter the inner DrawIO frame — layer 2
A snapshot | grep Iframe          # re-read the ref HERE, inside layer 1
A frame "@<inner-ref>"
A eval "typeof window.mxClient"   # must return "object"
```

> **REQUIRED: draw a shape, else the graph publishes EMPTY.** The default DrawIO canvas has no
> cells, so the macro renders blank and does not exercise the graph renderer.

```bash
A dblclick ".geDiagramContainer"           # opens DrawIO's shape picker
A wait 1500
A find first ".geShapePicker .geItem" click   # real CDP click — required, see note
A wait 1200
A keyboard type "Test Graph"               # label the new shape
A press Escape                             # commit the label
A wait 800
```

> Synthetic dispatched `MouseEvent`s do NOT register with DrawIO's handlers — only a real CDP mouse
> click inserts the shape (verified 2026-06-05 on zenuml prod). `A click` / `A dblclick` /
> `A find … click` all issue real CDP clicks; an `eval`-driven `el.click()` does not.
>
> `A dblclick` targets the element centre. The Playwright version of this step used an explicit
> `(500, 350)` offset. Centre works on an empty canvas; if the canvas already has content there,
> position the cursor first with `A mouse move <x> <y>` and issue `mouse down`/`up` twice.

```bash
# Re-read the title before publishing — the shape-label typing can land in the title field
# instead if focus did not move as expected (see the paywall skill's Graph gotcha).
A frame "[data-testid=\"custom-ui-fullscreen-modal-dialog\"] [data-testid=\"hosted-resources-iframe\"]"
A get value "input[placeholder*=\"Name your graph\"]"
# if it is not 'Test Graph', fill it again

# Publish lives in the INNER DrawIO frame, not the outer modal
A frame "@<inner-ref>"
A eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Publish')); if(!b) return 'no publish'; b.setAttribute('data-ab-pub','1'); return 'ok'; })()"
A click "[data-ab-pub]"
```

Then publish the Confluence page exactly as in step 6 above.

**For OpenAPI:**

Same steps 1–6 as the Diagram macros, with:
- search term `openapi`, option condition `t.includes('OpenAPI')`
- no tab click
- the title field is labelled `Title`, not `Untitled diagram`:
  `A fill "input[placeholder*=\"Title\"]" "Test OpenAPI"` (confirm the exact placeholder from a
  snapshot inside the frame first)

#### Verify and move to PVT

```bash
A screenshot /tmp/{macro}-published.png    # confirm the macro rendered
```

Then run the PVT move (Step 5) and repeat for the next macro.

### Step 3: Publish the page

Covered inline as step 6 of the insert flow. As a standalone sequence:

```bash
A find testid publish-button click
A wait 1500
# confirmation dialog, if present — mark-then-click the LAST 'Publish' button
A eval "(() => {
  const bs = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Publish');
  const b = bs[bs.length - 1];
  if (!b) return 'none';
  b.setAttribute('data-ab-pub2', '1');
  return String(bs.length);
})()"
A click "[data-ab-pub2]"
A wait --text "Edit"    # the Edit button appears on the published page
```

### Step 4: Verify macros rendered

```bash
A screenshot /tmp/published-full.png
A get count "[data-testid=\"ForgeExtensionContainer\"]"
```

Each inserted macro should produce one container. Report the count.

### Step 5: Move page to PVT folder

Extract the page ID from the current URL (`/pages/{pageId}/`), then run the move script.

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

```bash
A open "https://{domain}/wiki/rest/api/content/search?cql=space%3D{spaceKey}%20AND%20title%3D%22PVT%22&expand=ancestors&limit=5"
A get text "body"
```

Read the single result's `id` and use it directly as `pvtId` for the year/month lookups below —
only fall back to `createFolder('PVT', parentId)` if this search genuinely returns zero results.

Run the move from the published page (the fetches need its origin and cookies):

```bash
A eval "(async () => {
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
})()"
```

`A eval` awaits promises, so the async IIFE returns its resolved value directly.

### Step 6: Report results

Summarize:
- Which macros were inserted successfully (and which tab was tested)
- How many ForgeExtensionContainers rendered on the published page
- PVT folder path where the page was moved
- Any errors encountered (include `A console` output — it covers the macro OOPIF's own logs)
- Screenshot

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Slash menu does not open | `A fill` bypasses ProseMirror's `input` events — use `A keyboard type "/"` |
| "/" appears as plain text in the editor | Caret is not in a text position; click `[data-testid="ak-editor-fp-content-area"]` first, then re-snapshot |
| Refs are stale (wrong element clicked) | Re-snapshot after any DOM change, any navigation, and any `frame` switch |
| `A wait --text "Sequence"` times out | "Sequence" is inside the Forge iframe — enter the frame first, or use `A wait <ms>` + `A screenshot` |
| Publish button stays disabled | Title input is empty — set it first |
| Diagram title fill matches nothing / hangs | The Sequence/Mermaid/PlantUML title placeholder was renamed `Name your diagram…` → `Untitled diagram` (`DiagramTitleInput.vue`, shipped v2026.08.222120). Use `input[placeholder="Untitled diagram"]`. Graph (`Name your graph…`, `DrawIoHeader.vue`) and OpenAPI (`Title`, `OpenApiTitleInput.tsx`) are unchanged |
| Details panel opens instead of editor | Stale ref — re-snapshot and use a fresh editor ref |
| CSAT survey blocks title input | Find the Dismiss button in the snapshot and click it |
| Macro search returns 0 results | App not installed — report and skip |
| Garbage text (e.g. "/hel") appears in editor | Remove via `A eval` querying `[contenteditable] p` containing the text |
| A button confirmed present by `eval` but `find role … --name` times out | Role/name matching is unreliable across this app (the paywall's Continue button has a mismatched `aria-label`; other buttons fail intermittently for reasons not yet determined) — use the mark-then-click pattern |
| `frame` reports `✓ Done` but `eval` still runs in the top document | agent-browser older than the 2026-08-17 nested-frame patch — check with `A eval "location.host"` and upgrade |
| DrawIO shape picker opens but no shape is inserted | An `eval`-driven `el.click()` does not register with DrawIO — use `A find first ".geShapePicker .geItem" click` (real CDP click) |
| `hosted-resources-iframe` matches several elements | Multi-install site, or the page banner also renders one — always scope with `[data-testid="custom-ui-fullscreen-modal-dialog"] [data-testid="hosted-resources-iframe"]` (hit even on single-variant `lite-stg`, 2026-07-27) |
| iframe not found with `custom-ui-modal-dialog` | Obsolete — all variants now use `custom-ui-fullscreen-modal-dialog` (verified 2026-06-04, Lite + Full + Diagramly) |
| Page title `[placeholder="Give this page a title"]` returns null | Use `textarea[name="editpages-title"]` instead |
| `publish-button` click blocked by a blanket overlay | The "Publish page" confirmation modal is open — mark-then-click its own Publish button (the LAST one in the DOM) |
| Lite paywall modal appears at macro-editor mount, blocking tab/title interaction | See **Lite paywall** section — `lite-stg`/`SD` is intentionally over the 100-macro limit; handle unconditionally, don't treat as an error |
| Paywall "Continue editing" button gone, replaced by "Request extension" text | Counter (`paywallContinueAttempts:…`) hit 0 — cumulative across all past sessions, not per-run. Delete the key from the **Forge iframe origin's** localStorage (see **Lite paywall** section) |
| "Unsaved changes from N mins ago" banner blocks the tab click | A prior aborted run left an in-progress edit. Click its `Discard` button (see **Lite paywall** section) |
| `createFolder('PVT', parentId)` 400s "already exists" even though a parent-scoped search found nothing | The existing `PVT` page isn't a direct child of `parentId` — Confluence titles are unique per-space, not per-parent. Find it space-wide by CQL first (see Step 5's second gotcha) |
