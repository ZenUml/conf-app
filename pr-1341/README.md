# PR #1341 evidence — Fullscreen SVGMatrix inverse

Baseline: origin/main ec72d5163. Candidate: 138f95c9e (fix/viewport-singular-matrix).

## Storybook
Story: `Viewer / GenericViewer / Fullscreen — Mermaid survives a zero-width resize`
(`viewer-genericviewer--mermaid-fullscreen-zero-width-resize`), Storybook 10 dev, Chrome (Claude built-in browser), 800x600 pane.

Probe (run in the story iframe): set `.diagram-viewport` width to 0px, wait 4 frames, click Zoom in, dispatch a wheel event, restore width, wait.

| | Baseline (fix reverted) | Candidate |
|---|---|---|
| window errors | `Uncaught InvalidStateError: Failed to execute 'inverse' on 'SVGMatrix': The matrix is not invertible.` | none |
| `.svg-pan-zoom_viewport` transform after width returns | `matrix(0,0,0,0,0,140)` (blank) | `matrix(0.4759…,0,0,0.4759…,42.1,109.3)` (same fit as before) |
| play function | — | PASS |

Screenshots: `storybook-before-blank.jpg` (baseline, blank canvas after width returns), `storybook-after-pass.jpg` (candidate, diagram visible, play PASS).

## CI-deployed Lite staging (after merge)
Merge commit 301f01a59 (main run 46087333981, Staging validation 46087381747: Deploy Lite success).
Site: Lite staging, robot test account. Build in the macro debug bar: `301f01a59…@301f01a` (`mermaid-0-inline-version.png`).
Probe `stg-check.mjs` (Playwright, 1280x800): open Fullscreen, resize the window 1280→700→1280, then inside the
Fullscreen iframe set `.diagram-viewport` width 0, click Zoom in, wheel, restore.

| Page | Result |
|---|---|
| Mermaid (svg-pan-zoom) | No `SVGMatrix`/`inverse` error (iframe `error` listener + console). Transform `matrix(0.8538…)` before, after the window resize and after the forced zero width. Diagram visible (`mermaid-1-fullscreen.png`, `mermaid-2-after-resize.png`). |
| ZenUML sequence | Renders in Fullscreen, no error after the window resize (`sequence-2-after-resize.png`). The zero-width probe does not apply: ZenUML uses DiagramTransformViewport, not svg-pan-zoom. |
