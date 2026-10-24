import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  callbacks: [] as Array<() => Promise<void>>,
  onClose: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@forge/bridge', () => ({ view: { onClose: bridge.onClose } }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: bridge.trackAnalyticsEvent,
}));

let setupCloseGuard: typeof import('./closeGuard').setupCloseGuard;

beforeEach(async () => {
  vi.resetModules(); // A fresh iframe and one bridge registration per case.
  bridge.callbacks.length = 0;
  bridge.onClose.mockReset().mockImplementation(async (callback: () => Promise<void>) => {
    bridge.callbacks.push(callback);
  });
  bridge.trackAnalyticsEvent.mockClear();
  ({ setupCloseGuard } = await import('./closeGuard'));
});

describe('setupCloseGuard', () => {
  it.each(['draft first', 'telemetry first'])('dispatches both subscribers with one bridge callback: %s', async (order) => {
    const draft = vi.fn();
    const telemetry = vi.fn();
    if (order === 'draft first') {
      setupCloseGuard(draft);
      setupCloseGuard(telemetry);
    } else {
      setupCloseGuard(telemetry);
      setupCloseGuard(draft);
    }

    expect(bridge.onClose).toHaveBeenCalledTimes(1);
    await bridge.callbacks[0]();
    expect(draft).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenCalledTimes(1);
  });

  it('tears down each registration independently, including duplicate functions and remounts', async () => {
    const handler = vi.fn();
    const firstOff = setupCloseGuard(handler);
    const secondOff = setupCloseGuard(handler);
    firstOff();
    firstOff();

    await bridge.callbacks[0]();
    expect(handler).toHaveBeenCalledTimes(1);

    secondOff();
    await bridge.callbacks[0]();
    expect(handler).toHaveBeenCalledTimes(1);

    setupCloseGuard(handler);
    expect(bridge.onClose).toHaveBeenCalledTimes(1);
    await bridge.callbacks[0]();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('skips a subscriber removed by an earlier callback and defers new subscribers', async () => {
    const removed = vi.fn();
    const added = vi.fn();
    let offRemoved = () => {};
    setupCloseGuard(() => {
      offRemoved();
      setupCloseGuard(added);
    });
    offRemoved = setupCloseGuard(removed);

    await bridge.callbacks[0]();
    expect(removed).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();

    await bridge.callbacks[0]();
    expect(added).toHaveBeenCalledTimes(1);
  });

  it('starts later subscribers despite a synchronous throw or rejected promise', async () => {
    const later = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupCloseGuard(() => { throw new Error('boom'); });
    setupCloseGuard(() => Promise.reject(new Error('rejected')));
    setupCloseGuard(later);

    await expect(bridge.callbacks[0]()).resolves.toBeUndefined();
    expect(later).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('starts later subscribers before an unresolved handler settles', () => {
    const later = vi.fn();
    setupCloseGuard(() => new Promise<void>(() => {}));
    setupCloseGuard(later);

    void bridge.callbacks[0]();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('retains subscribers after registration rejection and retries on a later explicit setup', async () => {
    bridge.onClose.mockRejectedValueOnce(new Error('not closable'));
    const first = vi.fn();
    const second = vi.fn();
    setupCloseGuard(first);
    await Promise.resolve();
    await Promise.resolve();
    setupCloseGuard(second);

    expect(bridge.onClose).toHaveBeenCalledTimes(2);
    expect(bridge.trackAnalyticsEvent).toHaveBeenCalledWith('close_guard_rejected', {
      feature_area: 'system', surface: 'editor',
    });
    await bridge.callbacks[0]();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('retains subscribers after a synchronous registration throw and retries later', async () => {
    bridge.onClose.mockImplementationOnce(() => { throw new Error('bridge threw'); });
    const first = vi.fn();
    const second = vi.fn();
    setupCloseGuard(first);
    setupCloseGuard(second);

    expect(bridge.onClose).toHaveBeenCalledTimes(2);
    await bridge.callbacks[0]();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
