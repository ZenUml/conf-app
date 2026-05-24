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

import { setupCloseGuard } from './closeGuard';
import { view } from '@forge/bridge';

beforeEach(() => {
  onCloseHandlers.length = 0;
  (view.onClose as any).mockClear();
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
