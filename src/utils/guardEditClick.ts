import globals from '@/model/globals';
import store from '@/model/store2';
import { toast } from '@/utils/toast';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { type MacroTypeValue } from '@/utils/analytics/catalog';
import { decideEditDupGate, PUBLISH_BLOCK_MESSAGES, type EditDupGateResult } from '@/model/editDupGate';

// Runtime half of the in-viewer Edit gate (decision logic: model/editDupGate.ts).
//
// Two facts force the caching here:
//
//  1. `index.html` → `forgeIndex.ts` is the single Custom UI entry for EVERY
//     macro type (macroEntryRouting.ts), and each non-sequence type ALSO
//     registers its own EventBus 'edit' listener (forge-graph-viewer /
//     forge-swagger-ui / forge-asyncapi-viewer) that opens a modal on its own.
//     Verified on lite-dev 2026-07-29: one graph Edit click reaches BOTH.
//     So every listener must consult the gate — a listener that skips it would
//     open the modal the other one just refused.
//  2. The gate costs one full-page ADF GET (~320-350ms measured), so it must be
//     paid ONCE per click, not once per listener.
//
// Hence: memoize the verdict per custom-content id, and run the block's side
// effects exactly once inside that shared promise.
const VERDICT_TTL_MS = 5_000;

let cached: { key: string; at: number; promise: Promise<EditDupGateResult> } | null = null;

/** Test seam — drops the memoized verdict. */
export function __resetEditGateCache(): void {
  cached = null;
}

async function scan(ccId: string): Promise<EditDupGateResult> {
  let count: number | undefined;
  try {
    count = await globals.apWrapper.countMacrosReferencing(ccId);
  } catch (e) {
    // Fail-open: a transient ADF fetch error must never lock the Edit
    // affordance. The editor-side publishBlock floor still guards the save.
    console.warn('edit dup-gate scan failed (fail-open)', e);
  }
  return decideEditDupGate({ hasId: true, count });
}

function applyVerdict(gate: EditDupGateResult, macroType: MacroTypeValue): EditDupGateResult {
  trackAnalyticsEvent('edit_dup_gate_evaluated', {
    feature_area: 'macro',
    surface: 'viewer',
    macro_type: macroType,
    edit_dup_gate_outcome: gate.outcome as 'blocked' | 'passed' | 'scan_failed',
    ...(gate.count !== undefined && { same_page_macro_count: gate.count }),
  });
  if (!gate.openEditor) {
    // Flip the already-rendered viewer into the same disabled-Edit state a
    // cross-page copy gets at load time — GenericViewer's editDisabledReason()
    // reacts to these two fields and explains on hover. Every viewer that
    // offers Edit wraps GenericViewer (graph / openapi / asyncapi / sequence).
    store.state.diagram.isCopy = true;
    store.state.diagram.copyReason = 'same-page-duplicate';
    toast({ message: PUBLISH_BLOCK_MESSAGES['same-page-duplicate'], duration: 8000 });
  }
  return gate;
}

/**
 * Consult the Edit dup gate for a viewer Edit click.
 * Returns true when the caller may open the editor modal.
 */
export async function guardEditClick(opts: {
  customContentId: string | undefined;
  macroType: MacroTypeValue;
}): Promise<boolean> {
  const { customContentId, macroType } = opts;
  // Nothing shareable yet (new macro / legacy uuid-only): nothing to gate.
  if (!customContentId) return true;

  const key = String(customContentId);
  const now = Date.now();
  if (!cached || cached.key !== key || now - cached.at > VERDICT_TTL_MS) {
    cached = { key, at: now, promise: scan(key).then((gate) => applyVerdict(gate, macroType)) };
  }
  const gate = await cached.promise;
  return gate.openEditor;
}
