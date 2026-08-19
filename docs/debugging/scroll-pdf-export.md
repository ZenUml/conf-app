# Scroll PDF Exporter drops ZenUML diagrams — reproduction and cause

Reproduced 2026-08-19 on lite-stg. Source: a customer report received 2026-08-18.

## Reproduction

1. Scroll PDF Exporter 7.0.0 (K15t) installed on lite-stg (30-day trial, started by support@zenuml.com).
2. Test page created via `create-test-page` skill:
   https://lite-stg.atlassian.net/wiki/spaces/SD/pages/219807748 — one sequence macro,
   customContentId 220758017.
3. Page opened once, so the viewer wrote both attachments:
   `zenuml-220758017.png` (fileId 56829145-ddb8-4777-9876-3e8646725885) and `zenuml-220758017.json`.
4. Page ... > Apps > "Export with Scroll PDF Exporter" > template Documentation > Export.

## Result

Dialog: "Export finished with issues". Issue report, single row:

| Issue | Origin | Explanation |
|---|---|---|
| URL not found | `https://lite-stg.atlassian.net/wiki/rest/api/content/219807748/child/attachment/att220889089/download` | A resource with this URL could not be found. |

Downloaded PDF (14,181 bytes) contains the page title and body text and **zero images**
(`/Image` and `/XObject` counts are 0). Native Confluence PDF export of the same page renders
the diagram.

## Cause

`src/export.js` `createMediaDocument()` returns

```json
{"type":"media","attrs":{"type":"external","url":"<base><attachment.downloadLink>"}}
```

That URL is the Confluence attachment download endpoint and needs a Confluence session. The
Scroll renderer fetches it from outside the page context and receives 404. Confluence's own
export pipeline resolves it, which is why native export works.

K15t's developer page states the same constraint for both Connect and Forge apps:
"If images from external sources (not the Confluence instance) are referenced, they must either
be publicly available without any authentication, or the image link must contain authentication
data (e.g. temporary access tokens)."
https://help.k15t.com/scroll-pdf-exporter/6.3/cloud/make-your-app-s-macros-display-properly-in-exports

The same page puts the "pdf and word render modes are not usable by 3rd party apps" restriction
under **Connect apps** only. The Forge requirement is the `adfExport` function, which manifest.yml
declares for every ZenUML macro (`exportMacro` / `asyncApiExportMacro`). The integration is present
and runs — Mixpanel records `macro_export_succeeded` for the Scroll invocations (format `email`).

**Event semantics:** `macro_export_succeeded` means the handler returned an ADF document. It does
not mean the diagram appeared in the output. This reproduction fired `macro_export_succeeded`
while the PDF contained no image. Do not read export success rates as diagram delivery rates.

## Fix options

1. Return a native Confluence media node — `{"type":"media","attrs":{"type":"file","id":"<fileId>",
   "collection":"contentId-<pageId>"}}`. The exporter resolves it with its own credentials. No public
   URL, no new endpoint, no change to access control. `fileId` is already in the v2 attachments
   response the handler reads. Unverified: whether the Scroll renderer resolves file media nodes.
2. Inline the PNG as a data URI. No external fetch. Unverified: ADF support for data URIs; response
   size against the 30-second render timeout Atlassian imposes on the REST API Scroll uses.
3. Short-lived signed URL from the Cloudflare backend. Adds an exposure window and log surface —
   evaluate separately, only if 1 and 2 fail.
