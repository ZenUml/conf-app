# PR 1214 evidence: wheel zoom

BEFORE: origin/main 28b96450. AFTER: branch claude/p1-wheel-zoom-32a4bb 1f4c712d.

| File | Source | Steps |
|---|---|---|
| before-main-*-fullscreen-plain-wheel-up-x6.png | Storybook `Viewer/ViewportWheel` on main (story file copied in) | 6 WheelEvents deltaY -100 dispatched at (560,200), headless Chromium via agent-browser |
| mermaid/graph-fullscreen-1-open.png, -2-*.png | Same story on the branch | same 6 events |
| tunnel-mermaid-fullscreen-*.jpg | Forge tunnel, internal dev site, Lite variant, real Chrome as the Forge account | 3 real wheel ticks up over the diagram in the Fullscreen modal |

Mermaid stories: viewport 1280x380, so the diagram opens below natural size. Graph: 1280x800.

Limits: agent-browser sends wheel input at (0,0) whatever the mouse position, so Storybook captures use dispatched WheelEvents. Real wheel input was checked in the Claude built-in browser (Storybook) and real Chrome (tunnel). Real trackpad pinch and Safari were not tested.

## Staging (lite-stg, CI deploy of c13922d6)

stg-editor-tall*.png: macro editor on a new unpublished draft page, robot test account, Lite. A 25-node Mermaid flowchart opens at scale 0.116; 4 dispatched plain wheel-ups over the preview give 0.173, all prevented. Shift-wheel prevented (pan). Editor iframe document scrollTop stayed 0 (document scrollHeight 660, innerHeight 507).
