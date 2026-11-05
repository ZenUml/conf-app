# PR 1057 evidence: Graph macros with math="1"

Baseline: lite-stg before this PR (`DRAW_MATH_URL` default `viewer.diagrams.net`). The deployed SHA was not recorded at capture.
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

`race-attachment-d31ba1e6.png` is the blank PNG from the first candidate. Its viewer rendered correctly, but the capture ran at 1.5 s, before MathJax finished. `ff133e5d` fixes that.

## Prevalence

D1 mirror, `conf-zenuml-prod`, aggregate counts only, 2026-11-05: 1 of 9,571 Graph bodies has `math="1"`, in 1 space. The D1 mirror is not Confluence itself.

## Not verified

Full, Diagramly, AsyncAPI variants; MCP view in a real host (unit test only); math inside the nested DrawIO editor; Export dialog opened before MathJax finishes.

## Revalidation after merging main

#1055 merged, so the PR moved to base `main` and merged `583338dd`. Candidate `ac6fe928`. CI tested merge commit `fb358317` (parents `583338dd`, `ac6fe928`), run 42036550215, `Deploy: Lite` done 2026-11-05T14:15:25Z.

| Stage | Result on the merged candidate |
|---|---|
| Unit, affected specs | 89 tests, 5 files, pass |
| Storybook | `real-math-labels`: `mjx` 2, one same-origin `startup.js`. `real-external-icons-via-proxy` and `real-bundled-icons`: placeholder kept, no `startup.js`, no error display |
| Forge Tunnel, lite-dev page 111443969 | Dev bar `@ac6fe9`, 6 connections on port 8090, math typeset, control raw, PNG 23,437 bytes opened and correct. Port 8090 because another project's emulator held 8080 |
| Staging, lite-stg page 383386288, cold session | Bundle `index-Btt2Ri8l.js`. math=1 frame: `mjx` 2, all math files 200, no diagrams.net request. math=0 frame: placeholder kept, 0 math requests, raw `$$` text. PNG 10,069 bytes opened and correct |
