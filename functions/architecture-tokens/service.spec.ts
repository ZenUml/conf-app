import { describe, expect, it, vi } from 'vitest';
import {
  PAGES_SHOWN,
  confluenceContentResolver,
  confluencePageResolver,
  relatedDiagrams,
} from './service';

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
    // Newest first; the permission filter sees the bounded candidate set before five pages
    // are selected, so denied nearer pages can be backfilled.
    expect(participant.related[0].pageId).toBe('9039');
    expect(resolve.mock.calls[0][0]).toHaveLength(40);
  });

  it('bounds a high-cardinality live-version read without changing the full index total', async () => {
    // The Owner Topic requires backfill after the correctness filters and caps the read at
    // self + 300 live-version ids. The five-page display slice is deliberately later.
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
    expect(asked).toHaveLength(301);
    // the slice is the nearest, so the newest content still leads the list
    expect(out.participants[0].related[0].contentId).toBe('9499');
    expect(out.participants[0].related).toHaveLength(PAGES_SHOWN);
    // the circle still counts the whole index, not the slice
    expect(out.participants[0].relatedTotal).toBe(500);
  });

  it('uses four live-version reads and three permission reads for 966 candidates', async () => {
    const wide = Array.from({ length: 966 }, (_, i) => row({
      contentId: `${i + 1}`,
      pageId: `${10_001 + i}`,
      actorId: 'OC',
      comparisonKey: 'order.controller',
    }));
    const own = [row({
      contentId: '999999',
      pageId: '42',
      actorId: 'OC',
      comparisonKey: 'order.controller',
    })];
    const contentFetch = vi.fn(async (input: RequestInfo | URL) => {
      const ids = new URL(String(input)).searchParams.getAll('id');
      return {
        ok: true,
        json: async () => ({
          results: ids.map((id) => ({
            id,
            pageId: id === '999999' ? '42' : `${10_000 + Number(id)}`,
            version: { number: 1 },
          })),
        }),
      };
    }) as unknown as typeof fetch;
    const pageFetch = vi.fn(async (input: RequestInfo | URL) => {
      const cql = new URL(String(input)).searchParams.get('cql') ?? '';
      const ids = /id in \(([^)]+)\)/.exec(cql)?.[1]?.split(',') ?? [];
      return {
        ok: true,
        json: async () => ({
          results: ids.map((id) => ({
            content: { id, title: `Page ${id}`, space: { key: 'OP' } },
          })),
        }),
      };
    }) as unknown as typeof fetch;

    const out = await relatedDiagrams(
      dbWith(own, wide),
      'cloud-1',
      '999999',
      confluencePageResolver('https://api.atlassian.test', 'token', pageFetch),
      confluenceContentResolver('https://api.atlassian.test', 'token', contentFetch),
    );

    expect(contentFetch).toHaveBeenCalledTimes(4);
    expect(contentFetch.mock.calls.map(([input]) => new URL(String(input)).searchParams.getAll('id').length))
      .toEqual([100, 100, 100, 1]);
    expect(pageFetch).toHaveBeenCalledTimes(3);
    expect(pageFetch.mock.calls.map(([input]) => {
      const cql = new URL(String(input)).searchParams.get('cql') ?? '';
      return /id in \(([^)]+)\)/.exec(cql)?.[1]?.split(',').length ?? 0;
    })).toEqual([100, 100, 100]);
    expect(out.participants[0].related.map((candidate) => candidate.contentId))
      .toEqual(['966', '965', '964', '963', '962']);
    expect(out.participants[0].relatedTotal).toBe(966);
  });

  it('backfills past stale, deleted, and version-mismatched candidates', async () => {
    const wide = Array.from({ length: 25 }, (_, i) =>
      row({ contentId: `${1000 + i}`, pageId: `${2000 + i}` }),
    );
    const own = [row({ contentId: 'self', pageId: '1' })];
    const resolveContent = vi.fn(async (contentIds: string[]) => {
      const live = new Map<string, { version: number; pageId: string }>([
        ['self', { version: 1, pageId: '1' }],
      ]);
      for (const candidate of wide) {
        if (!contentIds.includes(candidate.contentId)) continue;
        const id = Number(candidate.contentId);
        if (id >= 1015) {
          live.set(candidate.contentId, { version: 2, pageId: candidate.pageId });
        } else if (id < 1005) {
          live.set(candidate.contentId, { version: 1, pageId: candidate.pageId });
        }
        // 1005..1014 are absent: Confluence no longer returns those contents.
      }
      return live;
    });

    const out = await relatedDiagrams(
      dbWith(own, wide), 'cloud-1', 'self',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      resolveContent,
    );

    expect(out.participants[0].related.map((candidate) => candidate.contentId))
      .toEqual(['1004', '1003', '1002', '1001', '1000']);
  });

  it('backfills past permission-denied pages before taking the nearest five', async () => {
    const wide = Array.from({ length: 25 }, (_, i) =>
      row({ contentId: `${1000 + i}`, pageId: `${2000 + i}` }),
    );
    const own = [row({ contentId: 'self', pageId: '1' })];
    const resolve = vi.fn(async (ids: string[]) => ids
      .filter((id) => Number(id) < 2005)
      .map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })));

    const out = await relatedDiagrams(
      dbWith(own, wide), 'cloud-1', 'self', resolve, liveAsIndexed(own, wide),
    );

    expect(out.participants[0].related.map((candidate) => candidate.contentId))
      .toEqual(['1004', '1003', '1002', '1001', '1000']);
  });

  it('counts and lists pages rather than letting duplicate pageIds consume the five-page slice', async () => {
    const own = [row({ contentId: 'self', pageId: '1' })];
    const wide = [
      row({ contentId: '99', pageId: '900' }),
      row({ contentId: '98', pageId: '900' }),
      row({ contentId: '97', pageId: '800' }),
      row({ contentId: '96', pageId: '700' }),
      row({ contentId: '95', pageId: '600' }),
      row({ contentId: '94', pageId: '500' }),
    ];

    const out = await relatedDiagrams(
      dbWith(own, wide), 'cloud-1', 'self',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      liveAsIndexed(own, wide),
    );

    expect(out.participants[0].relatedTotal).toBe(5);
    expect(new Set(out.participants[0].related.map((candidate) => candidate.pageId))).toHaveLength(5);
    expect(out.participants[0].related.map((candidate) => candidate.contentId))
      .toEqual(['99', '98', '97', '96', '95', '94']);
  });

  it('covers distinct pages across fifteen keys before spending the 300-id budget on duplicate pages', async () => {
    const own = Array.from({ length: 15 }, (_, key) => row({
      contentId: 'self',
      pageId: '1',
      actorId: `A${key}`,
      comparisonKey: `key.${key}`,
    }));
    const wide = own.flatMap((occurrence, key) => [
      ...Array.from({ length: 20 }, (_, i) => row({
        contentId: `${key * 10_000 + i + 100}`,
        pageId: `${key * 10_000 + 900}`,
        actorId: occurrence.actorId,
        comparisonKey: occurrence.comparisonKey,
      })),
      ...Array.from({ length: 5 }, (_, i) => row({
        contentId: `${key * 10_000 + i + 1}`,
        pageId: `${key * 10_000 + i + 901}`,
        actorId: occurrence.actorId,
        comparisonKey: occurrence.comparisonKey,
      })),
    ]);
    const resolveContent = vi.fn(liveAsIndexed(own, wide));

    const out = await relatedDiagrams(
      dbWith(own, wide), 'cloud-1', 'self',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      resolveContent,
    );

    const asked = resolveContent.mock.calls[0][0];
    expect(asked[0]).toBe('self');
    expect(asked).toHaveLength(301);
    expect(new Set(asked)).toHaveLength(301);
    for (let key = 0; key < 15; key += 1) {
      expect(asked.filter((id: string) => Number(id) > key * 10_000 && Number(id) < (key + 1) * 10_000))
        .toHaveLength(20);
      const participant = out.participants.find((candidate) => candidate.actorId === `A${key}`)!;
      expect(new Set(participant.related.map((candidate) => candidate.pageId))).toHaveLength(5);
      expect(participant.relatedTotal).toBe(6);
    }
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

  it('re-ranks a content moved onto the current page before taking five pages', async () => {
    const own = [row({ contentId: 'self', pageId: '1', spaceId: 'HOME' })];
    const others = [
      row({ contentId: '60', pageId: '60', spaceId: 'HOME' }),
      row({ contentId: '59', pageId: '59', spaceId: 'HOME' }),
      row({ contentId: '58', pageId: '58', spaceId: 'HOME' }),
      row({ contentId: '57', pageId: '57', spaceId: 'HOME' }),
      row({ contentId: '56', pageId: '56', spaceId: 'HOME' }),
      row({ contentId: '50', pageId: '500', spaceId: 'AWAY' }),
    ];
    const out = await relatedDiagrams(
      dbWith(own, others),
      'cloud-1',
      'self',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      async () => new Map([
        ['self', { version: 1, pageId: '1' }],
        ...others.map((candidate) => [
          candidate.contentId,
          { version: 1, pageId: candidate.contentId === '50' ? '1' : candidate.pageId },
        ] as const),
      ]),
      '1',
    );

    expect(out.participants[0].related.map((candidate) => candidate.contentId))
      .toEqual(['50', '60', '59', '58', '57']);
  });

  it('re-ranks by the live custom-content space before taking five pages', async () => {
    const own = [row({ contentId: 'self', pageId: '1', spaceId: 'INDEX-HOME' })];
    const others = [
      row({ contentId: '60', pageId: '60', spaceId: 'INDEX-HOME' }),
      row({ contentId: '59', pageId: '59', spaceId: 'INDEX-HOME' }),
      row({ contentId: '58', pageId: '58', spaceId: 'INDEX-HOME' }),
      row({ contentId: '57', pageId: '57', spaceId: 'INDEX-HOME' }),
      row({ contentId: '56', pageId: '56', spaceId: 'INDEX-HOME' }),
      row({ contentId: '50', pageId: '50', spaceId: 'INDEX-AWAY' }),
    ];
    const out = await relatedDiagrams(
      dbWith(own, others),
      'cloud-1',
      'self',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      async () => new Map([
        ['self', { version: 1, pageId: '1', spaceId: 'LIVE-HOME' }],
        ...others.map((candidate) => [
          candidate.contentId,
          {
            version: 1,
            pageId: candidate.pageId,
            spaceId: candidate.contentId === '50' ? 'LIVE-HOME' : 'LIVE-AWAY',
          },
        ] as const),
      ]),
      '1',
    );

    expect(out.participants[0].related.map((candidate) => candidate.contentId))
      .toEqual(['50', '60', '59', '58', '57']);
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
    expect(out.lookup_outcome).toBe('indexed');
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
    expect(out).toEqual({
      lookup_outcome: 'index_miss',
      indexedAt: null,
      contentVersion: null,
      participants: [],
    });
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
