import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { onRequest } from './title-draft';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const ctx = { cloudId: 'tenant-a', forgeAppId: 'app-a', accountId: 'viewer-a' };
const title = 'Order approval workflow';
const hashOf = (t: string) => createHash('sha256').update(t).digest('hex');
let sqlite: any;
const db = () => ({ prepare: (sql: string) => { let values: any[] = []; const s = { bind: (...a: any[]) => { values = a; return s; }, first: async () => sqlite.prepare(sql).get(...values) ?? null, run: async () => sqlite.prepare(sql).run(...values) }; return s; } });
const request = (body: any = { pageId: '123', title, spaceName: 'Payments' }, headers: Record<string, string> = {}) =>
  new Request('https://backend.example/api/title-draft', { method: 'POST', headers: { 'x-forge-oauth-user': 'user-token', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const invoke = (req = request(), context: any = ctx, DB: any = db()) => onRequest({ request: req, data: { forgeContext: context }, env: { DB } });
const rows = () => sqlite.prepare('SELECT * FROM title_draft').all();

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('functions/migrations/0036_title_draft.sql', 'utf8'));
  vi.stubGlobal('crypto', webcrypto);
});

describe('POST /api/title-draft', () => {
  it('rejects non-POST with 405', async () => {
    expect((await invoke(new Request('https://backend.example/api/title-draft'))).status).toBe(405);
  });
  it('answers 401 when cloudId or forgeAppId is missing', async () => {
    for (const key of ['cloudId', 'forgeAppId']) expect((await invoke(request(), { ...ctx, [key]: undefined })).status).toBe(401);
    expect((await onRequest({ request: request(), data: {} as any, env: { DB: db() as any } })).status).toBe(401);
    expect(rows()).toHaveLength(0);
  });
  it('answers 403 no_user_credential without a user token or accountId, and queues nothing', async () => {
    for (const res of [await invoke(request(undefined, { 'x-forge-oauth-user': '' })), await invoke(request(), { ...ctx, accountId: undefined })]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'no_user_credential' });
    }
    expect(rows()).toHaveLength(0);
  });
  it('answers 400 for bad bodies', async () => {
    const bad: any[] = [
      'not json', '{"pageId":"123"', { title }, { pageId: 'abc', title }, { pageId: '1'.repeat(31), title }, { pageId: 123, title },
      { pageId: '123' }, { pageId: '123', title: '' }, { pageId: '123', title: 'x'.repeat(256) }, { pageId: '123', title: 5 },
      { pageId: '123', title, spaceName: 'x'.repeat(256) }, { pageId: '123', title, spaceName: 7 },
      { pageId: '123', title, spaceName: 'x'.repeat(2100) },
    ];
    for (const b of bad) expect((await invoke(request(b))).status, JSON.stringify(b).slice(0, 40)).toBe(400);
    expect((await invoke(request({ pageId: '123', title: 'x'.repeat(255) }))).status).toBe(200);
    expect(rows()).toHaveLength(1);
  });
  it('queues the first miss as pending', async () => {
    const res = await invoke();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(rows()).toMatchObject([{ cloud_id: 'tenant-a', forge_app_id: 'app-a', page_id: '123', title, title_hash: hashOf(title), space_name: 'Payments', status: 'pending', mermaid: null }]);
  });
  it('answers pending again for a repeat without rewriting the row', async () => {
    await invoke();
    const before = rows()[0];
    expect(await (await invoke()).json()).toEqual({ status: 'pending' });
    expect(rows()).toEqual([before]);
  });
  it('returns a ready draft', async () => {
    await invoke();
    sqlite.prepare("UPDATE title_draft SET status='ready', mermaid='flowchart LR\nA-->B', kind='flowchart', confidence=0.9, generated_at=1").run();
    expect(await (await invoke()).json()).toEqual({ status: 'ready', mermaid: 'flowchart LR\nA-->B', kind: 'flowchart', confidence: 0.9 });
  });
  it('returns no_diagram without a diagram', async () => {
    await invoke();
    sqlite.prepare("UPDATE title_draft SET status='no_diagram', generated_at=1").run();
    expect(await (await invoke()).json()).toEqual({ status: 'no_diagram' });
  });
  it('re-queues when the title changes and clears the old draft', async () => {
    await invoke();
    sqlite.prepare("UPDATE title_draft SET status='ready', mermaid='flowchart LR\nA-->B', kind='flowchart', confidence=0.9, generated_at=1").run();
    const res = await invoke(request({ pageId: '123', title: 'Refund approval workflow' }));
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(rows()).toMatchObject([{ title: 'Refund approval workflow', title_hash: hashOf('Refund approval workflow'), status: 'pending', mermaid: null, kind: null, confidence: null, generated_at: null, space_name: null }]);
  });
  it('scopes rows by cloudId and forgeAppId', async () => {
    await invoke();
    await invoke(request(), { ...ctx, cloudId: 'tenant-b' });
    await invoke(request(), { ...ctx, forgeAppId: 'app-b' });
    expect(rows()).toHaveLength(3);
  });
  it('does not fail when a concurrent insert wins the race', async () => {
    // Simulate a stale read: SELECT sees no row, but the row exists by INSERT time.
    const racing = { prepare: (sql: string) => { const s = db().prepare(sql); if (sql.startsWith('SELECT')) return { bind: () => ({ first: async () => { await invoke(); return null; } }) }; return s; } };
    const res = await invoke(request(), ctx, racing);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(rows()).toHaveLength(1);
  });
  it('answers 503 with a fixed code on D1 errors, without leaking the title', async () => {
    const broken = { prepare: () => { throw new Error(`boom ${title}`); } };
    const res = await invoke(request(), ctx, broken);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'title_draft_unavailable' });
    expect(text).not.toContain(title);
  });
});
