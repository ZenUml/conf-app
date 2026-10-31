# ADR-0010: Render PlantUML in the viewer's browser, not at plantuml.com

**Status**: Proposed. Spike behind the Forge flag `plantuml-local-renderer-enabled` (off), with server fallback; default unchanged.
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

A, as the first renderer for the macro, the editor linter and export, **with
plantuml.com as a per-diagram fallback** while the engine has known gaps. The
owner chose this over a hard switch on 2026-10-24.

- **Fallback.** When the engine cannot draw a diagram (an unresolved `!include`,
  a crash, a chunk that will not load), that one diagram is validated and drawn
  by plantuml.com exactly as today. Nothing a viewer could see before breaks.
  The privacy gain is partial until the gaps close: a fallback diagram's source
  still leaves the browser, and `macro_viewed.plantuml_renderer =
  server_fallback` counts how often.
- **Gate.** The Forge flag `plantuml-local-renderer-enabled` (default off,
  fail-closed) chooses the engine per site. `localStorage.plantumlRenderer`
  (`local` / `server`) in the macro iframe overrides it per browser, for testing.
- The fallback does not cover layout differences between Smetana and Graphviz,
  which still need rollout step 3 before a site is switched on.

B is kept only for the two places a browser engine cannot reach (see "Open
questions"), and only if those places prove to need it.

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
- `utils/plantuml/renderer.ts`: the gate. The Forge flag
  `plantuml-local-renderer-enabled` (one lookup per iframe, `server` on any
  error), overridable per browser by `localStorage.plantumlRenderer`. The flag
  is off, so no customer is affected.
- `PlantUml.vue` and `validate.ts`: try the engine, fall back to the server for a
  diagram it cannot draw. Export (3) and the MCP view (4) are untouched.
- `utils/plantuml/stdlib.ts`: the C4 library as data through
  `PLANTUML_STDLIB_LOADER` (rollout step 4).
- Analytics, added before the code: `macro_viewed.plantuml_renderer`
  (`server | local | server_fallback`) and `plantuml_local_render_failed` with
  `plantuml_failure_reason` (`load_failed | include | engine_error`) and, for
  include failures, `plantuml_unresolved_include` (`stdlib | url | local`).
- Storybook: `Editor/Diagram/PlantUmlLocalRenderer`. Sequence, class and syntax-error
  stories refuse any plantuml.com request; the include story stands in for the
  server and shows the fallback drawing.

## Production exposure (D1, 2026-10-24)

Measured with read-only aggregate queries over `CustomContent` in the production D1
(`conf-zenuml-prod`). The diagram source is `body.raw.value.plantUmlCode`. Only
counts were read, never diagram text. Site-level detail stays out of this public
record (client-privacy policy).

**Scope:** the 4,060 PlantUML diagrams owned by the three Forge apps, 83 sites in
all. More than 4,000 older rows with numeric app IDs are Connect-era records with no
site, and are left out.

| App | Diagrams | Sites |
|---|---|---|
| Lite | 3,220 | 73 |
| Full | 494 | 9 |
| Diagramly | 346 | 1 |

Every body starts with `@startuml` and none are empty. The average is 1.7k
characters, 109 exceed 8k, and the largest is 36.5k.

**What would take the fallback today.** That is any diagram with an `!include` the
engine cannot resolve: 171 diagrams (4.2%) on 10 sites.

| Include | Diagrams | Sites | After rollout step 4 |
|---|---|---|---|
| URL into `github.com/plantuml-stdlib/C4-PlantUML` (`!includeurl` / `!include https://…`) | 112 | 6 | local, if known stdlib URLs map to the self-hosted copy |
| `<C4/...>` stdlib | 43 | ≤4 | local |
| other `plantuml-stdlib` URLs (sprites 2, unidentified 3) | 5 | ≤1 | local for the sprite repo; the rest stay on the fallback |
| `<tupadr3/...>`, `<azure/...>`, `<awslib/...>` | 8 | ≤2 | local, if those bundles are hosted too |
| another GitHub URL | 3 | 1 | fallback |

So C4, through both the stdlib and its GitHub URL, accounts for about 90% of the
fallback cases. After step 4 roughly 6–8 diagrams (about 0.2%) would still need
plantuml.com. Note that for the URL includes, plantuml.com fetches GitHub on the
viewer's behalf today, so GitHub is a second third party in that path.

**Features the engine handles without the fallback:** `!theme` (196 diagrams,
9 sites; `themes.js` loads on demand), `<&icon>` sprites (62), `!pragma layout` (24),
`skinparam` (1,389). Emoji and custom `sprite $` are unused.

**Layout risk.** These counts come from a keyword heuristic and are approximate.
Diagram kinds that never used Graphviz should render the same; the rest get the
engine's built-in Smetana layout instead of Graphviz.

| Kind | Diagrams | Sites | Created in the last 90 days |
|---|---|---|---|
| sequence (no Graphviz) | 2,778 (68%) | 63 | 1,103 |
| activity (no Graphviz) | 200 (5%) | 17 | 82 |
| component / use case / state / deployment | 681 (17%) | 39 | 270 |
| class / entity | 187 (5%) | 12 | 31 |
| C4 | 158 (4%) | 7 | 27 |
| unclassified | 56 | 4 | 5 |

About a quarter (roughly 1,000 diagrams on about 45 sites) can change layout. Those
are what step 3 must compare.

**Limits.** D1 mirrors Confluence and can lag or miss diagrams. It also says nothing
about how often a diagram is viewed, which is `macro_viewed` in Mixpanel.

## Rollout plan

1. **Measure exposure.** Done 2026-10-24 on production D1 (previous section).
   Per-site detail, if needed, belongs in `private/`.
2. **Forge iframe.** Done for Lite on 2026-10-24 (see above). Repeat on a Full or
   Diagramly install before rolling out there, since their CSP has no `'unsafe-eval'`.
3. **Visual comparison.** Render a sample with both renderers and compare. The public
   server's PlantUML version is unknown, and Smetana and Graphviz lay out
   differently. Tool: `scripts/plantuml-compare/compare.mjs`. It bundles the real
   `engine.ts`, renders in headless Chromium under `script-src 'self'` (the Full
   and Diagramly iframe policy), and with `--server` also asks plantuml.com, then
   compares text labels, sizes and side-by-side PNGs.
   - **Synthetic corpus done (2026-10-24):** 20 diagrams in
     `corpus.synthetic.mjs`, no customer content. All 20 rendered locally; every
     label plantuml.com drew is also in the local drawing. Under the strict policy
     there were no CSP violations and no requests outside the page (so the stricter
     Full/Diagramly policy holds in the test page; a real Full/Diagramly iframe is
     still step 2). Sequence, activity, C4, mindmap and Gantt diagrams match except
     for text metrics. The server stretches letters to its own font widths, while
     the engine measures with the browser font, so local drawings are 3–25%
     smaller. Class, component, state, use-case, deployment and object diagrams get
     a different but valid layout. Edge routing differs, and one defect showed: a
     class-diagram note's connector is drawn across another class instead of
     around it.
   - **Production corpus, engine only (2026-10-24, approved by the owner).** All
     4,075 production PlantUML sources were drawn by the engine in headless Chromium
     under `script-src 'self'`, with nothing sent anywhere. The sources sat in an
     ephemeral working directory under anonymous IDs, and only counts are recorded
     here. The run found two divergences from plantuml.com, and both are fixed
     (`utils/plantuml/unwrap.ts`):

     | Outcome | First run | After fix 1 | After fixes 1 and 2 |
     |---|---|---|---|
     | drawn by the engine | 3,448 (84.6%) | 4,000 (98.2%) | **4,023 (98.7%)** |
     | syntax error shown | 547 (13.4%) | 32 (0.8%) | **9 (0.2%)** |
     | include fallback | 68 | 27 | 27 (15 non-C4 URLs, 12 unhosted libraries) |
     | engine-error fallback | 12 | 16 | 16 (10 too large, 6 engine faults) |

     In every run, across all 4,075 diagrams, the page logged no CSP violation
     under `script-src 'self'` and made no request outside itself. This is the
     strongest evidence so far that the engine works under the Full and
     Diagramly policy, which has no `'unsafe-eval'`. A real Diagramly iframe
     (step 2) is still checked before that flag goes on in production. With the
     fallback, a viewer would see the 43 include and engine-error diagrams drawn
     by plantuml.com as today. Only the 9 syntax errors could look different
     from today.

     1. *Nested sources* (a doubled `@startuml` header from the paste bug fixed in
        conf-app#632, or `@startuml` around `@startgantt` / `@startjson` /
        `@startmindmap`): 571 sources, which plantuml.com draws. `selectServerBlock`
        applies the rule every measured shape follows: a `@start…` line abandons
        anything open, and the server draws the block an `@end…` completes. Sources
        with several complete blocks, which the server merges, go to the server.
     2. *Backslash line continuation*, which plantuml.com joins before parsing:
        `joinContinuationLines` does the same.

     Both rules were checked against plantuml.com on synthetic sources only. All
     105 GitHub C4 URL includes now render locally. Engine time: p50 26 ms,
     p90 110 ms, p99 716 ms. The 9 remaining syntax errors (6 share one line
     shape) may also be errors on plantuml.com; that cannot be told without
     sending them there.
   - **Production corpus, both renderers: skipped by the owner (2026-10-24).**
     Comparing layouts on a sample of the roughly 1,000 Graphviz-layout diagrams
     would have sent that sample's source to plantuml.com. The owner chose to
     roll out on Diagramly first instead, and to judge layout differences on the
     canary through `macro_viewed` and feedback. The synthetic corpus already
     shows the expected kind of difference (a different but valid layout for
     class-like diagrams). Outputs from customer content stay out of this
     public repo.
4. **Self-host the stdlib.** **C4 done (2026-10-24).** `utils/plantuml/stdlib.ts`
   sets `PLANTUML_STDLIB_LOADER` and serves C4-PlantUML 2.14.0 (MIT) as data from a
   lazy chunk (`stdlib/c4.json`, about 190 KB). The JSON is converted from the
   official `c4.min.js` by `scripts/plantuml-stdlib/bundle-to-json.mjs`, which
   parses the bundle and accepts only literal data, so no downloaded code runs.
   Any other library is declined and falls back. `PLANTUML_STDLIB_BASE` stays unset.
   **GitHub C4 URL includes done (2026-10-24).** The engine never hands URL
   includes to `PLANTUML_FILE_LOADER` (measured: it reports "cannot include"
   without calling it). So `rewriteHostedIncludes` (in `stdlib.ts`) rewrites
   `!include` / `!include_once` / `!include_many` / `!includeurl` lines that
   point at `plantuml-stdlib/C4-PlantUML/<ref>/<File>.puml` to
   `!include <C4/<File>>` before the engine runs, one line for one line, so
   error line numbers still match. It covers only top-level files the hosted
   library has. In production every such line uses
   `raw.githubusercontent.com/…/master/` and one of five files (105 lines). If a
   rewritten diagram renders as a syntax error, for example because a pinned
   older ref used a macro 2.14.0 lacks, it is treated as an include failure and
   falls back to plantuml.com, which fetches the ref the author named.
   `plantuml_include_rewritten` marks these renders on `macro_viewed` and on
   failures. **Still open:** tupadr3, azure and aws (8 diagrams), which are
   optional. Other local-file and URL includes stay on the fallback.
5. **Roll out the Forge flag** by site: diagramly, then lite, then full. The
   owner chose Diagramly as the first production site on 2026-10-24, after the
   engine-only production run. Diagramly holds 346 of the 4,060 diagrams, all on
   one site (see Production exposure). The flag
   must first be created in the Developer Console for each app (forge-feature-flag
   skill). Gate each widening on `macro_viewed` split by `plantuml_renderer`
   (`local` vs `server_fallback`) and on `plantuml_local_render_failed` reasons.
6. **Export.** Rasterise the local SVG on a canvas instead of fetching
   `/plantuml/png/`. The "html-to-image cannot decode the server SVG" failure in
   `fetchPng.ts` needs re-testing: the local SVG has no external references.
7. **MCP App view.** Bundle the engine into `vite.mcp-app.config.mjs` and remove
   plantuml.com from `resourceDomains`.
8. **Remove the egress.** Delete `https://www.plantuml.com` from `manifest.yml`. For
   our Connect-migrated apps that is a minor version (see CLAUDE.md, "major vs
   minor"); the `forge deploy` output confirms it. Then update the P&S questionnaire
   for lite, full and diagramly, and the nightly Export PNG workflow.

## Licensing (2026-10-31)

`@plantuml/core` is MIT from 1.2026.6 on; earlier versions are GPL-3.0-or-later
(package README). The engine's licence text also says generated images belong to
the author of the diagram source and need no attribution. The engine shows no
sponsored messages: the only "sponsor" and "advertising" strings in
`plantuml.js` sit inside its Brotli dictionary.

What we owe is attribution in what we ship. The npm `plantuml.js` has no licence
header, and the parts loaded on demand carry other authors' licences: themes
(puml-themes, MIT), OpenIconic icons (MIT), Twemoji emoji graphics (CC-BY 4.0)
and the self-hosted C4 library (MIT). `public/third-party-notices.txt` carries
each notice. Vite copies it into every variant's `dist/`, so it ships with the
code. Twemoji's README accepts a mention in the HTML/JS source as attribution.

`src/utils/plantuml/thirdPartyNotices.spec.ts` fails if the pinned
`@plantuml/core` version is missing from the notice, if the installed package is
not MIT, or if the PlantUML or C4 licence text in the notice drifts from the file
it was copied from. Graphviz (`viz-global.js`, EPL) is not loaded and so not
listed. This is a reading of the licence texts, not legal advice.

## Open questions

- **Server-side export (ADR-0004)** has no browser. If that work goes ahead,
  PlantUML there needs option B or the engine on a server-side canvas.
- **Rendering differences.** Whether existing diagrams change visibly enough to
  matter. Step 3 settles correctness: 98.7% of production diagrams draw, and the
  rest fall back. It does not settle layout on Graphviz-layout diagrams, because
  the two-renderer run was skipped. The Diagramly canary answers that.
- **Full and Diagramly iframes.** Lite is confirmed in a real Forge iframe. The
  stricter CSP of the other variants is covered only by the local header test so far.

## Consequences

- When the rollout completes and the fallback is no longer needed, no PlantUML
  source leaves the viewer's browser. One sub-processor and one egress entry go
  away. Until then, `server_fallback` views still send their source.
- PlantUML renders when plantuml.com is down or slow, and no longer pays a network
  round trip. The first render pays a 1.1 MB chunk download instead, cached afterwards.
- We own an engine upgrade cadence (Dependabot) instead of inheriting the public
  server's version silently.
