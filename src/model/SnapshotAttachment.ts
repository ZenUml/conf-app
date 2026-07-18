// Diagram source snapshot attachments — the DrawIO-verified resilience model
// (docs/superpowers/plans/2026-07-18-diagram-source-snapshot-attachments.md).
//
// Writes a small per-page JSON attachment (`zenuml-<ccId>.json`, sibling of
// the existing `zenuml-<ccId>.png` backup) at the two moments write
// permission on the HOST page is guaranteed: macro save (Task 3) and
// editor-preview render of a cross-page alias (Task 4, `maybeBackfillSnapshot`
// below). The viewer read-side fallback (Task 5/6, READ workstream) consumes
// `fetchSnapshot` + `snapshotToDiagram` from this same module.
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
 * Upload (create-or-replace) the snapshot as a page attachment. Uses the v1
 * PUT create-or-update endpoint, which upserts by filename — a same-named
 * attachment becomes a new version instead of erroring (unlike the POST
 * create-only endpoint, whose duplicate-filename behavior is the #75 class of
 * collision). Throws on any failure — every caller wraps this so a snapshot
 * write never fails the surrounding save/render.
 */
export async function uploadSnapshot(pageId: string, snapshot: DiagramSnapshotV1): Promise<void> {
  const name = snapshotAttachmentName(snapshot.ccId);
  if (!name) throw new Error('invalid ccId for snapshot');
  const form = new FormData();
  form.append('file', new File([JSON.stringify(snapshot)], name, { type: 'application/json' }));
  form.append('minorEdit', 'true');
  const { requestConfluence } = await import('@forge/bridge');
  const res = await requestConfluence(
    `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`,
    { method: 'PUT', headers: { 'X-Atlassian-Token': 'nocheck' }, body: form },
  );
  if (!res.ok) throw new Error(`snapshot upload HTTP ${res.status}`);
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
 * Editor-preview cross-page backfill (Task 4). Called (fire-and-forget) from
 * the editor-preview load path in forgeIndex.ts right after a custom content
 * load resolves, so a page hosting only an ALIAS macro (the CC's `pageId`
 * differs from the current host page) still gets its own local snapshot —
 * the fallback the viewer needs if the source page/CC later goes dark.
 * Restricted to editor surfaces (write permission is guaranteed there;
 * `isDisplayMode` covers the plain page-view/fullscreen-viewer surfaces where
 * we cannot assume write access) and skipped entirely when a snapshot already
 * exists at least as fresh as the current CC version.
 */
export async function maybeBackfillSnapshot(opts: {
  hostPageId: string;
  ccId: string;
  ccPageId?: string | number;
  diagram: Diagram;
  ccVersion?: number;
  isDisplayMode: boolean;
}): Promise<void> {
  try {
    if (opts.isDisplayMode) return; // editor surfaces only (write perms guaranteed)
    if (!opts.ccPageId || String(opts.ccPageId) === String(opts.hostPageId)) return; // cross-page aliases only
    const existing = await fetchSnapshot(opts.hostPageId, opts.ccId);
    if (existing && opts.ccVersion !== undefined && (existing.ccVersion ?? -1) >= opts.ccVersion) return;
    const snapshot = buildSnapshot(opts.diagram, opts.ccId, opts.ccVersion);
    if (!snapshot) return;
    await uploadSnapshot(opts.hostPageId, snapshot);
    trackAnalyticsEvent('snapshot_created', {
      feature_area: 'macro',
      surface: 'editor',
      snapshot_trigger: 'editor_backfill',
      custom_content_id: opts.ccId,
      attachment_name: snapshotAttachmentName(opts.ccId),
    });
  } catch (e) {
    trackAnalyticsEvent('snapshot_create_failed', {
      feature_area: 'macro',
      surface: 'editor',
      snapshot_trigger: 'editor_backfill',
      custom_content_id: opts.ccId,
      failure_reason: String(e instanceof Error ? e.message : e).substring(0, 200),
    });
  }
}
