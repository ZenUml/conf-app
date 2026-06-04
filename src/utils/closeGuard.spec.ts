import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @forge/bridge before importing the module under test so view.onClose
// is a Vitest spy from the start.
const onCloseHandlers: Array<() => void | Promise<void>> = [];
vi.mock('@forge/bridge', () => ({
  view: {
    onClose: vi.fn(async (handler: () => void | Promise<void>) => {
      onCloseHandlers.push(handler);
    }),
    getContext: vi.fn(async () => ({ cloudId: 'test-cloud' })),
  },
}));

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

import { setupCloseGuard } from './closeGuard';
import { view } from '@forge/bridge';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

beforeEach(() => {
  onCloseHandlers.length = 0;
  (view.onClose as any).mockClear();
  vi.mocked(trackAnalyticsEvent).mockClear();
});

describe('setupCloseGuard', () => {
  it('registers a handler with view.onClose', () => {
    const fn = vi.fn();
    setupCloseGuard(fn);
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(onCloseHandlers).toHaveLength(1);
  });

  it('invokes the registered handler when Atlassian fires close', async () => {
    const fn = vi.fn();
    setupCloseGuard(fn);
    await onCloseHandlers[0]();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('teardown disables future handler invocations', async () => {
    const fn = vi.fn();
    const off = setupCloseGuard(fn);
    off();
    await onCloseHandlers[0]();
    expect(fn).not.toHaveBeenCalled();
  });

  it('swallows handler errors without crashing the close path', async () => {
    const fn = vi.fn(() => { throw new Error('boom'); });
    setupCloseGuard(fn);
    // Should not reject — we explicitly catch and log.
    await expect(onCloseHandlers[0]()).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires close_guard_rejected analytics when view.onClose rejects', async () => {
    (view.onClose as any).mockRejectedValueOnce(new Error("onClose failed because this resource's view is not closable."));
    const fn = vi.fn();
    setupCloseGuard(fn);
    // Allow the microtask queue to flush so the .catch() runs
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('close_guard_rejected', {
      feature_area: 'system',
      surface: 'editor',
    });
  });

  it('multiple guards register independently and each can be torn down', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = setupCloseGuard(a);
    setupCloseGuard(b);

    expect(onCloseHandlers).toHaveLength(2);

    offA();
    await onCloseHandlers[0](); // disabled
    await onCloseHandlers[1](); // active
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
