# PR 1089 Forge Tunnel check

- Candidate: `c1765254` (`feat/title-first-diagram` with `main` at `d231e735` merged)
- UI source: `forge tunnel`, iframe host `localhost:8000`, Vite on 8080 from this worktree; dev bar shows the branch and `c17652`
- Site: `lite-dev`, Lite development environment, signed in as the Forge account, desktop Chrome
- Backend: shared `conf-stg-lite`, deployment built from this PR at `efd07db1` merged with `bed9f1f6`
- Fixtures: three pages with invented titles, drafts produced by `scripts/title-draft/batch.mjs --env staging`

One uncommitted test-only line removed the `entryFlag`, `lookup`, `notNow` and `firstNotNow` localStorage keys on each load, so a single day could exercise every path. It was reverted before the push. The 24 h cap and lookup cache were therefore not exercised here; unit tests cover them.

| File | Observed |
|---|---|
| `v5-1-entry-flag.jpg` | Entry flag copy, See diagram, Not now |
| `v5-2-panel.jpg` | Preview, `Based on the page title`, note left of Add to page |
| `v5-3-added.jpg` | Macro first on the page, success flag |
| `undo.jpg` | After Undo: macro and page property removed |
| `v5-4-not-now.jpg` | Not now confirmation copy with `Diagrams Lite` |
| `edit-diagram.jpg` | Edit diagram opens the existing editor with the Mermaid source |
| `macro-page-no-flag.jpg` | Reload of a page with the macro: no entry flag |

REST read after Add: first ADF node is the Lite macro extension, page property `zenuml-title-draft-lite` has `state: added`. After Undo: no extension node, no property.

Not exercised through the tunnel: guest and anonymous viewers, a viewer who cannot edit, two viewers racing to add.
