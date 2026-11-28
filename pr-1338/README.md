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

## Forge Tunnel stage (2026-11-28)
- Candidate: branch `fix/mermaid-edge-btoa-unicode` at `7ed2cdcbf`, Lite variant, Forge development environment, a personal test site (not a customer site).
- Vite on :8080 started from the PR worktree with `FORGE_TUNNEL=1`; `forge tunnel` reported `Tunnelling to: DEV <env>`.
- Throwaway page with one Mermaid macro (same synthetic Vietnamese flowchart), created over REST as the tunnel's own Forge account.
- Observed: both Lite macro iframes loaded from `localhost:8000` (owned by the `forge tunnel` process), not the Atlassian CDN; the proxy served `vendor/mermaid/chunks/mermaid.esm.min/chunk-4OADUZ5Q.mjs` with the patched call (raw `btoa(JSON.stringify(` count 0) and `VITE_APP_GIT_HASH` `7ed2cdcbf`; the flowchart rendered. Screenshot cropped to the macro: `tunnel-after.jpg`.
- Limitation: the edge-point leak was not injected inside the Confluence iframe (the browser tool cannot run code in Forge's cross-origin iframe), so this stage proves the patched build is what Confluence loads and renders non-Latin1 text; the forced failure is covered by `capture.mjs` and Storybook.
