import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  assembleBundle,
  buildFilename,
  collectEditorContent,
  collectIdentity,
  extractActiveField,
  fetchContentHistory,
  type DebugBundleDeps,
  type IdentitySection,
  type SavedVersion,
} from './debugBundle';

import { DiagramType } from '@/model/Diagram/Diagram';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function body(diagramType: DiagramType, fields: Record<string, unknown>) {
  return { raw: { value: JSON.stringify({ diagramType, ...fields }) } };
}

function fixedIdentity(): IdentitySection {
  return {
    cloudId: 'c-1',
    hostname: 'example.atlassian.net',
    clientDomain: 'example',
    pageId: '1234567890',
    customContentId: 'abcdef123456',
    macroUuid: 'uuid-1',
    diagramType: DiagramType.Sequence,
    productType: 'lite',
    environmentType: 'PRODUCTION',
    appVersion: { gitHash: 'abc', gitBranch: 'main', gitTag: '' },
    userAgent: 'jsdom',
    viewport: { w: 1024, h: 768 },
  };
}

beforeEach(() => {
  // collectIdentity reads window.forgeGlobal. Default to a populated shape.
  (window as any).forgeGlobal = {
    forgeContext: {
      cloudId: 'cloud-A',
      environmentType: 'PRODUCTION',
      extension: { content: { id: 'page-99' } },
    },
  };
  Object.defineProperty(window, 'location', {
    value: { hostname: 'example.atlassian.net' },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  delete (window as any).forgeGlobal;
});

// ---------------------------------------------------------------------------
// extractActiveField — per diagramType
// ---------------------------------------------------------------------------

describe('extractActiveField', () => {
  it('extracts graphXml for graph', () => {
    const b = body(DiagramType.Graph, { graphXml: '<mxfile/>' });
    expect(extractActiveField(b, DiagramType.Graph)).toBe('<mxfile/>');
  });

  it('extracts mermaidCode for mermaid', () => {
    const b = body(DiagramType.Mermaid, { mermaidCode: 'graph LR\n  A-->B' });
    expect(extractActiveField(b, DiagramType.Mermaid)).toBe('graph LR\n  A-->B');
  });

  it('extracts code for sequence', () => {
    const b = body(DiagramType.Sequence, { code: 'A->B: hi' });
    expect(extractActiveField(b, DiagramType.Sequence)).toBe('A->B: hi');
  });

  it('extracts code for openapi (same dataField key, distinguished by diagramType)', () => {
    const b = body(DiagramType.OpenApi, { code: 'openapi: 3.0.0' });
    expect(extractActiveField(b, DiagramType.OpenApi)).toBe('openapi: 3.0.0');
  });

  it('returns null when body.raw.value is not a string', () => {
    expect(extractActiveField({ raw: {} }, DiagramType.Sequence)).toBeNull();
    expect(extractActiveField({}, DiagramType.Sequence)).toBeNull();
    expect(extractActiveField(null, DiagramType.Sequence)).toBeNull();
  });

  it('returns null when body.raw.value is malformed JSON', () => {
    expect(extractActiveField({ raw: { value: 'not json' } }, DiagramType.Sequence)).toBeNull();
  });

  it('returns empty string when the dataField is missing (does not throw)', () => {
    const b = body(DiagramType.Sequence, {});
    expect(extractActiveField(b, DiagramType.Sequence)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// collectEditorContent
// ---------------------------------------------------------------------------

describe('collectEditorContent', () => {
  it('reports byte length + sha256 for ASCII content', async () => {
    const out = await collectEditorContent(DiagramType.Sequence, 'A->B: hi');
    expect(out.active).toBe('A->B: hi');
    expect(out.byteLength).toBe(8);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('counts UTF-8 bytes for non-ASCII content (not character count)', async () => {
    // 4 Chinese characters = 12 bytes in UTF-8, not 4.
    const out = await collectEditorContent(DiagramType.Mermaid, '系統流程');
    expect(out.byteLength).toBe(12);
    expect(out.active).toBe('系統流程');
  });

  it('produces a stable sha256 for an empty active string', async () => {
    const out = await collectEditorContent(DiagramType.Sequence, '');
    expect(out.byteLength).toBe(0);
    // SHA-256 of "" is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(out.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

// ---------------------------------------------------------------------------
// collectIdentity
// ---------------------------------------------------------------------------

describe('collectIdentity', () => {
  const deps = {
    getCustomContentId: async () => 'cc-12345678',
    getMacroUuid:       async () => 'macro-uuid-1',
  };

  it('reads forgeGlobal + window into a complete identity section', async () => {
    const id = await collectIdentity(DiagramType.Sequence, deps);
    expect(id.cloudId).toBe('cloud-A');
    expect(id.hostname).toBe('example.atlassian.net');
    expect(id.clientDomain).toBe('example');
    expect(id.pageId).toBe('page-99');
    expect(id.customContentId).toBe('cc-12345678');
    expect(id.macroUuid).toBe('macro-uuid-1');
    expect(id.environmentType).toBe('PRODUCTION');
    expect(id.diagramType).toBe(DiagramType.Sequence);
  });

  it('tolerates missing forgeGlobal (sets nulls, does not throw)', async () => {
    delete (window as any).forgeGlobal;
    const id = await collectIdentity(DiagramType.Mermaid, deps);
    expect(id.cloudId).toBeNull();
    expect(id.pageId).toBeNull();
    expect(id.environmentType).toBeNull();
    expect(id.diagramType).toBe(DiagramType.Mermaid);
  });

  it('returns nulls when getCustomContentId / getMacroUuid throw', async () => {
    const flaky = {
      getCustomContentId: async () => { throw new Error('boom'); },
      getMacroUuid:       async () => { throw new Error('boom'); },
    };
    const id = await collectIdentity(DiagramType.Graph, flaky);
    expect(id.customContentId).toBeNull();
    expect(id.macroUuid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchContentHistory
// ---------------------------------------------------------------------------

describe('fetchContentHistory', () => {
  function mockRequest(map: Record<string, any>): DebugBundleDeps['apRequest'] {
    return async (url: string) => {
      if (url in map) return map[url];
      const err: any = new Error(`404 not found: ${url}`);
      throw err;
    };
  }

  it('returns latest + previous 3 on happy path with v=5', async () => {
    const head = {
      version: { number: 5, createdAt: '2026-05-20T08:00:00Z' },
      body: body(DiagramType.Sequence, { code: 'v5' }),
    };
    const v4 = { version: { number: 4, createdAt: '2026-05-19T08:00:00Z' }, body: body(DiagramType.Sequence, { code: 'v4' }) };
    const v3 = { version: { number: 3, createdAt: '2026-05-18T08:00:00Z' }, body: body(DiagramType.Sequence, { code: 'v3' }) };
    const v2 = { version: { number: 2, createdAt: '2026-05-17T08:00:00Z' }, body: body(DiagramType.Sequence, { code: 'v2' }) };
    const apRequest = mockRequest({
      '/api/v2/custom-content/cc-1?body-format=raw': head,
      '/api/v2/custom-content/cc-1?version=4&body-format=raw': v4,
      '/api/v2/custom-content/cc-1?version=3&body-format=raw': v3,
      '/api/v2/custom-content/cc-1?version=2&body-format=raw': v2,
    });
    const out = await fetchContentHistory('cc-1', DiagramType.Sequence, 4, { apRequest });
    expect(out.latest?.versionNumber).toBe(5);
    expect(out.latest?.active).toBe('v5');
    expect(out.previous.map(p => p.versionNumber)).toEqual([4, 3, 2]);
    expect(out.previous.map(p => p.active)).toEqual(['v4', 'v3', 'v2']);
    expect(out.errors).toEqual([]);
  });

  it('clamps previous list when fewer prior versions exist (latest=2 → previous=[1])', async () => {
    const apRequest = mockRequest({
      '/api/v2/custom-content/cc-2?body-format=raw': {
        version: { number: 2, createdAt: 'now' },
        body: body(DiagramType.Mermaid, { mermaidCode: 'top' }),
      },
      '/api/v2/custom-content/cc-2?version=1&body-format=raw': {
        version: { number: 1, createdAt: 'then' },
        body: body(DiagramType.Mermaid, { mermaidCode: 'old' }),
      },
    });
    const out = await fetchContentHistory('cc-2', DiagramType.Mermaid, 4, { apRequest });
    expect(out.latest?.versionNumber).toBe(2);
    expect(out.previous.map(p => p.versionNumber)).toEqual([1]);
    expect(out.errors).toEqual([]);
  });

  it('records per-version errors and still returns the rest of the bundle', async () => {
    const apRequest = mockRequest({
      '/api/v2/custom-content/cc-3?body-format=raw': {
        version: { number: 3, createdAt: 'now' },
        body: body(DiagramType.Sequence, { code: 'v3' }),
      },
      '/api/v2/custom-content/cc-3?version=2&body-format=raw': {
        version: { number: 2, createdAt: 'then' },
        body: body(DiagramType.Sequence, { code: 'v2' }),
      },
      // v=1 is intentionally absent — should produce an error entry
    });
    const out = await fetchContentHistory('cc-3', DiagramType.Sequence, 4, { apRequest });
    expect(out.latest?.versionNumber).toBe(3);
    expect(out.previous.map(p => p.versionNumber)).toEqual([2]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].section).toBe('saved.previous[1]');
  });

  it('records a top-level error when the head request fails', async () => {
    const apRequest = mockRequest({});
    const out = await fetchContentHistory('missing', DiagramType.Sequence, 4, { apRequest });
    expect(out.latest).toBeNull();
    expect(out.previous).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].section).toBe('saved.latest');
  });
});

// ---------------------------------------------------------------------------
// assembleBundle + filename
// ---------------------------------------------------------------------------

describe('assembleBundle', () => {
  it('folds history.errors into bundle.errors and stamps capturedAt', () => {
    const editor = { active: 'A->B', byteLength: 4, sha256: 'x'.repeat(64) };
    const previous: SavedVersion[] = [];
    const errors = [{ section: 'saved.previous[2]', message: '404' }];
    const bundle = assembleBundle({
      identity: fixedIdentity(),
      editor,
      history: { latest: null, previous, errors },
      now: new Date('2026-05-20T08:12:33.142Z'),
    });
    expect(bundle.bundleVersion).toBe(1);
    expect(bundle.capturedAt).toBe('2026-05-20T08:12:33.142Z');
    expect(bundle.errors).toEqual(errors);
    expect(bundle.saved.latest).toBeNull();
  });
});

describe('buildFilename', () => {
  it('matches the documented pattern with short customContentId and UTC stamp', () => {
    const filename = buildFilename(fixedIdentity(), new Date('2026-05-20T08:12:33Z'));
    expect(filename).toBe('zenuml-debug-1234567890-123456-20260520-081233.json');
  });

  it("falls back to 'new' when there's no customContentId", () => {
    const id = { ...fixedIdentity(), customContentId: null };
    const filename = buildFilename(id, new Date('2026-05-20T08:12:33Z'));
    expect(filename).toMatch(/^zenuml-debug-1234567890-new-\d{8}-\d{6}\.json$/);
  });

  it("falls back to 'unknown' when there's no pageId", () => {
    const id = { ...fixedIdentity(), pageId: null };
    const filename = buildFilename(id, new Date('2026-05-20T08:12:33Z'));
    expect(filename).toMatch(/^zenuml-debug-unknown-123456-\d{8}-\d{6}\.json$/);
  });
});
