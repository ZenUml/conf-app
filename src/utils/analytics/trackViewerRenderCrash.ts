// src/utils/analytics/trackViewerRenderCrash.ts
//
// reliability-audit-2026-08-06.md §3/§4/§12 items 1-2: mermaid.render() /
// zenuml.render() / GraphViewer construction / SwaggerUIBundle throwing were
// caught with `console.error` only — no Mixpanel signal reached either side
// of the render pipeline. For Mermaid+Sequence (81% of view volume) this made
// the "known failure rate" a floor on syntax-validation failures only, never
// a genuine render crash; for Graph specifically, `trackRenderTime` sits
// inside the same try block a crash escapes, so a broken graph macro fired
// NEITHER a success nor a failure event.
//
// This reuses the existing `viewer_load_failed` event (catalog.ts) rather
// than inventing a new one, with `failure_stage: 'render_crash'` as the
// discriminator against the pre-existing `store.state.error` ->
// GenericViewer watcher path, which only ever carries client-side
// syntax-validation failures (and, for PlantUML, its own fetch failures —
// see audit §2.1, §6; investigating that class is explicitly out of scope
// here). The two paths are kept separate on purpose: routing a genuine
// render crash through `store.dispatch('updateError', ...)` would also
// surface the editor's SyntaxErrorBox/AI-Repair UI for input that IS
// syntactically valid — a user-facing behavior change this fix must not
// introduce (task scope is measurement only, silent-degrade UX stays).
//
// Gated on `isDisplayMode`, mirroring GenericViewer's own guard on the
// `store.state.error` watcher, so an editor-preview crash isn't counted
// against the viewer-surface failure rate the audit measures.
import { trackAnalyticsEvent } from './trackAnalyticsEvent';
import type { MacroTypeValue } from './catalog';

export function trackViewerRenderCrash(
  macroType: MacroTypeValue,
  isDisplayMode: boolean,
  error: unknown,
): void {
  if (!isDisplayMode) return;
  const failure_reason =
    typeof error === 'string'
      ? error
      : ((error as { message?: string } | null)?.message ?? String(error));
  trackAnalyticsEvent('viewer_load_failed', {
    feature_area: 'macro',
    surface: 'viewer',
    macro_type: macroType,
    failure_reason,
    failure_stage: 'render_crash',
  });
}
