import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { onRequest } from './forge-upload-attachment';

// A minimal but magic-byte-valid PNG (the 8-byte signature is enough for the
// handler's PNG check; the body isn't rendered anywhere).
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

const FORGE_CONTEXT = { apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-1', forgeAppId: 'app-1' };

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

  // Route requests by method + token so tests don't depend on call ordering.
  // There are TWO GETs: the user read-check (Bearer user-token, confused-deputy
  // guard) and the app access pre-check (Bearer sys-token, issue #211).
  function routeFetch(handlers: {
    read?: Response;     // user read-check (Bearer user-token)
    appRead?: Response;  // app access pre-check (Bearer sys-token) — defaults to `read`
    upload?: Response;
    put?: Response;
  }) {
    fetchMock.mockImplementation((url: string, init: any) => {
      const method = init?.method ?? 'GET';
      const auth = init?.headers?.Authorization ?? '';
      if (method === 'GET') {
        if (auth === 'Bearer sys-token') {
          return Promise.resolve(handlers.appRead ?? handlers.read ?? fetchResponse(200, '{}'));
        }
        return Promise.resolve(handlers.read ?? fetchResponse(200, '{}'));
      }
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

    const res = await onRequest({ request: makeRequest(basePayload), env: { FORGE_CONTEXT } } as any);
    const json = await readJson(res);

    expect(json).toEqual({ ok: true, attachmentId: 'att-new-1', versionNumber: 1 });

    // user read-check (GET as user), app access pre-check (GET as app),
    // upload POST (as app), properties PUT (as app)
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [readUrl, readInit] = fetchMock.mock.calls[0];
    expect(readUrl).toBe('https://api.atlassian.com/ex/confluence/cloud-1/api/v2/pages/12345');
    expect(readInit.headers.Authorization).toBe('Bearer user-token');

    // app access pre-check (issue #211) — same v2 page URL, app token
    const [appReadUrl, appReadInit] = fetchMock.mock.calls[1];
    expect(appReadUrl).toBe('https://api.atlassian.com/ex/confluence/cloud-1/api/v2/pages/12345');
    expect(appReadInit.method).toBe('GET');
    expect(appReadInit.headers.Authorization).toBe('Bearer sys-token');

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[2];
    expect(uploadUrl).toBe('https://api.atlassian.com/ex/confluence/cloud-1/rest/api/content/12345/child/attachment');
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.headers.Authorization).toBe('Bearer sys-token'); // APP token, not the user's
    expect(uploadInit.headers['X-Atlassian-Token']).toBe('no-check');
  });

  it('skips the write when the APP cannot access the page (issue #211)', async () => {
    // User can read (confused-deputy guard passes) but the app isn't a member
    // of the (restricted) space → its access pre-check 404s. We must NOT attempt
    // the multipart upload, and should return a clear app_no_access signal.
    routeFetch({ read: fetchResponse(200, '{}'), appRead: fetchResponse(404, 'not found') });

    const res = await onRequest({ request: makeRequest(basePayload), env: { FORGE_CONTEXT } } as any);
    const json = await readJson(res);

    expect(json).toMatchObject({ ok: false, status: 404 });
    expect(json.body).toContain('app_no_access');
    // user read-check + app access pre-check ran; NO upload POST, NO PUT.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]: any) => init.method !== 'POST')).toBe(true);
  });

  it('targets the /data endpoint for a NEW VERSION and keeps the known id', async () => {
    routeFetch({ upload: fetchResponse(200, 'success') }); // /data may return non-JSON

    const res = await onRequest({
      request: makeRequest({ ...basePayload, attachmentId: 'att-existing-9', versionNumber: 4 }),
      env: { FORGE_CONTEXT },
    } as any);
    const json = await readJson(res);

    expect(json).toEqual({ ok: true, attachmentId: 'att-existing-9', versionNumber: 4 });
    // calls: [0]=user read, [1]=app read (#211), [2]=upload POST
    const uploadUrl = fetchMock.mock.calls[2][0];
    expect(uploadUrl).toBe(
      'https://api.atlassian.com/ex/confluence/cloud-1/rest/api/content/12345/child/attachment/att-existing-9/data',
    );
  });

  it('rejects when the calling user cannot read the target page (confused-deputy guard)', async () => {
    routeFetch({ read: fetchResponse(403, 'no access') });

    const res = await onRequest({ request: makeRequest(basePayload), env: { FORGE_CONTEXT } } as any);
    const json = await readJson(res);

    expect(json.ok).toBe(false);
    expect(json.status).toBe(403);
    // Must NOT have attempted the app-token write.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a Confluence upload rejection as { ok:false, status }', async () => {
    routeFetch({ upload: fetchResponse(403, 'app forbidden') });

    const res = await onRequest({ request: makeRequest(basePayload), env: { FORGE_CONTEXT } } as any);
    const json = await readJson(res);

    expect(json).toMatchObject({ ok: false, status: 403 });
    // user read + app read + upload happened, but no PUT after a failed upload.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects an attachmentName outside the zenuml-<id>.png namespace', async () => {
    const res = await onRequest({
      request: makeRequest({ ...basePayload, attachmentName: '../../evil.png' }),
      env: { FORGE_CONTEXT },
    } as any);
    const json = await readJson(res);

    expect(json).toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric pageId', async () => {
    const res = await onRequest({
      request: makeRequest({ ...basePayload, pageId: 'page-or-not' }),
      env: { FORGE_CONTEXT },
    } as any);
    expect((await readJson(res)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a payload whose bytes are not a PNG', async () => {
    const notPng = Buffer.from('hello world').toString('base64');
    const res = await onRequest({
      request: makeRequest({ ...basePayload, pngBase64: notPng }),
      env: { FORGE_CONTEXT },
    } as any);
    expect((await readJson(res)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when the app system token header is absent', async () => {
    const req = makeRequest(basePayload, { 'x-forge-oauth-system': '' });
    const res = await onRequest({ request: req, env: { FORGE_CONTEXT } } as any);
    expect((await readJson(res)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when there is no verified forge context (apiBaseUrl)', async () => {
    const res = await onRequest({ request: makeRequest(basePayload), env: {} } as any);
    expect((await readJson(res)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
