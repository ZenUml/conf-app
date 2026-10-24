# Debug bundle download — design

**Status:** Design approved 2026-05-20; implementation not yet planned.
**Owner:** TBD
**Created:** 2026-05-20
**Repo:** `ZenUml/conf-app`

---

## 1. Problem

When a customer reports a hard-to-reproduce issue with a diagram macro — the canonical example being the empty-wipe data-loss incident (see `private/research/2026-05-17-graph-empty-wipe-data-loss-fix.md`) — we have limited evidence to diagnose what happened. The §6.1–6.3 fix in that research spec prevents that specific class of wipe and adds two new instrumented events (`empty_content_loaded`, `empty_save_blocked`), but it only covers wipes we already know about. For the next unknown-unknown class of incident, we want a way for any user — customer or support engineer — to capture the macro's current state and recent saved versions in one click and send the resulting file to us.

Today's gaps the bundle fills:
- `view_macro` (now `macro_viewed`) is missing `custom_content_id` on every event we've inspected — we cannot join Mixpanel back to specific affected diagrams without contortions.
- The customer's editor state at the moment of the bug isn't captured anywhere.
- Prior customContent versions exist in the V2 API but require cross-tenant Forge auth from a developer machine to retrieve — out of reach during an active support conversation.

The existing `Debug/` component (`src/components/Debug/DebugBar.vue`) is internal-only — gated by `localStorage.zenumlDebug` or running outside the Confluence iframe. It does not address customer-facing diagnostic capture.

## 2. Goal in one sentence

Add a customer-facing "Download debug info" action behind an overflow menu in the macro viewer that produces a self-contained JSON bundle of identity + current editor content + the latest and previous three saved customContent versions, which the user shares manually with ZenUML support.

## 3. Decisions made during brainstorming

| Question | Decision |
|---|---|
| Audience | Customer-facing, always available. |
| Visibility | Behind a 2nd-level menu — NOT inline on the viewer chrome. |
| Scope | All 4 macro types (sequence, mermaid, graph, openapi). |
| Bundle contents | L1 (identity + current editor content) + L2 (latest + previous 3 saved versions). Local drafts, log buffer, and feature-flag state are out of scope. |
| Transport | Download a JSON file. User shares manually (email / Slack / ticket attachment). No backend upload. |
| Placement | Inline-viewer overflow menu AND fullscreen-viewer overflow menu. |
| Disclosure UX | One-click — no confirm modal, no preview pane. The file is the user's own data. |
| Architecture | Service module of pure functions + thin Vue composable. |

## 4. UI surface

`GenericViewer.vue` exposes a flat pill toolbar at the bottom of the viewer (`viewer-edge-bottom-pill`) with Copy code / Export PNG / Versions / Copy link. There is no overflow menu today. Fullscreen reuses the same component, so one menu serves both contexts.

Plan:
- Add a new icon button (`⋯`) as the **last** item in `viewer-edge-bottom-pill`. Tooltip: "More". Same `viewer-pill-btn` styling as the other pill buttons.
- Clicking it opens a popover anchored above the button. Add a focused `OverflowMenu.vue` in `src/components/Viewer/` because no existing menu primitive exists in this codebase. Plain Vue with a click-outside listener and `Esc` to close — no new dependency.
- The popover renders one entry today: **"Download debug info"** (icon: bug or download). The popover has a `<slot>` so future overflow entries can be added — but we do not pre-populate other actions.
- Clicking "Download debug info" triggers the bundle assembly and download immediately. No confirm modal.
- Fallback for the rare case where the inline viewer chrome is itself broken: the same `⋯` is reachable in fullscreen because the pill toolbar is shared. If both surfaces are broken, the documented out-of-band path is `localStorage.zenumlDebug = "1"` + reload, which surfaces the existing internal `DebugBar` for identity triage. We do not build new UI for this last-resort path.

Files affected for the UI:
- `src/components/Viewer/GenericViewer.vue` — add the new pill button and mount `OverflowMenu`.
- `src/components/Viewer/OverflowMenu.vue` (new) — popover primitive.

## 5. Bundle schema (v1)

JSON file with two top-level groups and a small `errors` array:

```jsonc
{
  "bundleVersion": 1,
  "capturedAt": "2026-05-20T08:12:33.142Z",

  "identity": {
    "cloudId": "...",
    "hostname": "example.atlassian.net",
    "clientDomain": "example",
    "pageId": "...",
    "customContentId": "...",
    "macroUuid": "...",
    "diagramType": "graph",            // "graph" | "mermaid" | "sequence" | "openapi"
    "productType": "lite",             // "lite" | "full" | "diagramly"
    "environmentType": "PRODUCTION",   // from forgeGlobal.forgeContext.environmentType
    "appVersion": {
      "gitHash":   "<VITE_APP_GIT_HASH>",
      "gitBranch": "<VITE_APP_GIT_BRANCH>",
      "gitTag":    "<VITE_APP_GIT_TAG>"
    },
    "userAgent": "Mozilla/5.0 ...",
    "viewport":  { "w": 1920, "h": 1080 }
  },

  "editor": {
    "active":     "<full code/XML/dsl currently in the editor or viewer>",
    "byteLength": 1234,
    "sha256":     "<hex>"
  },

  "saved": {
    "latest":   { "versionNumber": 5, "createdAt": "...", "body": { /* raw V2 body */ }, "active": "...", "byteLength": 1234, "sha256": "..." },
    "previous": [
      { "versionNumber": 4, "createdAt": "...", "body": { /* raw */ }, "active": "...", "byteLength": 1234, "sha256": "..." },
      { "versionNumber": 3, "createdAt": "...", "body": { /* raw */ }, "active": "...", "byteLength": 1234, "sha256": "..." },
      { "versionNumber": 2, "createdAt": "...", "body": { /* raw */ }, "active": "...", "byteLength": 1234, "sha256": "..." }
    ]
  },

  "errors": [
    { "section": "saved.previous[2]", "message": "404 from /custom-content/.../?version=2" }
  ]
}
```

Field notes:
- `active` is the macro-type-specific extracted field — `graphXml` for graph, `mermaidCode` for mermaid, `code` for sequence, `openApiSpec` for openapi. Extracted for analysis convenience even though it also lives inside `body`. This is the field whose wipe defines the data-loss bug class.
- `sha256` is computed client-side over `active`. Lets us answer "does the editor's current view match what's saved?" with one comparison.
- `body` is the raw V2 body, kept verbatim so we don't lose unanticipated fields (title, timestamps, other macro metadata).
- `previous[]` is best-effort: shorter than 3 entries if fewer prior versions exist; entries are omitted entirely if the fetch fails, with the failure recorded in `errors[]`.
- `bundleVersion` lets us evolve the schema without breaking the analysis tool downstream.

Filename: `zenuml-debug-<pageId>-<short-contentId>-<YYYYMMDD-HHmmss>.json` where `short-contentId` is the last 6 characters of `customContentId` (or `"new"` for a not-yet-saved macro).

## 6. Architecture

### 6.1 Files

| File | Purpose |
|---|---|
| `src/services/debugBundle.ts` (new) | Pure functions. No Vue, no DOM events. Unit-tested in isolation. |
| `src/composables/useDebugBundle.ts` (new) | Thin glue: takes `diagram` + `diagramType` refs, returns `{ downloadDebugInfo, isCollecting, lastError }`. |
| `src/components/Viewer/OverflowMenu.vue` (new) | Popover primitive, single `<slot>`. |
| `src/components/Viewer/GenericViewer.vue` | Add `⋯` pill button → mounts `OverflowMenu` → one entry "Download debug info" → calls `downloadDebugInfo()`. |
| `src/services/debugBundle.spec.ts` (new) | Vitest unit tests for the service. |
| `src/composables/useDebugBundle.spec.ts` (new) | Vitest unit tests for the composable. |
| `tests/e2e-tests/tests/debug-bundle.spec.ts` (new) | Playwright E2E across all 4 macro types. |

### 6.2 Service surface (`src/services/debugBundle.ts`)

```ts
export interface DebugBundle { /* per §5 schema */ }
export type DiagramType = 'graph' | 'mermaid' | 'sequence' | 'openapi'

export function collectIdentity(): Promise<IdentitySection>
// Reads window.forgeGlobal (cloudId, environmentType, productType, page.id),
//   import.meta.env (VITE_APP_GIT_HASH/BRANCH/TAG, PRODUCT_TYPE),
//   window.location.hostname, navigator.userAgent, window.innerWidth/Height,
//   MacroIdProvider for macroUuid + customContentId.

export function collectEditorContent(
  diagramType: DiagramType,
  active: string,
): EditorSection
// Computes byteLength + sha256(active). `active` is provided by the caller
// (the composable extracts it via getCodeFromDiagram — the same helper that
// powers GenericViewer's existing copyCode action, so editor.active is
// byte-identical to what "Copy code" produces).

export async function fetchContentHistory(
  customContentId: string,
  diagramType: DiagramType,
  n: number, // 4 = latest + 3 prior
): Promise<{ latest: SavedVersion | null; previous: SavedVersion[]; errors: BundleError[] }>
// 1. GET /wiki/api/v2/custom-content/{id}?body-format=raw  -> learn latestVersionNumber
// 2. For v in [latest, latest-1, latest-2, latest-3] (down to 1, skip ≤0):
//      GET /wiki/api/v2/custom-content/{id}?body-format=raw&version=v
//      try/catch; on failure push { section, message } to errors[].
// 3. Per body, extract the active field via extractActiveField(body, diagramType).
//    The exact key per type must be verified against
//    src/model/ContentProvider/CustomContentStorageProvider.ts during implementation.

export function assembleBundle(args: { identity, editor, history }): DebugBundle
// Pure assembly. Folds history.errors into bundle.errors. Stamps
// capturedAt + bundleVersion=1.

export function downloadAsFile(bundle: DebugBundle, filename: string): void
// JSON.stringify(bundle, null, 2) → new Blob([...], { type: 'application/json' })
// → URL.createObjectURL → hidden <a download={filename}>.click()
// → URL.revokeObjectURL.

export function extractActiveField(body: unknown, diagramType: DiagramType): string | null
// graph    → body.raw.value.graphXml
// mermaid  → body.raw.value.mermaidCode
// sequence → body.raw.value.code
// openapi  → body.raw.value.openApiSpec
// (Verify exact keys during implementation by inspecting CustomContentStorageProvider.)
```

### 6.3 Composable (`src/composables/useDebugBundle.ts`)

```ts
export function useDebugBundle({
  diagram, diagramType,
}: { diagram: Ref<Diagram>; diagramType: Ref<DiagramType> }) {
  const isCollecting = ref(false)
  const lastError = ref<string | null>(null)

  async function downloadDebugInfo() {
    if (isCollecting.value) return
    isCollecting.value = true
    lastError.value = null
    try {
      const identity = await collectIdentity()
      const active   = getCodeFromDiagram(diagram.value, diagramType.value) ?? ''
      const editor   = collectEditorContent(diagramType.value, active)
      const history  = identity.customContentId
        ? await fetchContentHistory(identity.customContentId, identity.diagramType, 4)
        : { latest: null, previous: [], errors: [{ section: 'saved', message: 'no customContentId (new macro)' }] }
      const bundle   = assembleBundle({ identity, editor, history })
      const filename = `zenuml-debug-${identity.pageId ?? 'unknown'}-${(identity.customContentId ?? 'new').slice(-6)}-${stamp()}.json`
      const serialised = JSON.stringify(bundle, null, 2)
      downloadAsFile(bundle, filename)
      trackEvent('debug_bundle_downloaded', 'click', diagramType.value, {
        diagram_type:           identity.diagramType,
        product_type:           identity.productType,
        had_custom_content_id:  !!identity.customContentId,
        latest_version_number:  bundle.saved?.latest?.versionNumber ?? null,
        error_count:            bundle.errors.length,
        bundle_size_bytes:      serialised.length,
      })
    } catch (err) {
      lastError.value = String(err)
      console.error('[useDebugBundle] failed', err)
      toast({ message: 'Could not produce debug bundle. Please retry.', duration: 3000 })
    } finally {
      isCollecting.value = false
    }
  }

  return { downloadDebugInfo, isCollecting, lastError }
}
```

### 6.4 Partial-failure model

Every fetch in `fetchContentHistory` is wrapped; failures push to `errors[]`; the rest of the bundle still serialises. A bundle with only L1 + `editor.active` is still useful for triage. The only catch-all `try` is the top-level in the composable — it only triggers on truly unexpected errors (blob/URL APIs unavailable, JSON.stringify failure), at which point we surface a toast and bail without firing the analytics event.

## 7. Telemetry

One new Mixpanel event: `debug_bundle_downloaded`. Properties listed in §6.3. Standard `cloud_id` / `client_domain` are auto-added by the existing `trackEvent` infra.

Use cases the event answers:
- How often is the feature used? (justifies the maintenance cost)
- Which macro type triggers usage most? (signals which surfaces have residual usability issues)
- New-macro vs existing-macro split — high new-macro rate suggests editor mount-time problems
- Error rate (`error_count > 0`) — high rate suggests an upstream V2 API problem we should investigate independently

## 8. Testing

| Layer | Coverage |
|---|---|
| Vitest (`src/services/debugBundle.spec.ts`) | `collectIdentity` against a mocked `window.forgeGlobal`; `extractActiveField` for all 4 diagramTypes; `assembleBundle` folds errors; filename stamp matches regex; `fetchContentHistory` happy-path, partial-fail, no-prior-versions, no-customContentId. |
| Vitest (`src/composables/useDebugBundle.spec.ts`) | `isCollecting` lock prevents double-click; top-level catch fires the toast; analytics event fires exactly once per success. |
| Playwright (`tests/e2e-tests/tests/debug-bundle.spec.ts`) | One spec per macro type (sequence, mermaid, graph, openapi). Open a known page, click `⋯` → Download, capture the file via Playwright's download API, JSON.parse, assert `identity.diagramType` and `editor.active` is non-empty for an existing macro. |

E2E coverage spans all 4 macro types deliberately. A single test does not structurally guarantee the others work — the per-type adapter (`extractActiveField`) has 4 distinct code paths that could each silently regress.

## 9. Acceptance criteria

- [ ] `⋯` button visible at the end of the bottom-edge pill toolbar in `GenericViewer.vue`, both inline and fullscreen, for all 4 macro types
- [ ] Clicking "Download debug info" produces a `.json` file conforming to the v1 schema in §5
- [ ] Filename matches `zenuml-debug-<pageId>-<short-contentId>-<YYYYMMDD-HHmmss>.json`
- [ ] `editor.active` is byte-identical to what "Copy code" copies for the same macro
- [ ] `saved.latest.active` extraction works for all 4 diagramTypes (graphXml / mermaidCode / code / openApiSpec)
- [ ] `saved.previous` is best-effort; per-version failures land in `errors[]`; the rest of the bundle still downloads
- [ ] New-macro case (no `customContentId`) downloads with `saved.latest = null` and one entry in `errors[]`
- [ ] `debug_bundle_downloaded` analytics event fires exactly once per successful download
- [ ] Unit + E2E tests above pass; no new third-party dependencies
- [ ] `pnpm build:lite`, `pnpm build:full`, `pnpm build:diagramly` all succeed

## 10. Non-goals (deferred / explicitly out of scope for v1)

- Backend upload of bundles to R2; share-code UI.
- Confirm modal or preview pane before download.
- L3 log buffer (postMessage / requestConfluence / console ring buffer) and L4 feature-flag state in the bundle.
- Auto-capture on detected error. The §6.1–6.3 wipe fix already plants telemetry (`empty_content_loaded`, `empty_save_blocked`); auto-capture is a separate feature.
- The fix for the empty-wipe bug itself — that's `private/research/2026-05-17-graph-empty-wipe-data-loss-fix.md`.
- Internal-only DebugBar (`src/components/Debug/`) is unchanged.

## 11. Open questions for the implementer

1. **Exact `active`-field key per diagramType.** §6.2 lists the expected keys; verify by reading `src/model/ContentProvider/CustomContentStorageProvider.ts` before implementing `extractActiveField`. Mismatches will silently produce empty `active` strings.
2. **Popover primitive.** Confirm no equivalent popover/menu component already exists in this repo's components before adding `OverflowMenu.vue`. If one exists, reuse it. If not, implement minimally — click-outside-to-close, `Esc`-to-close, anchored to a parent element. Don't introduce a new dependency for this.
3. **Forge `requestConfluence` rate limiting.** Four sequential GETs (latest + 3 prior) for a customContent with a long history could hit per-second limits. Implementer should verify behavior on a content with N=10+ versions; if rate-limited, add a small inter-request delay or use `Promise.allSettled` with concurrency 2.
4. **Large or non-UTF8 bodies.** The OpenAPI macro can hold a large spec; sequence and mermaid diagrams routinely hold non-ASCII titles and content. Confirm `JSON.stringify` + Blob handles all expected payloads; spot-check non-ASCII mermaid code (the research spec referenced in §1 contains real examples to use during implementation).

## 12. Handling received bundles (operational policy)

A downloaded bundle on the customer's machine is the customer's own data and is out of scope for this repo's privacy policy. Once we receive a bundle through a support channel, the data sits with us, and the policy in `CLAUDE.md` ("client names / titles MUST NOT appear in any file checked into this public repo") applies fully to anything we do with it next.

Rules for received bundles:

1. **Do not commit a received bundle to any repo.** Not this public repo, and not `private/` either — `private/` is still git-tracked. Keep received bundles in a non-tracked location (local `/tmp/zenuml-debug-bundles/`, a private Drive folder, or the support ticket attachment itself). Add `/zenuml-debug-*.json` to root `.gitignore` as belt-and-braces.
2. **Do not quote bundle contents verbatim in public artifacts.** No customer titles, page IDs, hostnames, or diagram contents in public GitHub issues, PR descriptions, commit messages, code comments, test fixtures, snapshots, or unit test inputs. Use placeholder values (`example-tenant`, `example.atlassian.net`, `example diagram`) when illustrating a finding from a bundle in any public artifact.
3. **Retention.** Delete the local copy of a received bundle when the support case closes or within 30 days, whichever is sooner. The bundle is evidence for the active investigation; once that investigation is closed, it no longer has operational value and represents only privacy exposure.
4. **Internal sharing.** When a bundle has to be looked at by a colleague to diagnose, share it as a file attachment in a private channel (DM, private Slack channel, ticket). Do not paste contents inline into anywhere — even an "internal" team channel — without first stripping titles and diagram bodies down to the structural identifiers (sha256s, byte lengths, IDs).

This section is operational guidance, not implementation work. It informs how the team handles the artifacts the new feature produces.
