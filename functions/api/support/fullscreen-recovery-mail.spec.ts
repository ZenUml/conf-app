import { describe, expect, it } from 'vitest';
import { onRequest } from './fullscreen-recovery-mail';

const url = 'https://example.com/api/support/fullscreen-recovery-mail?requestId=e8fb9193-a89a-423c-8394-cb8a44fc2660';
const token = 'a-strong-internal-token-for-testing';
const env = { FULLSCREEN_RECOVERY_SUPPORT_TOKENS: JSON.stringify({ operator_one: token }), DB: {} as D1Database };

describe('support reply endpoint trust boundary', () => {
  it('rejects an unauthenticated preview before reading storage', async () => {
    const result = await onRequest({ request: new Request(url), env } as never);
    expect(result.status).toBe(401);
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects arbitrary client actor and malformed reply confirmation', async () => {
    const result = await onRequest({ request: new Request(url, { method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'send', requestId: 'e8fb9193-a89a-423c-8394-cb8a44fc2660',
        actor: 'someone-else', timeZone: 'UTC', previewHash: 'not-a-hash' }),
    }), env } as never);
    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({ error: 'invalid_preview_confirmation' });
  });
});
