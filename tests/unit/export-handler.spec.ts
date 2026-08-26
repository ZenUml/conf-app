import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// MockRoute mirrors @forge/api's real ReadonlyRoute brand: `route`/
// `routeFromAbsolute` return this object, NEVER a plain string. The real
// `requestConfluence` throws "You must create your route using the 'route'
// export from '@forge/api'" for anything that isn't this branded type — that
// is verbatim the production error this file's fix addresses (fetchPngDimensions
// in src/export.js was building `${linksBase}${downloadLink}` as a bare
// template-string URL instead of routing it).
//
// Before this fix, this mock's `route` returned a plain string too, and there
// was no `routeFromAbsolute` mock at all — so a call passing a bare string
// URL and a call passing a properly-tagged route were indistinguishable here.
// That is why the existing tests (e.g. the exact-string assertion this file
// used to make against the Range-request URL) passed against code that threw
// in production: the mock accepted whatever shape it was given. Branding the
// mock's return value the same way the SDK does closes that gap.
const { asAppRequest, asUserRequest, MockRoute } = vi.hoisted(() => {
  class MockRoute {
    readonly value: string;
    constructor(value: string) {
      this.value = value;
    }
    toString() {
      return this.value;
    }
  }
  return {
    asAppRequest: vi.fn(),
    asUserRequest: vi.fn(),
    MockRoute,
  };
});

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence: asUserRequest }),
    asApp: () => ({ requestConfluence: asAppRequest }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    new MockRoute(strings.reduce((acc, s, i) => acc + s + String(values[i] ?? ''), '')),
  // Real routeFromAbsolute (safeUrl.ts) does exactly this: parse the absolute
  // URL and keep only pathname+search, wrapped in the same Route brand as
  // `route`. Anything that reaches requestConfluence NOT wrapped this way
  // (e.g. a bare `${base}${path}` string) is the bug under test.
  routeFromAbsolute: (absoluteUrl: string) => {
    const u = new URL(absoluteUrl);
    return new MockRoute(`${u.pathname}${u.search}`);
  },
}));

import { handler } from '../../src/export.js';

function mixpanelBodiesFromFetch(fetchMock: typeof fetch): unknown[] {
  const calls = vi.mocked(fetchMock).mock.calls;
  const rows: unknown[] = [];
  for (const call of calls) {
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

describe('Forge export resolver (src/export.js)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '',
      })),
    );
    process.env.MIXPANEL_TOKEN = 'unit-test-token';
    // These specs assert on the CONTENT of the emitted events, so the quota
    // sampling in src/lib/exportSampling.js must not decide whether they run.
    // A draw of 0 is below every configured rate, so every event is kept; the
    // drop path has its own coverage in tests/unit/exportSampling.spec.ts.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    asAppRequest.mockReset();
    asUserRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MIXPANEL_TOKEN;
  });

  it('includes custom_content_id on macro_export_failed when catch runs (Word config path)', async () => {
    asAppRequest.mockRejectedValue(new Error('forced attachments failure'));

    const payload = {
      exportType: 'word',
      context: {
        cloudId: 'cloud-x',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SPACE',
        accountId: '557058:acc',
        content: { id: '111' },
        config: { customContentId: 'cc-word-export' },
      },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; custom_content_id?: string; error_name?: string; error_message?: string; error_stack?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.custom_content_id).toBe('cc-word-export');
    expect(failed?.properties?.failure_reason).toBe('unexpected_error:Error');
    expect(failed?.properties?.error_name).toBe('Error');
    expect(failed?.properties?.error_message).toBe('forced attachments failure');
    expect(failed?.properties?.error_stack).toContain('forced attachments failure');
  });

  it('includes custom_content_id on macro_export_failed when catch runs (PDF extensionPayload path)', async () => {
    asAppRequest.mockRejectedValue(new Error('forced attachments failure'));

    const payload = {
      context: {
        cloudId: 'cloud-y',
        siteUrl: 'https://acme.atlassian.net/wiki',
        spaceKey: 'SK',
        accountId: 'acc-2',
        extension: { content: { id: '222' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-pdf-export' },
      },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; custom_content_id?: string; error_name?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.custom_content_id).toBe('cc-pdf-export');
    expect(failed?.properties?.error_name).toBe('Error');
  });

  it('classifies NEEDS_AUTHENTICATION_ERR as needs_authentication', async () => {
    const authErr = Object.assign(new Error('Authentication Required'), {
      name: 'NEEDS_AUTHENTICATION_ERR',
      status: 401,
    });
    asAppRequest.mockRejectedValue(authErr);

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-z',
        siteUrl: 'https://example.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-3',
        extension: { content: { id: '333' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-auth-test' },
      },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; error_name?: string; error_stack?: string; http_status?: number };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('needs_authentication');
    expect(failed?.properties?.error_name).toBe('NEEDS_AUTHENTICATION_ERR');
    expect(failed?.properties?.http_status).toBe(401);
    expect(failed?.properties?.error_stack).toBeUndefined();
  });

  it('tracks macro_export_succeeded with custom_content_id when PDF export completes (extensionPayload path)', async () => {
    asAppRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        results: [{ fileId: 'file-zenuml-cc-pdf-ok', downloadLink: '/wiki/download/attachments/222/zenuml-cc-pdf-ok.png' }],
        _links: { base: 'https://acme.atlassian.net' },
      }),
    });

    const payload = {
      context: {
        cloudId: 'cloud-y',
        siteUrl: 'https://acme.atlassian.net/wiki',
        spaceKey: 'SK',
        accountId: 'acc-2',
        extension: { content: { id: '222' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-pdf-ok' },
      },
    };

    const result = await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { custom_content_id?: string };
    }>;
    const succeeded = rows.find((r) => r.event === 'macro_export_succeeded');
    expect(succeeded?.properties?.custom_content_id).toBe('cc-pdf-ok');

    expect(JSON.stringify(result)).toContain('file-zenuml-cc-pdf-ok');
  });

  // Scroll PDF Exporter (K15t) renders the ADF we return outside the Confluence
  // page context. A media node of type "external" pointing at the attachment
  // download endpoint needs a Confluence session, so that renderer got 404 and
  // dropped the image (reproduced 2026-08-19, docs/debugging/scroll-pdf-export.md).
  // A native file media node is resolved by the exporter with its own credentials.
  it('returns a native file media node carrying fileId and the page collection', async () => {
    asAppRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        results: [
          {
            fileId: 'file-uuid-1',
            downloadLink: '/wiki/download/attachments/777/zenuml-cc-media.png',
          },
        ],
        _links: { base: 'https://acme.atlassian.net' },
      }),
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-media',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SK',
        accountId: 'acc-media',
        extension: { content: { id: '777' } },
      },
      extensionPayload: { config: { customContentId: 'cc-media' } },
    };

    const result = (await handler(payload)) as {
      content: Array<{ content: Array<{ attrs: Record<string, string> }> }>;
    };

    // This fixture's response has no `arrayBuffer`, so the PNG-dimensions
    // Range read (fetchPngDimensions) fails and falls back to the
    // pre-existing mediaSingle-only 760px hint — see the two tests below for
    // the path where dimensions ARE read successfully.
    expect(result.content[0].content[0].attrs).toEqual({
      type: 'file',
      id: 'file-uuid-1',
      collection: 'contentId-777',
    });
    expect((result as unknown as { content: Array<{ attrs: Record<string, unknown> }> }).content[0].attrs).toEqual({
      layout: 'center',
      width: 760,
      widthType: 'pixel',
    });
    expect(JSON.stringify(result)).not.toContain('download');
  });

  // Placement-width regression (docs/debugging/export-image-size.md): the file
  // media node is sized from the media file's own metadata, not from
  // mediaSingle's width hint alone (measured on lite-stg 2026-08-19: 5.38in
  // with a mediaSingle width hint vs 6.68in for the old external-url node).
  // Declaring the image's own intrinsic width/height directly on the media
  // node is the candidate fix — read via a byte-Range request for the PNG's
  // IHDR chunk (src/lib/pngDimensions.ts), not a full download.
  it('declares the media node\'s own intrinsic width/height from the PNG header', async () => {
    const pngHeader = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHeader, 0);
    pngHeader.writeUInt32BE(13, 8);
    pngHeader.write('IHDR', 12, 'ascii');
    pngHeader.writeUInt32BE(1516, 16);
    pngHeader.writeUInt32BE(598, 20);

    asAppRequest.mockImplementation(async (url: unknown, opts?: { headers?: Record<string, string> }) => {
      if (opts?.headers?.Range) {
        // The load-bearing assertion for this fix: requestConfluence must
        // receive a Route (route()/routeFromAbsolute()'s branded return
        // value), never a plain string. Pre-fix, fetchPngDimensions built
        // `${linksBase}${downloadLink}` as a bare template-string URL and
        // passed THAT — a plain string, which fails this instanceof check —
        // and would throw in the real @forge/api SDK with "You must create
        // your route using the 'route' export from '@forge/api'". A mock
        // that merely accepted "any argument" (as this test's `route` mock
        // used to, by returning a string itself) could not see the
        // difference; asserting the branded type is what makes this test
        // fail against the pre-fix code.
        expect(url).toBeInstanceOf(MockRoute);
        expect(String(url)).toBe('/wiki/download/attachments/779/zenuml-cc-sized.png');
        expect(opts.headers.Range).toBe('bytes=0-31');
        return {
          ok: true,
          status: 206,
          arrayBuffer: async () => pngHeader.buffer.slice(pngHeader.byteOffset, pngHeader.byteOffset + pngHeader.byteLength),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          results: [{ fileId: 'file-uuid-sized', downloadLink: '/wiki/download/attachments/779/zenuml-cc-sized.png' }],
          _links: { base: 'https://acme.atlassian.net' },
        }),
      };
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-sized',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SK',
        accountId: 'acc-sized',
        extension: { content: { id: '779' } },
      },
      extensionPayload: { config: { customContentId: 'cc-sized' } },
    };

    const result = (await handler(payload)) as {
      content: Array<{ attrs: Record<string, unknown>; content: Array<{ attrs: Record<string, unknown> }> }>;
    };

    expect(result.content[0].content[0].attrs).toEqual({
      type: 'file',
      id: 'file-uuid-sized',
      collection: 'contentId-779',
      width: 1516,
      height: 598,
    });
    expect(result.content[0].attrs).toEqual({ layout: 'center', width: 1516, widthType: 'pixel' });

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { media_width_px?: number; media_height_px?: number };
    }>;
    const succeeded = rows.find((r) => r.event === 'macro_export_succeeded');
    expect(succeeded?.properties?.media_width_px).toBe(1516);
    expect(succeeded?.properties?.media_height_px).toBe(598);
  });

  it('requests only a byte range for the PNG header, not the whole attachment', async () => {
    let sawFullDownload = false;
    asAppRequest.mockImplementation(async (url: string, opts?: { headers?: Record<string, string> }) => {
      if (opts?.headers?.Range) {
        return {
          ok: true,
          status: 206,
          arrayBuffer: async () => {
            const buf = Buffer.alloc(32);
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
            buf.writeUInt32BE(13, 8);
            buf.write('IHDR', 12, 'ascii');
            buf.writeUInt32BE(300, 16);
            buf.writeUInt32BE(150, 20);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          },
        };
      }
      if (String(url).includes('/download/attachments/')) {
        sawFullDownload = true;
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          results: [{ fileId: 'file-uuid-range', downloadLink: '/wiki/download/attachments/780/zenuml-cc-range.png' }],
          _links: { base: 'https://acme.atlassian.net' },
        }),
      };
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-range',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SK',
        accountId: 'acc-range',
        extension: { content: { id: '780' } },
      },
      extensionPayload: { config: { customContentId: 'cc-range' } },
    };

    await handler(payload);

    expect(sawFullDownload).toBe(false);
    const rangedCalls = asAppRequest.mock.calls.filter(([, opts]: [string, { headers?: Record<string, string> } | undefined]) => opts?.headers?.Range);
    expect(rangedCalls).toHaveLength(1);
  });

  it('falls back to the 760px mediaSingle-only hint, without media-level width/height, when the header bytes are not a valid PNG', async () => {
    asAppRequest.mockImplementation(async (url: string, opts?: { headers?: Record<string, string> }) => {
      if (opts?.headers?.Range) {
        return { ok: true, status: 206, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          results: [{ fileId: 'file-uuid-bad', downloadLink: '/wiki/download/attachments/781/zenuml-cc-bad.png' }],
          _links: { base: 'https://acme.atlassian.net' },
        }),
      };
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-bad',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SK',
        accountId: 'acc-bad',
        extension: { content: { id: '781' } },
      },
      extensionPayload: { config: { customContentId: 'cc-bad' } },
    };

    const result = (await handler(payload)) as {
      content: Array<{ attrs: Record<string, unknown>; content: Array<{ attrs: Record<string, unknown> }> }>;
    };

    expect(result.content[0].attrs).toEqual({ layout: 'center', width: 760, widthType: 'pixel' });
    expect(result.content[0].content[0].attrs.width).toBeUndefined();
    expect(result.content[0].content[0].attrs.height).toBeUndefined();
  });

  it('reports missing_file_id when the attachment carries no fileId', async () => {
    asAppRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        results: [{ downloadLink: '/wiki/download/attachments/778/no-file-id.png' }],
        _links: { base: 'https://acme.atlassian.net' },
      }),
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-nofile',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SK',
        accountId: 'acc-nofile',
        extension: { content: { id: '778' } },
      },
      extensionPayload: { config: { customContentId: 'cc-nofile' } },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('missing_file_id');
  });

  it('falls back to asUser() when asApp() returns 404 and succeeds, with fallback telemetry', async () => {
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"errors":[{"status":404,"code":"NOT_FOUND"}]}',
    });
    asUserRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        results: [{ fileId: 'file-zenuml-cc-fallback', downloadLink: '/wiki/download/attachments/444/zenuml-cc-fallback.png' }],
        _links: { base: 'https://acme.atlassian.net' },
      }),
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-fb',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-fb',
        extension: { content: { id: '444' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-fallback' },
      },
    };

    const result = await handler(payload);

    // 1 asApp() call: the attachments GET that 404s and triggers the asUser()
    // fallback below. The asUser() retry then SUCCEEDS, so this is a success
    // path and no custom-content read happens — the count dropped from 2 when
    // that read moved off the success path.
    //
    // asUserRequest is called TWICE: the attachments lookup, then the
    // PNG-dimensions Range request — which reuses asUser() rather than
    // asApp(), since asUser() is the identity that could actually read this
    // page (see fetchPngDimensions' `usedAsUser` param in src/export.js).
    expect(asAppRequest).toHaveBeenCalledTimes(1);
    expect(asUserRequest).toHaveBeenCalledTimes(2);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: {
        custom_content_id?: string;
        used_asuser_fallback?: boolean;
        fallback_http_status?: number;
        fallback_error_name?: string;
      };
    }>;
    const succeeded = rows.find((r) => r.event === 'macro_export_succeeded');
    expect(succeeded?.properties?.custom_content_id).toBe('cc-fallback');
    expect(succeeded?.properties?.used_asuser_fallback).toBe(true);
    expect(succeeded?.properties?.fallback_http_status).toBe(200);
    expect(succeeded?.properties?.fallback_error_name).toBeUndefined();
    expect(rows.find((r) => r.event === 'macro_export_failed')).toBeUndefined();

    expect(JSON.stringify(result)).toContain('file-zenuml-cc-fallback');
  });

  it('preserves asApp 404 failure_reason when asUser() fallback also fails, and tags telemetry', async () => {
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"errors":[{"status":404,"code":"NOT_FOUND"}]}',
    });
    asUserRequest.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"errors":[{"status":404,"code":"NOT_FOUND"}]}',
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-fb2',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-fb2',
        extension: { content: { id: '555' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-fallback-fail' },
      },
    };

    await handler(payload);

    // 2 asApp() calls: macro_type lookup (custom-content GET), then the
    // attachments GET that 404s and triggers the asUser() fallback below.
    expect(asAppRequest).toHaveBeenCalledTimes(2);
    expect(asUserRequest).toHaveBeenCalledTimes(1);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: {
        failure_reason?: string;
        http_status?: number;
        custom_content_id?: string;
        used_asuser_fallback?: boolean;
        fallback_http_status?: number;
      };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('attachments_api_404');
    expect(failed?.properties?.http_status).toBe(404);
    expect(failed?.properties?.custom_content_id).toBe('cc-fallback-fail');
    expect(failed?.properties?.used_asuser_fallback).toBe(true);
    expect(failed?.properties?.fallback_http_status).toBe(404);
  });

  it('tags telemetry with fallback_error_name when asUser() throws', async () => {
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    });
    asUserRequest.mockRejectedValue(
      Object.assign(new Error('Authentication Required'), { name: 'NEEDS_AUTHENTICATION_ERR' }),
    );

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-fb3',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-fb3',
        extension: { content: { id: '777' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-fb-throw' },
      },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: {
        failure_reason?: string;
        used_asuser_fallback?: boolean;
        fallback_http_status?: number;
        fallback_error_name?: string;
      };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('attachments_api_404');
    expect(failed?.properties?.used_asuser_fallback).toBe(true);
    expect(failed?.properties?.fallback_http_status).toBeUndefined();
    expect(failed?.properties?.fallback_error_name).toBe('NEEDS_AUTHENTICATION_ERR');
  });

  it('uses subdomain prefix as client_domain in analytics events', async () => {
    asAppRequest.mockRejectedValue(new Error('forced failure'));

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-sub',
        siteUrl: 'https://example-tenant.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-sub',
        extension: { content: { id: '999' } },
      },
      extensionPayload: { config: { customContentId: 'cc-sub' } },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { client_domain?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.client_domain).toBe('example-tenant');
  });

  it('reads NO custom content on the success path, so macro_type is "none" there', async () => {
    // Measured on Lite production 2026-08-16: exportMacro runs 12,407 times/day
    // = 40.3% of every Forge invocation for the app. An eager custom-content GET
    // therefore added a round-trip to 40% of invocations, against a month-end
    // compute projection already at ~94% of the free allowance. The read moved
    // to the failure paths; the cost of that is this assertion — a successful
    // export cannot report its diagram type.
    //
    // Mocked by URL, not by call order: the order is exactly what this change
    // reverses, and an order-coupled fixture would pass for the wrong reason.
    asAppRequest.mockImplementation(async (url: string) => {
      if (String(url).includes('/attachments')) {
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            results: [{ fileId: 'file-zenuml-cc-mermaid', downloadLink: '/wiki/download/attachments/888/zenuml-cc-mermaid.png' }],
            _links: { base: 'https://acme.atlassian.net' },
          }),
        };
      }
      throw new Error(`unexpected asApp() call on the success path: ${url}`);
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-mmd',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-mmd',
        extension: { content: { id: '888' } },
      },
      extensionPayload: { config: { customContentId: 'cc-mermaid' } },
    };

    await handler(payload);

    // The point of the change: no custom-content read at all on the success
    // path. Two asApp() calls remain: the attachments lookup, then the
    // PNG-dimensions Range request against the same attachment's download
    // link (also matches '/attachments' — it's '/download/attachments/...').
    expect(asAppRequest).toHaveBeenCalledTimes(2);
    expect(String(asAppRequest.mock.calls[0][0])).toContain('/attachments');
    expect(String(asAppRequest.mock.calls[1][0])).toContain('/download/attachments/888/zenuml-cc-mermaid.png');
    expect(
      asAppRequest.mock.calls.filter(([u]: [string]) => String(u).includes('/custom-content/')),
    ).toHaveLength(0);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { macro_type?: string };
    }>;
    expect(rows.find((r) => r.event === 'macro_export_requested')?.properties?.macro_type).toBe('none');
    expect(rows.find((r) => r.event === 'macro_export_succeeded')?.properties?.macro_type).toBe('none');
  });

  it('#435: carries the resolved macro_type on macro_export_failed (attachment_not_found), so type-sized failure queries work', async () => {
    // Mocked by URL, not call order — the failure path now reads custom content
    // AFTER the attachments lookup, so an order-coupled fixture would hand the
    // wrong body to each call.
    asAppRequest.mockImplementation(async (url: string) => {
      if (String(url).includes('/attachments')) {
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({ results: [], _links: { base: 'https://acme.atlassian.net' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ body: { raw: { value: JSON.stringify({ diagramType: 'graph' }) } } }),
      };
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-graph',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-graph',
        extension: { content: { id: '890' } },
      },
      extensionPayload: { config: { customContentId: 'cc-graph' } },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; macro_type?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('attachment_not_found');
    expect(failed?.properties?.macro_type).toBe('graph');
  });

  it('#435: records macro_type "none" (not omitted) when the type genuinely cannot be determined — no customContentId', async () => {
    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-nocc',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-nocc',
        extension: { content: { id: '891' } },
      },
      extensionPayload: { config: { customContentId: null } },
    };

    await handler(payload);

    expect(asAppRequest).not.toHaveBeenCalled();

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; macro_type?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('missing_custom_content_id');
    expect(failed?.properties?.macro_type).toBe('none');
  });

  it('#435: records macro_type "none" when the custom-content lookup itself fails (page restricted, content deleted, etc.)', async () => {
    // Mocked by URL, not call order. The attachment is FOUND here, so this is a
    // success path — which no longer reads custom content at all. The 404 mock
    // for that read is kept to prove it is never requested.
    asAppRequest.mockImplementation(async (url: string) => {
      if (String(url).includes('/attachments')) {
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            results: [{ fileId: 'file-zenuml-cc-unknown', downloadLink: '/wiki/download/attachments/892/zenuml-cc-unknown.png' }],
            _links: { base: 'https://acme.atlassian.net' },
          }),
        };
      }
      return { ok: false, status: 404, text: async () => '' };
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-unk',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-unk',
        extension: { content: { id: '892' } },
      },
      extensionPayload: { config: { customContentId: 'cc-unknown-type' } },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { macro_type?: string };
    }>;
    expect(rows.find((r) => r.event === 'macro_export_succeeded')?.properties?.macro_type).toBe('none');
  });

  it('does not call asUser() and omits fallback telemetry when asApp() returns a non-404 error', async () => {
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-403',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-403',
        extension: { content: { id: '666' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-403' },
      },
    };

    await handler(payload);

    // 2 asApp() calls: macro_type lookup (custom-content GET), then the
    // attachments GET that 403s (non-404, so no asUser() fallback).
    expect(asAppRequest).toHaveBeenCalledTimes(2);
    expect(asUserRequest).not.toHaveBeenCalled();

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: {
        failure_reason?: string;
        http_status?: number;
        used_asuser_fallback?: boolean;
      };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('needs_authentication');
    expect(failed?.properties?.http_status).toBe(403);
    expect(failed?.properties?.used_asuser_fallback).toBeUndefined();
  });
});

describe('macro_export_* $insert_id (Mixpanel dedup key)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })));
    process.env.MIXPANEL_TOKEN = 'unit-test-token';
    // These specs assert on the CONTENT of the emitted events, so the quota
    // sampling in src/lib/exportSampling.js must not decide whether they run.
    // A draw of 0 is below every configured rate, so every event is kept; the
    // drop path has its own coverage in tests/unit/exportSampling.spec.ts.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    asAppRequest.mockReset();
    asUserRequest.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MIXPANEL_TOKEN;
  });

  // Quota sampling, at the handler level. The unit-level boundary cases live in
  // tests/unit/exportSampling.spec.ts; this one proves the handler actually
  // honours a drop decision, so a green suite cannot be read as "every export
  // still reaches Mixpanel".
  it('sends nothing to Mixpanel when the sampler drops the event', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'not found',
    });

    await handler({
      extensionPayload: { pageId: '111', customContentId: '222', attachmentName: 'zenuml.png' },
    });

    const posts = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => String(c[0]).includes('api.mixpanel.com'));
    expect(posts).toHaveLength(0);
  });

  // One page export invokes this handler once per macro, and those invocations
  // land in the same millisecond for the same tenant. When $insert_id carried
  // only (event, cloud_id, ms), every macro on the page produced an identical
  // key and Mixpanel kept exactly one — which is why the Console showed 12,407
  // exportMacro invocations on a day Mixpanel recorded 65 events.
  it('gives two macros on the SAME page in the same millisecond distinct Mixpanel-valid keys', async () => {
    asAppRequest.mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        results: [{ fileId: 'file-x', downloadLink: '/wiki/download/attachments/900/x.png' }],
        _links: { base: 'https://acme.atlassian.net' },
      }),
    }));

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const payloadFor = (ccId: string) => ({
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-same',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-same',
        extension: { content: { id: '900' } },
      },
      extensionPayload: { config: { customContentId: ccId } },
    });

    await handler(payloadFor('cc-macro-a'));
    await handler(payloadFor('cc-macro-b'));
    nowSpy.mockRestore();

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { $insert_id?: string; custom_content_id?: string };
    }>;
    const requested = rows.filter((r) => r.event === 'macro_export_requested');
    expect(requested).toHaveLength(2);

    const keys = requested.map((r) => r.properties?.$insert_id);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      expect(key).toBeDefined();
      expect(Buffer.byteLength(key ?? '', 'utf8')).toBeLessThanOrEqual(36);
      expect(key).toMatch(/^[A-Za-z0-9-]+$/);
    }
  });
});
