import type { ContentSource } from '@/utils/analytics/catalog';

export type ViewerEmptyReason =
  | 'missing_target'
  | 'invalid_target'
  | 'cross_tenant'
  | 'content_not_found';

export type ViewerFailureReason =
  | 'context'
  | 'target_resolution'
  | 'content_load'
  | 'render';

export type ViewerLoadState =
  | { status: 'loading' }
  | { status: 'rendering'; revision: number; source: ContentSource }
  | { status: 'rendered'; revision: number; source: ContentSource }
  | { status: 'empty'; reason: ViewerEmptyReason }
  | { status: 'failed'; reason: ViewerFailureReason };

export function initialViewerLoadState(): ViewerLoadState {
  return { status: 'loading' };
}
