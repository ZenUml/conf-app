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

**Not yet confirmed against a real PDF export.** The hypothesis above and the
media-node-attrs mechanism are both plausible but unverified without a
staging deploy + `pdfimages -list` remeasurement — see the PR body for that
result, and for whether a `mediaSingle` `layout` other than `center` (`wide`,
`full-width`) is also needed if width/height alone doesn't move placement.

## Why the Forge function and not the Cloudflare Worker

`src/export.js` is the only consumer of the export ADF; the Cloudflare Worker
(`functions/`) has no involvement in generating it. conf-app's CLAUDE.md
requires rendering/export to keep zero dependency on the Cloudflare backend
being available when Confluence itself is reachable, so this stays entirely
inside the Forge function — no new endpoint, no new URL, no attachment write.
The Range request re-uses the exact same attachment `downloadLink` the
handler already resolves, so the image keeps the same access control the
page already has.
