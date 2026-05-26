import { trackEvent } from '@/utils/window';
import type ApWrapper2 from '@/model/ApWrapper2';

export type OrphanDiagramKind = 'sequence' | 'graph' | 'openapi' | 'embed';

/**
 * Emit a sampled (1%) `customcontent_load_succeeded` event on the happy path
 * so per-user / per-page success-vs-failure joins are possible in Mixpanel.
 * Successes are the dominant case (>99% of loads); 1% gives enough signal
 * without drowning the event stream.
 */
export function reportCustomContentLoadSucceeded(
  pageId: string | undefined,
  customContentId: string,
  diagramKind: OrphanDiagramKind,
): void {
  if (Math.random() > 0.01) return;
  try {
    trackEvent(customContentId, 'customcontent_load_succeeded', 'info', {
      diagram_kind: diagramKind,
      direct_fetch_status: 'ok',
      ...(pageId && { page_id: pageId }),
    });
  } catch (e) {
    console.warn('[orphanTelemetry] reportCustomContentLoadSucceeded failed', e);
  }
}

export type ProbeResult = Awaited<ReturnType<ApWrapper2['probeOrphanRecovery']>>;

/**
 * Fire a Mixpanel `customcontent_orphan_observed` event after a viewer/editor
 * encounters a customContentId that no longer resolves. Caller hands us the
 * probe result it already has from loadCustomContentWithOrphanRecovery — we
 * don't re-probe, so no extra API calls.
 *
 * Set `recoveryUsed: true` when the caller used a recovered child CC for
 * render/edit (Defect 2b recovery applied). Set `false` (default) when the
 * probe ran but recovery was not used (no candidate, ambiguous, or probe
 * failed). The same event covers both cases so Mixpanel queries can compute
 * recovery rate as `count where recovery_used=true / count(all)`.
 *
 * Best-effort. Wrapped in try/catch so a telemetry failure can never re-crash
 * the caller.
 */
export function reportOrphanObserved(
  pageId: string | undefined,
  orphanId: string,
  diagramKind: OrphanDiagramKind,
  probeResult: ProbeResult | undefined,
  options: {
    recoveryUsed?: boolean;
    recoveredId?: string;
    directFetchStatus?: 'ok' | 'not_found' | 'other_error';
    directFetchHttpStatus?: number;
    directFetchErrorCode?: string;
    directFetchErrorClass?: 'thrown' | 'structured' | 'malformed';
  } = {},
): void {
  const directFetchProps = {
    ...(options.directFetchStatus !== undefined && { direct_fetch_status: options.directFetchStatus }),
    ...(options.directFetchHttpStatus !== undefined && { direct_fetch_http_status: options.directFetchHttpStatus }),
    ...(options.directFetchErrorCode !== undefined && { direct_fetch_error_code: options.directFetchErrorCode }),
    ...(options.directFetchErrorClass !== undefined && { direct_fetch_error_class: options.directFetchErrorClass }),
  };
  try {
    if (!pageId || !probeResult) {
      // Two distinct reasons we couldn't probe:
      //   - no_page_id:       context.extension.content.id was undefined at call time
      //   - no_probe_result:  pageId was present but loadCustomContentWithOrphanRecovery
      //                       refused to probe (transient direct-fetch error: 403/5xx/parse).
      //                       The CC may still exist — don't conflate with true orphans.
      trackEvent(orphanId, 'customcontent_orphan_observed', 'warning', {
        diagram_kind: diagramKind,
        recoverable: !pageId ? 'probe_skipped_no_page_id' : 'probe_skipped_no_probe_result',
        recovery_used: false,
        ...(pageId && { page_id: pageId }),
        ...directFetchProps,
      });
      return;
    }
    trackEvent(orphanId, 'customcontent_orphan_observed', 'warning', {
      diagram_kind: diagramKind,
      page_id: pageId,
      recoverable: String(probeResult.recoverable),
      candidate_count: probeResult.candidateCount,
      page_children_total: probeResult.pageChildrenTotal,
      recovery_used: Boolean(options.recoveryUsed),
      ...(options.recoveredId && { recovered_id: options.recoveredId }),
      ...(probeResult.truncated && { truncated: true }),
      ...(probeResult.probeError && { probe_error: probeResult.probeError }),
      ...directFetchProps,
    });
  } catch (e) {
    console.warn('[orphanTelemetry] reportOrphanObserved failed', e);
  }
}

/**
 * Fire `customcontent_orphan_macro_repaired` once the editor save path has
 * rewritten the macro's customContentId via view.submit({config:...}) so
 * future visits skip the probe altogether. Separate event from the observed
 * one because repair only happens on Save, not on every view.
 */
export function reportOrphanMacroRepaired(
  pageId: string | undefined,
  oldOrphanId: string,
  newId: string,
  diagramKind: OrphanDiagramKind,
): void {
  try {
    trackEvent(oldOrphanId, 'customcontent_orphan_macro_repaired', 'info', {
      diagram_kind: diagramKind,
      ...(pageId && { page_id: pageId }),
      old_custom_content_id: oldOrphanId,
      new_custom_content_id: newId,
    });
  } catch (e) {
    console.warn('[orphanTelemetry] reportOrphanMacroRepaired failed', e);
  }
}
