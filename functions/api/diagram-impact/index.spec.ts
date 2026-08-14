import { describe, expect, it, vi } from 'vitest';
import { onRequest } from './index';

const fetchContent = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
  id: 'content-a', authorId: 'creator-a', version: { authorId: 'updater-a' },
}), { headers: { 'Content-Type': 'application/json' } })));

function db() {
  return {
    prepare(sql: string) {
      return { bind: () => ({ first: async () => sql.includes('COUNT(*)') ? { audienceCount: 3 } : null }) };
    },
  };
}

const data = { forgeContext: {
  cloudId: 'cloud-a', forgeAppId: 'app-a', accountId: 'viewer-a', apiBaseUrl: 'https://api.example.test',
} };

describe('GET /api/diagram-impact', () => {
  it('returns a JSON summary for readable content', async () => {
    fetchContent();
    const result = await onRequest({
      request: new Request('https://example.test/api/diagram-impact?customContentId=content-a', { headers: { 'x-forge-oauth-user': 'token' } }),
      env: { DB: db() }, data,
    } as any);

    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('application/json');
    await expect(result.json()).resolves.toEqual({ audienceCount: 3, viewerRelation: 'viewer' });
  });

  it('rejects non-GET and client-supplied identity fields', async () => {
    const methodResult = await onRequest({
      request: new Request('https://example.test/api/diagram-impact?customContentId=content-a', { method: 'POST' }), env: {}, data,
    } as any);
    expect(methodResult.status).toBe(405);

    const identityResult = await onRequest({
      request: new Request('https://example.test/api/diagram-impact?customContentId=content-a&cloudId=forged'), env: {}, data,
    } as any);
    expect(identityResult.status).toBe(400);
    await expect(identityResult.json()).resolves.toEqual({ error: 'invalid_request' });
  });
});
