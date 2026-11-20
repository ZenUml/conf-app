# PR #1234 evidence: cached legacy Graph body

Baseline (BEFORE): `main` @ cfaca7461, as deployed on Lite staging (lite-stg), viewed as the robot test user.
Candidate (AFTER): bbdd0ecb0, served through a Forge tunnel on Lite development (lite-dev), viewed as the Forge owner account.

Fixture (fictional): one Graph custom content whose body is
`{"diagramType":"graph","compressed":true,"graphXml":"<LZUTF8 Base64 of a one-box mxGraphModel>","title":"compressed-swr-repro"}`,
referenced by two Graph macros on one page. Steps: load the page, then reload twice.

| Load | BEFORE (lite-stg, deployed main) | AFTER (tunnel, bbdd0ecb0) |
|---|---|---|
| 1 (fetch, cache primed) | no crash, painted | no crash, painted |
| 2 (cache hit) | `GraphViewer init failed: Not a diagram file` x2, then painted | `CRASH=0`, painted |
| 3 (cache hit) | same, 4 lines across both macros | `CRASH=0`, painted |

- `before-console-reload2.txt`, `before-console-reload3.txt`: the crash lines from the macro iframe console (agent-browser `console`).
- `before-staging-reload.png`: reload 2 on staging. The graph still paints because a second render runs after the crash; the visible difference is the crash, not the canvas. The "UPGRADE REQUIRED" overlay is the staging test space's Lite limit, unrelated.
- `after-tunnel-cached-reload.png`: reload with the cache entry present (`thisIdCached=true`). The yellow strip is a temporary, uncommitted console.error probe overlay (host, svg count, crash count). The dev bar shows the candidate branch and commit.

Limitation: the AFTER cache entry was shown on screen only on load 4; loads 2 and 3 also showed `CRASH=0`.

## CI-deployed staging (AFTER)

PR validation run 44704156725 deployed bbdd0ecb0 to Lite staging (deploy job finished 08:53Z 2026-11-20; no other staging deploy after it before the check). Same lite-stg page and content as BEFORE (page 420675956, content 421396670), robot test user, two reloads at ~09:05Z:

| Reload | Crash lines in console | Cache entry `zenuml:ccache:421396670` | Canvas |
|---|---|---|---|
| 1 | 0 | present, 422 chars, contains `compressed` | `<svg>` painted |
| 2 | 0 | same | painted (`after-staging-reload.png`) |

BEFORE on the same page and slot: 2 and 4 crash lines on reloads 2 and 3.
