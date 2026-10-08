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

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('functions/migrations/0028_add_magic_writeback.sql', 'utf8'));
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('crypto', webcrypto);
});
describe('reviewed Magic writeback', () => {
  it('rejects missing authenticated context/tokens before any access', async () => {
    for (const key of Object.keys(ctx)) {
      const result = await invoke(request(), { ...ctx, [key]: undefined });
      expect(result.status).toBe(401);
    }
    for (const key of ['x-forge-oauth-user', 'x-forge-oauth-system']) {
      const result = await invoke(request(undefined, { [key]: '' }));
      expect(result.status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(await (await invoke()).json()).toEqual({ outcome: 'unavailable' }); expect(row().claimToken).toBeNull();
  });
});
