import { describe, expect, it, vi } from 'vitest';
import { PAGES_PER_KEY, confluencePageResolver, relatedDiagrams } from './service';

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

describe('page budget', () => {
  it('asks Confluence for one batch only, spread across keys, when a name recurs tenant-wide', async () => {
    // `order.controller` reaches 3,388 pages on lite-stg; without a cap that is 34 CQL
    // round trips, the 8s viewer budget expires and the reader sees nothing at all.
    const wide = Array.from({ length: 3000 }, (_, i) =>
      row({ contentId: `w${i}`, pageId: `${9000 + i}`, actorId: 'OC', comparisonKey: 'order.controller' }),
    );
    const narrow = Array.from({ length: 5 }, (_, i) =>
      row({ contentId: `n${i}`, pageId: `${100 + i}`, actorId: 'INV', comparisonKey: 'invoice.service' }),
    );
    const own = [
      row({ contentId: 'self', pageId: '1', actorId: 'OC', comparisonKey: 'order.controller' }),
      row({ contentId: 'self', pageId: '1', actorId: 'INV', comparisonKey: 'invoice.service' }),
    ];
    const resolve = vi.fn(async (pageIds: string[]) =>
      pageIds.map((id) => ({ id, title: `page ${id}`, spaceKey: 'OP' })),
    );

    const response = await relatedDiagrams(
      dbWith(own, [...wide, ...narrow]),
      'cloud-1',
      'self',
      resolve,
    );

    const asked = resolve.mock.calls[0][0];
    expect(asked.length).toBeLessThanOrEqual(100);
    // the common key cannot crowd out the rarer one
    expect(asked.filter((id) => Number(id) >= 9000)).toHaveLength(PAGES_PER_KEY);
    expect(asked.filter((id) => Number(id) < 9000)).toHaveLength(5);
    const oc = response.participants.find((p) => p.actorId === 'OC')!;
    expect(oc.related).toHaveLength(PAGES_PER_KEY);
    expect(response.participants.find((p) => p.actorId === 'INV')!.related).toHaveLength(5);
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

    const out = await relatedDiagrams(db, 'cid', '1', resolve);

    expect(resolve).toHaveBeenCalledWith(['200', '300', '400']);
    expect(out.indexedAt).toBe('2026-08-27T05:00:00Z');
    expect(out.contentVersion).toBe(1);
    expect(out.participants).toEqual([
      {
        actorId: 'PA',
        rawLabel: 'Partner App',
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
    const out = await relatedDiagrams(dbWith([], []), 'cid', '9', resolve);
    expect(out).toEqual({ indexedAt: null, contentVersion: null, participants: [] });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolver failure returns empty participants with error_kind and never throws', async () => {
    const out = await relatedDiagrams(
      dbWith([row({})], [row({ contentId: '2', pageId: '200' })]),
      'cid',
      '1',
      async () => { throw new Error('boom'); },
    );
    expect(out.participants).toEqual([]);
    expect(out.error_kind).toBe('confluence_unavailable');
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
