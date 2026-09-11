// src/utils/analytics/editorCloseOutcome.ts
//
// Records the outcome of an editor session that ends WITHOUT a save:
// macro_create_cancelled / macro_edit_cancelled.
//
// Why a dedicated module
// ----------------------
// The Forge editors have exactly one close control the user can reach: the
// Atlassian modal X. The host handles it by destroying the iframe, so nothing
// in the app's own exit handlers runs — the "close without saving" dialog in
// forgeIndex.ts is reachable only from a header exit button that no longer
// exists. The result, measured 2026-09-11: macro_edit_cancelled had fired 0
// times in 12 weeks while ~17% of customer edit sessions (1-hour window)
// never reached macro_save_succeeded. This module fills that gap.
//
// Mechanism
// ---------
// `view.onClose` (via setupCloseGuard) runs before the host destroys the
// iframe. On that callback, if no save has been marked for this iframe, emit
// the cancelled event with the sendBeacon transport so it survives the
// teardown. Any editor that does reach an explicit discard path calls
// trackEditorClosedWithoutSave itself with a more specific close_source; the
// module is idempotent, so the later host close does not double count.
//
// `markEditorSaved()` is called by the persistence layer the moment a save is
// known to have succeeded — NOT on the EventBus 'saved' signal, which every
// editor emits only after `view.submit()` resolves, by which time onClose may
// already have run.
//
// One editor per iframe, so module-level state is sufficient (same reasoning
// as publishTiming.ts).

import { setupCloseGuard } from "@/utils/closeGuard";
import type { MacroTypeValue } from "./catalog";
import { getEditorMutationSummary } from "./editorMutationTelemetry";
import { trackAnalyticsEventBeforeUnload } from "./trackAnalyticsEvent";
import type { AnalyticsProperties } from "./types";

export type EditorCloseSource = NonNullable<AnalyticsProperties["close_source"]>;

export interface EditorCloseTrackingConfig {
  // Read at close time: the shared DSL editor lets the user switch type tabs
  // after mount, so a snapshot taken at registration would be stale.
  getMacroType: () => MacroTypeValue;
  operationMode: "create" | "edit";
  // Read at close time. Omit when the editor cannot tell (AsyncAPI Studio,
  // embed picker); the property is then left off the event.
  hadChanges?: () => boolean;
}

let activeConfig: EditorCloseTrackingConfig | null = null;
let mountedAt: number | null = null;
let armed = false;
let saved = false;
let outcomeSent = false;

/**
 * Register the current editor iframe for close-outcome tracking. Returns a
 * teardown that unhooks the host close listener; call it from the component's
 * unmount so a later remount in the same iframe (rare) starts clean.
 */
export function registerEditorCloseTracking(
  config: EditorCloseTrackingConfig,
): () => void {
  activeConfig = config;
  mountedAt = Date.now();
  saved = false;
  outcomeSent = false;

  const off = setupCloseGuard(() => trackEditorClosedWithoutSave("host_close"));

  return () => {
    off();
    if (activeConfig === config) activeConfig = null;
  };
}

/**
 * The authoring session started — call it beside every macro_create_started /
 * macro_edit_started emit. Cancelled events are emitted only for armed
 * sessions, so they stay a subset of the funnel's entry step: on Lite the
 * editors mount under the paywall gate BEFORE the start event fires, and a
 * user who closes the gate never started authoring (paywall_blocked_edit
 * already records that). Order-independent with registration: the start event
 * may fire before or after the component that registers has mounted.
 */
export function markEditorAuthoringStarted(): void {
  armed = true;
}

/** The save succeeded; a following close is not a cancellation. */
export function markEditorSaved(): void {
  saved = true;
}

/**
 * Emit the cancelled event for the registered editor, once. No-op when no
 * editor is registered, a save was marked, or the outcome was already sent.
 * Also a no-op when the session was never armed (see
 * markEditorAuthoringStarted). Returns the tracking promise so a caller that
 * is about to call `view.close()` itself can await the enrichment (see
 * trackAnalyticsEventBeforeUnload); the host-close path cannot wait and
 * relies on sendBeacon alone.
 */
export function trackEditorClosedWithoutSave(
  closeSource: EditorCloseSource,
): Promise<void> {
  if (!activeConfig || !armed || saved || outcomeSent) return Promise.resolve();
  outcomeSent = true;

  const config = activeConfig;
  let hadChanges: boolean | undefined;
  try {
    hadChanges = config.hadChanges?.();
  } catch {
    hadChanges = undefined;
  }

  const eventName =
    config.operationMode === "edit"
      ? "macro_edit_cancelled"
      : "macro_create_cancelled";

  return trackAnalyticsEventBeforeUnload(eventName, {
    feature_area: "macro",
    surface: "editor",
    macro_type: config.getMacroType(),
    operation_mode: config.operationMode,
    close_source: closeSource,
    ...(hadChanges !== undefined ? { had_changes: hadChanges } : {}),
    ...(mountedAt !== null
      ? { editor_open_duration_ms: Math.max(0, Date.now() - mountedAt) }
      : {}),
    // Text-editor sessions carry the same replace/delta summary as
    // macro_save_succeeded; empty for the other editors.
    ...getEditorMutationSummary(),
  });
}

// Test-only: reset module state between cases.
export function _resetEditorCloseOutcomeForTesting(): void {
  activeConfig = null;
  mountedAt = null;
  armed = false;
  saved = false;
  outcomeSent = false;
}
