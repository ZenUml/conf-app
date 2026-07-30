import type { InjectionKey } from 'vue';
import type { CacheSource, RenderMode } from '@/utils/analytics/catalog';

export interface ViewerRenderCompletion {
  renderMode?: RenderMode;
  cacheSource?: CacheSource;
}

/**
 * Narrow renderer-to-lifecycle Interface. A renderer captures the revision at
 * the start of its async work, then reports that same token at completion so a
 * stale callback cannot complete a newer publication.
 */
export interface ViewerRenderReporter {
  captureRevision(): number;
  rendered(revision: number, completion?: ViewerRenderCompletion): void;
  failed(revision: number, error?: unknown): void;
}

export const viewerRenderReporterKey = Symbol(
  'viewer-render-reporter',
) as InjectionKey<ViewerRenderReporter>;
