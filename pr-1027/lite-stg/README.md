# Live check on Lite staging (lite-stg), 2026-10-31 02:56 UTC

Candidate: PR head `a00cbdcd`, deployed to Lite staging by the PR validation run (`Deploy: Lite / deploy`, 01:56–01:59 UTC).
The macro's debug toolbar shows build `80c169f` (`1-viewer.png`), which is GitHub's merge commit "Merge a00cbdcd into 99ddd184" (PR head onto `main`), the ref PR validation builds.
The macro iframe also emitted `plantuml_png_produced`, an event that exists only in this PR.

Page: REST-created in space `SD` (page `374145027`, custom content `374013962`), synthetic source `seq.puml`, no attachment before the check (never backed up).
Viewer: the robot account. Renderer: `localStorage.plantumlRenderer = 'local'` set by an init script in every `*.cdn.prod.atlassian-dev.net` frame **before first load** (the per-browser override in `src/utils/plantuml/renderer.ts`); the Forge flag on Lite staging was not changed.
Tool: `live-check.mjs` (Playwright, Chromium; `page.on('request')` sees every frame, including the out-of-process Forge iframes).

| Check | Result |
|---|---|
| Requests to `plantuml.com`, whole page load + 40 s view-time backup window (636 requests) | **0** |
| Requests to `plantuml.com` while opening Export PNG and downloading (65 requests) | **0** |
| Engine chunks loaded in the macro iframe | `engine-*.js`, `plantuml-*.js` |
| Backup attachment `zenuml-374013962.png` | uploaded 02:56:36 by the robot viewer, 1400×1741 (`backup.png`), comment `…|plantuml|itxt:v1` |
| Export PNG download | `untitled-diagram.png`, 238×296 (`export-download.png`) |
| Mixpanel from the macro | `plantuml_png_produced` {source `local`, purpose `backup`, upscaled `true`}; {source `local`, purpose `export_preview`} |

Not captured: the `purpose: export` event for the download (the download itself succeeded); the script stopped 3 s after it, likely before Mixpanel flushed.
The `Connecting to https://api.atlassian.com/... violates ... default-src 'self'` console lines are `info`-level notices from the Forge bridge's own requests and appear for every request; none concern plantuml.com.
The raw request log is not published: it contains short-lived media tokens.
