import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTrack, mockRequestConfluence } = vi.hoisted(() => ({ mockTrack: vi.fn(), mockRequestConfluence: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: (...args: unknown[]) => mockTrack(...args),
}));
vi.mock('@forge/bridge', () => ({
  requestConfluence: (...args: unknown[]) => mockRequestConfluence(...args),
}));

import {
  ConfluenceThrottledError,
  DEFAULT_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  MAX_SAVE_RETRIES,
  MIN_COOLDOWN_MS,
  SAVE_RETRY_BUDGET_MS,
  SAVE_RETRY_WINDOW_MS,
  _resetForTesting,
  confluenceThrottleRemainingMs,
  deferIfThrottled,
  noteConfluenceThrottled,
  parseRetryAfterMs,
  saveRetryDelayMs,
  sendWithThrottleHandling,
  throttledRequestConfluence,
  type KvStore,
} from './confluenceThrottle';

function memoryStore(): KvStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
  };
}

const blockedStore: KvStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};

const NOW = Date.parse('2026-10-24T12:00:00Z');

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 429 ? '<!doctype html><title>HTTP Status 429 – Too Many Requests</title>' : '{}', {
    status,
    headers,
  });
}

const events = (name: string) => mockTrack.mock.calls.filter(([n]) => n === name).map(([, p]) => p);

beforeEach(() => {
  _resetForTesting();
  localStorage.clear();
  mockTrack.mockClear();
});

describe('parseRetryAfterMs', () => {
  it('reads delta-seconds and HTTP dates', () => {
    expect(parseRetryAfterMs('120', NOW)).toBe(120_000);
    expect(parseRetryAfterMs('Sat, 24 Oct 2026 12:01:30 GMT', NOW)).toBe(90_000);
  });

  it('is undefined when absent or unparseable', () => {
    expect(parseRetryAfterMs(undefined, NOW)).toBeUndefined();
    expect(parseRetryAfterMs(null, NOW)).toBeUndefined();
    expect(parseRetryAfterMs(' ', NOW)).toBeUndefined();
    expect(parseRetryAfterMs('soon', NOW)).toBeUndefined();
  });
});

describe('site cooldown', () => {
  it('uses Retry-After, else the default, clamped to the allowed range', () => {
    const store = memoryStore();
    expect(noteConfluenceThrottled('120', NOW, store, 'a')).toEqual({ cooldownMs: 120_000, source: 'header', retryAfterS: 120 });
    expect(noteConfluenceThrottled(null, NOW, store, 'b')).toEqual({ cooldownMs: DEFAULT_COOLDOWN_MS, source: 'default' });
    expect(noteConfluenceThrottled('0', NOW, store, 'c').cooldownMs).toBe(MIN_COOLDOWN_MS);
    expect(noteConfluenceThrottled('86400', NOW, store, 'd').cooldownMs).toBe(MAX_COOLDOWN_MS);
  });

  it('is scoped to the site and never shortened by a later, shorter 429', () => {
    const store = memoryStore();
    noteConfluenceThrottled('600', NOW, store, 'a');
    noteConfluenceThrottled('60', NOW, store, 'a');
    expect(confluenceThrottleRemainingMs(NOW, store, 'a')).toBe(600_000);
    expect(confluenceThrottleRemainingMs(NOW, store, 'b')).toBe(0);
  });

  it('is shared through storage, so another macro iframe stands down too', () => {
    const store = memoryStore();
    noteConfluenceThrottled('60', NOW, store, 'a');
    _resetForTesting(); // another iframe: no memory of it
    expect(confluenceThrottleRemainingMs(NOW + 10_000, store, 'a')).toBe(50_000);
    expect(confluenceThrottleRemainingMs(NOW + 60_000, store, 'a')).toBe(0);
  });

  it('caps a far-future stored deadline at the maximum cooldown', () => {
    const store = memoryStore();
    store.data.set('zenuml:confluence:throttled-until:a', String(NOW + 30 * 24 * 3600_000));
    expect(confluenceThrottleRemainingMs(NOW, store, 'a')).toBe(MAX_COOLDOWN_MS);
  });

  it('still covers this iframe when storage is blocked, and ignores garbage', () => {
    expect(() => noteConfluenceThrottled('60', NOW, blockedStore, 'a')).not.toThrow();
    expect(confluenceThrottleRemainingMs(NOW, blockedStore, 'a')).toBe(60_000);
    const store = memoryStore();
    store.data.set('zenuml:confluence:throttled-until:z', 'nope');
    expect(confluenceThrottleRemainingMs(NOW, store, 'z')).toBe(0);
  });
});

describe('deferIfThrottled', () => {
  it('lets work through when no cooldown runs', () => {
    expect(deferIfThrottled('work:x', NOW, memoryStore(), 'a')).toBeUndefined();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('returns a 429-shaped error and reports once per endpoint per cooldown', () => {
    const store = memoryStore();
    noteConfluenceThrottled('120', NOW, store, 'a');

    const first = deferIfThrottled('work:x', NOW, store, 'a');
    deferIfThrottled('work:x', NOW + 5_000, store, 'a');
    deferIfThrottled('work:y', NOW + 5_000, store, 'a');

    expect(first).toBeInstanceOf(ConfluenceThrottledError);
    expect(first).toMatchObject({ status: 429, deferred: true, endpoint: 'work:x', cooldownRemainingMs: 120_000 });
    expect(events('confluence_background_request_deferred')).toEqual([
      { feature_area: 'confluence', surface: 'viewer', request_endpoint: 'work:x', cooldown_remaining_ms: 120_000 },
      { feature_area: 'confluence', surface: 'viewer', request_endpoint: 'work:y', cooldown_remaining_ms: 115_000 },
    ]);
  });

  it('reports again when a later 429 extends the cooldown', () => {
    const store = memoryStore();
    noteConfluenceThrottled('60', NOW, store, 'a');
    deferIfThrottled('work:x', NOW, store, 'a');
    noteConfluenceThrottled('600', NOW + 30_000, store, 'a');
    deferIfThrottled('work:x', NOW + 30_000, store, 'a');
    expect(events('confluence_background_request_deferred')).toHaveLength(2);
  });
});

describe('saveRetryDelayMs', () => {
  it('backs off exponentially with jitter when there is no Retry-After', () => {
    const mid = () => 0.5; // jitter factor 1.0
    expect(saveRetryDelayMs(0, null, SAVE_RETRY_BUDGET_MS, NOW, mid)).toBe(2000);
    expect(saveRetryDelayMs(1, null, SAVE_RETRY_BUDGET_MS, NOW, mid)).toBe(4000);
    expect(saveRetryDelayMs(2, null, SAVE_RETRY_BUDGET_MS, NOW, mid)).toBe(8000);
    expect(saveRetryDelayMs(0, null, SAVE_RETRY_BUDGET_MS, NOW, () => 0)).toBe(1400);
    expect(saveRetryDelayMs(0, null, SAVE_RETRY_BUDGET_MS, NOW, () => 1)).toBe(2600);
  });

  it('honours Retry-After, and gives up when it is longer than the budget left', () => {
    expect(saveRetryDelayMs(0, '3', SAVE_RETRY_BUDGET_MS, NOW)).toBe(3000);
    expect(saveRetryDelayMs(0, '30', SAVE_RETRY_BUDGET_MS, NOW)).toBeUndefined();
    expect(saveRetryDelayMs(1, '5', 4000, NOW)).toBeUndefined();
  });

  it('stops after the maximum number of retries', () => {
    expect(saveRetryDelayMs(MAX_SAVE_RETRIES, '1', SAVE_RETRY_BUDGET_MS, NOW)).toBeUndefined();
  });
});

describe('sendWithThrottleHandling', () => {
  const sleep = vi.fn(async (_ms: number) => {});
  beforeEach(() => sleep.mockClear());

  it('passes a non-429 straight through without any event', async () => {
    const send = vi.fn(async () => res(200));
    const response = await sendWithThrottleHandling(send, { method: 'POST', url: '/wiki/api/v2/custom-content', priority: 'user' }, { sleep });
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('retries a save-path 429, honouring Retry-After, and reports the recovery', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(res(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(res(201));

    const response = await sendWithThrottleHandling(send, { method: 'post', url: '/wiki/api/v2/custom-content', priority: 'user' }, { sleep });

    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(events('confluence_request_throttled')).toEqual([expect.objectContaining({
      request_endpoint: 'POST /wiki/api/v2/custom-content',
      request_priority: 'user',
      http_status: 429,
      retry_after_source: 'header',
      retry_after_s: 1,
      will_retry: true,
    })]);
    expect(events('confluence_request_retried')).toEqual([{
      feature_area: 'confluence',
      surface: 'viewer',
      request_endpoint: 'POST /wiki/api/v2/custom-content',
      retry_outcome: 'recovered',
      retry_attempts: 1,
      retry_wait_ms: 1000,
    }]);
    // The 429 still opened the site's cooldown for background work.
    expect(confluenceThrottleRemainingMs()).toBeGreaterThan(0);
  });

  it('hands the last 429 to the caller once the retries run out, within the wait budget', async () => {
    const send = vi.fn(async () => res(429));

    const response = await sendWithThrottleHandling(
      send, { method: 'GET', url: '/wiki/api/v2/custom-content/1234567890?body-format=raw', priority: 'user' },
      { sleep, random: () => 0.5 },
    );

    expect(response.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1 + MAX_SAVE_RETRIES);
    const waited = sleep.mock.calls.reduce((total, [ms]) => total + ms, 0);
    expect(waited).toBeLessThanOrEqual(SAVE_RETRY_BUDGET_MS);
    expect(events('confluence_request_throttled').map((p: any) => p.will_retry)).toEqual([true, true, true, false]);
    expect(events('confluence_request_retried')).toEqual([expect.objectContaining({
      request_endpoint: 'GET /wiki/api/v2/custom-content/{id}',
      retry_outcome: 'exhausted',
      retry_attempts: MAX_SAVE_RETRIES,
      retry_wait_ms: waited,
    })]);
  });

  it('shares one wait budget across the requests of a save', async () => {
    const clock = { t: NOW };
    const deps = { sleep: vi.fn(async (ms: number) => { clock.t += ms; }), now: () => clock.t, random: () => 0.5 };
    const always429 = () => vi.fn(async () => res(429));

    // existence GET: 2 s + 4 s + 8 s = 14 s of the 20 s budget
    await sendWithThrottleHandling(always429(), { method: 'GET', url: '/wiki/api/v2/custom-content/1', priority: 'user' }, deps);
    // the PUT gets only what is left: 2 s + 4 s = 20 s in all, then gives up
    const put = always429();
    await sendWithThrottleHandling(put, { method: 'PUT', url: '/wiki/api/v2/custom-content/1', priority: 'user' }, deps);

    expect(put).toHaveBeenCalledTimes(3);
    expect(deps.sleep.mock.calls.reduce((total, [ms]) => total + ms, 0)).toBe(SAVE_RETRY_BUDGET_MS);

    // a later save, once the window has passed, gets a fresh budget
    clock.t += SAVE_RETRY_WINDOW_MS + 1;
    const next = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200));
    expect((await sendWithThrottleHandling(next, { method: 'PUT', url: '/wiki/api/v2/custom-content/1', priority: 'user' }, deps)).status).toBe(200);
  });

  it('does not wait for a Retry-After longer than the budget', async () => {
    const send = vi.fn(async () => res(429, { 'retry-after': '120' }));
    const response = await sendWithThrottleHandling(send, { method: 'PUT', url: '/wiki/api/v2/custom-content/1', priority: 'user' }, { sleep });
    expect(response.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(events('confluence_request_retried')).toEqual([]);
  });

  it('never retries a request without user priority, but still opens the cooldown', async () => {
    for (const priority of [undefined, 'background'] as const) {
      _resetForTesting();
      localStorage.clear();
      const send = vi.fn(async () => res(429));
      const response = await sendWithThrottleHandling(send, { method: 'GET', url: '/wiki/api/v2/pages/1/attachments', priority }, { sleep });
      expect(response.status).toBe(429);
      expect(send).toHaveBeenCalledTimes(1);
      // real clock: a millisecond may pass between opening and reading it
      expect(confluenceThrottleRemainingMs()).toBeGreaterThan(DEFAULT_COOLDOWN_MS - 1000);
      expect(confluenceThrottleRemainingMs()).toBeLessThanOrEqual(DEFAULT_COOLDOWN_MS);
    }
    expect(sleep).not.toHaveBeenCalled();
    expect(events('confluence_request_throttled').map((p: any) => p.request_priority)).toEqual(['default', 'background']);
  });
});

describe('throttledRequestConfluence', () => {
  beforeEach(() => mockRequestConfluence.mockReset());

  it('sends normally and returns the raw Response', async () => {
    mockRequestConfluence.mockResolvedValueOnce(res(200));
    const response = await throttledRequestConfluence('/wiki/api/v2/pages/1/properties?key=k', { method: 'GET' }, 'background');
    expect(response.status).toBe(200);
    expect(mockRequestConfluence).toHaveBeenCalledWith('/wiki/api/v2/pages/1/properties?key=k', { method: 'GET' });
  });

  it('a 429 opens the cooldown, and a background request then is not sent', async () => {
    mockRequestConfluence.mockResolvedValueOnce(res(429, { 'retry-after': '90' }));
    await throttledRequestConfluence('/wiki/rest/api/content/1/child/attachment', { method: 'POST' });
    expect(confluenceThrottleRemainingMs()).toBeGreaterThan(80_000);
    mockRequestConfluence.mockClear();

    await expect(throttledRequestConfluence('/wiki/api/v2/pages/1/properties', { method: 'PUT' }, 'background'))
      .rejects.toBeInstanceOf(ConfluenceThrottledError);
    expect(mockRequestConfluence).not.toHaveBeenCalled();
    expect(events('confluence_background_request_deferred')).toEqual([
      expect.objectContaining({ request_endpoint: 'PUT /wiki/api/v2/pages/{id}/properties' }),
    ]);
  });

  it('a request without a priority is still sent during the cooldown', async () => {
    noteConfluenceThrottled('600');
    mockRequestConfluence.mockResolvedValueOnce(res(200));
    expect((await throttledRequestConfluence('/wiki/api/v2/pages/1/properties', { method: 'POST' })).status).toBe(200);
  });
});
