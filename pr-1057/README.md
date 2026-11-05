# PR 1057 evidence: Graph macros with math="1"

Baseline: lite-stg before this PR (`DRAW_MATH_URL` default `viewer.diagrams.net`).
Candidate: `ff133e5d`, CI run 42012254220, `Deploy: Lite` done 2026-11-05T10:58:42Z.
Fixtures: `graph-math1.xml`, `graph-math0.xml` (fictional labels).
Pages: lite-stg 382402598 (before), 382861499 (d31ba1e6), 382435791 (final); lite-dev 111214600, 111149066 (tunnel).

## Observed in the Forge macro frame

| Probe | Before | After (`ff133e5d`) |
|---|---|---|
| MathJax source | `viewer.diagrams.net`, resource status 0 | `drawio/math4/es5`, status 200 |
| `mjx-container` in math=1 frame | 0 | 2 |
| `.graph-viewer-canvas` visibility, math=1 | `hidden` | visible |
| Requests to `math4/` in math=0 frame | 1 blocked | 0 |
| PNG attachment, math=1 fresh page, cold browser session | 6,073 bytes, no labels | 10,069 bytes, all labels |

Math file transfer on a cold staging load, math=1 frame: startup 6 KB, core 40 KB, svg 48 KB, tex 46 KB, asciimath 29 KB, safe 3 KB, font 556 KB. About 730 KB, 4.4 s from first request to last.

`race-attachment-d31ba1e6.png` is the PNG from the first candidate, which rendered correctly but captured at 1.5 s, before MathJax finished. `ff133e5d` fixes that.

## Prevalence

D1 mirror, `conf-zenuml-prod`, aggregate counts only, 2026-11-05: 1 of 9,571 Graph bodies has `math="1"`, in 1 space. The D1 mirror is not Confluence itself.

## Not verified

Full, Diagramly, AsyncAPI variants; MCP view in a real host (unit test only); math inside the nested DrawIO editor; Export dialog opened before MathJax finishes.
