import { describe, expect, it, vi } from 'vitest';

vi.mock('../../architecture-tokens/service', () => ({
  relatedDiagrams: vi.fn(async () => ({ indexedAt: 't', contentVersion: 1, participants: [] })),
  confluencePageResolver: vi.fn(() => async () => []),
  confluenceContentResolver: vi.fn(() => async () => new Map()),
}));

import { onRequest } from './related';
import {
  confluenceContentResolver,
  confluencePageResolver,
  relatedDiagrams,
} from '../../architecture-tokens/service';

const ctx = (url: string, extra: Partial<any> = {}) => ({
  request: new Request(url, { method: extra.method ?? 'GET', headers: { 'x-forge-oauth-user': 'tok' } }),
  env: { DB: {} },
  data: { forgeContext: { cloudId: 'cid', apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cid' } },
} as any);

describe('GET /api/architecture-tokens/related', () => {
  it('scopes by the authenticated cloudId and resolves pages as the user', async () => {
    const res = await onRequest(ctx('https://x/api/architecture-tokens/related?customContentId=42'));
    expect(res.status).toBe(200);
    expect(relatedDiagrams).toHaveBeenCalledWith({}, 'cid', '42', expect.any(Function), expect.any(Function));
    expect(confluencePageResolver).toHaveBeenCalledWith('https://api.atlassian.com/ex/confluence/cid', 'tok');
    expect(confluenceContentResolver).toHaveBeenCalledWith('https://api.atlassian.com/ex/confluence/cid', 'tok');
    expect(await res.json()).toEqual({ indexedAt: 't', contentVersion: 1, participants: [] });
  });

  it('rejects a non-numeric id', async () => {
    const res = await onRequest(ctx('https://x/api/architecture-tokens/related?customContentId=abc'));
    expect(res.status).toBe(400);
  });

  it('405 on POST', async () => {
    const res = await onRequest(ctx('https://x/api/architecture-tokens/related?customContentId=1', { method: 'POST' }));
    expect(res.status).toBe(405);
  });

  it('missing forge context → 401', async () => {
    const c = ctx('https://x/api/architecture-tokens/related?customContentId=1');
    c.data = {};
    expect((await onRequest(c)).status).toBe(401);
  });

  it('service throw → 200 with error_kind, never 500', async () => {
    (relatedDiagrams as any).mockRejectedValueOnce(new Error('d1 down'));
    const res = await onRequest(ctx('https://x/api/architecture-tokens/related?customContentId=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ indexedAt: null, contentVersion: null, participants: [], error_kind: 'lookup_failed' });
  });
});
