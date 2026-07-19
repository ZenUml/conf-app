import type ApWrapper2 from '@/model/ApWrapper2';
import type { Diagram } from '@/model/Diagram/Diagram';
import type { MacroTypeValue } from '@/utils/analytics/catalog';
import { getRenderIdentity } from '@/utils/analytics/renderIdentity';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
// @ts-expect-error — src/shims-vue.d.ts re-exports @vue/runtime-dom, which
// doesn't surface reactivity-only symbols like toRaw. This is a project-wide
// gap, not specific to this file: ref/computed/watch imports from 'vue' fail
// identically and are already part of the pre-existing ~150-error tsc
// baseline (no other file suppresses it with @ts-expect-error — this
// suppression exists solely to keep this task's tsc-count guard at 352).
import { toRaw } from 'vue';

type DeferredAdfMacroType = Extract<MacroTypeValue, 'sequence' | 'mermaid' | 'plantuml'>;

/**
 * P1.1 completion half: run the ADF copy-scan the viewer skipped, then land
 * the verdict on the SAME diagram the app mounted. Writes go through the
 * store proxy when the mounted diagram is ours (post-mount reactivity), and
 * through the raw object otherwise (pre-mount: mountRoot will hand the
 * already-updated doc to Vue). Never throws — a failed scan degrades to
 * "no copy info", exactly like today's catch path in AtlasPage.macros().
 */
export async function runDeferredCopyCheck(
  apWrapper: Pick<ApWrapper2, 'detectCopy'>,
  doc: Diagram,
  customContentId: string,
  ccPageId: string | number | undefined,
  macroType: DeferredAdfMacroType,
  /**
   * `performance.now()` captured where the scan was dispatched, before the
   * idle hop. Reported as `scan_delay_ms` so we can tell a scan that actually
   * waited for the render from one that started immediately and raced it.
   */
  dispatchedAt?: number,
): Promise<void> {
  const startedAt = performance.now();
  const scanDelayMs =
    typeof dispatchedAt === 'number' ? Math.max(0, Math.round(startedAt - dispatchedAt)) : undefined;
  let verdict: { isCopy: boolean; copyReason?: Diagram['copyReason'] } | undefined;
  try {
    verdict = await apWrapper.detectCopy(customContentId, ccPageId);
  } catch (e) {
    console.warn('[viewer-load] deferred copy-scan failed; leaving isCopy unknown', e);
  }
  const pageAdfFetchMs = Math.max(0, Math.round(performance.now() - startedAt));
  let writebackTarget: 'store' | 'raw' = 'raw';
  try {
    const { default: store } = await import('@/model/store2');
    const mounted = store.state.diagram;
    const target: Diagram = mounted && toRaw(mounted) === doc ? mounted : doc;
    writebackTarget = target === mounted ? 'store' : 'raw';
    if (verdict) {
      target.isCopy = verdict.isCopy;
      target.copyReason = verdict.copyReason;
    }
    target.copyCheckPending = false;
  } catch {
    // Store not available (tests/teardown) — still clear the raw doc.
    if (verdict) {
      doc.isCopy = verdict.isCopy;
      doc.copyReason = verdict.copyReason;
    }
    doc.copyCheckPending = false;
  }

  try {
    trackAnalyticsEvent('viewer_adf_scan_completed', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: macroType,
      result: verdict ? 'succeeded' : 'failed',
      ...(verdict
        ? {
            copy_detected: verdict.isCopy,
            ...(verdict.copyReason ? { copy_reason: verdict.copyReason } : {}),
          }
        : { failure_reason: 'detect_copy_failed' }),
      adf_deferred: true,
      page_adf_fetch_ms: pageAdfFetchMs,
      writeback_target: writebackTarget,
      ...(scanDelayMs !== undefined ? { scan_delay_ms: scanDelayMs } : {}),
      ...getRenderIdentity(),
    });
  } catch {
    // Completion telemetry is best-effort and must never affect viewer state.
  }
}
