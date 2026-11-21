import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { asAppRequest } = vi.hoisted(() => ({ asAppRequest: vi.fn() }));

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence: vi.fn() }),
    asApp: () => ({ requestConfluence: asAppRequest }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + String(values[i] ?? ''), ''),
}));

import { handler } from '../../src/asyncapi-export.js';

function mixpanelBodiesFromFetch(fetchMock: typeof fetch): unknown[] {
  const rows: unknown[] = [];
  for (const call of vi.mocked(fetchMock).mock.calls) {
    const body = (call[1] as RequestInit | undefined)?.body;
    if (typeof body !== 'string') continue;
    try {
      rows.push(...JSON.parse(body));
    } catch {
      // ignore
    }
  }
  return rows;
}

const customContentResponse = (raw: unknown, title = 'My API') => ({
  ok: true,
  status: 200,
  text: async () => '',
  json: async () => ({ title, body: { raw: { value: typeof raw === 'string' ? raw : JSON.stringify(raw) } } }),
});

const basePayload = (customContentId: string | null) => ({
  exportType: 'pdf',
  context: {
    cloudId: 'cloud-aa',
    siteUrl: 'https://acme.atlassian.net',
    spaceKey: 'SP',
    accountId: 'acc-aa',
    extension: { content: { id: '999' } },
  },
  extensionPayload: { config: { customContentId } },
});

describe('AsyncAPI export resolver (src/asyncapi-export.js)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })));
    process.env.MIXPANEL_TOKEN = 'unit-test-token';
    // These specs assert on the CONTENT of the emitted events, so the quota
    // sampling in src/lib/exportSampling.js must not decide whether they run.
    // A draw of 0 is below every configured rate, so every event is kept; the
    // drop path has its own coverage in tests/unit/exportSampling.spec.ts.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    asAppRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MIXPANEL_TOKEN;
  });

  it('embeds the spec as a YAML code block when the AsyncAPI content is found', async () => {
    asAppRequest.mockResolvedValue(
      customContentResponse(
        { diagramType: 'AsyncAPI', title: 'Streetlights API', code: 'asyncapi: 3.0.0\ninfo:\n  title: Streetlights' },
        'Streetlights API',
      ),
    );

    const result = await handler(basePayload('cc-asyncapi'));

    // Fetched the custom content directly — no attachments lookup.
    expect(asAppRequest).toHaveBeenCalledTimes(1);
    expect(String(asAppRequest.mock.calls[0][0])).toContain('/custom-content/cc-asyncapi');
    const json = JSON.stringify(result);
    expect(json).toContain('codeBlock');
    expect(json).toContain('asyncapi: 3.0.0');
    expect(json).toContain('Streetlights API');

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { export_path?: string; macro_type?: string };
    }>;
    const succeeded = rows.find((r) => r.event === 'macro_export_succeeded');
    expect(succeeded?.properties?.export_path).toBe('asyncapi_spec');
    // #435: statically known — this handler only ever exports AsyncAPI macros.
    expect(succeeded?.properties?.macro_type).toBe('asyncapi');
    expect(rows.find((r) => r.event === 'macro_export_requested')?.properties?.macro_type).toBe('asyncapi');
  });

  it('returns an error doc (not the spec) when the content has no code', async () => {
    asAppRequest.mockResolvedValue(customContentResponse({ diagramType: 'AsyncAPI', title: 'Empty', code: '' }));

    const result = await handler(basePayload('cc-empty'));

    expect(JSON.stringify(result)).toContain('not available for export');
    const rows = mixpanelBodiesFromFetch(fetch) as Array<{ event?: string; properties?: { failure_reason?: string } }>;
    expect(rows.find((r) => r.event === 'macro_export_failed')?.properties?.failure_reason).toBe('asyncapi_spec_unavailable');
  });

  it('returns an error doc when the custom-content lookup 404s', async () => {
    asAppRequest.mockResolvedValue({ ok: false, status: 404, text: async () => '' });

    const result = await handler(basePayload('cc-404'));

    expect(JSON.stringify(result)).toContain('not available for export');
    const rows = mixpanelBodiesFromFetch(fetch) as Array<{ event?: string; properties?: { failure_reason?: string } }>;
    expect(rows.find((r) => r.event === 'macro_export_failed')?.properties?.failure_reason).toBe('asyncapi_spec_unavailable');
  });

  it('returns an error doc and tracks missing_custom_content_id when there is no customContentId', async () => {
    const result = await handler(basePayload(null));

    expect(asAppRequest).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain('not available for export');
    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; macro_type?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('missing_custom_content_id');
    // #435: even the no-customContentId failure carries macro_type='asyncapi'
    // — known statically from which handler ran, unlike the shared exportMacro
    // where the same failure resolves to 'none' (type genuinely unknown there).
    expect(failed?.properties?.macro_type).toBe('asyncapi');
  });

  it('carries a bounded failure_kind (and the status when a request returned one)', async () => {
    const kindOf = () => (mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_kind?: string; http_status?: number };
    }>).find((r) => r.event === 'macro_export_failed')?.properties;

    await handler(basePayload(null));
    expect(kindOf()?.failure_kind).toBe('no_content_id');
    expect(kindOf()?.http_status).toBeUndefined();
  });

  it('spec lookup 404 -> failure_kind spec_lookup_http_error with http_status 404', async () => {
    asAppRequest.mockResolvedValue({ ok: false, status: 404, text: async () => '' });
    await handler(basePayload('cc-404k'));
    const p = (mixpanelBodiesFromFetch(fetch) as Array<{ event?: string; properties?: { failure_kind?: string; http_status?: number } }>)
      .find((r) => r.event === 'macro_export_failed')?.properties;
    expect(p?.failure_kind).toBe('spec_lookup_http_error');
    expect(p?.http_status).toBe(404);
  });

  it('empty code -> failure_kind spec_unusable', async () => {
    asAppRequest.mockResolvedValue(customContentResponse({ diagramType: 'AsyncAPI', title: 'Empty', code: '' }));
    await handler(basePayload('cc-emptyk'));
    const p = (mixpanelBodiesFromFetch(fetch) as Array<{ event?: string; properties?: { failure_kind?: string; http_status?: number } }>)
      .find((r) => r.event === 'macro_export_failed')?.properties;
    expect(p?.failure_kind).toBe('spec_unusable');
  });
});
