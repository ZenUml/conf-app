# Swagger UI 5.34.0 validation: blocked by large-document capture

2026-10-27. Candidate application source at `668d9547`, Storybook served locally at `http://localhost:6006/iframe.html?id=viewer-openapi--large&viewMode=story`. The fixture in `OpenApiViewer.stories.ts` contains 200 ordinary operations, one referenced Path Item operation, and 200 schemas.

## Observed

- 5.34.0 rendered the large document and the referenced operation after scrolling to it. The viewer's spec selector reported 201 operations, but only about 10 operation blocks existed in the DOM at the top of the page. Screenshot: `/tmp/conf-app-1008-large-ref.png`.
- The production viewer does not set Swagger UI's `filter` option; a filter input was absent. Therefore the upstream path-filter feature is not exposed by the current integration and was not verified as a product feature.
- The existing capture pipeline serializes the viewer DOM with `html-to-image` (`src/model/captureBlob.ts`). On the Storybook viewer's `.screen-capture-content`, `toSvg` with `skipFonts: true` contained `Get order 0` but not `Get order 199` or `Referenced operation`. The same fixture and capture on 5.32.1 contained all three, with 201 operation blocks in the DOM. This directly establishes missing content in the capture serialization; a complete end-to-end PNG/export and Confluence PDF/Word check has not yet been performed.
- A small warm-cache browser experiment measured iframe creation to the first `.opblock`: 5.32.1: 343, 328, 333 ms; 5.34.0: 308, 186, 178 ms. These are three local Storybook observations, not full rendering times, cold loads, or statistically robust performance results. The baseline was tested using the 5.32.1 installed package with Storybook's cache rebuilt; the candidate uses 5.34.0. Both used the same source fixture and browser.

## Decision and remaining work

Do not accept or deploy the upgrade until large-document capture/export preserves the required content. Investigate a supported way to render all operations and schemas for capture without breaking interactive virtualization; verify both the PNG output and Confluence export. Repeat Storybook validation on the final candidate, including schema expansion, spec updates and Try it out. Then complete Forge Tunnel and CI-deployed Staging in order, with actual UI evidence for create, edit, save, reopen, and export. Filtering is not enabled by the current integration; any product change to enable it is a separate decision.

## Capture experiment (not a fix)

The installed 5.34.0 browser bundle enables operation virtualization at 150 flattened rows and schema virtualization at 100 schemas. In the Storybook fixture, temporarily overriding `window.innerHeight` to 30,000 pixels, dispatching `resize`, and expanding `.models-scroll` to 20,000 pixels caused all 201 operations and 200 schemas to appear. `html-to-image.toSvg` then included the last operation, referenced operation, and `Order199`; the capture node was 32,393 pixels tall. This is an isolated browser experiment, not a production change: overriding global viewport state and relying on asynchronous resize/layout has unresolved concurrency, scroll-position, nested scroll-container, background Forge iframe throttling, restoration, and canvas size concerns. Do not use this as an implementation without resolving and testing those cases.
