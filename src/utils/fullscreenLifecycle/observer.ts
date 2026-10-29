import { createFullscreenTiming, type FullscreenCloseReason, type FullscreenDurations } from './timing';
import { isFullscreenSignal, type FullscreenSession } from './bridge';

/** Parent iframe owns modal timing and listens only to this modal's receipts. */
export function createFullscreenObserver(options: {
  session: FullscreenSession;
  doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  emit: (value: FullscreenDurations) => Promise<void>;
  now?: () => number;
}) {
  const { session, doc, win, emit } = options;
  const timing = createFullscreenTiming(session.startedAt, doc.visibilityState === 'visible', options.now);
  const visibility = () => timing.visibility(doc.visibilityState === 'visible');
  const pagehide = () => { void close('page_unload'); };
  let detached = false;
  function detach() {
    if (detached) return;
    detached = true;
    doc.removeEventListener('visibilitychange', visibility);
    win.removeEventListener('pagehide', pagehide);
  }
  async function close(reason: FullscreenCloseReason) {
    const durations = timing.close(reason);
    if (!durations) return;
    detach();
    await emit(durations);
  }
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('pagehide', pagehide);
  return {
    receive(payload: unknown) {
      if (!isFullscreenSignal(payload, session.id)) return;
      if (payload.ready) timing.ready();
      else timing.setPhase(payload.phase);
    },
    close,
    detach,
  };
}
