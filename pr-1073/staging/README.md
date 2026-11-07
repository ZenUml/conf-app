# PR #1073 — CI-deployed staging checks (lite-stg)

Site: lite-stg.atlassian.net (Lite staging app "Diagram (Mermaid, PlantUML & ZenUML) Lite (Staging)").
Deployed by the PR validation pipeline (`workflow_dispatch` with `pr-number=1073`), never from a local shell.
Browser: the author's Chrome via Claude in Chrome (screenshots by pixel; Forge iframes are not DOM-inspectable with it).
Test page: "PR1073 MCP promo check 20261107" (SD space), one sequence macro created via the ZenUML staging MCP.

## Round 1 — `826e9602`, run 42318524207 (deploy 01:06:29Z, its E2E validation passed)

| Check | Result | Evidence |
|---|---|---|
| Inline header keeps the MCP button (everyone) | PASS | `stg-826e9602-inline-header.jpg` |
| Fullscreen: header MCP button + bottom-left promo card | PASS | `stg-826e9602-fullscreen-card.jpg` |
| Fullscreen card CTA opens Connect MCP with cloudId/pageId/contentId; card hides | PASS | `stg-826e9602-fullscreen-dialog.jpg` |
| Editor, saved diagram: no new-diagram card; tip after ~400 typed chars | PASS | `stg-826e9602-editor-tip.jpg` |
| Editor tip CTA → dialog prompt carries cloudId/pageId | **FAIL** — prompt says "Find the site with list_sites", no cloudId/pageId; overlay does not dim the code pane | `stg-826e9602-editor-tip-dialog-BUG-no-cloudid.jpg` |
| New macro: "Start from your code" card | **FAIL** — shows over the auto-opened Starter templates gallery | `stg-826e9602-new-diagram-BUG-over-gallery.jpg` |
| New-diagram CTA → draft-and-paste prompt | PASS (content) / same cloudId/pageId bug | `stg-826e9602-new-diagram-dialog.jpg` |

Nothing was published: the edited diagram and the inserted macro were closed without Publish.

Fixes in `4ba92aa4`: reactive prompt scope (regression tests fail on the old code), card hidden while the
Starter gallery is open (Header emits its visibility), dialog on its own stacking layer in the editor.
