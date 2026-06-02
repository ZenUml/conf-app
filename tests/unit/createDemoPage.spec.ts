import { describe, it, expect, vi, beforeEach } from 'vitest';

const { asAppRequest, asUserRequest, storageGet, storageSet, storageDelete, storageQuery, getAppContext } = vi.hoisted(() => ({
  asAppRequest: vi.fn(),
  asUserRequest: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageDelete: vi.fn(),
  storageQuery: vi.fn(() => ({
    where: () => ({ getMany: async () => ({ results: [] }) }),
  })),
  getAppContext: vi.fn(() => ({
    appAri: { appId: '01ede8b1-4e88-451a-b9ef-89eeef93afaf' },
    environmentAri: { environmentId: '8e7caf78-b9d2-499a-9450-9249f305f5f6' },
    environmentType: 'DEVELOPMENT',
  })),
}));

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence: asUserRequest }),
    asApp: () => ({ requestConfluence: asAppRequest }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + String(values[i] ?? ''), ''),
  storage: { get: storageGet, set: storageSet, delete: storageDelete, query: storageQuery },
  getAppContext,
}));

import { enrollSpaceImpl, runEnrollmentPipelineImpl } from '../../src/createDemoPage';
import { MACROS, DIAGRAMLY_CUSTOM_CONTENT_TYPE } from '../../src/demoPageContent';

function makeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function callHandler(payload: { spaceKey: string }, accountId = 'user-1') {
  return enrollSpaceImpl({ payload, context: { accountId, cloudId: 'cloud-1' } });
}

// Default asUser mock: site-admin + space lookup not used by-asUser anymore
// (resolveSpace was moved to asApp so the pipeline can resolve without a
// caller). Only the memberof check remains.
function installAdminUserMock(adminGroup = 'site-admins') {
  asUserRequest.mockImplementation((url: string) => {
    if (url.includes('/wiki/rest/api/user/memberof')) {
      return Promise.resolve(makeResponse({ results: [{ name: adminGroup }] }));
    }
    return Promise.resolve(makeResponse({}, 500));
  });
}

/**
 * asApp routes:
 *  - GET  /wiki/api/v2/spaces?keys=...     -> space resolution
 *  - POST /wiki/api/v2/pages               -> draft create
 *  - POST /wiki/api/v2/custom-content      -> custom-content create (one per macro)
 *  - PUT  /wiki/api/v2/pages/<id>          -> publish draft
 *  - POST /wiki/api/v2/pages/<id>/properties -> page-property tag
 *
 * Override individual responses via `overrides` to test failure paths.
 * On failure the unpublished draft is left orphaned (no delete:page scope).
 */
function installHappyPathAsAppMock(overrides: {
  space?: Response;
  draft?: Response;
  customContent?: Response[];
  publish?: Response;
  property?: Response;
} = {}) {
  let customContentIdx = 0;
  const spaceRes =
    overrides.space ??
    makeResponse({ results: [{ id: '222', key: 'DEMO', type: 'global', status: 'current' }] });
  const draftRes = overrides.draft ?? makeResponse({ id: 'draft-1', version: { number: 1 } });
  const customContentResponses =
    overrides.customContent ??
    MACROS.map((m, i) => makeResponse({ id: `cc-${m.id}-${i + 100}` }));
  const publishRes = overrides.publish ?? makeResponse({ id: 'draft-1' });
  const propertyRes = overrides.property ?? makeResponse({ id: 'prop-1' }, 201);

  asAppRequest.mockImplementation((url: string, init: any = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('/wiki/api/v2/spaces')) {
      return Promise.resolve(spaceRes);
    }
    if (method === 'POST' && url === '/wiki/api/v2/pages') {
      return Promise.resolve(draftRes);
    }
    if (method === 'POST' && url === '/wiki/api/v2/custom-content') {
      const res = customContentResponses[customContentIdx] ?? makeResponse({}, 500);
      customContentIdx += 1;
      return Promise.resolve(res);
    }
    if (method === 'POST' && /\/properties$/.test(url)) {
      return Promise.resolve(propertyRes);
    }
    if (method === 'PUT' && url.startsWith('/wiki/api/v2/pages/')) {
      return Promise.resolve(publishRes);
    }
    return Promise.resolve(makeResponse({}, 500));
  });
}

beforeEach(() => {
  asAppRequest.mockReset();
  asUserRequest.mockReset();
  storageGet.mockReset();
  storageSet.mockReset();
  storageDelete.mockReset();
  storageQuery.mockReset();
  storageQuery.mockReturnValue({ where: () => ({ getMany: async () => ({ results: [] }) }) });
  storageGet.mockResolvedValue(undefined);
});

describe('enrollSpace — authorization', () => {
  it('rejects with 403 when the user is in no admin group', async () => {
    asUserRequest.mockResolvedValueOnce(
      makeResponse({ results: [{ name: 'confluence-users' }] }),
    );

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toEqual({ ok: false, status: 403, error: 'not_authorized' });
    expect(asAppRequest).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('accepts site-admins, confluence-admins-<site>, confluence-administrators', async () => {
    for (const group of ['site-admins', 'confluence-admins-acme', 'confluence-administrators']) {
      asAppRequest.mockReset();
      storageGet.mockReset(); storageSet.mockReset();
      storageGet.mockResolvedValue(undefined);
      installAdminUserMock(group);
      installHappyPathAsAppMock();
      const result = await callHandler({ spaceKey: 'DEMO' });
      expect(result).not.toMatchObject({ status: 403 });
    }
  });

  it('rejects look-alike groups that do not match the admin regex', async () => {
    asUserRequest.mockResolvedValueOnce(
      makeResponse({ results: [{ name: 'site-admins-fake' }, { name: 'confluence-admin' }] }),
    );

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toEqual({ ok: false, status: 403, error: 'not_authorized' });
  });
});

describe('enrollSpace — space resolution', () => {
  it('returns 404 when the space key resolves to zero spaces', async () => {
    installAdminUserMock();
    installHappyPathAsAppMock({ space: makeResponse({ results: [] }) });

    const result = await callHandler({ spaceKey: 'NOPE' });
    expect(result).toMatchObject({ ok: false, status: 404, error: 'space_not_found' });
    expect(storageSet).not.toHaveBeenCalledWith(
      expect.stringMatching(/^enrollment:/),
      expect.anything(),
    );
  });

  it('returns 400 when the resolved space is archived or non-global', async () => {
    installAdminUserMock();
    installHappyPathAsAppMock({
      space: makeResponse({ results: [{ id: '111', key: 'OLD', type: 'global', status: 'archived' }] }),
    });

    const result = await callHandler({ spaceKey: 'OLD' });
    expect(result).toMatchObject({ ok: false, status: 400, error: 'space_not_eligible' });
  });
});

describe('enrollSpace — opt-out is terminal (criterion 6)', () => {
  beforeEach(() => {
    installAdminUserMock();
  });

  it('returns alreadyExists when marker has state:done — regardless of subsequent page status', async () => {
    storageGet.mockImplementation(async (key: string) => {
      if (key === 'demo-page:DEMO') {
        return { state: 'done', pageId: '999', createdAt: '2026-05-18T00:00:00.000Z', source: 'admin' };
      }
      return undefined;
    });
    installHappyPathAsAppMock();

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toMatchObject({ ok: true, alreadyExists: true, pageId: '999' });
    // Crucially: NO draft create, NO publish, NO new marker write.
    const writes = asAppRequest.mock.calls.filter(([url, init]) =>
      ((init as any)?.method || 'GET').toUpperCase() !== 'GET' &&
      (url as string).startsWith('/wiki/api/v2/pages'),
    );
    expect(writes.length).toBe(0);
    // The marker is NOT cleared, and we do NOT GET the page to check status —
    // archived/deleted is opt-out, not a trigger to recreate.
    expect(storageDelete).not.toHaveBeenCalled();
    const markerGetCalls = asAppRequest.mock.calls.filter(([url, init]) => {
      const m = ((init as any)?.method || 'GET').toUpperCase();
      return m === 'GET' && /^\/wiki\/api\/v2\/pages\/[^/?]+$/.test(url as string);
    });
    expect(markerGetCalls.length).toBe(0);
  });

  it('also treats legacy markers (no `state` field, just {pageId}) as terminal', async () => {
    storageGet.mockImplementation(async (key: string) => {
      if (key === 'demo-page:DEMO') {
        return { pageId: '888', createdAt: '2026-05-17T00:00:00.000Z', source: 'manual' };
      }
      return undefined;
    });
    installHappyPathAsAppMock();

    const result = await callHandler({ spaceKey: 'DEMO' });
    expect(result).toMatchObject({ ok: true, alreadyExists: true, pageId: '888' });
  });
});

describe('enrollSpace — creating sentinel (criterion 5)', () => {
  beforeEach(() => {
    installAdminUserMock();
  });

  it('returns in_progress when a recent `creating` marker is present', async () => {
    storageGet.mockImplementation(async (key: string) => {
      if (key === 'demo-page:DEMO') {
        return { state: 'creating', startedAt: new Date().toISOString(), source: 'pipeline' };
      }
      return undefined;
    });
    installHappyPathAsAppMock();

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toMatchObject({ ok: false, status: 409, error: 'in_progress' });
    // No draft, no publish.
    const writes = asAppRequest.mock.calls.filter(
      ([, init]) => ((init as any)?.method || 'GET').toUpperCase() !== 'GET',
    );
    expect(writes.length).toBe(0);
  });

  it('treats a stale `creating` marker (>5min) as crashed and recreates', async () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    storageGet.mockImplementation(async (key: string) => {
      if (key === 'demo-page:DEMO') {
        return { state: 'creating', startedAt: stale, source: 'pipeline' };
      }
      return undefined;
    });
    installHappyPathAsAppMock();

    const result = await callHandler({ spaceKey: 'DEMO' });
    expect(result).toMatchObject({ ok: true, pageId: 'draft-1' });
    // Final marker is `done`, not `creating`.
    const finalDoneSet = storageSet.mock.calls.find(
      ([k, v]) => k === 'demo-page:DEMO' && v.state === 'done',
    );
    expect(finalDoneSet).toBeDefined();
  });

  it('writes a `creating` sentinel BEFORE making any Confluence write call', async () => {
    installHappyPathAsAppMock();

    await callHandler({ spaceKey: 'DEMO' });

    const setCalls = storageSet.mock.calls.filter(([k]) => k === 'demo-page:DEMO');
    expect(setCalls.length).toBeGreaterThanOrEqual(2);
    expect(setCalls[0][1]).toMatchObject({ state: 'creating' });
    expect(setCalls[setCalls.length - 1][1]).toMatchObject({ state: 'done', pageId: 'draft-1' });
  });
});

describe('enrollSpace — full happy path', () => {
  beforeEach(() => {
    installAdminUserMock();
  });

  it('writes enrollment KV, creates draft + 4 custom-content + publishes + tags page', async () => {
    installHappyPathAsAppMock();

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toMatchObject({ ok: true, pageId: 'draft-1', enrolled: true, spaceKey: 'DEMO' });

    const calls = asAppRequest.mock.calls.map(([url, init]) => ({
      url: url as string,
      method: ((init as any)?.method || 'GET').toUpperCase(),
      body: (init as any)?.body ? JSON.parse((init as any).body) : null,
    }));

    expect(calls.find(c => c.method === 'GET' && c.url.includes('/wiki/api/v2/spaces'))).toBeDefined();
    const draftCall = calls.find(c => c.method === 'POST' && c.url === '/wiki/api/v2/pages');
    expect(draftCall!.body.status).toBe('draft');
    expect(draftCall!.body.spaceId).toBe('222');

    const ccCalls = calls.filter(c => c.method === 'POST' && c.url === '/wiki/api/v2/custom-content');
    expect(ccCalls.length).toBe(MACROS.length);
    for (const c of ccCalls) {
      expect(c.body.type).toBe(DIAGRAMLY_CUSTOM_CONTENT_TYPE);
    }

    const publishCall = calls.find(c => c.method === 'PUT' && c.url.startsWith('/wiki/api/v2/pages/'));
    expect(publishCall!.body.status).toBe('current');
    expect(publishCall!.body.version.number).toBe(1);

    const tagCall = calls.find(c => c.method === 'POST' && /\/properties$/.test(c.url));
    expect(tagCall).toBeDefined();
    expect(tagCall!.body.key).toBe('diagramly-demo-page');
    expect(tagCall!.body.value.isDemoPage).toBe(true);

    // Enrollment marker written.
    expect(storageSet).toHaveBeenCalledWith(
      'enrollment:DEMO',
      expect.objectContaining({ state: 'enabled' }),
    );
    // Final demo-page marker is `done` with pageId.
    expect(storageSet).toHaveBeenCalledWith(
      'demo-page:DEMO',
      expect.objectContaining({ state: 'done', pageId: 'draft-1' }),
    );
  });

  it('does NOT promote marker to done and surfaces orphanDraftPageId when custom-content fails', async () => {
    const ccResponses = MACROS.map((_, i) =>
      i === 0 ? makeResponse({ message: 'forbidden' }, 403) : makeResponse({ id: `cc-${i}` }),
    );
    installHappyPathAsAppMock({ customContent: ccResponses });

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: 'custom_content_failed',
      orphanDraftPageId: 'draft-1',
    });
    // `creating` sentinel was written, but no `done` follow-up.
    const doneSet = storageSet.mock.calls.find(
      ([k, v]) => k === 'demo-page:DEMO' && v.state === 'done',
    );
    expect(doneSet).toBeUndefined();
  });

  it('does NOT promote marker to done when publish fails', async () => {
    installHappyPathAsAppMock({ publish: makeResponse({ message: 'rate limited' }, 429) });

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      error: 'publish_failed',
      orphanDraftPageId: 'draft-1',
    });
    const doneSet = storageSet.mock.calls.find(
      ([k, v]) => k === 'demo-page:DEMO' && v.state === 'done',
    );
    expect(doneSet).toBeUndefined();
  });
});

describe('runEnrollmentPipelineImpl — scheduled scan', () => {
  it('processes enrolled spaces that have no demo-page marker yet', async () => {
    storageQuery.mockReturnValue({
      where: () => ({
        getMany: async () => ({
          results: [
            { key: 'enrollment:NEW', value: { state: 'enabled' } },
            { key: 'enrollment:OLD', value: { state: 'enabled' } },
            { key: 'enrollment:DISABLED', value: { state: 'disabled' } },
          ],
        }),
      }),
    });
    storageGet.mockImplementation(async (key: string) => {
      // NEW has no marker; OLD already done; DISABLED skipped before getting here.
      if (key === 'demo-page:OLD') return { state: 'done', pageId: '777', createdAt: 'x', source: 'admin' };
      return undefined;
    });
    installHappyPathAsAppMock();

    const summary = await runEnrollmentPipelineImpl();
    expect(summary.processed).toBe(1);    // NEW
    expect(summary.skipped).toBe(2);      // OLD (done), DISABLED
    expect(summary.errors).toBe(0);

    // Only NEW got a draft create.
    const draftCalls = asAppRequest.mock.calls.filter(
      ([url, init]) =>
        (url as string) === '/wiki/api/v2/pages' &&
        ((init as any)?.method || 'GET').toUpperCase() === 'POST',
    );
    expect(draftCalls.length).toBe(1);
  });

  it('skips an enrolled space when a recent `creating` marker is present', async () => {
    storageQuery.mockReturnValue({
      where: () => ({
        getMany: async () => ({
          results: [{ key: 'enrollment:BUSY', value: { state: 'enabled' } }],
        }),
      }),
    });
    storageGet.mockImplementation(async (key: string) => {
      if (key === 'demo-page:BUSY') {
        return { state: 'creating', startedAt: new Date().toISOString(), source: 'admin' };
      }
      return undefined;
    });
    installHappyPathAsAppMock({
      space: makeResponse({ results: [{ id: '300', key: 'BUSY', type: 'global', status: 'current' }] }),
    });

    const summary = await runEnrollmentPipelineImpl();
    expect(summary.processed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toBe(0);
    // No new draft.
    expect(
      asAppRequest.mock.calls.find(
        ([url, init]) => (url as string) === '/wiki/api/v2/pages' && ((init as any)?.method || 'GET').toUpperCase() === 'POST',
      ),
    ).toBeUndefined();
  });

  it('returns an empty summary when there are no enrollments', async () => {
    // Default storageQuery mock returns { results: [] }.
    const summary = await runEnrollmentPipelineImpl();
    expect(summary).toMatchObject({ scanned: 0, processed: 0, errors: 0 });
    // No draft writes.
    const draftCalls = asAppRequest.mock.calls.filter(
      ([url, init]) =>
        (url as string) === '/wiki/api/v2/pages' &&
        ((init as any)?.method || 'GET').toUpperCase() === 'POST',
    );
    expect(draftCalls.length).toBe(0);
  });
});
