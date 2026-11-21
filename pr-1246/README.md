# PR 1246 evidence: Mermaid flowchart in-place edit

- BEFORE: `1320a9ea4` (`origin/main`, merge base of the branch).
- AFTER: `0acb03995` (`feat/mermaid-flowchart-inline-edit`).

## Storybook before / after (`storybook-before-*`, `storybook-after-*`)

- Story `Editor/Diagram/MermaidInlineEdit` → `TryByHand`, viewport 1400x700, Chrome for Testing through agent-browser.
- Same steps on both commits: replace the code with the four-line flowchart shown in the picture, double-click the `Start` node, press End, type ` order`, press Enter.
- BEFORE: no edit box opens; focus stays in the code pane.
- AFTER: an edit box opens on the node; the node resizes while typing; Enter writes `A[Start order]` to the source.

## Storybook, other cases (`storybook-bare-id-*`, `storybook-read-only-*`, `storybook-edge-*`)

Captured on the branch from the stories `FlowchartBareIdNode`, `FlowchartReadOnlyMix`, `FlowchartEditEdge`, `FlowchartEscCancels`.

## Forge tunnel (`tunnel-*`)

- Lite app, Forge `development` environment, a development Confluence site, 2026-11-21.
- Macro editor iframe served from `http://localhost:8000` (tunnel) with Vite source from the branch; the dark bar in the pictures shows the branch and commit.
- Steps: insert the Diagram macro, Mermaid tab, type a flowchart, double-click `Start`, type `Receive order`, Enter; double-click the `yes` edge label, type `in stock`, Enter.
- The small "Copy / Improve writing" bar in the pictures belongs to a browser extension in the test browser, not to the app.

## Limits

- Escape in the Forge editor was not verified. In the test browser the Escape key never reached the page (the same happened on the Storybook page in that browser: no `keydown` for Escape, then `focusout`), so the edit box closed as "click elsewhere" and committed. In a clean Chrome for Testing on the same Storybook story, Escape reached the page and the source stayed unchanged.
- Staging: not checked at the time of this capture.
