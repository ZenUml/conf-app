import { describe, expect, it, vi } from 'vitest';
import { onRequest } from './view';

const fetchContent = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
  id: 'content-a', authorId: 'creator-a', version: { authorId: 'updater-a' },
}), { headers: { 'Content-Type': 'application/json' } })));

function db() {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          first: async () => sql.includes('COUNT(*)') ? { audienceCount: 4 } : null,
          run: async () => ({ meta: { changes: 1 } }),
        }),
      };
    },
  };
}

const data = { forgeContext: {
  cloudId: 'cloud-a', forgeAppId: 'app-a', accountId: 'viewer-a', apiBaseUrl: 'https://api.example.test',
} };

describe('POST /api/diagram-impact/view', () => {
  it('returns the registration result as JSON', async () => {
    fetchContent();
    const result = await onRequest({
      request: new Request('https://example.test/api/diagram-impact/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forge-oauth-user': 'token' },
        body: JSON.stringify({ customContentId: 'content-a' }),
      }),
      env: { DB: db(), DIAGRAM_IMPACT_HMAC_SECRET: 'secret' }, data,
    } as any);

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({ result: 'new_unique', audienceCount: 4 });
  });

  it('rejects malformed JSON, wrong methods, and extra client identity', async () => {
    const wrongMethod = await onRequest({ request: new Request('https://example.test/api/diagram-impact/view'), env: {}, data } as any);
    expect(wrongMethod.status).toBe(405);

    const malformed = await onRequest({
      request: new Request('https://example.test/api/diagram-impact/view', { method: 'POST', body: '{' }), env: {}, data,
    } as any);
    expect(malformed.status).toBe(400);

    const forged = await onRequest({
      request: new Request('https://example.test/api/diagram-impact/view', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customContentId: 'content-a', accountId: 'forged' }),
      }), env: {}, data,
    } as any);
    expect(forged.status).toBe(400);
    await expect(forged.json()).resolves.toEqual({ error: 'invalid_request' });
  });
});
