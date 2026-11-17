// BEFORE/AFTER probe: the same stale inputs through relatedDiagrams and the content resolver,
// once with the service and repository files from the base branch and once with the
// candidate's. Fixtures are fictional: diagram 1 indexed at version 3.
// The fake D1 returns a row's runId only when the SQL selects it, as the real table would.
import { it } from 'vitest';
import * as before from './service.base';
import * as after from './service';

const row = (o: Record<string, unknown>) => ({
  contentId: '1', pageId: '100', spaceId: '7', contentVersion: 3, actorId: 'PA',
  rawLabel: 'Partner App', comparisonKey: 'partner.app', lineNumber: 2,
  indexedAt: '2026-08-27T05:00:00Z', ...o,
});
const db = (runId: string, sqlSeen: string[]) => ({
  prepare: (sql: string) => ({
    bind: () => ({
      all: async () => {
        sqlSeen.push(sql.replace(/\(\?2(, \?\d+)*\)/, '(…)'));
        const withRun = (o: Record<string, unknown>) => (/\brunId\b/.test(sql) ? { ...o, runId } : o);
        return {
          results: sql.includes('contentId = ?2')
            ? [withRun(row({}))]
            : [withRun(row({ contentId: '2', pageId: '200', contentVersion: 1 }))],
        };
      },
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

const run = async (mod: typeof after, results: unknown[], runId: string, sqlSeen: string[] = []) => {
  const fetchImpl = (async () => ({ ok: true, json: async () => ({ results }) })) as unknown as typeof fetch;
  const r: any = await mod.relatedDiagrams(
    db(runId, sqlSeen), 'cid', '1',
    async (ids: string[]) => ids.map((id) => ({ id, title: `Page ${id}`, spaceKey: 'OP' })),
    mod.confluenceContentResolver('https://api.example.test', 'token', fetchImpl),
  );
  return { ...r, participants: `[${r.participants.length}]` };
};

it('prints the response for each case', async () => {
  const out: Record<string, unknown> = {};
  // Index rows written by the save-time sync (run id `save:3`).
  for (const [name, results] of Object.entries(cases)) {
    out[name] = {
      BEFORE: await run(before as any, results, 'save:3'),
      AFTER: await run(after, results, 'save:3'),
    };
  }
  // The same stale lookup, for each run id format a writer produces.
  const stale = cases['live read returns diagram 1 at version 4'];
  for (const runId of ['save:3', 'heal:3', '2026-08-27', 'nightly-7']) {
    out[`index rows with run id ${runId}`] = {
      BEFORE: await run(before as any, stale, runId),
      AFTER: await run(after, stale, runId),
    };
  }
  // The SQL each version sends for one lookup (key placeholders shortened).
  const sqlBefore: string[] = [];
  const sqlAfter: string[] = [];
  await run(before as any, stale, 'save:3', sqlBefore);
  await run(after, stale, 'save:3', sqlAfter);
  out['index reads for one lookup'] = { BEFORE: sqlBefore, AFTER: sqlAfter };
  console.log('PROBE_JSON ' + JSON.stringify(out, null, 2));
});
