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
