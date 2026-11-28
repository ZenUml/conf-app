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
