# PR #1300 evidence

BEFORE: `1037952b1` (origin/main, merge base). AFTER: `f78426014` (PR head).

## Storybook comparison

- Both Storybook builds made locally with `PRODUCT_TYPE=lite storybook build`; BEFORE used the `package.json` and `pnpm-lock.yaml` of `origin/main`, AFTER used the PR head.
- Served with `python3 -m http.server`, captured with agent-browser (Chrome for Testing), 1280x577 viewport, 4 s settle, story iframe `iframe.html?id=<story>&viewMode=story`.
- Fixtures are the stories' own fictional data.

| Story | Pixel difference (ImageMagick AE) | Cause |
|---|---|---|
| editor-diagram-header--mermaid-diagram | 0 (identical) | |
| editor-diagram-syntaxerrorbox--single-error | 0 (identical) | |
| modal-feedbackdialog--idle | 0 (identical) | |
| viewer-genericviewer--source-panel-open-api | 269 px | build-label commit hash text in the debug bar |
| viewer-genericviewer--connect-mcp-async-api | 269 px | build-label commit hash text in the debug bar |
| editor-diagram-markdown--document | 75 px | `localhost:7811` vs `localhost:7812` text in a URL |

No difference comes from CSS, layout or component rendering. Note: the build label shows the git HEAD at build time, so the AFTER images show `@103795…` and the BEFORE images `@f78426…` (the BEFORE build ran after the commit, with the main lockfile checked out). The label is not part of the dependency change.

## js-yaml 4.1.1 vs 4.3.2 probe

`yaml-roundtrip.mjs` loads, loadAlls and dumps three fixtures with both versions from the pnpm store and compares the results: the OpenAPI demo body (`src/demoPageContent.js`), the default AsyncAPI spec (`src/forge-asyncapi-editor.ts`) and an edge-case spec (block scalars, quoted booleans and numbers, dates, anchors and aliases, long lines, Unicode).

Result: `load`, `loadAll` and `dump` outputs are byte-identical for all three. Run: `node yaml-roundtrip.mjs <repo-root>`.

## Limits

- No Storybook story covers the swagger-editor (OpenAPI edit) or the AsyncAPI Studio editor; those are bundled builds checked by `build:lite` and `build:asyncapi` only.
- Forge tunnel and CI staging stages are not done here (see PR body).
