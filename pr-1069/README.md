# PR #1069 evidence: saved refusal titles

- BEFORE baseline: `main` at `af7c948d` (merge-base of the PR).
- AFTER candidate: `fix/saved-refusal-title` at `539f822c`.
- Variant: Lite.
- All refusal strings shown are synthetic. They come from the spec fixtures in `src/lib/aiTitleGuard.spec.ts` and the new stories. No stored customer title appears here.

## 1. Storybook (local, Chrome, 800x600 pane)

Stories: `Viewer/GenericViewer` → "Saved refusal title — shows Untitled diagram" and
`Editor/Diagram/DiagramTitleInput` → "Saved Refusal Title".

BEFORE: the two new stories rendered with `GenericViewer.vue` and `DiagramTitleInput.vue`
temporarily restored to their `main` version (the stories exist only on the branch).
AFTER: the same stories at `539f822c`.

| Story | BEFORE | AFTER |
|---|---|---|
| Viewer header | `before-viewer.jpg`: header shows the refusal text | `after-viewer.jpg`: header shows `Untitled diagram`, play PASS |
| Editor title input | `before-editor.jpg`: field keeps the refusal text, play FAIL | `after-editor.jpg`: field emptied, then auto-title (fetch mocked) fills `Payment Flow Sequence`, play PASS |

The BEFORE viewer play also shows an unrelated `header actions not yet revealed` failure from
`revealHeader()` hover in the pane; the AFTER story does not use that helper.

## 2. Forge tunnel (lite-dev, development environment)

- Site: `lite-dev.atlassian.net` (internal test site), `forge tunnel` + Vite from this worktree.
- Identity: the Forge account that owns the tunnel (tunnel is identity-gated).
- Fixture: throwaway page 111771649 with one Mermaid macro (custom content 111443991) and one
  Graph macro (111804417). Both titles were set to synthetic refusal strings through the
  Confluence v2 custom-content API (version 2).
- Dev bar on both macros: `fix/saved-refus…@539f82…`.
- AFTER only. No tunnel BEFORE was captured.

| Step | Observed |
|---|---|
| View page | `tunnel-viewer.jpg`, `tunnel-graph-viewer.jpg`: both macro headers show `Untitled diagram` |
| Open Mermaid editor | `tunnel-mermaid-editor.jpg`: title field empty (placeholder `Untitled diagram`) |
| Open Graph editor | `tunnel-graph-editor.jpg`, `tunnel-graph-title-zoom.png`: TITLE field empty (placeholder `Name your graph…`) |
| Close both editors without Publish, then read both custom contents | both still version 2 with the original synthetic title: opening an editor does not write |

Live auto-title did not refill the Mermaid field within 5 s; only "field emptied" is claimed for the tunnel.

## 3. Not verified

- CI-deployed staging (lite-stg): pending the PR CI deploy.
- Full / Diagramly variants: same code path, not run live.
