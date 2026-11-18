import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(() => Promise.resolve()),
}));

import { trackAnalyticsEvent, trackAnalyticsEventBeforeUnload } from '@/utils/analytics/trackAnalyticsEvent';
import {
  endFullscreenZoomSession,
  noteFullscreenZoomControl,
  rebaseFullscreenZoom,
  startFullscreenZoomSession,
  SUMMARY_IDLE_MS,
} from './fullscreenZoomSummary';
import { trackViewportControl } from './trackViewportControl';

const KEEP = () => 0.05;
const DROP = () => 0.5;

function setFullscreen(on: boolean) {
  (window as any).forgeGlobal = on
    ? { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } }
    : undefined;
}

const summaries = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'fullscreen_zoom_summary');

describe('fullscreenZoomSummary', () => {
  let scale: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(trackAnalyticsEvent).mockClear();
    vi.mocked(trackAnalyticsEventBeforeUnload).mockClear();
    setFullscreen(true);
    scale = 1;
  });

  afterEach(() => {
    endFullscreenZoomSession();
    vi.mocked(trackAnalyticsEventBeforeUnload).mockClear();
    vi.useRealTimers();
    setFullscreen(false);
  });

  const start = (rng = KEEP) =>
    startFullscreenZoomSession({ macroType: 'mermaid', readScale: () => scale, rng });

  it('sends nothing outside Fullscreen', () => {
    setFullscreen(false);
    start();
    noteFullscreenZoomControl('zoom_in', 'toolbar');
    vi.advanceTimersByTime(SUMMARY_IDLE_MS * 3);
    endFullscreenZoomSession();
    expect(summaries()).toHaveLength(0);
    expect(trackAnalyticsEventBeforeUnload).not.toHaveBeenCalled();
  });

  it('sends a zero-zoom row once the opened view settles, stamped with the per-view rate', () => {
    start();
    vi.advanceTimersByTime(SUMMARY_IDLE_MS - 1);
    expect(summaries()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0][1]).toMatchObject({
      feature_area: 'macro',
      surface: 'fullscreen',
      macro_type: 'mermaid',
      summary_seq: 1,
      summary_trigger: 'idle',
      zoom_in_clicks: 0,
      zoom_out_clicks: 0,
      fit_clicks: 0,
      wheel_gestures: 0,
      zoom_ratio_end: 1,
      zoom_ratio_max: 1,
      sample_rate: 0.1,
    });
    expect(typeof summaries()[0][1].zoom_session_id).toBe('string');
  });

  it('drops every row of a view that is not sampled', () => {
    start(DROP);
    noteFullscreenZoomControl('zoom_in', 'toolbar');
    vi.advanceTimersByTime(SUMMARY_IDLE_MS * 3);
    endFullscreenZoomSession();
    expect(summaries()).toHaveLength(0);
    expect(trackAnalyticsEventBeforeUnload).not.toHaveBeenCalled();
  });

  it('counts toolbar clicks and wheel gestures and reports scale against the opening scale', () => {
    scale = 0.8;
    start();
    scale = 1.0; noteFullscreenZoomControl('zoom_in', 'toolbar');
    scale = 1.6; noteFullscreenZoomControl('zoom_in', 'toolbar');
    scale = 1.2; noteFullscreenZoomControl('zoom_out', 'toolbar');
    noteFullscreenZoomControl('fit_width', 'toolbar');
    noteFullscreenZoomControl('zoom_in', 'wheel');
    vi.advanceTimersByTime(SUMMARY_IDLE_MS);
    const row = summaries().at(-1)![1];
    expect(row).toMatchObject({
      zoom_in_clicks: 2,
      zoom_out_clicks: 1,
      fit_clicks: 1,
      wheel_gestures: 1,
      summary_seq: 1,
    });
    expect(row.zoom_ratio_end).toBeCloseTo(1.5, 5);
    expect(row.zoom_ratio_max).toBeCloseTo(2, 5);
  });

  it('waits for the reader to stop before sending, then sends the running totals again', () => {
    start();
    vi.advanceTimersByTime(SUMMARY_IDLE_MS);
    expect(summaries()).toHaveLength(1);
    noteFullscreenZoomControl('zoom_in', 'toolbar');
    vi.advanceTimersByTime(SUMMARY_IDLE_MS / 2);
    noteFullscreenZoomControl('zoom_in', 'toolbar');
    vi.advanceTimersByTime(SUMMARY_IDLE_MS - 1);
    expect(summaries()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(summaries()).toHaveLength(2);
    expect(summaries()[1][1]).toMatchObject({ summary_seq: 2, zoom_in_clicks: 2 });
    expect(summaries()[1][1].zoom_session_id).toBe(summaries()[0][1].zoom_session_id);
  });

  it('follows the opening scale until the first zoom (a resize re-fits the view)', () => {
    scale = 2;
    start();
    scale = 1; rebaseFullscreenZoom(); // ResizeObserver re-fit before any control
    scale = 1.25; noteFullscreenZoomControl('zoom_in', 'toolbar');
    scale = 3; rebaseFullscreenZoom(); // after a zoom, a re-fit is not a new opening
    scale = 1.25;
    vi.advanceTimersByTime(SUMMARY_IDLE_MS);
    expect(summaries().at(-1)![1].zoom_ratio_end).toBeCloseTo(1.25, 5);
  });

  it('flushes unsent totals at teardown through the unload transport, once', () => {
    start();
    vi.advanceTimersByTime(SUMMARY_IDLE_MS);
    noteFullscreenZoomControl('zoom_in', 'toolbar');
    endFullscreenZoomSession();
    endFullscreenZoomSession();
    expect(trackAnalyticsEventBeforeUnload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackAnalyticsEventBeforeUnload).mock.calls[0]).toEqual([
      'fullscreen_zoom_summary',
      expect.objectContaining({ summary_seq: 2, summary_trigger: 'unload', zoom_in_clicks: 1 }),
    ]);
    vi.advanceTimersByTime(SUMMARY_IDLE_MS * 2);
    expect(summaries()).toHaveLength(1);
  });

  it('sends nothing at teardown when the last row is current', () => {
    start();
    vi.advanceTimersByTime(SUMMARY_IDLE_MS);
    endFullscreenZoomSession();
    expect(trackAnalyticsEventBeforeUnload).not.toHaveBeenCalled();
  });

  it('is fed by trackViewportControl, the one call site of every renderer', () => {
    start();
    trackViewportControl({ macroType: 'mermaid', viewportAction: 'zoom_in', viewportInput: 'toolbar', isDisplayMode: true });
    trackViewportControl({ macroType: 'mermaid', viewportAction: 'zoom_out', viewportInput: 'wheel', isDisplayMode: true });
    vi.advanceTimersByTime(SUMMARY_IDLE_MS);
    expect(summaries().at(-1)![1]).toMatchObject({ zoom_in_clicks: 1, wheel_gestures: 1 });
  });
});
