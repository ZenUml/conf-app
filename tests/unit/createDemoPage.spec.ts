import { describe, it, expect, vi, beforeEach } from 'vitest';

const { asAppRequest, asUserRequest, storageGet, storageSet } = vi.hoisted(() => ({
  asAppRequest: vi.fn(),
  asUserRequest: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence: asUserRequest }),
    asApp: () => ({ requestConfluence: asAppRequest }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + String(values[i] ?? ''), ''),
  storage: { get: storageGet, set: storageSet },
}));

import { handler } from '../../src/createDemoPage';

function makeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function callHandler(payload: { spaceKey: string }, accountId = 'user-1') {
  return handler({ payload, context: { accountId, cloudId: 'cloud-1' } } as any);
}

describe('createDemoPage — authorization', () => {
  beforeEach(() => {
    asUserRequest.mockReset();
    asAppRequest.mockReset();
    storageGet.mockReset();
    storageSet.mockReset();
  });

  it('rejects with 403 when the user is in no admin group', async () => {
    asUserRequest.mockResolvedValueOnce(
      makeResponse({ results: [{ name: 'confluence-users' }] }),
    );

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toEqual({ ok: false, status: 403, error: 'not_authorized' });
    expect(asAppRequest).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the memberof request itself fails', async () => {
    asUserRequest.mockResolvedValueOnce(makeResponse({}, 500));

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toEqual({ ok: false, status: 403, error: 'not_authorized' });
    expect(asAppRequest).not.toHaveBeenCalled();
  });

  it('accepts site-admins group membership', async () => {
    asUserRequest.mockResolvedValueOnce(
      makeResponse({ results: [{ name: 'site-admins' }] }),
    );
    storageGet.mockResolvedValueOnce(undefined);

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).not.toMatchObject({ status: 403 });
  });

  it('accepts confluence-admins-<site> regex-style group membership', async () => {
    asUserRequest.mockResolvedValueOnce(
      makeResponse({ results: [{ name: 'confluence-admins-acme' }] }),
    );
    storageGet.mockResolvedValueOnce(undefined);

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).not.toMatchObject({ status: 403 });
  });
});

describe('createDemoPage — space resolution', () => {
  beforeEach(() => {
    asUserRequest.mockReset();
    asAppRequest.mockReset();
    storageGet.mockReset();
    storageSet.mockReset();
    asUserRequest.mockImplementation((url: string) => {
      if (url.includes('/wiki/rest/api/user/memberof')) {
        return Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] }));
      }
      return Promise.resolve(makeResponse({ results: [] }, 500));
    });
  });

  it('returns 404 when the space key resolves to zero spaces', async () => {
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] })),
    );
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({ results: [] })),
    );

    const result = await callHandler({ spaceKey: 'NOPE' });
    expect(result).toMatchObject({ ok: false, status: 404, error: 'space_not_found' });
  });

  it('returns 400 when the resolved space is archived or non-global', async () => {
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] })),
    );
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(
        makeResponse({
          results: [{ id: '111', key: 'OLD', type: 'global', status: 'archived' }],
        }),
      ),
    );

    const result = await callHandler({ spaceKey: 'OLD' });
    expect(result).toMatchObject({ ok: false, status: 400, error: 'space_not_eligible' });
  });

  it('calls /wiki/api/v2/spaces?keys=<spaceKey> with the supplied key', async () => {
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] })),
    );
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(
        makeResponse({
          results: [{ id: '222', key: 'DEMO', type: 'global', status: 'current' }],
        }),
      ),
    );
    storageGet.mockResolvedValueOnce(undefined);

    await callHandler({ spaceKey: 'DEMO' });

    const urls = asUserRequest.mock.calls.map(c => c[0] as string);
    expect(urls[1]).toContain('/wiki/api/v2/spaces');
    expect(urls[1]).toContain('keys=DEMO');
  });
});

describe('createDemoPage — idempotency', () => {
  beforeEach(() => {
    asUserRequest.mockReset();
    asAppRequest.mockReset();
    storageGet.mockReset();
    storageSet.mockReset();

    asUserRequest.mockImplementation((url: string) => {
      if (url.includes('/wiki/rest/api/user/memberof')) {
        return Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] }));
      }
      if (url.includes('/wiki/api/v2/spaces')) {
        return Promise.resolve(
          makeResponse({
            results: [{ id: '222', key: 'DEMO', type: 'global', status: 'current' }],
          }),
        );
      }
      return Promise.resolve(makeResponse({}, 500));
    });
  });

  it('returns the stored marker without POSTing when marker is present', async () => {
    storageGet.mockResolvedValueOnce({
      pageId: '999',
      createdAt: '2026-05-18T00:00:00.000Z',
      source: 'manual',
    });

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toMatchObject({
      ok: true,
      alreadyExists: true,
      pageId: '999',
    });
    expect(asAppRequest).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('looks up the marker under the per-space key', async () => {
    storageGet.mockResolvedValueOnce({
      pageId: '999',
      createdAt: '2026-05-18T00:00:00.000Z',
      source: 'manual',
    });

    await callHandler({ spaceKey: 'DEMO' });

    expect(storageGet).toHaveBeenCalledWith('demo-page:DEMO');
  });
});
