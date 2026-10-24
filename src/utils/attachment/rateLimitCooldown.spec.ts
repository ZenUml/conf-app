import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  MIN_COOLDOWN_MS,
  _resetForTesting,
  parseRetryAfterMs,
  rateLimitCooldownRemainingMs,
  startRateLimitCooldown,
  type KvStore,
} from './rateLimitCooldown';

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

const NOW = Date.parse('2026-10-23T12:00:00Z');

beforeEach(() => _resetForTesting());

describe('parseRetryAfterMs', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('120', NOW)).toBe(120_000);
  });

  it('reads an HTTP date relative to now', () => {
    expect(parseRetryAfterMs('Fri, 23 Oct 2026 12:01:30 GMT', NOW)).toBe(90_000);
  });

  it('is undefined when absent or unparseable', () => {
    expect(parseRetryAfterMs(undefined, NOW)).toBeUndefined();
    expect(parseRetryAfterMs(null, NOW)).toBeUndefined();
    expect(parseRetryAfterMs('  ', NOW)).toBeUndefined();
    expect(parseRetryAfterMs('soon', NOW)).toBeUndefined();
  });
});

describe('startRateLimitCooldown', () => {
  it('uses the header when present', () => {
    const store = memoryStore();
    expect(startRateLimitCooldown('site-a', '120', NOW, store))
      .toEqual({ cooldownMs: 120_000, source: 'header', retryAfterS: 120 });
    expect(rateLimitCooldownRemainingMs('site-a', NOW, store)).toBe(120_000);
  });

  it('falls back to the default without a header', () => {
    const store = memoryStore();
    expect(startRateLimitCooldown('site-a', undefined, NOW, store))
      .toEqual({ cooldownMs: DEFAULT_COOLDOWN_MS, source: 'default' });
  });

  it('clamps the header to the allowed range, keeping the raw value for telemetry', () => {
    const store = memoryStore();
    expect(startRateLimitCooldown('site-a', '0', NOW, store)).toMatchObject({ cooldownMs: MIN_COOLDOWN_MS, retryAfterS: 0 });
    expect(startRateLimitCooldown('site-b', '86400', NOW, store)).toMatchObject({ cooldownMs: MAX_COOLDOWN_MS, retryAfterS: 86400 });
  });

  it('never shortens a later deadline another iframe already set', () => {
    const store = memoryStore();
    startRateLimitCooldown('site-a', '600', NOW, store);
    startRateLimitCooldown('site-a', '60', NOW, store);
    expect(rateLimitCooldownRemainingMs('site-a', NOW, store)).toBe(600_000);
  });

  it('is scoped to the site', () => {
    const store = memoryStore();
    startRateLimitCooldown('site-a', '60', NOW, store);
    expect(rateLimitCooldownRemainingMs('site-b', NOW, store)).toBe(0);
  });

  it('is shared through storage, so another iframe sees it', () => {
    const store = memoryStore();
    startRateLimitCooldown('site-a', '60', NOW, store);
    _resetForTesting(); // a different iframe has no memory of it
    expect(rateLimitCooldownRemainingMs('site-a', NOW + 10_000, store)).toBe(50_000);
  });

  it('still covers this iframe when storage is blocked', () => {
    expect(() => startRateLimitCooldown('site-a', '60', NOW, blockedStore)).not.toThrow();
    expect(rateLimitCooldownRemainingMs('site-a', NOW, blockedStore)).toBe(60_000);
  });
});

describe('rateLimitCooldownRemainingMs', () => {
  it('is 0 with no cooldown and after it expires', () => {
    const store = memoryStore();
    expect(rateLimitCooldownRemainingMs('site-a', NOW, store)).toBe(0);
    startRateLimitCooldown('site-a', '60', NOW, store);
    expect(rateLimitCooldownRemainingMs('site-a', NOW + 60_000, store)).toBe(0);
  });

  it('ignores a garbage stored value', () => {
    const store = memoryStore();
    store.data.set('zenuml:attachment:rate-limited-until:site-a', 'not-a-number');
    expect(rateLimitCooldownRemainingMs('site-a', NOW, store)).toBe(0);
  });

  it('caps a far-future stored deadline at the maximum cooldown', () => {
    const store = memoryStore();
    store.data.set('zenuml:attachment:rate-limited-until:site-a', String(NOW + 30 * 24 * 3600_000));
    expect(rateLimitCooldownRemainingMs('site-a', NOW, store)).toBe(MAX_COOLDOWN_MS);
  });
});
