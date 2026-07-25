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
      // Analytics (#392) rides the same global fetch — always ack it, or a test
      // routing a 4xx to the upload leg would also fail the Mixpanel POST and
      // swallow the very event it is asserting on.
      if (String(url).includes('api.mixpanel.com')) return Promise.resolve(fetchResponse(200, '{}'));
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

    // #392 — the async write is invisible to the browser tracker (its iframe is
    // gone by then), so this handler is the only place its outcome can be
    // recorded. Before this, failures were a console.warn and nothing else.
    describe('outcome reporting', () => {
      const ENV = { MIXPANEL_TOKEN: 'tok-1' };

      async function runAsync(handlers: Parameters<typeof routeFetch>[0], env: any = ENV) {
        routeFetch(handlers);
        const scheduled: Promise<unknown>[] = [];
        await onRequest({
          request: makeRequest({ ...basePayload, async: true }),
          data: { forgeContext: { ...FORGE_CONTEXT, accountId: 'acct-9' } },
          env,
          waitUntil: (p: Promise<unknown>) => scheduled.push(p),
        } as any);
        await Promise.all(scheduled);
        // The Mixpanel import POST is the last call; identify() precedes it.
        return fetchMock.mock.calls.filter((c: any[]) =>
          String(c[0]).includes('api.mixpanel.com/import'),
        );
      }

      function trackedEvent(calls: any[]) {
        return JSON.parse(calls[0][1].body)[0];
      }

      it('reports attachment_upload_async_succeeded when the write lands', async () => {
        const calls = await runAsync({
          read: fetchResponse(200, '{}'),
          upload: fetchResponse(200, JSON.stringify({ results: [{ id: 'att-async-3' }] })),
          put: fetchResponse(200, '{}'),
        });

        const event = trackedEvent(calls);
        expect(event.event).toBe('attachment_upload_async_succeeded');
        expect(event.properties).toMatchObject({
          surface: 'backend',
          from_save: true,
          page_id: '12345',
          attachment_name: 'zenuml-abc-uuid.png',
          attachment_id: 'att-async-3',
          distinct_id: 'acct-9',
        });
      });

      it('reports the failing stage when the app-side upload is rejected', async () => {
        const calls = await runAsync({
          read: fetchResponse(200, '{}'),
          upload: fetchResponse(403, 'PermissionException'),
        });

        const event = trackedEvent(calls);
        expect(event.event).toBe('attachment_upload_async_failed');
        expect(event.properties).toMatchObject({
          event_label: 'http_403',
          http_status: 403,
          failure_stage: 'upload',
        });
      });

      it('distinguishes a read-check denial from an upload rejection', async () => {
        const calls = await runAsync({ read: fetchResponse(404, 'no such page') });

        expect(trackedEvent(calls).properties).toMatchObject({
          failure_stage: 'read_check',
          http_status: 403,
        });
      });

      it('distinguishes a properties-PUT failure', async () => {
        const calls = await runAsync({
          read: fetchResponse(200, '{}'),
          upload: fetchResponse(200, JSON.stringify({ results: [{ id: 'att-async-4' }] })),
          put: fetchResponse(500, 'boom'),
        });

        expect(trackedEvent(calls).properties).toMatchObject({
          failure_stage: 'properties_put',
          http_status: 500,
        });
      });

      it('reports a thrown handler error rather than losing it', async () => {
        // A network-level throw is exactly the blind spot this closes — it
        // never produces an { ok:false } result to inspect.
        fetchMock.mockImplementation((url: string) =>
          String(url).includes('api.mixpanel.com')
            ? Promise.resolve(fetchResponse(200, '{}'))
            : Promise.reject(new Error('socket hang up')),
        );
        const scheduled: Promise<unknown>[] = [];
        await onRequest({
          request: makeRequest({ ...basePayload, async: true }),
          data: FORGE_DATA,
          env: ENV,
          waitUntil: (p: Promise<unknown>) => scheduled.push(p),
        } as any);
        await Promise.all(scheduled);

        const calls = fetchMock.mock.calls.filter((c: any[]) =>
          String(c[0]).includes('api.mixpanel.com/import'),
        );
        expect(trackedEvent(calls).properties).toMatchObject({
          failure_stage: 'handler_error',
          failure_reason: 'socket hang up',
        });
      });

      // Follow-ups from the lite-stg spot check on #392: every async event was
      // a _failed/http_404 whose reason was the envelope, truncated at 200
      // chars — i.e. an all-benign bucket reported as a 100% failure rate,
      // undiagnosable.
      it('reports a 404 on an unpublished page as a skip, not a failure', async () => {
        const calls = await runAsync({
          read: fetchResponse(200, JSON.stringify({ id: '12345', status: 'draft' })),
          upload: fetchResponse(
            404,
            JSON.stringify({
              statusCode: 404,
              data: { authorized: true, valid: true, errors: [], successful: true },
              message:
                'com.atlassian.confluence.api.service.exceptions.api.NotFoundException: No content found with id : ContentId{id=12345}',
            }),
          ),
        });

        const event = trackedEvent(calls);
        expect(event.event).toBe('attachment_upload_async_skipped');
        expect(event.properties).toMatchObject({
          event_label: 'page_not_published',
          content_status: 'draft',
        });
      });

      it('keeps a 404 on a PUBLISHED page as a failure (app cannot see it)', async () => {
        const calls = await runAsync({
          read: fetchResponse(200, JSON.stringify({ id: '12345', status: 'current' })),
          upload: fetchResponse(404, JSON.stringify({ statusCode: 404, message: 'NotFoundException: nope' })),
        });

        const event = trackedEvent(calls);
        expect(event.event).toBe('attachment_upload_async_failed');
        expect(event.properties).toMatchObject({
          event_label: 'app_no_access',
          content_status: 'current',
        });
      });

      it('does not assume benign when the page status is unknown', async () => {
        const calls = await runAsync({
          read: fetchResponse(200, 'not json'),
          upload: fetchResponse(404, JSON.stringify({ statusCode: 404, message: 'NotFoundException: nope' })),
        });

        const event = trackedEvent(calls);
        expect(event.event).toBe('attachment_upload_async_failed');
        expect(event.properties).toMatchObject({ event_label: 'http_404', content_status: 'unknown' });
      });

      it('keeps a 403 a failure even on an unpublished page', async () => {
        // The caller is the page editor at save time, so an app-auth denial is
        // a real anomaly — only 404 is reclassified (#387's rule).
        const calls = await runAsync({
          read: fetchResponse(200, JSON.stringify({ status: 'draft' })),
          upload: fetchResponse(403, JSON.stringify({ statusCode: 403, message: 'PermissionException: denied' })),
        });

        expect(trackedEvent(calls).event).toBe('attachment_upload_async_failed');
      });

      it('records the Confluence message, not the envelope, in failure_reason', async () => {
        const calls = await runAsync({
          read: fetchResponse(200, JSON.stringify({ status: 'current' })),
          upload: fetchResponse(
            400,
            JSON.stringify({
              statusCode: 400,
              data: { authorized: true, valid: true, errors: [], successful: true },
              message:
                'com.atlassian.confluence.api.service.exceptions.api.BadRequestException: Cannot add a new attachment with same file name as an existing attachment',
            }),
          ),
        });

        const reason = String(trackedEvent(calls).properties.failure_reason);
        expect(reason).toContain('same file name as an existing attachment');
        expect(reason).not.toContain('"authorized"');
      });

      it('completes the write even when no Mixpanel token is configured', async () => {
        const calls = await runAsync(
          {
            read: fetchResponse(200, '{}'),
            upload: fetchResponse(200, JSON.stringify({ results: [{ id: 'att-async-5' }] })),
            put: fetchResponse(200, '{}'),
          },
          {},
        );

        expect(calls).toHaveLength(0);
        // read + upload + PUT still happened; only the reporting is skipped.
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });
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
