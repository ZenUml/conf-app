# Graph / OpenAPI product parity, then competitor-macro migration

**Date:** 2026-08-19
**Status:** research, no implementation
**Order:** enhance Graph and OpenAPI first. Build conversion after the product gaps that would make a converted diagram feel incomplete are closed.

This note is the evidence base for replacing two Marketplace apps on a Confluence site:

1. **draw.io Diagrams** (Seibert / drawio Ltd, Marketplace app 1210933)
2. **Open API (Swagger) Integration** (Toshihiro Sato, Marketplace app 1219386, Connect key `com.confluence.swagger.api.document`)

It does not name customer tenants. Conversion of a live tenant is a later step.

---

## What we already have (verified)

### Graph

| Fact | Evidence |
|---|---|
| Editor is the bundled DrawIO embed (`embed=1`, `proto=json`, `libraries=1`, `offline=1`) | `src/components/DrawIoExtension/ForgeGraphEditor.vue` iframe URL, **read the code** |
| Storage is custom content `graphXml`, currently `<mxfile>` with `<diagram>` pages; legacy records are raw `<mxGraphModel>` | `docs/reference/graph-multipage-test-fixtures.md`, `ForgeGraphEditor.vue` `EMPTY_GRAPH`, **read the code** |
| Viewer is DrawIO `GraphViewer` with auto-fit, our hover pill, multi-page nav, Edit, Fullscreen, Export PNG, Versions | `ForgeGraphViewer.vue`, `GenericViewer.vue`, **read the code** |
| Sketch *style* on shapes is mxGraph cell style in the XML. The viewer does not need the Board editor theme to paint hand-drawn shapes | DrawIO `urlParams['sketch']` and cell `sketch` style, **read the code**. Visual confirmation of a Board file in our viewer is still a spot-check, not done in this pass |
| Official draw.io stores the same mxfile XML as a page attachment (`application/vnd.jgraph.mxfile`), plus a PNG preview. Custom content is search metadata only | `private/client-profiles/research/drawio-copy-behaviour.html` (2026-05-27) **and** live lite-stg page 58589313, **watched it run** 2026-08-19 |
| draw.io Diagram ADF is a Forge ecosystem extension, module key `drawio`, app id `1afdce52-d22e-4d27-84db-5be989c3c83b`. Macro config points at `diagramName` + `pageId` | lite-stg page 58589313 ADF, **watched it run** |
| CQL `macro = drawio` finds those pages | lite-stg search, **watched it run** |
| `offline=1` disables the plugin loader and the realtime collab script | `public/drawio/js/diagramly/App.js` lines 772–784, **read the code** |
| Board editor theme already exists in the bundle as `sketch=1`. We do not pass that param | bundled `EditorUi.js` / `Menus.js`, **read the code** |
| No `configure=1` / `DRAWIO_CONFIG` postMessage. No admin library/font/style store | grep of Graph editor, **read the code** |

Live attachment on lite-stg page 58589313 starts `<mxfile host="…cdn.prod.atlassian-dev.net" pages="2">` with two `<diagram>` nodes. That is the same document we already persist and render.

### OpenAPI

| Fact | Evidence |
|---|---|
| Editor is `swagger-editor` (`SwaggerEditorBundle`) with live preview and Publish | `src/forge-swagger-editor.ts`, **read the code** |
| Viewer is `swagger-ui` (`SwaggerUIBundle`) fed by `specActions.updateSpec(storedSpec)` | `OpenApiViewer.vue`, **read the code** |
| Spec lives in custom content (`code`). There is no URL / Git / attachment source | `OpenApiViewer.vue` `updateSpecFromDiagram`, **read the code** |
| Validation accepts `openapi` 3.x and `swagger` 2.0 fields | `src/utils/openapi/validate.ts`, **read the code** |
| AI Repair is wired on this editor | `forge-swagger-editor.ts` → `SyntaxErrorBox`, **read the code** |

### Conversion machinery we can reuse

Lite → Full conversion (`src/lite-full-conversion.ts`, spec `docs/superpowers/specs/2026-08-11-lite-to-full-conversion.md`) already:

- walks page ADF
- rewrites ecosystem `extension` nodes in place
- creates new custom content
- PUTs one new page version
- supports `dryRun`, skip counts, Mixpanel `macro_convert_*`

That job runs as the **app** (`api.asApp()`), hourly, from a vendor queue. The sales promise for competitor conversion is **as the person who runs it**. Token model is different. The ADF rewrite core is the same shape.

---

## Competitor storage (migration input)

### draw.io Diagram

Verified on lite-stg page 58589313:

```
ADF extension
  extensionType = com.atlassian.ecosystem
  extensionKey  = 1afdce52-…/92d899e8-…/static/drawio
  guestParams.diagramName = Untitled Diagram-….drawio
  guestParams.pageId      = 58589313
  guestParams.custContentId = 67993604   (search index, not the body)

Page attachments
  Untitled Diagram-….drawio      application/vnd.jgraph.mxfile   ← source of truth
  Untitled Diagram-….drawio.png  image/png                       ← preview
  ~drawio~…tmp                   leftover temp file
```

Conversion of a Diagram macro is: download the `.drawio` attachment → write our Graph custom content → rewrite the ADF node to our Graph extension → leave the original draw.io node until the operator confirms.

### draw.io Board

draw.io documents two macros: **Diagram** (Atlas theme) and **Board** (Sketch theme, no grid, rough default style). Same mxGraph engine. Board module key on Forge is **not captured** in this pass (lite-stg has Diagram pages only; CQL guesses `drawio-sketch` / `inc-drawio` did not resolve). First spike: insert one Board on lite-stg and dump ADF.

### Open API (Swagger) Integration

Marketplace descriptor (Connect, still hosted at `toshihiro.herokuapp.com`, version 1.1.15-AC, **watched the descriptor 2026-08-19**):

| Item | Value |
|---|---|
| Featured macro key | `swagger-integration` |
| Hidden alias | `swagger-open-api` |
| Extra macro | `asyncapi` |
| Body | plain-text (paste the spec) |
| Alternate source | `url` + optional `userName` / `password` / `token` + CORS `proxy` |
| Swagger Editor | a **general page** under user preferences, not the in-macro editor |
| Try it out default | `supportedSubmitMethods=none` (off) |
| Runtime | Connect JWT to Heroku |

Our OpenAPI editor is already the stronger in-page authoring surface. Their product advantage is **live spec-from-URL / Git / attachment**.

---

## Product gaps that block a credible replacement

Ranked by whether a converted user hits them on day one. Collab, comments, Drive/OneDrive, and Gliffy import are out of this list on purpose.

### Graph — build before converting draw.io pages

| Gap | Why it blocks replacement | Size (estimate) | Notes |
|---|---|---|---|
| **1. Board editor** | Board users open a simplified Sketch UI. Dropping them into Atlas Graph is a visible downgrade the email already flags | Small | Pass `sketch=1` on the iframe; default sketch vertex/edge style; optional second macro key so slash-menu "Board" exists. Storage can stay Graph custom content |
| **2. Custom shape libraries** | Admins publish `.xml` libraries from **draw.io Configuration**. Users open them via File → Open Library from → Confluence Cloud. Migrated diagrams that reference those shapes still render (shapes are in the mxfile). **Editing** without the library is the break | Medium | Need an admin store (we already have `confluence:globalSettings`) + `configure=1` postMessage of `defaultCustomLibraries` / library XML into the embed. User-local "New Library" may already work with `libraries=1`; not verified in UI this pass |
| **3. Admin editor config** | Fonts, colours, default libraries, templates, `lockdown` | Medium | Same `DRAWIO_CONFIG` channel as (2). DrawIO documents embed configuration as `configure=1` + postMessage JSON |
| **4. Viewer layers + lightbox zoom** | draw.io hover toolbar: pages, **layers**, zoom, print, lightbox. We have pages + Export PNG + Fullscreen. Layers and in-place zoom are missing | Small–medium | `GraphViewer` already implements layers (`setLayersVisible`). We currently pass no toolbar config |
| **5. Plugins** | Email flags mxGraph plugins. Loader is off because `offline=1`. draw.io's own plugin list marks most of these as **built-in** in current DrawIO (explore, sql, number, text, svgdata, tooltips) | Spike, then maybe small | Do not enable the plugin loader fleet-wide. Inventory which plugin IDs appear in a tenant's draw.io config / localStorage during the pilot. `offline=1` is also what keeps Drive/Dropbox/realtime off — keep it unless a named plugin requires otherwise |

Not in the first build: realtime cursors (`offline=1` + no Pusher), diagram comments, Google Drive / OneDrive embed, space-nav "all diagrams" list, Gliffy mass-import.

### OpenAPI — build before converting Swagger Integration macros

| Gap | Why it blocks replacement | Size (estimate) | Notes |
|---|---|---|---|
| **1. Spec source = URL / Git / page attachment** | Competitor's primary model. A pasted-body macro converts today. A `url=` macro does not, unless we snapshot at convert-time (then the Git copy goes stale) | Medium | Product decision: snapshot at convert **or** keep a live URL. Live URL needs egress + credentials (their macro stores password/token in page content) |
| **2. Viewer chrome parity** | `docExpansion`, tag/operation sort, filter, model vs example, Try-it-out method allowlist | Small | Swagger UI already accepts these as constructor options. We hard-code defaults |
| **3. AsyncAPI macro in that app** | Same vendor ships an AsyncAPI embed. Out of Graph/OpenAPI scope; our asyncapi variant already covers it | Separate | Count during inventory; do not silently skip |

Our in-macro Swagger Editor, live preview, save-to-custom-content, and AI Repair are already ahead of their "editor is a separate general page" model.

---

## Recommended build order

1. **Graph Board** — one Forge macro (or a Graph flag) that loads DrawIO with `sketch=1` and sketch default styles. Unblocks the email's Board caveat with a real editor, not a promise.
2. **Graph admin config + custom libraries** — globalSettings page, persist JSON + library XML, inject via embed `configure=1`. Unblocks the other email caveat.
3. **Graph viewer layers (and optional lightbox zoom)** — daily view path for converted diagrams.
4. **OpenAPI URL / attachment source** — only this makes Swagger Integration conversion more than "paste-body macros".
5. **Migration tool** — CQL inventory + as-user ADF rewrite, one nominated space, original competitor macro left on the page until confirm. Reuse Lite→Full rewrite helpers; do not reuse the asApp hourly queue as the operator model.

Do not start (5) until (1) and (2) exist, or a converted Board / custom-library diagram is a support incident.

---

## Migration sketch (later)

Operator: a Confluence user with page-edit on the space, running a Forge globalPage or admin page. Reads and writes with **that user's** permissions. Matches the sales text. Different from Lite→Full's `asApp` scheduler.

Per page:

1. CQL `macro = drawio` (plus Board key once captured) and `macro = swagger-integration`.
2. Read ADF. For each draw.io node, GET the `.drawio` attachment on `guestParams.pageId` named `guestParams.diagramName`.
3. POST our Graph custom content with that XML as `graphXml` (already `<mxfile>`).
4. Rewrite the extension node to our Graph (or Board) key. Keep `localId` if we want Confluence copy identity; otherwise mint new.
5. PUT page. Leave the draw.io node in place until a second "confirm" pass deletes or comments it out. Page history is the rollback.
6. OpenAPI: if body present, store as `code`. If only `url`, either fetch-and-snapshot (needs (4) above to remain live) or skip and count.

Safety from Lite→Full that we keep: dry-run, skip reasons, one version bump per page, Mixpanel `macro_convert_*`.

Safety we add: never delete the source attachment or competitor macro in v1.

---

## Historical gotchas (this area)

- Graph used to flatten to raw `<mxGraphModel>` on save (lost extra pages). Fixed PR #82. Converter must write `<mxfile>`, never flatten.
- Graph custom content historically landed under `zenuml-content-sequence`, not `zenuml-content-graph`. Lite→Full already tripped on this (`fullContentTypeForLiteType`). New Graph creates must use the type the app itself writes today.
- DrawIO embed `init` can race the Vue listener and publish an empty canvas. `ForgeGraphEditor.vue` documents this. A converter that `load`s XML through the editor is the wrong path — write custom content directly.
- `offline=1` is load-bearing for data-egress posture. Turning it off to "enable plugins" also turns on cloud file pickers and realtime. Treat as a product decision, not a debug flag.
- Lite→Full jobs that report "done" after 25 pages were a real bug (`6d4f38c0`). Any batch converter must carry the job across ticks.
- Partner agreement: vendor-initiated page edits without a customer request are out (Lite→Full spec § Decision). Competitor conversion inherits that: enqueue only after the tenant names a space.

---

## Open facts (not yet verified)

1. Board Forge module key and whether Board attachments differ from Diagram (filename, `simple` guestParam, extra XML).
2. Whether File → New Library already works in our embed with `libraries=1` + `offline=1`.
3. Whether our GraphViewer paints a Board file's sketch styles without `sketch=1` (spot-check: load a Board mxfile into a Graph macro).
4. Which plugin IDs, custom libraries, and `DRAWIO_CONFIG` JSON the target tenant actually uses — only their draw.io Configuration page and a Board/Diagram sample answer this.
5. Split of Swagger Integration macros that are paste-body vs `url=` vs attachment. Controls whether OpenAPI URL-source is a conversion blocker or a nice-to-have.
6. `colesgroupext` is a separate site with no ZenUML install. Conversion there is an install + licence problem, not a macro rewrite.

---

## First spike (cheap, on lite-stg)

lite-stg already has the official draw.io app and Diagram fixtures. Insert one **Board** macro, dump ADF + attachments, and load that mxfile in our Graph viewer and editor (with and without `sketch=1`). That closes (1)–(3) above without a customer site.
