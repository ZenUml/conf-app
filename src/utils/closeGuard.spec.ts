import { describe, it, expect, vi } from 'vitest';

// The production probe showed that Forge accepts both registrations but retains
// only the most recent callback. Model that host behavior here.
let hostCloseCallback: (() => Promise<void>) | undefined;
vi.mock('@forge/bridge', () => ({
  view: {
    onClose: vi.fn((handler: () => Promise<void>) => {
      hostCloseCallback = handler;
      return Promise.resolve();
    }),
    getContext: vi.fn(async () => ({ cloudId: 'test-cloud' })),
  },
}));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

async function freshCloseGuard() {
  hostCloseCallback = undefined;
  vi.clearAllMocks();
  vi.resetModules();
  const { view } = await import('@forge/bridge');
  const { setupCloseGuard } = await import('./closeGuard');
  const { trackAnalyticsEvent } = await import('@/utils/analytics/trackAnalyticsEvent');
  return { view, setupCloseGuard, trackAnalyticsEvent };
}

describe.sequential('setupCloseGuard', () => {
  it('fans one host callback out to active subscribers and isolates failures', async () => {
    const { view, setupCloseGuard } = await freshCloseGuard();
    const failingOutcome = vi.fn(() => { throw new Error('boom'); });
    const draft = vi.fn();
    const removedOutcome = vi.fn();
    setupCloseGuard(failingOutcome);
    setupCloseGuard(draft);
    const offRemoved = setupCloseGuard(removedOutcome);

    offRemoved();
    offRemoved();

    expect(view.onClose).toHaveBeenCalledTimes(1);
    await hostCloseCallback?.();

    expect(failingOutcome).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledTimes(1);
    expect(removedOutcome).not.toHaveBeenCalled();
  });

  it('starts later handlers before awaiting an earlier async handler', async () => {
    const { setupCloseGuard } = await freshCloseGuard();
    let resolveSlow!: () => void;
    const slow = vi.fn(() => new Promise<void>((resolve) => { resolveSlow = resolve; }));
    const outcome = vi.fn();
    const rejected = vi.fn(() => Promise.reject(new Error('boom')));
    setupCloseGuard(slow);
    setupCloseGuard(outcome);
    setupCloseGuard(rejected);

    const close = hostCloseCallback?.();
    expect(outcome).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveBeenCalledTimes(1);

    resolveSlow();
    await expect(close).resolves.toBeUndefined();
  });

  it('retries registration after rejection without letting an old teardown remove a new subscriber', async () => {
    const { view, setupCloseGuard, trackAnalyticsEvent } = await freshCloseGuard();
    (view.onClose as any).mockRejectedValueOnce(new Error('not closable'));
    const oldSubscriber = vi.fn();
    const offOld = setupCloseGuard(oldSubscriber);
    await new Promise(resolve => setTimeout(resolve, 0));

    const remountedSubscriber = vi.fn();
    setupCloseGuard(remountedSubscriber);
    offOld();

    expect(view.onClose).toHaveBeenCalledTimes(2);
    expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('close_guard_rejected', {
      feature_area: 'system',
      surface: 'editor',
    });
    await hostCloseCallback?.();
    expect(oldSubscriber).not.toHaveBeenCalled();
    expect(remountedSubscriber).toHaveBeenCalledTimes(1);
  });
});
