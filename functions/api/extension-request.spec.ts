import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { onRequest, onRequestPost, type ExtensionRequestBody } from './extension-request';

const validBody: ExtensionRequestBody = {
  email: 'user@example.com',
  clientDomain: 'example-tenant',
  spaceKey: 'TEST',
  macroCount: 105,
  macrosLimit: 100,
  macroKind: 'sequence',
  productType: 'lite',
  appVersion: '1.0.0',
  accountId: 'account-123',
  pageId: 'page-456',
};

function makeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    _store: store,
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    JSM_API_EMAIL: 'support@zenuml.com',
    JSM_API_TOKEN: 'secret-token',
    confluence_plugin_features: makeKv(),
    ...overrides,
  } as any;
}

function makeContext(body: unknown, env = makeEnv(), method = 'POST') {
  const request = new Request('https://example.com/api/extension-request', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return { request, env } as any;
}

function jsmResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

describe('extension-request endpoint', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns 500 when JSM credentials are not configured', async () => {
    const res = await onRequestPost(makeContext(validBody, makeEnv({ JSM_API_TOKEN: undefined })));
    expect(res.status).toBe(500);
    expect((await readJson(res)).error).toBe('server_configuration');
  });

  it('returns 400 for an invalid email', async () => {
    const res = await onRequestPost(makeContext({ ...validBody, email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('invalid_email');
  });

  it('returns 400 when clientDomain or spaceKey is missing', async () => {
    const res = await onRequestPost(makeContext({ ...validBody, spaceKey: '' }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('missing_fields');
  });

  it('creates the JSM request with raiseOnBehalfOf and the free-extension option, returns 201 with the issue key', async () => {
    fetchMock.mockResolvedValueOnce(jsmResponse(201, { issueKey: 'ZEN-42' }));

    const res = await onRequestPost(makeContext(validBody));

    expect(res.status).toBe(201);
    expect((await readJson(res)).issueKey).toBe('ZEN-42');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://zenuml.atlassian.net/rest/servicedeskapi/request');
    expect(init.headers.Authorization).toBe('Basic ' + btoa('support@zenuml.com:secret-token'));

    const payload = JSON.parse(init.body);
    expect(payload.serviceDeskId).toBe('1');
    expect(payload.requestTypeId).toBe('9');
    expect(payload.raiseOnBehalfOf).toBe('user@example.com');
    expect(payload.requestFieldValues.summary).toBe('https://example-tenant.atlassian.net');
    expect(payload.requestFieldValues.description).toContain('Space key: TEST');
    expect(payload.requestFieldValues.description).toContain('Macro count: 105');
    expect(payload.requestFieldValues.customfield_10070).toEqual({ id: '10037' });
  });

  it('creates the customer and retries once when JSM rejects the unknown email', async () => {
    fetchMock
      .mockResolvedValueOnce(jsmResponse(400, { errorMessage: 'unknown customer' }))
      .mockResolvedValueOnce(jsmResponse(201, {})) // customer creation
      .mockResolvedValueOnce(jsmResponse(201, { issueKey: 'ZEN-43' }));

    const res = await onRequestPost(makeContext(validBody));

    expect(res.status).toBe(201);
    expect((await readJson(res)).issueKey).toBe('ZEN-43');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('https://zenuml.atlassian.net/rest/servicedeskapi/customer');
  });

  it('returns 502 when JSM fails persistently', async () => {
    fetchMock
      .mockResolvedValueOnce(jsmResponse(400, {}))
      .mockResolvedValueOnce(jsmResponse(201, {}))
      .mockResolvedValueOnce(jsmResponse(400, {}));

    const res = await onRequestPost(makeContext(validBody));

    expect(res.status).toBe(502);
    expect((await readJson(res)).error).toBe('jsm_request_failed');
  });

  it('rate-limits the 4th request per domain+account within a day', async () => {
    fetchMock.mockResolvedValue(jsmResponse(201, { issueKey: 'ZEN-44' }));
    const env = makeEnv();

    for (let i = 0; i < 3; i++) {
      const ok = await onRequestPost(makeContext(validBody, env));
      expect(ok.status).toBe(201);
    }
    const blocked = await onRequestPost(makeContext(validBody, env));
    expect(blocked.status).toBe(429);
    expect((await readJson(blocked)).error).toBe('rate_limited');
    // JSM was only called for the 3 allowed requests.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('prefers the accountId from the verified Forge token over the body', async () => {
    fetchMock.mockResolvedValue(jsmResponse(201, {}));
    const env = makeEnv({
      FORGE_CONTEXT: { payload: { principal: { accountId: 'token-account' } } },
    });

    await onRequestPost(makeContext(validBody, env));

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.requestFieldValues.description).toContain('User account ID: token-account');
    expect(env.confluence_plugin_features.put).toHaveBeenCalledWith(
      'ext-req-rate:example-tenant:token-account',
      '1',
      expect.objectContaining({ expirationTtl: 86400 })
    );
  });

  it('rejects non-POST methods with 405', async () => {
    const res = await onRequest(makeContext(undefined, makeEnv(), 'GET'));
    expect(res.status).toBe(405);
  });
});
