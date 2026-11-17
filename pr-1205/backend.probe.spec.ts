// BEFORE/AFTER probe: the same three stale inputs through relatedDiagrams and the content
// resolver, once with the service file from the base branch and once with the candidate's.
// Fixtures are fictional: diagram 1 indexed at version 3.
import { it } from 'vitest';
import * as before from './service.base';
import * as after from './service';

const row = (o: Record<string, unknown>) => ({
  contentId: '1', pageId: '100', spaceId: '7', contentVersion: 3, actorId: 'PA',
  rawLabel: 'Partner App', comparisonKey: 'partner.app', lineNumber: 2,
  indexedAt: '2026-08-27T05:00:00Z', ...o,
});
const db = () => ({
  prepare: (sql: string) => ({
    bind: () => ({
      all: async () => ({
        results: sql.includes('contentId = ?2')
          ? [row({})]
          : [row({ contentId: '2', pageId: '200', contentVersion: 1 })],
      }),
    }),
  }),
}) as unknown as D1Database;

// What Confluence's GET /api/v2/custom-content answers in each case.
const cases: Record<string, unknown[]> = {
  'live read returns diagram 1 at version 4': [
    { id: '1', pageId: '100', spaceId: '7', version: { number: 4 } },
    { id: '2', pageId: '200', spaceId: '7', version: { number: 1 } },
  ],
  'live read does not return diagram 1': [
    { id: '2', pageId: '200', spaceId: '7', version: { number: 1 } },
  ],
  'live read returns diagram 1 at version 3 without pageId': [
    { id: '1', spaceId: '7', version: { number: 3 } },
    { id: '2', pageId: '200', spaceId: '7', version: { number: 1 } },
  ],
  'live read returns diagram 1 at version 3 (not stale)': [
    { id: '1', pageId: '100', spaceId: '7', version: { number: 3 } },
    { id: '2', pageId: '200', spaceId: '7', version: { number: 1 } },
  ],
};

it('prints the response for each case', async () => {
  const out: Record<string, unknown> = {};
  for (const [name, results] of Object.entries(cases)) {
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ results }) })) as unknown as typeof fetch;
    const run = (mod: typeof after) => mod.relatedDiagrams(
      db(), 'cid', '1',
      async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
      mod.confluenceContentResolver('https://api.example.test', 'token', fetchImpl),
    );
    const slim = (r: any) => ({ ...r, participants: `[${r.participants.length}]` });
    out[name] = { BEFORE: slim(await run(before as any)), AFTER: slim(await run(after)) };
  }
  console.log('PROBE_JSON ' + JSON.stringify(out, null, 2));
});
