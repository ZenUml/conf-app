import { describe, expect, it, vi } from 'vitest';
import { IDLE_TIMEOUT_MS, scheduleWhenIdle } from './scheduleWhenIdle';

describe('scheduleWhenIdle', () => {
  it('prefers requestIdleCallback and bounds the wait with a timeout', () => {
    const run = vi.fn();
    const ric = vi.fn();
    const raf = vi.fn();

    scheduleWhenIdle(run, { requestIdleCallback: ric, requestAnimationFrame: raf });

    expect(ric).toHaveBeenCalledTimes(1);
    expect(ric.mock.calls[0][1]).toEqual({ timeout: IDLE_TIMEOUT_MS });
    // The render must not be raced: nothing runs synchronously, and rAF (which
    // fires before paint) is not used when the idle path is available.
    expect(run).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();

    ric.mock.calls[0][0]();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back to a macrotask AFTER the next paint when requestIdleCallback is missing', () => {
    const run = vi.fn();
    const raf = vi.fn();
    const later = vi.fn();

    scheduleWhenIdle(run, { requestAnimationFrame: raf, setTimeout: later });

    expect(raf).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();

    // rAF fires before paint, so the callback must hand off once more.
    raf.mock.calls[0][0]();
    expect(run).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(1);

    later.mock.calls[0][0]();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain macrotask when neither scheduler exists', () => {
    const run = vi.fn();
    const later = vi.fn();
    // jsdom supplies requestAnimationFrame (but not requestIdleCallback), so
    // omitting the deps is not enough to reach the bare-macrotask path — the
    // globals have to be taken away explicitly.
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('requestIdleCallback', undefined);

    try {
      scheduleWhenIdle(run, { setTimeout: later });

      expect(later).toHaveBeenCalledTimes(1);
      later.mock.calls[0][0]();
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('still runs the work when the scheduler itself throws', () => {
    const run = vi.fn();
    const later = vi.fn();
    const ric = vi.fn(() => {
      throw new Error('no idle callbacks here');
    });

    scheduleWhenIdle(run, { requestIdleCallback: ric, setTimeout: later });

    expect(later).toHaveBeenCalledTimes(1);
    later.mock.calls[0][0]();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from the scheduled work so the viewer is unaffected', () => {
    const boom = vi.fn(() => {
      throw new Error('scan blew up');
    });
    const ric = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    scheduleWhenIdle(boom, { requestIdleCallback: ric });
    expect(() => ric.mock.calls[0][0]()).not.toThrow();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
