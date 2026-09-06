import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Confluence + DB utility imports so onRequest can be exercised
// without network or D1.
vi.mock('./utils/confluenceUtils', () => ({
  getCustomContentFromConfluenceForForge: vi.fn(async () => ({
    id: 'cc-1',
    type: 'zenuml-content-sequence',
    spaceId: 'space-1',
    pageId: 'page-1',
    title: 'Test',
    body: { raw: { value: '{}' } },
    version: { number: 2, message: '', minorEdit: false },
    authorId: 'user-1',
    createdAt: '2026-05-23T00:00:00.000Z',
    status: 'current',
  })),
}));
vi.mock('./utils/dbUtils', () => ({
  upsertAtlassianInstance: vi.fn(async () => undefined),
}));
vi.mock('./utils/sentry', () => ({
  captureError: vi.fn(),
}));

import { onRequest } from './forge-custom-content';
import { getCustomContentFromConfluenceForForge } from './utils/confluenceUtils';

type PreparedCall = { sql: string; binds: unknown[] };

function makeDB(opts: { rowExists: boolean; versionExists?: boolean }) {
  const calls: PreparedCall[] = [];
  const prepare = vi.fn((sql: string) => {
    const stmt = {
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds });
        return {
          first: async () =>
            sql.startsWith('SELECT versionNumber FROM CustomContentVersion') && opts.versionExists
              ? { versionNumber: 2 }
              : null,
          all: async () => ({
            results: sql.startsWith('SELECT contentId FROM CustomContent') && opts.rowExists
              ? [{ contentId: 'cc-1' }]
              : [],
          }),
          run: async () => ({ success: true }),
        };
      },
    };
    return stmt;
  });
  return { prepare, calls };
}

// A DB whose every write throws — simulates an unexpected D1 failure so we can
// assert the handler returns a *parseable JSON* 500 carrying the real message.
function makeFailingDB() {
  const prepare = vi.fn(() => ({
    bind: () => ({
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => {
        throw new Error('D1_ERROR: no such table: CustomContentVersion');
      },
    }),
  }));
  return { prepare };
}

function makeRequest(payload: any, withAuth = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withAuth) headers['x-forge-oauth-user'] = 'token-abc';
  return new Request('https://example.com/forge-custom-content', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

const FORGE_CONTEXT = {
  cloudId: 'cloud-1',
  apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-1',
  forgeAppId: 'app-1',
};
const FORGE_DATA = { forgeContext: FORGE_CONTEXT };

describe('forge-custom-content createOrUpdateContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('backfills macroUuid + diagramType on UPDATE via COALESCE(NULLIF(...,\'\'), existing)', async () => {
    const db = makeDB({ rowExists: true });
    const env = { DB: { prepare: db.prepare } };
    const req = makeRequest({
      contentId: 'cc-1',
      macroUuid: 'local-id-abc',
      diagramType: 'sequence',
    });

    const res = await onRequest({ request: req, env, data: FORGE_DATA } as any);
    expect(res.status).toBe(200);

    // Find the UPDATE call and confirm SQL shape + macroUuid is forwarded.
    const updateCall = db.calls.find((c) => c.sql.startsWith('UPDATE CustomContent'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.sql).toContain("macroUuid = COALESCE(NULLIF(?6, ''), macroUuid)");
    expect(updateCall!.sql).toContain("diagramType = COALESCE(NULLIF(?7, ''), diagramType)");
    // Positional binds: [versionNumber, body, createdAt, title, status,
    //                    macroUuid, diagramType, contentId, appId, spaceId]
    expect(updateCall!.binds[5]).toBe('local-id-abc');
    expect(updateCall!.binds[6]).toBe('sequence');
  });

  it('passes empty strings on UPDATE when no identity supplied — DB COALESCE preserves existing values', async () => {
    const db = makeDB({ rowExists: true });
    const env = { DB: { prepare: db.prepare } };
    const req = makeRequest({ contentId: 'cc-1' });

    await onRequest({ request: req, env, data: FORGE_DATA } as any);

    const updateCall = db.calls.find((c) => c.sql.startsWith('UPDATE CustomContent'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.binds[5]).toBe(''); // macroUuid coerced to ''
    expect(updateCall!.binds[6]).toBe(''); // diagramType coerced to ''
    // The SQL itself is what guarantees no wipe — NULLIF('','') → NULL → COALESCE keeps existing.
  });

  it('still UPDATEs CustomContent when the version row already exists (idempotent retry)', async () => {
    const db = makeDB({ rowExists: true, versionExists: true });
    const env = { DB: { prepare: db.prepare } };
    const req = makeRequest({
      contentId: 'cc-1',
      macroUuid: 'local-id-retry',
      diagramType: 'sequence',
    });

    const res = await onRequest({ request: req, env, data: FORGE_DATA } as any);
    expect(res.status).toBe(200);

    // Pre-fix: version-gate skipped createOrUpdateContent entirely on retries,
    // leaving macroUuid/diagramType stale. Now the UPDATE must still fire.
    const updateCall = db.calls.find((c) => c.sql.startsWith('UPDATE CustomContent'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.binds[5]).toBe('local-id-retry');
    expect(updateCall!.binds[6]).toBe('sequence');

    // And no duplicate INSERT into CustomContentVersion (createVersion is
    // idempotent — bails on existingVersion before the INSERT INTO …VERSION).
    const versionInsert = db.calls.find((c) => c.sql.startsWith('INSERT INTO CustomContentVersion'));
    expect(versionInsert).toBeUndefined();
  });

  it('uses INSERT OR IGNORE for CustomContentVersion so concurrent duplicates do not 500 the request', async () => {
    const db = makeDB({ rowExists: true, versionExists: false });
    const env = { DB: { prepare: db.prepare } };
    const req = makeRequest({
      contentId: 'cc-1',
      macroUuid: 'local-id-concurrent',
      diagramType: 'sequence',
    });

    const res = await onRequest({ request: req, env, data: FORGE_DATA } as any);
    expect(res.status).toBe(200);

    // The SQL clause itself is the race-safety contract: without OR IGNORE,
    // a concurrent duplicate insert would throw and skip the backfill below.
    const versionInsert = db.calls.find((c) =>
      c.sql.startsWith('INSERT OR IGNORE INTO CustomContentVersion'),
    );
    expect(versionInsert).toBeDefined();

    // And the CustomContent UPDATE still runs (no version-gate, no race-poison).
    const updateCall = db.calls.find((c) => c.sql.startsWith('UPDATE CustomContent'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.binds[5]).toBe('local-id-concurrent');
  });

  it('writes macroUuid + diagramType on INSERT for a fresh row', async () => {
    const db = makeDB({ rowExists: false });
    const env = { DB: { prepare: db.prepare } };
    const req = makeRequest({
      contentId: 'cc-1',
      macroUuid: 'local-id-abc',
      diagramType: 'mermaid',
    });

    await onRequest({ request: req, env, data: FORGE_DATA } as any);

    const insertCall = db.calls.find((c) => c.sql.startsWith('insert into CustomContent'));
    expect(insertCall).toBeDefined();
    // INSERT binds: contentId, type, version, body, createdAt, appId, spaceId,
    //               title, pageId, macroUuid, diagramType, status
    expect(insertCall!.binds[9]).toBe('local-id-abc');
    expect(insertCall!.binds[10]).toBe('mermaid');
  });
});

describe('forge-custom-content error handling (conf-app#267)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a JSON 400 (not a text/plain 500) when the OAuth user header is missing', async () => {
    const db = makeDB({ rowExists: true });
    const env = { DB: { prepare: db.prepare } };
    const req = makeRequest({ contentId: 'cc-1' }, /* withAuth */ false);

    const res = await onRequest({ request: req, env, data: FORGE_DATA } as any);

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json: any = await res.json();
    expect(json.error).toContain('x-forge-oauth-user');
    // No re-fetch, no DB writes when input is rejected up front.
    expect(getCustomContentFromConfluenceForForge).not.toHaveBeenCalled();
    expect(db.calls.length).toBe(0);
  });

  it('treats a Confluence re-fetch failure as a benign 2xx skip — no error, no D1 writes', async () => {
    // The most likely historical trigger: the user-OAuth re-fetch returns
    // non-2xx (permission / content gone / transient) and confluenceUtils throws.
    (getCustomContentFromConfluenceForForge as any).mockRejectedValueOnce(
      new Error('HTTP error! Status: 404, Text: Not Found'),
    );
    const db = makeDB({ rowExists: true });
    const env = { DB: { prepare: db.prepare } };

    const res = await onRequest({
      request: makeRequest({ contentId: 'cc-1' }),
      env,
      data: FORGE_DATA,
    } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json: any = await res.json();
    expect(json.synced).toBe(false);
    expect(json.reason).toBe('content_fetch_failed');
    // Best-effort sync: nothing is written to D1 when the source content is unreadable.
    expect(db.calls.length).toBe(0);
  });

  it('returns a JSON 500 carrying the real message when a D1 write fails (unmasked)', async () => {
    const env = { DB: makeFailingDB() };

    const res = await onRequest({
      request: makeRequest({ contentId: 'cc-1' }),
      env,
      data: FORGE_DATA,
    } as any);

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json: any = await res.json();
    // The real cause is surfaced — not a generic 'Internal server error' /
    // content-type complaint that the Forge bridge would have masked.
    expect(json.error).toContain('D1_ERROR');
  });

  it('returns a JSON 400 when the request body is not valid JSON', async () => {
    const db = makeDB({ rowExists: true });
    const env = { DB: { prepare: db.prepare } };
    const req = new Request('https://example.com/forge-custom-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forge-oauth-user': 'token-abc' },
      body: 'not-json',
    });

    const res = await onRequest({ request: req, env, data: FORGE_DATA } as any);

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json: any = await res.json();
    expect(json.error).toContain('Invalid JSON body');
  });

  it('stamps the tenant on the content row, so a per-tenant index can be built', async () => {
    const db = makeDB({ rowExists: false });
    const env = { DB: { prepare: db.prepare } };
    const data = {
      forgeContext: {
        ...FORGE_CONTEXT,
        apiBaseUrl: 'https://api.atlassian.com/ex/confluence/368b0fa8-90e4-4ffc-92d6-de20c0e38c9e',
      },
    };

    await onRequest({ request: makeRequest({ contentId: 'cc-1' }), env, data } as any);

    const insertCall = db.calls.find((c) => c.sql.startsWith('insert into CustomContent'));
    // 13th bind: cloudId, read out of the Forge apiBaseUrl
    expect(insertCall!.binds[12]).toBe('368b0fa8-90e4-4ffc-92d6-de20c0e38c9e');
  });

  it('never clears a recorded tenant when the id cannot be read', async () => {
    const db = makeDB({ rowExists: true });
    const env = { DB: { prepare: db.prepare } };
    const data = { forgeContext: { ...FORGE_CONTEXT, apiBaseUrl: 'https://example.invalid/x' } };

    await onRequest({ request: makeRequest({ contentId: 'cc-1' }), env, data } as any);

    const updateCall = db.calls.find((c) => c.sql.startsWith('UPDATE CustomContent'));
    expect(updateCall!.sql).toContain('cloudId = COALESCE(?11, cloudId)');
    expect(updateCall!.binds[10]).toBeNull();
  });
});

// The architecture-token index is derived from content Confluence already owns.
// These assert the two properties that matter at the handler level: a save is
// never failed by the index write, and a healthy DB receives the replace.
describe('architecture-token index on save', () => {
  const sequenceContent = {
    id: 'cc-1',
    type: 'zenuml-content-sequence',
    spaceId: 'space-1',
    pageId: 'page-1',
    title: 'Test',
    body: {
      raw: {
        value: JSON.stringify({
          diagramType: 'mermaid',
          mermaidCode: 'sequenceDiagram\n  participant PA as Partner App\n  PA->>PA: x',
        }),
      },
    },
    version: { number: 7, message: '', minorEdit: false },
    authorId: 'user-1',
    createdAt: '2026-09-02T00:00:00.000Z',
    status: 'current',
  };

  beforeEach(() => {
    vi.mocked(getCustomContentFromConfluenceForForge).mockResolvedValue(sequenceContent as any);
  });

  it('replaces the diagram rows at the saved version', async () => {
    const db = makeDB({ rowExists: true });
    const batched: any[] = [];
    (db as any).batch = vi.fn(async (stmts: any[]) => { batched.push(...stmts); return []; });

    const res = await onRequest({
      request: makeRequest({ contentId: 'cc-1' }),
      env: { DB: db },
      data: { forgeContext: { apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-1', forgeAppId: 'app-1' } },
    } as any);

    expect(res.status).toBe(200);
    expect((db as any).batch).toHaveBeenCalledTimes(1);
    const sqls = db.calls.map((c) => c.sql);
    expect(sqls.some((s) => s.startsWith('DELETE FROM ArchitectureTokenOccurrence'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO ArchitectureTokenOccurrence'))).toBe(true);
    // The indexed version is the version just saved — this is what stops
    // service.ts raising error_kind 'stale_index'.
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO ArchitectureTokenOccurrence'));
    expect(insert?.binds[4]).toBe(7);
  });

  it('still returns a successful save when the index write fails', async () => {
    const db = makeDB({ rowExists: true });
    (db as any).batch = vi.fn(async () => { throw new Error('D1 down'); });

    const res = await onRequest({
      request: makeRequest({ contentId: 'cc-1' }),
      env: { DB: db },
      data: { forgeContext: { apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-1', forgeAppId: 'app-1' } },
    } as any);

    expect(res.status).toBe(200);
  });

  it('skips the index when the apiBaseUrl carries no cloudId', async () => {
    const db = makeDB({ rowExists: true });
    (db as any).batch = vi.fn(async () => []);

    const res = await onRequest({
      request: makeRequest({ contentId: 'cc-1' }),
      env: { DB: db },
      data: { forgeContext: { apiBaseUrl: 'https://example.invalid/x', forgeAppId: 'app-1' } },
    } as any);

    expect(res.status).toBe(200);
    expect((db as any).batch).not.toHaveBeenCalled();
  });
});
