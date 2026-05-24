import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onRequest, buildPageSnapshotKey, type PageCapturePayload } from './forge-page-capture';

const VALID_SECRET = 'test-secret-abc123';

function makePayload(overrides: Partial<PageCapturePayload> = {}): PageCapturePayload {
  return {
    cloudId: 'cloud-abc',
    contentId: '12345',
    contentTitle: 'My Page',
    contentType: 'page',
    versionNumber: 3,
    versionWhen: '2026-05-09T00:00:00.000Z',
    versionBy: 'user-1',
    spaceKey: 'TEAM',
    spaceName: 'Team Space',
    capturedAt: '2026-05-09T01:00:00.000Z',
    body: { value: '<p>hello</p>', representation: 'storage' },
    ...overrides,
  };
}

function makeRequest(payload: unknown, token: string | null = VALID_SECRET): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) {
    headers['X-Page-Capture-Token'] = token;
  }
  return new Request('https://example.com/forge-page-capture', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

function makeEnv(bucketData: Record<string, unknown> = {}, secretOverride?: string) {
  return {
    PAGE_CAPTURE_SECRET: secretOverride ?? VALID_SECRET,
    EVENT_BUCKET: {
      head: vi.fn(async (key: string) => (key in bucketData ? { key } : null)),
      put: vi.fn(async () => undefined),
    },
  };
}

describe('buildPageSnapshotKey', () => {
  it('builds the correct R2 key', () => {
    expect(buildPageSnapshotKey('cloud-1', '99999', 7)).toBe(
      'page-snapshots/cloud-1/99999/v7.json',
    );
  });
});

describe('forge-page-capture onRequest', () => {
  it('returns 405 for non-POST requests', async () => {
    const req = new Request('https://example.com/forge-page-capture', { method: 'GET' });
    const res = await onRequest({ request: req, env: makeEnv() } as any);
    expect(res.status).toBe(405);
  });

  it('returns 401 when token is missing', async () => {
    const req = makeRequest(makePayload(), null);
    const res = await onRequest({ request: req, env: makeEnv() } as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is wrong', async () => {
    const req = makeRequest(makePayload(), 'wrong-token');
    const res = await onRequest({ request: req, env: makeEnv() } as any);
    expect(res.status).toBe(401);
  });

  it('returns 500 when PAGE_CAPTURE_SECRET is not configured', async () => {
    const req = makeRequest(makePayload());
    const env = { EVENT_BUCKET: makeEnv().EVENT_BUCKET };
    const res = await onRequest({ request: req, env } as any);
    expect(res.status).toBe(500);
  });

  it('returns 500 when EVENT_BUCKET is not configured', async () => {
    const req = makeRequest(makePayload());
    const env = { PAGE_CAPTURE_SECRET: VALID_SECRET };
    const res = await onRequest({ request: req, env } as any);
    expect(res.status).toBe(500);
  });

  it('returns 400 when cloudId is missing', async () => {
    const req = makeRequest(makePayload({ cloudId: '' }));
    const res = await onRequest({ request: req, env: makeEnv() } as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when contentId is missing', async () => {
    const req = makeRequest(makePayload({ contentId: '' }));
    const res = await onRequest({ request: req, env: makeEnv() } as any);
    expect(res.status).toBe(400);
  });

  it('writes to R2 and returns stored:true for a new version', async () => {
    const env = makeEnv({});
    const req = makeRequest(makePayload());
    const res = await onRequest({ request: req, env } as any);
    expect(res.status).toBe(200);

    const body = await res.json() as { stored: boolean; key: string };
    expect(body.stored).toBe(true);
    expect(body.key).toBe('page-snapshots/cloud-abc/12345/v3.json');
    expect(env.EVENT_BUCKET.put).toHaveBeenCalledOnce();
    expect(env.EVENT_BUCKET.put).toHaveBeenCalledWith(
      'page-snapshots/cloud-abc/12345/v3.json',
      expect.any(String),
      expect.objectContaining({ httpMetadata: { contentType: 'application/json' } }),
    );
  });

  it('skips write and returns stored:false when version already exists', async () => {
    const existingKey = 'page-snapshots/cloud-abc/12345/v3.json';
    const env = makeEnv({ [existingKey]: { key: existingKey } });
    const req = makeRequest(makePayload());
    const res = await onRequest({ request: req, env } as any);
    expect(res.status).toBe(200);

    const body = await res.json() as { stored: boolean; reason: string };
    expect(body.stored).toBe(false);
    expect(body.reason).toBe('already_exists');
    expect(env.EVENT_BUCKET.put).not.toHaveBeenCalled();
  });
});
