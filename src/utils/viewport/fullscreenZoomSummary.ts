import { trackAnalyticsEvent, trackAnalyticsEventBeforeUnload } from '@/utils/analytics/trackAnalyticsEvent';
import { isFullscreenViewport } from '@/utils/viewport/surface';
import type { MacroTypeValue } from '@/utils/analytics/catalog';

/**
 * One reader's zooming in one Fullscreen view, summed into
 * `fullscreen_zoom_summary` (proposal P2: does Fullscreen open too small, and
 * does each zoom click move far enough?).
 *
 * Why a summary and not one event per click: the per-click
 * `viewport_control_used` is stopped by the event budget, and the question is
 * per view anyway (how many clicks, and where the reader ended).
 *
 * Why it sends on idle and not on close: Fullscreen is a Forge modal, and
 * closing it tears the iframe down. A send at teardown is best-effort (the
 * enrichment is async), so the totals go out SUMMARY_IDLE_MS after the view
 * settles — after opening, and again after each burst of zooming — and the
 * teardown send only adds what changed since.
 *
 * One Fullscreen modal holds one diagram in its own iframe, so module state is
 * one view.
 */

export const SUMMARY_IDLE_MS = 10_000;
/** Share of Fullscreen views that report. All rows of a kept view are sent. */
export const SUMMARY_SAMPLE_RATE = 0.1;

type ZoomAction = 'zoom_in' | 'zoom_out' | 'fit_height' | 'fit_width';
type ZoomInput = 'toolbar' | 'wheel';

interface Session {
  macroType: string;
  readScale: () => number;
  id: string;
  startedAt: number;
  openingScale: number;
  maxRatio: number;
  zoomInClicks: number;
  zoomOutClicks: number;
  fitClicks: number;
  wheelGestures: number;
  seq: number;
  /** Something changed since the last row was sent. */
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

let session: Session | null = null;

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readSafe(s: Session): number | null {
  try {
    const value = s.readScale();
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function currentRatio(s: Session): number {
  const scale = readSafe(s);
  if (scale === null || !(s.openingScale > 0)) return 1;
  const ratio = scale / s.openingScale;
  if (ratio > s.maxRatio) s.maxRatio = ratio;
  return ratio;
}

function hasControls(s: Session): boolean {
  return s.zoomInClicks + s.zoomOutClicks + s.fitClicks + s.wheelGestures > 0;
}

function row(s: Session, trigger: 'idle' | 'unload') {
  const end = currentRatio(s);
  s.seq += 1;
  s.dirty = false;
  return {
    feature_area: 'macro' as const,
    surface: 'fullscreen' as const,
    // Callers pass the renderer's own type string, as trackViewportControl does.
    macro_type: s.macroType as MacroTypeValue,
    zoom_session_id: s.id,
    summary_seq: s.seq,
    summary_trigger: trigger,
    zoom_in_clicks: s.zoomInClicks,
    zoom_out_clicks: s.zoomOutClicks,
    fit_clicks: s.fitClicks,
    wheel_gestures: s.wheelGestures,
    zoom_ratio_end: round(end),
    zoom_ratio_max: round(Math.max(s.maxRatio, end)),
    session_ms: Date.now() - s.startedAt,
    sample_rate: SUMMARY_SAMPLE_RATE,
  };
}

/**
 * Analytics must never break the viewer: the teardown send runs inside the
 * renderers' beforeUnmount, and the idle send inside a timer.
 */
function safeSend(send: () => unknown): void {
  try {
    const result = send();
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // dropped: a lost summary row is acceptable, a broken unmount is not
  }
}

function schedule(s: Session): void {
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = null;
    if (session !== s || !s.dirty) return;
    safeSend(() => trackAnalyticsEvent('fullscreen_zoom_summary', row(s, 'idle')));
  }, SUMMARY_IDLE_MS);
}

/**
 * Start the view's summary once its renderer has shown the opening scale.
 * `readScale` returns the renderer's current scale in any unit; the event
 * reports it divided by the opening scale. No-op outside Fullscreen and for
 * the 90% of views that are not sampled.
 */
export function startFullscreenZoomSession(options: {
  macroType: string;
  readScale: () => number;
  rng?: () => number;
}): void {
  if (!isFullscreenViewport()) return;
  if (session) return;
  const rng = options.rng ?? Math.random;
  if (!(rng() < SUMMARY_SAMPLE_RATE)) return;
  const s: Session = {
    macroType: options.macroType,
    readScale: options.readScale,
    id: newId(),
    startedAt: Date.now(),
    openingScale: 1,
    maxRatio: 1,
    zoomInClicks: 0,
    zoomOutClicks: 0,
    fitClicks: 0,
    wheelGestures: 0,
    seq: 0,
    dirty: true,
    timer: null,
  };
  s.openingScale = readSafe(s) ?? 1;
  session = s;
  if (typeof window !== 'undefined') window.addEventListener('pagehide', endFullscreenZoomSession);
  schedule(s);
}

/**
 * The renderer re-fitted the view on its own (e.g. the modal resized). Before
 * the reader's first zoom this is still the opening scale; after it, it is not.
 */
export function rebaseFullscreenZoom(): void {
  const s = session;
  if (!s || hasControls(s)) return;
  s.openingScale = readSafe(s) ?? s.openingScale;
}

/** Count one deliberate control. Call after the zoom has been applied. */
export function noteFullscreenZoomControl(action: ZoomAction, input: ZoomInput): void {
  const s = session;
  if (!s) return;
  if (input === 'wheel') s.wheelGestures += 1;
  else if (action === 'zoom_in') s.zoomInClicks += 1;
  else if (action === 'zoom_out') s.zoomOutClicks += 1;
  else s.fitClicks += 1;
  currentRatio(s);
  s.dirty = true;
  schedule(s);
}

/** Teardown: send what changed since the last row (best-effort), then stop. */
export function endFullscreenZoomSession(): void {
  const s = session;
  if (!s) return;
  session = null;
  if (s.timer) clearTimeout(s.timer);
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', endFullscreenZoomSession);
  if (s.dirty) safeSend(() => trackAnalyticsEventBeforeUnload('fullscreen_zoom_summary', row(s, 'unload')));
}
