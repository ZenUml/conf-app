/**
 * Stale-index repair, end to end through the route: real migration schema in SQLite, the
 * real lookup and the real save-time index writer, and a fake Confluence that answers as
 * the viewer. Only the network is faked.
 *
 * The defect: the index row for a diagram is written only by the save-time sync. When a
 * save skips that sync (guest save answered 403, a writer that never calls it), the row
 * keeps the old version and every later lookup answers `stale_index` until the next
 * synced save.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './related';
import { __resetHealsInFlightForTests } from '../../architecture-tokens/heal';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const CLOUD = 'cloud-test';
// A different id in the URL than in the Forge context: the heal must write under the cloudId
// the lookup reads with (forgeContext), not one parsed from apiBaseUrl as the save sync does.
const API = 'https://api.atlassian.com/ex/confluence/cloud-in-url';

/** The D1 surface the lookup and the index writer use, over an in-memory SQLite. */
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(
    resolve(process.cwd(), 'functions/migrations/0021_add_architecture_token_occurrence.sql'),
    'utf8',
  ));
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...next: unknown[]) => statement(sql, next),
    all: async () => ({ results: sqlite.prepare(sql).all(...(args as any[])) }),
    first: async () => sqlite.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => sqlite.prepare(sql).run(...(args as any[])),
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      sqlite.exec('BEGIN');
      try {
        for (const s of statements) sqlite.prepare(s.sql).run(...(s.args as any[]));
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return [];
    },
  };
  const rows = (contentId: string) => sqlite
    .prepare('SELECT contentVersion, rawLabel, runId, cloudId FROM ArchitectureTokenOccurrence WHERE contentId = ? ORDER BY lineNumber')
    .all(contentId) as Array<{ contentVersion: number; rawLabel: string; runId: string; cloudId: string }>;
  const insert = (r: {
    contentId: string; pageId: string; version: number; actorId: string; rawLabel: string;
    comparisonKey: string; lineNumber: number;
  }) => sqlite.prepare(
    'INSERT INTO ArchitectureTokenOccurrence (cloudId, spaceId, contentId, pageId, contentVersion, actorId, rawLabel, comparisonKey, declKind, lineNumber, runId, indexedAt) '
    + "VALUES (?, '7', ?, ?, ?, ?, ?, ?, 'participant', ?, ?, '2026-11-01T00:00:00.000Z')",
  ).run(CLOUD, r.contentId, r.pageId, r.version, r.actorId, r.rawLabel, r.comparisonKey, r.lineNumber, `save:${r.version}`);
  return { db, rows, insert };
}

interface Doc { id: string; version: number; pageId?: string; blogPostId?: string; mermaid: string }

/** Confluence as the viewer sees it: the v2 list read, the v2 single read, and CQL search. */
function confluence(docs: Doc[], opts: { bodyStatus?: number } = {}) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const calls = { list: 0, body: 0, search: 0 };
  const fetchImpl = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/api/v2/custom-content')) {
      calls.list += 1;
      const ids = url.searchParams.getAll('id');
      return Response.json({
        results: ids.map((id) => byId.get(id)).filter(Boolean).map((d) => ({
          id: d!.id,
          ...(d!.pageId ? { pageId: d!.pageId } : { blogPostId: d!.blogPostId }),
          spaceId: '7',
          version: { number: d!.version },
        })),
      });
    }
    const single = /\/api\/v2\/custom-content\/(\d+)$/.exec(url.pathname);
    if (single) {
      calls.body += 1;
      if (opts.bodyStatus) return new Response('nope', { status: opts.bodyStatus });
      const d = byId.get(single[1])!;
      return Response.json({
        id: d.id,
        type: 'forge:zenuml-macro',
        status: 'current',
        pageId: d.pageId,
        spaceId: '7',
        version: { number: d.version },
        body: { raw: { value: JSON.stringify({ diagramType: 'mermaid', mermaidCode: d.mermaid }) } },
      });
    }
    if (url.pathname.endsWith('/rest/api/search')) {
      calls.search += 1;
      const ids = /id in \(([^)]+)\)/.exec(url.searchParams.get('cql') ?? '')?.[1]?.split(',') ?? [];
      return Response.json({
        results: ids.map((id) => ({ content: { id, title: `Page ${id}`, space: { key: 'OP' } } })),
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { fetchImpl, calls };
}

const request = (contentId: string) => ({
  request: new Request(`https://x/api/architecture-tokens/related?customContentId=${contentId}`, {
    headers: { 'x-forge-oauth-user': 'viewer-token' },
  }),
  data: { forgeContext: { cloudId: CLOUD, apiBaseUrl: API } },
});

/**
 * Diagram 11 was indexed at version 3, when it named only Partner App. It was saved since
 * without a sync, so Confluence holds version 4, which also names Billing Service. Diagram 22
 * on page 200 names Billing Service and its index row is current.
 */
function staleTenant() {
  const store = d1();
  store.insert({ contentId: '11', pageId: '100', version: 3, actorId: 'PA', rawLabel: 'Partner App', comparisonKey: 'partner.app', lineNumber: 2 });
  store.insert({ contentId: '22', pageId: '200', version: 1, actorId: 'BS', rawLabel: 'Billing Service', comparisonKey: 'billing.service', lineNumber: 2 });
  const live: Doc[] = [
    { id: '11', version: 4, pageId: '100', mermaid: 'sequenceDiagram\n  participant PA as Partner App\n  participant BS as Billing Service\n  PA->>BS: charge' },
    { id: '22', version: 1, pageId: '200', mermaid: 'sequenceDiagram\n  participant BS as Billing Service\n  BS->>BS: x' },
  ];
  return { store, live };
}

beforeEach(() => __resetHealsInFlightForTests());
afterEach(() => vi.unstubAllGlobals());

describe('related lookup on a stale index row', () => {
  it('rebuilds that diagram\'s row from the live body and answers from the fresh index', async () => {
    const { store, live } = staleTenant();
    const { fetchImpl } = confluence(live);
    vi.stubGlobal('fetch', fetchImpl);
    const waitUntil = vi.fn();

    const res = await onRequest({ ...request('11'), env: { DB: store.db as any }, waitUntil } as any);
    const body = await res.json() as any;

    expect(body.error_kind).toBeUndefined();
    expect(body.lookup_outcome).toBe('indexed');
    expect(body.contentVersion).toBe(4);
    expect(body.heal_outcome).toBe('healed');
    const billing = body.participants.find((p: any) => p.actorId === 'BS');
    expect(billing.related).toEqual([{
      contentId: '22', pageId: '200', pageTitle: 'Page 200', spaceKey: 'OP', rawLabelThere: 'Billing Service',
    }]);
    // The row now describes version 4, written by the save-time writer under a heal run id,
    // and under the cloudId the lookup reads with.
    expect(store.rows('11')).toEqual([
      { contentVersion: 4, rawLabel: 'Partner App', runId: 'heal:4', cloudId: CLOUD },
      { contentVersion: 4, rawLabel: 'Billing Service', runId: 'heal:4', cloudId: CLOUD },
    ]);
    // The write is also handed to waitUntil, so it survives a viewer who navigates away.
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('keeps today\'s answer and the old row when the body read fails', async () => {
    const { store, live } = staleTenant();
    vi.stubGlobal('fetch', confluence(live, { bodyStatus: 404 }).fetchImpl);

    const res = await onRequest({ ...request('11'), env: { DB: store.db as any }, waitUntil: vi.fn() } as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      participants: [], error_kind: 'stale_index', contentVersion: 3,
      stale_reason: 'version_mismatch', live_version: 4, heal_outcome: 'content_fetch_failed',
    });
    expect(store.rows('11').map((r) => r.contentVersion)).toEqual([3]);
  });

  it('keeps today\'s answer when the index write fails', async () => {
    const { store, live } = staleTenant();
    vi.stubGlobal('fetch', confluence(live).fetchImpl);
    const db = { ...store.db, batch: async () => { throw new Error('d1 write refused'); } };

    const res = await onRequest({ ...request('11'), env: { DB: db as any }, waitUntil: vi.fn() } as any);
    const body = await res.json() as any;

    expect(body).toMatchObject({ error_kind: 'stale_index', heal_outcome: 'write_failed' });
    expect(store.rows('11').map((r) => r.contentVersion)).toEqual([3]);
  });

  it('does not rebuild a diagram that is missing from the live read, and says which case it is', async () => {
    const { store, live } = staleTenant();
    const { fetchImpl, calls } = confluence(live.filter((d) => d.id !== '11'));
    vi.stubGlobal('fetch', fetchImpl);

    const body = await (await onRequest({ ...request('11'), env: { DB: store.db as any }, waitUntil: vi.fn() } as any)).json() as any;

    expect(body).toMatchObject({ error_kind: 'stale_index', stale_reason: 'not_in_live_read' });
    expect(body.heal_outcome).toBeUndefined();
    expect(calls.body).toBe(0);
    expect(store.rows('11').map((r) => r.contentVersion)).toEqual([3]);
  });

  it('reports a diagram that came back without a page container as its own case', async () => {
    // A diagram on a blog post carries blogPostId, not pageId. The live read drops it, so a
    // version rebuild could never fix it.
    const { store, live } = staleTenant();
    const onBlog = live.map((d) => (d.id === '11' ? { ...d, version: 3, pageId: undefined, blogPostId: '555' } : d));
    const { fetchImpl, calls } = confluence(onBlog);
    vi.stubGlobal('fetch', fetchImpl);

    const body = await (await onRequest({ ...request('11'), env: { DB: store.db as any }, waitUntil: vi.fn() } as any)).json() as any;

    expect(body).toMatchObject({ error_kind: 'stale_index', stale_reason: 'no_page_container' });
    expect(calls.body).toBe(0);
  });

  it('lets concurrent viewers of one stale diagram share one rebuild', async () => {
    const { store, live } = staleTenant();
    const { fetchImpl, calls } = confluence(live);
    vi.stubGlobal('fetch', fetchImpl);
    const env = { DB: store.db as any };

    const answers = await Promise.all([1, 2, 3, 4, 5].map(async () =>
      (await onRequest({ ...request('11'), env, waitUntil: vi.fn() } as any)).json() as Promise<any>));

    expect(calls.body).toBe(1);
    for (const body of answers) {
      expect(body.error_kind).toBeUndefined();
      expect(body.contentVersion).toBe(4);
    }
  });

  it('rebuilds at most once per request when the fresh row is still behind', async () => {
    // Confluence moves on between the list read and the body read: the body is version 4,
    // the second list read says 5. The second pass must answer, not rebuild again.
    const { store, live } = staleTenant();
    let listReads = 0;
    const base = confluence(live).fetchImpl;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/api/v2/custom-content') && ++listReads >= 2) {
        const res = await base(input, init);
        const json = await res.json() as any;
        for (const r of json.results) if (r.id === '11') r.version = { number: 5 };
        return Response.json(json);
      }
      return base(input, init);
    }));

    const body = await (await onRequest({ ...request('11'), env: { DB: store.db as any }, waitUntil: vi.fn() } as any)).json() as any;

    expect(body).toMatchObject({ error_kind: 'stale_index', stale_reason: 'version_mismatch', live_version: 5 });
    expect(listReads).toBe(2);
    expect(store.rows('11').map((r) => r.contentVersion)).toEqual([4, 4]);
  });
});
