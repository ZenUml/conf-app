export type FullscreenPhase = 'request' | 'expired' | 'diagram' | 'loading' | 'unknown';
export type FullscreenCloseReason = 'return_inline' | 'export_dismissed' | 'page_unload' | 'unknown';
export interface FullscreenDurations {
  fullscreen_modal_duration_ms: number;
  fullscreen_diagram_duration_ms?: number;
  fullscreen_visible_duration_ms?: number;
  fullscreen_phase: FullscreenPhase;
  fullscreen_close_reason: FullscreenCloseReason;
  fullscreen_close_delivery: 'normal' | 'best_effort';
}

/** Independent per-open timing. A ready receipt, not an open, starts diagram time. */
export function createFullscreenTiming(openedAt: number, initiallyVisible: boolean, now: () => number = Date.now) {
  let readyAt: number | undefined;
  let lastVisibleAt: number | undefined;
  let visibleMs = 0;
  let visible = initiallyVisible;
  let phase: FullscreenPhase = 'loading';
  let closed = false;
  let lastTime = openedAt;
  const current = () => (lastTime = Math.max(lastTime, now()));
  function accumulate(at: number) {
    if (lastVisibleAt !== undefined) visibleMs += Math.max(0, at - lastVisibleAt);
    lastVisibleAt = undefined;
  }
  return {
    setPhase(next: FullscreenPhase) {
      if (closed || next === phase) return;
      const at = current();
      if (visible && phase === 'diagram') accumulate(at);
      phase = next;
      if (visible && next === 'diagram' && readyAt !== undefined) lastVisibleAt = at;
    },
    ready() {
      if (closed || readyAt !== undefined) return false;
      readyAt = current();
      if (visible) lastVisibleAt = readyAt;
      phase = 'diagram';
      return true;
    },
    visibility(next: boolean) {
      if (closed || next === visible) return;
      const at = current();
      if (readyAt !== undefined) {
        if (visible) accumulate(at);
        if (next && phase === 'diagram') lastVisibleAt = at;
      }
      visible = next;
    },
    close(reason: FullscreenCloseReason): FullscreenDurations | undefined {
      if (closed) return undefined;
      closed = true;
      const at = current();
      if (visible) accumulate(at);
      return {
        fullscreen_modal_duration_ms: Math.max(0, at - openedAt),
        ...(readyAt === undefined ? {} : {
          fullscreen_diagram_duration_ms: Math.max(0, at - readyAt),
          fullscreen_visible_duration_ms: visibleMs,
        }),
        fullscreen_phase: phase,
        fullscreen_close_reason: reason,
        fullscreen_close_delivery: reason === 'page_unload' ? 'best_effort' : 'normal',
      };
    },
  };
}
