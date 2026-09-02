import { describe, expect, it } from 'vitest';
import {
  countAudience,
  isHistoricalContributor,
  registerAudienceView,
  type DiagramAudienceScope,
} from './repository';

type Call = { sql: string; binds: unknown[]; operation: 'first' | 'run' };

function fakeDb(input: {
  existing?: { lastViewedAt: string } | null;
  insertChanges?: number;
  updateChanges?: number;
  count?: number;
  historicalContributor?: boolean;
}) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            first: async () => {
              calls.push({ sql, binds, operation: 'first' });
              if (sql.includes('COUNT(*)')) return { audienceCount: input.count ?? 0 };
              if (sql.includes('CustomContentVersion')) return input.historicalContributor ? { found: 1 } : null;
              return input.existing ?? null;
            },
            run: async () => {
              calls.push({ sql, binds, operation: 'run' });
              return {
                meta: {
                  changes: sql.includes('INSERT') ? (input.insertChanges ?? 1) : (input.updateChanges ?? 1),
                },
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

const scope: DiagramAudienceScope = {
  cloudId: 'cloud-a',
  forgeAppId: 'app-a',
  customContentId: 'content-a',
};

describe('diagram audience repository', () => {
  it('counts only rows in the verified tenant, app, and content scope', async () => {
    const { db, calls } = fakeDb({ count: 23 });

    await expect(countAudience(db, scope)).resolves.toBe(23);

    expect(calls).toEqual([expect.objectContaining({
      operation: 'first',
      sql: expect.stringContaining('cloudId = ?1 AND forgeAppId = ?2 AND customContentId = ?3'),
      binds: ['cloud-a', 'app-a', 'content-a'],
    })]);
  });

  it('checks contributor history in the same app and content scope', async () => {
    const { db, calls } = fakeDb({ historicalContributor: true });

    await expect(isHistoricalContributor(db, { ...scope, accountId: 'person-a' })).resolves.toBe(true);

    expect(calls[0]).toMatchObject({
      operation: 'first',
      sql: expect.stringContaining('contentId = ?1 AND appId = ?2 AND authorId = ?3'),
      binds: ['content-a', 'app-a', 'person-a'],
    });
  });

  it('inserts the first qualifying view, binding gateVersion as the final column', async () => {
    const { db, calls } = fakeDb({ existing: null, insertChanges: 1 });

    await expect(registerAudienceView(db, {
      ...scope,
      accountId: 'person-a',
      now: new Date('2026-08-12T12:00:00.000Z'),
      gateVersion: 2,
    })).resolves.toBe('new_unique');

    expect(calls.map((call) => call.operation)).toEqual(['first', 'run']);
    expect(calls[1]).toMatchObject({
      sql: expect.stringContaining('accountId, firstViewedAt, lastViewedAt, viewDays, gateVersion'),
      binds: ['cloud-a', 'app-a', 'content-a', 'person-a', '2026-08-12T12:00:00.000Z', '2026-08-12T12:00:00.000Z', 2],
    });
  });

  it('treats a concurrent insert loser as a repeat', async () => {
    const { db } = fakeDb({ existing: null, insertChanges: 0 });

    await expect(registerAudienceView(db, {
      ...scope,
      accountId: 'person-a',
      now: new Date('2026-08-12T12:00:00.000Z'),
      gateVersion: 1,
    })).resolves.toBe('repeat');
  });

  it('does not write a same-UTC-day repeat', async () => {
    const { db, calls } = fakeDb({ existing: { lastViewedAt: '2026-08-12T00:01:00.000Z' } });

    await expect(registerAudienceView(db, {
      ...scope,
      accountId: 'person-a',
      now: new Date('2026-08-12T23:59:59.000Z'),
      gateVersion: 1,
    })).resolves.toBe('repeat');

    expect(calls.map((call) => call.operation)).toEqual(['first']);
  });

  it('updates a repeat on a later UTC day exactly once, and never rewrites the row\'s original gateVersion', async () => {
    const { db, calls } = fakeDb({ existing: { lastViewedAt: '2026-08-12T23:59:59.000Z' }, updateChanges: 1 });

    // gateVersion 2 here documents that even a request tagged with the newer
    // rule must not relabel a row an earlier rule created — the row's
    // gateVersion is stamped once, on INSERT, and never touched again.
    await expect(registerAudienceView(db, {
      ...scope,
      accountId: 'person-a',
      now: new Date('2026-08-13T00:00:00.000Z'),
      gateVersion: 2,
    })).resolves.toBe('repeat');

    expect(calls.map((call) => call.operation)).toEqual(['first', 'run']);
    expect(calls[1]).toMatchObject({
      sql: expect.stringContaining('lastViewedAt < ?6'),
      binds: [
        '2026-08-13T00:00:00.000Z',
        'cloud-a', 'app-a', 'content-a', 'person-a', '2026-08-13T00:00:00.000Z',
      ],
    });
    expect(calls[1].sql).not.toMatch(/gateVersion/);
    expect(calls[1].binds).not.toContain(2);
  });
});
