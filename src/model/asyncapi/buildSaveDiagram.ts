import yaml from 'js-yaml';
import { DataSource, Diagram, DiagramType } from '@/model/Diagram/Diagram';

/**
 * Pull `info.title` out of an AsyncAPI spec (YAML or JSON, both parse via
 * js-yaml). Used to mirror the document's title onto the custom-content title
 * so dashboard cards / search / the embed picker surface the user-chosen name.
 * Returns undefined for a malformed spec or missing/blank title.
 */
export function extractAsyncApiTitle(spec: string | undefined): string | undefined {
  if (!spec) return undefined;
  try {
    const doc = yaml.load(spec) as Record<string, any> | null;
    const title = (doc?.info as Record<string, any> | undefined)?.title;
    if (typeof title !== 'string') return undefined;
    const trimmed = title.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export interface BuildAsyncApiSaveDiagramArgs {
  /** The diagram loaded for editing (from getCustomContentByIdV2), if any. */
  existing?: Diagram;
  /** The edited AsyncAPI spec text to persist. */
  spec: string;
  /**
   * Optional explicit title to mirror onto the CC. When omitted, the title is
   * parsed from the spec's `info.title` so EVERY save path (editor, dashboard
   * in-place edit, viewer in-place edit) keeps the CC title in sync — not just
   * the ones that remembered to pass it.
   */
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
  const resolvedTitle = title ?? extractAsyncApiTitle(spec);
  return {
    ...(existing ?? {}),
    diagramType: DiagramType.AsyncApi,
    code: spec,
    source: DataSource.CustomContent,
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    ...(pinToId ? { id: pinToId, isCopy: false } : {}),
  } as Diagram;
}
