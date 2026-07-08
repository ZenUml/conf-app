import { describe, it, expect } from 'vitest';
import { onRequestPost } from './session';

function makeRequest(body: unknown): Request {
  return new Request('https://example.com/agent-link/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' };

describe('POST /agent-link/session', () => {
  it('returns token, channelUrl and expiresInSec for a valid body', async () => {
    const req = makeRequest(VALID_BODY);
    const res = await onRequestPost({ request: req } as any);

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; channelUrl: string; expiresInSec: number };

    expect(body.token).toMatch(/^CL-/);
    expect(body.channelUrl).toBe(`/agent-link/channel?token=${body.token}`);
    expect(body.expiresInSec).toBe(600);
  });

  it.each(['cloudId', 'pageId', 'contentId'])('returns 400 when %s is missing', async (field) => {
    const body = { ...VALID_BODY, [field]: undefined };
    const req = makeRequest(body);
    const res = await onRequestPost({ request: req } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const req = new Request('https://example.com/agent-link/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await onRequestPost({ request: req } as any);

    expect(res.status).toBe(400);
  });
});
