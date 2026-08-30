import { describe, expect, it, vi } from 'vitest';
import { PAGES_SHOWN, confluencePageResolver, relatedDiagrams } from './service';

const row = (o: Partial<Record<string, unknown>>) => ({
  contentId: '1',
  pageId: '100',
  spaceId: '7',
  contentVersion: 1,
  actorId: 'PA',
  rawLabel: 'Partner App',
  comparisonKey: 'partner.app',
  lineNumber: 2,
  indexedAt: '2026-08-27T05:00:00Z',
  ...o,
});

/** Every content live at exactly the version and page the index recorded. */
function liveAsIndexed(...rows: Array<Record<string, any>>[]) {
  return async (contentIds: string[]) => {
    const map = new Map<string, { version: number; pageId: string }>();
    for (const set of rows) {
      for (const r of set) {
        if (contentIds.includes(r.contentId)) {
          map.set(r.contentId, { version: r.contentVersion, pageId: r.pageId });
        }
      }
    }
    return map;
  };
}

function dbWith(byContent: unknown[], byKeys: unknown[]) {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          all: async () => ({ results: sql.includes('contentId = ?2') ? byContent : byKeys }),
        }),
      };
    },
  } as unknown as D1Database;
}

describe('a name used across the tenant', () => {
  it('lists the nearest five and reports the true total', async () => {
    // `user` sits on 139 pages at the pilot tenant. Hiding it hides the very thing a
    // person needs to see before giving the name a real identity; listing all 139 costs
    // 34 CQL round trips. Five rows, and the count says how general the name is.
    const wide = Array.from({ length: 40 }, (_, i) =>
      row({ contentId: `${9000 + i}`, pageId: `${9000 + i}`, actorId: 'U', comparisonKey: 'user' }),
    );
    const own = [row({ contentId: 'self', pageId: '1', actorId: 'U', comparisonKey: 'user' })];
    const resolve = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })));

    const out = await relatedDiagrams(
      dbWith(own, wide), 'cloud-1', 'self', resolve, liveAsIndexed(own, wide),
    );

    const participant = out.participants[0];
    expect(participant.related).toHaveLength(PAGES_SHOWN);
    expect(participant.relatedTotal).toBe(40);
    // newest first, and Confluence is asked about the nearest few only, never all 40
    expect(participant.related[0].pageId).toBe('9039');
    expect(resolve.mock.calls[0][0].length).toBeLessThanOrEqual(PAGES_SHOWN * 4);
  });

  it('asks Confluence for the live version of the nearest few only, never every candidate', async () => {
    // `OrderController` sits in 966 diagrams on one site. Resolving all of them costs ten
    // sequential 100-id reads (~6.4 s measured) against the viewer's 8 s budget — the same
    // ceiling the page step already respects. Budget before the version read, not after.
    const wide = Array.from({ length: 500 }, (_, i) =>
      row({ contentId: `${9000 + i}`, pageId: `${9000 + i}`, actorId: 'OC', comparisonKey: 'order.controller' }),
    );
    const own = [row({ contentId: 'self', pageId: '1', actorId: 'OC', comparisonKey: 'order.controller' })];
    const resolveContent = vi.fn(liveAsIndexed(own, wide));

    const out = await relatedDiagrams(
      dbWith(own, wide), 'cloud-1', 'self',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      resolveContent,
    );

    expect(resolveContent).toHaveBeenCalledTimes(1);
    const asked = resolveContent.mock.calls[0][0];
    expect(asked[0]).toBe('self');
    expect(asked.length).toBeLessThanOrEqual(PAGES_SHOWN * 4 + 1);
    // the slice is the nearest, so the newest content still leads the list
    expect(out.participants[0].related[0].contentId).toBe('9499');
    expect(out.participants[0].related).toHaveLength(PAGES_SHOWN);
    // the circle still counts the whole index, not the slice
    expect(out.participants[0].relatedTotal).toBe(500);
  });

  it('reports a total equal to the rows when nothing is truncated', async () => {
    const few = [
      row({ contentId: '2', pageId: '200' }),
      row({ contentId: '3', pageId: '300' }),
    ];
    const own = [row({ contentId: 'self', pageId: '1' })];
    const out = await relatedDiagrams(
      dbWith(own, few), 'cloud-1', 'self',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      liveAsIndexed(own, few),
    );
    expect(out.participants[0].related).toHaveLength(2);
    expect(out.participants[0].relatedTotal).toBe(2);
  });

  it('lists this space first, then the newest content', async () => {
    const own = [row({ contentId: 'self', pageId: '1', spaceId: 'HOME', actorId: 'PA', comparisonKey: 'partner.app' })];
    const others = [
      row({ contentId: '10', pageId: '10', spaceId: 'AWAY', actorId: 'PA' }),
      row({ contentId: '20', pageId: '20', spaceId: 'HOME', actorId: 'PA' }),
      row({ contentId: '30', pageId: '30', spaceId: 'AWAY', actorId: 'PA' }),
      row({ contentId: '40', pageId: '40', spaceId: 'HOME', actorId: 'PA' }),
    ];
    const out = await relatedDiagrams(
      dbWith(own, others), 'cloud-1', 'self',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      liveAsIndexed(own, others),
    );
    expect(out.participants[0].related.map((r) => r.pageId)).toEqual(['40', '20', '30', '10'])
  });
});

describe('relatedDiagrams', () => {
  it('returns only pages the resolver (as-user) returned, excludes self, dedupes content, and keeps the label used there', async () => {
    const db = dbWith(
      [row({}), row({ actorId: 'U', rawLabel: 'User', comparisonKey: 'user', lineNumber: 3 })],
      [
        row({}),
        row({ contentId: '2', pageId: '200', rawLabel: 'PartnerApp' }),
        row({ contentId: '2', pageId: '200', rawLabel: 'Partner App', lineNumber: 9 }),
        row({ contentId: '3', pageId: '300', rawLabel: 'partner-app' }),
        row({ contentId: '4', pageId: '400', actorId: 'U', rawLabel: 'User', comparisonKey: 'user' }),
      ],
    );
    const resolve = vi.fn(async (ids: string[]) => ids
      .filter((id) => id !== '300')
      .map((id) => ({ id, title: `Page ${id}`, spaceKey: id === '200' ? 'VPAY' : 'OP' })));

    const out = await relatedDiagrams(db, 'cid', '1', resolve, liveAsIndexed(
      [row({})],
      [row({ contentId: '2', pageId: '200' }), row({ contentId: '3', pageId: '300' }),
       row({ contentId: '4', pageId: '400' })],
    ));

    // newest content first, since every candidate here sits outside the viewer's space
    expect(resolve).toHaveBeenCalledWith(['400', '300', '200']);
    expect(out.indexedAt).toBe('2026-08-27T05:00:00Z');
    expect(out.contentVersion).toBe(1);
    expect(out.participants).toEqual([
      {
        actorId: 'PA',
        rawLabel: 'Partner App',
        relatedTotal: 2,
        related: [{
          contentId: '2',
          pageId: '200',
          pageTitle: 'Page 200',
          spaceKey: 'VPAY',
          rawLabelThere: 'PartnerApp',
        }],
      },
      {
        actorId: 'U',
        rawLabel: 'User',
        relatedTotal: 1,
        related: [{
          contentId: '4',
          pageId: '400',
          pageTitle: 'Page 400',
          spaceKey: 'OP',
          rawLabelThere: 'User',
        }],
      },
    ]);
  });

  it('unindexed diagram returns empty participants, null indexedAt, and makes no resolver call', async () => {
    const resolve = vi.fn();
    const out = await relatedDiagrams(dbWith([], []), 'cid', '9', resolve, liveAsIndexed());
    expect(out).toEqual({ indexedAt: null, contentVersion: null, participants: [] });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolver failure returns empty participants with error_kind and never throws', async () => {
    const out = await relatedDiagrams(
      dbWith([row({})], [row({ contentId: '2', pageId: '200' })]),
      'cid',
      '1',
      async () => { throw new Error('boom'); },
      liveAsIndexed([row({})], [row({ contentId: '2', pageId: '200' })]),
    );
    expect(out.participants).toEqual([]);
    expect(out.error_kind).toBe('confluence_unavailable');
  });

  it('shows nothing when this diagram has been edited since it was indexed', async () => {
    // content 128483345: indexed at version 2, live at version 56 — every row about it
    // describes text that is 54 versions old
    const out = await relatedDiagrams(
      dbWith([row({})], [row({ contentId: '2', pageId: '200' })]),
      'cid',
      '1',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      async () => new Map([['1', { version: 56, pageId: '100' }]]),
    );
    expect(out.participants).toEqual([]);
    expect(out.error_kind).toBe('stale_index');
  });

  it('drops a target edited since indexing, and opens a moved one at its page today', async () => {
    const resolve = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })));
    const out = await relatedDiagrams(
      dbWith([row({})], [
        row({ contentId: '2', pageId: '200' }),
        row({ contentId: '3', pageId: '300' }),
      ]),
      'cid',
      '1',
      resolve,
      async () => new Map([
        ['1', { version: 1, pageId: '100' }],
        // edited since the index run
        ['2', { version: 7, pageId: '200' }],
        // same version, moved to another page
        ['3', { version: 1, pageId: '999' }],
      ]),
    );
    expect(resolve).toHaveBeenCalledWith(['999']);
    expect(out.participants[0].related).toEqual([{
      contentId: '3',
      pageId: '999',
      pageTitle: 'Page 999',
      spaceKey: 'OP',
      rawLabelThere: 'Partner App',
    }]);
  });

  it('a target that no longer exists is dropped', async () => {
    const out = await relatedDiagrams(
      dbWith([row({})], [row({ contentId: '2', pageId: '200' })]),
      'cid',
      '1',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      async () => new Map([['1', { version: 1, pageId: '100' }]]),
    );
    expect(out.participants[0].related).toEqual([]);
  });
});

describe('confluencePageResolver', () => {
  it('runs one CQL id-in search per 100 ids as the user and maps title + space key', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ content: { id: '200', title: 'T200', space: { key: 'VPAY' } } }],
      }),
    })) as unknown as typeof fetch;
    const resolve = confluencePageResolver(
      'https://api.atlassian.com/ex/confluence/cid',
      'user-token',
      fetchImpl,
    );

    const pages = await resolve(Array.from({ length: 150 }, (_, i) => String(i)));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toMatch(/\/rest\/api\/search\?cql=/);
    expect(decodeURIComponent(url)).toContain('type = page AND id in (0,1,');
    expect(url).toContain('expand=content.space');
    expect(init.headers.Authorization).toBe('Bearer user-token');
    expect(pages).toEqual([
      { id: '200', title: 'T200', spaceKey: 'VPAY' },
      { id: '200', title: 'T200', spaceKey: 'VPAY' },
    ]);
  });

  it('throws for a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'no',
    })) as unknown as typeof fetch;
    await expect(confluencePageResolver('https://x', 't', fetchImpl)(['1'])).rejects.toThrow(/403/);
  });
});
