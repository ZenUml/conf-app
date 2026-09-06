import { trackEvent } from '@/utils/window';
import type ApWrapper2 from '@/model/ApWrapper2';

export type OrphanDiagramKind = 'sequence' | 'graph' | 'openapi' | 'embed';

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
 * Best-effort. Delegates to trackEvent, which never throws synchronously
 * (fire-and-forget async internally), so it can never re-crash the caller.
 *
 * INVARIANT — fire at most ONCE per macro load. Every macro type has exactly
 * one owner for this event: forgeIndex.ts (the shared Custom UI entry) owns it
 * for the sequence family it renders itself, and each dedicated viewer/editor
 * entry (forge-graph-*, forge-swagger-*, forge-embed-*, forge-asyncapi-*) owns
 * it for its own type. The shared entry MUST NOT call this for a macro it
 * delegates (it gates the load on isSequenceFamilyEntry), otherwise
 * non-sequence macros double-count and the extra event is mislabeled
 * diagram_kind='sequence'. The recovery-rate metric is
 * `count(recovery_used=true) / count(all)`; keeping this event single-fire per
 * load keeps that ratio meaningful.
 */
export function reportOrphanObserved(
  pageId: string | undefined,
  orphanId: string,
  diagramKind: OrphanDiagramKind,
  probeResult: ProbeResult | undefined,
  options: { recoveryUsed?: boolean; recoveredId?: string } = {},
): void {
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
  });
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
  trackEvent(oldOrphanId, 'customcontent_orphan_macro_repaired', 'info', {
    diagram_kind: diagramKind,
    ...(pageId && { page_id: pageId }),
    old_custom_content_id: oldOrphanId,
    new_custom_content_id: newId,
  });
}
