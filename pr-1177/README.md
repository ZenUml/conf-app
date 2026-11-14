# PR #1177 evidence: MCP view fit and fullscreen

- BEFORE: `11627c091e22dfabc4d12ff0ee79985ea1223e6f` (merge-base with `main`, includes PR #1176's sequence fit)
- AFTER: `190ed78a` (head of `feat/mcp-view-fit-fullscreen` when captured)

## How it was captured

Each side's view was built with `pnpm run build:mcp-app` and served next to `public/drawio/` by a static server. `fake-host.html` plays the MCP Apps host: it answers `ui/initialize` with a `hostContext` that lists `availableDisplayModes: ['inline', 'fullscreen']` and `containerDimensions` for the card, delivers a `ui/notifications/tool-result` with a fictional sample, follows `ui/notifications/size-changed`, and answers `ui/request-display-mode` by making the card fill the window and sending `ui/notifications/host-context-changed`. `?v=before` / `?v=after` picks the build. Viewport 1000x700, Chromium (Claude desktop browser pane).

## Observed

| Scenario | BEFORE | AFTER |
|---|---|---|
| Sequence, 10 participants, 640px card | Scaled to the width (PR #1176). No fullscreen button. | Scaled to the width by the shared fit (0.56). Fullscreen button top right. |
| Same, fullscreen pressed | No button; the view declares `inline` only. | Fills the window, fit to width and height (0.91). Esc returns inline. |
| Graph (draw.io, 951px wide), 400px card | Cut off after "HTTPS": the viewer's own auto-fit did not fit this card. | Whole diagram, scaled to 0.40. |
| Same, fullscreen pressed | No button. | Fills the window at 1.06. |

`after-unit.txt`: 70 tests in `src/mcp-app-view.spec.ts` and `functions/agent-link/viewEvent.spec.ts`, all passing at the AFTER commit.

## Limits

- The host is a fake. Whether claude.ai (or any real host) lists `fullscreen` in `availableDisplayModes` is not verified; where it does not, the button does not show.
- Mermaid and PlantUML were checked in the same page (Mermaid 1212px scaled to 0.32 in 400px; PlantUML left at its natural 113px) but not captured here.
- In a small card the button sits over the diagram's top-right corner.
