import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetHealsInFlightForTests, staleIndexHealer } from './heal';

/** D1 stub: the re-check SELECT answers `indexedVersion`; writes are recorded. */
function db(indexedVersion: number | undefined) {
  const batches: unknown[][] = [];
  return {
    batches,
    prepare: () => ({
      bind: () => ({
        all: async () => ({
          results: indexedVersion === undefined ? [] : [{ contentId: '11', contentVersion: indexedVersion }],
        }),
      }),
    }),
    batch: async (statements: unknown[]) => { batches.push(statements); return []; },
  };
}

const doc = (version: number) => ({
  id: '11',
  pageId: '100',
  spaceId: '7',
  version: { number: version },
  body: { raw: { value: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n  participant A as Alpha' }) } },
});

beforeEach(() => __resetHealsInFlightForTests());

describe('staleIndexHealer', () => {
  it('never moves rows backwards when the index already holds a newer version', async () => {
    const store = db(9);
    const fetchContent = vi.fn();
    const heal = staleIndexHealer({
      db: store as any, cloudId: 'c', apiBaseUrl: 'https://a', userToken: 't', fetchContent,
    });

    expect(await heal('11', 4)).toBe('index_newer');
    expect(fetchContent).not.toHaveBeenCalled();
    expect(store.batches).toHaveLength(0);
  });

  it('answers heal_pending after the budget and still finishes the write under waitUntil', async () => {
    const store = db(3);
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const fetchContent = vi.fn(async () => { await gate; return doc(4); });
    const background: Promise<unknown>[] = [];
    const heal = staleIndexHealer({
      db: store as any, cloudId: 'c', apiBaseUrl: 'https://a', userToken: 't', fetchContent,
      waitUntil: (p) => background.push(p), budgetMs: 5,
    });

    expect(await heal('11', 4)).toBe('heal_pending');
    expect(store.batches).toHaveLength(0);

    release();
    expect(await background[0]).toBe('healed');
    expect(store.batches).toHaveLength(1);
  });

  it('reports a body that is not this diagram as a failed read and writes nothing', async () => {
    const store = db(3);
    const heal = staleIndexHealer({
      db: store as any, cloudId: 'c', apiBaseUrl: 'https://a', userToken: 't',
      fetchContent: vi.fn(async () => ({ ...doc(4), id: '12' })),
    });

    expect(await heal('11', 4)).toBe('content_fetch_failed');
    expect(store.batches).toHaveLength(0);
  });
});
