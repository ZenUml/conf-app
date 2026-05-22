import { trackEvent } from '@/utils/window';
import type ApWrapper2 from '@/model/ApWrapper2';

export type OrphanDiagramKind = 'sequence' | 'graph' | 'openapi' | 'embed';

/**
 * Fire a Mixpanel `customcontent_orphan_observed` event when a viewer's
 * referenced customContentId no longer resolves (404 / deleted / restricted).
 * Probes the host page's own custom-content children for one whose embedded
 * `body.id` matches the orphan id — that's the surviving sibling from the
 * historical cross-page-copy → dedupe flow.
 *
 * Read-only. Best-effort. Wrapped in try/catch so a telemetry failure can
 * never re-crash the viewer.
 */
export async function reportOrphanObserved(
  apWrapper: ApWrapper2,
  pageId: string | undefined,
  orphanId: string,
  diagramKind: OrphanDiagramKind,
): Promise<void> {
  try {
    if (!pageId) {
      trackEvent(orphanId, 'customcontent_orphan_observed', 'warning', {
        diagram_kind: diagramKind,
        recoverable: 'probe_skipped_no_page_id',
      });
      return;
    }
    const probe = await apWrapper.probeOrphanRecovery(pageId, orphanId);
    trackEvent(orphanId, 'customcontent_orphan_observed', 'warning', {
      diagram_kind: diagramKind,
      page_id: pageId,
      recoverable: String(probe.recoverable),
      candidate_count: probe.candidateCount,
      page_children_total: probe.pageChildrenTotal,
      ...(probe.truncated && { truncated: true }),
      ...(probe.probeError && { probe_error: probe.probeError }),
    });
  } catch (e) {
    console.warn('[orphanTelemetry] reportOrphanObserved failed', e);
  }
}
