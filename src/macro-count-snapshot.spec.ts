import { beforeEach, describe, expect, it, vi } from 'vitest';

const forgeMocks = vi.hoisted(() => ({
  requestConfluence: vi.fn(),
  invokeRemote: vi.fn(),
  getAppContext: vi.fn(() => ({
    installationAri: { installationId: 'installation-prod' },
  })),
}));

vi.mock('@forge/api', () => ({
  default: {
    asApp: vi.fn(() => ({ requestConfluence: forgeMocks.requestConfluence })),
  },
  getAppContext: forgeMocks.getAppContext,
  invokeRemote: forgeMocks.invokeRemote,
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((result, fragment, index) => (
      result + fragment + (index < values.length ? encodeURIComponent(String(values[index])) : '')
    ), ''),
}));

import {
  LITE_CUSTOM_CONTENT_TYPES,
  SNAPSHOT_CHUNK_MAX_BYTES,
  SnapshotFailure,
  assertNoClientIdentity,
  chunkJsonRows,
  countSnapshotRows,
  countsInvariant,
  createProductionDependencies,
  nextCursor,
  requestConfluenceJsonWithRetry,
  runMacroCountSnapshot,
  sha256Hex,
  toPrivacySafeRow,
  type ResponseLike,
  type ScannerDependencies,
} from './macro-count-snapshot';

function response(body: unknown, status = 200, headers: Record<string, string> = {}): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
  };
}

function content(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '101',
    pageId: '201',
    spaceId: '301',
    type: LITE_CUSTOM_CONTENT_TYPES[0],
    status: 'current',
    title: 'must never leave Forge',
    authorId: 'account-secret',
    version: { number: 7, createdAt: '2026-07-20T00:00:00.000Z', authorId: 'account-secret' },
    body: { raw: { value: JSON.stringify({ id: 'logical-1', diagramType: 'sequence', code: 'A->B' }) } },
    ...overrides,
  };
}

interface RemoteCall {
  path: string;
  body: Record<string, unknown>;
}

function scannerHarness(options: {
  claim?: Record<string, unknown>;
  requestCustomContent?: ScannerDependencies['requestCustomContent'];
  requestSpaces?: ScannerDependencies['requestSpaces'];
  failThrows?: boolean;
} = {}) {
  const remoteCalls: RemoteCall[] = [];
  const customCalls: Array<{ type: string; cursor?: string }> = [];
  const spaceCalls: Array<{ ids: string[]; cursor?: string }> = [];
  const claim = options.claim || {
    eligible: true,
    claimed: true,
    runId: 'run-1',
    capturedAt: '2026-07-20T01:02:03.000Z',
  };

  const deps: ScannerDependencies = {
    tenantScope: 'installation-1',
    now: vi.fn(() => 1_000),
    sleep: vi.fn(async () => {}),
    requestCustomContent: options.requestCustomContent || vi.fn(async (type, cursor) => {
      customCalls.push({ type, cursor });
      if (type === LITE_CUSTOM_CONTENT_TYPES[0] && !cursor) {
        return response({
          results: [
            content(),
            content({
              id: '102',
              pageId: '202',
              body: { raw: { value: 'not-json' } },
            }),
          ],
          _links: { next: '/wiki/api/v2/custom-content?cursor=sequence-page-2' },
        });
      }
      if (type === LITE_CUSTOM_CONTENT_TYPES[0] && cursor === 'sequence-page-2') {
        return response({
          results: [content({
            id: '103',
            pageId: null,
            spaceId: '302',
            body: { raw: { value: JSON.stringify({ diagramType: 'OpenAPI' }) } },
          })],
          _links: {},
        });
      }
      return response({
        results: [content({
          id: '104',
          pageId: '204',
          type: LITE_CUSTOM_CONTENT_TYPES[1],
          body: { raw: { value: JSON.stringify({ diagramType: 'graph', graphXml: '<xml />' }) } },
        })],
        _links: {},
      });
    }),
    requestSpaces: options.requestSpaces || vi.fn(async (ids, cursor) => {
      spaceCalls.push({ ids: [...ids], cursor });
      return response({
        results: ids.map((id: string) => ({ id, key: id === '301' ? 'ENG' : 'API' })),
        _links: {},
      });
    }),
    invokeRemote: vi.fn(async (path, body) => {
      remoteCalls.push({ path, body: structuredClone(body) });
      if (path.endsWith('/claim')) return response(claim, claim.claimed ? 201 : 200);
      if (path.endsWith('/fail') && options.failThrows) throw new Error('fail endpoint unavailable');
      if (path.endsWith('/fail')) return response({ success: true });
      if (path.endsWith('/commit')) return response({ success: true });
      if (path.endsWith('/chunk')) {
        const kind = String(body.kind);
        const index = body.index == null ? 'manifest' : String(body.index);
        return response({
          success: true,
          key: `server-owned/${kind}/${String(body.spaceId || 'tenant')}/${index}.json`,
          // The Remote enriches stored space manifests with FIT-derived
          // identity, so only that stored-object hash differs from the upload.
          sha256: kind === 'space' ? 'f'.repeat(64) : body.sha256,
          rowCount: body.rowCount,
        }, 201);
      }
      throw new Error(`unexpected path ${path}`);
    }),
  };

  return { deps, remoteCalls, customCalls, spaceCalls };
}

describe('privacy-safe row construction and counts', () => {
  it('keeps only allow-listed scalar metadata and hashes the logical id per tenant', async () => {
    const first = await toPrivacySafeRow(content(), LITE_CUSTOM_CONTENT_TYPES[0], 'tenant-a');
    const secondTenant = await toPrivacySafeRow(content(), LITE_CUSTOM_CONTENT_TYPES[0], 'tenant-b');

    expect(first.spaceId).toBe('301');
    expect(Object.keys(first.row)).toEqual([
      'contentId',
      'pageId',
      'type',
      'status',
      'versionNumber',
      'versionCreatedAt',
      'diagramType',
      'logicalIdHash',
      'parseStatus',
    ]);
    expect(first.row).toMatchObject({
      contentId: '101',
      pageId: '201',
      diagramType: 'sequence',
      parseStatus: 'parsed',
      versionNumber: 7,
    });
    expect(first.row.logicalIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.row.logicalIdHash).not.toBe(secondTenant.row.logicalIdHash);
    expect(JSON.stringify(first.row)).not.toMatch(/must never|account-secret|A->B|title|authorId|body|raw/);
  });

  it('classifies missing, invalid, and unknown bodies into the unknown count bucket', async () => {
    const rows = await Promise.all([
      toPrivacySafeRow(content({ id: '1', body: {} }), LITE_CUSTOM_CONTENT_TYPES[0], 'tenant'),
      toPrivacySafeRow(content({ id: '2', body: { raw: { value: '{' } } }), LITE_CUSTOM_CONTENT_TYPES[0], 'tenant'),
      toPrivacySafeRow(content({ id: '3', body: { raw: { value: '{}' } } }), LITE_CUSTOM_CONTENT_TYPES[0], 'tenant'),
      toPrivacySafeRow(content({ id: '4', body: { raw: { value: JSON.stringify({ diagramType: 'plantuml' }) } } }), LITE_CUSTOM_CONTENT_TYPES[0], 'tenant'),
      // Lite stores AsyncAPI under the shared zenuml-content-sequence type
      // (ADR-0005 Option A). DiagramType.AsyncApi is the string 'AsyncAPI', so
      // this also pins the case-insensitive match — without its own bucket it
      // would classify as unknown_diagram_type, i.e. corrupt content.
      toPrivacySafeRow(content({ id: '5', body: { raw: { value: JSON.stringify({ diagramType: 'AsyncAPI' }) } } }), LITE_CUSTOM_CONTENT_TYPES[0], 'tenant'),
    ]);
    expect(rows.map((item) => item.row.parseStatus)).toEqual([
      'missing_body',
      'invalid_json',
      'unknown_diagram_type',
      'parsed',
      'parsed',
    ]);
    const counts = countSnapshotRows(rows.map((item) => item.row));
    expect(counts).toEqual({
      total: 5,
      sequence: 0,
      graph: 0,
      openapi: 0,
      mermaid: 0,
      plantuml: 1,
      asyncapi: 1,
      unknown: 3,
    });
    expect(countsInvariant(counts)).toBe(true);
  });

  it('uses the content id as the logical-id fallback without exposing it as the hash salt', async () => {
    const row = await toPrivacySafeRow(
      content({ id: 'fallback-content-id', body: { raw: { value: JSON.stringify({ diagramType: 'mermaid' }) } } }),
      LITE_CUSTOM_CONTENT_TYPES[0],
      'tenant-scope',
    );
    expect(row.row.logicalIdHash).toBe(
      await sha256Hex('macro-count-v1\0tenant-scope\0fallback-content-id'),
    );
  });

  it('reports a dedicated failure when a tenant-wide result has no space id', async () => {
    await expect(toPrivacySafeRow(
      content({ spaceId: undefined }),
      LITE_CUSTOM_CONTENT_TYPES[0],
      'tenant',
    )).rejects.toMatchObject({ stage: 'scan', reason: 'missing_space_id' });
  });
});

describe('bounded JSON chunks', () => {
  it('splits by exact UTF-8 bytes and keeps every payload strictly below 400 KiB', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      value: '界'.repeat(15_000),
    }));
    const chunks = chunkJsonRows(rows, (part) => ({ schemaVersion: 1, rows: part }));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((chunk) => chunk.rows)).toEqual(rows);
    expect(chunks.every((chunk) => chunk.byteLength < SNAPSHOT_CHUNK_MAX_BYTES)).toBe(true);
  });

  it('rejects one row that cannot fit', () => {
    expect(() => chunkJsonRows(
      [{ value: 'x'.repeat(SNAPSHOT_CHUNK_MAX_BYTES) }],
      (rows) => ({ rows }),
    )).toThrow(SnapshotFailure);
  });
});

describe('cursor and retry mechanics', () => {
  it('extracts opaque cursors from either response-body next or the Link header', () => {
    expect(nextCursor({ _links: { next: '/wiki/api/v2/custom-content?cursor=a%2Bb' } })).toBe('a+b');
    expect(nextCursor(
      { _links: {} },
      '</wiki/api/v2/custom-content?cursor=next-2>; rel="next", </wiki/api/v2/custom-content>; rel="base"',
    )).toBe('next-2');
  });

  it('retries 429 and 5xx with a bound, then returns the valid page', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({}, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ results: [], _links: {} }));
    const sleep = vi.fn(async () => {});

    await expect(requestConfluenceJsonWithRetry(request, {
      stage: 'scan',
      sleep,
      now: () => 0,
    })).resolves.toMatchObject({ page: { results: [] } });
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('stops after four retryable failures and never retries a terminal 4xx', async () => {
    const unavailable = vi.fn(async () => response({}, 503));
    await expect(requestConfluenceJsonWithRetry(unavailable, {
      stage: 'scan',
      sleep: async () => {},
      now: () => 0,
    })).rejects.toMatchObject({ reason: 'confluence_5xx' });
    expect(unavailable).toHaveBeenCalledTimes(4);

    const forbidden = vi.fn(async () => response({}, 403));
    await expect(requestConfluenceJsonWithRetry(forbidden, {
      stage: 'scan',
      sleep: async () => {},
    })).rejects.toMatchObject({ reason: 'confluence_4xx' });
    expect(forbidden).toHaveBeenCalledTimes(1);
  });
});

describe('daily scanner protocol', () => {
  it('fully paginates both types, batches space keys, uploads safe chunks, and commits invariants', async () => {
    const harness = scannerHarness();
    const result = await runMacroCountSnapshot(harness.deps);

    expect(result).toEqual({
      status: 'completed',
      runId: 'run-1',
      spaceCount: 2,
      contentCount: 4,
      chunkCount: 5,
      counts: {
        total: 4,
        sequence: 1,
        graph: 1,
        openapi: 1,
        mermaid: 0,
        plantuml: 0,
        asyncapi: 0,
        unknown: 1,
      },
    });
    expect(harness.customCalls).toEqual([
      { type: LITE_CUSTOM_CONTENT_TYPES[0], cursor: undefined },
      { type: LITE_CUSTOM_CONTENT_TYPES[0], cursor: 'sequence-page-2' },
      { type: LITE_CUSTOM_CONTENT_TYPES[1], cursor: undefined },
    ]);
    expect(harness.spaceCalls).toEqual([{ ids: ['301', '302'], cursor: undefined }]);

    const contentUploads = harness.remoteCalls.filter((call) => (
      call.path.endsWith('/chunk') && call.body.kind === 'content'
    ));
    const safeRows = contentUploads.flatMap((call) => (
      (call.body.payload as { rows: Array<Record<string, unknown>> }).rows
    ));
    expect(safeRows).toHaveLength(4);
    expect(safeRows.every((row) => Object.keys(row).length === 9)).toBe(true);
    expect(JSON.stringify(safeRows)).not.toMatch(/title|authorId|body|raw|code|graphXml|account-secret/);

    const commit = harness.remoteCalls.find((call) => call.path.endsWith('/commit'))!;
    expect(commit.body).toMatchObject({
      expectedTypes: [...LITE_CUSTOM_CONTENT_TYPES],
      completedTypes: [...LITE_CUSTOM_CONTENT_TYPES],
      spaceCount: 2,
      contentCount: 4,
      chunkCount: 5,
      aggregateMetrics: { total: 4 },
    });
    expect(JSON.stringify(harness.remoteCalls)).not.toMatch(/"(?:domain|clientDomain|product|productType|cloudId)"/);
  });

  it.each([
    [{ eligible: false }, 'not_enrolled'],
    [{ eligible: true, duplicate: true, runId: 'existing' }, 'duplicate'],
  ] as const)('exits immediately for claim %j', async (claim, reason) => {
    const harness = scannerHarness({ claim: { ...claim } });
    await expect(runMacroCountSnapshot(harness.deps)).resolves.toEqual({ status: 'skipped', reason });
    expect(harness.remoteCalls).toHaveLength(1);
    expect(harness.customCalls).toHaveLength(0);
    expect(harness.spaceCalls).toHaveLength(0);
  });

  it('best-effort reports a failed claimed run without hiding the original error', async () => {
    const original = new SnapshotFailure('scan', 'confluence_4xx', 'forbidden');
    const harness = scannerHarness({
      requestCustomContent: vi.fn(async () => { throw original; }),
      failThrows: true,
    });

    await expect(runMacroCountSnapshot(harness.deps)).rejects.toBe(original);
    const fail = harness.remoteCalls.find((call) => call.path.endsWith('/fail'))!;
    expect(fail.body).toMatchObject({
      runId: 'run-1',
      failureStage: 'scan',
      failureReason: 'confluence_4xx',
      completedTypes: [],
      processedContents: 0,
    });
  });

  it('fails rather than committing when a space id cannot be resolved', async () => {
    const harness = scannerHarness({
      requestSpaces: vi.fn(async () => response({ results: [], _links: {} })),
    });
    await expect(runMacroCountSnapshot(harness.deps)).rejects.toMatchObject({
      stage: 'space_map',
      reason: 'unresolved_space_id',
    });
    expect(harness.remoteCalls.some((call) => call.path.endsWith('/commit'))).toBe(false);
    expect(harness.remoteCalls.some((call) => call.path.endsWith('/fail'))).toBe(true);
  });
});

describe('production Forge adapters', () => {
  beforeEach(() => {
    forgeMocks.requestConfluence.mockReset();
    forgeMocks.invokeRemote.mockReset();
  });

  it('uses asApp tenant V2 requests and backend invokeRemote(connect) without identity hints', async () => {
    forgeMocks.requestConfluence.mockResolvedValue(response({ results: [], _links: {} }));
    forgeMocks.invokeRemote.mockResolvedValue(response({ success: true }));
    const deps = createProductionDependencies();

    await deps.requestCustomContent(LITE_CUSTOM_CONTENT_TYPES[0], 'cursor-2');
    await deps.requestSpaces(['301', '302']);
    await deps.invokeRemote('/metrics-cache/snapshot/claim', {});

    expect(forgeMocks.requestConfluence.mock.calls[0][0]).toBe(
      `/wiki/api/v2/custom-content?type=${encodeURIComponent(LITE_CUSTOM_CONTENT_TYPES[0])}`
      + '&body-format=raw&limit=250&cursor=cursor-2',
    );
    expect(forgeMocks.requestConfluence.mock.calls[1][0]).toBe(
      '/wiki/api/v2/spaces?ids=301%2C302&limit=250',
    );
    expect(forgeMocks.invokeRemote).toHaveBeenCalledWith('connect', expect.objectContaining({
      path: '/metrics-cache/snapshot/claim',
      method: 'POST',
      body: '{}',
    }));
    expect(deps.tenantScope).toBe('installation-prod');
  });
});

describe('identity guard', () => {
  it('rejects nested client assertions for identity derived from FIT', () => {
    expect(() => assertNoClientIdentity({ payload: { cloudId: 'spoof' } })).toThrow(/cloudId/);
    expect(() => assertNoClientIdentity({ productType: 'lite' })).toThrow(/productType/);
    expect(() => assertNoClientIdentity({ runId: 'safe', type: 'custom-content-type' })).not.toThrow();
  });
});
