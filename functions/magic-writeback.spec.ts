import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { onRequest } from './magic-writeback';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const source = 'flowchart LR\nA --> B';
const hash = createHash('sha256').update(source).digest('hex');
const artifact = { sourceHash: hash, rulesVersion: 'magic-v1', outcome: 'validated', svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>' };
const ctx = { cloudId: 'tenant-a', forgeAppId: '8ad26115-211f-4216-971b-0540f606303d', environmentId: 'ari:cloud:ecosystem::environment/8ad26115-211f-4216-971b-0540f606303d/11111111-2222-4333-8444-555555555555', installationId: 'ari:cloud:ecosystem::installation/66666666-7777-4888-8999-000000000000', accountId: 'viewer-a', apiBaseUrl: 'https://api.atlassian.com/ex/confluence/tenant-a' };
const doc = (body: any = { diagramType: 'mermaid', mermaidCode: source, unknown: { keep: true } }, version = 7) => ({ id: '123', type: 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence', title: 'Synthetic', status: 'current', pageId: '456', body: { raw: { value: JSON.stringify(body) } }, version: { number: version } });
const saved = (version = 8) => doc({ diagramType: 'mermaid', mermaidCode: source, magic: artifact }, version);
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let fetchMock: ReturnType<typeof vi.fn>;
let sqlite: any;
const db = () => ({ prepare: (sql: string) => { let values: any[] = []; const statement = { bind: (...args: any[]) => { values = args; return statement; }, first: async () => sqlite.prepare(sql).get(...values) ?? null, run: async () => sqlite.prepare(sql).run(...values) }; return statement; } });
const request = (body: any = { contentId: '123' }, headers: Record<string, string> = {}) => new Request('https://backend.example/magic-writeback', { method: 'POST', headers: { 'x-forge-oauth-user': 'user-token', 'x-forge-oauth-system': 'app-token', ...headers }, body: JSON.stringify(body) });
const invoke = (req = request(), context: any = ctx) => onRequest({ request: req, data: { forgeContext: context }, env: { DB: db() as any } });
const enqueue = (scope = ctx, expiresAt = Date.now() + 86400000, id = 'delivery-a') => sqlite.prepare('INSERT INTO MagicWriteback (id,cloudId,appId,environmentId,installationId,contentId,sourceHash,artifact,createdAt,expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, scope.cloudId, scope.forgeAppId, scope.environmentId, scope.installationId, '123', hash, JSON.stringify(artifact), Date.now(), expiresAt);
const row = () => sqlite.prepare('SELECT * FROM MagicWriteback').get();
// Mirror rows are written by forge-custom-content.ts: appId is the Forge app UUID and body is the
// JSON-stringified Confluence body object, i.e. {"raw":{"representation":"raw","value":"<json>"}}.
const mirrorBody = (mermaidCode: string) => JSON.stringify({ raw: { representation: 'raw', value: JSON.stringify({ diagramType: 'mermaid', mermaidCode }) } });
const mirrorSeed = (over: Record<string, unknown> = {}) => {
  const r = { contentId: '123', type: doc().type, latestVersionNumber: 2, body: mirrorBody('old source'), createdAt: '2026-01-01T00:00:00.000Z', appId: ctx.forgeAppId, spaceId: '99', title: 'Old title', pageId: '456', macroUuid: 'macro-1', diagramType: 'mermaid', status: 'draft', cloudId: ctx.cloudId, ...over };
  sqlite.prepare('INSERT INTO CustomContent (contentId,type,latestVersionNumber,body,createdAt,appId,spaceId,title,pageId,macroUuid,diagramType,status,cloudId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(r.contentId, r.type, r.latestVersionNumber, r.body, r.createdAt, r.appId, r.spaceId, r.title, r.pageId, r.macroUuid, r.diagramType, r.status, r.cloudId);
  return r;
};
const mirrorRows = () => sqlite.prepare('SELECT * FROM CustomContent ORDER BY appId, contentId').all();
// Records every SQL statement prepared. `fail` makes matching statements throw, either when prepared or when run.
const spiedDb = (fail?: { when: (sql: string) => boolean; at: 'prepare' | 'run' }) => {
  const sqls: string[] = []; const inner = db();
  const DB = { prepare: (sql: string) => {
    sqls.push(sql);
    if (fail?.when(sql) && fail.at === 'prepare') throw new Error('d1 boom token abc');
    const statement = inner.prepare(sql);
    if (fail?.when(sql) && fail.at === 'run') return { ...statement, bind: () => ({ run: async () => { throw new Error('d1 boom token abc'); } }) };
    return statement;
  } };
  return { sqls, DB };
};
const invokeWith = (DB: unknown, req = request()) => onRequest({ request: req, data: { forgeContext: ctx }, env: { DB: DB as any } });
const mirrorSql = (sqls: string[]) => sqls.filter(sql => /CustomContent\b/.test(sql));

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('functions/migrations/0028_add_magic_writeback.sql', 'utf8'));
  // The D1 mirror of Confluence custom content. cloudId comes from 0022, which is
  // not loaded whole because it also indexes DiagramAudience (absent in this DB).
  sqlite.exec(readFileSync('functions/migrations/0004_add-custom-content.sql', 'utf8'));
  sqlite.exec('ALTER TABLE CustomContent ADD COLUMN cloudId TEXT');
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('crypto', webcrypto);
});
describe('reviewed Magic writeback', () => {
  it('rejects missing authenticated context/tokens before any access', async () => {
    // accountId is the user principal, not part of the app context: its absence
    // is a 403 (see the no_user_credential tests below), not a 401.
    for (const key of Object.keys(ctx).filter(k => k !== 'accountId')) {
      const result = await invoke(request(), { ...ctx, [key]: undefined });
      expect(result.status).toBe(401);
    }
    const result = await invoke(request(undefined, { 'x-forge-oauth-system': '' }));
    expect(result.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // Forge sends no x-forge-oauth-user (and no principal) for guest and anonymous
  // viewers. The context is otherwise valid, so this is a clean 403, never a
  // fallback to the app token and never a queue or Confluence access.
  describe('viewer without a user credential', () => {
    const noUser = { 'x-forge-oauth-user': '' };
    const expectNoUserCredential = async (result: Response) => {
      expect(result.status).toBe(403);
      expect(await result.json()).toEqual({ error: 'no_user_credential' });
    };
    it('answers 403 no_user_credential when the user token header is missing or empty', async () => {
      await expectNoUserCredential(await invoke(request(undefined, noUser)));
      const headerless = new Request('https://backend.example/magic-writeback', { method: 'POST', headers: { 'x-forge-oauth-system': 'app-token' }, body: JSON.stringify({ contentId: '123' }) });
      await expectNoUserCredential(await invoke(headerless));
    });
    it('answers 403 no_user_credential when the principal (accountId) is absent', async () => {
      await expectNoUserCredential(await invoke(request(), { ...ctx, accountId: undefined }));
      await expectNoUserCredential(await invoke(request(), { ...ctx, accountId: '' }));
    });
    it('makes no Confluence call and leaves the queued delivery untouched', async () => {
      enqueue(); const before = row();
      await expectNoUserCredential(await invoke(request(undefined, noUser)));
      await expectNoUserCredential(await invoke(request(), { ...ctx, accountId: undefined }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(row()).toEqual(before);
      expect(row().claimToken).toBeNull();
    });
    it('never falls back to the app token for that viewer', async () => {
      enqueue(); fetchMock.mockResolvedValue(reply(doc()));
      await invoke(request(undefined, noUser));
      expect(fetchMock.mock.calls.filter(([, init]) => init?.headers?.Authorization === 'Bearer app-token')).toHaveLength(0);
    });
    it('keeps 401 when the context itself is invalid, even without a user credential', async () => {
      expect((await invoke(request(undefined, { ...noUser, 'x-forge-oauth-system': '' }))).status).toBe(401);
      expect((await invoke(request(undefined, noUser), { ...ctx, cloudId: undefined })).status).toBe(401);
      expect((await invoke(request(undefined, noUser), { ...ctx, forgeAppId: 'unknown-app' })).status).toBe(401);
      expect((await invoke(request(undefined, noUser), { ...ctx, environmentId: 'dev-a' })).status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
  it('makes no Confluence call for an empty queue and ignores payload identity hints', async () => {
    enqueue({ ...ctx, cloudId: 'tenant-b' });
    expect(await (await invoke(request({ contentId: '123', cloudId: 'tenant-b' }))).json()).toEqual({ outcome: 'miss' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('isolates pending work by app, environment and installation', async () => {
    for (const change of [{ forgeAppId: 'other-app' }, { environmentId: 'dev-b' }, { installationId: 'install-b' }]) {
      sqlite.exec('DELETE FROM MagicWriteback'); enqueue({ ...ctx, ...change });
      expect(await (await invoke()).json()).toEqual({ outcome: 'miss' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('denies an unreadable target without disclosing or app-writing the artifact', async () => {
    enqueue(); fetchMock.mockResolvedValue(reply({}, 403));
    expect(await (await invoke()).json()).toEqual({ outcome: 'unavailable', reason: 'read_403' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer user-token');
    expect(row().claimToken).toBeNull();
  });
  it('writes only magic into the freshly read body and acknowledges exact delivery', async () => {
    enqueue(); fetchMock.mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply(saved()));
    expect(await (await invoke()).json()).toEqual({ outcome: 'written', artifact });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${ctx.apiBaseUrl}/api/v2/custom-content/123`);
    expect(init.headers.Authorization).toBe('Bearer app-token');
    const put = JSON.parse(init.body);
    expect(put).toMatchObject({ title: 'Synthetic', pageId: '456', type: doc().type, status: 'current', version: { number: 8 } });
    expect(JSON.parse(put.body.value)).toEqual({ diagramType: 'mermaid', mermaidCode: source, unknown: { keep: true }, magic: artifact });
    expect(row()).toBeUndefined();
  });
  it('matches native Forge type using the UUID within the verified app-bound environment ARI', async () => {
    enqueue();
    const type = `forge:${ctx.forgeAppId}:11111111-2222-4333-8444-555555555555:zenuml-content-sequence`;
    fetchMock.mockResolvedValueOnce(reply({ ...doc(), type })).mockResolvedValueOnce(reply({ ...saved(), type }));
    expect(await (await invoke()).json()).toEqual({ outcome: 'written', artifact });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).type).toBe(type);
    expect(row()).toBeUndefined();
  });
  it('rejects malformed or cross-app verified environment ARIs before accessing pending work', async () => {
    for (const environmentId of ['dev-a', 'ari:cloud:ecosystem::environment/other-app/11111111-2222-4333-8444-555555555555']) {
      expect((await invoke(request(), { ...ctx, environmentId })).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('re-reads and re-merges after conflict to preserve concurrent unrelated edits', async () => {
    enqueue(); fetchMock.mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply({}, 409))
      .mockResolvedValueOnce(reply(doc({ diagramType: 'mermaid', mermaidCode: source, unknown: 'new value', title: 'body title' }, 8)))
      .mockResolvedValueOnce(reply(saved(9)));
    expect(await (await invoke()).json()).toEqual({ outcome: 'written', artifact });
    const put = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(put.version.number).toBe(9);
    expect(JSON.parse(put.body.value)).toEqual({ diagramType: 'mermaid', mermaidCode: source, unknown: 'new value', title: 'body title', magic: artifact });
  });
  it('aborts after conflict if exact source changes, retaining queue for expiry', async () => {
    enqueue(); fetchMock.mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply({}, 409))
      .mockResolvedValueOnce(reply(doc({ diagramType: 'mermaid', mermaidCode: `${source}\n` }, 8)));
    expect(await (await invoke()).json()).toEqual({ outcome: 'source_changed' });
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(row().claimToken).toBeNull();
  });
  it('preserves a concurrent valid same-source artifact', async () => {
    enqueue(); const newer = { ...artifact, svg: '<svg><text>New review</text></svg>' };
    fetchMock.mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply({}, 409))
      .mockResolvedValueOnce(reply(doc({ diagramType: 'mermaid', mermaidCode: source, magic: newer }, 8)));
    expect(await (await invoke()).json()).toEqual({ outcome: 'existing', artifact: newer });
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(row().id).toBe('delivery-a');
  });
  it('refuses a different app type, non-current record or non-Mermaid body', async () => {
    enqueue();
    for (const value of [{ ...doc(), type: 'ac:other:zenuml-content-sequence' }, { ...doc(), type: `forge:${ctx.forgeAppId}:99999999-2222-4333-8444-555555555555:zenuml-content-sequence` }, { ...doc(), status: 'trashed' }, doc({ diagramType: 'sequence', mermaidCode: source })]) {
      fetchMock.mockResolvedValueOnce(reply(value));
      expect(await (await invoke()).json()).toEqual({ outcome: 'invalid_target' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('preserves malformed same-source or unknown-hash artifacts, including a retry race', async () => {
    enqueue();
    const malformed = { sourceHash: hash, rulesVersion: 'unsupported', svg: '' };
    for (const magic of [malformed, { svg: 'missing hash' }, 'malformed', { sourceHash: [hash] }]) {
      fetchMock.mockResolvedValueOnce(reply(doc({ diagramType: 'mermaid', mermaidCode: source, magic })));
      expect(await (await invoke()).json()).toEqual({ outcome: 'invalid_target' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchMock.mockReset().mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply({}, 409))
      .mockResolvedValueOnce(reply(doc({ diagramType: 'mermaid', mermaidCode: source, magic: malformed }, 8)));
    expect(await (await invoke()).json()).toEqual({ outcome: 'invalid_target' });
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(row().claimToken).toBeNull();
  });
  it('permits delivery over an artifact with a demonstrably stale source hash', async () => {
    enqueue(); fetchMock.mockResolvedValueOnce(reply(doc({ diagramType: 'mermaid', mermaidCode: source, magic: { ...artifact, sourceHash: 'a'.repeat(64) } })))
      .mockResolvedValueOnce(reply(saved()));
    expect(await (await invoke()).json()).toEqual({ outcome: 'written', artifact });
  });
  it('bounds conflicting writes and releases the lease', async () => {
    enqueue(); fetchMock.mockImplementation((_url, init) => Promise.resolve(init.method === 'PUT' ? reply({}, 409) : reply(doc())));
    expect(await (await invoke()).json()).toEqual({ outcome: 'conflict' });
    expect(fetchMock).toHaveBeenCalledTimes(6); expect(row().claimToken).toBeNull();
  });
  it('does not double-deliver a leased row and recovers an expired claim', async () => {
    enqueue(); sqlite.prepare('UPDATE MagicWriteback SET claimToken=?, claimUntil=?').run('other-fence', Date.now() + 60000);
    fetchMock.mockResolvedValue(reply(doc()));
    expect(await (await invoke()).json()).toEqual({ outcome: 'miss' }); expect(fetchMock).toHaveBeenCalledTimes(1);
    sqlite.prepare('UPDATE MagicWriteback SET claimUntil=?').run(Date.now() - 1);
    fetchMock.mockReset().mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply(saved()));
    expect(await (await invoke()).json()).toEqual({ outcome: 'written', artifact });
  });
  it('cannot delete a delivery whose completion fence changed', async () => {
    enqueue(); fetchMock.mockImplementation((_url, init) => {
      if (init.method === 'PUT') { sqlite.prepare('UPDATE MagicWriteback SET claimToken=?').run('new-owner'); return Promise.resolve(reply(saved())); }
      return Promise.resolve(reply(doc()));
    });
    expect(await (await invoke()).json()).toEqual({ outcome: 'written', artifact });
    expect(row().claimToken).toBe('new-owner');
  });
  it('reports a status-only reason when the PUT fails', async () => {
    enqueue(); fetchMock.mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply({ message: 'secret tenant text' }, 500));
    expect(await (await invoke()).json()).toEqual({ outcome: 'unavailable', reason: 'put_500' });
  });
  it('reports a fixed reason on exception without the error message', async () => {
    enqueue(); fetchMock.mockRejectedValue(new Error('token abc leaked'));
    const body = await (await invoke()).json();
    expect(body).toEqual({ outcome: 'unavailable', reason: 'exception' });
  });
  it('purges expired payloads without reading Confluence', async () => {
    enqueue(ctx, Date.now() - 1);
    expect(await (await invoke()).json()).toEqual({ outcome: 'miss' });
    expect(row()).toBeUndefined(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fails open to Original for a failed write and never returns queued SVG', async () => {
    enqueue(); fetchMock.mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply({}, 403));
    expect(await (await invoke()).json()).toEqual({ outcome: 'unavailable', reason: 'put_403' }); expect(row().claimToken).toBeNull();
  });
  // When the viewer-read source no longer matches the queued hash, the backend already holds the
  // fresh Confluence record. The D1 mirror is refreshed from it, forward-only and update-only.
  describe('mirror refresh on source_changed', () => {
    const changedSource = `${source}\nB --> C`;
    const changed = () => ({ ...doc({ diagramType: 'mermaid', mermaidCode: changedSource }, 9), title: 'Renamed' });
    const unchangedColumns = (r: any) => { const { latestVersionNumber, body, title, status, ...rest } = r; return rest; };

    it('copies version, body, title and status into an older mirror row and returns source_changed untouched', async () => {
      enqueue(); const seeded = mirrorSeed(); const queued = row();
      const fresh = changed(); fetchMock.mockResolvedValueOnce(reply(fresh));
      const spy = spiedDb();
      expect(await (await invokeWith(spy.DB)).json()).toEqual({ outcome: 'source_changed' });
      const mirror = sqlite.prepare('SELECT * FROM CustomContent').get();
      expect(mirror.latestVersionNumber).toBe(9);
      expect(mirror.body).toBe(JSON.stringify(fresh.body));
      expect(mirror.title).toBe('Renamed');
      expect(mirror.status).toBe('current');
      expect(unchangedColumns(mirror)).toEqual(unchangedColumns(seeded));
      expect(mirrorSql(spy.sqls).filter(sql => sql.startsWith('UPDATE CustomContent'))).toHaveLength(1);
      expect(row()).toEqual(queued);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    });
    it('refreshes after a 409 re-read finds the changed source', async () => {
      enqueue(); mirrorSeed(); const fresh = changed();
      fetchMock.mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply({}, 409)).mockResolvedValueOnce(reply(fresh));
      expect(await (await invoke()).json()).toEqual({ outcome: 'source_changed' });
      expect(sqlite.prepare('SELECT latestVersionNumber, body FROM CustomContent').get()).toEqual({ latestVersionNumber: 9, body: JSON.stringify(fresh.body) });
    });
    it('also refreshes a legacy mirror row that has no cloudId yet', async () => {
      enqueue(); mirrorSeed({ cloudId: null }); fetchMock.mockResolvedValueOnce(reply(changed()));
      expect(await (await invoke()).json()).toEqual({ outcome: 'source_changed' });
      expect(sqlite.prepare('SELECT latestVersionNumber, cloudId FROM CustomContent').get()).toEqual({ latestVersionNumber: 9, cloudId: null });
    });
    it('never moves the mirror backwards: a row at the same or a newer version stays byte-for-byte', async () => {
      for (const latestVersionNumber of [9, 12]) {
        sqlite.exec('DELETE FROM CustomContent; DELETE FROM MagicWriteback'); enqueue(); mirrorSeed({ latestVersionNumber, body: mirrorBody('newer mirror') });
        const before = mirrorRows(); fetchMock.mockReset().mockResolvedValueOnce(reply(changed()));
        const spy = spiedDb();
        expect(await (await invokeWith(spy.DB)).json()).toEqual({ outcome: 'source_changed' });
        expect(mirrorSql(spy.sqls).filter(sql => sql.startsWith('UPDATE CustomContent'))).toHaveLength(1);
        expect(mirrorRows()).toEqual(before);
      }
    });
    it('never inserts: with no mirror row nothing is created', async () => {
      enqueue(); fetchMock.mockResolvedValueOnce(reply(changed()));
      const spy = spiedDb();
      expect(await (await invokeWith(spy.DB)).json()).toEqual({ outcome: 'source_changed' });
      expect(mirrorSql(spy.sqls).filter(sql => sql.startsWith('UPDATE CustomContent'))).toHaveLength(1);
      expect(mirrorSql(spy.sqls).some(sql => /insert/i.test(sql))).toBe(false);
      expect(mirrorRows()).toEqual([]);
    });
    it('is scoped to the verified tenant and app: another cloudId or appId is never touched', async () => {
      enqueue(); mirrorSeed({ cloudId: 'tenant-b' }); mirrorSeed({ appId: 'd9e4002b-120b-426b-834b-402a4a5adce7' });
      const before = mirrorRows(); fetchMock.mockResolvedValueOnce(reply(changed()));
      const spy = spiedDb();
      expect(await (await invokeWith(spy.DB)).json()).toEqual({ outcome: 'source_changed' });
      expect(mirrorSql(spy.sqls).filter(sql => sql.startsWith('UPDATE CustomContent'))).toHaveLength(1);
      expect(mirrorRows()).toEqual(before);
    });
    it.each(['prepare', 'run'] as const)('keeps source_changed and logs nothing when the mirror UPDATE fails at %s', async (at) => {
      enqueue(); mirrorSeed(); const before = mirrorRows(); const queued = row(); fetchMock.mockResolvedValueOnce(reply(changed()));
      const spy = spiedDb({ when: sql => sql.startsWith('UPDATE CustomContent'), at });
      const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => {}));
      try {
        expect(await (await invokeWith(spy.DB)).json()).toEqual({ outcome: 'source_changed' });
        // The UPDATE was attempted (and failed); nothing it carried may reach a log.
        expect(spy.sqls.filter(sql => sql.startsWith('UPDATE CustomContent'))).toHaveLength(1);
        const logged = JSON.stringify(logs.flatMap(l => l.mock.calls));
        for (const secret of [changedSource, 'B --> C', hash, 'Renamed', 'boom', 'abc']) expect(logged).not.toContain(secret);
      } finally { logs.forEach(l => l.mockRestore()); }
      expect(mirrorRows()).toEqual(before); expect(row()).toEqual(queued);
    });
    it('does not even address the mirror on existing, written, invalid_target, miss or unavailable', async () => {
      mirrorSeed(); const before = mirrorRows();
      const cases: Array<[string, boolean, () => void]> = [
        ['existing', true, () => { fetchMock.mockResolvedValueOnce(reply(doc({ diagramType: 'mermaid', mermaidCode: source, magic: artifact }, 9))); }],
        ['written', true, () => { fetchMock.mockResolvedValueOnce(reply(doc())).mockResolvedValueOnce(reply(saved())); }],
        ['invalid_target', true, () => { fetchMock.mockResolvedValueOnce(reply({ ...doc(), status: 'trashed' })); }],
        ['miss', false, () => {}],
        ['unavailable', true, () => { fetchMock.mockResolvedValueOnce(reply({}, 403)); }],
      ];
      for (const [outcome, queued, arrange] of cases) {
        sqlite.exec('DELETE FROM MagicWriteback'); fetchMock.mockReset(); if (queued) enqueue(); arrange();
        const spy = spiedDb();
        expect((await (await invokeWith(spy.DB)).json()).outcome).toBe(outcome);
        expect(mirrorSql(spy.sqls)).toEqual([]);
        expect(mirrorRows()).toEqual(before);
      }
    });
  });
});
