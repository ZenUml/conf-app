import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Issue #434 slice 1 (ADR-0004): when the attachment lookup comes back empty
// AND the macro is PlantUML, export.js renders server-side via the public
// PlantUML PNG server instead of failing with attachment_not_found.

const { asAppRequest, asUserRequest } = vi.hoisted(() => ({
  asAppRequest: vi.fn(),
  asUserRequest: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence: asUserRequest }),
    asApp: () => ({ requestConfluence: asAppRequest }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + String(values[i] ?? ''), ''),
}));

import { handler } from '../../src/export.js';

function mixpanelBodiesFromFetch(fetchMock: typeof fetch): unknown[] {
  const calls = vi.mocked(fetchMock).mock.calls;
  const rows: unknown[] = [];
  for (const call of calls) {
    const url = String(call[0]);
    if (!url.includes('mixpanel')) continue;
    const init = call[1] as RequestInit | undefined;
    const body = init?.body;
    if (typeof body !== 'string') continue;
    try {
      rows.push(...JSON.parse(body));
    } catch {
      // ignore
    }
  }
  return rows;
}

function emptyAttachmentsResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ results: [], _links: { base: 'https://acme.atlassian.net' } }),
  };
}

function customContentResponse(diagramType: string, extraFields: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      id: 'cc-1',
      body: {
        raw: {
          value: JSON.stringify({
            diagramType,
            plantUmlCode: 'Alice -> Bob: Hello',
            ...extraFields,
          }),
        },
      },
    }),
  };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function makePayload(customContentId: string, pageId = '111') {
  return {
    exportType: 'pdf',
    context: {
      cloudId: 'cloud-plantuml',
      siteUrl: 'https://acme.atlassian.net',
      spaceKey: 'SP',
      accountId: 'acc-1',
      extension: { content: { id: pageId } },
    },
    extensionPayload: {
      config: { customContentId },
    },
  };
}

describe('Forge export resolver — PlantUML server-side render fallback (src/export.js)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.MIXPANEL_TOKEN = 'unit-test-token';
    asAppRequest.mockReset();
    asUserRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MIXPANEL_TOKEN;
  });

  it('renders a PlantUML PNG server-side when no attachment exists (criterion 1)', async () => {
    asAppRequest.mockImplementation(async (url: string) => {
      if (url.includes('/attachments')) return emptyAttachmentsResponse();
      if (url.includes('/custom-content/')) return customContentResponse('plantuml');
      throw new Error(`unexpected asApp() call: ${url}`);
    });

    fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('mixpanel')) return { ok: true, status: 200, text: async () => '' };
      if (u.includes('plantuml.com')) {
        return {
          ok: true,
          status: 200,
          blob: async () => ({ type: 'image/png', size: PNG_BYTES.length }),
        };
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handler(makePayload('cc-plantuml-1'));

    // No longer the old attachment_not_found error document.
    expect(JSON.stringify(result)).not.toContain('not yet generated');
    // The ADF doc embeds a media node pointing at the PlantUML server render.
    expect(JSON.stringify(result)).toContain('plantuml.com/plantuml/png/');

    const rows = mixpanelBodiesFromFetch(fetchMock) as Array<{
      event?: string;
      properties?: { render_source?: string; failure_reason?: string };
    }>;
    expect(rows.find((r) => r.event === 'macro_export_failed')).toBeUndefined();
    const succeeded = rows.find((r) => r.event === 'macro_export_succeeded');
    expect(succeeded?.properties?.render_source).toBe('server_render_plantuml');

    // The macro_type resolver (#435) and this render path both need the same
    // custom-content body. They were built independently and each fetched it,
    // so an export issued two identical GETs; the handler now reads it once and
    // shares it. Exactly one, asserted here so the duplication cannot return.
    const customContentCalls = asAppRequest.mock.calls.filter(([url]: [string]) =>
      String(url).includes('/custom-content/'),
    );
    expect(customContentCalls).toHaveLength(1);
  });

  it('leaves non-PlantUML types on the old attachment_not_found path unchanged (criterion 2)', async () => {
    asAppRequest.mockImplementation(async (url: string) => {
      if (url.includes('/attachments')) return emptyAttachmentsResponse();
      if (url.includes('/custom-content/')) return customContentResponse('mermaid');
      throw new Error(`unexpected asApp() call: ${url}`);
    });

    fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('mixpanel')) return { ok: true, status: 200, text: async () => '' };
      throw new Error(`unexpected fetch (mermaid must never call plantuml.com): ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handler(makePayload('cc-mermaid-1'));

    expect(JSON.stringify(result)).toContain('not yet generated');

    const rows = mixpanelBodiesFromFetch(fetchMock) as Array<{
      event?: string;
      properties?: { failure_reason?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('attachment_not_found');
    expect(rows.find((r) => r.event === 'macro_export_succeeded')).toBeUndefined();
  });

  it('records a distinct failure event (does not silently swallow) when the PlantUML server fetch fails (criterion 3)', async () => {
    asAppRequest.mockImplementation(async (url: string) => {
      if (url.includes('/attachments')) return emptyAttachmentsResponse();
      if (url.includes('/custom-content/')) return customContentResponse('plantuml');
      throw new Error(`unexpected asApp() call: ${url}`);
    });

    fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('mixpanel')) return { ok: true, status: 200, text: async () => '' };
      if (u.includes('plantuml.com')) return { ok: false, status: 503 };
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handler(makePayload('cc-plantuml-fail'));

    // Falls back to the original attachment_not_found error document — never a silent success.
    expect(JSON.stringify(result)).toContain('not yet generated');

    const rows = mixpanelBodiesFromFetch(fetchMock) as Array<{
      event?: string;
      properties?: { failure_reason?: string; plantuml_server_http_status?: number };
    }>;
    const failed = rows.find(
      (r) => r.event === 'macro_export_failed' && r.properties?.failure_reason === 'plantuml_server_render_failed',
    );
    expect(failed).toBeDefined();
    expect(failed?.properties?.plantuml_server_http_status).toBe(503);
    expect(rows.find((r) => r.event === 'macro_export_succeeded')).toBeUndefined();
  });
});
