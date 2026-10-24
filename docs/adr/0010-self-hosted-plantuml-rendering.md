# ADR-0010: Render PlantUML in the viewer's browser, not at plantuml.com

**Status**: Proposed. Spike merged behind a per-browser opt-in, default unchanged.
**Date**: 2026-10-24
**Related**: [ADR-0004](0004-export-server-side-render-feasibility.md) (server-side export), `src/components/PlantUml.vue`, `src/utils/plantuml/`, `src/mcp-app-view.ts`, `manifest.yml` `permissions.external.fetch.client`, PRs #930 and #951 (open, same files)

## Context

Every PlantUML surface sends the diagram source to `www.plantuml.com`, a third party
we have no agreement with. The source travels in the URL path of a GET, deflated and
base64-encoded: an encoding, not encryption. Anyone who reads that server's access
logs can recover the full diagram text.

| # | Call site | When it fires |
|---|---|---|
| 1 | `components/PlantUml.vue` (`PLANTUML_SERVER`) | every view of a PlantUML macro, guests and anonymous visitors included |
| 2 | `utils/plantuml/validate.ts`, through `linter.ts` | on every typing pause in the editor, so unsaved drafts leave too |
| 3 | `utils/plantuml/fetchPng.ts`, used by `model/Attachment.ts` and `ExportModal/useExportEngine.ts` | backup PNG for PDF/Word export, its upscale, and the interactive Export PNG |
| 4 | `mcp-app-view.ts` and `functions/agent-link/oauth/mcpApps.ts` (`PLANTUML_ORIGIN`) | the claude.ai MCP App view draws an `<img>` pointing straight at plantuml.com |
| 5 | `manifest.yml` `external.fetch.client: https://www.plantuml.com` | the egress that permits 1 to 3 |

The P&S questionnaire lists plantuml.com as a sub-processor for lite, full and diagramly
(the asyncapi variant has no PlantUML macro).

## Options

**A. Render in the browser with `@plantuml/core`.** The official PlantUML build
compiled to JavaScript with TeaVM, published on npm since 2026-05-26. MIT for
versions 1.2026.6 and later; pinned here at 1.2026.9 (2026-10-17). The source
never leaves the iframe. Nothing on our backend joins the render path, which keeps
the rule that rendering must not depend on our Cloudflare backend.

**B. Run `plantuml/plantuml-server` ourselves**, for example on Cloudflare
Containers behind a Worker on `*.zenuml.com`, which is already in egress. The
third party goes away, but diagram source now passes through our infrastructure:
a new data-handling duty, a JVM to run, cold starts, and a backend in the render
path. Keep `ALLOW_PLANTUML_INCLUDE` off.

**C. Run Kroki ourselves.** B's trade-offs with more moving parts, for one diagram type.

## Decision (proposed)

A, as the only renderer for the macro, the editor linter and export. B is kept
only as a fallback for the two places a browser engine cannot reach (see
"Open questions"), and only if those places prove to need it.

## Evidence from the spike (2026-10-24)

Measured in headless Chromium against `@plantuml/core` 1.2026.9, served from a
local static server. Times include the first, cold run.

| Case | Result |
|---|---|
| sequence diagram | SVG in 324 ms, no network requests |
| class diagram (needs a Graphviz layout) | SVG in 236 ms |
| syntax error on line 3 | SVG with `[From textarea (line 3) ]` and `Syntax Error? (…)`: the markers `validate.ts` already parses |
| `!include <C4/C4_Context>` | SVG saying `cannot include <C4/C4_Context>`, and no fetch anywhere |

Forge serves the macro under a strict CSP. Graphviz in this package is
`viz-global.js`, a WebAssembly build. Under a CSP header:

| Setup | CSP | Class diagram |
|---|---|---|
| with `viz-global.js` | `script-src 'self'` | PlantUML crash page ("An error has occurred!") |
| with `viz-global.js` | `script-src 'self' 'wasm-unsafe-eval'` | renders |
| without `viz-global.js` | `script-src 'self'` | **renders**, laid out by Smetana, PlantUML's built-in Java port of Graphviz |

So the engine ships without `viz-global.js` and the manifest's CSP stays as it is.
The variants differ here: the Lite manifest edit grants `'unsafe-eval'` (for AsyncAPI
Studio), which Chrome also accepts for WebAssembly, while Full and Diagramly grant
neither. Leaving Graphviz out makes every variant take the same Smetana path.

### In a real Forge iframe (2026-10-24)

The owner waived the Forge Tunnel stage for this spike: the tunnel serves only the
`FORGE_EMAIL` browser identity, which the agent container cannot sign in as. Instead,
commit `c22dbc5` was deployed with `scripts/forge-wizard.mjs` (Lite manifest edits
applied) to the `yanhui` development environment. Forge applied it as a minor
version: the existing install reported "already at the latest version", with no
consent prompt. The check ran as the robot account on a REST-created test page
holding the class diagram above:

| | Before opt-in | After `plantumlRenderer = 'local'` |
|---|---|---|
| iframe host | `*.cdn.prod.atlassian-dev.net` (deployed bundle) | same |
| class diagram | drawn by plantuml.com | drawn by the local engine (Smetana layout) |
| plantuml.com requests | 2 (validation + render) | **0** |
| engine chunks loaded | none | `engine-*.js`, `plantuml-*.js` |
| script / WebAssembly CSP violations from the macro | none | **none** |

The only `unsafe-eval` notice in the console came from Confluence's own CDN on the
host page, and it was there before the opt-in too. This run tested the Lite iframe
CSP, which includes `'unsafe-eval'`. The stricter `script-src 'self'` case (Full and
Diagramly) rests on the local test above: the engine renders there without
Graphviz, and `plantuml.js` contains no `eval(` or `new Function`.

Two more properties surfaced:

- **The engine measures text with a canvas.** jsdom cannot run it, so unit tests
  mock the engine and real rendering is tested in Storybook and the browser. Layout
  also depends on the fonts installed in the viewer's browser, where the server
  always used its own. The same diagram can be a few pixels different per OS.
- **Size.** `plantuml.js` is 3.3 MB, 1.1 MB gzipped, loaded only when a PlantUML
  macro renders. `themes.js` (320 KB), `openiconic.js` (51 KB) and `emoji.js`
  (1.8 MB) load only when the source uses `!theme`, `<&icon>` or `<:emoji:>`.

## The spike as merged

- `utils/plantuml/engine.ts`: lazy engine load, optional data on demand, one shared
  run for validation plus render, and a classifier for the two error pages the engine
  draws as a "successful" SVG (`engine_error`, `include`).
- `utils/plantuml/renderer.ts`: the gate. `server` unless the macro iframe's origin
  has `localStorage.plantumlRenderer = 'local'`. No customer is affected.
- `PlantUml.vue` and `validate.ts`: one branch each on the gate. Export (3) and
  the MCP view (4) are untouched.
- Analytics, added before the code: `macro_viewed.plantuml_renderer`
  (`server | local`) and `plantuml_local_render_failed` with
  `plantuml_failure_reason` (`load_failed | include | engine_error`).
- Storybook: `Editor/Diagram/PlantUmlLocalRenderer`, which refuses any
  plantuml.com request and asserts there was none.

## Rollout plan

1. **Measure exposure.** On our own staging sites, scan PlantUML custom content for
   `!include`, `!theme`, sprites and large diagrams. Customer-content analysis
   belongs in `private/`.
2. **Forge iframe.** Done for Lite on 2026-10-24 (see above). Repeat on a Full or
   Diagramly install before rolling out there, since their CSP has no `'unsafe-eval'`.
3. **Visual comparison.** Render the staging corpus with both renderers and compare.
   The public server's PlantUML version is unknown, and Smetana and Graphviz lay out
   differently.
4. **Self-host the stdlib** (C4, AWS, …) under our own static assets and set
   `PLANTUML_STDLIB_BASE`. Local-file `!include` needs a `PLANTUML_FILE_LOADER`, or
   stays unsupported as it is today.
5. **Replace the localStorage gate with a Forge feature flag**, then roll out by
   site: diagramly, then lite, then full. Gate each widening on
   `plantuml_local_render_failed` against `macro_viewed` with
   `plantuml_renderer = local`.
6. **Export.** Rasterise the local SVG on a canvas instead of fetching
   `/plantuml/png/`. The "html-to-image cannot decode the server SVG" failure in
   `fetchPng.ts` needs re-testing: the local SVG has no external references.
7. **MCP App view.** Bundle the engine into `vite.mcp-app.config.mjs` and remove
   plantuml.com from `resourceDomains`.
8. **Remove the egress.** Delete `https://www.plantuml.com` from `manifest.yml`. For
   our Connect-migrated apps that is a minor version (see CLAUDE.md, "major vs
   minor"); the `forge deploy` output confirms it. Then update the P&S questionnaire
   for lite, full and diagramly, and the nightly Export PNG workflow.

## Open questions

- **Server-side export (ADR-0004)** has no browser. If that work goes ahead,
  PlantUML there needs option B or the engine on a server-side canvas.
- **Rendering differences.** Whether existing diagrams change visibly enough to
  matter. Step 3 answers it.
- **Full and Diagramly iframes.** Lite is confirmed in a real Forge iframe. The
  stricter CSP of the other variants is covered only by the local header test so far.

## Consequences

- When the rollout completes, no PlantUML source leaves the viewer's browser. One
  sub-processor and one egress entry go away.
- PlantUML renders when plantuml.com is down or slow, and no longer pays a network
  round trip. The first render pays a 1.1 MB chunk download instead, cached afterwards.
- We own an engine upgrade cadence (Dependabot) instead of inheriting the public
  server's version silently.
