import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalSendBeacon = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');

describe('mixpanel-browser immediate sendBeacon transport', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    if (originalSendBeacon) {
      Object.defineProperty(navigator, 'sendBeacon', originalSendBeacon);
    } else {
      Reflect.deleteProperty(navigator, 'sendBeacon');
    }
  });

  it('bypasses an enabled batch queue only when send_immediately is true', async () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });
    const { default: mixpanel } = await import('mixpanel-browser');
    const instance = mixpanel.init('test-token', {
      api_host: 'https://example.invalid',
      batch_requests: true,
      batch_autostart: false,
      persistence: 'localStorage',
    }, 'send-beacon-characterization');

    instance.track('queued', {}, { transport: 'sendBeacon' });
    await Promise.resolve();
    expect(sendBeacon).not.toHaveBeenCalled();

    instance.track('immediate', {}, {
      transport: 'sendBeacon',
      send_immediately: true,
    });
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    instance.stop_batch_senders();
  });
});
