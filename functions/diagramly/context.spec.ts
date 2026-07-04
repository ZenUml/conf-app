import { describe, expect, it } from 'vitest';
import { resolveDiagramlyIdentity } from './context';

describe('resolveDiagramlyIdentity', () => {
  it('returns the verified identity from the Forge context', () => {
    const result = resolveDiagramlyIdentity({
      forgeContext: {
        accountId: 'verified-account-123',
        cloudId: 'verified-cloud-789',
      },
    });

    expect(result).toEqual({
      accountId: 'verified-account-123',
      cloudId: 'verified-cloud-789',
    });
  });

  it('never reads identity from the request body (no fallback surface)', () => {
    // Only forgeContext is consulted; there is no body argument at all.
    const result = resolveDiagramlyIdentity({
      forgeContext: { accountId: 'a', cloudId: 'c' },
      accountId: 'body-account',
      cloudId: 'body-cloud',
    } as any);

    expect(result).toEqual({ accountId: 'a', cloudId: 'c' });
  });

  it('returns a 400 Response when accountId is missing', async () => {
    const result = resolveDiagramlyIdentity({
      forgeContext: { cloudId: 'verified-cloud-789' },
    });

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Missing accountId in Forge context',
    });
  });

  it('returns a 400 Response when cloudId is missing', async () => {
    const result = resolveDiagramlyIdentity({
      forgeContext: { accountId: 'verified-account-123' },
    });

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Missing cloudId in Forge context',
    });
  });

  it('returns a 400 Response when the Forge context is absent entirely', () => {
    const result = resolveDiagramlyIdentity({});
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });
});
