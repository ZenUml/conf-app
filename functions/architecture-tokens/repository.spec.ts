import { describe, expect, it } from 'vitest';
import { occurrencesForContent, occurrencesForKeys } from './repository';

function fakeDb(rows: unknown[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          calls.push({ sql, binds });
          return { all: async () => ({ results: rows }) };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe('repository', () => {
  it('occurrencesForContent scopes by cloudId and contentId', async () => {
    const { db, calls } = fakeDb([{ contentId: '10' }]);
    await occurrencesForContent(db, 'cid', '10');
    expect(calls[0].sql).toMatch(/WHERE cloudId = \?1 AND contentId = \?2/);
    expect(calls[0].binds).toEqual(['cid', '10']);
  });

  it('occurrencesForKeys binds every key and scopes by cloudId', async () => {
    const { db, calls } = fakeDb([]);
    await occurrencesForKeys(db, 'cid', ['a.b', 'c']);
    expect(calls[0].sql).toMatch(/comparisonKey IN \(\?2, \?3\)/);
    expect(calls[0].binds).toEqual(['cid', 'a.b', 'c']);
  });

  it('occurrencesForKeys with no keys makes no query', async () => {
    const { db, calls } = fakeDb([]);
    expect(await occurrencesForKeys(db, 'cid', [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
