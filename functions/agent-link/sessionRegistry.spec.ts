import { describe, it, expect } from 'vitest';
import { SessionRegistry } from './sessionRegistry';
import { TOKEN_TTL_MS } from './sessionToken';
import type { BoundContext } from './sessionToken';

const CTX: BoundContext = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' };

describe('SessionRegistry', () => {
  it('create returns a "created" record retrievable by token', () => {
    const registry = new SessionRegistry();
    const record = registry.create(CTX);

    expect(record.state).toBe('created');
    expect(record.boundContext).toEqual(CTX);
    expect(record.scope).toBe('read-page+write-diagram');
    expect(record.token).toMatch(/^CL-/);

    expect(registry.get(record.token)).toEqual(record);
  });

  it('get returns undefined for an unknown token', () => {
    const registry = new SessionRegistry();
    expect(registry.get('CL-0000-0000')).toBeUndefined();
  });

  it('pair moves a created record to paired and returns true', () => {
    const registry = new SessionRegistry();
    const record = registry.create(CTX);

    expect(registry.pair(record.token)).toBe(true);
    expect(registry.get(record.token)?.state).toBe('paired');
  });

  it('pair returns false for an unknown token', () => {
    const registry = new SessionRegistry();
    expect(registry.pair('CL-0000-0000')).toBe(false);
  });

  it('pair returns false when the record is already paired (no-op re-pair)', () => {
    const registry = new SessionRegistry();
    const record = registry.create(CTX);
    registry.pair(record.token);

    expect(registry.pair(record.token)).toBe(false);
    expect(registry.get(record.token)?.state).toBe('paired');
  });

  it('expireStale removes only past-TTL records and returns the count removed', () => {
    const registry = new SessionRegistry();
    const now = 1_000_000;

    const stale1 = registry.create(CTX);
    const stale2 = registry.create(CTX);
    const fresh = registry.create(CTX);

    // Backdate the two stale sessions past the TTL; leave `fresh` issued "now".
    // lastActivity tracks issuedAt (no bumping yet) so the idle window is what expires.
    stale1.issuedAtMs = now - TOKEN_TTL_MS - 1;
    stale1.lastActivityMs = stale1.issuedAtMs;
    stale2.issuedAtMs = now - TOKEN_TTL_MS - 1000;
    stale2.lastActivityMs = stale2.issuedAtMs;
    fresh.issuedAtMs = now;
    fresh.lastActivityMs = now;

    const removed = registry.expireStale(now);

    expect(removed).toBe(2);
    expect(registry.get(stale1.token)).toBeUndefined();
    expect(registry.get(stale2.token)).toBeUndefined();
    expect(registry.get(fresh.token)).toBeDefined();
  });

  it('expireStale returns 0 when nothing is past TTL', () => {
    const registry = new SessionRegistry();
    const now = 1_000_000;
    const record = registry.create(CTX);
    record.issuedAtMs = now;
    record.lastActivityMs = now;

    expect(registry.expireStale(now)).toBe(0);
    expect(registry.get(record.token)).toBeDefined();
  });
});
