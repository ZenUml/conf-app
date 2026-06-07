import { DataSource, Diagram, DiagramType } from '@/model/Diagram/Diagram';

export interface BuildAsyncApiSaveDiagramArgs {
  /** The diagram loaded for editing (from getCustomContentByIdV2), if any. */
  existing?: Diagram;
  /** The edited AsyncAPI spec text to persist. */
  spec: string;
  /** Optional title (parsed from the spec's info.title) to mirror onto the CC. */
  title?: string;
  /**
   * When set, force the save to UPDATE this custom-content id in place.
   *
   * Dashboard edits open the editor/viewer as a standalone modal targeting a
   * known document id. The shared loader (ApWrapper2.getCustomContentByIdV2)
   * runs cross-page-copy detection that false-positives in that context — the
   * dashboard space page is never the content's origin page, so it stamps
   * isCopy=true. CustomContentStorageProvider.save then refuses to update
   * (it requires !isCopy) and CREATES a new document instead — the
   * "editing made a new diagram" bug. Pinning the id and clearing isCopy here
   * makes the dashboard edit update in place.
   *
   * Leave undefined for macro edits (config.customContentId) and inserts so
   * the normal copy-aware behavior is preserved.
   */
  pinToId?: string;
}

/**
 * Build the Diagram passed to saveToPlatform for an AsyncAPI edit. Shared by
 * the dashboard editor entry and the dashboard viewer's in-place edit so both
 * update in place rather than forking a copy.
 */
export function buildAsyncApiSaveDiagram({
  existing,
  spec,
  title,
  pinToId,
}: BuildAsyncApiSaveDiagramArgs): Diagram {
  return {
    ...(existing ?? {}),
    diagramType: DiagramType.AsyncApi,
    code: spec,
    source: DataSource.CustomContent,
    ...(title ? { title } : {}),
    ...(pinToId ? { id: pinToId, isCopy: false } : {}),
  } as Diagram;
}
