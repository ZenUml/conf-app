import type ApWrapper2 from '@/model/ApWrapper2';
import type { Diagram } from '@/model/Diagram/Diagram';
// @ts-expect-error — src/shims-vue.d.ts re-exports @vue/runtime-dom, which
// doesn't surface reactivity-only symbols like toRaw (pre-existing gap; see
// e.g. src/composables/useCustomerSuccessService.ts's `ref` in the tsc
// baseline for the same pattern with other symbols).
import { toRaw } from 'vue';

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
): Promise<void> {
  let verdict: { isCopy: boolean; copyReason?: Diagram['copyReason'] } | undefined;
  try {
    verdict = await apWrapper.detectCopy(customContentId, ccPageId);
  } catch (e) {
    console.warn('[viewer-load] deferred copy-scan failed; leaving isCopy unknown', e);
  }
  try {
    const { default: store } = await import('@/model/store2');
    const mounted = store.state.diagram;
    const target: Diagram = mounted && toRaw(mounted) === doc ? mounted : doc;
    if (verdict) {
      target.isCopy = verdict.isCopy;
      target.copyReason = verdict.copyReason;
    }
    target.copyCheckPending = false;
  } catch (e) {
    // Store not available (tests/teardown) — still clear the raw doc.
    if (verdict) {
      doc.isCopy = verdict.isCopy;
      doc.copyReason = verdict.copyReason;
    }
    doc.copyCheckPending = false;
  }
}
