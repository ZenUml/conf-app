# Export Pipeline

How ZenUML diagrams are included when a Confluence page is exported to Word or PDF.

---

## Overview

The pipeline has two independent halves that must both complete for an export to succeed:

1. **Attachment upload (frontend)** — when a user views a page, the viewer renders the diagram and uploads a PNG to Confluence as an attachment.
2. **Export handler (backend)** — when a user exports a page to Word/PDF, Forge calls the export handler, which fetches that pre-uploaded PNG and embeds it in the document.

The two halves communicate through a Confluence attachment named `zenuml-<customContentId>.png`. If the attachment does not exist when the export handler runs, the export fails.

---

## Half 1 — Attachment upload (frontend)

**Entry points** (`src/forgeIndex.ts`, `src/forge-graph-viewer.ts`, `src/forge-embed-viewer.ts`):

Each viewer entry point listens for the `diagramLoaded` event fired after the diagram renders, then calls:

```
createAttachmentIfContentChanged(content, diagramType)  // src/model/Attachment.ts
```

**What it does:**

1. Computes MD5 hash of the current diagram source.
2. Checks if a PNG attachment already exists for this macro (`zenuml-<customContentId>.png`).
3. Compares the stored hash (in the attachment's `comment` field) to the current hash.
4. If changed or absent: uploads a new version of the PNG.
5. If unchanged: skips the upload (steady-state for an unedited diagram).

**Guards:**

- **Concurrent uploads** — `window.createAttachmentInProgress` flag prevents duplicate uploads when multiple `diagramLoaded` events fire simultaneously (e.g. after a page edit). Emits `attachment_upload_skipped` (`event_label: concurrent`).
- **Draft pages** — skips upload if `forgeContext.extension.content.status === 'draft'`. The v1 attachment API rejects draft pages. Emits `attachment_upload_skipped` (`event_label: draft_page`).
- **Unchanged content** — skips upload if hash matches. Emits `attachment_upload_skipped` (`event_label: unchanged`).

**Analytics events emitted:**

| Event | When |
|---|---|
| `upload_attachment` | Upload succeeded (new or updated) |
| `attachment_upload_skipped` | Skipped (concurrent / unchanged / draft_page) |
| `attachment_upload_failed` | Upload threw an error |

All carry join keys `(page_id, custom_content_id, cloud_id)` so they can be correlated with backend export events.

---

## Half 2 — Export handler (backend)

**Source:** `src/export.js`
**Forge trigger:** `adfExport` function (`exportMacro`) — wired to all four macro module types in `manifest.yml`.

Confluence calls this handler synchronously when a user exports a page. It must return an ADF (Atlassian Document Format) node synchronously; the returned node is embedded in the Word/PDF output.

**Flow:**

```
Confluence export triggered
  → extractExportContext(payload)          // detect format, extract pageId + customContentId
  → trackExportEvent('macro_export_requested')
  → if !customContentId → fail 'missing_custom_content_id'
  → api.asApp().requestConfluence(
      /wiki/api/v2/pages/{pageId}/attachments?filename=zenuml-{customContentId}.png
    )
  → if 404: retry with api.asUser() (fallback for restricted pages)
  → if still not ok → fail 'attachments_api_{status}'
  → if results empty → fail 'attachment_not_found'
  → return createMediaDocument(attachment.downloadLink)   // success
  → catch (unhandled error) → fail 'unexpected_error:{name}'
```

**Format detection** (from payload shape, not a declared field):

```js
const format = payload.exportType           // email, other, etc. — when Confluence sets it
  ?? (payload.context?.content?.id || payload.context?.contentId
      ? 'word'                              // Word: contentId at top level
      : 'pdf');                             // PDF: contentId nested under extension
```

**asApp() → asUser() fallback** (added in issue #74):
`asApp()` returns 404 for pages the app principal cannot read (space restrictions, page restrictions). The handler retries with `asUser()`, which carries the exporting user's permissions. Both attempts are tracked in analytics via `used_asuser_fallback` / `fallback_http_status`.

**Analytics events emitted:**

| Event | When | Key properties |
|---|---|---|
| `macro_export_requested` | Every export invocation | join keys + format |
| `macro_export_succeeded` | PNG found and returned | join keys + format, `used_asuser_fallback` |
| `macro_export_failed` | Any failure path | join keys + `failure_reason`, `http_status`, error fields |

**failure_reason values:**

| Value | Cause |
|---|---|
| `attachment_not_found` | PNG exists nowhere — viewer never ran for this macro |
| `attachments_api_404` | Page not accessible even with asUser() fallback |
| `attachments_api_429` | Rate-limited by Confluence attachments API |
| `needs_authentication` | 401/403 — auth/permission issue |
| `missing_custom_content_id` | Macro config missing `customContentId` (corrupt install) |
| `unexpected_error:{name}` | Unhandled exception — includes `email`/`other` format types |

---

## Join keys

Both halves emit the same three join keys, enabling left-join analysis in Mixpanel or any SQL tool:

| Key | Property name | Where it comes from |
|---|---|---|
| Macro instance | `custom_content_id` | Forge macro config (`customContentId`) |
| Page | `page_id` | Confluence content ID |
| Site | `cloud_id` | Forge context `cloudId` |

Query pattern: find `macro_export_failed` events and join to `attachment_upload_*` events on `(cloud_id, custom_content_id, page_id)` to determine whether the PNG upload ran at all, was skipped, or failed before the export was attempted.

> **Availability:** Join keys were added in PR #84 (merged 2026-05-14). Events before that date do not carry `custom_content_id` or `page_id` on upload events.

---

## Failure modes and mitigations

### attachment_not_found — 65% of failures

**Cause A — Race condition:** Export triggered before the viewer finishes uploading the PNG (seconds-level window). Confirmed by same-session recoveries with avg time ~9 min; some recover in < 10 seconds.

*Mitigation:* Add retry-with-backoff in the export handler before emitting failure (3 × 2s covers most race-condition windows with no user action required).

**Cause B — Viewer never ran:** The macro exists but nobody has opened the containing Confluence page in a browser. No PNG was ever uploaded. Common for pages that are only ever exported (e.g. documentation batch exports, "Send by email" workflows).

*Mitigation (immediate):* Ask affected users to open each page in a browser; one view triggers the upload. *Long-term:* Server-side PNG rendering during export — eliminates dependency on the client viewer.

### unexpected_error for email / other formats — known bug

Confluence calls the export handler for `email` (Send page by email) and `other` (third-party integrations) format types. The handler's format-detection logic only accounts for `word` and `pdf`; unrecognised formats fall into the main try block and can throw depending on payload shape.

*Fix:* Check `format` early in the handler and return a no-op ADF document for unsupported format types rather than attempting the attachment lookup.

### attachments_api_404 — page access issues

`asApp()` cannot read the page (space or page restriction), and `asUser()` also fails. Either the exporting user lacks read permission, or the page is in a restricted space the app principal cannot access.

---

## Key source files

| File | Role |
|---|---|
| `src/export.js` | Backend export handler — full pipeline |
| `src/model/Attachment.ts` | Frontend attachment upload — `createAttachmentIfContentChanged` |
| `src/forgeIndex.ts` | ZenUML / Mermaid viewer entry — wires `diagramLoaded` → upload |
| `src/forge-graph-viewer.ts` | Graph (DrawIO) viewer entry — wires render complete → upload |
| `src/forge-embed-viewer.ts` | Embed viewer entry — wires render complete → upload |
| `manifest.yml` | Wires `adfExport` trigger to `exportMacro` function for all macro types |

---

## Related docs

- `docs/analytics-events-flow.md` — full Mixpanel event catalog
- `docs/upgrade-tracking-event-reference.md` — paywall event reference
- `.claude/skills/paywall/references/macro-export-failed.md` — investigation findings (2026-05-15)
