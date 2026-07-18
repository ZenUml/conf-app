import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { onRequest } from './forge-upload-attachment';

// A minimal but magic-byte-valid PNG (the 8-byte signature is enough for the
// handler's PNG check; the body isn't rendered anywhere).
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

const FORGE_CONTEXT = {
  cloudId: 'cloud-1',
  apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-1',
  forgeAppId: 'app-1',
};
const FORGE_DATA = { forgeContext: FORGE_CONTEXT };

function makeRequest(payload: any, headers: Record<string, string> = {}) {
  return new Request('https://example.com/forge-upload-attachment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forge-oauth-system': 'sys-token',
      'x-forge-oauth-user': 'user-token',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function fetchResponse(status: number, body = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

const basePayload = {
  pageId: '12345',
  attachmentName: 'zenuml-abc-uuid.png',
  hash: 'deadbeef|sequence|itxt:v1',
  versionNumber: 1,
  pngBase64: PNG_BASE64,
};

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

describe('forge-upload-attachment', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Route requests by URL/method so tests don't depend on call ordering.
  function routeFetch(handlers: {
    read?: Response;
    upload?: Response;
    put?: Response;
  }) {
    fetchMock.mockImplementation((url: string, init: any) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return Promise.resolve(handlers.read ?? fetchResponse(200, '{}'));
      if (method === 'PUT') return Promise.resolve(handlers.put ?? fetchResponse(200, '{}'));
      // POST upload
      return Promise.resolve(handlers.upload ?? fetchResponse(200, JSON.stringify({ results: [{ id: 'att-new-1' }] })));
    });
  }

  it('uploads a NEW attachment as the app and returns the parsed id', async () => {
    routeFetch({
      read: fetchResponse(200, '{}'),
      upload: fetchResponse(200, JSON.stringify({ results: [{ id: 'att-new-1' }] })),
      put: fetchResponse(200, '{}'),
    });

    const res = await onRequest({ request: makeRequest(basePayload), data: FORGE_DATA } as any);
    const json = await readJson(res);

    expect(json).toEqual({ ok: true, attachmentId: 'att-new-1', versionNumber: 1 });

    // read-check (GET as user), upload POST (as app), properties PUT (as app)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [readUrl, readInit] = fetchMock.mock.calls[0];
    expect(readUrl).toBe('https://api.atlassian.com/ex/confluence/cloud-1/api/v2/pages/12345');
    expect(readInit.headers.Authorization).toBe('Bearer user-token');

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1];
    expect(uploadUrl).toBe('https://api.atlassian.com/ex/confluence/cloud-1/rest/api/content/12345/child/attachment');
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.headers.Authorization).toBe('Bearer sys-token'); // APP token, not the user's
    expect(uploadInit.headers['X-Atlassian-Token']).toBe('no-check');
  });

  it('targets the /data endpoint for a NEW VERSION and keeps the known id', async () => {
    routeFetch({ upload: fetchResponse(200, 'success') }); // /data may return non-JSON

    const res = await onRequest({
      request: makeRequest({ ...basePayload, attachmentId: 'att-existing-9', versionNumber: 4 }),
      data: FORGE_DATA,
    } as any);
    const json = await readJson(res);

    expect(json).toEqual({ ok: true, attachmentId: 'att-existing-9', versionNumber: 4 });
    const uploadUrl = fetchMock.mock.calls[1][0];
    expect(uploadUrl).toBe(
      'https://api.atlassian.com/ex/confluence/cloud-1/rest/api/content/12345/child/attachment/att-existing-9/data',
    );
  });

  it('rejects when the calling user cannot read the target page (confused-deputy guard)', async () => {
    routeFetch({ read: fetchResponse(403, 'no access') });

    const res = await onRequest({ request: makeRequest(basePayload), data: FORGE_DATA } as any);
    const json = await readJson(res);

    expect(json.ok).toBe(false);
    expect(json.status).toBe(403);
    // Must NOT have attempted the app-token write.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a Confluence upload rejection as { ok:false, status }', async () => {
    routeFetch({ upload: fetchResponse(403, 'app forbidden') });

    const res = await onRequest({ request: makeRequest(basePayload), data: FORGE_DATA } as any);
    const json = await readJson(res);

    expect(json).toMatchObject({ ok: false, status: 403 });
    // read + upload happened, but no PUT after a failed upload.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an attachmentName outside the zenuml-<id>.png namespace', async () => {
    const res = await onRequest({
      request: makeRequest({ ...basePayload, attachmentName: '../../evil.png' }),
      data: FORGE_DATA,
    } as any);
    const json = await readJson(res);

    expect(json).toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric pageId', async () => {
    const res = await onRequest({
      request: makeRequest({ ...basePayload, pageId: 'page-or-not' }),
      data: FORGE_DATA,
    } as any);
    expect((await readJson(res)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a payload whose bytes are not a PNG', async () => {
    const notPng = Buffer.from('hello world').toString('base64');
    const res = await onRequest({
      request: makeRequest({ ...basePayload, pngBase64: notPng }),
      data: FORGE_DATA,
    } as any);
    expect((await readJson(res)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when the app system token header is absent', async () => {
    const req = makeRequest(basePayload, { 'x-forge-oauth-system': '' });
    const res = await onRequest({ request: req, data: FORGE_DATA } as any);
    expect((await readJson(res)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when there is no verified forge context (apiBaseUrl)', async () => {
    const res = await onRequest({ request: makeRequest(basePayload), data: {} } as any);
    expect((await readJson(res)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Async (save-time) mode — perf/publish-async-backup.
  describe('async mode', () => {
    it('schedules the write via waitUntil and acks { ok:true, queued:true } immediately', async () => {
      routeFetch({
        read: fetchResponse(200, '{}'),
        upload: fetchResponse(200, JSON.stringify({ results: [{ id: 'att-async-1' }] })),
        put: fetchResponse(200, '{}'),
      });
      const scheduled: Promise<unknown>[] = [];
      const waitUntil = vi.fn((p: Promise<unknown>) => scheduled.push(p));

      const res = await onRequest({
        request: makeRequest({ ...basePayload, async: true }),
        data: FORGE_DATA,
        waitUntil,
      } as any);

      // Acked before the write ran.
      expect(await readJson(res)).toEqual({ ok: true, queued: true });
      expect(waitUntil).toHaveBeenCalledTimes(1);

      // The scheduled work still performs the full read + upload + PUT.
      await Promise.all(scheduled);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('still ACKs but does the read+upload+PUT inline when no waitUntil is available', async () => {
      routeFetch({
        read: fetchResponse(200, '{}'),
        upload: fetchResponse(200, JSON.stringify({ results: [{ id: 'att-async-2' }] })),
        put: fetchResponse(200, '{}'),
      });

      const res = await onRequest({
        request: makeRequest({ ...basePayload, async: true }),
        data: FORGE_DATA,
      } as any);

      expect(await readJson(res)).toEqual({ ok: true, queued: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('rejects invalid input BEFORE acking (validation is not bypassed by async)', async () => {
      const res = await onRequest({
        request: makeRequest({ ...basePayload, async: true, attachmentName: '../../evil.png' }),
        data: FORGE_DATA,
        waitUntil: vi.fn(),
      } as any);

      expect(await readJson(res)).toMatchObject({ ok: false, status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // JSON snapshot payloads (docs/superpowers/plans/2026-07-18-diagram-source-snapshot-attachments.md):
  // the frontend's PUT/POST-to-requestConfluence upload of `zenuml-<ccId>.json`
  // 404s through the Forge client proxy no matter the verb, and the v2 API has
  // no attachment-upload endpoint at all — so the snapshot rides this SAME
  // app-authenticated endpoint as the PNG, distinguished by contentType.
  describe('JSON snapshot payloads (application/json contentType)', () => {
    const JSON_BASE64 = Buffer.from(JSON.stringify({ version: 1, ccId: 'abc-uuid', dsl: 'A.method()' })).toString('base64');
    const jsonPayload = {
      pageId: '12345',
      attachmentName: 'zenuml-abc-uuid.json',
      hash: 'snapshot-v1-cc3',
      versionNumber: 1,
      dataBase64: JSON_BASE64,
      contentType: 'application/json',
    };

    it('accepts a JSON snapshot name + contentType and writes the blob as application/json', async () => {
      routeFetch({
        read: fetchResponse(200, '{}'),
        upload: fetchResponse(200, JSON.stringify({ results: [{ id: 'att-json-1' }] })),
        put: fetchResponse(200, '{}'),
      });

      const res = await onRequest({ request: makeRequest(jsonPayload), data: FORGE_DATA } as any);
      const json = await readJson(res);

      expect(json).toEqual({ ok: true, attachmentId: 'att-json-1', versionNumber: 1 });
      const uploadInit = fetchMock.mock.calls[1][1];
      const file = (uploadInit.body as FormData).get('file') as File;
      expect(file.type).toBe('application/json');
      expect(file.name).toBe('zenuml-abc-uuid.json');
    });

    it('still accepts a legacy call with no contentType field (defaults to image/png)', async () => {
      routeFetch({});
      const res = await onRequest({ request: makeRequest(basePayload), data: FORGE_DATA } as any);
      expect((await readJson(res)).ok).toBe(true);
      const uploadInit = fetchMock.mock.calls[1][1];
      const file = (uploadInit.body as FormData).get('file') as File;
      expect(file.type).toBe('image/png');
    });

    it('accepts the generic dataBase64 field for a PNG payload', async () => {
      routeFetch({});
      const res = await onRequest({
        request: makeRequest({ ...basePayload, pngBase64: undefined, dataBase64: PNG_BASE64 }),
        data: FORGE_DATA,
      } as any);
      expect((await readJson(res)).ok).toBe(true);
    });

    it('rejects a contentType outside the allowlist', async () => {
      const res = await onRequest({
        request: makeRequest({ ...jsonPayload, contentType: 'text/plain' }),
        data: FORGE_DATA,
      } as any);
      expect((await readJson(res)).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a .json attachmentName paired with contentType image/png (mismatch)', async () => {
      const res = await onRequest({
        request: makeRequest({ ...jsonPayload, contentType: 'image/png' }),
        data: FORGE_DATA,
      } as any);
      expect((await readJson(res)).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a .png attachmentName paired with contentType application/json (mismatch)', async () => {
      const res = await onRequest({
        request: makeRequest({ ...basePayload, contentType: 'application/json' }),
        data: FORGE_DATA,
      } as any);
      expect((await readJson(res)).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when both dataBase64 and pngBase64 are provided', async () => {
      const res = await onRequest({
        request: makeRequest({ ...basePayload, dataBase64: PNG_BASE64 }),
        data: FORGE_DATA,
      } as any);
      expect((await readJson(res)).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when neither dataBase64 nor pngBase64 is provided', async () => {
      const res = await onRequest({
        request: makeRequest({ ...basePayload, pngBase64: undefined }),
        data: FORGE_DATA,
      } as any);
      expect((await readJson(res)).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not enforce PNG magic bytes on an application/json payload', async () => {
      routeFetch({});
      const arbitraryJsonBytes = Buffer.from('{"version":1,"dsl":"whatever"}').toString('base64');
      const res = await onRequest({
        request: makeRequest({ ...jsonPayload, dataBase64: arbitraryJsonBytes }),
        data: FORGE_DATA,
      } as any);
      expect((await readJson(res)).ok).toBe(true);
    });
  });
});
