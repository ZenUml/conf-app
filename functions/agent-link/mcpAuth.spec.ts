import { describe, it, expect } from 'vitest';
import { authenticateSession } from './mcpAuth';
import { SessionRegistry } from './sessionRegistry';
import { IDLE_TTL_MS } from './sessionToken';
import type { BoundContext } from './sessionToken';

const CTX: BoundContext = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' };

describe('authenticateSession', () => {
  it('returns "missing" for undefined token', () => {
    const registry = new SessionRegistry();
    expect(authenticateSession(undefined, registry, Date.now())).toEqual({ ok: false, code: 'missing' });
  });

  it('returns "missing" for null token', () => {
    const registry = new SessionRegistry();
    expect(authenticateSession(null, registry, Date.now())).toEqual({ ok: false, code: 'missing' });
  });

  it('returns "missing" for a blank/whitespace-only token', () => {
    const registry = new SessionRegistry();
    expect(authenticateSession('   ', registry, Date.now())).toEqual({ ok: false, code: 'missing' });
  });

  it('returns "invalid" for a token not present in the registry', () => {
    const registry = new SessionRegistry();
    expect(authenticateSession('CL-0000-0000', registry, Date.now())).toEqual({
      ok: false,
      code: 'invalid',
    });
  });

  it('returns "expired" for a known token past its TTL', () => {
    const registry = new SessionRegistry();
    const record = registry.create(CTX);
    const now = record.issuedAtMs + IDLE_TTL_MS + 1;

    expect(authenticateSession(record.token, registry, now)).toEqual({ ok: false, code: 'expired' });
  });

  it('returns ok:true with the session for a known, fresh token', () => {
    const registry = new SessionRegistry();
    const record = registry.create(CTX);

    const result = authenticateSession(record.token, registry, record.issuedAtMs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session).toEqual(record);
    }
  });

  it('treats the TTL boundary as expired (inclusive), matching isExpired', () => {
    const registry = new SessionRegistry();
    const record = registry.create(CTX);
    const now = record.issuedAtMs + IDLE_TTL_MS;

    expect(authenticateSession(record.token, registry, now)).toEqual({ ok: false, code: 'expired' });
  });
});
