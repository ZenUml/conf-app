# PR #1181 evidence: zoom in the MCP view

- BEFORE: `fd70262b` (merge-base with `main`). Its `src/mcp-app-view.ts` and `mcp-app/view.html` are identical to `190ed78a`, whose build was used.
- AFTER: `4a2cdff5` (head of `feat/mcp-view-zoom` when captured)

## How it was captured

Same fake host as #1177 (`fake-host.html`): each side's `pnpm run build:mcp-app` output served next to `public/drawio/`, the page answering `ui/initialize` with `availableDisplayModes: ['inline', 'fullscreen']` and a 640px card, then delivering a fictional 10-participant sequence diagram. `?v=` picks the build. Viewport 1000x700, Chromium (Claude desktop browser pane). The wheel scroll is a real browser wheel event over the diagram, three ticks up, no modifier key.

## Observed

| Scenario | BEFORE | AFTER |
|---|---|---|
| Sequence, 640px card | Fitted at 0.562; fullscreen button only | Fitted at 0.562; toolbar: zoom out, 56% (back to fit), zoom in, fullscreen, in a strip above the diagram |
| Three wheel ticks up over the diagram | Scale stays 0.562 | Scale 0.971 (97%); view scrolls to keep the middle; host page did not scroll |

Also checked at `d949fc64` (same zoom code, before the plain-wheel change): buttons 56% → 97% in three steps; fullscreen fitted at 0.886 and zoomed to 128%; leaving fullscreen went back to 56%.

`after-unit.txt`: 82 tests in `src/mcp-app-view.spec.ts` and `functions/agent-link/viewEvent.spec.ts`, all passing at the AFTER commit.

## Limits

- Not tried in a real host. In claude.ai the wheel over a diagram will zoom it rather than scroll the chat; that is the requested behaviour.
- No drag-to-pan; a zoomed diagram is moved with scrollbars or trackpad.
- Keyboard (`+` `-` `0`) and pinch are covered by unit tests only.
