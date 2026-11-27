# Fullscreen toolbar strip: evidence

- **BEFORE:** the view built from `897e98e9c` (#1333's first head; same `view.html` and `zoom()` as `11d27e66e` main).
- **AFTER:** `781527edf` (fix/mcp-view-fullscreen-toolbar-strip).
- **Harness:** `host-harness.html`, a throwaway local host. It frames `mcp-app/view.html` from `dist/` at 664×620, answers `ui/initialize` with `displayMode` (`?mode=fullscreen` or `inline`) and `containerDimensions`, and sends a 4-message ZenUML sequence as the tool result. Served with `python3 -m http.server`; driven in Chromium (Claude desktop's browser pane). Screenshots are scaled by the pane (about 0.78).
- **Steps:** load fullscreen (fit 192%), click zoom-in once (230%).

| | Measured after one zoom-in |
|---|---|
| BEFORE | page `scrollTop` 50; drawing top at −8 px; toolbar spans 6–38 px, so it covers the top edge (`before-230pct.png`) |
| AFTER | page doesn't scroll (`scrollTop` 0, not scrollable); `#app` `scrollTop` 50; `#app` top at 42 px, below the toolbar's bottom at 38 (`after-230pct.png`) |
| Inline, AFTER (3 zoom-ins) | unchanged from BEFORE: frame 553 px, drawing top 42, toolbar bottom 38, page `scrollTop` 0 |

Same overlap as seen in claude.ai on 2026-11-27 (`pr-1333/fullscreen-wheel-zooms.png`).
Not checked: documents (Markdown, OpenAPI) in fullscreen with the new scroll box, and the fix in claude.ai itself.
