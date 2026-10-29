import { describe, expect, it } from 'vitest';
import { createFullscreenTiming } from './timing';

describe('fullscreen lifecycle timing', () => {
  it('separates modal, ready-diagram and visible durations', () => {
    let time = 1000;
    const timing = createFullscreenTiming(time, true, () => time);
    time = 2000; expect(timing.ready()).toBe(true);
    time = 5000; timing.visibility(false);
    time = 9000; timing.visibility(true);
    time = 11000;
    expect(timing.close('unknown')).toMatchObject({ fullscreen_modal_duration_ms: 10000, fullscreen_diagram_duration_ms: 9000, fullscreen_visible_duration_ms: 5000, fullscreen_phase: 'diagram' });
    expect(timing.close('unknown')).toBeUndefined();
  });
  it('does not report diagram time when closed before readiness', () => {
    let time = 1000;
    const timing = createFullscreenTiming(time, true, () => time);
    timing.setPhase('request'); time = 2000;
    expect(timing.close('return_inline')).toEqual({ fullscreen_modal_duration_ms: 1000, fullscreen_phase: 'request', fullscreen_close_reason: 'return_inline', fullscreen_close_delivery: 'normal' });
  });
  it('counts a background-opened diagram only after visibility and ignores duplicate ready', () => {
    let time = 0; const timing = createFullscreenTiming(0, false, () => time);
    time = 100; expect(timing.ready()).toBe(true); expect(timing.ready()).toBe(false);
    time = 200; timing.visibility(true); time = 350;
    expect(timing.close('page_unload')).toMatchObject({ fullscreen_diagram_duration_ms: 250, fullscreen_visible_duration_ms: 150, fullscreen_close_delivery: 'best_effort' });
  });
  it('excludes request-overlay time from visible diagram time', () => {
    let time = 0; const timing = createFullscreenTiming(0, true, () => time);
    timing.ready(); time = 100; timing.setPhase('request');
    time = 300; timing.setPhase('diagram'); time = 400;
    expect(timing.close('unknown')).toMatchObject({ fullscreen_diagram_duration_ms: 400, fullscreen_visible_duration_ms: 200 });
  });
  it('does not double count visible time when the wall clock moves backwards', () => {
    let time = 1000; const timing = createFullscreenTiming(time, true, () => time);
    time = 2000; timing.ready();
    time = 3000; timing.visibility(false);
    time = 2500; timing.visibility(true);
    time = 4000;
    expect(timing.close('unknown')).toMatchObject({ fullscreen_visible_duration_ms: 2000, fullscreen_diagram_duration_ms: 2000 });
  });
});
