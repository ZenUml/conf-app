import {
  isExportSessionClosePayload,
  isExportSessionEventPayload,
} from './exportSession';

/**
 * Opening the fullscreen export modal and keeping the export-state listener
 * alive for exactly as long as that modal exists.
 *
 * This is its own unit because the lifetime is the part that breaks: the bridge
 * resolves `open()` when the modal has OPENED, not when it closes, so a
 * `finally` around the await unsubscribes seconds into the session and every
 * annotation the child makes is lost. That failure needs a real Forge modal to
 * observe — unless the orchestration is injectable, which is what this is.
 */
export interface ExportSessionHandoffDeps {
  /** This window's macro; events from any other macro are not ours. */
  macroUuid: string;
  /** Subscribe to the bridge event. May reject — the handoff is best-effort. */
  subscribe: (handler: (payload?: unknown) => void) => Promise<unknown>;
  /** Open the modal, wiring the given callback as its `onClose`. */
  open: (onClose: (payload?: unknown) => void) => Promise<unknown>;
  /** Apply a snapshot the child sent, live or in its close payload. */
  onSnapshot: (snapshot: unknown) => void;
  /** Runs after the listener is disposed, for the caller's own close policy. */
  onClosed: (payload?: unknown) => void;
}

function disposeSubscription(subscription: unknown): void {
  if (typeof subscription === 'function') {
    subscription();
    return;
  }
  if (typeof subscription === 'object' && subscription !== null) {
    const unsubscribe = (subscription as { unsubscribe?: unknown }).unsubscribe;
    if (typeof unsubscribe === 'function') unsubscribe.call(subscription);
  }
}

export async function openWithExportSessionHandoff(
  deps: ExportSessionHandoffDeps,
): Promise<void> {
  let subscription: unknown;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeSubscription(subscription);
  };

  // The listener must be live before the child iframe opens: its first
  // annotation write can happen as soon as the fullscreen export UI mounts.
  try {
    subscription = await deps.subscribe((payload?: unknown) => {
      if (!isExportSessionEventPayload(payload) || payload.macro_uuid !== deps.macroUuid) return;
      // Receiver writes never publish, otherwise the fullscreen child would
      // echo its own bridge event forever.
      deps.onSnapshot(payload.snapshot);
    });
  } catch (error) {
    // A bridge without Events still gets the context seed and keeps the
    // existing fullscreen path usable; the handoff is best-effort.
    console.warn('[exportSession] bridge listener unavailable:', error);
  }

  try {
    await deps.open((payload?: unknown) => {
      if (isExportSessionClosePayload(payload)) {
        deps.onSnapshot(payload.exportSession);
      }
      dispose();
      deps.onClosed(payload);
    });
  } catch (error) {
    // The modal never opened, so onClose will never run and the listener would
    // leak for the life of the page.
    dispose();
    throw error;
  }
  // No `finally`: a resolved open means the modal is on screen, not closed.
}
