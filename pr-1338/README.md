# PR 1338 evidence: Mermaid edge data-points UTF-8 encoding

- BEFORE: merge-base `f0980039f5e99c81fcf78217fca72332e8062b16` (mermaid 11.17.2, unpatched)
- AFTER: `7ed2cdcbf40c4a05428d67c4f125d6cc392c0a7d` (mermaid 11.17.2 + `patches/mermaid@11.17.2.patch`)
- Browser: Playwright Chromium (headless), viewport 640x520. Fixture: synthetic Vietnamese flowchart (no customer data).

## Forced condition
The failing customer layout was not reproduced synthetically (`fuzz-natural-repro.mjs`: 400 random flowcharts plus ~100 hand-written cases never leaked a node into edge points). `capture.mjs` therefore injects the same leak Mermaid's `intersectPolygon` produces when it returns the node: the first point of every edge carries a non-Latin1 `label`. It loads `dist/mermaid.esm.min.mjs`, the file the viewer loads from `vendor/mermaid`.

## Results (`capture-output.json`)
- BEFORE: `mermaid.render` throws `Failed to execute 'btoa' on 'Window': The string to be encoded contains characters outside of the Latin1 range.` (identical to the production `viewer_load_failed.failure_reason`). Screenshot: `before.png`.
- AFTER: renders; 3 of 3 edges carry `data-points`. Screenshot: `after.png`.
- Storybook `Viewer/MermaidNonLatinEdgePoints` (real `Mermaid.vue`, bundled patched core build, same injection): rendered, no error panel; all 3 `data-points` decode to JSON containing the label. Screenshot: `storybook-after.jpg`.

## Limitations
Not a natural reproduction of the customer layout. Forge Tunnel and CI-deployed staging checks are separate stages.
