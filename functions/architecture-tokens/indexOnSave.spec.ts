import { describe, expect, it, vi } from 'vitest';
import { preferComparisonKey, buildOccurrenceRows, indexDiagramOnSave } from './indexOnSave';

describe('preferComparisonKey', () => {
  // extract-corpus.mjs preferredDottedKeys: more segments wins, then localeCompare.
  it('adopts an existing tenant form that is more segmented', () => {
    expect(preferComparisonKey('miniappcli', ['mini.app.cli'])).toBe('mini.app.cli');
  });

  it('keeps the local key when it is more segmented than what the tenant holds', () => {
    expect(preferComparisonKey('mini.app.cli', ['miniappcli'])).toBe('mini.app.cli');
  });

  it('breaks an equal-segment tie by localeCompare, matching the batch pipeline', () => {
    // Same grouping token ('abc'), same segment count: localeCompare decides.
    expect(preferComparisonKey('ab.c', ['a.bc'])).toBe('a.bc');
    expect(preferComparisonKey('a.bc', ['ab.c'])).toBe('a.bc');
  });

  it('ignores stored keys whose grouping token differs', () => {
    expect(preferComparisonKey('partner.app', ['other.thing'])).toBe('partner.app');
  });
});

describe('buildOccurrenceRows', () => {
  const base = {
    cloudId: 'cloud-1', contentId: 'c-1', spaceId: 's-1', pageId: 'p-1',
    contentVersion: 7, runId: 'save:7', indexedAt: '2026-09-02T00:00:00.000Z',
  };

  it('extracts explicit mermaid participants at the saved version', () => {
    const rows = buildOccurrenceRows({
      ...base,
      diagramType: 'mermaid',
      code: 'sequenceDiagram\n  participant PA as Partner App\n  PA->>PA: x',
      preferred: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cloudId: 'cloud-1', contentId: 'c-1', actorId: 'PA',
      rawLabel: 'Partner App', comparisonKey: 'partner.app',
      declKind: 'participant', contentVersion: 7,
    });
  });

  it('returns no rows when the diagram is not a sequence diagram', () => {
    const rows = buildOccurrenceRows({
      ...base, diagramType: 'mermaid', code: 'graph TD\n A-->B', preferred: new Map(),
    });
    expect(rows).toEqual([]);
  });

  it('applies the tenant preferred comparison key', () => {
    const rows = buildOccurrenceRows({
      ...base,
      diagramType: 'mermaid',
      code: 'sequenceDiagram\n  participant M as miniappcli\n  M->>M: x',
      preferred: new Map([['miniappcli', 'mini.app.cli']]),
    });
    expect(rows[0].comparisonKey).toBe('mini.app.cli');
  });
});

function fakeDb(selectRows: any[] = []) {
  const batched: any[] = [];
  const db: any = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        all: async () => ({ results: selectRows }),
        raw: () => ({ sql, args }),
      }),
    }),
    batch: async (stmts: any[]) => { batched.push(...stmts); return []; },
    _batched: batched,
  };
  return db;
}

describe('indexDiagramOnSave', () => {
  const content = {
    id: 'c-1', spaceId: 's-1', pageId: 'p-1',
    version: { number: 7 },
    body: { raw: { value: JSON.stringify({ diagramType: 'mermaid',
      mermaidCode: 'sequenceDiagram\n  participant PA as Partner App\n  PA->>PA: x' }) } },
  };

  it('writes a delete plus inserts for the saved diagram', async () => {
    const db = fakeDb();
    const result = await indexDiagramOnSave(db, 'cloud-1', content);
    expect(result).toMatchObject({ indexed: true, rows: 1 });
    expect(db._batched.length).toBeGreaterThanOrEqual(2);
  });

  it('still deletes when the diagram is no longer a sequence diagram', async () => {
    const db = fakeDb();
    const result = await indexDiagramOnSave(db, 'cloud-1', {
      ...content,
      body: { raw: { value: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'graph TD\n A-->B' }) } },
    });
    expect(result).toMatchObject({ indexed: true, rows: 0 });
    expect(db._batched).toHaveLength(1);
  });

  it('skips without a cloudId, because the primary key requires one', async () => {
    const db = fakeDb();
    const result = await indexDiagramOnSave(db, null, content);
    expect(result).toMatchObject({ indexed: false, reason: 'no_cloud_id' });
    expect(db._batched).toHaveLength(0);
  });

  it('reports a D1 failure instead of throwing, so the save is not affected', async () => {
    const db = fakeDb();
    db.batch = vi.fn().mockRejectedValue(new Error('D1 down'));
    const result = await indexDiagramOnSave(db, 'cloud-1', content);
    expect(result).toMatchObject({ indexed: false, reason: 'write_failed' });
  });
});
