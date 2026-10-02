// Inline title rename from the viewer (GenericViewer.vue's click-to-rename
// title). Persistence only — the component owns the input state machine and
// the viewer_rename_* events.
//
// Why this is NOT `saveToPlatform(store.state.diagram)`:
//
//  1. The viewer's in-memory body may be stale. Viewers render from the
//     content-SWR cache first (utils/renderCache/contentCacheStore.ts) and a
//     viewer iframe can sit open for hours while someone else edits the same
//     diagram. PUTting that body would overwrite newer code with a rename.
//     So: GET the custom content fresh, change ONLY `title`, PUT that.
//  2. `saveCustomContentV2` may fork (same-page duplicate / cross-page copy /
//     404 → create) and the viewer is a non-submittable surface — a forked id
//     can never be written back into the macro config (#170), so the fork
//     would be an orphan. `updateCustomContentV2` on the fetched record can
//     only update in place (throws on 404; version-conflict retry inside).
//  3. `saveToPlatform` stamps `surface: 'editor'`, uploads a snapshot, marks
//     CSAT pending and fires macro_save_succeeded — the edit-volume signal.
//     A title-only write is none of those (see viewer_rename_* in
//     utils/analytics/catalog.ts).
//
// The click-time same-page duplicate guard (utils/guardEditClick.ts) runs
// first, exactly as it does for the Edit button: a rename on a shared id
// would land on every macro sharing it, and that gate already owns the
// user-facing explanation (toast + disabled state) for that case.

import globals from '@/model/globals';
import forgeGlobal from '@/model/globals/forgeGlobal';
import type ApWrapper2 from '@/model/ApWrapper2';
import type { Diagram } from '@/model/Diagram/Diagram';
import type { DiagramAttribution } from '@/model/DiagramAttribution';
import type { MacroTypeValue } from '@/utils/analytics/catalog';
import { guardEditClick } from '@/utils/guardEditClick';
import { putCachedContent } from '@/utils/renderCache/contentCacheStore';
import { syncCustomContent } from '@/services/CustomContent';

export type RenameFailureReason = 'gate_blocked' | 'not_found' | 'id_mismatch' | 'save_error';

export type RenameDiagramTitleResult =
  | { ok: true; id: string; doc: Diagram; durationMs: number }
  | { ok: false; reason: RenameFailureReason; durationMs: number; error?: unknown };

export interface RenameDiagramTitleOptions {
  customContentId: string;
  /** Already trimmed and non-empty — the component refuses blanks before calling. */
  title: string;
  macroType: MacroTypeValue;
  /** Viewer attribution to keep on the rewritten SWR cache entry (footer authors). */
  attribution?: DiagramAttribution | null;
  apWrapper?: ApWrapper2;
}

export async function renameDiagramTitle(opts: RenameDiagramTitleOptions): Promise<RenameDiagramTitleResult> {
  const { customContentId, title, macroType, attribution } = opts;
  const apWrapper = opts.apWrapper ?? globals.apWrapper;
  const startedAt = performance.now();
  const durationMs = () => Math.round(performance.now() - startedAt);

  if (!(await guardEditClick({ customContentId, macroType }))) {
    return { ok: false, reason: 'gate_blocked', durationMs: durationMs() };
  }

  // 'cross-page-only': the guard above already paid the page-ADF scan for the
  // same-page count; the fetch needs only the zero-network pageId comparison.
  let existing;
  try {
    existing = await apWrapper.getCustomContentByIdV2(customContentId, { copyCheckMode: 'cross-page-only' });
  } catch (error) {
    return { ok: false, reason: 'save_error', durationMs: durationMs(), error };
  }
  if (!existing?.value) {
    return { ok: false, reason: 'not_found', durationMs: durationMs() };
  }

  const doc: Diagram = { ...existing.value, title };
  let saved;
  try {
    saved = await apWrapper.updateCustomContentV2(existing, doc);
  } catch (error) {
    return { ok: false, reason: 'save_error', durationMs: durationMs(), error };
  }
  if (String(saved?.id) !== String(customContentId)) {
    return { ok: false, reason: 'id_mismatch', durationMs: durationMs() };
  }

  // Keep the id-keyed SWR cache honest so the next revisit renders the new
  // title immediately instead of the old one until the background revalidate
  // lands. Best-effort and bounded (see putCachedContent).
  putCachedContent(customContentId, JSON.stringify(doc), attribution ?? undefined);

  // D1 mirror (telemetry / discovery only — Confluence stays the system of
  // record). syncCustomContent swallows its own errors; the catch is belt
  // and braces so a mirror outage can never turn a landed rename into a
  // reported failure.
  try {
    await syncCustomContent(saved, doc.diagramType, forgeGlobal.forgeContext?.localId || '');
  } catch (e) {
    console.warn('rename: custom content mirror sync failed (non-fatal)', e);
  }

  return { ok: true, id: String(saved.id), doc, durationMs: durationMs() };
}
