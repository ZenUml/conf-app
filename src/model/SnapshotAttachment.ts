// Diagram source snapshot attachments — the DrawIO-verified resilience model
// (docs/superpowers/plans/2026-07-18-diagram-source-snapshot-attachments.md).
//
// Writes a small per-page JSON attachment (`zenuml-<ccId>.json`, sibling of
// the existing `zenuml-<ccId>.png` backup) at macro save (Task 3) and, as a
// backfill, from `maybeBackfillSnapshot` below (Task 4 + the view-time
// generalization documented on that function) — an editor-preview render of
// a cross-page alias, or ANY macro viewed (page-view or fullscreen), since a
// macro created on a brand-new page never gets a save-time snapshot (the
// page isn't published yet — same benign 404 the PNG backup already
// recovers from) and by view time the page IS published. The viewer
// read-side fallback (Task 5/6, READ workstream) consumes `fetchSnapshot` +
// `snapshotToDiagram` from this same module.
//
// Global constraints (see plan): scope is DiagramType.Sequence/Mermaid/PlantUml
// ONLY (Graph already embeds its XML in the PNG — #140; Embed/OpenApi/AsyncApi
// are YAGNI). The attachment name is derived ONLY from the macro's existing
// customContentId — never persisted anywhere else. Every operation here must
// degrade silently: a snapshot failure must never fail a save or a render.

import { Diagram, DiagramType } from '@/model/Diagram/Diagram';
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig';
import { isValidCustomContentId } from '@/utils/customContentId';
import global from '@/model/globals';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { callRemote } from '@/utils/requestUtil';

const SNAPSHOT_TYPES: ReadonlyArray<DiagramType> = [
  DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml,
];

export interface DiagramSnapshotV1 {
  version: 1;
  ccId: string;
  ccVersion?: number;
  diagramType: string; // DiagramType enum value
  title?: string;
  dsl: string;         // getCodeFromDiagram output
  snapshotAt: string;  // ISO timestamp
}

/**
 * `zenuml-<ccId>.json` — undefined for any ccId that fails the same
 * writeback-corruption guard the PNG path uses (Attachment.ts:688), so a
 * poisoned "undefined"/"null"/empty id can never collide across macros.
 */
export function snapshotAttachmentName(ccId: string): string | undefined {
  if (!isValidCustomContentId(ccId)) return undefined;
  return `zenuml-${ccId}.json`;
}

/**
 * Build the v1 snapshot payload for a diagram, or undefined when the
 * snapshot should not be written at all: an invalid ccId, an out-of-scope
 * diagram type (Graph/Embed/OpenApi/AsyncApi), or empty DSL content (nothing
 * worth snapshotting).
 */
export function buildSnapshot(diagram: Diagram, ccId: string, ccVersion?: number): DiagramSnapshotV1 | undefined {
  if (!isValidCustomContentId(ccId)) return undefined;
  if (!SNAPSHOT_TYPES.includes(diagram.diagramType)) return undefined;
  const dsl = getCodeFromDiagram(diagram, diagram.diagramType);
  if (!dsl) return undefined;
  return {
    version: 1,
    ccId,
    ccVersion,
    diagramType: String(diagram.diagramType),
    title: diagram.title,
    dsl,
    snapshotAt: new Date().toISOString(),
  };
}

/**
 * Base64-encode the JSON snapshot body for the `dataBase64` wire field. Uses
 * Blob+FileReader (not a bare `btoa`) so multi-byte diagram content (UTF-8
 * titles/labels) round-trips correctly — the same problem Attachment.ts's
 * `blobToBase64` solves for the PNG payload; kept local here rather than
 * imported to avoid statically pulling Attachment.ts's html-to-image/md5
 * dependencies into every bundle that touches snapshots.
 */
function jsonToBase64(snapshot: DiagramSnapshotV1): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload (create-or-replace) the snapshot as a page attachment.
 *
 * Root cause (verified in production 2026-07-18, page 2935849027): the v1
 * `child/attachment` endpoint is unreachable through the client-side Forge
 * `requestConfluence` proxy at all — PUT (attempt 1) and POST (attempt 2, PR
 * #352) BOTH 404'd, while the sibling PNG attachment (Attachment.ts) succeeded
 * on the same save via the app-authenticated `/forge-upload-attachment`
 * backend. The v2 API has no attachment-upload endpoint either, so that
 * backend is the only path — mirror `uploadAttachmentViaApp` (Attachment.ts)
 * exactly: same endpoint, same callRemote shape, JSON payload instead of PNG.
 *
 * Throws on any failure — every caller wraps this so a snapshot write never
 * fails the surrounding save/render.
 */
export async function uploadSnapshot(pageId: string, snapshot: DiagramSnapshotV1): Promise<void> {
  const name = snapshotAttachmentName(snapshot.ccId);
  if (!name) throw new Error('invalid ccId for snapshot');

  // Resolve whether a same-named attachment already exists, mirroring how
  // createAttachmentIfContentChanged builds its UploadTarget: existing ->
  // its id + version+1; none -> no id, version 1.
  let attachmentId: string | undefined;
  let versionNumber = 1;
  try {
    const existing = await global.apWrapper.getAttachmentsV2(pageId, { filename: name });
    const found = existing?.[0] as any;
    if (found?.id) {
      attachmentId = String(found.id);
      versionNumber = (found.version?.number ?? 0) + 1;
    }
  } catch {
    // Existence lookup failed — fall through to a create (version 1). Worst
    // case the create is rejected for a duplicate name and the caller records
    // snapshot_create_failed; never block the save.
  }

  // The backend stores this as the attachment comment for change detection —
  // deterministic from ccVersion (never Date.now()/random) so re-uploads of
  // the same version are idempotent and inspectable.
  const hash = `snapshot-v1-cc${snapshot.ccVersion ?? 0}`;
  const dataBase64 = await jsonToBase64(snapshot);

  let raw: unknown;
  try {
    raw = await callRemote('/forge-upload-attachment', 'POST', {
      pageId,
      ...(attachmentId ? { attachmentId } : {}),
      attachmentName: name,
      hash,
      versionNumber,
      dataBase64,
      contentType: 'application/json',
    });
  } catch (e) {
    // callRemote throws on a non-2xx transport response (e.g. the function
    // itself 500'd); normalise so the failure is labelled consistently, same
    // as Attachment.ts's uploadAttachmentViaApp.
    throw new Error(`snapshot upload transport error: ${(e as Error)?.message ?? e}`);
  }
  const result: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!result?.ok) {
    const status = typeof result?.status === 'number' ? result.status : 0;
    // Attach the HTTP status so callers can classify an expected best-effort
    // skip (401/403 no write permission, 404 draft page) apart from a genuine
    // failure (5xx / transport) without re-parsing the message string.
    const err = new Error(
      `snapshot upload HTTP ${status}: ${String(result?.body ?? 'backend upload failed')}`,
    ) as Error & { status?: number };
    err.status = status;
    throw err;
  }
}

/**
 * Classify a caught snapshot-upload error into an EXPECTED, by-design skip vs a
 * genuine failure. The snapshot write is best-effort and must degrade silently
 * (see the module header), so the two normal outcomes below should not pollute
 * the `snapshot_create_failed` error signal:
 *
 * - `no_write_permission` (401/403): the app-auth upload was denied — typically
 *   a read-only viewer with no attachment-write permission. This is the
 *   #211/#162 "viewer-triggered uploads are unreliable" case the original plan
 *   avoided by writing only from permission-guaranteed surfaces.
 * - `page_not_published` (404): the host page is an unpublished draft, so there
 *   is nothing to attach to yet; the save-path/backfill self-heals after
 *   publish (same benign 404 the PNG backup recovers from).
 *
 * Returns `undefined` for anything else (5xx, transport error, unexpected) —
 * those remain genuine `snapshot_create_failed` failures. Reads a numeric
 * `.status` off the error when present (set by `uploadSnapshot`), falling back
 * to parsing `HTTP <nnn>` from the message.
 */
export function snapshotSkipReason(
  e: unknown,
): 'no_write_permission' | 'page_not_published' | undefined {
  let status = (e as { status?: number } | undefined)?.status;
  if (typeof status !== 'number' || status === 0) {
    const m = /HTTP (\d{3})/.exec(String(e instanceof Error ? e.message : e));
    status = m ? Number(m[1]) : undefined;
  }
  if (status === 401 || status === 403) return 'no_write_permission';
  if (status === 404) return 'page_not_published';
  return undefined;
}


/**
 * Fetch and parse the host page's snapshot attachment for a given ccId.
 * Never throws — any failure (no attachment, HTTP error, malformed/non-v1
 * body) resolves to undefined so callers can treat "no snapshot" and
 * "snapshot fetch failed" identically.
 */
export async function fetchSnapshot(pageId: string, ccId: string): Promise<DiagramSnapshotV1 | undefined> {
  try {
    const name = snapshotAttachmentName(ccId);
    if (!name) return undefined;
    const attachments = await global.apWrapper.getAttachmentsV2(pageId, { filename: name });
    const download = (attachments?.[0] as any)?._links?.download;
    if (!download) return undefined;
    const { requestConfluence } = await import('@forge/bridge');
    const res = await requestConfluence(`/wiki${download}`);
    if (!res.ok) return undefined;
    const parsed = JSON.parse(await res.text());
    if (parsed?.version !== 1 || !parsed?.dsl || !parsed?.diagramType) return undefined;
    return parsed as DiagramSnapshotV1;
  } catch {
    return undefined;
  }
}

/**
 * Backfill (fire-and-forget) called from forgeIndex.ts right after a custom
 * content load resolves. `isDisplayMode` (ApWrapper2.isDisplayMode(): true
 * for plain page-view AND fullscreen, false only for the editor/config modal)
 * discriminates two distinct policies that share everything else — the
 * freshness check, the upload, and the never-throws analytics:
 *
 * - Editor surface (Task 4, unchanged): only CROSS-PAGE aliases (the CC's
 *   `pageId` differs from the current host page) get a host-page-local
 *   snapshot here. A same-page macro already gets one at save time
 *   (Persistence.ts) on every save after its first successful one, so an
 *   editor-preview render of a same-page macro must not re-upload — write
 *   permission is guaranteed on this surface, but there's nothing new to
 *   capture.
 * - Viewer surface (new — the new-page recovery case): backfill for ANY
 *   macro, same-page included. A macro created on a brand-new page is saved
 *   BEFORE the page is published, so the save-time attachment write 404s
 *   (see Attachment.ts's "A 404 on the attachment POST means the parent page
 *   is not (yet)" — the same benign condition the PNG backup already
 *   recovers from). The page IS published by the time it's viewed, and
 *   uploadSnapshot's write goes through the app-authenticated backend
 *   (`/forge-upload-attachment`, PR #353) rather than the user's own
 *   Confluence permissions, so a plain viewer (no edit permission) can still
 *   trigger this safely.
 *
 * Either branch skips entirely when a snapshot already exists at least as
 * fresh as the current CC version.
 */
export async function maybeBackfillSnapshot(opts: {
  hostPageId: string;
  ccId: string;
  ccPageId?: string | number;
  diagram: Diagram;
  ccVersion?: number;
  isDisplayMode: boolean;
}): Promise<void> {
  const surface = opts.isDisplayMode ? 'viewer' : 'editor';
  const snapshotTrigger = opts.isDisplayMode ? 'viewer_backfill' : 'editor_backfill';
  try {
    if (!opts.isDisplayMode) {
      // Editor surface: cross-page aliases only (see doc comment above).
      if (!opts.ccPageId || String(opts.ccPageId) === String(opts.hostPageId)) return;
    }
    // Viewer surface falls through unconditionally — any macro qualifies.
    const existing = await fetchSnapshot(opts.hostPageId, opts.ccId);
    if (existing && opts.ccVersion !== undefined && (existing.ccVersion ?? -1) >= opts.ccVersion) return;
    const snapshot = buildSnapshot(opts.diagram, opts.ccId, opts.ccVersion);
    if (!snapshot) return;
    await uploadSnapshot(opts.hostPageId, snapshot);
    trackAnalyticsEvent('snapshot_created', {
      feature_area: 'macro',
      surface,
      snapshot_trigger: snapshotTrigger,
      custom_content_id: opts.ccId,
      attachment_name: snapshotAttachmentName(opts.ccId),
    });
  } catch (e) {
    const failure_reason = String(e instanceof Error ? e.message : e).substring(0, 200);
    const skipReason = snapshotSkipReason(e);
    if (skipReason) {
      // Expected best-effort skip (read-only viewer / unpublished draft), not a
      // failure — record it as such so snapshot_create_failed stays a real
      // error signal while we keep visibility into the write-coverage gap.
      trackAnalyticsEvent('snapshot_backfill_skipped', {
        feature_area: 'macro',
        surface,
        snapshot_trigger: snapshotTrigger,
        custom_content_id: opts.ccId,
        snapshot_skip_reason: skipReason,
        failure_reason,
      });
      return;
    }
    trackAnalyticsEvent('snapshot_create_failed', {
      feature_area: 'macro',
      surface,
      snapshot_trigger: snapshotTrigger,
      custom_content_id: opts.ccId,
      failure_reason,
    });
  }
}

// Verified against Diagram model / DiagramTypeConfig: field is plantUmlCode
// (capital U), not plantumlCode.
const DSL_FIELD: Record<string, 'code' | 'mermaidCode' | 'plantUmlCode'> = {
  [DiagramType.Sequence]: 'code',
  [DiagramType.Mermaid]: 'mermaidCode',
  [DiagramType.PlantUml]: 'plantUmlCode',
};

export function snapshotToDiagram(snapshot: DiagramSnapshotV1): Diagram {
  const field = DSL_FIELD[snapshot.diagramType];
  const diagram: any = {
    diagramType: field ? snapshot.diagramType : DiagramType.Unknown,
    title: snapshot.title,
    id: snapshot.ccId,
    snapshotFallback: true,
    snapshotAt: snapshot.snapshotAt,
  };
  if (field) diagram[field] = snapshot.dsl;
  return diagram as Diagram;
}
