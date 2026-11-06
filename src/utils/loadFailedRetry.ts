// "Try again" on the load-failed recovery panel is a bare location.reload()
// (GenericViewer.vue). The click and its result therefore land in two different
// page lifetimes, and nothing in Mixpanel could join them: 2026-08-18..22
// produced 391 external load_failed_shown impressions across 128 macros with no
// way to tell a transient fetch failure (recovers on reload) from a diagram
// that is permanently gone. This marker carries the click across the reload.
//
// sessionStorage, not localStorage: the marker must die with the browser tab —
// a retry that the user abandons has no outcome to report, and a marker that
// outlived the tab would attribute the next session's first render to it.
// Every macro on a page renders in the same Forge iframe origin and so shares
// one sessionStorage, which is why the key carries the macro's own identity.

const KEY_PREFIX = 'zenumlLoadFailedRetry:';

// Long enough for a slow Confluence page to finish reloading, short enough that
// a user who retried, walked away, and came back to a working diagram is not
// counted as a recovery.
export const RETRY_MARKER_TTL_MS = 10 * 60 * 1000;

export interface RetryMarker {
  /** 1 for the first retry of this macro in this tab, 2 for the next, ... */
  attempt: number;
  /** Epoch ms at which the retry click happened. */
  startedAt: number;
  /**
   * True while the outcome of that click is still owed. The viewer iframe can
   * remount without a retry (a scroll back into view, a fullscreen open), so a
   * marker that stayed `pending` after its outcome was reported would emit a
   * second, invented resolution. `attempt` survives the flip so that the next
   * click on the same macro is numbered 2, not 1.
   */
  pending: boolean;
}

function keyFor(macroKey: string): string {
  return `${KEY_PREFIX}${macroKey}`;
}

function write(macroKey: string, marker: RetryMarker): void {
  try {
    sessionStorage.setItem(keyFor(macroKey), JSON.stringify(marker));
  } catch {
    // Storage blocked (sandboxed iframe, site data disabled). The click event
    // still ships; only its outcome is lost.
  }
}

export function readRetryMarker(
  macroKey: string,
  now: number = Date.now()
): RetryMarker | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(keyFor(macroKey));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearRetryMarker(macroKey);
    return null;
  }

  const marker = parsed as Partial<RetryMarker> | null;
  if (
    !marker ||
    typeof marker.attempt !== 'number' ||
    typeof marker.startedAt !== 'number' ||
    typeof marker.pending !== 'boolean'
  ) {
    clearRetryMarker(macroKey);
    return null;
  }

  if (now - marker.startedAt > RETRY_MARKER_TTL_MS) {
    clearRetryMarker(macroKey);
    return null;
  }

  return {
    attempt: marker.attempt,
    startedAt: marker.startedAt,
    pending: marker.pending,
  };
}

/** Records a retry click. Returns the attempt number it recorded. */
export function startRetryMarker(
  macroKey: string,
  now: number = Date.now()
): number {
  const previous = readRetryMarker(macroKey, now);
  const attempt = (previous?.attempt ?? 0) + 1;
  write(macroKey, { attempt, startedAt: now, pending: true });
  return attempt;
}

/** Marks the outcome of a retry as reported, keeping the attempt count. */
export function settleRetryMarker(
  macroKey: string,
  now: number = Date.now()
): void {
  const marker = readRetryMarker(macroKey, now);
  if (!marker) return;
  write(macroKey, { ...marker, pending: false });
}

export function clearRetryMarker(macroKey: string): void {
  try {
    sessionStorage.removeItem(keyFor(macroKey));
  } catch {
    // Nothing to do — a marker we cannot remove also cannot be read.
  }
}

/**
 * Indirection so the retry path stays testable: jsdom's location.reload throws
 * "Not implemented", and a component test must be able to assert the reload
 * happened without navigating the test runner.
 */
export function reloadViewer(): void {
  location.reload();
}
