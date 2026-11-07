/**
 * Decide whether a macro mount should warm the paywall's macro-count cache
 * (`MacroMetrics.getMacroMetrics`, which on a cold KV does a space-wide
 * custom-content scan).
 *
 * Warm ONLY on edit-capable surfaces — the surfaces where
 * `useCustomerSuccessService.loadMacroMetrics` actually reads the count to
 * gate editing. On a pure viewer render nothing reads it, so warming there is
 * wasted work: on a cold KV each mount fires ~2 space-scan requests, and on a
 * macro-dense page (e.g. 16 macros) that stacks into multi-second `fetch_ms`
 * (the driver behind the P90 tail on multi-macro pages).
 *
 * Correctness note: this is a latency optimization, not a gate. The paywall's
 * own read does a bounded collect on a cold KV, so if a surface is mis-classified
 * as viewer the paywall still works — it just does the collect itself instead of
 * hitting a warm KV. The only thing that must not happen is warming on a pure
 * viewer surface, which is exactly what this predicate prevents.
 *
 * Mirrors the edit-surface notion in `forgeGlobal` (`isEditorMode` +
 * `isInserting`), kept as a pure function of the context so it is unit-testable
 * (`forgeIndex.ts` exports nothing).
 */
export interface MacroCountWarmContext {
  extension?: {
    modal?: { macroMode?: string } | null;
    macro?: { isConfiguring?: boolean; isInserting?: boolean } | null;
  } | null;
}

export function shouldWarmMacroCountCache(context: MacroCountWarmContext | null | undefined): boolean {
  const extension = context?.extension;
  if (!extension) return false;
  return (
    extension.modal?.macroMode === 'editor' ||
    extension.macro?.isConfiguring === true ||
    extension.macro?.isInserting === true
  );
}
