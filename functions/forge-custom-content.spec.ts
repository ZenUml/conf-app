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

import { onRequest } from './forge-custom-content';

type PreparedCall = { sql: string; binds: unknown[] };

function makeDB(opts: { rowExists: boolean }) {
  const calls: PreparedCall[] = [];
  const prepare = vi.fn((sql: string) => {
    const stmt = {
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds });
        return {
          first: async () => null,
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

function makeRequest(payload: any) {
  return new Request('https://example.com/forge-custom-content', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forge-oauth-user': 'token-abc',
    },
    body: JSON.stringify(payload),
  });
}

const FORGE_CONTEXT = {
  apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cloud-1',
  forgeAppId: 'app-1',
};

describe('forge-custom-content createOrUpdateContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('backfills macroUuid + diagramType on UPDATE via COALESCE(NULLIF(...,\'\'), existing)', async () => {
    const db = makeDB({ rowExists: true });
    const env = { DB: { prepare: db.prepare }, FORGE_CONTEXT };
    const req = makeRequest({
      contentId: 'cc-1',
      macroUuid: 'local-id-abc',
      diagramType: 'sequence',
    });

    const res = await onRequest({ request: req, env } as any);
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
    const env = { DB: { prepare: db.prepare }, FORGE_CONTEXT };
    const req = makeRequest({ contentId: 'cc-1' });

    await onRequest({ request: req, env } as any);

    const updateCall = db.calls.find((c) => c.sql.startsWith('UPDATE CustomContent'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.binds[5]).toBe(''); // macroUuid coerced to ''
    expect(updateCall!.binds[6]).toBe(''); // diagramType coerced to ''
    // The SQL itself is what guarantees no wipe — NULLIF('','') → NULL → COALESCE keeps existing.
  });

  it('writes macroUuid + diagramType on INSERT for a fresh row', async () => {
    const db = makeDB({ rowExists: false });
    const env = { DB: { prepare: db.prepare }, FORGE_CONTEXT };
    const req = makeRequest({
      contentId: 'cc-1',
      macroUuid: 'local-id-abc',
      diagramType: 'mermaid',
    });

    await onRequest({ request: req, env } as any);

    const insertCall = db.calls.find((c) => c.sql.startsWith('insert into CustomContent'));
    expect(insertCall).toBeDefined();
    // INSERT binds: contentId, type, version, body, createdAt, appId, spaceId,
    //               title, pageId, macroUuid, diagramType, status
    expect(insertCall!.binds[9]).toBe('local-id-abc');
    expect(insertCall!.binds[10]).toBe('mermaid');
  });
});
