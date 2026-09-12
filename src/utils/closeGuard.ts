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

const handlers = new Map<symbol, CloseGuardHandler>();
let dispatcherRegistered = false;

async function dispatchClose(): Promise<void> {
  const pending: Promise<void>[] = [];

  // Start every listener synchronously. A close can destroy this iframe at any
  // time, so awaiting one listener before starting the next can lose outcomes.
  for (const handler of handlers.values()) {
    try {
      const result = handler();
      if (result && typeof (result as Promise<void>).then === 'function') {
        pending.push(Promise.resolve(result).catch((e) => {
          console.error('[closeGuard] handler error:', e);
        }));
      }
    } catch (e) {
      console.error('[closeGuard] handler error:', e);
    }
  }

  await Promise.all(pending);
}

function registerDispatcher(): void {
  if (dispatcherRegistered) return;
  dispatcherRegistered = true;

  try {
    if (typeof (view as any).onClose === 'function') {
      void (view as any).onClose(dispatchClose).catch((e: unknown) => {
        dispatcherRegistered = false;
        trackAnalyticsEvent('close_guard_rejected', { feature_area: 'system', surface: 'editor' });
        console.warn('[closeGuard] view.onClose rejected, ignoring:', e);
      });
    } else {
      dispatcherRegistered = false;
      console.warn('[closeGuard] view.onClose unavailable — relying on per-keystroke draft only.');
    }
  } catch (e) {
    dispatcherRegistered = false;
    console.warn('[closeGuard] view.onClose threw, ignoring:', e);
  }
}

export function setupCloseGuard(handler: CloseGuardHandler): () => void {
  const subscription = Symbol('closeGuard');
  handlers.set(subscription, handler);

  // Forge retains only one onClose callback per iframe. Keep that callback for
  // the view lifetime and fan out locally so independent editor concerns such
  // as draft saving and close-outcome telemetry cannot replace each other.
  //
  // Defensive guard: if @forge/bridge is older than 5.16 (or running in a
  // non-Forge sandbox), `view.onClose` may be undefined. We swallow the
  // failure so the caller's mount logic — including the per-keystroke draft
  // saver — still completes. The localStorage draft is the safety net.
  registerDispatcher();

  return () => {
    handlers.delete(subscription);
  };
}
