# Job B Editor Staleness Hint — Spike Findings (Q1/Q2/Q3)

Status: **DONE**. All three spike gates answered with runtime evidence from `lite-stg.atlassian.net`
(space `SD`), captured 2026-07-18 via an ephemeral Playwright spec. Spec kept at
`tests/e2e-tests/tests/spike/job-b-staleness.spec.ts` (untracked scratch area, not committed). No
pages were deleted; two fresh pages were created and left in place (see "Fixture pages" below).

## Method / infra notes (read this before the per-question sections)

- Ran via an ephemeral config `tests/e2e-tests/playwright.spike.config.ts` (also untracked) because
  none of the projects in the checked-in `playwright.config.ts` have a `testMatch` covering
  `tests/spike/**` — files there are otherwise invisible to the test runner. The ephemeral config
  mirrors the real config's `auth` project + adds a `spike` project matching `spike/*.spec.ts`.
- Command: `APP=zenuml-lite@stg npx playwright test --config=playwright.spike.config.ts --project=spike --workers=1 tests/spike/job-b-staleness.spec.ts`
- Auth: reused the cached `auth-state-lite-stg.atlassian.net.json` storage state; the `auth` setup
  project validated it was still live (no fresh TOTP login needed this run).
- **A methodology bug was caught and fixed mid-spike, documented here for transparency**: the first
  two runs used `locator.isVisible({ timeout })` to wait for the inline macro iframe in the editor
  canvas. `isVisible()` does **not** retry/poll despite accepting a `timeout` option — it checks
  current DOM state once and returns immediately. This produced a **false-negative "critical
  finding"** (screenshots `q1-edit-inline-MISSING.png` / `q1b-edit-inline-MISSING.png`: empty editor
  canvas, no macro visible) that looked exactly like the "macro doesn't render inline in the editor"
  scenario the design spec warned to watch for. Verified via a standalone script using
  `locator.waitFor({ state: 'visible', timeout })` (which does poll) that the macro **does** render
  inline — the frame just takes a few seconds to mount and the earlier check never actually waited.
  Fixed all six `isVisible({timeout})` call sites in the spec to
  `waitFor({state:'visible',timeout}).then(()=>true).catch(()=>false)` and re-ran; all 7 tests then
  passed cleanly with the macro visible on both fixture pages, all three surfaces. Kept the
  `-MISSING.png` screenshots as evidence of the bug, not of a product defect.

### Fixture pages created (left in place, never deleted)

| Page | pageId | How created | Purpose |
|---|---|---|---|
| `spike-staleness-1784366311830` | `158335381` | REST API (`PageCreator`-style: draft → custom-content → ADF with a legacy `com.atlassian.confluence.macro.core` extension node) | Primary Q1/Q3 fixture |
| `spike-staleness-ui-1784366381547` | `158138825` | Real Confluence editor UI (slash-menu insert → publish), then REST-renamed to the required title prefix | Q1b/Q2 fixture — used to cross-validate Q1's finding against a page whose ADF was authored the way real users' diagrams are (modern `com.atlassian.ecosystem` extension shape) |
| `Before release test pages` | `524297` | Pre-existing hub page (`parentPageId` for this app profile) | Q3 "does a page with real history exist" probe (found: only 2 versions) |

Both spike-created pages carry a real sequence macro and render correctly in view mode. The
REST-created page's ADF uses the **legacy** extension shape (`extensionType:
"com.atlassian.confluence.macro.core"`, `extensionKey: "zenuml-sequence-macro-lite"` — same shape
`utils/page-creator.ts`'s `PageCreator` uses); the UI-inserted page's ADF uses the **modern** Forge
shape (`extensionType: "com.atlassian.ecosystem"`, `extensionKey` a fully-qualified
`{appId}/{environmentId}/static/{moduleKey}` ARI-style string, plus `embeddedMacroContext`, real
`localId` UUIDs, etc.). **Both render inline in the editor fine** once the false-negative bug above
is accounted for — so the ADF-shape difference is not load-bearing for Q1, but it's a genuine,
previously-undocumented fact about how Confluence represents Forge macros in stored content
depending on insertion path, worth knowing if anyone else builds REST fixtures for editor tests.

---

## Q1 — inline editor-render context signature

**Verdict: `context.extension.isEditing` (boolean) + presence/absence of `context.extension.modal`
uniquely identifies all three surfaces. `isInlineEditorRender = extension.type === 'macro' &&
extension.isEditing === true && extension.modal === undefined`.**

### Method actually used

The task's primary method (intercept `page.on('request')`, find the `Authorization: Bearer <jwt>`
header on a request to our backend, decode the JWT payload) **did not yield any evidence** — see
"JWT network-interception: negative result" below. The **console-log capture** method (secondary,
but the one that actually worked) was: `src/model/globals/forgeGlobal.ts`'s `getView()` does
`console.log('forgeGlobal - context', global.forgeContext)` on every fresh app mount (once per
iframe boot — `global.view` is a per-realm cache, so every new iframe logs it fresh). Attached a
`page.on('console')` listener filtering `msg.text().startsWith('forgeGlobal - context')`, pulled the
second console arg via `JSHandle.jsonValue()`, and tagged each capture with the current navigation
phase (`view` / `edit-inline` / `edit-modal`). This gives the **exact, complete, real
`ap.context` object** the Forge bridge hands the app — strictly better evidence than reverse-engineering
`context.extension` out of a JWT payload would have been, since it's the literal object our own code
branches on.

Sequence per fixture page: navigate to the **view** URL → confirm macro iframe visible → navigate to
`.../pages/edit-v2/{id}` (**inline editor**) → confirm macro visible inline in the canvas → click the
macro's own in-iframe "Edit" button (`MacroPage.editMacro()`, established pattern already used by
`tests/fullscreen/draft-only-binding-samepage.spec.ts`) → confirm the **edit modal**
(`custom-ui-fullscreen-modal-dialog`) opens → capture context there too. Repeated on both fixture
pages (8 total context captures, 100% consistent shape across both).

### JWT network-interception: negative result (report this honestly, it matters for future spikes)

Confirmed via code read (`src/utils/requestUtil.ts`'s `callRemote`/`forgeCallRemote`, called by
`macroMetrics.getMacroMetrics()` and `useCustomerSuccessService().initialize()`, both of which
`src/forgeIndex.ts` fires **unconditionally on every macro mount**, viewer or editor) that
`invokeRemote()` calls to our backend (`conf-stg-lite.zenuml.com`, per
`context.extension`'s embedded `permissions.external.fetch.backend` list) happen on all three
surfaces. Despite that, **zero** requests to that host (or any `*.pages.dev` host) were observed by
`page.on('request')` across 26 captured Authorization-bearing requests on two independent pages —
**100% of captured requests were to `api.atlassian.com`** (Atlassian's own REST gateway, via
`requestConfluence`/`forgeRequest`, e.g. custom-content search pagination calls — unrelated to our
backend). Inference (not confirmed via `@forge/bridge` source): `invokeRemote()`'s actual HTTP call
appears to be proxied through a channel that isn't a page-visible `fetch`/`XHR` (possibly
server-side/edge-mediated by Atlassian's Forge invocation gateway), so Playwright's `page.on('request')`
structurally cannot see it, no matter how long you wait. **Implication for future spikes: don't rely
on network interception to observe `invokeRemote` traffic in this app; use the console-log capture
method (or add a temporary diagnostic `console.log` at the `callRemote` call site) instead.**

### The three context.extension shapes, side by side (redacted — no raw JWTs were ever captured;
these are decoded/captured JS objects only, with `permissions.scopes`/`permissions.external`
omitted below since they're identical across all three and already documented in `manifest.yml`)

| Field | **view** (published page) | **edit-inline** (page editor canvas) | **edit-modal** (fullscreen bridge modal) |
|---|---|---|---|
| `extension.type` | `"macro"` | `"macro"` | `"macro"` |
| `extension.isEditing` | **`false`** | **`true`** | **`true`** |
| `extension.modal` | *(absent)* | *(absent)* | **present**: `{macroMode:"editor", customContentId, journey_id, journey_start_time, macro_uuid, session_id}` |
| `extension.location` | page view URL (`/wiki/spaces/SD/pages/{id}/{slug}`) | `/wiki/spaces/SD/pages/edit-v2/{id}` | same edit-v2 URL (opened from inline) |
| `extension.config._parentId` | present | *(absent)* | *(absent)* |
| top-level `localId` | long ARI: `ari:cloud:ecosystem::extension/{appId}/{envId}/static/{moduleKey}` | short instance id (e.g. `ae94940fd0d2`) | same short instance id (matches `extension.modal.macro_uuid`) |
| `extension.content.id` / `.type` / `.version` | page id / `"page"` / version | same | same |
| `extension.config.customContentId` | present (diagram's custom content id) | present | present |

Full captured JSON (unredacted structure, all fields) is in the spec's test-info attachments from the
run (`q1-captured-contexts.json`, `q1b-captured-contexts.json` — not persisted anywhere outside the
Playwright run's `test-results/` dir, which is git-ignored and not part of this deliverable).
Screenshots: `tests/e2e-tests/tests/spike/artifacts/q1-view-mode.png`,
`q1-edit-inline.png`, `q1-edit-modal.png` (and the `q1b-*` / `-MISSING.png` counterparts described
above).

### Conclusion / implementation guidance

```ts
function isInlineEditorRender(context: any): boolean {
  const ext = context?.extension;
  return ext?.type === 'macro' && ext?.isEditing === true && !ext?.modal;
}
```

This is a **new** predicate, distinct from the existing `isEditorish` in `src/forgeIndex.ts:283`
(`context.extension.modal?.macroMode === 'editor' || !!context.extension?.macro?.isConfiguring`).
Two things worth flagging about the existing check:

1. It correctly covers the **edit-modal** surface (via `modal?.macroMode === 'editor'`), but has no
   branch for **edit-inline** at all — confirming the design spec's premise that the inline case
   needs its own signature.
2. `context.extension?.macro?.isConfiguring` — **no captured context sample, on any of the 3
   surfaces, on either fixture page, had a top-level `extension.macro` key at all.** This branch
   appears to target a *different* context shape entirely (most likely the one-time
   insert/configure-macro flow when a macro is first placed via the slash menu, before it's ever
   rendered as a placed extension) — not the render-time "macro already on the page" context this
   spike exercised. Don't assume it fires for the inline-render surface; it evidently doesn't, per
   this evidence.

`extension.isEditing` is the right signal for "is this render happening on an editable surface at
all" (true for both inline-editor and edit-modal, false for view); `!extension.modal` then narrows
that down to specifically the inline canvas. No JWT decoding needed in the shipped implementation —
call `view.getContext()` (already what `forgeGlobal.ts`'s `getContext()` wraps) and read
`context.extension.isEditing` / `context.extension.modal` directly.

---

## Q2 — click interception in the editor canvas

**Verdict: clicks reach the iframe directly, on the FIRST click. No selection-then-interact
two-step gate exists in this Confluence editor version. The planned real `<button>` CTA (「更新图表」)
inside the strip does not need the display-only "click ✏️" fallback.**

### Method actually used

On the UI-inserted fixture page (`158138825`, chosen so Q2 measures the same kind of
ADF-authored-by-real-usage macro a genuine user would have), inline in `edit-v2`: injected a
`position:fixed; top:0; left:0` `<button>` into the macro iframe's `<body>` via
`frameLocator.locator('body').evaluate(...)`, with a click listener incrementing
`window.__spikeClicked`. Computed the button's **top-page** coordinates by hand — iframe element's
`boundingBox()` in the top page (`page.locator(FORGE_MACRO_FRAME).boundingBox()`) plus the button's
own in-frame offset (`frame.locator('#__spike_btn').evaluate(el => el.getBoundingClientRect())`,
which is `(0,0)` since it's `position:fixed` inside the iframe) — then dispatched real pointer clicks
via `page.mouse.click(x, y)` at those top-page coordinates (goes through the top document's actual
hit-testing, unlike `frameLocator().click()` which was deliberately **not** used for the verdict, per
the task's warning that it bypasses any overlay and would invalidate the experiment). Clicked twice
at the same coordinates, reading `window.__spikeClicked` (via `frame.evaluate`) and a best-effort
top-page "selected node" class probe after each click, with before/after screenshots.

### Evidence

```
iframeBox   = { x: 408, y: 353, width: 784, height: 595 }
btnBoxInFrame = { x: 0, y: 0, width: 160, height: 48 }
target      = (488, 377)  // top-page coordinates clicked

              before   afterClick1   afterClick2
__spikeClicked:   0         1             2
```

Both clicks landed on the injected button and incremented the counter — **the very first click**
already reached the iframe's interior, confirmed in both this Q2 run (against the UI-inserted page)
and an earlier run against the REST-created page with the buggy-but-still-valid-for-Q2 check (same
result: `afterClick1: 1`, `afterClick2: 2`). The best-effort "selected node" probe
(`.ProseMirror-selectednode` / `[aria-selected="true"]` / `.selected` / `[data-selected="true"]`)
found **zero** matches before or after either click — screenshots
(`q2-before-click1.png` vs `q2-after-click1.png`) show the extension's label/toolbar chrome
("Diagram (Mermaid, PlantUML & ZenUML) Lite (Staging)" bar + border) is **already present before any
click** — it's Confluence's always-on chrome around any placed Forge extension in the editor, not a
selection-state decoration. So there is no visible "select the block" intermediate state at all in
this editor version; the click behaves like a normal click into embedded interactive content from
the first press.

### Conclusion / implementation guidance

No fallback needed. Build the CTA as a real, directly-clickable button inside the staleness strip.
Do not gate it behind a "select the macro first" affordance — there is none to route around.

---

## Q3 — page versions API

**Verdict: comfortably feasible within the ≤1s budget. Observed latency 79–613ms across all runs
(typical ~130–270ms in a warm browser context), for both a 2-version page and (after deliberately
extending a fixture to 55 versions to exercise pagination — see below) a 50-result page. Response is
sorted newest-first by default; pagination is opaque-cursor-based via `_links.next`, not an offset or
timestamp param.**

### Method actually used

`page.evaluate(() => fetch('/wiki/api/v2/pages/{id}/versions?limit=50', {credentials:'same-origin'}))`
from a page already on the Confluence origin (session cookies apply automatically — no bridge/JWT
needed, exactly as the task specified), timed via `performance.now()` inside the evaluate (excludes
Playwright dispatch overhead). Ran once each against three candidates (the fresh spike fixture, the
`parentPageId` hub page, and — best-effort, gracefully skipped when it 404'd as a foreign-domain id —
the cached `test-pages.json` sequence page), then 3x against the richest.

**No naturally-occurring high-version-count page was found** among readily accessible candidates on
`lite-stg`/`SD` — every page checked (14 recent "Smoke Test" E2E pages via CQL, the cached
`test-pages.json` ids, the `parentPageId` hub page) had 1–2 versions. Rather than report latency for
a 1-2-version page (which wouldn't exercise pagination or a realistic result-set size at all), I
**deliberately extended the REST-created spike fixture to 55 versions** via 54 sequential
content-preserving REST `PUT`s (own throwaway page, not a shared one — no deletion, no edits to
existing shared pages) specifically to cross the `limit=50` boundary and observe real pagination
behavior. This is the only place this spike modified content beyond initial creation.

### Evidence

Response shape: `{ results: [...], _links: { next?, base } }`. No `total`/`count` field.

```
GET /wiki/api/v2/pages/{id}/versions              → 25 results (default limit)
GET /wiki/api/v2/pages/{id}/versions?limit=50      → 50 results, _links.next = "/wiki/api/v2/pages/{id}/versions?limit=50&cursor=<opaque-token>"
GET <that next URL>                                → remaining 5 results (55 total), no _links.next
```

- **Sort order: newest-first** (descending by `createdAt`/version number) — confirmed both via the
  `isDescendingByCreatedAt: true` / `isAscendingByCreatedAt: false` check in the spec and by eyeball
  (`number: 55` first, `number: 1`/`5` last across pages).
- **Cursor field**: `_links.next` is a full relative path with an opaque `cursor=` query param —
  there is no separate top-level `cursor` field to read; you just follow the URL. No `cursor` request
  param format is publicly documented; treat it as opaque and always follow `_links.next` rather than
  constructing it.
- **Each `results[]` entry**: `{ number, message, minorEdit, authorId, createdAt, page: { id, title,
  body } }` — `createdAt` is the field to compare against the diagram's last-modified.
- **Latency** (browser `fetch`, `credentials:'same-origin'`, warm session):
  | Run | Target | `ms` (3 samples) |
  |---|---|---|
  | Spec run (2-version hub page) | `524297` | 267, 165, 79 |
  | Ad hoc probe (55-version fixture, `limit=50`) | `158400815` | 172, 163, 129 |

  All comfortably under the 1s budget, including the worst-case first-load sample (267ms) and the
  case that actually returns a full 50-row page.

### Counting recipe

Because the endpoint is sorted **newest-first**, counting "versions newer than X" does **not**
require walking the full page: fetch page 1, iterate `results[]` from the front, and **stop as soon
as you hit the first entry with `createdAt <= diagramLastModified`** (everything after it is older).
Only follow `_links.next` if you reach the end of a page without hitting that boundary (i.e. drift
is large — ≥50 — which is already far past this feature's `drift ≥ 5` trigger threshold, so in
practice this will almost always resolve on page 1 with a handful of comparisons, no pagination
follow-up needed).

```ts
async function countVersionsSince(pageId: string, sinceIso: string): Promise<number> {
  let url = `/wiki/api/v2/pages/${pageId}/versions?limit=50`;
  let count = 0;
  while (url) {
    const res = await requestConfluence(url); // or fetch, same-origin
    const data = await res.json();
    for (const v of data.results) {
      if (v.createdAt <= sinceIso) return count; // sorted newest-first: done
      count++;
    }
    url = data._links?.next ?? null;
  }
  return count; // exhausted all versions, all newer than `since`
}
```

### Conclusion / implementation guidance

Feasible well within budget. Cache per `(pageId, pageVersion)` in localStorage as the design already
specifies (so this call runs at most once per page version, not once per render) — even without that
cache, a single call is cheap enough not to threaten first paint if fired after render, per the
"never blocks first paint" requirement.

---

## Summary for the implementation plan

1. **Surface detection** (`isInlineEditorRender`): use `context.extension.type === 'macro' &&
   context.extension.isEditing === true && !context.extension.modal`. Don't reuse
   `context.extension?.macro?.isConfiguring` for this — it doesn't fire on the render-time inline
   surface in any observed sample.
2. **CTA**: build a real clickable button in the strip. No click-interception workaround needed —
   Q2 found no overlay swallowing clicks, first or otherwise.
3. **Drift computation**: `GET /wiki/api/v2/pages/{id}/versions?limit=50`, walk `results[]`
   front-to-back (newest-first), stop at the first `createdAt <= diagramLastModified`, follow
   `_links.next` only if a full page is exhausted without hitting that boundary. Well under the 1s
   budget even cold.
