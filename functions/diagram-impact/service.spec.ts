import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DiagramImpactRequestError,
  getDiagramImpactSummary,
  registerDiagramImpactView,
} from './service';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeDb(input: { historical?: boolean; count?: number; existing?: { lastViewedAt: string } | null } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          first: async () => {
            if (sql.includes('CustomContentVersion')) return input.historical ? { found: 1 } : null;
            if (sql.includes('COUNT(*)')) return { audienceCount: input.count ?? 7 };
            return input.existing ?? null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        }),
      };
    },
  } as unknown as D1Database;
}

// Same shape as fakeDb (eligible-viewer, no existing row -> INSERT path), but
// captures the bind() args of every INSERT so what the repository actually
// receives can be asserted at that boundary.
function fakeDbCapturingInserts(input: { count?: number } = {}) {
  const inserts: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind: (...binds: unknown[]) => ({
          first: async () => {
            if (sql.includes('CustomContentVersion')) return null;
            if (sql.includes('COUNT(*)')) return { audienceCount: input.count ?? 7 };
            return null;
          },
          run: async () => {
            if (sql.includes('INSERT')) inserts.push(binds);
            return { meta: { changes: 1 } };
          },
        }),
      };
    },
  } as unknown as D1Database;
  return { db, inserts };
}

const data = {
  forgeContext: {
    cloudId: 'cloud-a',
    forgeAppId: 'app-a',
    accountId: 'viewer-a',
    apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-a',
  },
};

const content = {
  id: 'content-a',
  authorId: 'creator-a',
  version: { authorId: 'updater-a' },
};

afterEach(() => vi.unstubAllGlobals());

describe('diagram impact service', () => {
  it('authorizes content access before returning a scoped summary', async () => {
    const fetchSpy = vi.fn(async () => response(content));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(getDiagramImpactSummary({
      env: { DB: fakeDb() },
      data,
      forgeOAuthUser: 'opaque-user-token',
      customContentId: 'content-a',
    })).resolves.toEqual({ audienceCount: 7, viewerRelation: 'viewer' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/confluence/cloud-a/api/v2/custom-content/content-a?body-format=raw',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer opaque-user-token' }) }),
    );
  });

  it('does not query D1 when Confluence denies the content read', async () => {
    const db = fakeDb();
    const prepare = vi.spyOn(db, 'prepare');
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'forbidden' }, 403)));

    await expect(getDiagramImpactSummary({
      env: { DB: db }, data, forgeOAuthUser: 'token', customContentId: 'content-a',
    })).rejects.toMatchObject<Partial<DiagramImpactRequestError>>({ status: 403, code: 'content_unavailable' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('uses Confluence author fields to exclude contributors from registration', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...content, authorId: 'viewer-a' })));

    await expect(registerDiagramImpactView({
      env: { DB: fakeDb({ count: 9 }) },
      data,
      forgeOAuthUser: 'token',
      customContentId: 'content-a',
      now: new Date('2026-08-12T12:00:00.000Z'),
    })).resolves.toEqual({ result: 'excluded_contributor', audienceCount: 9 });
  });

  it('stores an eligible viewer without an audience secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(content)));

    await expect(registerDiagramImpactView({
      env: { DB: fakeDb() }, data, forgeOAuthUser: 'token', customContentId: 'content-a', now: new Date(),
    })).resolves.toEqual({ result: 'new_unique', audienceCount: 7 });
  });

  it('rejects missing or malformed identity and content inputs', async () => {
    await expect(getDiagramImpactSummary({
      env: { DB: fakeDb() }, data: { forgeContext: { ...data.forgeContext, accountId: undefined } }, forgeOAuthUser: 'token', customContentId: 'content-a',
    })).rejects.toMatchObject<Partial<DiagramImpactRequestError>>({ status: 401, code: 'missing_principal' });

    await expect(getDiagramImpactSummary({
      env: { DB: fakeDb() }, data, forgeOAuthUser: '', customContentId: 'content-a',
    })).rejects.toMatchObject<Partial<DiagramImpactRequestError>>({ status: 400, code: 'missing_user_token' });

    await expect(getDiagramImpactSummary({
      env: { DB: fakeDb() }, data, forgeOAuthUser: 'token', customContentId: ' ',
    })).rejects.toMatchObject<Partial<DiagramImpactRequestError>>({ status: 400, code: 'invalid_content_id' });
  });

  // A derived write must not turn a page view into a 500. The failure goes to
  // Sentry and the response still carries the count that could be read.
  it('answers with write_failed and the readable count when the audience row cannot be written', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('CustomContentVersion')) return null;
            if (sql.includes('COUNT(*)')) return { audienceCount: 7 };
            return null;
          },
          run: async () => {
            if (sql.includes('INSERT')) throw new Error('D1_ERROR: database is locked');
            return { meta: { changes: 0 } };
          },
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    vi.stubGlobal('fetch', vi.fn(async () => response(content)));

    const result = await registerDiagramImpactView({
      env: { DB: db },
      data,
      forgeOAuthUser: 'opaque-user-token',
      customContentId: 'content-a',
    });

    expect(result.result).toBe('write_failed');
    expect(result.audienceCount).toBe(7);
  });
})
