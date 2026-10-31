# Live check on Lite staging after merge, 2026-10-31 09:24 UTC

Build: `main` @ `c2a61377` (merge of PR 1027). The macro's debug toolbar shows `c2a613775bc1bb8` (`1-viewer.png`); deployed by `main` run 41187333592 (staging validation green).
Page: REST-created in `SD` (page `374472742`, custom content `374081401`), same synthetic source as `../lite-stg/seq.puml`, no attachment before the check.
Viewer: robot account; `localStorage.plantumlRenderer = 'local'` in every Forge frame before first load (the Lite staging flag was not changed).

| Check | Result |
|---|---|
| `plantuml.com` requests, page load + 40 s backup window (722 requests) | **0** |
| `plantuml.com` requests, Export PNG open + download (68 requests) | **0** |
| Backup `zenuml-374081401.png` | uploaded 09:25:00 by the viewer (POST then PUT), 1400×1741 (`backup.png`) |
| Export PNG download | 476×592 (`export-download.png`) = 2× the diagram |
| Export dialog | "238 × 296 Image size", 257% zoom, sharp (`2-export-modal.png`) |
| Mixpanel from the macro frames | `plantuml_png_produced` source `local` for `backup` (upscaled), `export_preview` and `export` (surface `fullscreen`) |

## The 238×296 download in the first run, explained

Calling the deployed `engine-*.js` chunk inside the macro frame on this source returns
`<svg … viewBox="0 0 238 296" width="238" height="296">`: the diagram's own size is 238×296.
(The harness's 119×148 was a different, smaller Alice/Bob diagram.)
`ExportWorkspace.vue` `imageLoaded` reports *Image size* as the preview's natural size **÷ 2**, because the DOM-capture preview is drawn at pixelRatio 2.
So with the 1× build, the label read 119×148 while the preview and download were 238×296, the diagram at 1×.
That download came from the new local path at 1×. Nothing doubled it, and no plantuml.com request was made.
With the 2× build the label and the file agree with the dialog's convention (label 238×296, file 476×592).
The same ÷2 label made a 1× server PNG look half its size before this PR.

One `plantuml_png_produced` `export` event was sent during page load, before any export click. Mixpanel keeps unsent events in the frame's localStorage, and the browser state was reused from the earlier run, so it is most likely that run's unsent event. This has not been proven.
