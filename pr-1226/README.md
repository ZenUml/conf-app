# PR 1226 evidence — Clarity replay

Candidate: feat/clarity-replay @ 1e48efef (Vite served the branch through `forge tunnel`, dev bar shows `feat/clarity-re…`).
Site: lite-dev (own dev site), environment DEVELOPMENT, flag `clarity-replay-enabled` on for dev+staging.
Viewer: Forge account in real Chrome. Worker: stats.zenuml.com version 41b66d3e.

| Iframe | Outcome (temporary debug ping, removed before commit) |
|---|---|
| Inline viewer | skipped_surface |
| Fullscreen | started |
| Editor | started (geo answer from sessionStorage cache) |

Worker tail: 2 GET /clarity/allow (200, AU), 11 POST /clarity/collect (204 from s.clarity.ms), origin http://localhost:8000.

Screenshots:
- `tunnel-editor-unmasked-source.jpg` — the editor as the user sees it.
- `clarity-editor-replay-masked.jpg`, `-zoom.png` — the same session in Clarity live replay: source, title, tabs, toolbar and SVG labels are masked dots.

Limitation: local run needed `.env.mixpanel`; with an empty Mixpanel token `_initMixpanel` stops before Clarity starts.
