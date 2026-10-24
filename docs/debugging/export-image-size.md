# Exported diagrams render too small — placement-width investigation

2026-08-19. Follow-on to `docs/debugging/scroll-pdf-export.md` (PR #510), which
fixed Scroll PDF Exporter dropping the diagram entirely by switching the
export ADF from an external-URL media node to a native `type: "file"` node.
That fix changed how the image is placed in the exported document; this note
covers the resulting size regression and the fix in this PR.

## Root cause (read the code + measured, PR #510's own numbers)

The **old** export ADF used `{"type": "media", "attrs": {"type": "external",
"url": <download link>}}`. Confluence's PDF/Word renderer scales an
`external`-type media node to the content column width and does not read the
image's own pixel size — this is why the old export always looked right on
export, blank stored-PNG margins and all: the image was blown up to fill the
column (measured 6.68in on a page still running the old code).

The **new** `type: "file"` node is sized from the media file's own metadata
instead of the column width. Measured on lite-stg page 219807748 (PR #510's
own table, `docs/debugging/scroll-pdf-export.md`):

| Export ADF | Embedded image | Placed width |
|---|---|---|
| file node, no width attrs | 944 x 372 @ 533 ppi | 1.77 in |
| file node, `mediaSingle` `width: 100` + `widthType: percentage` | 1516 x 598 @ 282 ppi | 5.38 in |
| file node, `mediaSingle` `width: 760` + `widthType: pixel` | 1516 x 598 @ 282 ppi | 5.38 in |

None of those reach the old 6.68in. The percentage/pixel rows are NOT a
controlled test of "does the width hint matter" — 100% of a 760px-wide
content column *is* 760px, so both rows declared the same effective width and
necessarily produced the same result; PR #510's "the unit makes no
difference" conclusion is unsupported by that pair.

**What the numbers do support**, read as an underlying linear relationship
between the declared/embedded pixel width and printed inches:
`5.38 / 6.68 ≈ 0.805` and `760 / 944 ≈ 0.805` — consistent with a roughly
constant placement DPI (~141 px/in) once a width is declared at all, and with
944px (the renderer's own no-hint embedding, i.e. its apparent content-column
ceiling) as the width that would reproduce the old 6.68in. This is a
**hypothesis**, not a confirmed mechanism — the only controlled variable
across the three rows above is "width hint present or absent", not "which
width value".

## Fix in this PR

Declare the export PNG's own intrinsic `width`/`height` (pixels) directly on
the ADF **media** node, in addition to `mediaSingle`'s width hint — the
ADF-documented way to give a file-type media node a natural size, and
untested by PR #510 (which only varied `mediaSingle`'s attrs). Read without a
full download: a byte-Range request for the first 32 bytes of the attachment
is enough to cover the PNG signature + IHDR chunk (`src/lib/pngDimensions.js`
`readPngDimensions`), so this costs one small extra request per export, not a
full re-download of the image.

Implementation: `src/export.js` `fetchPngDimensions` (Range-request + parse,
never throws — a failure degrades to the pre-existing mediaSingle-only
760px hint, tracked via `media_width_px: null` on the `macro_export_succeeded`
event) and `createMediaDocument` (declares `width`/`height` on the media node
attrs when known, and mirrors the same pixel value into `mediaSingle`).

## Verified on lite-stg, 2026-08-19 (after this PR's staging deploy)

Confirmed: declaring `width`/`height` on the media node (not just `mediaSingle`)
is the mechanism. Real PDF export via Scroll PDF Exporter, measured with
`pdfimages -list`, across 3 page sizes × 5 macro types (15 combinations —
sequence, mermaid, plantuml, graph, openapi; AsyncAPI uses a separate handler,
`src/asyncapi-export.js`, that embeds the raw spec as text and never produces a
PNG attachment, so it is unaffected and out of scope):

| Page | Macro | Embedded image | Placed width | Present, uncropped |
|---|---|---|---|---|
| small | sequence | 1468x454 @ 233 ppi | 6.30 in | yes |
| small | mermaid | 1468x438 @ 233 ppi | 6.30 in | yes |
| small | plantuml | 95x129 @ 15 ppi | 6.33 in | yes (upscaled, see caveat) |
| small | graph | 1468x300 @ 233 ppi | 6.30 in | yes |
| small | openapi | 1468x896 @ 233 ppi | 6.30 in | yes |
| medium | sequence | 1468x710 @ 233 ppi | 6.30 in | yes |
| medium | mermaid | 1468x710 @ 233 ppi | 6.30 in | yes |
| medium | plantuml | 319x246 @ 51 ppi | 6.25 in | yes |
| medium | graph | 1468x300 @ 233 ppi | 6.30 in | yes |
| medium | openapi | 1468x896 @ 233 ppi | 6.30 in | yes |
| wide | sequence | 1468x496 @ 233 ppi | 6.30 in | yes |
| wide | mermaid | 1468x432 @ 233 ppi | 6.30 in | yes |
| wide | plantuml | 936x217 @ 149 ppi | 6.28 in | yes |
| wide | graph | 1468x300 @ 233 ppi | 6.30 in | yes |
| wide | openapi | 1468x896 @ 233 ppi | 6.30 in | yes |

Every combination places at 6.25–6.33in — within 6% of the pre-#510 baseline
(6.68in) and a large recovery from PR #510's 5.38in regression. `pdfimages`
placement is computed from the page's image-transform matrix, so this is the
real on-page size, not a proxy.

**Two things this did NOT fix, both explicitly out of scope for this PR**
(read the code, watched it run):

1. **Blank margins.** The `zenuml-<ccId>.png` source attachment itself is
   wider than its own ink (root cause: `GenericViewer.vue`'s
   `.screen-capture-content.w-full { width: 100% }`, unrelated to this PR).
   This fix
   restores the image to FULL COLUMN WIDTH, reproducing the pre-#510 visual
   result exactly (blank margin included) — confirmed visually: the small
   page's sequence/mermaid diagrams occupy roughly the left 45% of their own
   placed image, the rest is blank canvas, invisible against the white page.
   This is the SAME behavior the old `external`-type node produced (it never
   looked broken because nobody compared it against the diagram's own ink).
2. **Tiny-source upscaling.** `plantuml.com`-rendered diagrams are captured
   at their own small natural size (no blank margin — see the small page's
   95x129 plantuml image above), so forcing them to placed-width parity with
   the other macro types upscales a 95px-wide source to ~1468 CSS px
   equivalent, producing a visibly blurry/pixelated PDF image (watched it
   run: the rendered PDF page for the medium page's plantuml macro shows a
   visibly pixelated, upscaled render). Correct only in
   the "fills the column, not cut off" sense the acceptance test checks —
   not in print quality.

One content-authoring caveat: the OpenAPI fixture's custom spec (`Small/
Medium/Wide API`, different endpoint counts) never rendered — all three
`openapi` custom-content bodies fell back to the swagger-ui built-in "Sample
API" example (confirmed: all three PNGs are byte-identical, 101566 bytes).
The placement mechanism was still exercised (same media-node code path,
independent of spec content), so this does not affect the sizing conclusion,
but the "small/medium/wide" OpenAPI rows above did not actually vary in
rendered content — root cause of the fixture not loading is uninvestigated.

## Why the Forge function and not the Cloudflare Worker

`src/export.js` is the only consumer of the export ADF; the Cloudflare Worker
(`functions/`) has no involvement in generating it. conf-app's CLAUDE.md
requires rendering/export to keep zero dependency on the Cloudflare backend
being available when Confluence itself is reachable, so this stays entirely
inside the Forge function — no new endpoint, no new URL, no attachment write.
The Range request re-uses the exact same attachment `downloadLink` the
handler already resolves, so the image keeps the same access control the
page already has.
