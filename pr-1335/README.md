# PR #1335 evidence: fullscreen drawing scrolls below the toolbar strip

- **BEFORE:** main `11d27e66e`. In claude.ai at 230% the toolbar sat on the drawing's top edge (`pr-1333/fullscreen-wheel-zooms.png`).
- **AFTER:** `781527edf`.

## Local host harness (`host-harness.html`, 664×620 fullscreen, Chromium)
| | One zoom-in past the fit (192% → 230%) |
|---|---|
| BEFORE (`before-230pct.png`) | page `scrollTop` 50; drawing top at −8 px under a toolbar spanning 6–38 px |
| AFTER (`after-230pct.png`) | page doesn't scroll; `#app` `scrollTop` 50; `#app` top 42 px, below the toolbar (bottom 38) |
| Inline AFTER | unchanged (frame 553 px, drawing top 42, toolbar bottom 38) |

## claude.ai (PR preview `conf-stg-lite-pr.zenuml.com`, bundle `view-DjNJr0Bw.js`, 2026-11-27 09:58 UTC)
ZenUML sequence, 4 messages, claude.ai's fullscreen side pane. Fit 191%, then + once to 230%.
| File | What it shows |
|---|---|
| `claudeai-230pct-top.png` | Scrolled to the top: the toolbar is in an empty strip, and the drawing's top border starts below it. |
| `claudeai-230pct-scrolled.png` | After Page Down: the drawing has scrolled up under the strip; nothing shows behind or beside the toolbar. |

Cropped to the side pane.

Limits:
- Scrolled with the keyboard. In fullscreen a plain wheel zooms (#1333), so a mouse scrolls only with the scrollbar, the keys or a drag.
- Right after the + click the drawing's top border was scrolled out of view, because zoom keeps the middle in place. That is expected.
- OpenAPI in fullscreen wasn't checked.
