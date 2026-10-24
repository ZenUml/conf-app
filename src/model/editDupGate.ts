// Decision logic for the in-viewer Edit click gate, extracted (writebackGate
// style) so it can be unit-tested — the live call sits inside the EventBus
// 'edit' listener in forgeIndex.ts.
//
// Why the gate exists: a macro whose customContentId is shared by more than
// one macro on the SAME page can be view-edited, but saving forks a new
// custom content (isCopy branch in CustomContentStorageProvider.save, and the
// count>1 branch in ApWrapper2.saveCustomContentV2) and the in-viewer modal
// cannot write the new id back into the macro config (writebackGate.ts /
// #170: view.submit is only valid when inserting/configuring). The fork then
// sits unreferenced on the page and the user's edit silently vanishes —
// runtime-proven by tests/e2e-tests/tests/fullscreen/spot-check-view-fork.spec.ts.
//
// Blocking must happen BEFORE the modal opens: inside the modal the user has
// already invested editing effort and would only find out at Publish.
//
// The viewer cannot know this at render time: viewer loads run the
// zero-network 'cross-page-only' copy check (PR #370 removed the per-render
// ADF scan for performance), so same-page duplicates are invisible until we
// scan on demand. An Edit click is rare enough to pay one full-page ADF GET.

export type EditDupGateOutcome = 'no_id' | 'passed' | 'blocked' | 'scan_failed';

export interface EditDupGateResult {
  /** open the editor modal when true. */
  openEditor: boolean;
  outcome: EditDupGateOutcome;
  /** macros on this page referencing the id; undefined when not scanned / scan failed. */
  count?: number;
}

export function decideEditDupGate(s: {
  /** the macro config carries a customContentId (something shareable exists). */
  hasId: boolean;
  /** result of ApWrapper2.countMacrosReferencing; undefined = the scan threw. */
  count: number | undefined;
}): EditDupGateResult {
  if (!s.hasId) return { openEditor: true, outcome: 'no_id' };
  if (s.count === undefined) {
    // Fail-open: a transient ADF fetch error must not lock the Edit
    // affordance. The editor-side Publish backstop (publishBlock below)
    // still guards the fork-without-writeback path.
    return { openEditor: true, outcome: 'scan_failed' };
  }
  // count 0 = draft-only binding or stale published ADF (ZEN-#169) — not a
  // duplicate. count 1 = the normal unique reference.
  return s.count > 1
    ? { openEditor: false, outcome: 'blocked', count: s.count }
    : { openEditor: true, outcome: 'passed', count: s.count };
}

// ── Editor-side backstop ────────────────────────────────────────────────────
// When a doc flagged isCopy still reaches an editor surface where
// view.submit({config}) cannot persist (gate fail-open, staleness-hint CTA on
// an inline page-editor render, or any future non-submittable entry), saving
// would fork a CC that can never be linked to the macro. The backstop disables
// Publish up front (Header.vue reads store.state.publishBlock) instead of
// letting #170's silent view.close() strand the fork.

export type PublishBlockReason = 'same-page-duplicate' | 'cross-page';

export const PUBLISH_BLOCK_MESSAGES: Record<PublishBlockReason, string> = {
  'same-page-duplicate':
    'This diagram has multiple copies on this page. To edit this one, open the page in edit mode and edit the macro there.',
  'cross-page':
    'This diagram lives on another page. Edit it there, or open this page in edit mode and edit the macro there.',
};

export function decidePublishBlock(s: {
  /** doc.isCopy — the editor's blocking detectCopy verdict. */
  isCopy: boolean;
  copyReason: PublishBlockReason | undefined;
  /** context.extension.macro.isInserting — page-editor slash-menu insert. */
  inserting: boolean;
  /** context.extension.macro.isConfiguring — native macro-config editor. */
  configuring: boolean;
}): PublishBlockReason | null {
  // Inserting/configuring are the ONLY submittable surfaces (writebackGate.ts)
  // — there the save-fork is followed by a config writeback and is the
  // INTENDED copy-repair flow. Never block those.
  if (s.inserting || s.configuring) return null;
  if (!s.isCopy || !s.copyReason) return null;
  return s.copyReason;
}
