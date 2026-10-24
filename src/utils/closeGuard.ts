// Why this exists
// ---------------
// The previous approach used `window.addEventListener('beforeunload', ...)`,
// betting that the browser's native "Leave site?" dialog would block the
// Atlassian header X close. It does not: when a parent page JS-destroys an
// iframe (which is how Atlassian closes the modal), browsers fire
// `beforeunload` listeners but suppress the confirm dialog by design. The
// synthetic-dispatch tests passed because they checked `defaultPrevented`,
// which proves the listener is registered, not that the user-facing dialog
// appears.
//
// What we use instead
// -------------------
// `view.onClose()` from `@forge/bridge` (added before the fullscreen GA on
// 2026-04-28). Atlassian's documented contract: the registered handler runs
// BEFORE the iframe is destroyed, so we can flush state. We use it to
// (a) flush a pending debounced draft save synchronously, and
// (b) optionally fire the existing `EventBus.$emit("save")` flow so the
//     close acts as an autosave.
//
// Caveats
// -------
// 1. ashraf.teleb85 reported (Forge EAP thread, 2026-03-03) that the iframe
//    is sometimes destroyed BEFORE `view.onClose` finishes. Atlassian asked
//    for a repro and never published a fix. So the per-keystroke draft in
//    localStorage is the safety net — `view.onClose` is best-effort.
// 2. The handler must do as little async work as possible. Treat it like a
//    `pagehide` listener: synchronous writes only.

import { view } from '@forge/bridge';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

export interface CloseGuardHandler {
  // Called when Atlassian fires the close. Should be cheap and (mostly)
  // synchronous. Returning a Promise is allowed but not relied upon for
  // correctness — the iframe may be destroyed before it resolves.
  (): void | Promise<void>;
}

// Forge documents one onClose callback, but does not promise that registering
// another preserves the first. Keep one bridge callback for this iframe and
// dispatch to every local subscriber (draft flush, cancellation telemetry,
// etc.). Records are distinct even when callers pass the same function.
const handlers = new Set<{ handler: CloseGuardHandler }>();
let bridgeRegistration: 'idle' | 'pending' | 'registered' = 'idle';

function reportHandlerError(error: unknown): void {
  console.error('[closeGuard] handler error:', error);
}

function dispatchClose(): Promise<void> {
  const pending: Promise<void>[] = [];
  // Start every active callback synchronously. A slow or failed callback must
  // not prevent a later subscriber from flushing its own state before teardown.
  for (const record of Array.from(handlers)) {
    // An earlier callback may have unmounted a later subscriber during this
    // dispatch. A newly registered subscriber is absent from the snapshot.
    if (!handlers.has(record)) continue;
    try {
      const result = record.handler();
      if (result) pending.push(Promise.resolve(result).catch(reportHandlerError));
    } catch (error) {
      reportHandlerError(error);
    }
  }
  // Preserve the bridge callback's wait contract while isolating failures.
  return Promise.all(pending).then(() => undefined);
}

function reportRegistrationFailure(error: unknown): void {
  bridgeRegistration = 'idle';
  trackAnalyticsEvent('close_guard_rejected', { feature_area: 'system', surface: 'editor' });
  console.warn('[closeGuard] view.onClose rejected, ignoring:', error);
}

function registerBridgeCallback(): void {
  if (bridgeRegistration !== 'idle') return;

  // view.onClose returns a Promise<void>; the handler stays registered for
  // the lifetime of the view. There is no documented unregister API, so the
  // single bridge hook survives periods with zero local subscribers.
  //
  // Defensive guard: if @forge/bridge is older than 5.16 (or running in a
  // non-Forge sandbox), `view.onClose` may be undefined. We swallow the
  // failure so the caller's mount logic — including the per-keystroke draft
  // saver — still completes. The localStorage draft is the safety net.
  try {
    if (typeof (view as any).onClose === 'function') {
      bridgeRegistration = 'pending';
      void Promise.resolve((view as any).onClose(dispatchClose)).then(
        () => { bridgeRegistration = 'registered'; },
        reportRegistrationFailure,
      );
    } else {
      console.warn('[closeGuard] view.onClose unavailable — relying on per-keystroke draft only.');
    }
  } catch (e) {
    bridgeRegistration = 'idle';
    trackAnalyticsEvent('close_guard_rejected', { feature_area: 'system', surface: 'editor' });
    console.warn('[closeGuard] view.onClose threw, ignoring:', e);
  }
}

export function setupCloseGuard(handler: CloseGuardHandler): () => void {
  const record = { handler };
  handlers.add(record);
  // A failed registration keeps all subscribers. A later explicit setup call
  // retries once; no background retry loop can race the host's close.
  registerBridgeCallback();

  return () => {
    handlers.delete(record);
  };
}
